# T-2CAN FD CAN 로거

차에 꽂아 두고 Vehicle(A)·Chassis(B) 버스를 **듣기만** 한 뒤, 나중에 PC나 폰에서 CSV 로 확인합니다. **송신하지 않습니다.**

## 보드에 올리기

**파일 → 열기**로 항상 `t2can-logger/t2can-logger.ino` 만 여세요.  
`2CAN_FD.ino` 같은 다른 스케치를 열면 IDE가 보드 설정을 기본값(4MB, CDC 꺼짐)으로 되돌립니다.

같은 폴더의 `sketch.yaml` 에 T-2CAN FD 설정이 들어 있습니다. Arduino IDE 2.3 이상이면 스케치를 열었을 때 프로필 `t2can-fd` 를 고르면 됩니다.

수동으로 맞출 때:

- 보드: `ESP32S3 Dev Module`
- USB CDC On Boot: Enabled
- Flash Size: 16MB
- Partition Scheme: **16M Flash (3MB APP/9.9MB FATFS)** ← 로그를 여기에 씁니다
- PSRAM: OPI PSRAM

한 번 맞춘 뒤에는 **같은 `t2can-logger.ino` 만** 다시 열면 IDE가 그 설정을 기억합니다.

코드를 최신으로 받을 때는 폴더를 바꾸지 말고 덮어쓰세요. Arduino IDE는 닫고:

Windows (이 폴더에서 PowerShell):

```bat
cd C:\Users\taikwak\Documents\Arduino\2CAN_FD\teslaFleetAPI-cursor-t2can-can-logger-5292\t2can-logger
powershell -ExecutionPolicy Bypass -File .\update-from-github.ps1
```

맥:

```sh
bash t2can-logger/update-from-github.sh
```

대상이 다르면 경로를 인자로 줍니다. 저장소 루트를 덮어씁니다. `t2can-logger`만 넘기면 위를 씁니다. `canlog-*.csv`, `data/`, `.env` 는 지우지 않습니다.

`mcp2518fd_can.h` 는 `Arduino/libraries/Longan_CANFD` 가 있어야 합니다.

시리얼 115200 에서 `CAN A MCP2518FD listen-only 500k OK` 가 보이면 됩니다.

