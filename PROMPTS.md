# TL — Codex ↔ Telegram Bridge 설치 프롬프트

이 프롬프트를 Codex에게 던지면 TL을 자동으로 설치·설정합니다.

---

## 사용법

```bash
# 1. TL 저장소를 클론한 디렉토리로 이동
cd ~/Projects/TL

# 2. Codex에게 이 파일의 내용을 따라하라고 지시
codex exec "Follow the instructions in PROMPTS.md to install and configure TL (Codex ↔ Telegram Bridge)"
```

또는 환경변수와 함께:

```bash
cd ~/Projects/TL
TL_BOT_TOKEN="123456:ABC..." TL_GROUP_ID="-100..." \
  codex exec --full-auto "Follow the instructions in PROMPTS.md to install and configure TL"
```

---

## 설치 프롬프트 (Codex가 읽을 내용)

```
당신은 TL(Codex ↔ Telegram Bridge)을 설치하고 설정하는 작업을 하고 있습니다.
아래 단계를 순서대로 실행하세요.

### 1. 의존성 설치 및 빌드
- 현재 디렉토리에서 `npm install` 실행
- `npm run build`로 TypeScript 컴파일
- 빌드 결과 `dist/` 폴더에 JS 파일들이 생성되었는지 확인

### 2. Codex Hooks 활성화
- `~/.codex` 디렉토리 확인 (없으면 생성)
- `~/.codex/config.toml` 파일 확인/생성
- `[features]` 섹션에 `codex_hooks = true`가 있는지 확인
  - 파일이 없으면 아래 내용으로 생성:
    ```toml
    [features]
    codex_hooks = true
    ```
  - 파일이 있고 `[features]` 섹션이 없으면 추가
  - 섹션은 있지만 `codex_hooks`가 없으면 추가

### 3. hooks.json 설치
- 현재 디렉토리의 `templates/hooks.json`을 `~/.codex/hooks.json`로 복사
- 대상 디렉토리가 없으면 생성
- 복사 후 `~/.codex/hooks.json` 내용을 확인하여 SessionStart와 Stop 훅이 있는지 검증

### 4. 글로벌 CLI 설치 (선택)
- `npm install -g .`을 실행하여 `tl` 명령어를 전역에서 사용 가능하게 함
- `tl help`가 작동하는지 확인

### 5. 설정 안내 (대화형이 아닌 안내만)
- 사용자에게 다음 설정이 필요함을 알림:
  1. Telegram Bot Token (@BotFather에서 `/newbot`으로 발급)
  2. Telegram Group ID (Topics가 켜진 그룹, 봇을 어드민으로 추가)
- 설정 파일 위치: `~/.tl/config.json`
- 설정 방법: `tl setup` (대화형) 또는 환경변수 + `tl setup --non-interactive`
- **실제 설정은 사용자의 봇 토큰과 그룹 ID가 필요하므로 사용자가 직접 수행**

### 6. 검증
- `npm run test`로 테스트 통과 확인
- `ls dist/`로 빌드 결과 확인
- `cat ~/.codex/config.toml`로 hooks 활성화 확인
- `cat ~/.codex/hooks.json`로 훅 설정 확인

### 중요
- 봇 토큰이나 그룹 ID를 물어보지 마세요. 이것은 사용자가 직접 설정해야 합니다.
- 대신 설정이 필요하다는 안내와 방법을 출력하세요.
- 설치 후 `~/.tl/config.json`이 존재하면 기존 설정을 유지하세요. 덮어쓰지 마세요.

설치가 완료되면 결과를 요약하여 보고하세요.
```
