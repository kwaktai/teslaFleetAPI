// S3XY Buttons(enhauto.com) 기능 정리.
//
// 원본: https://www.enhauto.com/pages/buttons-functions
// 원본 페이지는 차종·연식을 고른 뒤에야 지원 여부(체크/엑스)를 보여 주기 때문에,
// 두 차종의 페이지를 각각 PDF 로 받아 표를 그대로 읽어 옮겼습니다.
//
// 기능 목록과 순서는 두 차종이 완전히 같고, 지원 여부만 다릅니다.
// (원본 표에 같은 이름이 두 번 나오는 항목이 있는데, 원본 그대로 두었습니다.)
//
// functions[] 항목:
//   name      원문 기능 이름
//   ko        한국어 이름
//   desc      한국어 설명 (선택)
//   vehicles  차종별 추가 조건 (선택)
//   support   차종별 지원 여부 { 'model3-2018-2020': true|false, ... }

export const VEHICLES = [
  {
    id: 'model3-2018-2020',
    name: 'Model 3',
    year: '2018–2020',
    source: 'https://www.enhauto.com/pages/buttons-functions#model=model3&&year=2018-2020',
  },
  {
    id: 'modelx-2021-plaid-lr',
    name: 'Model X',
    year: '2021+ Plaid / Long Range',
    source: 'https://www.enhauto.com/pages/buttons-functions#model=modelx&&year=2021+plaid&lr',
  },
];

const M3 = 'model3-2018-2020';
const MX = 'modelx-2021-plaid-lr';

