// S3XY Buttons(enhauto.com) 기능 정리 데이터.
//
// enhauto.com 페이지는 차종·연식을 해시(#model=...&&year=...)로 골라 자바스크립트로
// 목록을 그리기 때문에, 차종별 지원 목록을 그대로 옮겨 적어야 합니다.
// 새 차종을 추가하려면 vehicles 에 항목을 하나 더 넣으면 됩니다.
//
// categories[].functions[] 항목:
//   name    원문 기능 이름 (영문)
//   ko      한국어 설명
//   note    조건·제약이 있으면 (선택)

export const S3XY_VEHICLES = [
  {
    id: 'model3-2018-2020',
    name: 'Model 3',
    year: '2018–2020',
    source:
      'https://www.enhauto.com/pages/buttons-functions#model=model3&&year=2018-2020',
    categories: [],
  },
  {
    id: 'modelx-2021-plaid-lr',
    name: 'Model X',
    year: '2021+ Plaid / Long Range',
    source:
      'https://www.enhauto.com/pages/buttons-functions#model=modelx&&year=2021+plaid&lr',
    categories: [],
  },
];

export function functionCount(vehicle) {
  return vehicle.categories.reduce((n, c) => n + c.functions.length, 0);
}
