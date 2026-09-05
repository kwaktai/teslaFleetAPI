#!/bin/bash
# 최신 로거/서버 코드를 GitHub에서 받아 기존 폴더에 덮어씁니다.
# 폴더 경로를 바꾸지 않으므로 Arduino IDE 보드 설정은 그대로입니다.
set -euo pipefail

BRANCH="cursor/t2can-can-logger-5292"
DEFAULT_TARGET="${HOME}/Taicloud/Documents/임시/2CAN_FD/teslaFleetAPI-cursor-t2can-can-logger-5292"
TARGET="${1:-${T2CAN_DIR:-$DEFAULT_TARGET}}"
URL="https://github.com/kwaktai/teslaFleetAPI/archive/refs/heads/${BRANCH}.zip"

if [[ ! -d "$TARGET" ]]; then
  echo "대상 폴더가 없습니다: $TARGET"
  echo "사용법: $0 /원하는/경로"
  exit 1
fi

echo "대상: $TARGET"
echo "Arduino IDE 는 닫아 두세요."

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "다운로드 중..."
curl -fsSL "$URL" -o "$TMP/src.zip"
unzip -q "$TMP/src.zip" -d "$TMP"

SRC="$(find "$TMP" -maxdepth 1 -type d -name 'teslaFleetAPI-*' | head -n 1)"
if [[ -z "$SRC" ]]; then
  echo "ZIP 안에 저장소 폴더가 없습니다."
  exit 1
fi

# 로컬에서 받은 로그·시놀로지 data·.env 는 유지
rsync -a \
  --exclude '.git/' \
  --exclude 'data/' \
  --exclude '.env' \
  --exclude 'canlog-*.csv' \
  --exclude '__pycache__/' \
  "$SRC/" "$TARGET/"

echo "완료. 다음부터는 이 폴더에서:"
echo "  bash t2can-logger/update-from-github.sh"
echo "로거만 다시 열려면:  $TARGET/t2can-logger/t2can-logger.ino"
