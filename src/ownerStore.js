import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { products, refreshToken } from './ownerApi.js';

const tokenFile = path.join(config.dataDir, 'owner-tokens.json');
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// 레거시 access 토큰은 보통 8시간짜리입니다.
const DEFAULT_TTL_SEC = 8 * 3600;

export function loadOwnerTokens() {
  try {
    return JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  } catch {
    return null;
  }
}

export function saveOwnerTokens(tokens, previousRefresh) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const record = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || previousRefresh,
    expires_at: Date.now() + (tokens.expires_in ?? DEFAULT_TTL_SEC) * 1000,
  };
  fs.writeFileSync(tokenFile, JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

export function clearOwnerTokens() {
  try {
    fs.unlinkSync(tokenFile);
  } catch {
    // 없으면 무시
  }
}

export function ownerLinked() {
  return loadOwnerTokens() !== null;
}

// 유효한 Owner API access 토큰. 만료가 가까우면 갱신해 저장합니다.
// 연결되어 있지 않거나 갱신에 실패하면 null 을 돌려주고, 호출부는 Fleet API 로 넘어갑니다.
export async function ownerAccessToken() {
  const tokens = loadOwnerTokens();
  if (!tokens?.refresh_token) return null;

  if (tokens.access_token && Date.now() < tokens.expires_at - REFRESH_MARGIN_MS) {
    return tokens.access_token;
  }
  try {
    const refreshed = await refreshToken(tokens.refresh_token);
    return saveOwnerTokens(refreshed, tokens.refresh_token).access_token;
  } catch (e) {
    console.warn(`Owner API 토큰 갱신 실패: ${e.message}`);
    return null;
  }
}

// Owner API 는 VIN 이 아니라 내부 id 로 조회합니다.
// 계정 내 매핑은 사실상 불변이므로 한 번만 받아 캐시합니다.
const idByVin = new Map();

export async function ownerVehicleId(token, vin) {
  const key = vin.toUpperCase();
  if (idByVin.has(key)) return idByVin.get(key);

  for (const item of await products(token)) {
    idByVin.set(item.vin.toUpperCase(), String(item.id_s || item.id));
  }
  return idByVin.get(key) ?? null;
}
