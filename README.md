# 우리반 Firebase PWA — 구현 1차

## 실제 Firebase 연결 진행 상황 (2026-11-12)

- Firebase CLI 15.36.0 운영자 로그인과 `wooriban-2027` 프로젝트 접근 확인.
- 기존 웹앱 SDK 설정을 비공개 `.env.local`로 조회·연결. 학급 ID는 `2027-1-11`.
- 서울 `asia-northeast3`에 Standard 기본 Firestore 생성 완료. 클라이언트 직접 접근을 모두 거부하는 Rules를 실제 배포 완료.
- Firebase Auth의 Google 및 이메일/비밀번호 제공자 설정 배포 완료. 운영자 이메일의 교사 Auth 계정 준비 완료. 학급 membership은 학생 발급과 함께 구성해야 함.
- 원본 시트의 학번·이름 두 열만 읽어 학생 18명을 비공개 `imports/roster-pending.json`으로 준비·검증. 기존 비밀번호 값은 조회하지 않음. 실제 학생 계정·새 비밀번호는 아직 발급하지 않음.
- Functions와 Secret Manager 배포를 실제 실행했으나 Spark 요금제에서는 필요한 API를 활성화할 수 없어 실패. 사용자가 결제 계정 연결을 원하지 않으므로 Blaze 전환 및 유료 리소스 설정은 진행하지 않음.
- 무료 대안 검토: Firebase Hosting/Auth/Firestore는 Spark 유지, 서버 검증·토큰 발급·업무 명령은 Cloudflare Workers Free로 이전. 별도 Cloudflare 로그인과 서버 어댑터 변경·권한/부하 검증이 필요하며 아직 배포하지 않음.
- Hosting 사이트의 등록 주소는 `https://wooriban-2027.web.app`이지만 이번 작업에서 정상 운영 앱을 Hosting에 배포하거나 접속 검증하지 않았음. 배포 성공 주소로 안내하면 안 됨.
- 로컬 도메인·로그인 관련 테스트 21개, 프런트 및 Functions TypeScript 빌드 통과. `scripts/test-emulator.ts`를 Auth/Functions/Firestore Emulator에서 실행하여 비로그인·타학급·학생 권한 거부, 클라이언트 직접 읽기/쓰기 거부, 동시 동일 요청 6회의 단일 지급, 응답 개인정보/정답 필터링, 계정 비활성화 후 접근 거부를 검증 완료. 이는 운영 서버 검증을 대신하지 않음.
- 통합 검증 실행: `npx -y firebase-tools@latest --config firebase.emulator.json emulators:exec --project demo-class-portal --only auth,firestore,functions 'npx tsx scripts/test-emulator.ts'`. 호스트 8080 포트 점유를 피하도록 테스트용 Firestore는 8180을 사용. Functions 비밀값은 Git에서 제외된 `functions/.secret.local`에 테스트 전용 값만 설정.

아래의 기존 구현·미완료 목록은 이 현황을 기준으로 읽어야 합니다. 결제 없이 운영하려면 기존 `firebase deploy --only functions` 방식으로는 완료할 수 없습니다.

React 19 / TypeScript / Vite, Firebase Auth와 callable Functions 연결. 학생·교사 데모를 제공합니다. 기존 평문 비밀번호는 포함하지 않습니다.

## 실행

```sh
npm ci --cache /tmp/portal-npm-cache
npm run dev
npm test
npm run build
npm --prefix functions ci --cache /tmp/portal-npm-cache
npm --prefix functions run build
```

Firebase 설정이 없으면 **가상 데이터·메모리 전용 데모**입니다. 새로고침 시 초기화되며 데모 역할 선택은 인증이 아닙니다. 실제 학생 자료를 데모에 입력하지 마세요.

## Firebase 연결

1. Firebase 프로젝트에서 Auth(이메일/비밀번호 또는 Google), Firestore, Functions, Hosting을 설정합니다. Functions 배포에는 결제 가능한 요금제가 필요할 수 있습니다.
2. `.env.example`을 `.env.local`로 복사하고 프로젝트의 웹 앱 설정을 입력합니다. 이 값은 공개 클라이언트 설정입니다. 서비스 계정 비밀키를 프런트에 넣지 않습니다.
3. 실제 Auth UID를 기준으로 학급 membership을 관리자 도구로 프로비저닝해야 합니다. 소스의 teacher/student1은 데모 전용 UID입니다.
4. 현재 서버 어댑터의 학급 초기 데이터 경로는 `classes/{classId}/private/state`입니다. `seed()` 형식을 참고하되 실제 UID와 검토한 설정으로 초기화합니다. 클라이언트에서 이 문서에 접근할 수 없습니다. Auth 계정 발급 및 초기화 자동화는 후속 작업입니다.
5. Firebase CLI로 프로젝트 선택 후 `firebase deploy`를 실행합니다. 실제 프로젝트 연결·배포는 이 작업에서 실행하지 않았습니다.

