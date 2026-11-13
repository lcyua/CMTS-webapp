# Firebase Spark + Cloudflare Workers Free

이 어댑터는 Firebase Functions 및 Secret Manager 없이 기존 UI와 Firebase Auth/Firestore를 연결합니다. **2026-11-12 Worker·Hosting 배포 및 실제 학생 18명 발급을 완료했습니다.** 결제·유료 구독은 추가하지 않았습니다.

- API: https://wooriban-2027-api.wooriban-2027.workers.dev
- Hosting: https://wooriban-2027.web.app
- 실제 PIN 18개 모두 로그인·Firebase 토큰 교환·학급 조회를 검증했습니다. 교사 membership, 학생 권한 거부, 직접 Rules 접근 거부, 위조/철회 토큰·비활성 계정 거부도 확인했습니다.
- 최신 환경에서 Hosting 화면과 Google 팝업 표시를 확인했고 사용자가 로그인 유지·새로고침·로그아웃을 확인했습니다. 교사 Google 인증 완료와 실기기 검증은 남아 있습니다. 상세 상태와 재발급 금지 지침은 `NEXT-STEPS.md`를 참조하세요.

## 서버 비밀값

Wrangler secret으로만 설정합니다. `.env.local`의 `VITE_*`, Git, 정적 배포 디렉터리에 넣지 않습니다.

- `FIREBASE_SERVICE_ACCOUNT`: `wooriban-2027`의 전용 서버 계정 JSON. 현재 런타임 권한은 `roles/datastore.user`와 `roles/firebaseauth.viewer`뿐입니다. 발급·임시 검증용 Auth 관리 권한은 제거했습니다. 새 사용자 발급에는 별도의 승인된 관리 ADC가 필요합니다. 운영자 OAuth refresh token을 서버에 배포하지 않습니다.
- `FIREBASE_WEB_API_KEY`: 등록된 웹앱 API 키.
- `STUDENT_PIN_PEPPER`: 발급 도구와 같은 무작위 서버 비밀값(32자 이상).

프로젝트/학급/허용 Origin은 `wrangler.jsonc`에 고정합니다. 신규 Cloudflare 계정은 Free를 유지하고 유료 구독이나 결제 연결을 추가하지 않습니다.

## 학생 발급 방식

`scripts/provision-student-pins.ts`에 `--workers`를 추가하면 `firebase-password-v1` 계정을 생성합니다. **현재 학급은 발급 완료했으므로 초기화를 다시 실행하지 않습니다.** 기존 scrypt 방식과 혼용하거나 이미 발급한 계정을 자동 재발급하지 않습니다. 다른 신규 학급의 발급 전에는 Worker 비밀값·Auth·전용 서비스 계정 접근·배포를 먼저 검증해야 합니다.

학생 PIN은 임의의 4자리 문자열이며 앞자리 0을 보존합니다. 계정별 salt와 서버 pepper로 HMAC을 계산한 결과를 Firebase Auth의 긴 비밀번호로 설정합니다. 실제 비밀번호 해싱과 검증은 Firebase Auth가 수행합니다. Worker는 학번별 5회/IP별 50회의 15분 제한을 원자적으로 예약하고, 성공 후에만 차감합니다. 클라이언트에는 파생 비밀번호나 salt/pepper를 보내지 않고 5분 수명의 Firebase custom token만 반환합니다. 이후 Firebase SDK가 로그인 세션을 관리합니다.

비공개 발급 파일에는 교사가 학생별로 전달할 원본 PIN을 보관합니다. 발급 중단 시 복구 정보를 확인해야 하며 자동 재발급하지 않습니다. 실제 시트의 비밀번호 열은 조회하지 않습니다.

## 서버 권한 및 데이터

`portal`은 Firebase ID token의 서명/발급자/대상/만료를 검증하고 Auth 사용자 비활성화·토큰 철회·학급 membership을 확인합니다. 도메인 명령과 학생 응답 필터는 기존 코드를 재사용합니다. Firestore REST commit의 updateTime 사전조건으로 중복 지급·경합 시 재시도하며 HTTP 409/412 및 HTTP 400 `FAILED_PRECONDITION`/`ABORTED`를 처리합니다. 보안 규칙은 계속 모든 클라이언트 직접 접근을 거부합니다.

