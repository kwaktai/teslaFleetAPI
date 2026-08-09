#!/bin/sh
# 차량 명령 도우미. API 키를 .env 또는 data/api-key.txt 에서 읽어오므로
# 키를 직접 입력하거나 화면에 노출할 필요가 없습니다.
#
# 사용법: ./scripts/cmd.sh <차량ID 또는 VIN> <명령> [JSON 본문]
#
# 예시:
#   ./scripts/cmd.sh 5YJ3E1EB8LF727066 wake              # 깨우기
#   ./scripts/cmd.sh 5YJ3E1EB8LF727066 door_unlock       # 문 열기
#   ./scripts/cmd.sh 5YJ3E1EB8LF727066 door_lock         # 문 잠그기
#   ./scripts/cmd.sh 5YJ3E1EB8LF727066 set_charge_limit '{"percent":80}'
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$ROOT/.env"

read_env() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d "\"'" | tr -d '\r'
}

if [ $# -lt 2 ]; then
  echo "사용법: $0 <차량ID 또는 VIN> <명령> [JSON 본문]" >&2
  echo "예:     $0 5YJ3E1EB8LF727066 door_unlock" >&2
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
