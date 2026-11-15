# 우리반 학급 포털

2027학년도 전북기계공업고등학교 1학년 11반의 공지·포인트·상점·학급생활·문제풀이·시험 신청 포털입니다. React 19·TypeScript·Vite 프런트와 Firebase Spark의 Auth·Firestore·Hosting, Cloudflare Workers Free 서버를 사용합니다. 결제 계정·Blaze·Workers 유료 구독을 연결하지 않습니다.

- 실제 서비스: https://wooriban-2027.web.app
- API: https://wooriban-2027-api.wooriban-2027.workers.dev
- 저장소 작업: [PR #1](https://github.com/lcyua/CMTS-webapp/pull/1), `setup/firebase-workers-free`
- Firebase 프로젝트 `wooriban-2027`, 학급 `2027-1-11`, Standard Firestore `asia-northeast3`

## 배포와 검증 상태

현재 Worker는 발송 활성화 버전 `313127d5-a042-438e-9070-d2b84288b10a`이며 시작 시간은 2ms, cron은 1분입니다. 사용자가 FCM 설정 도구의 성공 문구를 확인한 뒤 기존 비밀 설정을 유지해 배포했고 실제 `/health`에서 `apiVersion=2`, `configured=true`, `features.history=true`, `features.push=true`를 확인했습니다. 준비 버전 `fec4aac2-c0d4-4296-888d-bf988e4f27cd`와 교사 로그인 수정 버전 `84269e08-87cf-4a1e-8066-d6bbdeb9ff96`는 이전 배포입니다. 비로그인 테스트 발송 요청은 401로 거부됩니다. 기본 기능 배포 당시(`3c140c5b-1b47-4859-a625-e9a75af1708f`)의 익명 학번 목록 6개 CPU 표본은 2~10ms였습니다. 인증된 portal CPU·운영 데이터 이전·장기 무료 쿼터는 아직 검증하지 않았습니다.

2026-11-15 사용자가 본인 PC의 Firebase CLI로 Hosting을 배포했습니다. 현재 실제 사이트의 `/assets/index-1yDFAHFr.js`, `/assets/index-DN6qQo21.css`, 서비스 워커 SHA-256 `e5e7f03165e02f5f26f8f25da3db3022c4b392842f4f8c331f4b324ab5e201f8`와 push-worker SHA-256 `b9316898462c6bd57ed6f7a9dc49c1d1b3e666a831ec828a692f36d014ae59d2`가 새 푸시 패키지와 일치합니다. 공개 브라우저 검사 16개가 통과했으며 로그인·기기 등록·발송은 시도하지 않았습니다. 새 Hosting release ID는 조회하지 않았고 `293841b2aa5c57a6`는 과거 배포입니다.

운영 패키지의 교사 설정 편집기, 제출된 문제 보호, 대기 시험 신청 수정, 과거 기록 조회 UI와 PWA 개선이 실제 Hosting에 반영됐습니다. FCM 서버 발송도 활성화했으며 실제 기기 표시는 확인 대기입니다. 운영 데이터 이전·복구 훈련과 장기 쿼터 검증은 별도이며 운영 인증정보는 Git checkout에 포함되지 않습니다.

Hosting 전용 빌드 ZIP과 로그인·배포 스크립트(15개 파일, 292,325바이트)는 사용자 승인 후 Drive의 소유자 전용 파일로 전달했습니다. 공개 공유를 켜지 않았고 이 저장소에 다운로드 링크를 넣지 않습니다. 이 패키지는 PIN 전달 파일이나 Worker 배포 패키지가 아닙니다.

새 실서비스의 비로그인 브라우저 검사 13개가 통과했습니다. 학번 18개·데모 미노출·자동로그인 선택·서비스 워커 활성화와 JS/CSS 사전 캐시·API/Auth 응답 캐시 제외·오프라인 실행과 로그인 비활성화·온라인 복귀·모바일 폭·JavaScript 오류 없음을 확인했습니다. 2026-11-13의 기존 배포본에서는 사용자가 자동로그인, 새로고침 후 로그인 유지, 로그아웃 후 새로고침 시 비로그인 상태를 직접 확인했습니다. 2026-11-15 수정 서버 배포 후 사용자가 새 화면의 교사 Google 로그인과 설정 메뉴 정상 표시를 확인했습니다. 전체 역할별 업무 권한 시나리오는 별도 확인 대상입니다.

기존 이력·로그인 수정 배포의 로컬 단위 테스트 93/93과 실제 계정 없이 진행한 브라우저 검사 17개가 통과했습니다. PWA는 격리된 Chromium의 별도 10개 시나리오에서 명시적 업데이트 적용·실패한 업데이트 거부·정상 버전 보존도 확인했습니다. 실제 로컬 Firestore Emulator에서 키만 사용하는 내림차순 조회 오류를 재현해 저장 순번 기반 조회·커서로 수정했습니다. 교사/학생 조회·동시 단일 반영·잔액 경합·커서·소유권·501건 범위 읽기 등 6개 통합 그룹을 통과했으며 가상 문서를 모두 정리했습니다. Android/iOS 실기기 설치·실수신도 남습니다. 상세 진행 상태는 [NEXT-STEPS.md](NEXT-STEPS.md), 사용자 안내는 [RELEASE-v1.md](RELEASE-v1.md)를 봅니다.

## 기기 푸시: 서버 활성화, 실제 수신 확인 대기

`c8b2e3f`에 기기 푸시 준비를 구현했습니다. 앱·기기 수신 의사는 기본 켜짐이며 사용자가 명시적으로 끈 선택은 보존합니다. 브라우저·OS 알림 권한은 각 사용자가 직접 허용해야 합니다. 사용자 제공 공개 VAPID 키는 검증·반영했으며 비밀키를 채팅으로 받거나 교체하지 않았습니다.

사용자가 공식 gcloud 설정 도구의 `FCM APIs and the single IAM binding were configured` 성공 문구를 확인했습니다. 새 Hosting 화면은 실제 파일 해시와 브라우저 검사로 확인했고 `PUSH_ENABLED=true`로 서버를 배포했습니다. health의 활성화 상태는 FCM 접수나 실제 기기 표시 성공을 증명하지 않으므로 교사 본인 기기 테스트를 기다리고 있습니다.

준비 코드의 로컬 검증은 `npm test` 119/119, Python 설정 검사 22/22, 새 푸시 UI 검사 10/10과 Worker strict·프런트 운영 빌드·Wrangler dry-run을 통과했습니다. 실제 API·IAM 적용과 발송·기기 수신 검증은 별개로 남습니다.

새 `wooriban-push-ready-2026-11-15.zip`(297159바이트, 16개 파일, SHA-256 `97ad73956a69b555ab1db8209a23ad74468d9f5ea92cc6f24b4d92b34f79272b`)은 명시적 허용 후 소유자 전용 비공개 Drive 파일로 전달했습니다. 파일 전달·FCM 설정 성공 사용자 확인·새 Hosting 배포 확인·서버 발송 활성화는 완료됐고 실제 기기 수신 확인이 남습니다. [docs/PUSH.md](docs/PUSH.md)에 운영 절차를 기록합니다.

갤럭시 S25 기본 브라우저의 권한 안내 반복·연결 무한 대기 보고에 대응해 프런트를 수정했습니다. 권한 콜백·Promise 처리, 권한/앱 복귀 갱신, 공통 진행 상태, 지원 3초·권한 30초·연결 20초 제한과 오류 표시를 추가했습니다. 교사 테스트 버튼은 항상 보이고 연결 전에는 이유와 함께 비활성화됩니다. 수정본의 130개 검사·가상 모바일 UI 19개·운영 빌드는 통과했지만 새 Hosting 배포·해당 실제 기기 확인은 아직 대기입니다. 실제 사이트의 기존 `index-1yDFAHFr.js`와 수정본 `index-Du6E2s1x.js`를 구분합니다. [NEXT-STEPS.md](NEXT-STEPS.md)에 전달·배포 상태를 기록합니다.

## 기존 계정과 PIN 유지

학생 18명과 교사 1명의 학급 구성이 이미 존재합니다. **현재 학급의 발급·초기화 도구를 다시 실행하지 않습니다.** 기존 계정·PIN·포인트를 덮어쓰거나 가상 데이터를 실제 학급에 넣지 않습니다. 원본 학생 비밀번호 열도 조회하거나 사용하지 않습니다.

학생은 실제 서비스에서 학번을 선택하고 이미 발급된 4자리 PIN을 입력합니다. 앞자리 `0`도 포함하는 문자열입니다. PIN 전달 파일은 `imports/student-login-codes.private.json`이며 운영자가 별도로 안전하게 보관합니다. `imports/`는 Git·소스 ZIP·정적 Hosting에서 제외되므로 일반 소스 ZIP만으로는 PIN을 알 수 없습니다. 파일·PIN·서버 키·pepper·OAuth 인증정보를 채팅이나 공개 문서에 넣지 않습니다.

교사는 기존 개인 계정으로 로그인합니다. 런타임 전용 서비스 계정에는 Auth 계정 생성·변경·삭제 권한이 없으며 학생 재발급에 사용하지 않습니다.

## 서버와 데이터

브라우저는 Firebase Auth로 인증하고 Worker에 ID token을 보냅니다. Worker가 서명·만료·철회·비활성 계정·학급 membership·역할·기록 소유권을 검사합니다. Firestore Rules는 클라이언트의 직접 읽기·쓰기를 모두 거부합니다. 현재 무료 운영 경로에 Functions와 Secret Manager를 배포하지 않습니다. `functions/`는 호환 코드와 로컬 에뮬레이터 검사용입니다.

배포한 저장소 구현은 기본 학급 문서와 늘어나는 이력을 분리하고 학생별 조회 사본·요청 영수증·포인트 요약을 유지합니다. 서버 커서로 과거 기록을 조회하며 Firestore updateTime 사전조건으로 원장·요청·영수증을 함께 반영합니다. 교사 인증 조회·설정 화면은 사용자 확인 완료입니다. 이력 조회 오류는 수정 배포했고 로컬 실제 Firestore Emulator의 조회·커서·경합 검사를 통과했습니다. 운영 데이터의 전환·명령 CPU·장기 쿼터는 별도 확인 대상입니다. 기본 설정 문서의 700KB 상한과 개별 명령의 조회·쓰기 한도는 남습니다. 저장 경로·이전·호환·한도는 [docs/STORAGE.md](docs/STORAGE.md), 백업과 세대 전환 복구의 정확한 범위는 [OPERATIONS.md](OPERATIONS.md)를 따릅니다.

## 로컬 실행

Node 22 이상에서 실행합니다.

```sh
npm ci
npm run dev
```

실제 Firebase 연결은 `.env.example`을 참고해 비공개 `.env.local`에 공개 웹 SDK 설정을 작성합니다. 기존 파일을 덮어쓰지 않습니다. 학급 ID는 `2027-1-11`, `VITE_API_BASE`는 위 Worker API의 HTTPS 주소여야 합니다. 실제 Firebase 운영 빌드에서 이 값이 비었거나 HTTPS가 아니면 빌드를 중단합니다. 서버 키·pepper를 `VITE_*`에 넣지 않습니다.

실제 서비스와 분리된 로컬 가상 데모는 다음처럼 실행할 수 있습니다.

```sh
VITE_FIREBASE_PROJECT_ID='' npm run dev
```

데모 학번은 `01101`·`01102`, 코드는 `2468`이며 실제 학생 PIN과 관계없습니다. 교사 데모 버튼도 제공합니다. 데모의 학급 업무 데이터는 페이지 재실행 시 초기화됩니다. 실제 명단이나 기록을 데모에 입력하지 않습니다.

## 검사와 범위를 지정한 배포

```sh
npm test
npm run worker:check
npm run build
npm run ops:check
```

Functions 호환 검사가 필요하면 `npm --prefix functions ci`와 `npm --prefix functions run build`를 별도로 실행합니다. 새 서버·저장 구조·푸시 큐에는 배포 후 실제 Firebase 권한·일관성·무료 CPU·쿼터 검증이 추가로 필요합니다. 로컬 모의 전송·에뮬레이터·가상 데모 결과를 운영 검증으로 간주하지 않습니다.

서버와 준비한 Hosting 패키지는 위와 같이 배포했습니다. 아래는 이후 수정 사항을 소스에서 다시 빌드·배포할 때의 범위를 제한한 명령입니다. 운영자 CLI 인증과 기존 Wrangler secrets를 사용하고 서버를 확인한 다음 Hosting을 배포합니다. 로컬 수정이 생기면 별도 재배포·검증이 필요합니다.

```sh
npx -y wrangler@latest deploy --dry-run --outdir work/worker-build
npx -y wrangler@latest deploy
npx -y firebase-tools@latest deploy --only hosting --project wooriban-2027
```

Rules를 실제로 변경한 경우에만 `npx -y firebase-tools@latest deploy --only firestore:rules --project wooriban-2027`로 별도 배포합니다. 전체 Firebase deploy, Functions·Secret Manager 배포나 결제 연결로 우회하지 않습니다.

## 운영과 남은 검증

- [OPERATIONS.md](OPERATIONS.md): 계획 출력이 기본인 백업·복구·로컬 보관 정리·제한 문서 정리 도구. 실제 운영 백업·복구·cron 등록은 미실행입니다. 원본 학생·감사 기록 삭제 일정은 학교의 보관 정책과 별도로 정해야 합니다.
- [docs/STORAGE.md](docs/STORAGE.md): 배포된 분리 저장 코드의 경로·원자적 이전·구형 프런트 호환·조회 한도. health 확인과 운영 데이터 이전 완료를 구분합니다.
- [docs/PUSH.md](docs/PUSH.md): 수신 의사는 기본 켜짐이며 새 Hosting과 서버 발송 활성화가 반영됐습니다. 기존 수신 거부를 보존하고 브라우저 권한은 사용자가 허용합니다. 교사 본인 기기의 실제 수신 확인은 대기 중입니다. 앱 내 알림은 독립적으로 동작합니다.
- 교사 Google 인증과 설정 메뉴는 사용자 확인 완료입니다. 전체 학생·교사 업무 권한, 실제 Android/iOS 설치·실수신, 운영 데이터 이전·portal CPU는 별도 검증 대상입니다.
- 승인된 신청 정정·대규모 배치 작업의 재개·학교 외부 시스템 연동 등은 구현 범위가 별도로 남습니다. 운영 데이터 이전·운영 복구 훈련까지 끝난 상태로 표시하지 않습니다.

과거 시점의 구현 기록은 [docs/IMPLEMENTATION-HISTORY.md](docs/IMPLEMENTATION-HISTORY.md)에 보존했습니다. 현재 운영에는 이 README와 연결된 운영 문서를 사용합니다.

자동 백업 예약은 기록 복구를 위한 선택형 운영 수단이며 로그인·포인트 기능의 필수 조건은 아닙니다. 현재 자동 실행 호스트 설정은 보류하고 수동 백업·검사 도구를 제공합니다.
