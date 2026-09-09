#!/bin/sh
# 시놀로지 NAS 에서 GitHub 의 최신 코드를 받아 서버 이미지를 다시 빌드합니다.
# .env 와 data/ (키·토큰·CSV·기기 로그) 는 건드리지 않습니다.
#
#   cd /volume1/docker/tesla-fleet-api
#   sh scripts/update-nas.sh              # 기본 브랜치
#   sh scripts/update-nas.sh main         # 브랜치 지정
#   BRANCH=main sh scripts/update-nas.sh  # 환경변수로도 가능
#
# 컨테이너를 "중지/시작" 만 하면 옛 이미지가 그대로 돕니다. Dockerfile 이
# src 를 이미지 안에 복사하므로 반드시 --build 로 다시 만들어야 합니다.
set -eu

REPO="kwaktai/teslaFleetAPI"
BRANCH="${1:-${BRANCH:-cursor/t2can-can-logger-5292}}"
SERVICE="${SERVICE:-tesla-fleet-api}"

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
if [ ! -f "$ROOT/docker-compose.yml" ]; then
  echo "docker-compose.yml 이 없습니다: $ROOT" >&2
  exit 1
fi

TMP="$(mktemp -d /tmp/tfa-upd.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

echo "다운로드: $REPO @ $BRANCH"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" -o "$TMP/src.tgz"
mkdir -p "$TMP/src"
tar xzf "$TMP/src.tgz" -C "$TMP/src" --strip-components=1

# 코드만 덮어쓴다. .env / data / t2can-logger(보드용) 는 그대로 둔다.
for item in src proxy scripts Dockerfile docker-compose.yml package.json package-lock.json README.md; do
  if [ -e "$TMP/src/$item" ]; then
    rm -rf "$ROOT/$item"
    cp -a "$TMP/src/$item" "$ROOT/$item"
  fi
done
chmod +x "$ROOT"/scripts/*.sh 2>/dev/null || true
echo "코드 갱신 완료: $ROOT"

# docker compose (v2) 가 없으면 docker-compose (v1, DSM 7.0~7.1)
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "docker compose 를 찾지 못했습니다. Container Manager 가 설치돼 있는지 확인하세요." >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  COMPOSE="sudo $COMPOSE"
fi

echo "이미지 빌드 + 컨테이너 교체: $SERVICE"
$COMPOSE up -d --build "$SERVICE"

echo
echo "확인 (0 이 아니면 새 코드):"
$COMPOSE exec -T "$SERVICE" grep -c "kind: 'events'" /app/src/index.js || true
echo
$COMPOSE logs --tail 10 "$SERVICE"
echo
echo "완료. https://<도메인>/canlog 에서 '기기 동작 로그' 표가 보이면 반영된 것입니다."
