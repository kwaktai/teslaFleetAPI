import { VEHICLES, CATEGORIES, FUNCTION_COUNT, supportedCount } from './s3xy.js';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DEFAULT_VEHICLE = VEHICLES[0].id;

// 차종별로 달라지는 내용은 모두 그려 두고, 고르지 않은 차종의 것만 숨깁니다.
// 이렇게 하면 차종을 바꿀 때 서버를 다시 부르지 않아도 됩니다.
function perVehicle(render) {
  return VEHICLES.map((v) => {
    const inner = render(v);
    if (!inner) return '';
    return `<span class="veh" data-vehicle="${esc(v.id)}"${
      v.id === DEFAULT_VEHICLE ? '' : ' hidden'
    }>${inner}</span>`;
  }).join('');
}

function searchText(fn) {
  const notes = fn.vehicles ? Object.values(fn.vehicles).join(' ') : '';
  return `${fn.name} ${fn.ko} ${fn.desc || ''} ${notes}`;
}

function functionRow(fn) {
  const supported = VEHICLES.filter((v) => fn.support?.[v.id])
    .map((v) => v.id)
    .join(' ');
  const desc = fn.desc ? `<div class="muted">${esc(fn.desc)}</div>` : '';
  const notes = perVehicle((v) =>
    fn.vehicles?.[v.id] ? `<span class="vnote">${esc(fn.vehicles[v.id])}</span>` : ''
  );
  const marks = perVehicle((v) =>
    fn.support?.[v.id]
      ? '<span class="yes" title="지원">✓</span>'
      : '<span class="no" title="미지원">✗</span>'
  );
  return `<tr data-search="${esc(searchText(fn))}" data-support="${esc(supported)}">
  <td class="mark">${marks}</td>
  <td><code>${esc(fn.name)}</code></td>
  <td>${esc(fn.ko)}${desc}${notes}</td>
</tr>`;
}

function categorySection(category) {
  const desc = category.desc ? `<p class="muted">${esc(category.desc)}</p>` : '';
  const notes = perVehicle((v) =>
    category.vehicles?.[v.id] ? `<span class="note">${esc(category.vehicles[v.id])}</span>` : ''
  );
  return `<section>
<h3>${esc(category.title)} <span class="muted">(${category.functions.length})</span></h3>
${desc}${notes}
<table>
  <thead><tr><th class="mark">지원</th><th>기능</th><th>설명</th></tr></thead>
  <tbody>${category.functions.map(functionRow).join('\n')}</tbody>
</table>
</section>`;
}

export function renderS3xyDocument() {
  const tabs = VEHICLES.map(
    (v) =>
      `<button type="button" class="tab" data-vehicle="${esc(v.id)}" aria-pressed="${
        v.id === DEFAULT_VEHICLE
      }">${esc(v.name)} <span class="muted">${esc(v.year)}</span></button>`
  ).join('');

  const summary = perVehicle(
    (v) =>
      `<a href="${esc(v.source)}" target="_blank" rel="noopener">${esc(v.name)} 원본 페이지 →</a>` +
      ` &nbsp;·&nbsp; 전체 ${FUNCTION_COUNT}개 중 <strong>${supportedCount(v.id)}개 지원</strong>` +
      ` (미지원 ${FUNCTION_COUNT - supportedCount(v.id)}개)`
  );

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>S3XY Buttons 기능 정리</title>
<style>
:root{color-scheme:light dark}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:900px;
margin:0 auto;padding:20px;line-height:1.6}
h1{font-size:24px}
h3{font-size:17px;margin-top:28px;border-bottom:1px solid #8884;padding-bottom:4px}
code{background:#8882;padding:2px 5px;border-radius:4px;font-size:.9em}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:14px}
th,td{border:1px solid #8884;padding:8px;text-align:left;vertical-align:top}
th{background:#8881}
td.mark,th.mark{width:44px;text-align:center}
.yes{color:#22a06b;font-weight:700}
.no{color:#d05050;font-weight:700}
.muted{opacity:.65;font-size:.85em;font-weight:normal}
.note{display:block;border-left:3px solid #e0a030;background:#e0a03018;padding:8px 12px;
margin:8px 0;border-radius:4px;font-size:14px}
.vnote{display:block;font-size:.85em;opacity:.8;margin-top:4px}
.vnote::before{content:"↳ ";opacity:.6}
#filter{width:100%;padding:10px;font-size:15px;border-radius:8px;border:1px solid #8886;
background:transparent;color:inherit;margin:8px 0}
nav a{margin-right:12px;font-size:14px}
#tabs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
.tab{padding:8px 14px;border:1px solid #8886;border-radius:8px;background:transparent;
color:inherit;font:inherit;font-size:14px;cursor:pointer}
.tab[aria-pressed="true"]{border-color:#3b82f6;background:#3b82f622;font-weight:600}
label.opt{font-size:14px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
</style>

<h1>S3XY Buttons 기능 정리</h1>
<nav><a href="/">상태 페이지</a><a href="/control">차량 제어</a><a href="/document">API 문서</a></nav>
<p class="muted">Enhance Auto 의 S3XY Buttons 가 지원하는 기능을 한국어로 정리한 문서입니다.
기능 목록과 순서는 두 차종이 같고 <strong>지원 여부만 다릅니다</strong>. 원본 페이지에서 차종·연식을
고른 뒤에야 보이는 체크/엑스 표시를 그대로 옮겼습니다.
이 서버의 Fleet API 기능과는 별개이며 참고용입니다.</p>

<div id="tabs">${tabs}</div>
<p class="muted">${summary}</p>

<input id="filter" type="search" placeholder="기능 검색 (예: 트렁크, Frunk, 열선)" autocomplete="off">
<label class="opt"><input type="checkbox" id="onlySupported"> 지원되는 기능만 보기</label>

${CATEGORIES.map(categorySection).join('\n')}

<script>
const filter = document.getElementById('filter');
const onlySupported = document.getElementById('onlySupported');
let vehicle = ${JSON.stringify(DEFAULT_VEHICLE)};

function apply() {
  for (const el of document.querySelectorAll('.veh')) {
    el.hidden = el.dataset.vehicle !== vehicle;
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.vehicle === vehicle));
  }
  const q = filter.value.trim().toLowerCase();
  for (const row of document.querySelectorAll('tbody tr[data-search]')) {
    const ok = !onlySupported.checked || row.dataset.support.split(' ').includes(vehicle);
    const hit = q === '' || row.dataset.search.toLowerCase().includes(q);
    row.hidden = !(ok && hit);
  }
  // 남은 행이 없는 분류는 통째로 숨깁니다.
  for (const section of document.querySelectorAll('section')) {
    const rows = section.querySelectorAll('tbody tr[data-search]');
    section.hidden = rows.length > 0 && ![...rows].some((r) => !r.hidden);
  }
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    vehicle = tab.dataset.vehicle;
    apply();
  });
}
filter.addEventListener('input', apply);
onlySupported.addEventListener('change', apply);
apply();
</script>`;
}
