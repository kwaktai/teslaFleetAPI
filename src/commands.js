import fs from 'node:fs';
import https from 'node:https';
import { config, proxyCaPath } from './config.js';
import { fleetFetch, getAccessToken } from './tesla.js';

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

// 서명 프록시는 경로에 VIN을 요구하지만, 조회 API는 차량 ID를 씁니다.
// 사용자가 어느 쪽을 넣어도 동작하도록 ID를 VIN으로 바꿔줍니다.
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;
const vinById = new Map();

// listVehicles 는 테스트에서 갈아끼울 수 있도록 인자로 받습니다.
export async function resolveVin(vehicleTag, listVehicles = () => fleetFetch('/api/1/vehicles')) {
  const tag = String(vehicleTag);
  if (VIN_PATTERN.test(tag)) return tag.toUpperCase();
  if (vinById.has(tag)) return vinById.get(tag);

  const { status, body } = await listVehicles();
  if (status !== 200 || !Array.isArray(body?.response)) {
    throw new Error(`차량 목록을 가져오지 못했습니다 (HTTP ${status})`);
  }
  for (const vehicle of body.response) {
    if (!vehicle?.vin) continue;
    vinById.set(String(vehicle.id), vehicle.vin);
    vinById.set(String(vehicle.id_s), vehicle.vin);
  }

  const vin = vinById.get(tag);
  if (!vin) throw new Error(`차량을 찾을 수 없습니다: ${tag}`);
  return vin;
}

// 명령을 서명 프록시로 전달합니다.
// 프록시는 자체 서명 인증서를 쓰므로, 프록시가 생성한 인증서 파일로 검증합니다.
// 인증서를 읽을 수 없으면 검증을 끄는 대신 요청을 거부합니다.
export async function sendCommand(vehicleTag, command, payload) {
  if (!proxyReady()) {
    throw new Error(
      `프록시 인증서를 찾을 수 없습니다 (${proxyCaPath}). ` +
        'tesla-http-proxy 컨테이너가 실행 중인지 확인하세요.'
    );
  }

  const vin = await resolveVin(vehicleTag);
  const token = await getAccessToken();
  const ca = fs.readFileSync(proxyCaPath);
  const url = new URL(config.proxyUrl);
  const body = JSON.stringify(payload && Object.keys(payload).length ? payload : {});
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
          'Content-Length': Buffer.byteLength(body),
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
    req.write(body);
    req.end();
  });
}
