import { fleetFetch } from './tesla.js';
import { DEFAULT_ENDPOINTS, products, vehicleData, wakeUp } from './ownerApi.js';
import { ownerAccessToken, ownerVehicleId } from './ownerStore.js';

// 조회와 깨우기는 Fleet API 요금이 붙는 항목입니다.
// Owner API 가 연결되어 있으면 그쪽을 먼저 쓰고, 실패하면 Fleet API 로 넘어갑니다.
// 명령(door_lock 등)은 서명이 필요하므로 항상 Fleet API 를 씁니다.
async function viaOwner(vin, run) {
  const token = await ownerAccessToken();
  if (!token) return null;
  try {
    const id = await ownerVehicleId(token, vin);
    if (!id) return null;
    const result = await run(token, id);
    // 401/403 이면 Owner API 가 막힌 것이므로 Fleet API 로 넘깁니다.
    // 408(차량 절전)은 정상 응답이므로 그대로 전달합니다.
    if (result.status === 401 || result.status === 403) {
      console.warn(`Owner API 거부 (HTTP ${result.status}) — Fleet API 로 전환합니다.`);
      return null;
    }
    return { ...result, source: 'owner' };
  } catch (e) {
    console.warn(`Owner API 호출 실패: ${e.message} — Fleet API 로 전환합니다.`);
    return null;
  }
}

// 차량 목록도 과금 대상(데이터)입니다. 제어 페이지가 열릴 때마다 부르므로
// Owner API 가 있으면 그쪽에서 받아옵니다. products 응답은 Fleet 의 차량 항목과
// 필드 구성이 사실상 같아 그대로 돌려줘도 됩니다.
export async function readVehicleList() {
  const token = await ownerAccessToken();
  if (token) {
    try {
      const list = await products(token);
      return { status: 200, body: { response: list, count: list.length }, source: 'owner' };
    } catch (e) {
      console.warn(`Owner API 차량 목록 실패: ${e.message} — Fleet API 로 전환합니다.`);
    }
  }
  const result = await fleetFetch('/api/1/vehicles');
  return { ...result, source: 'fleet' };
}

export async function readVehicleData(vin, endpoints = DEFAULT_ENDPOINTS) {
  const owner = await viaOwner(vin, (token, id) => vehicleData(token, id, endpoints));
  if (owner) return owner;

  const result = await fleetFetch(`/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data`);
  return { ...result, source: 'fleet' };
}

export async function requestWake(vin) {
  const owner = await viaOwner(vin, (token, id) => wakeUp(token, id));
  if (owner) return owner;

  const result = await fleetFetch(`/api/1/vehicles/${encodeURIComponent(vin)}/wake_up`, {
    method: 'POST',
  });
  return { ...result, source: 'fleet' };
}

// 차량이 online 인지만 확인합니다. 깨우기 후 폴링에 쓰이므로 호출이 잦아,
// Owner API 가 있으면 반드시 그쪽으로 보냅니다 (Fleet API 는 요청마다 과금).
export async function readVehicleState(vin) {
  const token = await ownerAccessToken();
  if (token) {
    try {
      const found = (await products(token)).find(
        (item) => item.vin.toUpperCase() === vin.toUpperCase()
      );
      if (found?.state) return found.state;
    } catch (e) {
      console.warn(`Owner API 상태 조회 실패: ${e.message} — Fleet API 로 전환합니다.`);
    }
  }
  const { status, body } = await fleetFetch(`/api/1/vehicles/${encodeURIComponent(vin)}`);
  return status === 200 ? body?.response?.state ?? null : null;
}
