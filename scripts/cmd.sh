#!/bin/sh
# 차량 명령 도우미. API 키를 .env 또는 data/api-key.txt 에서 읽어오므로
# 키를 직접 입력하거나 화면에 노출할 필요가 없습니다.
#
# 사용법: ./scripts/cmd.sh <차량> <명령> [JSON 본문]
#   <차량> 은 별칭(.env 의 VEHICLE_ALIASES), 차량 이름, 차량 ID, VIN 중 아무거나
#
# 예시:
#   ./scripts/cmd.sh 3 wake                       # 깨우기
#   ./scripts/cmd.sh 3 door_unlock                # 문 열기
#   ./scripts/cmd.sh Kana door_lock               # 차량 이름으로도 가능
#   ./scripts/cmd.sh X set_charge_limit '{"percent":80}'
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$ROOT/.env"

read_env() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d "\"'" | tr -d '\r'
}

if [ $# -lt 2 ]; then
  echo "사용법: $0 <차량(별칭/이름/ID/VIN)> <명령> [JSON 본문]" >&2
  echo "예:     $0 3 door_unlock" >&2
  exit 1
fi

VEHICLE=$1
COMMAND=$2
BODY=${3:-}
[ -n "$BODY" ] || BODY='{}'

PORT=$(read_env HOST_PORT)
[ -n "$PORT" ] || PORT=8080

KEY=$(read_env API_KEY)
if [ -z "$KEY" ] && [ -f "$ROOT/data/api-key.txt" ]; then
  KEY=$(tr -d '\r\n' < "$ROOT/data/api-key.txt")
fi
if [ -z "$KEY" ]; then
  echo "API 키를 찾을 수 없습니다. .env 의 API_KEY 또는 data/api-key.txt 를 확인하세요." >&2
  exit 1
fi

# 깨우기는 명령 서명 경로가 아니라 별도 엔드포인트를 씁니다.
if [ "$COMMAND" = "wake" ] || [ "$COMMAND" = "wake_up" ]; then
  URL="http://localhost:$PORT/api/vehicles/$VEHICLE/wake_up"
else
  URL="http://localhost:$PORT/api/vehicles/$VEHICLE/command/$COMMAND"
fi

curl -sS -X POST \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "$URL"
echo
