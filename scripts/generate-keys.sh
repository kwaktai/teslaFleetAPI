#!/bin/sh
# Tesla Fleet API용 EC 키쌍(prime256v1) 생성
# 사용법: ./scripts/generate-keys.sh [출력 디렉터리, 기본값 ./data/keys]
set -eu

OUT_DIR="${1:-./data/keys}"
mkdir -p "$OUT_DIR"

PRIVATE_KEY="$OUT_DIR/private-key.pem"
PUBLIC_KEY="$OUT_DIR/com.tesla.3p.public-key.pem"

if [ -f "$PRIVATE_KEY" ]; then
  echo "이미 개인키가 존재합니다: $PRIVATE_KEY"
  echo "새로 만들려면 기존 파일을 먼저 삭제하세요. (주의: 재등록 필요)"
  exit 1
fi

openssl ecparam -name prime256v1 -genkey -noout -out "$PRIVATE_KEY"
chmod 600 "$PRIVATE_KEY"
openssl ec -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"

echo ""
echo "✅ 키 생성 완료"
echo "  개인키: $PRIVATE_KEY  (절대 외부에 공개 금지)"
echo "  공개키: $PUBLIC_KEY   (서버가 /.well-known/... 경로로 제공)"