## 구현 범위

- 학생·교사 화면, 공지·중요 정렬·첨부 HTTPS 제한, 포인트 내역
- 상점 lot별 FIFO 예약·승인·반려·취소, 달력 3개월 만료·원만료 유지
- 개별 지급·차감, 월·역할·UID별 중복 방지 일괄 보상
- 일일 퀴즈 1회·서버 채점·제출 전 해설 제거
- UID 역할 배정, 좌석·청소 위임·버전 충돌·중복 검사
- 시험 신청·취소·교사 처리·필터·문자열 셀 XLSX 다운로드
- 앱 내 알림·읽음, 운영 JSON 편집, 변경 감사 기록
- 정적 파일 전용 서비스 워커, 매니페스트, 메모리 인증

## 실운영 전 남은 작업 — 반드시 확인

이 버전은 **검토 가능한 기능 프로토타입**입니다. 설계의 전체 프로덕션 구현을 완료한 상태가 아닙니다.

- 현재 서버는 클래스별 비공개 단일 문서를 Firestore 트랜잭션으로 처리합니다. 700KB 제한으로 원자 거부하며 학급 전체가 경합할 수 있습니다. 설계대로 컬렉션 분리·인덱스·커서 페이지·최소 조회로 이전해야 합니다. 화면의 더 보기는 가져온 데이터의 표시 범위 확대입니다.
- Firestore Rules는 모든 클라이언트 직접 접근을 거부합니다. Functions가 인증·membership·소유권을 검증합니다. Emulator Suite 허용/거부·동시 트랜잭션 통합 테스트는 미실행입니다.
- 예약 승인 후 정정, 만료 배치·요약 정산, 대량 지급 큐·중간 실패 재개, 백업·복구·삭제 스케줄은 미구현입니다. 사용 가능액 계산에서 만료 lot은 즉시 제외합니다.
- 시험 대기 건 수정은 도메인 명령에 있으나 화면 편집 폼은 후속 작업입니다. 내보내기는 클라이언트의 교사 전용 메모리 데이터에 적용되며 서버 측 감사·스트리밍 내보내기를 추가해야 합니다.
- 운영 설정은 JSON 편집기입니다. 필드별 편집 UI·완전한 스키마 검증·문제 버전 동결·공개 명부 축약 정책을 보완해야 합니다.
- 학교 학번 로그인 변환·계정 발급·복구·Auth 비활성화 연계는 미구현입니다. 라이브 모드는 이메일/Google 로그인만 제공합니다.
- 알림은 앱 내 목록만 동작합니다. FCM 구독·발송 큐·로그아웃 기기 정리·iOS 실수신은 미구현입니다.
- 기본 PNG 아이콘은 단색 자리표시자입니다. 실제 배포 전 브랜드 아이콘으로 교체하고 Android/iOS standalone 설치를 확인해야 합니다.
- 첨부 시트 수식·기존 잔액 대조·실제 데이터 이전·학교 외부 시스템 연동은 미수행입니다.

핵심 도메인 테스트는 만료·FIFO·중복 키·상태 경쟁 방지·권한·배치 버전·시험 중복을 검증합니다. 실제 Firebase와 기기 검증을 대신하지 않습니다.

## Emulator에서 실제 Auth/Functions 경로 검토

Firebase CLI 설치 후 프로젝트 루트에서:

```sh
npm --prefix functions run build
firebase emulators:start --project demo-class-portal
```

