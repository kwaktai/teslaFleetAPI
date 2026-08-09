import { config } from './config.js';
import { COMMAND_GROUPS, COMMAND_COUNT } from './catalog.js';
import { aliasEntries } from './vehicles.js';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function paramCell(command) {
  if (!command.params.length) return '<span class="muted">없음</span>';
  return command.params
    .map(
      (p) =>
        `<code>${esc(p.name)}</code> <span class="muted">${esc(p.type)}${
          p.required ? '' : ' · 선택'
        }</span>`
    )
    .join('<br>');
}

function commandRow(command) {
  const choices = command.choices.length
    ? `<div class="muted">값: ${command.choices.map((c) => `<code>${esc(c)}</code>`).join(', ')}</div>`
    : '';
  const note = command.note ? `<div class="muted">${esc(command.note)}</div>` : '';
  const badge =
    command.route === 'rest'
      ? '<span class="tag rest">직접</span>'
      : '<span class="tag sign">서명</span>';
  return `<tr data-search="${esc(`${command.name} ${command.label}`)}">
  <td><code>${esc(command.name)}</code> ${badge}</td>
  <td>${esc(command.label)}${choices}${note}</td>
  <td>${paramCell(command)}</td>
</tr>`;
}

export function renderDocument() {
  const domain = config.domain || '<도메인>';
  const aliases = aliasEntries();
  const aliasRow = aliases.length
    ? aliases.map(([name, vin]) => `<code>${esc(name)}</code> → ${esc(vin)}`).join('<br>')
    : '<span class="muted">등록된 별칭 없음 — .env 의 VEHICLE_ALIASES 로 설정</span>';

  const groups = COMMAND_GROUPS.map(
    (group) => `<h3>${esc(group.title)} <span class="muted">(${group.commands.length})</span></h3>
<table>
  <thead><tr><th>명령</th><th>설명</th><th>파라미터</th></tr></thead>
  <tbody>${group.commands.map(commandRow).join('\n')}</tbody>
</table>`
  ).join('\n');

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>API 문서 — Tesla Fleet API 서버</title>
<style>
:root{color-scheme:light dark}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:900px;
margin:0 auto;padding:20px;line-height:1.6}
h1{font-size:24px}h2{font-size:20px;margin-top:36px;border-bottom:1px solid #8884;padding-bottom:6px}
h3{font-size:16px;margin-top:24px}
code{background:#8882;padding:2px 5px;border-radius:4px;font-size:.9em}
pre{background:#8881;padding:12px;border-radius:8px;overflow-x:auto;font-size:13px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:14px}
th,td{border:1px solid #8884;padding:8px;text-align:left;vertical-align:top}
th{background:#8881}
.muted{opacity:.65;font-size:.85em}
.tag{font-size:11px;padding:1px 6px;border-radius:10px;vertical-align:middle;white-space:nowrap}
.tag.sign{background:#3a7d3a33;border:1px solid #3a7d3a88}
.tag.rest{background:#c08a2033;border:1px solid #c08a2088}
.note{border-left:3px solid #e0a030;background:#e0a03018;padding:10px 14px;margin:14px 0;border-radius:4px}
.warn{border-left:3px solid #d05050;background:#d0505018;padding:10px 14px;margin:14px 0;border-radius:4px}
#filter{width:100%;padding:10px;font-size:15px;border-radius:8px;border:1px solid #8886;
background:transparent;color:inherit;margin:8px 0}
nav a{margin-right:12px;font-size:14px}
</style>

<h1>Tesla Fleet API 서버 — API 문서</h1>
<nav><a href="/">상태 페이지</a><a href="/control">차량 제어</a></nav>
<p class="muted">명령 목록은 서버에 포함된 서명 프록시(<code>vehicle-command v0.4.1</code>)
소스에서 추출한 69개와, 프록시가 구현하지 않아 Fleet API 로 직접 전달하는 12개를 합친
${COMMAND_COUNT}개입니다.</p>

<h2>1. 인증</h2>
<p><code>/.well-known/...</code>, <code>/auth/callback</code>, <code>/healthz</code> 를 제외한
모든 요청에 API 키가 필요합니다.</p>
<table>
  <tr><th>방법</th><th>사용처</th><th>예</th></tr>
  <tr><td><code>X-API-Key</code> 헤더</td><td>터미널, iOS 단축어</td>
      <td><code>-H "X-API-Key: &lt;키&gt;"</code></td></tr>
  <tr><td><code>?key=</code> 쿼리</td><td>브라우저 최초 1회</td>
      <td><code>https://${esc(domain)}/?key=&lt;키&gt;</code></td></tr>
  <tr><td>쿠키</td><td>브라우저 (자동)</td><td><span class="muted">위 방법으로 접속하면 자동 저장</span></td></tr>
</table>

<h2>2. 차량 지정</h2>
<p>아래 넷 중 아무거나 쓸 수 있습니다. 대소문자를 구분하지 않습니다.</p>
<table>
  <tr><th>방식</th><th>예</th></tr>
  <tr><td>별칭 (<code>.env</code> 의 <code>VEHICLE_ALIASES</code>)</td><td>${aliasRow}</td></tr>
  <tr><td>차량 이름 (Tesla 앱에서 정한 이름)</td><td><code>Kana</code></td></tr>
  <tr><td>차량 ID</td><td><code>1492931239318942</code></td></tr>
  <tr><td>VIN</td><td><code>5YJ3E1EB8LF727066</code></td></tr>
</table>

<h2>3. 엔드포인트</h2>
<table>
  <tr><th>메서드</th><th>경로</th><th>설명</th></tr>
  <tr><td>GET</td><td><code>/</code></td><td>상태 페이지</td></tr>
  <tr><td>GET</td><td><code>/control</code></td><td>버튼식 차량 제어</td></tr>
  <tr><td>GET</td><td><code>/document</code></td><td>이 문서</td></tr>
  <tr><td>GET</td><td><code>/api/vehicles</code></td><td>차량 목록</td></tr>
  <tr><td>GET</td><td><code>/api/vehicles/:차량/vehicle_data</code></td><td>차량 상세 상태</td></tr>
  <tr><td>POST</td><td><code>/api/vehicles/:차량/wake_up</code></td><td>차량 깨우기</td></tr>
  <tr><td>POST</td><td><code>/api/vehicles/:차량/command/:명령</code></td><td>차량 명령 (아래 목록)</td></tr>
  <tr><td>POST</td><td><code>/api/vehicles/:차량/command/:명령<strong>?wake=1</strong></code></td>
      <td>자고 있을 때만 깨운 뒤 자동 재시도</td></tr>
  <tr><td>GET</td><td><code>/auth/login</code></td><td>Tesla 계정 로그인</td></tr>
  <tr><td>POST</td><td><code>/admin/register-partner</code></td><td>도메인 파트너 등록</td></tr>
  <tr><td>GET</td><td><code>/admin/public-key-status</code></td><td>등록된 공개키 확인</td></tr>
  <tr><td>GET</td><td><code>/healthz</code></td><td>헬스체크</td></tr>
</table>

<div class="note"><strong>명령은 모두 POST 입니다.</strong>
브라우저 주소창은 GET만 보내므로 <code>Cannot GET</code> 이 납니다.
브라우저에서 실행하려면 <a href="/control">제어 페이지</a>를 쓰세요.</div>

<h2>4. 잠든 차량 자동 처리</h2>
<p>명령 URL 뒤에 <code>?wake=1</code> 을 붙이면, 차량이 자고 있어 명령이 거부된 경우에만
서버가 깨우고 온라인이 되는 즉시 한 번 재시도합니다.</p>
<table>
  <tr><th>차량 상태</th><th>동작</th></tr>
  <tr><td>깨어 있음</td><td>바로 실행. <strong>추가 호출도 대기도 없습니다.</strong></td></tr>
  <tr><td>자고 있음</td><td>깨우기 → 온라인 확인(2초 간격) → 재시도</td></tr>
  <tr><td>제한 시간 내 못 깨어남</td><td>원래 오류를 그대로 반환 (기본 30초, <code>WAKE_TIMEOUT_SECONDS</code>)</td></tr>
</table>
<pre>curl -X POST -H "X-API-Key: &lt;키&gt;" \\
  "https://${esc(domain)}/api/vehicles/3/command/door_unlock?wake=1"</pre>
<p class="muted">단축어에서 상태를 먼저 조회해 분기할 필요가 없습니다. 동작 하나면 충분합니다.
<a href="/control">제어 페이지</a>의 버튼도 이 방식을 씁니다.</p>

<h2>5. 호출 예시</h2>
<pre>curl -X POST -H "X-API-Key: &lt;키&gt;" \\
  https://${esc(domain)}/api/vehicles/3/command/door_unlock</pre>
<pre>curl -X POST -H "X-API-Key: &lt;키&gt;" -H "Content-Type: application/json" \\
  -d '{"percent":80}' \\
  https://${esc(domain)}/api/vehicles/3/command/set_charge_limit</pre>
<p>NAS 터미널에서는 키를 자동으로 읽는 도우미 스크립트를 쓸 수 있습니다.</p>
<pre>./scripts/cmd.sh 3 door_unlock
./scripts/cmd.sh 3 set_charge_limit '{"percent":80}'</pre>
<p><strong>iOS 단축어</strong>: "URL 콘텐츠 가져오기" → 방식 <code>POST</code> →
헤더에 <code>X-API-Key</code> 추가 → 값이 필요한 명령은 본문을 JSON 으로 지정.</p>

<h2>6. 차량 명령 (${COMMAND_COUNT}개)</h2>
<div class="warn"><strong>명령을 쓰려면 차량마다 가상 키 등록이 필요합니다.</strong><br>
Tesla 앱이 설치된 휴대폰에서 <code>https://tesla.com/_ak/${esc(domain)}</code> 를 열고
차량 옆에서 승인하세요. 등록 전에는 권한 오류가 납니다. 조회 기능에는 영향이 없습니다.</div>
<p class="muted">파라미터는 요청 본문에 JSON 으로 보냅니다. "선택" 표시가 없는 것은 필수입니다.
차량이 잠들어 있을 수 있다면 <code>?wake=1</code> 을 붙이세요.</p>

<table>
  <tr><th>표시</th><th>전달 경로</th><th>의미</th></tr>
  <tr><td><span class="tag sign">서명</span></td><td>서명 프록시 경유</td>
      <td>개인키로 서명해 전송합니다. 2021년 이후 차량에 필요한 정식 경로입니다.</td></tr>
  <tr><td><span class="tag rest">직접</span></td><td>Fleet API 직접 호출</td>
      <td>서명 프록시가 구현하지 않은 명령이라 서명 없이 보냅니다.
          차량이 서명을 요구하면 Tesla가 거부할 수 있습니다.</td></tr>
</table>

<input id="filter" type="search" placeholder="명령 검색 (예: charge, 문, 공조)" autocomplete="off">
${groups}

<script>
const filter = document.getElementById('filter');
filter.addEventListener('input', () => {
  const q = filter.value.trim().toLowerCase();
  for (const row of document.querySelectorAll('tbody tr[data-search]')) {
    row.hidden = q !== '' && !row.dataset.search.toLowerCase().includes(q);
  }
  // 결과가 없는 그룹은 제목과 표를 함께 감춥니다.
  for (const table of document.querySelectorAll('table')) {
    const rows = table.querySelectorAll('tbody tr[data-search]');
    if (!rows.length) continue;
    const visible = [...rows].some((r) => !r.hidden);
    table.hidden = !visible;
    const heading = table.previousElementSibling;
    if (heading && heading.tagName === 'H3') heading.hidden = !visible;
  }
});
</script>`;
}
