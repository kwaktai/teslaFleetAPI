// 과속카메라 경고 페이지 (/speedcam).
//
// 경찰청 「전국 무인교통단속카메라 표준데이터」를 data/speedcam.json 으로 반입해 두면
// (scripts/import-speedcam.js 참고) 휴대폰 브라우저가 GPS 로 현재 위치·속도를 읽어
// 전방 카메라를 검사하고, 제한속도 +9 km/h 이상일 때만 차임(띵 띵 띵)을 울립니다.
// 음성 안내는 없습니다. 서버는 페이지와 카메라 DB 만 내려 주고, 판정은 전부
// 브라우저 안에서 돌므로 주행 중 서버·인터넷이 끊겨도 동작합니다.

import fs from 'node:fs';
import { config } from './config.js';

// ---------- 지오 계산 (검증을 위해 서버에서도 export) ----------

const R = 6371000; // 지구 반지름 (m)
const rad = (d) => (d * Math.PI) / 180;

// 두 좌표 사이 거리 (m)
export function distanceM(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 1→2 방위각 (0~360, 북쪽 0)
export function bearingDeg(lat1, lng1, lat2, lng2) {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// 두 방위각의 차이 (0~180)
export function headingDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// 경고 판정: 전방 aheadM 이내, 진행 방향 ±coneDeg, 속도 ≥ 제한속도 + marginKmh
export function shouldWarn({ distM, brgDiff, speedKmh, limit }, opts = {}) {
  const { aheadM = 700, coneDeg = 45, marginKmh = 9 } = opts;
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return distM <= aheadM && brgDiff <= coneDeg && speedKmh >= limit + marginKmh;
}

// ---------- 카메라 DB ----------

// 형식: { updated: 'ISO 날짜', cameras: [[lat, lng, limit], ...] }
export function loadCameraDb() {
  const candidates = [
    `${config.dataDir}/speedcam.json`,
    `${config.dataDir}/speedcam.sample.json`,
    new URL('../data/speedcam.json', import.meta.url).pathname,
    new URL('../data/speedcam.sample.json', import.meta.url).pathname,
  ];
  for (const p of candidates) {
    try {
      const db = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(db.cameras)) return { ...db, sample: p.includes('sample') };
    } catch {
      // 다음 후보로
    }
  }
  return { updated: null, cameras: [], sample: false };
}

// ---------- 페이지 ----------

export function renderSpeedcam() {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>과속카메라 경고</title>
<style>
:root{color-scheme:dark}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;
background:#111;color:#eee;display:flex;flex-direction:column;
align-items:center;justify-content:center;gap:8px;text-align:center;
transition:background .3s;user-select:none;-webkit-user-select:none}
body.warn{background:#8a1f1f}
#speed{font-size:26vw;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
#unit{font-size:5vw;opacity:.6;margin-top:-2vw}
#cam{font-size:6vw;min-height:8vw}
#cam .limit{display:inline-block;border:.8vw solid #d33;border-radius:50%;
background:#fff;color:#111;font-weight:800;width:11vw;height:11vw;line-height:11vw;
vertical-align:middle;margin-right:2vw}
#status{position:fixed;top:10px;left:0;right:0;font-size:14px;opacity:.55;padding:0 16px}
#start{font-size:7vw;padding:5vw 10vw;border-radius:4vw;border:none;
background:#3b82f6;color:#fff;font-weight:700}
nav{position:fixed;bottom:10px;left:0;right:0;font-size:13px;opacity:.5}
nav a{color:inherit;margin:0 8px}
</style>

<div id="status"></div>
<button id="start">시작</button>
<div id="hud" hidden>
  <div id="speed">0</div>
  <div id="unit">km/h</div>
  <div id="cam"></div>
</div>
<nav><a href="/">상태</a><a href="/control">차량 제어</a><a href="/document">API 문서</a></nav>

<script>
const AHEAD_M = 700;      // 전방 검사 거리
const CONE_DEG = 45;      // 진행 방향 허용 각도(±)
const MARGIN_KMH = 9;     // 제한속도 초과 허용치 — 이 이상일 때만 경고
const RECHIME_MS = 10000; // 같은 카메라 재경고 간격

const statusEl = document.getElementById('status');
const speedEl = document.getElementById('speed');
const camEl = document.getElementById('cam');
const startBtn = document.getElementById('start');
const hud = document.getElementById('hud');
const demo = new URLSearchParams(location.search).has('demo');

// ---- 지오 계산 (서버 src/speedcam.js 와 동일 수식) ----
const rad = d => d * Math.PI / 180;
function distanceM(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}
function bearingDeg(lat1, lng1, lat2, lng2) {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const headingDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// ---- 카메라 DB: 서버에서 1회 → localStorage 캐시 (이후 오프라인 동작) ----
let grid = new Map();
const cellKey = (lat, lng) => Math.floor(lat * 100) + ':' + Math.floor(lng * 100);
function buildGrid(cameras) {
  grid = new Map();
  for (const cam of cameras) {
    const k = cellKey(cam[0], cam[1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(cam);
  }
}
function nearby(lat, lng) {
  const out = [];
  const la = Math.floor(lat * 100), ln = Math.floor(lng * 100);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const cell = grid.get((la + i) + ':' + (ln + j));
      if (cell) out.push(...cell);
    }
  return out;
}
async function loadDb() {
  try {
    const res = await fetch('/api/speedcam/db');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const db = await res.json();
    localStorage.setItem('speedcamDb', JSON.stringify(db));
    return db;
  } catch (e) {
    const cached = localStorage.getItem('speedcamDb');
    if (cached) return JSON.parse(cached);
    throw e;
  }
}

// ---- 차임: 띵 띵 띵 (음성 없음) ----
let audio = null;
function chime() {
  if (!audio) return;
  const t0 = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1318; // E6 — 짧고 높은 "띵"
    const t = t0 + i * 0.28;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}

// ---- 위치 처리 ----
let prev = null;            // 직전 좌표 (헤딩 보정용)
let lastChime = new Map();  // 카메라별 마지막 차임 시각

function onPosition(lat, lng, speedMs, heading) {
  // 헤딩이 없으면 직전 좌표로 계산 (10m 이상 움직였을 때만 신뢰)
  if ((heading === null || Number.isNaN(heading)) && prev &&
      distanceM(prev.lat, prev.lng, lat, lng) > 10) {
    heading = bearingDeg(prev.lat, prev.lng, lat, lng);
  }
  // 속도가 없으면 직전 좌표와 시간으로 계산
  const now = Date.now();
  if ((speedMs === null || Number.isNaN(speedMs)) && prev) {
    const dt = (now - prev.t) / 1000;
    if (dt > 0.5) speedMs = distanceM(prev.lat, prev.lng, lat, lng) / dt;
  }
  prev = { lat, lng, t: now };
  const speedKmh = (speedMs || 0) * 3.6;
  speedEl.textContent = Math.round(speedKmh);

  let nearest = null;
  if (heading !== null && !Number.isNaN(heading)) {
    for (const cam of nearby(lat, lng)) {
      const d = distanceM(lat, lng, cam[0], cam[1]);
      if (d > AHEAD_M) continue;
      if (headingDiff(heading, bearingDeg(lat, lng, cam[0], cam[1])) > CONE_DEG) continue;
      if (!nearest || d < nearest.d) nearest = { d, limit: cam[2], key: cam[0] + ',' + cam[1] };
    }
  }

  if (nearest) {
    camEl.innerHTML = '<span class="limit">' + nearest.limit + '</span>' +
      Math.round(nearest.d / 10) * 10 + 'm';
    const over = speedKmh >= nearest.limit + MARGIN_KMH;
    document.body.classList.toggle('warn', over);
    if (over && now - (lastChime.get(nearest.key) || 0) > RECHIME_MS) {
      lastChime.set(nearest.key, now);
      chime();
    }
  } else {
    camEl.textContent = '';
    document.body.classList.remove('warn');
  }
}

// ---- 데모: 제한속도 50 카메라를 향해 70km/h 로 접근 ----
function runDemo(cameras) {
  const cam = cameras[0];
  const step = 70 / 3.6; // 초당 이동 거리(m) — 70km/h
  let d = 1200;
  statusEl.textContent = '데모: 제한속도 ' + cam[2] + ' 카메라에 70km/h 로 접근 중';
  const timer = setInterval(() => {
    d -= step;
    if (d < -200) { clearInterval(timer); statusEl.textContent = '데모 종료'; return; }
    // 카메라 남쪽 d 미터 지점에서 북진 (위도 1도 ≈ 111km)
    onPosition(cam[0] - d / 111000, cam[1], step, 0);
  }, 1000);
}

startBtn.addEventListener('click', async () => {
  audio = new (window.AudioContext || window.webkitAudioContext)();
  startBtn.hidden = true;
  hud.hidden = false;
  try { await navigator.wakeLock.request('screen'); } catch {}
  let db;
  try {
    db = await loadDb();
  } catch (e) {
    statusEl.textContent = '카메라 DB 를 불러오지 못했습니다: ' + e.message;
    return;
  }
  buildGrid(db.cameras);
  statusEl.textContent = '카메라 ' + db.cameras.length.toLocaleString() + '개' +
    (db.sample ? ' (샘플 DB — README 의 반입 절차를 진행하세요)' : '') +
    (db.updated ? ' · 기준일 ' + db.updated : '');
  if (demo) { chime(); runDemo(db.cameras); return; }
  navigator.geolocation.watchPosition(
    (pos) => onPosition(pos.coords.latitude, pos.coords.longitude,
      pos.coords.speed, pos.coords.heading),
    (err) => { statusEl.textContent = 'GPS 오류: ' + err.message; },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
});
</script>`;
}
