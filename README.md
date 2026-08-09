# Tesla Fleet API 서버 (시놀로지 Docker용)

시놀로지 NAS의 Docker(Container Manager)에서 실행하는 자가 호스팅 Tesla Fleet API 서버입니다.

- Tesla가 요구하는 공개키 호스팅 (`/.well-known/appspecific/com.tesla.3p.public-key.pem`)
- 파트너(도메인) 등록 API
- Tesla 계정 OAuth 로그인 + 토큰 자동 갱신
- 차량 목록/상태 조회, 깨우기(wake_up) API
- 차량 명령(잠금·공조·충전) — 서명 프록시 포함
- API 키 기반 접근 제어

## 사전 준비물

| 항목 | 설명 |
|---|---|
| Tesla 개발자 계정 | https://developer.tesla.com 에서 앱 등록 (무료) |
| 공개 HTTPS 도메인 | 시놀로지 DDNS(`xxx.synology.me`) 또는 개인 도메인. **반드시 443 포트로 외부에서 접속 가능해야 함** |
| 시놀로지 DSM 7 이상 | Container Manager(구 Docker) 패키지 설치 |

> 한국에서 사용하는 경우 리전은 `na` (북미·아시아태평양)입니다.

## 1단계 — Tesla 개발자 앱 등록

1. https://developer.tesla.com 접속 → Tesla 계정으로 로그인
2. **Create App(앱 만들기)**:
   - **Allowed Origin URL(허용 오리진)**: `https://<내도메인>` (예: `https://mynas.synology.me`)
   - **Allowed Redirect URI(리디렉션 URI)**: `https://<내도메인>/auth/callback`
   - **Scopes(권한)**: 필요한 항목 선택 — 차량 데이터(`vehicle_device_data`), 위치(`vehicle_location`), 명령(`vehicle_cmds`), 충전 명령(`vehicle_charging_cmds`), 오프라인 액세스(`offline_access`) 등
3. 발급된 **Client ID / Client Secret**을 메모합니다.

## 2단계 — 시놀로지에 파일 올리기

1. File Station에서 `/volume1/docker/tesla-fleet-api` 폴더 생성 후 이 저장소 파일 전체 업로드
   (또는 SSH에서 `git clone`)
2. `.env` 파일 생성:

```sh
cd /volume1/docker/tesla-fleet-api
cp .env.example .env
vi .env    # CLIENT_ID / CLIENT_SECRET / 도메인 입력
```

### 키쌍에 대하여

**키는 컨테이너가 처음 실행될 때 자동으로 생성**되므로 별도 작업이 필요 없습니다.
`data/keys/` 폴더에 아래 두 파일이 만들어집니다.

- `private-key.pem` — **개인키. 절대 유출 금지** (차량 명령 서명에 사용, 권한 600)
- `com.tesla.3p.public-key.pem` — 서버가 `/.well-known/...` 경로로 호스팅하는 공개키

`openssl`로 직접 만들고 싶다면 컨테이너 실행 전에 아래를 돌려도 됩니다(선택 사항).
이미 키가 있으면 서버는 기존 키를 그대로 사용합니다.

```sh
sh scripts/generate-keys.sh          # ./data/keys 에 키쌍 생성
```

## 3단계 — 컨테이너 실행

SSH에서:

```sh
cd /volume1/docker/tesla-fleet-api
sudo docker compose up -d --build
```

`unknown shorthand flag: 'd'` 오류가 나면 구버전 Docker 패키지(DSM 7.0~7.1)이므로
하이픈이 들어간 명령을 쓰세요. 동작은 동일합니다.

```sh
sudo docker-compose up -d --build
```

또는 Container Manager GUI → **프로젝트 → 생성** → 경로에 위 폴더 지정 → `docker-compose.yml` 자동 인식.

확인: 브라우저에서 `http://<NAS내부IP>:8080` 접속 → 상태 페이지가 보이면 성공.