export const CATEGORIES = [
  {
    title: '자동화 (Automations)',
    desc: '한 번 켜두면 조건이 맞을 때 알아서 동작하는 기능들입니다.',
    functions: [
      {
        name: 'Continuous Autopilot',
        ko: '오토파일럿 연속 유지',
        desc: '더블 프레스/풀로 오토파일럿을 켭니다. 차선 변경 후 자동으로 다시 물립니다.',
        vehicles: { [MX]: 'Gen2 커맨더 필요', [M3]: 'Juniper 제외' },
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Autopilot Penalty Prevention',
        ko: '오토파일럿 페널티 방지',
        desc: '140km/h(85mph)를 넘으면 오토파일럿을 자동으로 해제해 페널티를 예방합니다.',
        vehicles: { [MX]: 'Gen2 커맨더 필요' },
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Mute Speed Limit Warning',
        ko: '속도 제한 경고음 끄기',
        desc: '제한속도 초과 알림음을 없앱니다.',
        vehicles: { [MX]: 'Gen2 + 프론트 설치 필요', [M3]: 'Gen2 + 프론트 설치 필요' },
        support: { [M3]: false, [MX]: true },
      },
      { name: 'Ambient Light Effects', ko: '앰비언트 라이트 효과', support: { [M3]: false, [MX]: false } },
      {
        name: 'Park if Unbuckled',
        ko: '안전벨트 풀면 자동 P',
        desc: '운전석 안전벨트를 풀면 자동으로 주차(P)로 전환합니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Long Pull Door Handle',
        ko: '도어 핸들 길게 당기기',
        desc: '앞·뒤 도어 핸들을 길게 당겨 충전구를 열거나 프렁크를 엽니다.',
        support: { [M3]: true, [MX]: false },
      },
      {
        name: 'Half Press Door Handle',
        ko: '도어 핸들 반쯤 누르기',
        desc: '도어 핸들을 반쯤 눌러 충전구 또는 프렁크를 엽니다.',
        vehicles: { [M3]: '2022년 6월 이전 Model 3/Y' },
        support: { [M3]: true, [MX]: false },
      },
      {
        name: 'Kickdown',
        ko: '킥다운 가속 모드 전환',
        desc: '가속 페달을 일정 이상 밟으면 Chill에서 Standard·Sport·Insane·Plaid로 전환합니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Auto Window Drop',
        ko: '문 열 때 창문 자동 내림',
        desc: '문을 열면 해당 창문을 살짝 내려 타고 내리기 편하게 합니다.',
        support: { [M3]: false, [MX]: true },
      },
      {
        name: 'Force Manual High Beam',
        ko: '상향등 수동 강제',
        desc: '오토파일럿 중에도 상향등을 끌 수 있게 합니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Headlight When Raining',
        ko: '비 올 때 전조등 자동',
        desc: '비가 오면 하향등을 자동으로 켭니다.',
        support: { [M3]: false, [MX]: true },
      },
      {
        name: 'Passenger Easy Entry',
        ko: '동승석 이지 엔트리',
        desc: '동승석 승하차 위치를 만듭니다.',
        support: { [M3]: true, [MX]: false },
      },
      {
        name: 'Scroll Wheel Button',
        ko: '스크롤 휠 버튼 기어 변속',
        desc: '스티어링 휠 오른쪽 스크롤 휠 버튼을 기어 변속에 배정합니다.',
        support: { [M3]: false, [MX]: true },
      },
      {
        name: 'Volume Down on Exit',
        ko: '하차 시 볼륨 낮춤',
        desc: '내릴 때 볼륨을 지정 값으로 낮춰, 다음에 탈 때 큰 소리에 놀라지 않게 합니다.',
        support: { [M3]: false, [MX]: true },
      },
      {
        name: 'Force Manual Wipers',
        ko: '와이퍼 수동 강제',
        desc: '오토파일럿 중에도 와이퍼 설정을 그대로 유지합니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Self-Presenting Doors',
        ko: '문 자동 열림',
        desc: '차가 잠겨 있되 깨어 있어야 합니다.',
        support: { [M3]: true, [MX]: false },
      },
      {
        name: 'Self-Presenting Trunk',
        ko: '트렁크 자동 열림',
        desc: '차가 잠겨 있되 깨어 있어야 합니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Safe Bluetooth Connect',
        ko: '안전 블루투스 연결',
        desc: '차가 비어 있을 때 커맨더가 블루투스·와이파이에 새 연결로 노출되지 않습니다.',
        support: { [M3]: true, [MX]: true },
      },
      { name: 'Scan My Tesla Support', ko: 'Scan My Tesla 연동', support: { [M3]: true, [MX]: true } },
    ],
  },
  {
    title: '열기 (Open)',
    functions: [
      { name: 'Glovebox', ko: '글로브박스', desc: 'PIN을 걸어두었더라도 무시하고 열립니다.', support: { [M3]: true, [MX]: true } },
      { name: 'Trunk', ko: '트렁크', support: { [M3]: true, [MX]: true } },
      { name: 'Frunk', ko: '프렁크(앞 트렁크)', support: { [M3]: true, [MX]: true } },
      { name: 'Front Left/Right Door', ko: '앞 좌/우 도어', support: { [M3]: true, [MX]: true } },
      {
        name: 'Rear Left/Right Door',
        ko: '뒤 좌/우 도어',
        desc: '2021년 11월 이전 생산 차량에서는 동작하지 않을 수 있습니다.',
        support: { [M3]: false, [MX]: true },
      },
    ],
  },
  {
    title: '가속 모드 (Acceleration)',
    desc: '상태 변화가 테슬라 화면에는 표시되지 않습니다.',
    functions: [
      { name: 'Toggle', ko: '가속 모드 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Chill', ko: 'Chill', desc: '누를 때마다 Chill로 설정합니다.', support: { [M3]: true, [MX]: true } },
      {
        name: 'Sport',
        ko: 'Sport / Standard',
        desc: '누를 때마다 Sport(Standard)로 설정합니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Plaid',
        ko: 'Plaid',
        desc: '누를 때마다 Plaid로 설정합니다.',
        vehicles: { [MX]: 'Model S/X 전용', [M3]: 'Model S/X 전용 — Model 3 해당 없음' },
        support: { [M3]: false, [MX]: true },
      },
      { name: 'Insane', ko: 'Insane', desc: '누를 때마다 Insane 모드로 설정합니다.', support: { [M3]: false, [MX]: false } },
    ],
  },
  {
    title: '회생 제동 (Regen Braking)',
    desc: '한 번 누르면 해당 값으로, 다시 누르면 기본값으로 돌아갑니다. 화면에는 표시되지 않습니다.',
    functions: [
      { name: '0%', ko: '회생 제동 끄기', support: { [M3]: true, [MX]: true } },
      { name: '25%', ko: '회생 제동 25%', support: { [M3]: true, [MX]: true } },
      { name: '50%', ko: '회생 제동 50%', support: { [M3]: true, [MX]: true } },
      { name: '75%', ko: '회생 제동 75%', support: { [M3]: true, [MX]: true } },
      { name: '100%', ko: '회생 제동 100%', support: { [M3]: true, [MX]: true } },
      { name: 'UP (+25%)', ko: '25% 올리기', support: { [M3]: true, [MX]: true } },
      { name: 'DOWN (-25%)', ko: '25% 내리기', support: { [M3]: true, [MX]: true } },
      { name: 'LOOP UP (+25%)', ko: '25%씩 순환 올리기', support: { [M3]: true, [MX]: true } },
      { name: 'LOOP DOWN (-25%)', ko: '25%씩 순환 내리기', support: { [M3]: true, [MX]: true } },
    ],
  },
  {
    title: '오토파일럿 (Autopilot)',
    functions: [
      { name: 'Cruise Control', ko: '크루즈 컨트롤', desc: '켜기/끄기 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle Autopilot', ko: '오토파일럿 전환', desc: '켜기/끄기 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Autopilot ON', ko: '오토파일럿 켜기', support: { [M3]: true, [MX]: true } },
      {
        name: 'Autopilot Hands-on',
        ko: '핸들 잡기 알림 해제',
        desc: '오토파일럿의 핸들 잡으라는 알림(Nag)을 해제합니다. 미국·캐나다·한국·태국에서 동작합니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Autopilot MAX',
        ko: '오토파일럿 최고 속도',
        desc: '현재 제한속도(오프셋 포함)로 속도를 맞춥니다.',
        vehicles: { [MX]: 'Gen2 필요', [M3]: 'Highland는 Gen2 필요' },
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Follow Distance',
        ko: '차간 거리 설정',
        desc: 'TACC·오토파일럿의 차간 거리를 지정 값으로 바로 바꿉니다.',
        vehicles: { [MX]: 'Gen2 커맨더 + 프론트 설치 필요', [M3]: 'Gen2 커맨더 + 프론트 설치 필요' },
        support: { [M3]: false, [MX]: true },
      },
    ],
  },
  {
    title: '미디어 (Media)',
    functions: [
      { name: 'Volume Down', ko: '볼륨 내리기', support: { [M3]: true, [MX]: true } },
      { name: 'Volume Up', ko: '볼륨 올리기', support: { [M3]: true, [MX]: true } },
      { name: 'Next Song', ko: '다음 곡', support: { [M3]: true, [MX]: true } },
      { name: 'Previous Song', ko: '이전 곡', support: { [M3]: true, [MX]: true } },
      { name: 'Play / Pause / Mute', ko: '재생 / 일시정지 / 음소거', support: { [M3]: true, [MX]: true } },
    ],
  },
  {
    title: '충전 (Charging)',
    functions: [
      {
        name: 'Charge Port',
        ko: '충전구',
        desc: '열기·닫기. 케이블이 꽂혀 있으면 잠금 해제로 동작합니다.',
        support: { [M3]: true, [MX]: true },
      },
      { name: 'Battery Pre-Heating', ko: '배터리 예열', support: { [M3]: true, [MX]: true } },
    ],
  },
  {
    title: '사이드미러 (Mirrors)',
    functions: [
      { name: 'Tilt mirrors', ko: '미러 기울임', desc: '자동/끄기 전환. 후진(R)에서만 동작합니다.', support: { [M3]: true, [MX]: false } },
      { name: 'Dim Mirrors', ko: '미러 방현', desc: '어두울 때만 동작. 끄기/자동 전환', support: { [M3]: true, [MX]: false } },
      { name: 'Fold mirrors', ko: '미러 접기', support: { [M3]: true, [MX]: false } },
    ],
  },
  {
    title: '시트 조절 (Seat Adjustment)',
    functions: [
      {
        name: 'Seat',
        ko: '시트 앞뒤 이동',
        vehicles: { [MX]: '동승석만 가능', [M3]: '운전석·동승석' },
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Backrest',
        ko: '등받이 각도',
        vehicles: { [MX]: '동승석만 가능', [M3]: '운전석·동승석' },
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Both',
        ko: '시트 + 등받이 동시',
        vehicles: { [MX]: '동승석만 가능', [M3]: '운전석·동승석' },
        support: { [M3]: true, [MX]: true },
      },
      { name: 'Left Seat Profile', ko: '앞 좌측 시트 프로필', desc: '최대 4개까지 저장', support: { [M3]: true, [MX]: true } },
      { name: 'Right Seat Profile', ko: '앞 우측 시트 프로필', desc: '최대 4개까지 저장', support: { [M3]: true, [MX]: true } },
    ],
  },
  {
    title: '시트 열선 (Heated Seats)',
    desc: '출고 시 해당 옵션이 있는 차량에서만 동작합니다.',
    functions: [
      { name: 'Toggle Front Left', ko: '앞 좌측 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle Front Right', ko: '앞 우측 전환', support: { [M3]: true, [MX]: true } },
      { name: 'On / Off Rear Left', ko: '뒤 좌측 켜기/끄기', support: { [M3]: false, [MX]: true } },
      { name: 'Toggle Rear Center', ko: '뒤 가운데 전환', support: { [M3]: true, [MX]: true } },
      { name: 'All Rear Off', ko: '뒷좌석 전체 끄기', support: { [M3]: false, [MX]: true } },
      { name: 'Toggle Rear Right', ko: '뒤 우측 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle All Rear', ko: '뒷좌석 전체 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle Front Right', ko: '앞 우측 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle Rear Left', ko: '뒤 좌측 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle Rear Center', ko: '뒤 가운데 전환', support: { [M3]: true, [MX]: true } },
      { name: 'All Heaters Off', ko: '열선 전체 끄기', support: { [M3]: false, [MX]: true } },
    ],
  },
  {
    title: '시트 통풍 (Seat Cooling)',
    functions: [
      { name: 'Toggle Front Left', ko: '앞 좌측 전환', support: { [M3]: false, [MX]: true } },
      { name: 'Toggle Front Right', ko: '앞 우측 전환', support: { [M3]: false, [MX]: true } },
      { name: 'On / Off Front Left', ko: '앞 좌측 켜기/끄기', desc: '해당 옵션 장착 차량만', support: { [M3]: false, [MX]: true } },
      { name: 'On / Off Front Right', ko: '앞 우측 켜기/끄기', desc: '해당 옵션 장착 차량만', support: { [M3]: false, [MX]: true } },
    ],
  },
  {
    title: '공조 (Climate Control)',
    functions: [
      { name: 'Rear FAN toggle', ko: '뒷좌석 송풍 전환', desc: '화면에는 표시되지 않습니다.', support: { [M3]: true, [MX]: true } },
      { name: 'Fan speed -', ko: '풍량 1단계 내리기', desc: '화면에는 표시되지 않습니다.', support: { [M3]: true, [MX]: true } },
      { name: 'Fan speed +', ko: '풍량 1단계 올리기', desc: '화면에는 표시되지 않습니다.', support: { [M3]: true, [MX]: true } },
      { name: 'Fan speed -3', ko: '풍량 3단계 내리기', desc: '화면에는 표시되지 않습니다.', support: { [M3]: true, [MX]: true } },
      { name: 'Fan speed +3', ko: '풍량 3단계 올리기', desc: '화면에는 표시되지 않습니다.', support: { [M3]: true, [MX]: true } },
      { name: 'Fan speed MIN', ko: '풍량 최소', desc: '화면에는 표시되지 않습니다.', support: { [M3]: true, [MX]: true } },
      { name: 'Fan speed MAX', ko: '풍량 최대', desc: '화면에는 표시되지 않습니다.', support: { [M3]: true, [MX]: true } },
      {
        name: 'Recirculation On',
        ko: '내기 순환 켜기',
        desc: 'HVAC이 Auto여야 상태가 보입니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Recirculation Toggle',
        ko: '내기 순환 전환',
        desc: 'HVAC이 Auto여야 상태가 보입니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Recirculation Off',
        ko: '내기 순환 끄기',
        desc: 'HVAC이 Auto여야 상태가 보입니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Steering Wheel Heater',
        ko: '스티어링 휠 열선',
        desc: '해당 옵션 장착 차량만. 화면에는 표시되지 않습니다.',
        support: { [M3]: true, [MX]: true },
      },
      { name: 'AC Toggle', ko: '에어컨 전환', desc: 'HVAC이 Auto여야 상태가 보입니다.', support: { [M3]: true, [MX]: true } },
      { name: 'AC On', ko: '에어컨 켜기', desc: 'HVAC이 Auto여야 상태가 보입니다.', support: { [M3]: true, [MX]: true } },
      { name: 'AC Off', ko: '에어컨 끄기', desc: 'HVAC이 Auto여야 상태가 보입니다.', support: { [M3]: true, [MX]: true } },
      {
        name: 'Defog/Defrost',
        ko: '김서림 / 성에 제거',
        desc: '한 번 누르면 김서림 제거, 두 번째는 성에 제거. 화면에는 표시되지 않습니다.',
        support: { [M3]: true, [MX]: true },
      },
      { name: 'Bioweapon Defence', ko: '생화학 방어 모드', desc: '차량과 페어링 필요', support: { [M3]: false, [MX]: true } },
      { name: 'Keep Climate On', ko: '공조 유지', desc: '차량과 페어링 필요', support: { [M3]: true, [MX]: true } },
      { name: 'Dog Mode', ko: '반려동물 모드', desc: '차량과 페어링 필요', support: { [M3]: true, [MX]: true } },
      { name: 'Camp Mode', ko: '캠프 모드', desc: '차량과 페어링 필요', support: { [M3]: true, [MX]: true } },
      { name: 'Climate System On/Off', ko: '공조 전체 켜기/끄기', support: { [M3]: true, [MX]: true } },
      {
        name: 'Windows Vent',
        ko: '창문 환기',
        desc: '창문 4개를 조금 열거나 닫습니다. 주차(P)에서만 동작하며 차량과 페어링이 필요합니다.',
        support: { [M3]: true, [MX]: true },
      },
      { name: 'Left Air Vent Toggle', ko: '좌측 송풍구 전환', support: { [M3]: false, [MX]: false } },
      { name: 'Left Air Vent Off', ko: '좌측 송풍구 끄기', support: { [M3]: false, [MX]: false } },
      { name: 'Right Air Vent toggle', ko: '우측 송풍구 전환', support: { [M3]: false, [MX]: false } },
      { name: 'Right Air Vent Off', ko: '우측 송풍구 끄기', support: { [M3]: false, [MX]: false } },
    ],
  },
  {
    title: '정차 모드 (Stopping Mode)',
    functions: [
      { name: 'Creep', ko: '크리프', support: { [M3]: true, [MX]: false } },
      { name: 'Hold', ko: '홀드', support: { [M3]: true, [MX]: false } },
      { name: 'Roll', ko: '롤', support: { [M3]: true, [MX]: false } },
    ],
  },
  {
    title: '구동 · 트랙션 (Traction Control)',
    functions: [
      { name: 'Off-Road', ko: '오프로드 모드', desc: 'AWD 모델만 동작합니다.', support: { [M3]: true, [MX]: false } },
      { name: 'Slip Start', ko: '슬립 스타트', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle', ko: '가속 모드 전환', support: { [M3]: true, [MX]: false } },
      {
        name: 'Drift Mode',
        ko: '드리프트 모드',
        desc: '주차(P)에서만 켜고 끌 수 있습니다. ESP를 끄므로 주의해서 사용하세요.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Drift Mode PRO',
        ko: '드리프트 모드 PRO',
        desc: '주차(P)에서만 켜고 끌 수 있습니다. 앞 모터와 ESP를 끄므로 주의해서 사용하세요.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Disable Front Motor',
        ko: '앞 모터 끄기',
        desc: '주차(P)에서만 전환 가능. 장거리·고속 주행에는 권장하지 않습니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Disable Rear Motor',
        ko: '뒤 모터 끄기',
        desc: '주차(P)에서만 전환 가능. 장거리·고속 주행에는 권장하지 않습니다.',
        support: { [M3]: true, [MX]: true },
      },
    ],
  },
  {
    title: '서스펜션 (Suspension)',
    desc: '에어 서스펜션 장착 차량에서만 의미가 있습니다.',
    vehicles: { [M3]: 'Model 3에는 에어 서스펜션이 없어 해당하지 않습니다.' },
    functions: [
      { name: 'High', ko: '높게', support: { [M3]: false, [MX]: true } },
      { name: 'Low', ko: '낮게', support: { [M3]: false, [MX]: true } },
      { name: 'Medium', ko: '보통', support: { [M3]: false, [MX]: true } },
      { name: 'Very High', ko: '아주 높게', support: { [M3]: false, [MX]: true } },
      { name: 'Very Low', ko: '아주 낮게', support: { [M3]: false, [MX]: true } },
    ],
  },
  {
    title: '기어 변속 (Gear Shift)',
    functions: [
      { name: 'Shift to D', ko: 'D단', support: { [M3]: true, [MX]: true } },
      { name: 'Shift to N', ko: 'N단', support: { [M3]: true, [MX]: true } },
      { name: 'Shift to P', ko: 'P단', support: { [M3]: true, [MX]: true } },
      { name: 'Shift to R', ko: 'R단', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle D-R', ko: 'D ↔ R 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle P-D', ko: 'P ↔ D 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle P-R', ko: 'P ↔ R 전환', support: { [M3]: true, [MX]: true } },
    ],
  },
  {
    title: '와이퍼 (Wipers)',
    functions: [
      { name: 'Single Wipe', ko: '1회 작동', support: { [M3]: true, [MX]: true } },
      { name: 'Washers', ko: '워셔액 분사', support: { [M3]: true, [MX]: true } },
      { name: 'Standard Increase +1', ko: '1단계 올리기', support: { [M3]: true, [MX]: true } },
      { name: 'Standard Decrease -1', ko: '1단계 내리기', support: { [M3]: true, [MX]: true } },
      { name: 'Standard Loop +1 / -1', ko: '단계 순환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle OFF', ko: '끄기 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle 1', ko: '1단 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle 2', ko: '2단 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle 3', ko: '3단 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Toggle 4', ko: '4단 전환', support: { [M3]: true, [MX]: true } },
      { name: 'Set OFF', ko: '끄기', support: { [M3]: true, [MX]: true } },
      { name: 'Set to 2', ko: '2단 설정', support: { [M3]: true, [MX]: true } },
      { name: 'Set to 3', ko: '3단 설정', support: { [M3]: true, [MX]: true } },
      { name: 'Set to 4', ko: '4단 설정', support: { [M3]: true, [MX]: true } },
      { name: 'Return to AUTO', ko: '자동으로 복귀', support: { [M3]: true, [MX]: true } },
    ],
  },
  {
    title: '전조등 (Headlights)',
    functions: [
      { name: 'High Beam', ko: '상향등', desc: '전조등 설정이 하향등 또는 자동일 때만 동작합니다.', support: { [M3]: true, [MX]: true } },
      { name: 'High Beam Flash', ko: '상향등 패싱', support: { [M3]: true, [MX]: true } },
      { name: 'High Beam Strobe', ko: '상향등 연속 점멸', desc: '2~10회 연속으로 깜빡입니다.', support: { [M3]: true, [MX]: true } },
      { name: 'Low Beam', ko: '하향등', support: { [M3]: true, [MX]: true } },
      { name: 'Front Fog Lights', ko: '앞 안개등', desc: '[베타] 해당 옵션 장착 차량만', support: { [M3]: true, [MX]: true } },
      {
        name: 'Rear Fog Lights',
        ko: '뒤 안개등',
        desc: '[베타] 해당 옵션 장착 차량만. 일부 차량에서 깜빡임이 생길 수 있습니다.',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Dynamic Brake lights',
        ko: '다이내믹 브레이크등',
        desc: '실제로 제동하지 않고 후미등만 깜빡여 뒤차에 신호를 보냅니다.',
        support: { [M3]: false, [MX]: true },
      },
    ],
  },
  {
    title: '조작 편의 (Accessibility)',
    functions: [
      { name: 'Hazard Lights', ko: '비상등', support: { [M3]: true, [MX]: true } },
      { name: 'Left Turn Signal', ko: '좌측 방향지시등', support: { [M3]: true, [MX]: false } },
      { name: 'Right Turn Signal', ko: '우측 방향지시등', support: { [M3]: true, [MX]: false } },
      { name: 'Voice Command', ko: '음성 명령', support: { [M3]: true, [MX]: true } },
      { name: 'Very Short Honk', ko: '아주 짧은 경적', support: { [M3]: true, [MX]: true } },
      { name: 'Short Honk', ko: '짧은 경적', support: { [M3]: true, [MX]: true } },
      { name: 'Long Honk', ko: '긴 경적', support: { [M3]: true, [MX]: true } },
      { name: 'Short Left Turn Signal', ko: '좌측 방향지시등 짧게', support: { [M3]: true, [MX]: true } },
      { name: 'Short Right Turn Signal', ko: '우측 방향지시등 짧게', support: { [M3]: true, [MX]: true } },
      { name: 'Front Camera View', ko: '전방 카메라 보기', support: { [M3]: false, [MX]: false } },
      { name: 'Rear View Camera', ko: '후방 카메라 보기', support: { [M3]: false, [MX]: false } },
    ],
  },
  {
    title: '잠금 (Lock / Unlock)',
    functions: [
      { name: 'Toggle', ko: '가속 모드 전환', support: { [M3]: true, [MX]: false } },
      { name: 'Unlock', ko: '잠금 해제', desc: '운전자가 차 안에 있어야 합니다.', support: { [M3]: true, [MX]: false } },
      { name: 'Lock', ko: '잠금', support: { [M3]: true, [MX]: false } },
      { name: 'Child Unlock Both', ko: '차일드록 양쪽 해제', desc: '화면에는 표시되지 않습니다.', support: { [M3]: true, [MX]: false } },
      { name: 'Child Unlock Right', ko: '차일드록 우측 해제', desc: '화면에는 표시되지 않습니다.', support: { [M3]: true, [MX]: false } },
      { name: 'Child Unlock Left', ko: '차일드록 좌측 해제', desc: '화면에는 표시되지 않습니다.', support: { [M3]: true, [MX]: false } },
    ],
  },
  {
    title: '화면 각도 (Screen Tilt)',
    functions: [
      { name: 'Left / Right', ko: '좌 / 우 기울임', desc: '해당 옵션 장착 차량만', support: { [M3]: false, [MX]: true } },
    ],
  },
  {
    title: '기타 (Others)',
    functions: [
      { name: 'Thank you!', ko: '감사 표시', desc: '비상등을 1~3회 깜빡입니다.', support: { [M3]: true, [MX]: false } },
      {
        name: 'Interior Lights',
        ko: '실내등',
        desc: '[베타] 일부 차량에서 깜빡임이 생길 수 있습니다.',
        support: { [M3]: true, [MX]: true },
      },
      { name: 'Park Brake', ko: '주차 브레이크', support: { [M3]: true, [MX]: true } },
      { name: 'Track Mode', ko: '트랙 모드', desc: 'Performance · Plaid 모델용', support: { [M3]: true, [MX]: false } },
      {
        name: 'Light Strip Brightness',
        ko: 'LED 스트립 밝기',
        desc: '25% 단위로 조절합니다.',
        support: { [M3]: false, [MX]: false },
      },
      { name: 'Grok', ko: 'Grok 실행', desc: '사용 가능한 차량에서만', support: { [M3]: true, [MX]: true } },
      {
        name: 'Hand Wash',
        ko: '손세차 모드',
        desc: '차를 잠그지 않은 채 충전구를 잠그고 창문을 올리며, 사이드미러는 펴 둡니다.',
        support: { [M3]: false, [MX]: true },
      },
    ],
  },
  {
    title: '계기판 (Dashboard)',
    desc: 'Gen2 커맨더와 프론트 설치가 필요한 항목이 많습니다.',
    functions: [
      {
        name: 'Autopilot Nag',
        ko: '오토파일럿 알림 표시',
        desc: '핸들 잡기 알림을 계기판에 깜빡임으로 표시합니다. Gen2 + 프론트 설치 필요',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Blind Spot',
        ko: '사각지대 표시',
        desc: '계기판 양쪽에 사각지대 표시를 띄웁니다. Gen2 + 프론트 설치 필요',
        support: { [M3]: true, [MX]: true },
      },
      {
        name: 'Speed Limit Signs',
        ko: '제한속도 표지 표시',
        desc: '계기판 왼쪽에 제한속도 표지를 표시합니다. Gen2 + 프론트 설치 필요',
        support: { [M3]: true, [MX]: true },
      },
      { name: 'Franks Mode', ko: 'Franks 모드', desc: '방향지시등 표시를 크게 보여줍니다.', support: { [M3]: true, [MX]: true } },
      { name: 'Brake Light', ko: '브레이크등 표시', support: { [M3]: true, [MX]: true } },
    ],
  },
];

export const FUNCTION_COUNT = CATEGORIES.reduce((n, c) => n + c.functions.length, 0);

// 해당 차종이 지원하는 기능 수
export function supportedCount(vehicleId) {
  return CATEGORIES.reduce(
    (n, c) => n + c.functions.filter((f) => f.support?.[vehicleId]).length,
    0
  );
}
