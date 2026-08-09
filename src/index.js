import crypto from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import { config, assertConfigured, redirectUri } from './config.js';
import { ensureApiKey, getApiKey, requireApiKey } from './auth.js';
import { COMMON_COMMANDS, proxyReady, sendCommand } from './commands.js';
import { aliasEntries, resolveVehicle } from './vehicles.js';
import { ensureKeys, publicKeyPath } from './keys.js';
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

// 공개키·콜백·헬스체크를 제외한 모든 경로에 API 키를 요구합니다.
ensureApiKey();
app.use(requireApiKey);

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
app.get('/.well-known/appspecific/com.tesla.3p.public-key.pem', (_req, res) => {
  if (!fs.existsSync(publicKeyPath)) {
    return res.status(500).send('공개키를 찾을 수 없습니다. 컨테이너 로그를 확인하세요.');
  }
  // text/plain 으로 내려야 iOS Safari가 구성 프로파일 설치로 오인하지 않고
  // 브라우저에서 바로 내용을 확인할 수 있습니다. Tesla는 본문만 읽습니다.
  res.type('text/plain; charset=utf-8').send(fs.readFileSync(publicKeyPath, 'utf8'));
});

// ---------- 상태 페이지 ----------
app.get('/', (_req, res) => {
  const missing = assertConfigured();
  const tokens = loadTokens();
  const keyExists = fs.existsSync(publicKeyPath);
  const domain = config.domain || '(미설정)';
  res.type('html').send(`<!doctype html>
<meta charset="utf-8">
<title>Tesla Fleet API 서버</title>
<style>body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6}
code{background:#eee;padding:2px 6px;border-radius:4px}li{margin:6px 0}
button{font-size:15px;padding:8px 16px;border-radius:6px;border:1px solid #888;
background:#3457d5;color:#fff;cursor:pointer}button:disabled{opacity:.6;cursor:default}
pre{background:#f4f4f4;padding:10px;border-radius:6px;overflow-x:auto;white-space:pre-wrap}</style>
<h1>Tesla Fleet API 서버</h1>
<ul>
  <li>환경변수: ${missing.length ? `❌ 누락 — ${missing.join(', ')}` : '✅ 설정됨'}</li>
  <li>공개키 파일: ${keyExists ? '✅ 자동 생성됨' : '❌ 없음 — 컨테이너 로그 확인 필요'}</li>
  <li>Tesla 계정 토큰: ${tokens ? '✅ 발급됨' : '❌ 없음'}</li>
  <li>명령 서명 프록시: ${proxyReady() ? '✅ 준비됨' : '❌ 미실행 (명령 불가, 조회는 가능)'}</li>
  <li>리전: <code>${config.region}</code> / 도메인: <code>${domain}</code></li>
</ul>
<h2>설정 순서</h2>
<ol>
  <li>외부에서 공개키가 열리는지 확인:
      <code>https://${domain}/.well-known/appspecific/com.tesla.3p.public-key.pem</code>
      (<a href="/.well-known/appspecific/com.tesla.3p.public-key.pem">내부에서 열기</a>)</li>
  <li>도메인을 Tesla에 등록 (최초 1회):<br>
      <button id="reg">도메인 등록하기</button>
      <button id="chk">등록 상태 확인</button>
      <pre id="out" hidden></pre></li>
  <li><a href="/auth/login">Tesla 계정 로그인</a> — 사용자 토큰 발급</li>
  <li><a href="/api/vehicles">차량 목록 조회</a></li>
</ol>
<h2>차량 명령</h2>
<p>명령을 보내려면 차량에 <strong>가상 키</strong>가 등록되어 있어야 합니다.
Tesla 앱이 설치된 휴대폰에서 아래 링크를 열고 차량에서 승인하세요. 차량마다 한 번씩 필요합니다.</p>
<pre>https://tesla.com/_ak/${domain}</pre>
<p>차량은 <strong>별칭·차량 이름·차량 ID·VIN</strong> 중 아무거나로 지정할 수 있습니다.
${
  aliasEntries().length
    ? `현재 별칭: ${aliasEntries().map(([n, v]) => `<code>${n}</code> → ${v}`).join(', ')}`
    : '별칭을 쓰려면 <code>.env</code> 에 <code>VEHICLE_ALIASES=3=VIN1,X=VIN2</code> 형식으로 추가하세요.'
}</p>
<p>등록 후에는 아래처럼 호출합니다. 자주 쓰는 명령:
${COMMON_COMMANDS.map(([c, label]) => `<code>${c}</code>(${label})`).join(', ')}</p>
<pre>curl -X POST -H "X-API-Key: ${getApiKey()}" \\
  https://${domain}/api/vehicles/&lt;차량ID&gt;/command/door_lock

curl -X POST -H "X-API-Key: ${getApiKey()}" -H "Content-Type: application/json" \\
  -d '{"percent":80}' \\
  https://${domain}/api/vehicles/&lt;차량ID&gt;/command/set_charge_limit</pre>

<h2>터미널에서 호출하기</h2>
<p>이 페이지는 API 키로 보호됩니다. 브라우저는 쿠키로 유지되지만,
터미널에서는 헤더를 함께 보내야 합니다.</p>
<pre>curl -H "X-API-Key: ${getApiKey()}" https://${domain}/api/vehicles</pre>
<p>다른 기기의 브라우저에서 열 때는 아래 주소로 한 번 접속하세요.</p>
<pre>https://${domain}/?key=${getApiKey()}</pre>
<script>
const out = document.getElementById('out');
async function call(method, url, btn) {
  const buttons = document.querySelectorAll('button');
  buttons.forEach(b => b.disabled = true);
  out.hidden = false;
  out.textContent = '요청 중...';
  try {
    const res = await fetch(url, { method });
    const text = await res.text();
    let body = text;
    try { body = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    out.textContent = 'HTTP ' + res.status + '\\n\\n' + body;
  } catch (e) {
    out.textContent = '요청 실패: ' + e.message;
  } finally {
    buttons.forEach(b => b.disabled = false);
  }
}
document.getElementById('reg').onclick = () => call('POST', '/admin/register-partner');
document.getElementById('chk').onclick = () => call('GET', '/admin/public-key-status');
</script>`);
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
    const vin = await resolveVehicle(req.params.id);
    const result = await fleetFetch(`/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data`);
    res.status(result.status).json(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vehicles/:id/wake_up', async (req, res) => {
  try {
    const vin = await resolveVehicle(req.params.id);
    const result = await fleetFetch(`/api/1/vehicles/${encodeURIComponent(vin)}/wake_up`, {
      method: 'POST',
    });
    res.status(result.status).json(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 차량 명령 — 서명 프록시를 거쳐 전달합니다.
// 예: POST /api/vehicles/<id>/command/door_lock
//     POST /api/vehicles/<id>/command/set_charge_limit  {"percent": 80}
app.post('/api/vehicles/:id/command/:command', async (req, res) => {
  try {
    const result = await sendCommand(req.params.id, req.params.command, req.body);
    res.status(result.status).json(result.body);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

ensureKeys();

app.listen(config.port, () => {
  console.log(`Tesla Fleet API 서버 시작: 포트 ${config.port}, 리전 ${config.region}`);
  const missing = assertConfigured();
  if (missing.length) {
    console.warn(`⚠️ 환경변수 누락: ${missing.join(', ')}`);
  }
  console.log('');
  console.log('API 키가 필요합니다. 브라우저에서 아래 주소로 한 번 접속하세요:');
  console.log(`  https://${config.domain || '<도메인>'}/?key=${getApiKey()}`);
  console.log('');
});
