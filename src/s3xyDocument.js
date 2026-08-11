import { S3XY_VEHICLES, functionCount } from './s3xy.js';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function functionRow(fn) {
  const note = fn.note ? `<div class="muted">${esc(fn.note)}</div>` : '';
  return `<tr data-search="${esc(`${fn.name} ${fn.ko} ${fn.note || ''}`)}">
  <td><code>${esc(fn.name)}</code></td>
  <td>${esc(fn.ko)}${note}</td>
</tr>`;
}

function vehicleSection(vehicle) {
  const total = functionCount(vehicle);

  if (!total) {
    return `<section data-vehicle="${esc(vehicle.id)}">
  <h2>${esc(vehicle.name)} <span class="muted">${esc(vehicle.year)}</span></h2>
  <div class="note"><strong>아직 내용이 입력되지 않았습니다.</strong><br>
  아래 원본 페이지의 기능 목록을 <code>src/s3xy.js</code> 의
  <code>categories</code> 에 채우면 이 자리에 표시됩니다.<br>
  <a href="${esc(vehicle.source)}" target="_blank" rel="noopener">원본 페이지 열기 →</a></div>
</section>`;
  }

  const groups = vehicle.categories
    .map(
      (category) => `<h3>${esc(category.title)}
  <span class="muted">(${category.functions.length})</span></h3>
<table>
  <thead><tr><th>기능</th><th>설명</th></tr></thead>
  <tbody>${category.functions.map(functionRow).join('\n')}</tbody>
</table>`
    )
    .join('\n');

  return `<section data-vehicle="${esc(vehicle.id)}">
  <h2>${esc(vehicle.name)} <span class="muted">${esc(vehicle.year)} · 총 ${total}개</span></h2>
  <p class="muted"><a href="${esc(vehicle.source)}" target="_blank" rel="noopener">원본 페이지</a></p>
  ${groups}
</section>`;
}

export function renderS3xyDocument() {
  const filled = S3XY_VEHICLES.filter((v) => functionCount(v) > 0).length;

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>S3XY Buttons 기능 정리</title>
<style>
:root{color-scheme:light dark}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:900px;
margin:0 auto;padding:20px;line-height:1.6}
h1{font-size:24px}
h2{font-size:20px;margin-top:36px;border-bottom:1px solid #8884;padding-bottom:6px}
h3{font-size:16px;margin-top:24px}
code{background:#8882;padding:2px 5px;border-radius:4px;font-size:.9em}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:14px}
th,td{border:1px solid #8884;padding:8px;text-align:left;vertical-align:top}
th{background:#8881}
.muted{opacity:.65;font-size:.85em;font-weight:normal}
.note{border-left:3px solid #e0a030;background:#e0a03018;padding:10px 14px;
margin:14px 0;border-radius:4px}
#filter{width:100%;padding:10px;font-size:15px;border-radius:8px;border:1px solid #8886;
background:transparent;color:inherit;margin:8px 0}
nav a{margin-right:12px;font-size:14px}
</style>

<h1>S3XY Buttons 기능 정리</h1>
<nav><a href="/">상태 페이지</a><a href="/control">차량 제어</a><a href="/document">API 문서</a></nav>
<p class="muted">Enhance Auto 의 S3XY Buttons 가 차종·연식별로 지원하는 기능을 정리한 문서입니다.
이 서버의 Fleet API 기능과는 별개이며, 참고용으로만 둡니다.</p>

${filled ? '<input id="filter" type="search" placeholder="기능 검색" autocomplete="off">' : ''}
${S3XY_VEHICLES.map(vehicleSection).join('\n')}

<script>
const filter = document.getElementById('filter');
if (filter) {
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const row of document.querySelectorAll('tbody tr[data-search]')) {
      row.hidden = q !== '' && !row.dataset.search.toLowerCase().includes(q);
    }
    // 남은 행이 없는 표와 그 제목은 함께 숨깁니다.
    for (const table of document.querySelectorAll('table')) {
      const rows = table.querySelectorAll('tbody tr[data-search]');
      if (!rows.length) continue;
      const visible = [...rows].some((r) => !r.hidden);
      table.hidden = !visible;
      const heading = table.previousElementSibling;
      if (heading && heading.tagName === 'H3') heading.hidden = !visible;
    }
  });
}
</script>`;
}