CAN 수신은 [chlsw88/T-CAN2](https://github.com/chlsw88/T-CAN2) 채널 구조를 참고했습니다. **송신은 하지 않습니다.** `STAT`의 `rateA`/`rateB`는 최근 5초 프레임 수입니다.

수신은 별도 태스크가 하고, 줄은 PSRAM 큐(512KB)에 쌓인 뒤 플래시로 갑니다. Wi-Fi 스캔이나 NAS 업로드로 메인 루프가 몇 초 멈춰도 프레임을 잃지 않습니다. `STAT`의 `B missed`가 0이 아니면 그래도 놓친 겁니다.

## 차 연결 (A+B)

DIP 종단은 **OFF**. 섹시커맨더는 뽑지 말고 Y분기.

| X437 | 신호 | 보드 |
|---|---|---|
| 1 | VBATT | 12–24V + |
| 9 | VH CAN P | CANHA |
| 10 | VH CAN N | CANLA |
| 13 | CH CAN P | CANHB |
| 14 | CH CAN N | CANLB |
| 20 | GND | SGNDA, SGNDB, 12–24V GND |

USB 와 차 전원을 같이 쓰면 노트북은 배터리만 권장합니다.

## 나중에 데이터 보는 방법

로그는 보드 플래시에 CSV 로 쌓입니다. (`time,ms,bus,id,dlc,data`, 한국시간)  
파일이 약 3MB 가 되면 한 칸 돌리고, 최신 약 6MB 만 남깁니다. 차 Wi-Fi 가 붙어 있으면 밀린 만큼 계속 NAS 로 올리므로 NAS 쪽에는 전부 남고, 보드 안에는 최근 몇 분만 남습니다. Wi-Fi 없이 오래 남기려면 `LOG RATE` 를 늘리거나 아래 2번(실시간 PC 저장)을 쓰세요.

### 기록 간격 — `LOG RATE` (왜 전부는 못 남기나)

Tesla Chassis 버스(B, 13/14)는 500kbps 가 거의 꽉 차 있습니다. 실측 **초당 3,000~4,400 프레임**, CSV 텍스트로 **200KB/s 이상**입니다. 보드 플래시는 4KB 섹터를 지우고 쓰는 데 50ms 쯤 걸려 아무리 잘해도 **60KB/s 정도**가 한계고, 차 LTE 업로드도 그 언저리입니다. 그래서 전부 쓰려 들면 큐가 넘쳐 `drop` 이 프레임보다 많아지고, 2026-09-09 로그처럼 20~60초마다 재시작했습니다.

펌웨어는 **같은 CAN ID 를 100ms(10Hz) 에 한 번만** 기록합니다(기본). 184개 ID 기준 초당 약 1,100 프레임 ≈ 65KB/s 로, 기어·창문·탑승자·FSD 상태처럼 "값이 바뀌는" 신호는 놓치지 않습니다(바뀐 뒤 늦어도 0.1초 안에 기록). 조향각처럼 100Hz 이상으로 오는 것은 10Hz 로 샘플링됩니다.

```
LOG RATE          현재 값과 건너뛴 수
LOG RATE 200      5Hz  (Wi-Fi 없이 오래 담을 때, ~38KB/s)
LOG RATE 50       20Hz (~100KB/s, 플래시가 못 따라가 drop 생김)
LOG RATE 0        전부 (테스트용, 곧 drop·재시작)
```

`hb` 줄에서 확인: `B+NNNN` 받은 프레임, `skip=` 간격 제한으로 건너뛴 수, `drop=` 큐가 넘쳐 잃은 수(0 이어야 함), `q=NN%` 큐 사용률, `wr=NNKB/s` 플래시 쓰기 속도. `drop` 이 계속 늘면 `LOG RATE` 를 늘리세요.

### 1) USB 로 보드에 쌓인 파일 받기 (주행 후)

1. 보드를 PC USB 에 연결
2. 시리얼 모니터에서 `DUMP` 입력 후 `---LOG-BEGIN---` ~ `---LOG-END---` 를 복사하거나
3. Windows PowerShell:

```bat
cd t2can-logger
pip install -r requirements.txt
python pull_log.py --port COM5
```

`canlog-날짜.csv` 가 생깁니다. Excel, 메모장, [SavvyCAN](https://www.savvycan.com) 에서 열면 됩니다.

다른 명령: `STAT` 상태, `CLEAR` 로그 삭제, `ECHO ON` 실시간 출력.

### 기기 동작 로그 (CSV 가 안 커질 때)

CAN 프레임과 별도로 보드가 자기 동작을 `/events.log` 에 남깁니다.

- `boot reset=... raw=N` 부팅과 **재시작 원인** (`poweron`, `BROWNOUT` 전원 부족, `PANIC` 크래시, `WDT`, `usb` 는 PC 가 시리얼 포트를 열어 리셋한 것). `raw` 는 칩이 보고한 원래 코드 (1 poweron, 15 brownout, 19 clock glitch, 21/22 usb, 23 power glitch) — `unknown` 일 때 구분용. `poweron` 인데 `(RTC 메모리 유지 → 완전 정전 아님)` 이 붙으면 전원이 완전히 나간 게 아니라 리셋핀 또는 순간 전압 저하로 재시작한 것입니다.
- `!! N boot(s) before this one died before writing the log (reasons: ...)` 이 부팅 앞에 **로그 한 줄도 못 쓰고 죽은 부팅**이 N 번 있었다는 뜻 (부팅 후 2초 안에 다시 리셋되면 events.log 에 아무것도 안 남으므로 RTC 메모리로 셉니다). 전원을 꽂을 때마다 여러 번 리셋되는 전원 문제가 여기서 드러납니다.
- `CRASH task=... pc=0x... cause=...` / `CRASH bt: ...` 직전 부팅이 크래시였으면 어느 태스크가 어디서 죽었는지 (코어덤프 요약). 이 두 줄을 그대로 전달하면 함수명으로 풀 수 있습니다.
- `LAST RUN ended in loop=FLASH WRITE (up=83.412s) push=TLS POST csv ...` 재시작 직전에 loop 와 업로드 태스크가 각각 무엇을 하던 중이었는지 (RTC 메모리에 남긴 것). 플래시 쓰기 중에 죽으면 코어덤프가 안 남는데, 이 줄은 남습니다.
- `CAN B traffic start / stop` 차가 깨어나 버스가 살고, 잠들어 조용해진 시점
- `sta join / sta ok / sta lost` Wi-Fi 연결·끊김 (IP, 신호세기, 게이트웨이, DNS). `sta lost` 는 4초 넘게 끊겨 있을 때만 찍힙니다.
- `wifi LINK DOWN #n reason=200 BEACON_TIMEOUT ... / wifi link up ap=... ch=... / wifi got ip` Wi-Fi **드라이버 수준**의 끊김·재접속. 몇 초 안에 저절로 다시 붙는 짧은 끊김은 `sta lost` 로는 안 보이고 여기서만 보입니다. `reason` 이 8(`ASSOC_LEAVE`)이면 보드가 스스로 끊은 것(망 전환·재접속 명령), 200(`BEACON_TIMEOUT`)/201(`NO_AP_FOUND`)이면 AP 신호가 사라진 것, 2/3/4 면 AP 쪽이 끊은 것, 15/202 는 비밀번호·인증 문제입니다. `(1분 안에 또)` 는 직전 끊김 뒤 1분이 안 됐다는 표시.
- `push ok / push FAIL http 401 / push FAIL connection refused` NAS 업로드 결과 (`(backlog)` 는 아직 더 올릴 게 남았다는 뜻)
- `hb ...` 부팅 20초 뒤 한 번, 그 뒤 1분마다: 지난 구간 A/B 프레임 수, `skip`(간격 제한), `drop`(큐 넘침), `q`(큐 사용률), `wr`(플래시 쓰기 KB/s), 파일 크기, Wi-Fi(`wifi_down` 은 이 부팅 뒤 드라이버 끊김 누계), PUSH 성공/실패 누계와 올린 위치, 힙
- `A chip=... → 판정` 1분마다 CAN A(MCP2518FD) 레지스터 진단 (아래)

꺼내는 방법 세 가지:

| 방법 | 어떻게 |
|---|---|
| 시리얼 | `LOG` (최근), `LOG ALL` (전체), `LOG CLEAR` |
| PC | `python pull_log.py --port COM5 --events` → `t2can-events-날짜.log` |
| 웹 | `http://192.168.4.1/events.log` (보드 AP) 또는 NAS `/canlog` 페이지 아래 "기기 동작 로그" |

NAS 에는 CSV 와 함께 자동으로 올라갑니다(`?kind=events`, `events-날짜.log`). 어제처럼 CSV 가 안 커졌으면 이 로그의 `hb` 줄에서 **Wi-Fi 가 붙어 있었는지, PUSH 가 실패했는지(코드), A/B 프레임이 들어오긴 했는지**가 바로 갈립니다.

### 플래시가 안 써질 때 — `FS` / `FORMAT`

`STAT` 에 `write_fail>0` 이거나 `/canlog0.csv bytes=0` 이 계속되면 플래시 파일시스템이 깨졌거나 꽉 찬 겁니다(차에서 전원이 갑자기 끊길 때 생길 수 있음). 부팅 때 자동으로 쓰기 테스트를 하고, 실패하면 다시 마운트 → 그래도 안 되면 **자동 포맷**합니다(`boot ... (FORMATTED this boot)`). 수동으로는 `FS`(파일 목록·빈 공간·쓰기 테스트), `FORMAT`(초기화, 보드 안 로그 전부 삭제). NAS 에 올라간 것은 남습니다.

### CAN A 가 조용할 때 — `CANA`

시리얼에 `CANA` 를 치면(`STAT` 에도 포함) MCP2518FD 레지스터를 직접 읽어 한 줄로 판정합니다.

| 판정 | 뜻 | 확인할 것 |
|---|---|---|
| `칩 응답 없음(SPI)` | 컨트롤러가 SPI 에 답하지 않음 | 보드 불량, 전원 |
| `리슨온리 아님` | 모드 설정 실패 | 펌웨어 다시 올리기 |
| `버스 신호 없음` | 에러도 프레임도 0 | **9/10 배선·커넥터**, 또는 차가 잠들어 그 버스가 조용함 |
| `신호는 있는데 프레임 오류` | stuff/form/crc 에러가 늘어남 | 속도(500k) 불일치, **H/L 바뀜** |
| `칩은 프레임을 받는데 FIFO 못 읽음` | `efmsg` 는 늘고 `frames` 는 0 | 드라이버 문제 — 이 줄을 그대로 알려주세요 |
| `정상 수신` | 프레임이 들어옴 | — |

참고: 예전 `CAN A ... OK` 는 라이브러리가 항상 OK 를 돌려줘서 의미가 없었습니다. 이제는 실제로 리슨온리 모드에 들어갔는지 레지스터로 확인한 뒤에만 OK 를 찍습니다.

### 2) 주행 중 PC 에 바로 저장 (용량 제한 없음)

보드 USB 를 노트북에 꽂은 채:

```bat
python pull_log.py --port COM5 --live
```

Ctrl+C 로 멈춥니다.

### 3) 차 안 Wi-Fi 로 받기

보드(ESP32-S3)는 **2.4GHz 만** 됩니다. 이름이 `Raven_5G` 여도, 그 SSID 가 2.4GHz 로도 나와야 붙습니다. 5GHz 전용이면 연결이 안 됩니다.

**한 번만** 시리얼 모니터(115200)에서 차 Wi-Fi를 저장합니다. SSID·암호 대소문자는 그대로 씁니다.

```
WIFI JOIN Raven_5G 여기에암호
```

붙으면 이런 줄이 나옵니다.

```
STA OK  http://192.168.x.x/log.csv
mDNS  http://t2can.local/log.csv
```

폰/노트북도 **같은 차 Wi-Fi**에 연결한 뒤 그 주소로 엽니다.

`WIFI JOIN` 은 **추가**입니다. 이미 저장된 차 Wi-Fi를 지우지 않습니다. 최대 4개. 보이는 망 중 저장된 SSID를 골라 붙습니다.

집 Wi-Fi 예:

```
WIFI JOIN Kana_Home 여기에암호
WIFI LIST
```

`WIFI FORGET <ssid>` 로 빼면 됩니다. 암호는 보드에만 저장하세요. GitHub 에 올리지 마세요.

**우선순위는 `WIFI LIST` 의 순서**입니다. 보이는 망 중 가장 위의 것에 붙습니다(신호세기가 아님). `WIFI FIRST <ssid>` 로 맨 앞으로 옮깁니다. 처음엔 차 공유기(`wifi_secrets.h` 의 `WIFI_SSID_DEFAULT`, 기본 `Raven_5G`)가 맨 앞입니다. 낮은 순위 망에 붙어 있으면 5분마다 조용히 스캔해서 최우선 망이 보이면(-80dBm 이상) 갈아탑니다 — 집 Wi-Fi 에 붙어 있다가 차 공유기가 켜질 때를 위한 것입니다.

전원을 껐다 켜도 목록을 다시 찾습니다. **끊기면** 저장된 망을 모두 찾고, **붙으면 검색을 멈춥니다.** 막 붙은 직후 수 초는 검색하지 않아서, DHCP가 흔들려도 다른 망으로 넘어가지 않습니다. 부팅 때 망이 꺼져 있으면 보드 AP(`T2CAN-LOG`)를 켜 두고 저장된 망을 다시 찾습니다.

안 붙으면:

1. `WIFI SCAN` — 보드가 보이는 **2.4GHz** 목록
2. 목록에 있는 이름(예: `Raven`, `Raven_2.4G`)으로 다시 `WIFI JOIN`
3. 그래도 안 되면 `WIFI AP` 로 보드가 만드는 망을 씁니다
   - SSID: `T2CAN-LOG` / 암호: `teslalog1`
   - http://192.168.4.1/log.csv

스케치 맨 위 `WIFI_PASS_DEFAULT` 에 암호를 넣고 업로드해도 됩니다. **공개 GitHub에는 암호를 올리지 마세요.**

`WIFI OFF` / `WIFI ON` / `WIFI LIST` / `STAT`(할당된 IP·저장된 SSID 확인) 도 됩니다. 붙었다 끊긴 이력은 `LOG` 로 봅니다.

### 4) 원격에서 보기 (Tailscale은 보드에 올리지 않습니다)

T-2CAN(ESP32-S3)에는 **공식 Tailscale을 설치할 수 없습니다.** Arduino 스케치와 같이 쓰면 CAN 수신이 끊길 수 있습니다.

원격으로 편히 보려면 아래 중 하나를 씁니다.

**A. 시놀로지에 날짜별 파일로 모은 뒤 일괄 업로드 (추천)**  

CAN 은 초당 수백 줄이라 구글 시트에 바로 넣으면 셀이 금방 차고 느려집니다.  
보드는 플래시에 잠깐 쌓고, 차 Wi-Fi가 있을 때 **새로 생긴 구간만** NAS 로 올립니다. NAS 의 `YYYY-MM-DD.csv` 가 DB 입니다 (최대 60일).

```
PUSH URL https://<내도메인>/api/canlog
PUSH KEY <시놀로지 API_KEY>
PUSH NOW
PUSH AUTO ON
```

브라우저: `https://<내도메인>/canlog` — 날짜별 다운로드  
`PUSH AUTO ON` 이면 업로드 태스크가 따로 돌며(다른 코어) 밀린 게 있는 동안 64KB 씩 계속 올리고, 다 올렸으면 1분마다 확인합니다. 이미 보낸 부분은 다시 안 보내고, 줄 중간에서 끊지 않습니다. 업로드가 몇 초 걸려도 CAN 기록은 멈추지 않습니다.

#### 시놀로지에서 할 일

새 포트나 새 역방향 프록시는 **필요 없습니다.** 이미 Tesla Fleet API 용으로 열어 둔 `https://<내도메인>` 이 `/canlog` 도 받습니다.

1. 시놀로지 SSH 또는 File Station에서 서버 폴더를 이 브랜치 내용으로 맞춥니다.  
   예: `/volume1/docker/tesla-fleet-api`
2. Container Manager에서 해당 프로젝트를 **다시 빌드** 하거나 SSH에서:

```sh
cd /volume1/docker/tesla-fleet-api
sudo docker-compose up -d --build
```

3. API 키를 확인합니다.

```sh
sudo docker exec tesla-fleet-api cat /data/api-key.txt
```

`.env` 에 `API_KEY` 를 넣어 두었다면 그 값입니다.

4. 집 밖에서(LTE) 브라우저로 한 번 엽니다.

```
https://<내도메인>/?key=<API_KEY>
https://<내도메인>/canlog
```

첫 주소는 쿠키를 심습니다. 그다음 `/canlog` 에 “아직 없습니다”가 보이면 서버는 준비된 겁니다.

5. 보드 시리얼(차 Wi-Fi에 붙은 상태)에서:

```
PUSH URL https://<내도메인>/api/canlog
PUSH KEY <방금 확인한 API_KEY>
PUSH AUTO ON
```

로그 파일은 NAS의 `docker/tesla-fleet-api/data/canlog/` 아래 날짜별 CSV로 쌓입니다. File Station에서도 볼 수 있습니다.

차 공유기(`Raven_5G`)에 **인터넷**이 있어야 보드가 집 NAS에 닿습니다. 로컬 `http://192.168.104.189/log.csv` 는 같은 Wi-Fi에서만 됩니다.

시놀로지에 Tailscale을 켜 두면 NAS 화면을 더 편하게 열 수 있습니다. 로그 자체는 원래 HTTPS 로 열려 있습니다.

**B. 차 공유기(Raven)에 Tailscale**  
공유기가 GL.iNet / OpenWrt 처럼 Tailscale·서브넷 라우터를 지원하면, 공유기 LAN을 advertise 한 뒤 보드의 `STAT` IP 로 `http://192.168.x.x/log.csv` 를 엽니다. 보드에 VPN을 올리지 않습니다.

## CSV 보기

```
time,ms,bus,id,dlc,data
2026-09-05 13:25:52,10234,A,3A1,8,11 00 02 00 00 00 00 4A
2026-09-05 13:25:52,10235,B,101,8,...
```

`time` 은 한국시간입니다. Wi-Fi/NTP 전이면 `-` 입니다.

- `bus=A` : Vehicle (9/10) — 창문 `119`, 기어 `229`, 와이퍼 `249`/`3F5`, 착좌 `3A1`
- `bus=B` : Chassis (13/14)

## 주의

- listen-only 입니다. 창문/기어 주입 코드가 아닙니다.
- 플래시는 순환이라 **아주 긴 주행의 처음부터 끝까지**는 못 남깁니다. 전체가 필요하면 `--live` 또는 Wi-Fi 를 중간에 받으세요.
- `CLEAR` 는 보드 안 로그를 지웁니다.
