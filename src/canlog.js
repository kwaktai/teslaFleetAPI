import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const KEEP_DAYS = 60;
const SEOUL = 'Asia/Seoul';

function todayKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatSeoul(d) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: SEOUL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(d));
}

function dir() {
  return path.join(config.dataDir, 'canlog');
}

function dayPath(day) {
  return path.join(dir(), `${day}.csv`);
}

// 보드의 기기 동작 로그(부팅·Wi-Fi·PUSH 결과·CAN 진단). CSV 와 별도 파일.
function eventPath(day) {
  return path.join(dir(), `events-${day}.log`);
}

function isDayName(name) {
  return /^\d{4}-\d{2}-\d{2}\.csv$/.test(name);
}

function isEventName(name) {
  return /^events-\d{4}-\d{2}-\d{2}\.log$/.test(name);
}

function isValidDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day);
}

function pruneOld() {
  for (const filter of [isDayName, isEventName]) {
    const files = fs.readdirSync(dir()).filter(filter).sort();
    const extra = files.length - KEEP_DAYS;
    for (let i = 0; i < extra; i++) {
      fs.unlinkSync(path.join(dir(), files[i]));
    }
  }
}

export function listEventDays() {
  if (!fs.existsSync(dir())) {
    return [];
  }
  return fs
    .readdirSync(dir())
    .filter(isEventName)
    .sort()
    .reverse()
    .map((name) => {
      const day = name.slice(7, 17);
      const st = fs.statSync(path.join(dir(), name));
      return { day, bytes: st.size, updatedAt: formatSeoul(st.mtime) };
    });
}

export function saveEvents(body) {
  fs.mkdirSync(dir(), { recursive: true });
  const text = typeof body === 'string' ? body : String(body ?? '');
  const day = todayKey();
  const file = eventPath(day);
  fs.appendFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
  pruneOld();
  return { day, bytes: fs.statSync(file).size, updatedAt: formatSeoul(new Date()) };
}

export function readEvents(day) {
  const days = listEventDays();
  const pick = day || (days.length ? days[0].day : '');
  if (!isValidDay(pick)) {
    return null;
  }
  const file = eventPath(pick);
  if (!fs.existsSync(file)) {
    return null;
  }
  return fs.readFileSync(file, 'utf8');
}

export function listDays() {
  if (!fs.existsSync(dir())) {
    return [];
  }
  return fs
    .readdirSync(dir())
    .filter(isDayName)
    .sort()
    .reverse()
    .map((name) => {
      const day = name.slice(0, 10);
      const st = fs.statSync(path.join(dir(), name));
      return { day, bytes: st.size, updatedAt: formatSeoul(st.mtime) };
    });
}

export function saveCanlog(body) {
  fs.mkdirSync(dir(), { recursive: true });
  const text = typeof body === 'string' ? body : String(body ?? '');
  const day = todayKey();
  const file = dayPath(day);
  const fresh = !fs.existsSync(file) || fs.statSync(file).size === 0;
  if (fresh && !text.startsWith('ms,') && !text.startsWith('time,')) {
    fs.writeFileSync(file, 'time,ms,bus,id,dlc,data\n');
  }
  fs.appendFileSync(file, text);
  pruneOld();
  const bytes = fs.statSync(file).size;
  return { day, bytes, updatedAt: formatSeoul(new Date()) };
}

export function readDay(day) {
  if (!isValidDay(day)) {
    return null;
  }
  const file = dayPath(day);
  if (!fs.existsSync(file)) {
    return null;
  }
  return fs.readFileSync(file, 'utf8');
}

export function readLatest() {
  const days = listDays();
  if (!days.length) {
    return null;
  }
  return readDay(days[0].day);
}

export function readMeta() {
  const days = listDays();
  if (!days.length) {
    return null;
  }
  const total = days.reduce((sum, row) => sum + row.bytes, 0);
  return { updatedAt: days[0].updatedAt, bytes: days[0].bytes, days: days.length, total };
}

export function renderCanlogPage() {
  const days = listDays();
  const rows = days
    .map(
      (row) =>
        `<tr><td><a href="/api/canlog?day=${row.day}">${row.day}</a></td>` +
        `<td>${row.bytes.toLocaleString()} bytes</td>` +
        `<td>${row.updatedAt}</td></tr>`
    )
    .join('');
  const eventDays = listEventDays();
  const eventRows = eventDays
    .map(
      (row) =>
        `<tr><td><a href="/api/canlog?kind=events&day=${row.day}">${row.day}</a></td>` +
        `<td>${row.bytes.toLocaleString()} bytes</td>` +
        `<td>${row.updatedAt}</td></tr>`
    )
    .join('');
  return `<!doctype html>
<meta charset="utf-8">
<title>T-2CAN 로그</title>
<style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 16px;line-height:1.6}
code{background:#eee;padding:2px 6px;border-radius:4px}
table{border-collapse:collapse}td,th{padding:6px 12px 6px 0;text-align:left}</style>
<h1>T-2CAN 로그</h1>
<p>보드가 차 Wi-Fi에서 일괄로 올린 CSV입니다. 날짜·표시는 <strong>한국시간(KST)</strong>입니다.
구글 시트에는 넣지 않습니다.</p>
<p>${
    days.length
      ? `${days.length}일 보관 (최대 ${KEEP_DAYS}일)`
      : '아직 없습니다. 보드 시리얼에서 <code>PUSH URL</code> / <code>PUSH KEY</code> / <code>PUSH AUTO ON</code>'
  }</p>
<table><tr><th>날짜 (KST)</th><th>크기</th><th>마지막 업로드 (KST)</th></tr>${rows}</table>
<h2>기기 동작 로그</h2>
<p>보드가 1분마다 남기는 상태(<code>hb</code>)와 부팅·재시작 원인, Wi-Fi 연결/끊김, PUSH 성공·실패,
CAN A 진단 판정입니다. CSV 가 안 커질 때 여기서 이유를 봅니다. 보드 시리얼에서는 <code>LOG</code>.</p>
${
  eventDays.length
    ? `<table><tr><th>날짜 (KST)</th><th>크기</th><th>마지막 업로드 (KST)</th></tr>${eventRows}</table>`
    : '<p>아직 없습니다. 보드가 Wi-Fi 에 붙으면 CSV 와 함께 올라옵니다.</p>'
}
<p><a href="/">서버 홈</a></p>`;
}
