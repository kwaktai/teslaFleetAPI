// 환경변수 기반 설정
const REGION_AUDIENCE = {
  na: 'https://fleet-api.prd.na.vn.cloud.tesla.com', // 북미 + 아시아·태평양(한국 포함, 중국 제외)
  eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com', // 유럽, 중동, 아프리카
  cn: 'https://fleet-api.prd.cn.vn.cloud.tesla.cn',  // 중국
};

const region = (process.env.TESLA_REGION || 'na').toLowerCase();
if (!REGION_AUDIENCE[region]) {
  throw new Error(`TESLA_REGION 값이 잘못되었습니다: ${region} (na/eu/cn 중 하나여야 합니다)`);
}

export const config = {
  port: Number(process.env.PORT || 8080),
  clientId: process.env.TESLA_CLIENT_ID || '',
  clientSecret: process.env.TESLA_CLIENT_SECRET || '',
  // Tesla 개발자 포털에 등록한 도메인 (예: mynas.synology.me)
  domain: process.env.TESLA_DOMAIN || '',
  region,
  audience: REGION_AUDIENCE[region],
  authBase: 'https://auth.tesla.com/oauth2/v3',
  tokenUrl: 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token',
  scopes:
    process.env.TESLA_SCOPES ||
    'openid offline_access user_data vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds',
  dataDir: process.env.DATA_DIR || '/data',
  // 비워두면 첫 실행 시 자동 생성되어 data/api-key.txt 에 보관됩니다.
  apiKey: (process.env.API_KEY || '').trim(),
  // 명령 서명 프록시 (tesla-http-proxy). 도커 내부 네트워크에서만 접근합니다.
  proxyUrl: process.env.COMMAND_PROXY_URL || 'https://tesla-http-proxy:4443',
};

// 프록시가 생성한 자체 서명 인증서. 이 파일로 프록시를 검증합니다.
export const proxyCaPath = `${config.dataDir}/proxy/cert.pem`;

export function redirectUri() {
  return `https://${config.domain}/auth/callback`;
}

export function assertConfigured() {
  const missing = [];
  if (!config.clientId) missing.push('TESLA_CLIENT_ID');
  if (!config.clientSecret) missing.push('TESLA_CLIENT_SECRET');
  if (!config.domain) missing.push('TESLA_DOMAIN');
  return missing;
}
