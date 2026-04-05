# Codex에서 TL 설치 & 설정 가이드

이 가이드는 OpenAI Codex CLI에서 TL(Codex ↔ Telegram Bridge)을 설치하고 연동하는 방법을 단계별로 설명합니다.

---

## 1단계: TL 프로젝트 클론

```bash
git clone https://github.com/tonyclaw/tl.git ~/Projects/TL
cd ~/Projects/TL
```

---

## 2단계: 의존성 설치 및 빌드

```bash
cd ~/Projects/TL
npm install
npm run build
```

빌드가 성공하면 `dist/` 폴더에 컴파일된 JS 파일이 생성됩니다.

---

## 3단계: Codex Hooks 활성화

Codex는 기본적으로 hooks가 비활성화되어 있습니다. 반드시 활성화해야 합니다.

```bash
# config.toml이 없으면 생성
mkdir -p ~/.codex
cat >> ~/.codex/config.toml << 'EOF'
[features]
codex_hooks = true
EOF
```

기존 `~/.codex/config.toml`이 있다면 `[features]` 섹션에 `codex_hooks = true`만 추가하세요.

---

## 4단계: Telegram 준비

### 4-1. 봇 토큰 발급

1. Telegram에서 [@BotFather](https://t.me/botfather)에게 `/newbot` 전송
2. 봇 이름과 유저네임 입력
3. 발급받은 토큰 복사 (형식: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 4-2. 그룹 생성 (Topics ON)

> ⚠️ **1:1 채팅에서는 작동하지 않습니다. 반드시 그룹(Topics ON)이 필요합니다.**

1. Telegram에서 새 그룹 생성
2. 그룹 설정 → **Topics** 켜기 (필수)
3. 만든 봇을 그룹에 초대
4. 봇을 **어드민**으로 승격
5. 그룹 ID 확인: [@getmyid_bot](https://t.me/getmyid_bot)이나 [@RawDataBot](https://t.me/rawdatabot)으로 확인
   - 형식: `-1001234567890` (음수)

---

## 5단계: TL 설정

### 방법 A: 대화형 설정 (추천)

```bash
cd ~/Projects/TL
npx tsx bin/tl setup
```

봇 토큰, 그룹 ID 등을 하나씩 물어봅니다.

### 방법 B: 환경변수 + Non-interactive

```bash
cd ~/Projects/TL

export TL_BOT_TOKEN="123456:ABCdef..."
export TL_GROUP_ID="-1001234567890"
# 선택사항:
# export TL_HOOK_PORT=9877
# export TL_STOP_TIMEOUT=3600
# export TL_HOOK_BASE_URL="http://localhost:9877"

npx tsx bin/tl setup --non-interactive
```

### 설정이 하는 일

1. `~/.tl/config.json`에 설정 저장
2. `templates/hooks.json` → `~/.codex/hooks.json` 복사 (Codex 훅 설치)
3. 기존 데몬 정지 → 새 설정으로 재시작

---

## 6단계: 데몬 시작

```bash
npx tsx bin/tl start
```

데몬이 백그라운드에서 실행됩니다.

---

## 7단계: 검증

### 데몬 상태 확인

```bash
npx tsx bin/tl status
# 출력 예:
# Daemon is running (PID: 12345)
#   Uptime: 42s
#   Active sessions: 0
#   Waiting sessions: 0
```

### Telegram에서 확인

1. 설정한 Telegram 그룹 열기
2. `/tl-status` 전송
3. 봇이 응답하면 성공

---

## 8단계: Codex에서 사용

```bash
cd my-project
codex
```

Codex를 시작하면 **SessionStart 훅**이 자동으로 발동되어:
1. TL 데몬이 Telegram 그룹에 새 토픽 생성
2. 토픽에 "🟢 세션 시작" 메시지 전송
3. Codex TUI에서 개발 계속

Codex가 작업을 마치면:
1. **Stop 훅**이 발동
2. TL 데몬이 Telegram 토픽으로 작업 결과 전송
3. Telegram에서 답장하면 Codex가 계속 진행

---

## 문제 해결

### `codex_hooks`가 활성화되지 않음

```bash
cat ~/.codex/config.toml
# [features] 섹션에 codex_hooks = true 가 있는지 확인
```

### hooks.json이 설치되지 않음

```bash
# 수동 설치
cd ~/Projects/TL
npx tsx bin/tl init --force

# 확인
cat ~/.codex/hooks.json
```

### 데몬이 시작되지 않음

```bash
# 포트 충돌 확인
lsof -i :9877

# 로그 확인
cat ~/.tl/daemon.log 2>/dev/null

# 빌드 확인
cd ~/Projects/TL && npm run build
```

### 봇이 응답하지 않음

- 봇이 그룹에 **어드민**으로 추가되었는지 확인
- 그룹의 **Topics**가 켜져 있는지 확인
- Bot Token이 유효한지 확인: `npx tsx bin/tl config get botToken`

### hooks.json의 명령어 경로 문제

`hooks.json`의 `command` 필드에 `tl` 명령어가 PATH에 있어야 합니다. 글로벌 설치하지 않았다면 절대 경로로 수정하세요:

```json
{
  "command": "/Users/flowkater/Projects/TL/dist/cli.js hook-session-start"
}
```

또는 `tl`을 전역 설치:

```bash
cd ~/Projects/TL
npm install -g .
```

---

## 한 줄 설치 스크립트

아래 스크립트를 실행하면 TL 클론 → 빌드 → 설정(환경변수 필요) → 데몬 시작까지 자동화됩니다.

```bash
curl -fsSL https://raw.githubusercontent.com/tonyclaw/tl/main/scripts/setup-codex.sh | bash
```

(스크립트 실행 전 `TL_BOT_TOKEN`과 `TL_GROUP_ID` 환경변수를 설정하세요.)
