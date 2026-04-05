#!/bin/bash
#
# TL — Codex에서 TL 자동 설치 스크립트
# 사용: TL_BOT_TOKEN=xxx TL_GROUP_ID=xxx curl -fsSL ... | bash
# 또는: chmod +x setup-codex.sh && TL_BOT_TOKEN=xxx TL_GROUP_ID=xxx ./setup-codex.sh
#

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[TL]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!!]${NC} $1"; }
err()  { echo -e "${RED}[ER]${NC} $1"; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   TL — Codex ↔ Telegram Bridge 설치         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# 1. TL 프로젝트 클론
TL_DIR="$HOME/Projects/TL"

if [ -d "$TL_DIR/.git" ]; then
    ok "TL 프로젝트가 이미 있습니다. 업데이트 중..."
    cd "$TL_DIR"
    git pull || warn "git pull 실패 — 로컬 변경사항이 있을 수 있습니다"
else
    log "TL 프로젝트 클론 중..."
    mkdir -p "$HOME/Projects"
    git clone https://github.com/tonyclaw/tl.git "$TL_DIR"
    cd "$TL_DIR"
    ok "클론 완료"
fi

# 2. 의존성 설치 및 빌드
log "의존성 설치 중..."
npm install
ok "npm install 완료"

log "빌드 중..."
npm run build
ok "빌드 완료"

# 3. Codex Hooks 활성화
CODEX_CONFIG="$HOME/.codex/config.toml"
if [ -f "$CODEX_CONFIG" ]; then
    if grep -q "codex_hooks" "$CODEX_CONFIG"; then
        ok "Codex hooks가 이미 설정되어 있습니다"
    else
        log "Codex hooks 활성화 중..."
        echo "" >> "$CODEX_CONFIG"
        echo "[features]" >> "$CODEX_CONFIG"
        echo "codex_hooks = true" >> "$CODEX_CONFIG"
        ok "활성화 완료"
    fi
else
    log "Codex config.toml 생성 중..."
    mkdir -p "$HOME/.codex"
    cat > "$CODEX_CONFIG" << 'EOF'
[features]
codex_hooks = true
EOF
    ok "생성 완료"
fi

# 4. 설정
if [ -n "$TL_BOT_TOKEN" ] && [ -n "$TL_GROUP_ID" ]; then
    log "환경변수로 설정 중..."
    npx tsx bin/tl setup --non-interactive
    ok "설정 완료"
else
    echo ""
    echo "──────────────────────────────────────────────"
    warn "TL_BOT_TOKEN 또는 TL_GROUP_ID가 설정되지 않았습니다."
    echo ""
    echo "다음 중 하나를 실행하세요:"
    echo ""
    echo "  # 대화형 설정 (권장)"
    echo "  cd $TL_DIR && npx tsx bin/tl setup"
    echo ""
    echo "  # 환경변수로 설정"
    echo "  export TL_BOT_TOKEN='123456:ABCdef...'"
    echo "  export TL_GROUP_ID='-1001234567890'"
    echo "  cd $TL_DIR && npx tsx bin/tl setup --non-interactive"
    echo "──────────────────────────────────────────────"
    echo ""
fi

# 5. 데몬 시작
log "데몬 시작 중..."
npx tsx bin/tl start || warn "데몬 시작 실패 — 설정을 먼저 완료하세요"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   🎉 설치 완료!                              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "검증: Telegram 그룹에서 /tl-status 전송"
echo "시작: cd my-project && codex"
echo ""
