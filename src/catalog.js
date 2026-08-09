// 이 파일은 tesla-http-proxy(vehicle-command v0.4.1) 소스에서 추출한 명령 목록입니다.
// route:
//   'proxy' — 서명 프록시가 개인키로 서명해 전송 (2021년 이후 차량에 필요)
//   'rest'  — 프록시가 구현하지 않은 명령. 서명 없이 Fleet API 로 직접 전달하므로
//             차량이 서명을 요구하면 Tesla 가 거부할 수 있습니다.

export const COMMAND_GROUPS = [
  {
    title: "도어 · 트렁크 · 창문",
    commands: [
      { name: "door_lock", label: "문 잠금", params: [], choices: [], route: "proxy" },
      { name: "door_unlock", label: "문 잠금 해제", params: [], choices: [], route: "proxy" },
      { name: "actuate_trunk", label: "트렁크/프렁크 열기", params: [{"name": "which_trunk", "type": "문자열", "required": false}], choices: ["front", "rear"], route: "proxy" },
      { name: "window_control", label: "창문 열기(환기)/닫기", params: [{"name": "command", "type": "문자열", "required": true}], choices: ["close", "vent"], route: "proxy" },
      { name: "charge_port_door_open", label: "충전구 열기", params: [], choices: [], route: "proxy" },
      { name: "charge_port_door_close", label: "충전구 닫기", params: [], choices: [], route: "proxy" },
      { name: "open_tonneau", label: "적재함 커버 열기 (사이버트럭)", params: [], choices: [], route: "proxy" },
      { name: "close_tonneau", label: "적재함 커버 닫기 (사이버트럭)", params: [], choices: [], route: "proxy" },
      { name: "stop_tonneau", label: "적재함 커버 정지 (사이버트럭)", params: [], choices: [], route: "proxy" },
    ],
  },
  {
    title: "공조 · 시트",
    commands: [
      { name: "auto_conditioning_start", label: "공조 켜기", params: [], choices: [], route: "proxy" },
      { name: "auto_conditioning_stop", label: "공조 끄기", params: [], choices: [], route: "proxy" },
      { name: "set_temps", label: "운전석/조수석 온도 설정", params: [{"name": "driver_temp", "type": "숫자", "required": false}, {"name": "passenger_temp", "type": "숫자", "required": false}], choices: [], route: "proxy" },
      { name: "set_preconditioning_max", label: "최대 예열/예냉", params: [{"name": "on", "type": "참/거짓", "required": true}, {"name": "manual_override", "type": "참/거짓", "required": false}], choices: [], route: "proxy" },
      { name: "set_climate_keeper_mode", label: "climate keeper 모드 (반려동물·캠프)", params: [{"name": "climate_keeper_mode", "type": "숫자", "required": true}, {"name": "manual_override", "type": "참/거짓", "required": false}], choices: [], route: "proxy" },
      { name: "set_bioweapon_mode", label: "생화학 방어 모드", params: [{"name": "on", "type": "참/거짓", "required": true}, {"name": "manual_override", "type": "참/거짓", "required": true}], choices: [], route: "proxy" },
      { name: "set_cabin_overheat_protection", label: "실내 과열 방지", params: [{"name": "on", "type": "참/거짓", "required": true}, {"name": "fan_only", "type": "참/거짓", "required": false}], choices: [], route: "proxy" },
      { name: "set_cop_temp", label: "과열 방지 기준 온도", params: [{"name": "cop_temp", "type": "숫자", "required": true}], choices: [], route: "proxy" },
      { name: "remote_seat_heater_request", label: "시트 열선", params: [], choices: [], route: "proxy" },
      { name: "remote_seat_cooler_request", label: "시트 통풍", params: [], choices: [], route: "proxy" },
      { name: "remote_auto_seat_climate_request", label: "시트 자동 온도 조절", params: [], choices: [], route: "proxy" },
      { name: "remote_steering_wheel_heater_request", label: "스티어링 휠 열선", params: [{"name": "on", "type": "참/거짓", "required": true}], choices: [], route: "proxy" },
    ],
  },
  {
    title: "충전",
    commands: [
      { name: "charge_start", label: "충전 시작", params: [], choices: [], route: "proxy" },
      { name: "charge_stop", label: "충전 중지", params: [], choices: [], route: "proxy" },
      { name: "set_charge_limit", label: "충전 한도 설정", params: [{"name": "percent", "type": "숫자", "required": true}], choices: [], route: "proxy" },
      { name: "set_charging_amps", label: "충전 전류 설정", params: [{"name": "charging_amps", "type": "숫자", "required": true}], choices: [], route: "proxy" },
      { name: "charge_max_range", label: "최대 충전 모드", params: [], choices: [], route: "proxy" },
      { name: "charge_standard", label: "표준 충전 모드", params: [], choices: [], route: "proxy" },
      { name: "set_scheduled_charging", label: "예약 충전", params: [{"name": "enable", "type": "참/거짓", "required": true}], choices: [], route: "proxy" },
      { name: "set_scheduled_departure", label: "출발 시각 예약", params: [{"name": "enable", "type": "참/거짓", "required": true}], choices: [], route: "proxy" },
      { name: "add_charge_schedule", label: "충전 일정 추가", params: [{"name": "lat", "type": "숫자", "required": true}, {"name": "lon", "type": "숫자", "required": true}, {"name": "start_time", "type": "숫자", "required": false}, {"name": "start_enabled", "type": "참/거짓", "required": true}, {"name": "end_time", "type": "숫자", "required": false}, {"name": "end_enabled", "type": "참/거짓", "required": true}, {"name": "days_of_week", "type": "요일", "required": true}, {"name": "id", "type": "숫자", "required": false}, {"name": "enabled", "type": "참/거짓", "required": true}, {"name": "one_time", "type": "참/거짓", "required": false}], choices: [], route: "proxy" },
      { name: "remove_charge_schedule", label: "충전 일정 삭제", params: [{"name": "id", "type": "숫자", "required": true}], choices: [], route: "proxy" },
      { name: "add_precondition_schedule", label: "예열 일정 추가", params: [{"name": "lat", "type": "숫자", "required": true}, {"name": "lon", "type": "숫자", "required": true}, {"name": "precondition_time", "type": "숫자", "required": true}, {"name": "one_time", "type": "참/거짓", "required": false}, {"name": "days_of_week", "type": "요일", "required": true}, {"name": "id", "type": "숫자", "required": false}, {"name": "enabled", "type": "참/거짓", "required": true}], choices: [], route: "proxy" },
      { name: "remove_precondition_schedule", label: "예열 일정 삭제", params: [{"name": "id", "type": "숫자", "required": true}], choices: [], route: "proxy" },
      { name: "set_managed_charge_current_request", label: "관리형 충전 전류", params: [], choices: [], route: "proxy", note: "프록시가 서명 없이 Tesla REST 로 전달" },
      { name: "set_managed_charger_location", label: "관리형 충전 위치", params: [], choices: [], route: "proxy", note: "프록시가 서명 없이 Tesla REST 로 전달" },
      { name: "set_managed_scheduled_charging_time", label: "관리형 예약 충전 시각", params: [], choices: [], route: "proxy", note: "프록시가 서명 없이 Tesla REST 로 전달" },
    ],
  },
  {
    title: "보안 · 접근 제한",
    commands: [
      { name: "set_sentry_mode", label: "감시 모드", params: [{"name": "on", "type": "참/거짓", "required": true}], choices: [], route: "proxy" },
      { name: "set_valet_mode", label: "발렛 모드", params: [{"name": "on", "type": "참/거짓", "required": true}, {"name": "password", "type": "문자열", "required": false}], choices: [], route: "proxy" },
      { name: "reset_valet_pin", label: "발렛 PIN 초기화", params: [], choices: [], route: "proxy" },
      { name: "set_pin_to_drive", label: "주행 PIN 설정", params: [{"name": "on", "type": "참/거짓", "required": true}, {"name": "password", "type": "문자열", "required": false}], choices: [], route: "proxy" },
      { name: "reset_pin_to_drive_pin", label: "주행 PIN 초기화", params: [], choices: [], route: "proxy" },
      { name: "clear_pin_to_drive_admin", label: "주행 PIN 해제 (관리자)", params: [], choices: [], route: "proxy" },
      { name: "speed_limit_activate", label: "속도 제한 켜기", params: [{"name": "pin", "type": "문자열", "required": true}], choices: [], route: "proxy" },
      { name: "speed_limit_deactivate", label: "속도 제한 끄기", params: [{"name": "pin", "type": "문자열", "required": true}], choices: [], route: "proxy" },
      { name: "speed_limit_set_limit", label: "속도 제한값 설정", params: [{"name": "limit_mph", "type": "숫자", "required": true}], choices: [], route: "proxy" },
      { name: "speed_limit_clear_pin", label: "속도 제한 PIN 삭제", params: [{"name": "pin", "type": "문자열", "required": true}], choices: [], route: "proxy" },
      { name: "speed_limit_clear_pin_admin", label: "속도 제한 PIN 삭제 (관리자)", params: [], choices: [], route: "proxy" },
      { name: "guest_mode", label: "게스트 모드", params: [{"name": "enable", "type": "참/거짓", "required": true}], choices: [], route: "proxy" },
    ],
  },
  {
    title: "미디어",
    commands: [
      { name: "media_toggle_playback", label: "재생/일시정지", params: [], choices: [], route: "proxy" },
      { name: "media_next_track", label: "다음 곡", params: [], choices: [], route: "proxy" },
      { name: "media_prev_track", label: "이전 곡", params: [], choices: [], route: "proxy" },
      { name: "media_next_fav", label: "다음 즐겨찾기", params: [], choices: [], route: "proxy" },
      { name: "media_prev_fav", label: "이전 즐겨찾기", params: [], choices: [], route: "proxy" },
      { name: "media_volume_up", label: "볼륨 올리기", params: [], choices: [], route: "proxy" },
      { name: "media_volume_down", label: "볼륨 내리기", params: [], choices: [], route: "proxy" },
      { name: "adjust_volume", label: "볼륨 값 지정", params: [{"name": "volume", "type": "숫자", "required": true}], choices: [], route: "proxy" },
      { name: "remote_boombox", label: "붐박스 소리 재생", params: [], choices: [], route: "proxy" },
    ],
  },
  {
    title: "기타 · 차량 관리",
    commands: [
      { name: "wake_up", label: "차량 깨우기", params: [], choices: [], route: "proxy" },
      { name: "flash_lights", label: "전조등 깜빡이기", params: [], choices: [], route: "proxy" },
      { name: "honk_horn", label: "경적", params: [], choices: [], route: "proxy" },
      { name: "remote_start_drive", label: "원격 주행 활성화", params: [], choices: [], route: "proxy" },
      { name: "trigger_homelink", label: "홈링크 (차고문 등)", params: [{"name": "lat", "type": "숫자", "required": true}, {"name": "lon", "type": "숫자", "required": true}], choices: [], route: "proxy" },
      { name: "navigation_request", label: "목적지 전송", params: [], choices: [], route: "proxy", note: "프록시가 서명 없이 Tesla REST 로 전달" },
      { name: "set_vehicle_name", label: "차량 이름 변경", params: [{"name": "vehicle_name", "type": "문자열", "required": true}], choices: [], route: "proxy" },
      { name: "schedule_software_update", label: "소프트웨어 업데이트 예약", params: [{"name": "offset_sec", "type": "숫자", "required": true}], choices: [], route: "proxy" },
      { name: "cancel_software_update", label: "업데이트 예약 취소", params: [], choices: [], route: "proxy" },
      { name: "set_low_power_mode", label: "저전력 모드", params: [{"name": "enable", "type": "참/거짓", "required": true}], choices: [], route: "proxy" },
      { name: "keep_accessory_power_mode", label: "액세서리 전원 유지", params: [{"name": "enable", "type": "참/거짓", "required": true}], choices: [], route: "proxy" },
      { name: "erase_user_data", label: "사용자 데이터 삭제", params: [], choices: [], route: "proxy" },
    ],
  },
  {
    title: "서명 프록시 미지원 (직접 전달)",
    commands: [
      { name: "navigation_gps_request", label: "GPS 좌표로 내비게이션 시작", params: [], choices: [], route: "rest" },
      { name: "navigation_sc_request", label: "슈퍼차저로 내비게이션", params: [], choices: [], route: "rest" },
      { name: "navigation_waypoints_request", label: "웨이포인트 목록 전송", params: [], choices: [], route: "rest" },
      { name: "sun_roof_control", label: "선루프 제어 (stop / close / vent)", params: [], choices: [], route: "rest" },
      { name: "upcoming_calendar_entries", label: "차량에 캘린더 항목 전달", params: [], choices: [], route: "rest" },
      { name: "parental_controls_activate", label: "자녀 보호 기능 활성화 (4자리 PIN)", params: [], choices: [], route: "rest" },
      { name: "parental_controls_deactivate", label: "자녀 보호 기능 비활성화", params: [], choices: [], route: "rest" },
      { name: "parental_controls_set_speed_limit", label: "자녀 보호 속도 제한 설정", params: [], choices: [], route: "rest" },
      { name: "parental_controls_enable_setting", label: "자녀 보호 개별 설정 on/off", params: [], choices: [], route: "rest" },
      { name: "parental_controls_clear_pin_admin", label: "자녀 보호 PIN 초기화 (관리자)", params: [], choices: [], route: "rest" },
      { name: "remote_steering_wheel_heat_level_request", label: "스티어링 휠 열선 단계 설정", params: [], choices: [], route: "rest" },
      { name: "remote_auto_steering_wheel_heat_climate_request", label: "스티어링 휠 열선 자동 조절", params: [], choices: [], route: "rest" },
    ],
  },
];

export const COMMAND_COUNT = COMMAND_GROUPS.reduce((n, g) => n + g.commands.length, 0);

// route 가 'rest' 인 명령은 프록시를 거치지 않고 Fleet API 로 바로 보냅니다.
export const REST_COMMANDS = new Set(
  COMMAND_GROUPS.flatMap((g) => g.commands.filter((c) => c.route === 'rest').map((c) => c.name))
);
