# 우리반 학급 포털

2027학년도 전북기계공업고등학교 1학년 11반의 공지·포인트·상점·학급생활·문제풀이·시험 신청 포털입니다. React 19·TypeScript·Vite 프런트와 Firebase Spark의 Auth·Firestore·Hosting, Cloudflare Workers Free 서버를 사용합니다. 결제 계정·Blaze·Workers 유료 구독을 연결하지 않습니다.

- 실제 서비스: https://wooriban-2027.web.app
- API: https://wooriban-2027-api.wooriban-2027.workers.dev
- 저장소 작업: [PR #1](https://github.com/lcyua/CMTS-webapp/pull/1), `setup/firebase-workers-free`
- Firebase 프로젝트 `wooriban-2027`, 학급 `2027-1-11`, Standard Firestore `asia-northeast3`

## 배포와 검증 상태

2026-11-13 운영자 Cloudflare 인증 후 Worker를 `3c140c5b-1b47-4859-a625-e9a75af1708f`로 실제 배포했습니다. 배포 시 시작 시간은 3ms였으며 요청별 무료 CPU 실측을 뜻하지 않습니다. `/health`에서 `apiVersion=2`, `configured=true`, `features.history=true`, `features.push=false`를 확인했습니다. 실제 API의 학번 목록 18개, 비로그인 401·타학급 403·허용하지 않은 Origin 403·잘못된 입력 400 검사가 통과했습니다. 운영 계정의 인증된 분리 조회·실제 데이터 이전·새 버전의 무료 CPU·쿼터는 아직 검증하지 않았습니다.

Hosting은 아직 2026-11-12 live 버전 `293841b2aa5c57a6`입니다. 2026-11-13 사용자가 자동로그인, 브라우저 새로고침 후 로그인 유지, 로그아웃 후 새로고침 시 비로그인 상태를 직접 확인했습니다. 계정 역할·로그인 방식까지 확인한 보고는 아닙니다. 새 Worker는 이 기존 프런트의 조회도 지원합니다.

소스 커밋 `32cbeb3`을 PR 브랜치에 푸시했습니다. 필드별 교사 설정 편집기, 제출된 문제의 내용 보호, 대기 시험 신청 수정 폼, 이력 분리 저장·서버 커서 조회, 백업·복구 도구, PWA 개선과 선택형 FCM을 추가했습니다. 새 서버 코드는 배포됐지만 새 화면·PWA는 Hosting 재배포 전이므로 현재 사이트에 반영된 것으로 표시하지 않습니다. Firebase CLI 운영자 인증을 이 환경에서 완료하지 못했습니다. 운영 인증정보는 Git checkout에 포함되지 않습니다.

운영자가 본인 PC의 터미널에서 Hosting만 배포할 수 있도록 빌드 ZIP과 로그인·배포 스크립트를 준비했습니다(15개 파일, 292,325바이트). 다운로드 링크 전달은 아직 완료하지 않았습니다. 이 패키지는 PIN 전달 파일이나 Worker 배포 패키지가 아닙니다.

최근 로컬 단위 테스트 89/89과 실제 계정 없이 진행한 브라우저 검사 17개가 통과했습니다. PWA는 격리된 Chromium에서 별도로 10개 시나리오를 통과했습니다. HTML·빌드 번들 사전 캐시, 첫 오프라인 새로고침, 온라인 복귀, 명시적 업데이트 적용, 실패한 업데이트 거부와 정상 버전 보존, API·Auth 응답 캐시 제외를 확인했고 Chromium의 설치 가능성 오류는 없었습니다. Android/iOS 실기기 설치·실수신 결과는 아닙니다. 상세 진행 상태는 [NEXT-STEPS.md](NEXT-STEPS.md), 사용자 안내는 [RELEASE-v1.md](RELEASE-v1.md)를 봅니다.

## 기존 계정과 PIN 유지

학생 18명과 교사 1명의 학급 구성이 이미 존재합니다. **현재 학급의 발급·초기화 도구를 다시 실행하지 않습니다.** 기존 계정·PIN·포인트를 덮어쓰거나 가상 데이터를 실제 학급에 넣지 않습니다. 원본 학생 비밀번호 열도 조회하거나 사용하지 않습니다.

학생은 실제 서비스에서 학번을 선택하고 이미 발급된 4자리 PIN을 입력합니다. 앞자리 `0`도 포함하는 문자열입니다. PIN 전달 파일은 `imports/student-login-codes.private.json`이며 운영자가 별도로 안전하게 보관합니다. `imports/`는 Git·소스 ZIP·정적 Hosting에서 제외되므로 일반 소스 ZIP만으로는 PIN을 알 수 없습니다. 파일·PIN·서버 키·pepper·OAuth 인증정보를 채팅이나 공개 문서에 넣지 않습니다.

교사는 기존 개인 계정으로 로그인합니다. 런타임 전용 서비스 계정에는 Auth 계정 생성·변경·삭제 권한이 없으며 학생 재발급에 사용하지 않습니다.

## 서버와 데이터

브라우저는 Firebase Auth로 인증하고 Worker에 ID token을 보냅니다. Worker가 서명·만료·철회·비활성 계정·학급 membership·역할·기록 소유권을 검사합니다. Firestore Rules는 클라이언트의 직접 읽기·쓰기를 모두 거부합니다. 현재 무료 운영 경로에 Functions와 Secret Manager를 배포하지 않습니다. `functions/`는 호환 코드와 로컬 에뮬레이터 검사용입니다.

배포한 저장소 구현은 기본 학급 문서와 늘어나는 이력을 분리하고 학생별 조회 사본·요청 영수증·포인트 요약을 유지합니다. 서버 커서로 과거 기록을 조회하며 Firestore updateTime 사전조건으로 원장·요청·영수증을 함께 반영합니다. 현재 운영 데이터의 전환·새 코드의 무료 CPU·쿼터 실측은 아직 확인하지 않았습니다. 기본 설정 문서의 700KB 상한과 개별 명령의 조회·쓰기 한도는 남습니다. 저장 경로·이전·호환·한도는 [docs/STORAGE.md](docs/STORAGE.md), 백업과 세대 전환 복구의 정확한 범위는 [OPERATIONS.md](OPERATIONS.md)를 따릅니다.

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

서버는 위 새 버전으로 배포했으며 다음 단계는 Firebase CLI 인증 후 Hosting 배포입니다. 아래는 소스에서 다시 빌드·배포할 때의 범위를 제한한 명령입니다. 기존 Wrangler secrets를 유지하고 서버를 확인한 다음 Hosting을 배포합니다. Hosting 배포 완료는 아직 확인하지 않았습니다.

```sh
npx -y wrangler@latest deploy --dry-run --outdir work/worker-build
npx -y wrangler@latest deploy
npx -y firebase-tools@latest deploy --only hosting --project wooriban-2027
```

Rules를 실제로 변경한 경우에만 `npx -y firebase-tools@latest deploy --only firestore:rules --project wooriban-2027`로 별도 배포합니다. 전체 Firebase deploy, Functions·Secret Manager 배포나 결제 연결로 우회하지 않습니다.

## 운영과 남은 검증

- [OPERATIONS.md](OPERATIONS.md): 계획 출력이 기본인 백업·복구·로컬 보관 정리·제한 문서 정리 도구. 실제 운영 백업·복구·cron 등록은 미실행입니다. 원본 학생·감사 기록 삭제 일정은 학교의 보관 정책과 별도로 정해야 합니다.
- [docs/STORAGE.md](docs/STORAGE.md): 배포된 분리 저장 코드의 경로·원자적 이전·구형 프런트 호환·조회 한도. health 확인과 운영 데이터 이전 완료를 구분합니다.
- [docs/PUSH.md](docs/PUSH.md): FCM은 기본 꺼짐입니다. 사용자 동의·기기 등록·발송 큐·로그아웃 정리를 구현했으나 공개 VAPID 설정, FCM API·최소 IAM 구성, 무료 한도 관찰과 실제 기기 수신은 남습니다. 앱 내 알림은 푸시 활성화와 관계없이 동작합니다.
- 운영자 Google 인증 완료, 실제 학생·교사별 화면·권한, 앱 내부 새로고침, 실제 Android/iOS 설치는 운영 계정·기기로 확인해야 합니다. Google 팝업 표시만으로 인증 완료를 보고하지 않습니다.
- 승인된 신청 정정·대규모 배치 작업의 재개·학교 외부 시스템 연동 등은 구현 범위가 별도로 남습니다. Hosting 후속 배포·운영 데이터 이전·운영 복구 훈련까지 끝난 상태로 표시하지 않습니다.

과거 시점의 구현 기록은 [docs/IMPLEMENTATION-HISTORY.md](docs/IMPLEMENTATION-HISTORY.md)에 보존했습니다. 현재 운영에는 이 README와 연결된 운영 문서를 사용합니다.
