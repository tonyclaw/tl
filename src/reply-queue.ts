import fs from 'fs';
import path from 'path';
import os from 'os';
import { HookOutput } from './types.js';
import { logger } from './logger.js';

interface PendingEntry {
  sessionId: string;
  resolve: (output: HookOutput) => void;
  timer: NodeJS.Timeout;
  createdAt: number;
}

interface ReplyFileEntry {
  sessionId: string;
  replyText: string;
  createdAt: string;
}

function getDataDir(): string {
  return process.env.TL_DATA_DIR || path.join(os.homedir(), '.tl');
}

function getReplyQueueDir(): string {
  return path.join(getDataDir(), 'reply-queue');
}

export class ReplyQueue {
  private pending = new Map<string, PendingEntry>();
  private fileQueueDir: string;
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.fileQueueDir = getReplyQueueDir();
    if (!fs.existsSync(this.fileQueueDir)) {
      fs.mkdirSync(this.fileQueueDir, { recursive: true });
    }
  }

  async waitFor(sessionId: string, timeoutSec: number): Promise<HookOutput> {
    return new Promise<HookOutput>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sessionId);
        logger.info('ReplyQueue timeout, returning continue', { sessionId });
        resolve({ decision: 'continue' });
      }, timeoutSec * 1000);

      this.pending.set(sessionId, {
        sessionId,
        resolve,
        timer,
        createdAt: Date.now(),
      });
    });
  }

  deliver(sessionId: string, replyText: string): boolean {
    const entry = this.pending.get(sessionId);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(sessionId);
      entry.resolve({ decision: 'block', reason: replyText });
      logger.info('Reply delivered to waiting hook', { sessionId });
      return true;
    }

    // pending에 없으면 파일 큐에 저장
    this.enqueueToFile(sessionId, replyText);
    return false;
  }

  private enqueueToFile(sessionId: string, replyText: string): void {
    if (!fs.existsSync(this.fileQueueDir)) {
      fs.mkdirSync(this.fileQueueDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${sessionId}-${timestamp}.json`;
    const filePath = path.join(this.fileQueueDir, fileName);

    const entry: ReplyFileEntry = {
      sessionId,
      replyText,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    logger.warn('Reply queued to file (no waiting consumer)', {
      sessionId,
      filePath,
    });
  }

  async processFileQueue(): Promise<void> {
    if (!fs.existsSync(this.fileQueueDir)) return;

    const files = fs.readdirSync(this.fileQueueDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(this.fileQueueDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const entry: ReplyFileEntry = JSON.parse(raw);

        const pending = this.pending.get(entry.sessionId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(entry.sessionId);
          pending.resolve({ decision: 'block', reason: entry.replyText });
          logger.info('File queue reply delivered', { sessionId: entry.sessionId });
        } else {
          // consumer가 없으면 파일 유지 (다음 재시작 때 재시도)
          logger.debug('No pending consumer for file queue entry', {
            sessionId: entry.sessionId,
          });
          continue;
        }

        // 처리 완료된 파일 삭제
        fs.unlinkSync(filePath);
      } catch (err) {
        logger.error('Failed to process file queue entry', { file, error: (err as Error).message });
      }
    }
  }

  shutdown(): void {
    for (const [sessionId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ decision: 'continue' });
      logger.info('ReplyQueue shutdown: resolved pending with continue', { sessionId });
    }
    this.pending.clear();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  startCleanupInterval(intervalMs: number = 30_000): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, entry] of this.pending) {
        // timeout은 waitFor 내부에서 처리되므로 여기서는 orphan만 정리
        if (now - entry.createdAt > 2 * 60 * 60 * 1000) {
          // 2시간 이상 고아 entry 정리
          clearTimeout(entry.timer);
          this.pending.delete(sessionId);
          logger.warn('Cleaned up orphan pending entry', { sessionId });
        }
      }
    }, intervalMs);
  }
}
