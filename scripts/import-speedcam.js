#!/usr/bin/env node
// 경찰청 「전국 무인교통단속카메라 표준데이터」 CSV → data/speedcam.json 변환.
//
// 사용법:
//   node scripts/import-speedcam.js <내려받은.csv> [출력.json]
//
// CSV 는 공공데이터포털(data.go.kr)에서 "무인교통단속카메라" 를 검색해 내려받습니다.
// 인코딩(EUC-KR/UTF-8)과 연도별로 조금씩 다른 열 이름을 자동으로 처리하고,
// 제한속도가 있는 카메라만 [위도, 경도, 제한속도] 로 추려 담습니다.

import fs from 'node:fs';

const [, , input, output = 'data/speedcam.json'] = process.argv;
if (!input) {
  console.error('사용법: node scripts/import-speedcam.js <내려받은.csv> [출력.json]');
  process.exit(1);
}

const buf = fs.readFileSync(input);

// 인코딩 판별: UTF-8 로 읽어 깨진 문자(U+FFFD)가 나오면 EUC-KR 로 다시 읽습니다.
let text = buf.toString('utf8');
if (text.includes('�')) text = new TextDecoder('euc-kr').decode(buf);
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM

// 따옴표 안의 쉼표·줄바꿈을 처리하는 최소 CSV 파서
function parseCsv(src) {
  const rows = [];
  let row = [], field = '', inQuote = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuote) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += c;
    } else if (c === '"') inQuote = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const rows = parseCsv(text);
if (rows.length < 2) {
  console.error('CSV 에 데이터 행이 없습니다.');
  process.exit(1);
}

// 열 이름은 연도·지자체별로 조금씩 달라서 키워드로 찾습니다.
const header = rows[0].map((h) => h.trim());
const findCol = (...keywords) =>
  header.findIndex((h) => keywords.some((k) => h.includes(k)));

const latCol = findCol('위도');
const lngCol = findCol('경도');
const limitCol = findCol('제한속도');
const dateCol = findCol('데이터기준일');
if (latCol < 0 || lngCol < 0 || limitCol < 0) {
  console.error(`필요한 열을 찾지 못했습니다. 헤더: ${header.join(', ')}`);
  console.error('위도·경도·제한속도 열이 있는 표준데이터 CSV 인지 확인하세요.');
  process.exit(1);
}

const cameras = [];
let skipped = 0;
for (const row of rows.slice(1)) {
  const lat = Number(row[latCol]);
  const lng = Number(row[lngCol]);
  const limit = Number(row[limitCol]);
  // 한국 밖 좌표·제한속도 없는 카메라(신호 전용 등)는 뺍니다.
  if (!(lat > 32 && lat < 40 && lng > 123 && lng < 132) || !(limit > 0)) {
    skipped++;
    continue;
  }
  cameras.push([Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, limit]);
}

const updated = dateCol >= 0 ? rows[1][dateCol]?.trim() || null : null;
fs.writeFileSync(output, JSON.stringify({ updated, cameras }));
console.log(`카메라 ${cameras.length.toLocaleString()}개 반입 (제외 ${skipped}개) → ${output}`);
if (updated) console.log(`데이터 기준일: ${updated}`);
console.log('서버 재시작 없이 바로 반영됩니다. 페이지를 새로고침하세요.');
