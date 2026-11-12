# Firebase 실제 배포 이어가기

## 최신 진행 및 무료 운영 전환

사용자는 결제 계정 연결과 Blaze 전환을 원하지 않습니다. Firebase Spark를 유지하고 Cloudflare Workers Free 서버를 사용하기로 했으며 Cloudflare 계정 가입을 완료했습니다. 유료 리소스/구독을 추가하지 마세요.

실제 Firebase CLI 로그인·프로젝트 접근, 서울 리전 기본 Firestore 생성, deny-all Rules 및 Google/이메일 Auth 설정 배포, 운영자 교사 Auth 계정 준비를 완료했습니다. 학생 18명 학번/이름은 비공개 imports에서 검증했지만 실제 학생 계정과 새 PIN은 아직 발급하지 않았습니다.

`worker/README.md`에 무료 어댑터·보안 구조·운영 배포 순서를 기록했습니다. UI는 유지하며 `VITE_API_BASE`로 Workers를 선택합니다. 발급 도구에는 `--workers`를 명시해야 합니다. 기존 scrypt 계정을 Workers 계정과 혼용하지 마세요.

2026-11-12의 새 환경에서는 Cloudflare 허용 목록이 적용되었으며 API 접속과 Wrangler OAuth 로그인을 확인했습니다. 계정 ID는 `046268350e5930f25adaed2e20fe1df7`이고, 무료 Workers용 `wooriban-2027.workers.dev` 서브도메인을 등록했습니다. 결제·유료 구독은 추가하지 않았습니다. Worker는 아직 존재하지 않으며 배포하지 않았습니다.

새 환경에는 이전 Firebase 로그인·서버 키·명단이 보존되지 않았습니다. Firebase CLI 15.36.0의 `login:list`에서 인증 계정이 없음을 확인했고 운영자 로그인을 기다리고 있습니다. CLI 인증 코드는 채팅에 요청하지 않습니다. 실제 원본 시트의 `학생코드!A2:B61` 두 열만 다시 읽어 18명을 비공개 `imports/roster-pending.json`에 준비하고 검증했습니다. C열의 기존 학생 비밀번호 데이터는 읽지 않았습니다. 학생 발급은 아직 실행하지 않았습니다.

현재 환경에서 24개 테스트, Worker strict 타입 검사, 프런트 빌드, Functions 호환 빌드, Wrangler 4.160.1 dry-run을 통과했습니다. 실제 Hosting 주소의 접속은 환경 프록시 CONNECT 403으로 차단됩니다. 기존 허용 목록을 유지한 채 `wooriban-2027.web.app`, `wooriban-2027.firebaseapp.com`, `www.gstatic.com`, `apis.google.com`을 추가해 실제 브라우저 검증이 가능하도록 해야 합니다. 서비스 계정 키나 OAuth refresh token, 원본 명단·PIN·pepper를 Git에 추가하지 마세요.

최신 주황 UI와 서버 코드를 이 저장소에 보존했습니다. 현재 배포된 Sites는 가상 데이터 검토본이며 실제 학생용 Firebase 배포는 완료되지 않았습니다.

## 새 클라우드 작업에서

1. 이 저장소의 `setup/firebase-workers-free` 브랜치 및 최신 네트워크 설정이 적용된 환경을 선택합니다. 이 브랜치는 PR #1입니다.
2. `auth.firebase.tools`, `accounts.google.com`, `*.googleapis.com` 접근을 확인합니다. 기존 작업은 수정 전 네트워크 정책을 유지할 수 있습니다.
3. Firebase 스킬에 따라 최신 CLI 버전과 login:list를 확인하고 필요하면 login --no-localhost로 운영자 Google 로그인을 연결합니다. 비밀번호·인증 코드를 채팅에 요청하지 않습니다.
4. 프로젝트는 wooriban-2027, 학급은 2027-1-11, 웹앱은 1:1064807905569:web:7d4a1fd925bdd6e72ee660입니다. 웹 SDK 설정은 Firebase CLI로 조회하여 .env.local에 작성합니다.
5. 기존 Spark·기본 Firestore·Auth·교사 계정 상태를 확인합니다. `worker/README.md` 순서대로 전용 서비스 계정·Wrangler secrets를 구성하고 Worker를 먼저 배포·검증한 후 비공개 명단의 실제 18명을 `--workers`로 1회 발급합니다. 기존 시트 비밀번호는 읽거나 사용하지 않습니다. 기존 계정이나 초기화 작업이 있으면 자동 재발급·덮어쓰기를 하지 않습니다.
6. README의 실운영 전 남은 작업을 처리하고 실제 인증/권한/트랜잭션 검증 후 `VITE_API_BASE`를 설정해 Hosting만 배포합니다. 필요한 Rules 배포는 별도로 지정합니다. Functions·Secret Manager 배포나 결제 연결을 실행하지 않습니다. 실제 성공 URL과 테스트 결과를 확인하기 전에는 완료라고 보고하지 않습니다.

`imports/`와 .env.local, 실제 명단·비밀번호·발급 코드는 Git에 포함하지 않았습니다. 실제 학생 명단은 기존 대화에서 제공된 원본 Google Sheet를 승인 범위 안에서 다시 읽어야 합니다.