서명 키 import와 동시 OAuth 토큰 갱신을 재사용하고 로그인 제한 문서는 `batchGet`으로 함께 읽습니다. `signInWithPassword`가 비활성 계정을 거부하며 custom token 교환과 이후 `portal`에서도 계정 상태를 확인하므로 로그인 중 중복 Auth lookup은 하지 않습니다. 실제 임시 계정으로 `USER_DISABLED` 거부를 검증했습니다.

새 서버는 누적 이력을 분리하고 소유자별 커서 조회·요청 영수증·포인트 요약·첫 이전 원본 백업·복구 세대를 지원합니다. 기본 설정 문서의 700KB와 명령별 조회/쓰기 제한은 유지합니다. 상세 구조는 `../docs/STORAGE.md`, 전체 백업·복구·보관 도구는 `../OPERATIONS.md`, 기본 꺼짐인 FCM은 `../docs/PUSH.md`를 참조하세요. 실제 인증된 분리 조회·이전·운영 복구 훈련과 실기기 수신은 아직 검증 전입니다.

## 배포 및 무료 CPU 실측

현재 Worker 버전은 `3c140c5b-1b47-4859-a625-e9a75af1708f`입니다. Wrangler 4.161.0 시작 시간은 3ms, health는 API v2·configured=true·history=true·push=false입니다. Firebase Hosting은 기존 live 버전 `293841b2aa5c57a6`이며 새 화면 빌드는 사용자 컴퓨터의 공식 CLI 배포를 기다립니다. 프런트의 `VITE_API_BASE`는 위 실제 API 주소를 사용합니다.

과거 배포의 로그인은 일부 10ms를 초과해 키/토큰 재사용, 로그인 제한 문서 batchGet, 중복 Auth 조회 제거를 적용했습니다. 이전 Worker `04f64559-5bfd-4c06-91cd-fd0c030377e7`의 실제 학생 18명 로그인 CPU는 5~8ms, portal 수집 샘플은 1~5ms, 로그인 옵션은 6ms였고 수집 요청의 outcome은 모두 `ok`였습니다. Free의 10ms 기준 안에서 통과한 소규모 실측이며 장기·대규모 동시 부하를 보장하지 않습니다. 요청·Firestore 무료 쿼터 및 CPU 초과는 계속 관찰해야 합니다. 결제나 유료 업그레이드를 자동으로 추가하지 않습니다.

## 신규 환경의 최초 구성 순서

1. `npm test`, `npm run worker:check`, `npm run build`, Functions 호환 빌드 확인.
2. `npx -y wrangler@latest deploy --dry-run --outdir /tmp/wooriban-worker-build`로 번들 점검.
3. Cloudflare CLI 로그인, 전용 Firebase 서비스 계정과 Wrangler secrets 구성. 비밀값은 CLI 입력/비공개 파일에서만 처리.

   원격 환경에서는 `npx -y wrangler@latest login --device --scopes account:read user:read workers:write workers_scripts:write workers_tail:read`로 배포에 필요한 범위만 연결할 수 있습니다. 나머지 제품의 OAuth scope 누락 경고를 없애기 위해 권한을 넓히지 않습니다. Firebase CLI 로그인·서버 키와 학생 명단은 Git checkout에 보존되지 않으므로 새 환경에서 다시 확인합니다.
4. Worker 배포 후 `/health`, CORS, 실제 Google ID token, 비인가/타학급 접근 거부, 동시 요청, CPU 및 무료 한도 검증.
5. 미발급 신규 학급만 `--workers`로 명단을 1회 발급하고 teacher membership/학년도/0점 초기 상태 확인. 현재 `2027-1-11`은 발급 완료하여 재실행 금지. 가상 seed를 실데이터에 사용하지 않음.
6. 배포된 Worker HTTPS URL을 `.env.local`의 `VITE_API_BASE`로 설정하고 다시 빌드. `npx -y firebase-tools@latest deploy --only hosting --project wooriban-2027` 실행.
7. 실제 Hosting 주소에서 드롭다운·학생 로그인·교사 로그인·권한·새로고침/로그아웃 검증 후에만 완료 보고.

실제 Firebase 운영 빌드는 `VITE_API_BASE`가 HTTPS Workers 주소가 아니면 실패합니다. callable Functions 경로는 에뮬레이터 호환 용도로만 남깁니다. Worker를 확인한 뒤 Hosting을 배포합니다.