> 8080 포트가 다른 서비스와 겹치면 `.env` 에 `HOST_PORT=9101` 처럼 원하는 포트를 지정하세요.
> 이 값은 아래 역방향 프록시의 **대상 포트**와 반드시 같아야 합니다.

## 4단계 — DSM 리버스 프록시로 HTTPS 연결

Tesla는 **`https://<도메인>` (443 포트)** 에서 공개키를 검증하므로 리버스 프록시가 필요합니다.

1. **제어판 → 로그인 포털 → 고급 → 역방향 프록시(Reverse Proxy) → 생성**
   - 원본(Source): HTTPS / 호스트 이름 `<내도메인>` / 포트 `443`
   - 대상(Destination): HTTP / `localhost` / 포트 `8080` (`.env` 의 `HOST_PORT` 와 동일하게)
2. **제어판 → 보안 → 인증서**: Let's Encrypt 인증서를 발급받아 해당 도메인에 연결
   - 서브도메인(`t.example.synology.me` 등)을 쓴다면 **인증서에 그 이름이 포함**되어야 합니다.
     인증서 발급 시 "주체 대체 이름"에 서브도메인을 추가하거나 별도 인증서를 발급하세요.
   - 발급 후 **인증서 설정**에서 해당 도메인에 인증서가 매핑되었는지 확인하세요.
3. 공유기에서 **443 포트 포워딩**을 NAS로 설정
4. 외부(휴대폰 LTE 등)에서 확인:

```
https://<내도메인>/.well-known/appspecific/com.tesla.3p.public-key.pem
```

PEM 텍스트(`-----BEGIN PUBLIC KEY-----`)가 보여야 합니다.

> DSM 웹 포털이 이미 443을 쓰고 있다면, 역방향 프록시 규칙이 우선 적용되므로 그대로 두면 됩니다. DSM 관리 포트(5001)와는 충돌하지 않습니다.

## 5단계 — 파트너(도메인) 등록 (최초 1회)

공개키가 외부에서 열리는 상태에서, 브라우저로 상태 페이지(`https://<내도메인>/`)에 접속해
**도메인 등록하기** 버튼을 누르세요. 결과가 바로 아래에 표시됩니다.
**등록 상태 확인** 버튼으로 Tesla에 저장된 공개키를 조회할 수 있습니다.

터미널을 선호한다면 아래와 동일합니다. (등록은 POST라 브라우저 주소창으로는 호출할 수 없습니다.)

```sh
curl -X POST https://<내도메인>/admin/register-partner
curl https://<내도메인>/admin/public-key-status
```

## 6단계 — Tesla 계정 로그인 (토큰 발급)

브라우저에서 `https://<내도메인>/auth/login` 접속 → Tesla 계정 로그인 → 권한 동의.
완료되면 토큰이 `data/tokens.json`에 저장되고 이후 자동 갱신됩니다.

## 사용 예시

```sh
# 차량 목록
curl https://<내도메인>/api/vehicles

# 차량 깨우기 (id는 위 목록의 "id" 값)
curl -X POST https://<내도메인>/api/vehicles/<id>/wake_up

# 차량 상태 (깨어 있어야 응답)
curl https://<내도메인>/api/vehicles/<id>/vehicle_data
```

