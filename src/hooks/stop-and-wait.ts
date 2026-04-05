#!/usr/bin/env node
// Stop 훅 CLI — stdin에서 JSON 읽어서 데몬으로 POST, long-polling으로 응답 대기

import fs from 'fs';
import path from 'path';
import os from 'os';

function getConfigDir(): string {
  return process.env.TL_CONFIG_DIR || path.join(os.homedir(), '.tl');
}

async function main() {
  const configPath = path.join(getConfigDir(), 'config.json');
  let port = 9877;
  let stopTimeout = 3600;
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      port = config.hookPort || 9877;
      stopTimeout = config.stopTimeout || 3600;
    } catch { /* ignore */ }
  }

  const stdin = fs.readFileSync(0, 'utf-8');
  if (!stdin.trim()) {
    process.stderr.write('No input on stdin\n');
    process.exit(1);
  }

  try {
    const res = await fetch(`http://localhost:${port}/hook/stop-and-wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stdin,
      signal: AbortSignal.timeout((stopTimeout + 100) * 1000),
    });

    const data = await res.json();

    if (!res.ok) {
      // SESSION_NOT_FOUND 등은 continue로 처리
      process.stderr.write(`Warning: HTTP ${res.status}: ${JSON.stringify(data)}\n`);
      process.stdout.write(JSON.stringify({ decision: 'continue' }) + '\n');
      process.exit(0);
    }

    // HookOutput을 stdout으로 출력
    process.stdout.write(JSON.stringify(data) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Warning: Hook connection failed: ${(err as Error).message}\n`);
    process.stdout.write(JSON.stringify({ decision: 'continue' }) + '\n');
    process.exit(0);
  }
}

main();
