import fs from 'node:fs';
import https from 'node:https';
import { config, proxyCaPath } from './config.js';
import { REST_COMMANDS } from './catalog.js';
import { fleetFetch, getAccessToken } from './tesla.js';
import { resolveVehicle } from './vehicles.js';

// 자주 쓰는 명령 목록 (상태 페이지 안내용). 여기 없는 명령도 그대로 전달됩니다.
export const COMMON_COMMANDS = [
  ['door_lock', '문 잠금'],
  ['door_unlock', '문 잠금 해제'],
  ['auto_conditioning_start', '공조 켜기'],
  ['auto_conditioning_stop', '공조 끄기'],
  ['set_temps', '온도 설정 (driver_temp, passenger_temp)'],
  ['charge_start', '충전 시작'],
  ['charge_stop', '충전 중지'],
  ['set_charge_limit', '충전 한도 설정 (percent)'],
  ['flash_lights', '전조등 깜빡이기'],
  ['honk_horn', '경적'],
];

export function proxyReady() {
  return fs.existsSync(proxyCaPath);
}

// 명령 한 번을 실제로 전달합니다.
// 프록시는 자체 서명 인증서를 쓰므로, 프록시가 생성한 인증서 파일로 검증합니다.
// 인증서를 읽을 수 없으면 검증을 끄는 대신 요청을 거부합니다.
async function deliver(vin, command, body) {
  // 프록시가 구현하지 않은 명령은 서명 없이 Fleet API 로 바로 보냅니다.
  // 차량이 서명을 요구하면 Tesla 가 거부하므로 응답을 그대로 전달합니다.
  if (REST_COMMANDS.has(command)) {
    return fleetFetch(
      `/api/1/vehicles/${encodeURIComponent(vin)}/command/${encodeURIComponent(command)}`,
      { method: 'POST', body }
    );
  }

  if (!proxyReady()) {
    throw new Error(
      `프록시 인증서를 찾을 수 없습니다 (${proxyCaPath}). ` +
        'tesla-http-proxy 컨테이너가 실행 중인지 확인하세요.'
    );
  }

  const token = await getAccessToken();
  const ca = fs.readFileSync(proxyCaPath);
  const url = new URL(config.proxyUrl);
  const payloadJson = JSON.stringify(body);
  const path =
    `/api/1/vehicles/${encodeURIComponent(vin)}` +
    `/command/${encodeURIComponent(command)}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path,
        method: 'POST',
        ca,
        servername: url.hostname,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadJson),
        },
        timeout: 30_000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // 프록시가 평문 오류를 돌려주는 경우 그대로 전달합니다.
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('프록시 응답 시간 초과 (차량이 잠들어 있을 수 있습니다)'));
    });
    req.on('error', reject);
    req.write(payloadJson);
    req.end();
  });
}

// 차량이 잠들어 있어 명령이 거부된 응답인지 판별합니다.
// Tesla 는 408 로 답하기도 하고, 200 본문에 오류 문자열을 담아 오기도 합니다.
const ASLEEP_PATTERN = /vehicle unavailable|asleep|offline|not awake|unavailable for/i;

function looksAsleep(result) {
  if (result.status === 408) return true;
  const error = result.body?.error;
  return typeof error === 'string' && ASLEEP_PATTERN.test(error);
}

const WAKE_TIMEOUT_MS = Number(process.env.WAKE_TIMEOUT_SECONDS || 30) * 1000;
const WAKE_POLL_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 차량이 online 이 될 때까지 기다립니다. 온라인이면 즉시 true 를 돌려줍니다.
async function waitUntilOnline(vin) {
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { status, body } = await fleetFetch(`/api/1/vehicles/${encodeURIComponent(vin)}`);
    if (status === 200 && body?.response?.state === 'online') return true;
    await sleep(WAKE_POLL_MS);
  }
  return false;
}

// 명령을 보냅니다.
// wake 가 true 면, 차량이 자고 있어 실패한 경우에만 깨운 뒤 한 번 재시도합니다.
// 이미 깨어 있으면 추가 호출 없이 첫 시도로 끝나므로 지연이 없습니다.
export async function sendCommand(vehicleTag, command, payload, { wake = false } = {}) {
  const vin = await resolveVehicle(vehicleTag);
  const body = payload && Object.keys(payload).length ? payload : {};

  const first = await deliver(vin, command, body);
  if (!wake || !looksAsleep(first)) return first;

  await fleetFetch(`/api/1/vehicles/${encodeURIComponent(vin)}/wake_up`, { method: 'POST' });
  if (!(await waitUntilOnline(vin))) {
    // 제한 시간 안에 깨어나지 않으면 원래 응답을 그대로 돌려줍니다.
    return first;
  }
  return deliver(vin, command, body);
}
