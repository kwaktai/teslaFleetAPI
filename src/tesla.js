import { config, redirectUri } from './config.js';
import { record } from './usage.js';
import { loadTokens, saveTokens } from './tokenStore.js';

// ---------- OAuth ----------

export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    scope: config.scopes,
    state,
    prompt: 'login',
  });
  return `${config.authBase}/authorize?${params.toString()}`;
}

async function tokenRequest(body) {
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`토큰 요청 실패 (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

export async function exchangeCode(code) {
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri(),
    audience: config.audience,
  });
  return saveTokens(tokens);
}

export async function refreshTokens(refreshToken) {
  const tokens = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
  });
  return saveTokens(tokens);
}

// 유효한 사용자 액세스 토큰 반환(필요 시 자동 갱신)
export async function getAccessToken() {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error('저장된 토큰이 없습니다. 먼저 /auth/login 으로 Tesla 계정 인증을 하세요.');
  }
  if (Date.now() < tokens.expires_at) {
    return tokens.access_token;
  }
  const refreshed = await refreshTokens(tokens.refresh_token);
  return refreshed.access_token;
}

// 파트너 토큰(client_credentials) — 도메인 등록 등 파트너 API 전용
export async function getPartnerToken() {
  return tokenRequest({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.scopes,
    audience: config.audience,
  });
}

// ---------- Fleet API 호출 ----------

export async function fleetFetch(pathname, { method = 'GET', token, body } = {}) {
  const accessToken = token ?? (await getAccessToken());
  // Fleet API 는 요청마다 과금되므로 나가기 전에 기록합니다.
  record('fleet', pathname);
  const res = await fetch(`${config.audience}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// 개발자 도메인을 Tesla에 파트너 계정으로 등록
export async function registerPartnerAccount() {
  const { access_token } = await getPartnerToken();
  return fleetFetch('/api/1/partner_accounts', {
    method: 'POST',
    token: access_token,
    body: { domain: config.domain },
  });
}

// 등록된 공개키 확인
export async function checkPartnerPublicKey() {
  const { access_token } = await getPartnerToken();
  return fleetFetch(`/api/1/partner_accounts/public_key?domain=${encodeURIComponent(config.domain)}`, {
    token: access_token,
  });
}
