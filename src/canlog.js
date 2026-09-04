import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const KEEP = 8;

function dir() {
  return path.join(config.dataDir, 'canlog');
}

function latestPath() {
  return path.join(dir(), 'latest.csv');
}

function metaPath() {
  return path.join(dir(), 'meta.json');
}

function pruneOld() {
  const files = fs
    .readdirSync(dir())
    .filter((name) => name.startsWith('canlog-') && name.endsWith('.csv'))
    .sort()
    .reverse();
  for (const name of files.slice(KEEP)) {
    fs.unlinkSync(path.join(dir(), name));
  }
}

export function saveCanlog(body, { append = false } = {}) {
  fs.mkdirSync(dir(), { recursive: true });
  const text = typeof body === 'string' ? body : String(body ?? '');
  if (append && fs.existsSync(latestPath())) {
    fs.appendFileSync(latestPath(), text.startsWith('\n') ? text : `\n${text}`);
  } else {
    fs.writeFileSync(latestPath(), text);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(dir(), `canlog-${stamp}.csv`), text);
    pruneOld();
  }
  const bytes = fs.statSync(latestPath()).size;
  const meta = { updatedAt: new Date().toISOString(), bytes };
  fs.writeFileSync(metaPath(), JSON.stringify(meta, null, 2));
  return meta;
}

export function readLatest() {
  if (!fs.existsSync(latestPath())) {
    return null;
  }
  return fs.readFileSync(latestPath(), 'utf8');
}

export function readMeta() {
  if (!fs.existsSync(metaPath())) {
    return null;
  }
  return JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
}

export function renderCanlogPage() {
  const meta = readMeta();
  const when = meta?.updatedAt ? new Date(meta.updatedAt).toLocaleString('ko-KR') : '아직 없음';
  const bytes = meta?.bytes ?? 0;
  return `<!doctype html>
<meta charset="utf-8">
<title>T-2CAN 로그</title>
<style>body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6}
code{background:#eee;padding:2px 6px;border-radius:4px}</style>
<h1>T-2CAN 로그</h1>
<p>마지막 업로드: <strong>${when}</strong> (${bytes.toLocaleString()} bytes)</p>
<p>${
    bytes
      ? `<a href="/api/canlog">latest.csv 다운로드</a>`
      : '보드에서 <code>PUSH NOW</code> 를 보내면 여기에 쌓입니다.'
  }</p>
<p><a href="/">서버 홈</a></p>`;
}
