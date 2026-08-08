#!/bin/sh
# tesla-http-proxy 는 HTTPS로만 동작하므로 자체 서명 인증서가 필요합니다.
# 이 인증서는 도커 내부 통신에만 쓰이며, 우리 서버가 이 인증서 파일로 프록시를 검증합니다.
set -eu

KEY_FILE="${TESLA_KEY_FILE:-/data/keys/private-key.pem}"
TLS_DIR="${TLS_DIR:-/data/proxy}"
HOSTNAME_CN="${PROXY_HOSTNAME:-tesla-http-proxy}"
PORT="${PROXY_PORT:-4443}"

CERT="$TLS_DIR/cert.pem"
TLS_KEY="$TLS_DIR/tls-key.pem"

if [ ! -f "$KEY_FILE" ]; then
  echo "개인키를 찾을 수 없습니다: $KEY_FILE" >&2
  echo "먼저 tesla-fleet-api 컨테이너를 실행해 키를 생성하세요." >&2
  exit 1
fi

mkdir -p "$TLS_DIR"

if [ ! -f "$CERT" ] || [ ! -f "$TLS_KEY" ]; then
  echo "프록시용 자체 서명 인증서를 생성합니다 ($HOSTNAME_CN)"
  openssl req -x509 -nodes -days 3650 \
    -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -subj "/CN=$HOSTNAME_CN" \
    -addext "subjectAltName=DNS:$HOSTNAME_CN,DNS:localhost,IP:127.0.0.1" \
    -keyout "$TLS_KEY" -out "$CERT"
  chmod 600 "$TLS_KEY"
fi

echo "tesla-http-proxy 시작: 포트 $PORT"
exec tesla-http-proxy \
  -key-file "$KEY_FILE" \
  -cert "$CERT" \
  -tls-key "$TLS_KEY" \
  -host 0.0.0.0 \
  -port "$PORT" \
  -verbose
