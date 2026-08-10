import crypto from 'node:crypto';
import http2 from 'node:http2';
import { record } from './usage.js';

// Tesla 공식 앱이 쓰는 공개 클라이언트(ownerapi)로 로그인합니다.
// 비공식 경로이므로 Tesla가 언제든 막을 수 있습니다. 조회·깨우기 용도로만 씁니다.
export const CLIENT_ID = 'ownerapi';
export const REDIRECT_URI = 'tesla://auth/callback';
const SCOPE = 'openid email offline_access';
// Tesla 가 호스트를 바꿀 경우(그리고 테스트용)를 위해 환경변수로 덮을 수 있게 둡니다.
const AUTH_BASE = process.env.OWNER_AUTH_BASE || 'https://auth.tesla.com';
const AUTHORIZE_URL = `${AUTH_BASE}/oauth2/v3/authorize`;
const TOKEN_URL = `${AUTH_BASE}/oauth2/v3/token`;
export const OWNER_API_BASE = process.env.OWNER_API_BASE || 'https://owner-api.teslamotors.com';

// 이 헤더가 없으면 봇으로 차단됩니다.
const UA = 'TeslaApp/4.10.0-1842/2dde1f7138/android/10';
const X_TESLA_UA = 'TeslaApp/4.10.0';
const TIMEOUT_MS = 15_000;

// 2026-06 부터 auth.tesla.com 과 owner-api 는 HTTP/2 만 받습니다.
// Node 의 기본 fetch(undici)는 HTTP/1.1 이라 node:http2 로 직접 요청합니다.
function h2Request(urlString, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const client = http2.connect(url.origin);
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      client.close();
      fn(value);
    };

    client.on('error', (e) => done(reject, e));

    const req = client.request({
      ':method': method,
      ':path': url.pathname + url.search,
      'user-agent': UA,
      'x-tesla-user-agent': X_TESLA_UA,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      done(reject, new Error('Tesla 응답 시간 초과'));
    });

    let status = 0;
    req.on('response', (h) => {
      status = Number(h[':status']) || 0;
    });

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => done(resolve, { status, raw }));
    req.on('error', (e) => done(reject, e));

    if (body) req.write(body);
    req.end();
  });
}

async function jsonRequest(url, options) {
  const { status, raw } = await h2Request(url, options);
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw: raw.slice(0, 200) };
  }
  return { status, body };
}

function authed(token, extra = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

// ---------- PKCE ----------

const b64url = (buf) => buf.toString('base64url');

export function newPkce() {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
  return { verifier, challenge, state: b64url(crypto.randomBytes(16)) };
}

// 공식 앱과 동일한 파라미터·순서. prompt/locale 을 넣으면 거부됩니다.
// 공백은 %20 이어야 하므로 URLSearchParams(+ 인코딩) 대신 직접 조립합니다.
export function authorizeUrl(pkce) {
  const params = [
    ['client_id', CLIENT_ID],
    ['code_challenge', pkce.challenge],
    ['code_challenge_method', 'S256'],
    ['redirect_uri', REDIRECT_URI],
    ['response_type', 'code'],
    ['scope', SCOPE],
    ['state', pkce.state],
  ];
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${AUTHORIZE_URL}?${query}`;
}

// 콘솔·네트워크 탭이 긴 주소를 줄여서 보여주기 때문에, 화면의 텍스트를 그대로
// 복사하면 code 뒷부분이 잘린 채로 들어옵니다. 그 경우를 따로 알려주기 위한 판별입니다.
export function looksTruncated(pasted) {
  return /[…]|\.\.\.$/.test(String(pasted || '').trim());
}

// 붙여넣은 값에서 code 를 뽑습니다. 전체 URL 도 되고 code 만 넣어도 됩니다.
export function extractCode(pasted) {
  const text = String(pasted || '').trim();
  if (!text) return null;
  const match = text.match(/[?&]code=([^&\s]+)/);
  if (match) return decodeURIComponent(match[1]);
  // 공백이나 URL 형태가 아니면 code 자체로 간주합니다.
  return /^[\w-]+$/.test(text) ? text : null;
}

export function extractState(pasted) {
  const match = String(pasted || '').match(/[?&]state=([^&\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ---------- 토큰 ----------

export async function exchangeCode(code, verifier) {
  const { status, body } = await jsonRequest(TOKEN_URL, {
    method: 'POST',
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (status !== 200 || !body.access_token) {
    throw new Error(`Owner API 토큰 교환 실패 (HTTP ${status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

export async function refreshToken(refresh) {
  const { status, body } = await jsonRequest(TOKEN_URL, {
    method: 'POST',
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refresh,
      scope: SCOPE,
    }),
  });
  if (status !== 200 || !body.access_token) {
    throw new Error(`Owner API 토큰 갱신 실패 (HTTP ${status})`);
  }
  return body;
}

// ---------- 차량 ----------

// /api/1/vehicles 는 2026년부터 412 (fleetapi 전용) 이므로 products 를 씁니다.
// products 에는 에너지 제품도 섞여 오므로 VIN 이 있는 항목만 거릅니다.
export async function products(token) {
  record('owner', '/api/1/products');
  const { status, body } = await jsonRequest(`${OWNER_API_BASE}/api/1/products`, {
    headers: authed(token),
  });
  if (status !== 200) {
    throw new Error(`Owner API products 실패 (HTTP ${status})`);
  }
  const list = Array.isArray(body.response) ? body.response : [];
  return list.filter((item) => typeof item?.vin === 'string' && item.vin.length === 17);
}

// 위치까지 요청하면 차량 화면에 "타사 앱이 실시간 위치 요청 중" 경고가 상시 표시됩니다.
// 필요한 항목만 지정합니다. drive_state 에 내비 목적지·ETA 가 들어 있습니다.
export const DEFAULT_ENDPOINTS = [
  'charge_state',
  'climate_state',
  'vehicle_state',
  'vehicle_config',
  'gui_settings',
  'drive_state',
].join(';');

export async function vehicleData(token, vehicleId, endpoints = DEFAULT_ENDPOINTS) {
  record('owner', '/vehicle_data');
  const query = endpoints ? `?endpoints=${encodeURIComponent(endpoints)}` : '';
  return jsonRequest(
    `${OWNER_API_BASE}/api/1/vehicles/${encodeURIComponent(vehicleId)}/vehicle_data${query}`,
    { headers: authed(token) }
  );
}

export async function wakeUp(token, vehicleId) {
  record('owner', '/wake_up');
  return jsonRequest(`${OWNER_API_BASE}/api/1/vehicles/${encodeURIComponent(vehicleId)}/wake_up`, {
    method: 'POST',
    headers: authed(token),
    body: '{}',
  });
}
