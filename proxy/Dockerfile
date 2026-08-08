# Tesla 공식 vehicle-command 저장소의 tesla-http-proxy 를 빌드합니다.
# 이 프록시가 개인키로 명령에 서명해 Tesla로 전달합니다.
FROM golang:1.23-alpine AS build

ARG VEHICLE_COMMAND_VERSION=latest
RUN apk add --no-cache git \
 && go install github.com/teslamotors/vehicle-command/cmd/tesla-http-proxy@${VEHICLE_COMMAND_VERSION}

FROM alpine:3.20

RUN apk add --no-cache ca-certificates openssl

COPY --from=build /go/bin/tesla-http-proxy /usr/local/bin/tesla-http-proxy
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 4443

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
