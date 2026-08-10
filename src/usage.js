import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Fleet API 는 요청마다 과금되므로, 어느 경로로 몇 번 나갔는지 직접 셉니다.
// Tesla 청구 주기에 맞춰 월 단위로 모으고, 오래된 달은 버립니다.
const file = path.join(config.dataDir, 'usage.json');
const KEEP_MONTHS = 13;

export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// 경로만 보고 종류를 구분합니다. Tesla 도 이 세 가지로 나눠 과금합니다.
export function classify(pathname) {
  if (pathname.includes('/command/')) return 'command';
  if (pathname.endsWith('/wake_up')) return 'wake';
  return 'data';
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function save(all) {
  // 최근 달만 남깁니다. 파일이 무한정 커지지 않도록.
  const trimmed = {};
  for (const key of Object.keys(all).sort().slice(-KEEP_MONTHS)) {
    trimmed[key] = all[key];
  }
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(trimmed, null, 2));
  } catch (e) {
    // 집계 실패가 실제 요청을 막아서는 안 됩니다.
    console.warn(`사용량 기록 실패: ${e.message}`);
  }
  return trimmed;
}

export function record(source, pathname) {
  const kind = classify(pathname);
  const all = load();
  const month = (all[monthKey()] ??= {});
  const bucket = (month[source] ??= {});
  bucket[kind] = (bucket[kind] || 0) + 1;
  save(all);
}

const sum = (bucket) => Object.values(bucket || {}).reduce((n, v) => n + v, 0);

// Fleet API 만 과금됩니다. 개발자 포털의 범주별 비용에서 역산한 단가를 씁니다.
function estimate(bucket = {}) {
  const { command, data, wake } = config.pricing;
  return Math.round(
    (bucket.command || 0) * command + (bucket.data || 0) * data + (bucket.wake || 0) * wake
  );
}

export function snapshot() {
  const all = load();
  const months = Object.keys(all).sort().reverse();
  return months.map((month) => ({
    month,
    fleet: all[month].fleet || {},
    owner: all[month].owner || {},
    fleetTotal: sum(all[month].fleet),
    ownerTotal: sum(all[month].owner),
    // Fleet 로 나간 요청의 예상 요금, 그리고 Owner 로 빠져 절약한 금액
    fleetCost: estimate(all[month].fleet),
    savedCost: estimate(all[month].owner),
  }));
}

export function clearUsage() {
  try {
    fs.unlinkSync(file);
  } catch {
    // 없으면 무시
  }
}