다른 터미널에서:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npx tsx scripts/init-emulator.ts
```

웹 설정에서 project ID를 `demo-class-portal`, authDomain을 `demo-class-portal.firebaseapp.com`, apiKey를 `demo-api-key`, appId를 `demo-app`, `VITE_USE_EMULATORS=true`로 설정합니다. 로컬 계정은 `teacher@example.test`, `student1@example.test`, `student2@example.test`, 비밀번호는 `EmulatorOnly-2026!`입니다. 이 계정은 로컬 Emulator 전용입니다. 초기화 스크립트는 로컬 Emulator 주소만 허용하고 기존 데이터를 덮어쓰지 않습니다.

## 이번 검증 결과

- `npm test`: 도메인 테스트 8개 통과.
- `npm run build`: TypeScript 검사와 Vite 배포 빌드 통과.
- `npm --prefix functions run build`: 서버 TypeScript 빌드 통과.
- 브라우저 QA: `sites-preview` relay port 4173 readiness timeout으로 미실행. 실제 모바일 설치·알림 검증도 미실행.

## 연결된 웹 앱 설정

사용자가 제공한 `wooriban-2027` 웹 앱 설정을 `.env.local`에 연결했습니다. 새 빌드는 데모가 아닌 Firebase 이메일/Google 로그인을 사용합니다. 학급 ID는 기존 `2026-1-11`을 유지했습니다. 프로젝트 이름과 학급 학년도는 별도 설정입니다. 웹 설정만으로 서버 배포·계정 발급·membership 생성이 완료되지는 않습니다.

Firebase Functions `portal`, Auth 로그인 제공자, 실제 UID 학급 초기화가 필요합니다. 현재 환경에서 Functions URL 접근은 프록시 CONNECT 403으로 차단되어 원격 상태를 확인하지 못했습니다.

## 확인용 비공개 데모 배포

- URL: https://wooriban-2027-review.flowinglapwing8.chatgpt.site
- 배포 소스: `/workspace/sites/wooriban-review`
- 가상 데이터·메모리 전용으로 동작하며 Firebase 실서비스와 분리됩니다.
- Sites 배포 상태 succeeded 확인. 클라우드 브라우저에서는 네트워크 터널 오류로 UI 검증 불가.
- Firebase 설정 빌드 시 `import.meta.env`를 직접 참조하도록 수정했습니다.

## 화면 검토 반영 (2026-11-12)

홈 홍보 문구·푸터·감사 이력 화면 제거, 포인트 잔액 강조, 문제풀이 탭과 홈 하단 바로가기 추가. 공지·상점 화면에서 교사 전용 폼 편집 가능. 포인트 지급항목/포인트현황 하위 탐색 추가. 학급생활 기타수당 제거, 일반 학생 배치 조회 전용, 좌석은 실장 위임 학생만 저장 가능. 감사 원본 기록은 보존. 상단 알림 수신 스위치·알림내역·교사 유형별 자동 알림 설정 추가. 앱 내 알림만 적용하며 FCM은 별도 작업. 도메인 테스트 11개 통과.

## 실제 학생 명단 이전 준비

`./scripts/roster-template.csv`의 studentNo,name,email 열로 명단을 준비합니다. 학번 셀은 텍스트로 유지하세요. 비밀번호·개인 연락처는 포함하지 않습니다. 실제 명단은 Git에 추가하지 않는 `imports/` 폴더에 둡니다.

검증: `npx tsx scripts/import-roster.ts --file imports/명단.csv`

실제 등록은 관리 권한 ADC 인증과 활성 Firebase Auth 계정이 준비된 환경에서만 실행합니다. 서비스 계정 키는 채팅·소스에 포함하지 않습니다.

`npx tsx scripts/import-roster.ts --file imports/명단.csv --apply --teacher-email 교사이메일 --teacher-name 교사명 --year 2027 --class-name "1학년 11반" --class-id 2027-1-11`

실행 대상은 wooriban-2027로 고정되어 있으며 기존 학급은 덮어쓰지 않습니다. 신규 명부의 초기 잔액은 0입니다. 검증된 과거 원장 없이는 샘플 100점이나 임의 기초잔액을 지급하지 않습니다. 이 도구는 Firebase Auth 계정·비밀번호를 생성하거나 변경하지 않고 기존 활성 계정 UID를 조회해 연결합니다. 현재 실제 명단·관리 인증이 없어 실행하지 않았습니다. 서버는 기존 시범 운영 어댑터로, 컬렉션 분리·통합 권한 검증 등 실운영 전 남은 작업은 위 항목을 참조하세요.

## 학생 학번 + 숫자 4자리 로그인

학생 화면은 학번·4자리 숫자 코드를 받고 `studentLogin` callable에서 검증한 뒤 Firebase custom token으로 로그인합니다. 교사는 개인 계정 로그인 유지. 코드는 선행 0을 포함하는 문자열이며 네 자리 숫자 이외의 입력을 거부합니다.

서버 전용 `STUDENT_PIN_PEPPER` 비밀값(32자 이상)을 Secret Manager에 설정해야 합니다. 발급 도구에도 같은 값을 환경변수로 제공합니다. 값은 채팅·Git·프런트 번들·공개 파일에 넣지 않습니다. `pinAccounts` 문서는 클라이언트 직접 읽기/쓰기를 거부하며 HMAC + salt + scrypt 결과만 저장합니다. 학번별 15분 동안 5회 실패/진행 중 시도, IP별 50회 제한을 둡니다. 성공한 시도는 카운터에서 차감합니다. loginLimits.expiresAt에는 Firestore TTL 정책을 운영 설정으로 추가해야 합니다.

명단 점검: `npx tsx scripts/provision-student-pins.ts --file imports/roster-pending.json`

실제 발급은 관리 ADC 인증·네트워크·서버 비밀값과 교사 Auth 계정 준비 후 `--apply --class-id ... --teacher-email ... --teacher-name ... --year ... --class-name ...`로 실행합니다. 발급은 한 번만 진행하고 중단된 작업은 자동 재발급하지 않습니다. 코드는 권한 600의 `imports/student-login-codes.private.json`에만 저장하여 교사가 학생별로 전달합니다. 소스 배포·ZIP에서는 imports를 제외합니다. 기존 시트 비밀번호는 사용하지 않습니다. 계정 발급·실제 서버 배포·실기기 로그인 검증은 아직 실행하지 않았습니다. 교사용 코드 초기화 화면은 후속 작업이며 잠금은 15분 뒤 해제됩니다.

가상 데모는 01101/01102 + 2468로 화면 흐름만 확인합니다. 이는 실제 학생 학번·코드와 관계없는 데모 값입니다. Firebase Auth·트랜잭션·호출 제한 통합 검증은 별도로 필요합니다.

## 선택형 자동로그인

학생·교사 로그인 화면의 '로그인 유지 · 개인 기기'를 선택하면 Firebase SDK browserLocalPersistence로 세션을 보존합니다. 다음 실행은 인증 상태를 복원한 후 서버에서 학급 소속·활성 상태를 재확인합니다. 코드·비밀번호를 자체 localStorage에 저장하지 않습니다. 선택하지 않으면 메모리 세션을 사용합니다. 로그아웃은 저장된 세션을 제거하고 다른 탭의 Auth 변경도 반영합니다.

데모는 선택한 가상 UID만 보존하며 포인트·신청 등 데모 데이터는 계속 초기화됩니다. 소스·배포본에 실제 명단과 코드를 포함하지 않습니다. 자동로그인은 브라우저 데이터 삭제·로그아웃 시 종료되며 브라우저가 저장을 차단하면 재로그인이 필요합니다. 실제 Firebase 인증 복원은 관리 접근 차단으로 실서비스 검증하지 못했습니다.

홈 메뉴 제거, 브랜드 버튼 홈 이동, 학생 포인트 카드 축소, 공통 완료 문구 제거도 반영했습니다.

## 학번 선택 UI

학생 로그인은 학번 드롭다운과 비밀번호(4자리 숫자)로 표시합니다. 서버의 studentLoginOptions는 활성 학생 학번만 반환하며 이름·UID·비밀번호·포인트를 반환하지 않습니다. 이는 사용자가 요청한 로그인용 학번 선택 목록이며, 실제 명단은 프런트 번들에 넣지 않습니다. Firebase 배포 시 studentLoginOptions도 배포해야 합니다. 현재 Sites에는 가상 학번 01101/01102만 표시합니다.

## 주황 톤앤톤 UI

메인 주황 #BF4B08, 살구색 배경 #FFF8F1, 강조 면 #FFEAD5, 짙은 갈색 본문 #482E20을 공통 토큰으로 적용했습니다. 모바일 테마색·설치 아이콘도 동일하게 변경했습니다. 버튼 흰 글자 대비 4.97:1, 본문 대비 11.82:1, 살구색 배경의 보조 문구 대비 4.92:1을 확인했습니다. Firebase 공식 플러그인으로 실배포 관리 연결을 준비 중이며 연결 확인 전에는 실계정 등록·실서비스 배포 완료로 표시하지 않습니다.
