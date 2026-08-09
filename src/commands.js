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

// 명령을 서명 프록시로 전달합니다.
// 프록시는 자체 서명 인증서를 쓰므로, 프록시가 생성한 인증서 파일로 검증합니다.
// 인증서를 읽을 수 없으면 검증을 끄는 대신 요청을 거부합니다.
export async function sendCommand(vehicleTag, command, payload) {
  const vin = await resolveVehicle(vehicleTag);
  const body = payload && Object.keys(payload).length ? payload : {};

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
