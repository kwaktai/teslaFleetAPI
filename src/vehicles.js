import { config } from './config.js';
import { fleetFetch } from './tesla.js';

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;

// .env 의 VEHICLE_ALIASES="3=5YJ...,X=7SA..." 를 파싱합니다.
function parseAliases(raw) {
  const map = new Map();
  for (const entry of raw.split(',')) {
    const eq = entry.indexOf('=');
    if (eq === -1) continue;
    const name = entry.slice(0, eq).trim().toLowerCase();
    const vin = entry.slice(eq + 1).trim().toUpperCase();
    if (name && vin) map.set(name, vin);
  }
  return map;
}

const aliases = parseAliases(config.vehicleAliases);

// 차량 ID·이름 → VIN 매핑 캐시. 목록을 한 번만 조회하면 됩니다.
const cache = new Map();

export function aliasEntries() {
  return [...aliases.entries()];
}

// 별칭·차량 이름·ID·VIN 중 무엇을 넣어도 VIN 으로 바꿔 줍니다.
// 명령 서명 프록시는 VIN 만 받고, 조회 API 는 VIN 도 받으므로 VIN 으로 통일합니다.
export async function resolveVehicle(tag, listVehicles = () => fleetFetch('/api/1/vehicles')) {
  const raw = String(tag).trim();
  const key = raw.toLowerCase();

  if (aliases.has(key)) return aliases.get(key);
  if (VIN_PATTERN.test(raw)) return raw.toUpperCase();
  if (cache.has(key)) return cache.get(key);

  const { status, body } = await listVehicles();
  if (status !== 200 || !Array.isArray(body?.response)) {
    throw new Error(`차량 목록을 가져오지 못했습니다 (HTTP ${status})`);
  }
  for (const vehicle of body.response) {
    if (!vehicle?.vin) continue;
    cache.set(String(vehicle.id).toLowerCase(), vehicle.vin);
    cache.set(String(vehicle.id_s).toLowerCase(), vehicle.vin);
    if (vehicle.display_name) {
      cache.set(String(vehicle.display_name).trim().toLowerCase(), vehicle.vin);
    }
  }

  const vin = cache.get(key);
  if (!vin) {
    throw new Error(
      `차량을 찾을 수 없습니다: ${raw} (VIN, 차량 ID, 차량 이름, .env 의 VEHICLE_ALIASES 중 하나를 쓰세요)`
    );
  }
  return vin;
}
