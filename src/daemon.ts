import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { loadConfig, getConfigDir } from './config.js';
import { SessionsStore } from './store.js';
import { ReplyQueue } from './reply-queue.js';
import { TelegramBot } from './telegram.js';
import { SessionManagerImpl } from './session-manager.js';
import { HookOutput, SessionStatus } from './types.js';
import { logger } from './logger.js';

const startTime = Date.now();

function getPidPath(): string {
  return `${getConfigDir()}/daemon.pid`;
}

// ===== PID 관리 =====
function acquirePidFile(): number | null {
  const fs = require('fs');
  const pidPath = getPidPath();
  try {
    const fd = fs.openSync(pidPath, 'wx');
    fs.writeSync(fd, process.pid.toString());
    fs.closeSync(fd);
    return null;
  } catch {
    if (!fs.existsSync(pidPath)) return null;
    const existingPid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    try {
      process.kill(existingPid, 0);
      return existingPid;
    } catch {
      try { fs.unlinkSync(pidPath); } catch {}
      return acquirePidFile();
    }
  }
}

function releasePidFile(): void {
  const fs = require('fs');
  try { fs.unlinkSync(getPidPath()); } catch {}
}

// ===== 메인 =====
async function main() {
  const fs = require('fs');

  // 설정 로드
  const config = loadConfig();

  // PID 파일
  const existingPid = acquirePidFile();
  if (existingPid !== null) {
    logger.error(`Daemon already running (PID: ${existingPid})`);
    process.exit(1);
  }

  // 저장소 초기화
  const store = new SessionsStore();
  await store.load();
  logger.info('Sessions store loaded', {
    sessionCount: store.listActive().length,
  });

  // Reply 큐 초기화
  const replyQueue = new ReplyQueue();
  replyQueue.startCleanupInterval();
  await replyQueue.processFileQueue();

  // Telegram 봇 초기화
  const tg = new TelegramBot(config, store, replyQueue);
  await tg.init();

  // 세션 매니저 초기화
  const sessionManager = new SessionManagerImpl(store, replyQueue, tg, config);

  // Hono 앱
  const app = new Hono();

  // ===== POST /hook/session-start =====
  app.post('/hook/session-start', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    if (!body.session_id) {
      return c.json({ error: 'Missing session_id' }, 400);
    }

    const isReconnect = body.is_reconnect === true;

    try {
      await sessionManager.handleSessionStart({
        session_id: body.session_id,
        model: body.model ?? 'unknown',
        turn_id: body.turn_id ?? '',
        project: body.cwd ? body.cwd.split('/').pop() ?? body.cwd : 'unknown',
        cwd: body.cwd ?? process.cwd(),
        last_user_message: body.last_user_message ?? '',
        is_reconnect: isReconnect,
      });

      const record = store.get(body.session_id);
      return c.json({
        session_id: body.session_id,
        topic_id: record?.record.topic_id ?? 0,
        status: 'ok',
      });
    } catch (err) {
      const code = (err as any).code === 'SESSION_EXISTS' ? 409 : 500;
      return c.json(
        { error: (err as Error).message },
        code
      );
    }
  });

  // ===== POST /hook/stop-and-wait =====
  app.post('/hook/stop-and-wait', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    if (!body.session_id) {
      return c.json({ error: 'Missing session_id' }, 400);
    }

    const existing = store.get(body.session_id);
    if (!existing) {
      return c.json({ decision: 'continue' } as HookOutput);
    }

    try {
      const output = await sessionManager.handleStopAndWait({
        session_id: body.session_id,
        turn_id: body.turn_id ?? '',
        last_message: body.last_assistant_message ?? '',
        total_turns: existing.record.total_turns + 1,
      });

      // store는 sessionManager가 이미 업데이트함
      await store.save();

      return c.json(output);
    } catch (err) {
      const code = (err as any).code === 'SESSION_NOT_FOUND' ? 404 : 500;
      logger.warn('Stop-and-wait failed', {
        session_id: body.session_id,
        error: (err as Error).message,
      });
      return c.json({ decision: 'continue' } as HookOutput, code);
    }
  });

  // ===== POST /hook/complete =====
  app.post('/hook/complete', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    if (!body.session_id) {
      return c.json({ error: 'Missing session_id' }, 400);
    }

    try {
      await sessionManager.handleComplete({
        session_id: body.session_id,
        total_turns: body.total_turns ?? 0,
        duration: body.duration ?? 'unknown',
      });
      await store.save();
      return c.json({ status: 'ok' });
    } catch (err) {
      const code = (err as any).code === 'SESSION_NOT_FOUND' ? 404 : 500;
      return c.json({ error: (err as Error).message }, code);
    }
  });

  // ===== POST /hook/resume =====
  app.post('/hook/resume', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    if (!body.session_id) {
      return c.json({ error: 'Missing session_id' }, 400);
    }

    const existing = store.get(body.session_id);
    if (!existing) {
      return c.json({ error: 'Session not found' }, 404);
    }

    if (existing.record.status !== 'waiting') {
      return c.json(
        { error: `Session is ${existing.record.status}, not waiting` },
        400
      );
    }

    // ReplyQueue에 resume 신호 전달
    const delivered = replyQueue.deliver(body.session_id, '/resume');
    if (!delivered) {
      // waiting consumer가 없으면 세션만 active로 변경
      store.update(body.session_id, (record) => {
        record.status = 'active';
      });
      await store.save();
    }

    return c.json({ status: 'resumed', session_id: body.session_id });
  });

  // ===== POST /hook/mock-reply (PoC 테스트용) =====
  app.post('/hook/mock-reply', async (c) => {
    const url = new URL(c.req.url);
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId) {
      return c.json({ error: 'Missing session_id query param' }, 400);
    }

    let body: { replyText: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    if (!body.replyText) {
      return c.json({ error: 'Missing replyText' }, 400);
    }

    const delivered = replyQueue.deliver(sessionId, body.replyText);
    return c.json({ delivered, session_id: sessionId });
  });

  // ===== GET /status =====
  app.get('/status', (c) => {
    const sessions = store.listActive();
    const activeCount = sessions.filter((s) => s.record.status === 'active').length;
    const waitingCount = sessions.filter((s) => s.record.status === 'waiting').length;

    return c.json({
      daemon: 'running',
      active_sessions: activeCount,
      waiting_sessions: waitingCount,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  // ===== GET /sessions =====
  app.get('/sessions', (c) => {
    const allSessions: Record<string, any> = (store as any).data.sessions;
    const list = Object.entries(allSessions).map(([id, r]: [string, any]) => ({
      session_id: id,
      status: r.status,
      project: r.project,
      topic_id: r.topic_id,
      total_turns: r.total_turns,
      started_at: r.started_at,
    }));

    return c.json({ sessions: list });
  });

  // HTTP 서버 시작
  const server = serve(
    {
      fetch: app.fetch,
      port: config.hookPort,
    },
    (info) => {
      logger.info(`Daemon listening on port ${info.port}`);
    }
  );

  // Graceful shutdown
  async function gracefulShutdown(signal: string) {
    logger.info(`Received ${signal}, shutting down...`);
    replyQueue.shutdown();
    await store.save();
    await tg.stop();
    releasePidFile();
    server.close();
    process.exit(0);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Daemon failed to start', { error: err.message });
  releasePidFile();
  process.exit(1);
});
