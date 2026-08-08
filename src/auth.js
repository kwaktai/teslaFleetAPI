import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const keyFile = path.join(config.dataDir, 'api-key.txt');
const COOKIE = 'api_key';

// 인증 없이 열어두어야 하는 경로
//  - 공개키: Tesla 서버가 직접 가져갑니다
//  - 콜백: Tesla가 사용자 브라우저를 이 주소로 되돌립니다 (state 값으로 별도 검증)
//  - 헬스체크: 컨테이너 상태 확인용
const PUBLIC_PATHS = new Set([
  '/.well-known/appspecific/com.tesla.3p.public-key.pem',
  '/auth/callback',
  '/healthz',
]);

let apiKey = '';

export function getApiKey() {
  return apiKey;
}

// API_KEY 환경변수가 있으면 그것을 쓰고, 없으면 생성해 파일로 보관합니다.
export function ensureApiKey() {
  if (config.apiKey) {
    apiKey = config.apiKey;
    return { generated: false, source: 'API_KEY 환경변수' };
  }

  if (fs.existsSync(keyFile)) {
    const saved = fs.readFileSync(keyFile, 'utf8').trim();
    if (saved) {
      apiKey = saved;
      return { generated: false, source: keyFile };
    }
  }

  apiKey = crypto.randomBytes(24).toString('base64url');
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(keyFile, `${apiKey}\n`, { mode: 0o600 });
  return { generated: true, source: keyFile };
}

function safeEqual(candidate, expected) {
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(String(expected));
  // timingSafeEqual 은 길이가 다르면 예외를 던지므로 먼저 비교합니다.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function requireApiKey(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();

  const header = req.get('X-API-Key');
  if (header && safeEqual(header, apiKey)) return next();

  const cookie = readCookie(req, COOKIE);
  if (cookie && safeEqual(cookie, apiKey)) return next();

  const query = req.query.key;
  if (query && safeEqual(query, apiKey)) {
    // POST 등은 그대로 처리합니다. 리다이렉트를 걸면 iOS 단축어처럼
    // 리다이렉트를 GET으로 따라가는 클라이언트에서 요청이 깨집니다.
    if (req.method !== 'GET') return next();

    // 브라우저는 한 번만 ?key=... 로 들어오면 이후에는 쿠키로 유지됩니다.
    // 리버스 프록시 뒤에서는 X-Forwarded-Proto 로 원래 프로토콜을 판단합니다.
    res.cookie(COOKIE, apiKey, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.get('X-Forwarded-Proto') === 'https',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    // 주소창과 방문 기록에 키가 남지 않도록 키를 뺀 주소로 이동합니다.
    return res.redirect(req.path);
  }

  res.status(401).type('text/plain; charset=utf-8').send(
    [
      '401 인증 필요',
      '',
      '브라우저: 아래 주소로 한 번 접속하면 이후에는 자동으로 유지됩니다.',
      `  https://${config.domain || '<도메인>'}/?key=<API_KEY>`,
      '',
      '터미널: X-API-Key 헤더를 함께 보내세요.',
      `  curl -H "X-API-Key: <API_KEY>" https://${config.domain || '<도메인>'}/api/vehicles`,
      '',
      'API_KEY 확인: sudo docker exec tesla-fleet-api cat /data/api-key.txt',
    ].join('\n')
  );
}
