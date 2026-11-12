# Firebase 실제 배포 이어가기

최신 주황 UI와 서버 코드를 이 저장소에 보존했습니다. 현재 배포된 Sites는 가상 데이터 검토본이며 실제 학생용 Firebase 배포는 완료되지 않았습니다.

## 새 클라우드 작업에서

1. 이 저장소와 네트워크 변경을 다시 게시한 환경을 선택합니다.
2. `auth.firebase.tools`, `accounts.google.com`, `*.googleapis.com` 접근을 확인합니다. 기존 작업은 수정 전 네트워크 정책을 유지할 수 있습니다.
3. Firebase 스킬에 따라 최신 CLI 버전과 login:list를 확인하고 필요하면 login --no-localhost로 운영자 Google 로그인을 연결합니다. 비밀번호·인증 코드를 채팅에 요청하지 않습니다.
4. 프로젝트는 wooriban-2027, 학급은 2027-1-11, 웹앱은 1:1064807905569:web:7d4a1fd925bdd6e72ee660입니다. 웹 SDK 설정은 Firebase CLI로 조회하여 .env.local에 작성합니다.
5. Firestore·Auth·교사 계정·STUDENT_PIN_PEPPER·Functions를 구성하고 비공개 명단을 안전하게 가져와 실제 18명 계정을 발급합니다. 기존 시트 비밀번호는 읽거나 사용하지 않습니다.
6. README의 실운영 전 남은 작업을 처리하고 실제 인증/권한/트랜잭션 검증 후 Hosting·Functions·Rules를 배포합니다. 실제 성공 URL과 테스트 결과를 확인하기 전에는 완료라고 보고하지 않습니다.

`imports/`와 .env.local, 실제 명단·비밀번호·발급 코드는 Git에 포함하지 않았습니다. 실제 학생 명단은 기존 대화에서 제공된 원본 Google Sheet를 승인 범위 안에서 다시 읽어야 합니다.
