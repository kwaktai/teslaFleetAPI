import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const KEEP_DAYS = 60;

function dir() {
  return path.join(config.dataDir, 'canlog');
}

function dayPath(day) {
  return path.join(dir(), `${day}.csv`);
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function isDayName(name) {
  return /^\d{4}-\d{2}-\d{2}\.csv$/.test(name);
}

function pruneOld() {
  const files = fs.readdirSync(dir()).filter(isDayName).sort();
  const extra = files.length - KEEP_DAYS;
  for (let i = 0; i < extra; i++) {
    fs.unlinkSync(path.join(dir(), files[i]));
  }
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
      return { day, bytes: st.size, updatedAt: st.mtime.toISOString() };
    });
}

export function saveCanlog(body) {
  fs.mkdirSync(dir(), { recursive: true });
  const text = typeof body === 'string' ? body : String(body ?? '');
  const day = todayKey();
  const file = dayPath(day);
  const fresh = !fs.existsSync(file) || fs.statSync(file).size === 0;
  if (fresh && !text.startsWith('ms,')) {
    fs.writeFileSync(file, 'ms,bus,id,dlc,data\n');
  }
  fs.appendFileSync(file, text);
  pruneOld();
  const bytes = fs.statSync(file).size;
  return { day, bytes, updatedAt: new Date().toISOString() };
}

export function readDay(day) {
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
        `<td>${new Date(row.updatedAt).toLocaleString('ko-KR')}</td></tr>`
    )
    .join('');
  return `<!doctype html>
<meta charset="utf-8">
<title>T-2CAN 로그</title>
<style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 16px;line-height:1.6}
code{background:#eee;padding:2px 6px;border-radius:4px}
table{border-collapse:collapse}td,th{padding:6px 12px 6px 0;text-align:left}</style>
<h1>T-2CAN 로그</h1>
<p>보드가 차 Wi-Fi에서 일괄로 올린 CSV입니다. 날짜별 파일이 곧 DB입니다.
구글 시트에는 넣지 않습니다. 셀이 바로 차고, 초당 수백 프레임을 감당하지 못합니다.</p>
<p>${
    days.length
      ? `${days.length}일 보관 (최대 ${KEEP_DAYS}일)`
      : '아직 없습니다. 보드 시리얼에서 <code>PUSH URL</code> / <code>PUSH KEY</code> / <code>PUSH AUTO ON</code>'
  }</p>
<table><tr><th>날짜</th><th>크기</th><th>마지막 업로드</th></tr>${rows}</table>
<p><a href="/">서버 홈</a></p>`;
}
