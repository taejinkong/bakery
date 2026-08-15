# ☕ 수원 · 용인 · 화성 추천 카페맵

블로그 언급량 + 후기 반응을 점수화해 상위 카페만 보여주는 지도 웹앱.
아이동반 가능 여부와 가까운 전기차 충전소 거리까지 한눈에 확인할 수 있습니다.

**Live**: https://taejinkong.github.io/bakery/ (GitHub Pages 활성화 후)

## 구조

```
index.html                    # 앱 (Leaflet + OpenStreetMap, 빌드 불필요)
data.js                       # 앱이 읽는 데이터 (자동 생성 — 직접 수정 금지)
data/cafes.json               # 카페 원본 데이터 (큐레이션 + 자동 갱신 필드)
data/chargers.json            # 전기차 충전소 좌표
data/report.json              # 갱신 시 생성되는 경고 리포트
scripts/update-data.mjs       # 데이터 자동 갱신 스크립트 (Node 18+)
.github/workflows/deploy.yml       # main 푸시 → GitHub Pages 배포
.github/workflows/update-data.yml  # 매주 토요일 데이터 자동 갱신 → 커밋 → 재배포
```

## 점수 산식 (100점 만점)

- **블로그 언급량** (0~60점): 네이버 블로그 총 포스팅 수를 로그 스케일로 환산
- **후기 반응** (0~40점, `buzz`): 후기 스니펫의 반응 키워드(인생맛집·재방문·추천 등) 기반 수동 큐레이션
- 등급: **S** 85+ / **A** 70~84 / **B** 55~69 — 55점 미만은 지도에서 제외
- 아이동반(`kid`): 블로그 후기 근거로 `yes / no(노키즈존) / unknown` 판정
- 충전소 거리: 하버사인 공식으로 최근접 충전소 자동 계산

## 데이터 자동 갱신

> ⚠️ 네이버 개발자센터는 **신규 앱의 '검색' API 발급이 중단**되었습니다(2026-08 확인 — 사용 API 목록에 '검색' 항목 없음).
> 신규 발급은 **카카오 REST API**를 사용하세요. 기존에 발급받은 네이버 키가 있다면 그대로 사용 가능합니다.

### 1) 카카오 API 키 발급 (무료, 즉시 발급)

1. https://developers.kakao.com → 로그인 → **내 애플리케이션 → 애플리케이션 추가하기**
2. 생성된 앱의 **앱 키 → REST API 키** 복사 (별도 심사 없음, [블로그 검색 API](https://developers.kakao.com/docs/latest/ko/daum-search/dev-guide#search-blog) 기본 사용 가능)

### 2) 로컬에서 실행

```bash
# 카카오 (권장)
KAKAO_REST_API_KEY=발급받은키 node scripts/update-data.mjs

# 네이버 (기존 발급 키가 있는 경우만)
NAVER_CLIENT_ID=발급받은ID NAVER_CLIENT_SECRET=발급받은SECRET node scripts/update-data.mjs

# API 호출 없이 data.js만 재생성 (cafes.json을 손으로 고친 뒤)
node scripts/update-data.mjs --build-only
```

두 소스는 수치 스케일이 다르지만(카카오=다음 블로그 검색), 점수는 로그 상대 스케일(`blogScale`)로
자동 보정되므로 순위 비교에는 문제가 없습니다. 소스가 바뀐 첫 실행에서는 증감 경고를 생략합니다.

스크립트가 하는 일:
- 카페별 블로그 총 포스팅 수(`blog`)를 최신값으로 갱신
- 최신 후기에서 `노키즈존`/`아이랑`/`애견동반` 키워드를 스캔해 `data/report.json`에 경고 생성
  (kid/pet 판정은 자동으로 바꾸지 않음 — 리포트를 보고 `data/cafes.json`을 직접 수정)
- `data.js` 재생성

### 3) GitHub Actions 자동 갱신

리포 **Settings → Secrets and variables → Actions** 에 등록 (둘 중 하나만 있으면 됨):

| Secret | 값 |
|---|---|
| `KAKAO_REST_API_KEY` | 카카오 REST API 키 (권장) |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 키 (기존 발급분이 있는 경우) |

매주 토요일 06:00 KST에 자동 실행되고, 변경이 있으면 커밋 → Pages 재배포까지 이어집니다.
(Actions 탭에서 **Update cafe data → Run workflow** 로 수동 실행도 가능)

## 배포 (GitHub Pages)

1. 이 폴더를 리포에 푸시
2. 리포 **Settings → Pages → Source**를 **GitHub Actions**로 설정
3. main에 푸시할 때마다 `deploy.yml`이 자동 배포

## 카페 추가/수정

`data/cafes.json`에 항목 추가 후 `node scripts/update-data.mjs --build-only` 실행.
필수 필드: `name, region(suwon|yongin|hwaseong), area, lat, lng, query(블로그 검색어), blog, buzz(0~40), kid(yes|no|unknown), pet, parking, hl(한줄 소개)`

## 데이터 출처 / 한계

- 카페 후보·좌표·충전소: 네이버 지역검색 (2026-08 수집)
- 블로그 수치: 초기값은 네이버 블로그 검색 기준. 이후 갱신은 카카오(다음) 블로그 검색으로 전환될 수 있으며 앱에 소스가 표시됨. (동명 키워드가 섞일 수 있음 — 예: 칼리오페)
- 아파트 단지 내 충전소는 입주민 전용일 수 있어 `개방 여부 확인 필요`로 표시
- 아이동반/애견동반은 블로그 후기 기반 추정이므로 방문 전 매장 확인 권장