## API 목록

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/` | 상태 페이지 |
| GET | `/.well-known/appspecific/com.tesla.3p.public-key.pem` | Tesla 검증용 공개키 |
| GET | `/auth/login` | Tesla OAuth 로그인 시작 |
| GET | `/auth/callback` | OAuth 콜백 (Tesla가 호출) |
| POST | `/auth/logout` | 저장된 토큰 삭제 |
| POST | `/admin/register-partner` | 도메인 파트너 등록 |
| GET | `/admin/public-key-status` | Tesla에 등록된 공개키 확인 |
| GET | `/api/vehicles` | 차량 목록 |
| GET | `/api/vehicles/:id/vehicle_data` | 차량 상세 상태 |
| POST | `/api/vehicles/:id/wake_up` | 차량 깨우기 |
| POST | `/api/vehicles/:id/command/:command` | 차량 명령 (서명 프록시 경유, ID·VIN 모두 가능) |
| GET | `/healthz` | 헬스체크 |

`/.well-known/...`, `/auth/callback`, `/healthz` 를 제외한 모든 경로는 API 키가 필요합니다.

## 7단계 — 차량 명령 (잠금/공조/충전)

문 잠금이나 공조 같은 **명령**은 Tesla가 개인키 서명을 요구합니다.
`docker-compose.yml` 에 포함된 `tesla-http-proxy`
([Tesla 공식 vehicle-command](https://github.com/teslamotors/vehicle-command))가 이 서명을 담당합니다.

프록시는 `data/keys/private-key.pem` 을 그대로 사용하므로 키 설정은 필요 없습니다.

서버는 도커 내부 네트워크(`https://tesla-http-proxy:4443`)로 프록시에 접근합니다.
`.env` 의 `PROXY_HOST_PORT`(기본 9102)로 호스트에도 포트를 열 수 있는데, 이는 직접 확인·디버깅용입니다.

> **이 포트에는 역방향 프록시나 공유기 포트포워딩을 연결하지 마세요.**
> 프록시에는 이 서버의 API 키 인증이 적용되지 않고 Tesla 액세스 토큰만으로 명령을 받습니다.
> 외부에 노출할 이유가 없으며, 필요 없다면 `docker-compose.yml` 에서 `ports` 를 지워도 정상 동작합니다.

### 가상 키 등록 (차량마다 한 번)

Tesla 앱(4.27.3 이상)이 설치된 휴대폰에서 아래 링크를 열고 차량에서 승인하세요.

```
https://tesla.com/_ak/<내도메인>
```

이 절차를 건너뛰면 명령이 권한 오류로 실패합니다. 조회 기능에는 영향이 없습니다.

### 사용법 — 도우미 스크립트

NAS에서는 `scripts/cmd.sh` 가 API 키와 포트를 `.env`(또는 `data/api-key.txt`)에서 읽어
대신 호출해 줍니다. 키를 직접 입력할 일이 없습니다.

```sh
./scripts/cmd.sh <차량ID 또는 VIN> <명령> [JSON 본문]
```

```sh
./scripts/cmd.sh 5YJ3E1EB8LF727066 wake                        # 깨우기
./scripts/cmd.sh 5YJ3E1EB8LF727066 door_unlock                 # 문 열기
./scripts/cmd.sh 5YJ3E1EB8LF727066 door_lock                   # 문 잠그기
./scripts/cmd.sh 5YJ3E1EB8LF727066 set_charge_limit '{"percent":80}'
```

`wake` 는 서명이 필요 없는 `wake_up` 엔드포인트로, 나머지는 서명 프록시로 전달됩니다.

### 사용법 — 직접 호출

```sh
# 문 잠금
curl -X POST -H "X-API-Key: <API_KEY>" \
  https://<내도메인>/api/vehicles/<차량ID 또는 VIN>/command/door_lock

# 충전 한도 80%
curl -X POST -H "X-API-Key: <API_KEY>" -H "Content-Type: application/json" \
  -d '{"percent":80}' \
  https://<내도메인>/api/vehicles/<차량ID 또는 VIN>/command/set_charge_limit
```

프록시 자체는 VIN만 받지만, 서버가 차량 ID를 VIN으로 자동 변환하므로 **둘 중 아무거나** 넣어도 됩니다.

자주 쓰는 명령: `door_lock`, `door_unlock`, `auto_conditioning_start`, `auto_conditioning_stop`,
`set_temps`, `charge_start`, `charge_stop`, `set_charge_limit`, `flash_lights`, `honk_horn`.
목록에 없는 명령도 그대로 전달되므로 Fleet API 문서의 다른 명령도 사용할 수 있습니다.

### 명령이 실패할 때

