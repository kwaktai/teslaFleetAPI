import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const tokenFile = path.join(config.dataDir, 'tokens.json');

export function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  } catch {
    return null;
  }
}

export function saveTokens(tokens) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const record = {
    ...tokens,
    // 만료 60초 전을 기준으로 갱신하도록 저장
    expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000 - 60_000,
  };
  fs.writeFileSync(tokenFile, JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

export function clearTokens() {
  try {
    fs.unlinkSync(tokenFile);
  } catch {
    // 파일이 없으면 무시
  }
}
