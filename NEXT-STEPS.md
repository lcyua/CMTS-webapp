# Firebase 실제 배포 이어가기

## 최신 진행 및 무료 운영 전환

사용자는 결제 계정 연결과 Blaze 전환을 원하지 않습니다. Firebase Spark를 유지하고 Cloudflare Workers Free 서버를 사용하기로 했으며 Cloudflare 계정 가입을 완료했습니다. 유료 리소스/구독을 추가하지 마세요.

실제 Firebase CLI 로그인·프로젝트 접근, 서울 리전 기본 Firestore 생성, deny-all Rules 및 Google/이메일 Auth 설정 배포, 운영자 교사 Auth 계정 준비를 완료했습니다. 학생 18명 학번/이름은 비공개 imports에서 검증했지만 실제 학생 계정과 새 PIN은 아직 발급하지 않았습니다.

`worker/README.md`에 무료 어댑터·보안 구조·운영 배포 순서를 기록했습니다. UI는 유지하며 `VITE_API_BASE`로 Workers를 선택합니다. 발급 도구에는 `--workers`를 명시해야 합니다. 기존 scrypt 계정을 Workers 계정과 혼용하지 마세요.

현재 작업 환경에는 Cloudflare 허용 목록 변경이 반영되지 않았습니다. 사용자가 설정 변경을 완료했다고 했지만 실행 환경 status는 spec revision 1, 허용 호스트는 Google 관련 항목뿐이며 새 `api.cloudflare.com` 연결도 프록시 CONNECT 403입니다. 최신 네트워크 설정이 적용된 환경이 필요합니다. Cloudflare 배포/Hosting 접속 검증은 아직 완료되지 않았습니다. 서비스 계정 키나 OAuth refresh token, 원본 명단·PIN·pepper를 Git에 추가하지 마세요.

최신 주황 UI와 서버 코드를 이 저장소에 보존했습니다. 현재 배포된 Sites는 가상 데이터 검토본이며 실제 학생용 Firebase 배포는 완료되지 않았습니다.

## 새 클라우드 작업에서

1. 이 저장소와 네트워크 변경을 다시 게시한 환경을 선택합니다.
2. `auth.firebase.tools`, `accounts.google.com`, `*.googleapis.com` 접근을 확인합니다. 기존 작업은 수정 전 네트워크 정책을 유지할 수 있습니다.
3. Firebase 스킬에 따라 최신 CLI 버전과 login:list를 확인하고 필요하면 login --no-localhost로 운영자 Google 로그인을 연결합니다. 비밀번호·인증 코드를 채팅에 요청하지 않습니다.
4. 프로젝트는 wooriban-2027, 학급은 2027-1-11, 웹앱은 1:1064807905569:web:7d4a1fd925bdd6e72ee660입니다. 웹 SDK 설정은 Firebase CLI로 조회하여 .env.local에 작성합니다.
5. Firestore·Auth·교사 계정·STUDENT_PIN_PEPPER·Functions를 구성하고 비공개 명단을 안전하게 가져와 실제 18명 계정을 발급합니다. 기존 시트 비밀번호는 읽거나 사용하지 않습니다.
6. README의 실운영 전 남은 작업을 처리하고 실제 인증/권한/트랜잭션 검증 후 Hosting·Functions·Rules를 배포합니다. 실제 성공 URL과 테스트 결과를 확인하기 전에는 완료라고 보고하지 않습니다.

`imports/`와 .env.local, 실제 명단·비밀번호·발급 코드는 Git에 포함하지 않았습니다. 실제 학생 명단은 기존 대화에서 제공된 원본 Google Sheet를 승인 범위 안에서 다시 읽어야 합니다.
