# Tesla 공식 vehicle-command 저장소의 tesla-http-proxy 를 빌드합니다.
# 이 프록시가 개인키로 명령에 서명해 Tesla로 전달합니다.
#
# go.mod 에 replace 지시문이 있어 `go install <pkg>@<version>` 은 사용할 수 없습니다.
# (Go 는 replace 가 있는 모듈을 그 방식으로 설치하는 것을 거부합니다.)
# 저장소를 받아 메인 모듈로 빌드하면 replace 가 정상 적용됩니다.
FROM golang:1.23-alpine AS build

ARG VEHICLE_COMMAND_VERSION=v0.4.1

RUN apk add --no-cache git
WORKDIR /src
RUN git clone --depth 1 --branch "${VEHICLE_COMMAND_VERSION}" \
      https://github.com/teslamotors/vehicle-command.git .
RUN CGO_ENABLED=0 go build -trimpath -o /out/tesla-http-proxy ./cmd/tesla-http-proxy

FROM alpine:3.20

RUN apk add --no-cache ca-certificates openssl

COPY --from=build /out/tesla-http-proxy /usr/local/bin/tesla-http-proxy
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 4443

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
