#!/usr/bin/env python3
"""T-2CAN FD 로거에서 USB 시리얼로 CSV 를 받아 PC 에 저장합니다."""

from __future__ import annotations

import argparse
import datetime as dt
import sys
import time
from pathlib import Path

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    print("pyserial 이 필요합니다.  PowerShell:  pip install pyserial")
    sys.exit(1)


def pick_port(preferred: str | None) -> str:
    if preferred:
        return preferred
    ports = list(list_ports.comports())
    if not ports:
        print("COM 포트가 없습니다. 보드 USB 를 꽂으세요.")
        sys.exit(1)
    print("포트 목록:")
    for i, p in enumerate(ports):
        print(f"  [{i}] {p.device}  {p.description}")
    return ports[0].device


def pull(port: str, out: Path, baud: int) -> None:
    print("포트 여는 중 (보드가 잠시 재시작될 수 있음)...")
    ser = serial.Serial(port, baud, timeout=1)
    time.sleep(4.0)
    ser.reset_input_buffer()
    print("DUMP 요청")
    ser.write(b"DUMP\n")
    ser.flush()

    collecting = False
    lines: list[str] = []
    deadline = time.time() + 600
    last_data = time.time()
    last_print = 0
    while time.time() < deadline:
        raw = ser.readline()
        if not raw:
            if collecting and time.time() - last_data > 8:
                print("덤프가 멈춘 것 같습니다. 받은 줄만 저장합니다.")
                break
            if not collecting and time.time() - last_data > 20:
                print("보드가 DUMP에 응답하지 않습니다. 시리얼 모니터를 닫고 다시 시도하세요.")
                break
            continue
        text = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        if text == "---LOG-BEGIN---":
            collecting = True
            lines.clear()
            last_data = time.time()
            print("받는 중...")
            continue
        if text == "---LOG-END---":
            print("DUMP 끝")
            break
        if collecting:
            lines.append(text)
            last_data = time.time()
            if len(lines) - last_print >= 2000:
                last_print = len(lines)
                print(f"  {len(lines)} 줄")

    ser.close()
    out.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    print(f"저장: {out.resolve()}  ({len(lines)} 줄)")


def pull_events(port: str, out: Path, baud: int) -> None:
    """기기 동작 로그(부팅·Wi-Fi·PUSH·CAN A 진단)를 받습니다."""
    print("포트 여는 중...")
    ser = serial.Serial(port, baud, timeout=1)
    time.sleep(4.0)
    ser.reset_input_buffer()
    print("LOG ALL 요청")
    ser.write(b"LOG ALL\n")
    ser.flush()

    collecting = False
    lines: list[str] = []
    last_data = time.time()
    while True:
        raw = ser.readline()
        if not raw:
            if time.time() - last_data > (8 if collecting else 20):
                print("응답이 멎었습니다. 받은 줄만 저장합니다.")
                break
            continue
        text = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        last_data = time.time()
        if text == "---EVT-BEGIN---":
            collecting = True
            lines.clear()
            continue
        if text == "---EVT-END---":
            break
        if collecting:
            lines.append(text)
    ser.close()
    out.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    print(f"저장: {out.resolve()}  ({len(lines)} 줄)")
    tail = lines[-15:]
    if tail:
        print("--- 마지막 15줄 ---")
        for line in tail:
            print(line)


def live(port: str, out: Path, baud: int) -> None:
    ser = serial.Serial(port, baud, timeout=1)
    time.sleep(2.0)
    ser.write(b"ECHO ON\n")
    print(f"실시간 저장 중 Ctrl+C 로 종료 → {out}")
    new_file = not out.exists() or out.stat().st_size == 0
    with out.open("a", encoding="utf-8") as fh:
        if new_file:
            fh.write("time,ms,bus,id,dlc,data\n")
        try:
            while True:
                raw = ser.readline()
                if not raw:
                    continue
                text = raw.decode("utf-8", errors="replace")
                line = text.rstrip("\r\n")
                parts = line.split(",")
                bus = ""
                if len(parts) >= 6 and parts[2] in ("A", "B"):
                    bus = parts[2]
                elif len(parts) >= 5 and parts[1] in ("A", "B"):
                    bus = parts[1]
                if not bus:
                    continue
                fh.write(line + "\n")
                fh.flush()
                sys.stdout.write(line + "\n")
        except KeyboardInterrupt:
            print("\n중지")
    ser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="T-2CAN 로그를 PC 로 가져옵니다.")
    parser.add_argument("--port", help="COM 포트. 생략하면 첫 포트를 씁니다.")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--out", help="저장 파일. 기본은 날짜시각.csv")
    parser.add_argument(
        "--live",
        action="store_true",
        help="보드에 쌓인 파일 대신, USB 로 들어오는 프레임을 바로 저장",
    )
    parser.add_argument(
        "--events",
        action="store_true",
        help="CAN 대신 기기 동작 로그(부팅·Wi-Fi·PUSH·CAN A 진단)를 받음",
    )
    args = parser.parse_args()

    port = pick_port(args.port)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    if args.events:
        out = Path(args.out) if args.out else Path(f"t2can-events-{stamp}.log")
    else:
        out = Path(args.out) if args.out else Path(f"canlog-{stamp}.csv")
    print(f"포트 {port}")
    if args.events:
        pull_events(port, out, args.baud)
    elif args.live:
        live(port, out, args.baud)
    else:
        pull(port, out, args.baud)


if __name__ == "__main__":
    main()
