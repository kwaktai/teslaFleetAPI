# T-2CAN FD CAN 로거

차에 꽂아 두고 Vehicle(A)·Chassis(B) 버스를 **듣기만** 한 뒤, 나중에 PC나 폰에서 CSV 로 확인합니다. **송신하지 않습니다.**

## 보드에 올리기

Arduino IDE, 이전과 같은 설정입니다.

- 보드: `ESP32S3 Dev Module`
- USB CDC On Boot: Enabled
- Flash Size: 16MB
- Partition Scheme: **16M Flash (3MB APP/9.9MB FATFS)** ← 로그를 여기에 씁니다
- PSRAM: OPI PSRAM

`t2can-logger.ino` 를 열고 업로드합니다. `mcp2518fd_can.h` 는 이미 복사한 Longan_CANFD 가 있어야 합니다.

시리얼 115200 에서 `CAN A listen-only 500k OK` 가 보이면 됩니다.

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

로그는 보드 플래시에 CSV 로 쌓입니다. (`ms,bus,id,dlc,data`)  
파일이 약 3MB 가 되면 한 칸 돌리고, 최신 약 6MB 만 남깁니다. 버스가 바쁘면 **수십 분이면 한 바퀴** 돕니다. 오래 남기려면 아래 2번(실시간 PC 저장)을 쓰세요.

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

### 2) 주행 중 PC 에 바로 저장 (용량 제한 없음)

보드 USB 를 노트북에 꽂은 채:

```bat
python pull_log.py --port COM5 --live
```

Ctrl+C 로 멈춥니다.

### 3) 폰/노트북 Wi-Fi 로 받기

보드가 AP 를 켭니다.

- SSID: `T2CAN-LOG`
- 암호: `teslalog1`
- 브라우저: http://192.168.4.1/log.csv

시리얼에서 `WIFI OFF` / `WIFI ON` 으로 끌 수 있습니다.

## CSV 보기

```
ms,bus,id,dlc,data
10234,A,3A1,8,11 00 02 00 00 00 00 4A
10235,B,101,8,...
```

- `bus=A` : Vehicle (9/10) — 창문 `119`, 기어 `229`, 와이퍼 `249`/`3F5`, 착좌 `3A1`
- `bus=B` : Chassis (13/14)

## 주의

- listen-only 입니다. 창문/기어 주입 코드가 아닙니다.
- 플래시는 순환이라 **아주 긴 주행의 처음부터 끝까지**는 못 남깁니다. 전체가 필요하면 `--live` 또는 Wi-Fi 를 중간에 받으세요.
- `CLEAR` 는 보드 안 로그를 지웁니다.
