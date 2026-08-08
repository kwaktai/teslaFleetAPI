import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, assertConfigured, redirectUri } from './config.js';
import { loadTokens, clearTokens } from './tokenStore.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  fleetFetch,
  registerPartnerAccount,
  checkPartnerPublicKey,
} from './tesla.js';

const app = express();
app.use(express.json());

// OAuth CSRF 방지용 state 저장 (10분 유효)
const pendingStates = new Map();
function issueState() {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  return state;
}
function consumeState(state) {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return exp !== undefined && Date.now() < exp;
}

// ---------- Tesla 공개키 호스팅 ----------
// Tesla가 https://<도메인>/.well-known/appspecific/com.tesla.3p.public-key.pem 을 검증합니다.
const publicKeyPath = path.join(config.dataDir, 'keys', 'com.tesla.3p.public-key.pem');
app.get('/.well-known/appspecific/com.tesla.3p.public-key.pem', (_req, res) => {
  if (!fs.existsSync(publicKeyPath)) {
    return res.status(404).send('공개키가 없습니다. scripts/generate-keys.sh 를 먼저 실행하세요.');
  }
  res.type('application/x-pem-file').send(fs.readFileSync(publicKeyPath, 'utf8'));
});

// ---------- 상태 페이지 ----------
app.get('/', (_req, res) => {
  const missing = assertConfigured();
  const tokens = loadTokens();
  const keyExists = fs.existsSync(publicKeyPath);
  res.type('html').send(`<!doctype html>
<meta charset="utf-8">
<title>Tesla Fleet API 서버</title>
<style>body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6}
code{background:#eee;padding:2px 6px;border-radius:4px}li{margin:6px 0}</style>
<h1>Tesla Fleet API 서버</h1>
<ul>
  <li>환경변수: ${missing.length ? `❌ 누락 — ${missing.join(', ')}` : '✅ 설정됨'}</li>
  <li>공개키 파일: ${keyExists ? '✅ 있음' : '❌ 없음 (generate-keys.sh 실행 필요)'}</li>
  <li>Tesla 계정 토큰: ${tokens ? '✅ 발급됨' : '❌ 없음'}</li>
  <li>리전: <code>${config.region}</code> / 도메인: <code>${config.domain || '(미설정)'}</code></li>
</ul>
<h2>설정 순서</h2>
<ol>
  <li><a href="/.well-known/appspecific/com.tesla.3p.public-key.pem">공개키 확인</a> — 외부(HTTPS 도메인)에서도 열리는지 확인</li>
  <li><code>POST /admin/register-partner</code> — 도메인을 Tesla에 등록 (최초 1회)</li>
  <li><a href="/auth/login">Tesla 계정 로그인</a> — 사용자 토큰 발급</li>
  <li><a href="/api/vehicles">차량 목록 조회</a></li>
</ol>`);
});

// ---------- OAuth ----------
app.get('/auth/login', (_req, res) => {
  const missing = assertConfigured();
  if (missing.length) {
    return res.status(500).send(`환경변수 누락: ${missing.join(', ')}`);
  }
  res.redirect(buildAuthorizeUrl(issueState()));
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    return res.status(400).send(`Tesla 인증 실패: ${error} ${error_description ?? ''}`);
  }
  if (!code || !consumeState(String(state))) {
    return res.status(400).send('잘못된 요청입니다 (code/state 오류). /auth/login 부터 다시 시도하세요.');
  }
  try {
    await exchangeCode(String(code));
    res.redirect('/');
  } catch (e) {
    res.status(500).send(`토큰 교환 실패: ${e.message}`);
  }
});

app.post('/auth/logout', (_req, res) => {
  clearTokens();
  res.json({ ok: true });
});

// ---------- 관리 ----------
app.post('/admin/register-partner', async (_req, res) => {
  try {
    const result = await registerPartnerAccount();
    res.status(result.status).json(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/public-key-status', async (_req, res) => {
  try {
    const result = await checkPartnerPublicKey();
    res.status(result.status).json(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- 차량 API ----------
app.get('/api/vehicles', async (_req, res) => {
  try {
    const result = await fleetFetch('/api/1/vehicles');
    res.status(result.status).json(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/vehicles/:id/vehicle_data', async (req, res) => {
  try {
    const result = await fleetFetch(
      `/api/1/vehicles/${encodeURIComponent(req.params.id)}/vehicle_data`
    );
    res.status(result.status).json(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vehicles/:id/wake_up', async (req, res) => {
  try {
    const result = await fleetFetch(
      `/api/1/vehicles/${encodeURIComponent(req.params.id)}/wake_up`,
      { method: 'POST' }
    );
    res.status(result.status).json(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`Tesla Fleet API 서버 시작: 포트 ${config.port}, 리전 ${config.region}`);
  const missing = assertConfigured();
  if (missing.length) {
    console.warn(`⚠️ 환경변수 누락: ${missing.join(', ')}`);
  }
});
