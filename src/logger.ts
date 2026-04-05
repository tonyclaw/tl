import fs from 'fs';
import path from 'path';
import os from 'os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

const RESET = '\x1b[0m';

export class Logger {
  private logDir: string;
  private logFile: string;
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
    this.logDir = path.join(os.homedir(), '.tl');
    this.logFile = path.join(this.logDir, 'tl.log');

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private format(level: LogLevel, message: string, meta?: unknown): string {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  log(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.format(level, message, meta);
    const colored = `${LEVEL_COLORS[level]}${formatted}${RESET}`;

    // 콘솔 출력
    if (level === 'error') {
      console.error(colored);
    } else {
      console.log(colored);
    }

    // 파일 출력 (ansi 코드 제거)
    try {
      fs.appendFileSync(this.logFile, formatted + '\n', 'utf-8');
    } catch {
      // 로그 파일 쓰기 실패는 무시
    }
  }

  debug(message: string, meta?: unknown): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log('error', message, meta);
  }
}

// 글로벌 싱글톤
export const logger = new Logger(
  (process.env.TL_LOG_LEVEL as LogLevel) || 'info'
);