| 증상 | 원인 |
|---|---|
| `프록시 인증서를 찾을 수 없습니다` | `tesla-http-proxy` 컨테이너 미실행 → `docker-compose ps` 확인 |
| 권한/서명 오류 | 가상 키 미등록 → 위 `tesla.com/_ak/...` 링크로 등록 |
| 응답 시간 초과 | 차량 절전 상태 → `wake_up` 후 재시도 |
| `unauthorized` | 개발자 포털에서 `vehicle_cmds` 권한 미선택 → 권한 추가 후 재로그인 |

## 접근 제어 (API 키)

서버는 인터넷에 노출되므로 아래 세 경로를 제외한 **모든 요청에 API 키를 요구**합니다.
이 세 경로는 Tesla가 직접 호출하거나 상태 확인용이라 열려 있어야 합니다.

- `/.well-known/appspecific/com.tesla.3p.public-key.pem` — Tesla가 공개키를 가져감
- `/auth/callback` — Tesla가 로그인 후 브라우저를 되돌림 (`state` 값으로 별도 검증)
- `/healthz` — 헬스체크

### 키 확인

`.env` 의 `API_KEY` 를 비워두면 첫 실행 시 자동 생성됩니다.

```sh
sudo docker exec tesla-fleet-api cat /data/api-key.txt
```

컨테이너 로그(`docker-compose logs`)에도 접속용 주소가 함께 출력됩니다.

### 사용법

**브라우저** — 아래 주소로 한 번 접속하면 쿠키가 저장되어 이후에는 그냥 도메인만 입력하면 됩니다.
키는 주소창에 남지 않도록 접속 직후 제거됩니다.

```
https://<내도메인>/?key=<API_KEY>
```

**터미널** — `X-API-Key` 헤더를 함께 보냅니다.

```sh
curl -H "X-API-Key: <API_KEY>" https://<내도메인>/api/vehicles
```

키를 바꾸려면 `.env` 의 `API_KEY` 에 새 값을 넣고 `docker-compose up -d --force-recreate` 하세요.
(자동 생성된 키를 새로 만들려면 `data/api-key.txt` 를 지우고 재시작하면 됩니다.)

## 보안 주의사항

- `data/` 폴더(개인키, 토큰, API 키)는 절대 git에 커밋하거나 외부에 공유하지 마세요.
- API 키가 유출되면 차량 위치 조회와 깨우기가 가능해집니다. 유출이 의심되면 즉시 교체하세요.

## 문제 해결

| 증상 | 원인/해결 |
|---|---|
| 파트너 등록 시 412/424 오류 | 공개키 URL이 외부에서 안 열림 → 4단계(포트포워딩·인증서) 재확인 |
| 공개키 URL이 404 | 리버스 프록시가 `/.well-known/` 경로를 가로채는 경우 → DSM 규칙 확인 |
| `login_required` 오류 | 토큰 만료/폐기 → `/auth/login` 재로그인 |
| `vehicle unavailable` | 차량이 슬립 상태 → `wake_up` 후 수 초 뒤 재시도 |
| 콜백에서 redirect_uri 오류 | 개발자 포털의 Redirect URI가 `https://<도메인>/auth/callback`과 정확히 일치하는지 확인 |
| 도메인을 바꿨더니 인증 실패 | 개발자 포털의 출처 URL·리디렉션 URI, `.env` 의 `TESLA_DOMAIN`, 인증서, 역방향 프록시 4곳을 모두 새 도메인으로 맞춰야 합니다 |
| 502 Bad Gateway | 역방향 프록시의 대상 포트와 `.env` 의 `HOST_PORT` 불일치 → 두 값을 동일하게 |
| `unknown shorthand flag: 'd'` | 구버전 Docker 패키지 → `docker compose` 대신 `docker-compose` 사용 |
| `Bind mount failed: ... /data does not exist` | 프로젝트 폴더에서 `mkdir -p data` 실행 후 다시 기동 |
