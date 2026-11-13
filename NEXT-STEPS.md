# Firebase 실제 배포 이어가기

## 현재 상태 — 2026-11-12

PR #1의 `setup/firebase-workers-free` 브랜치에서 Firebase Spark + Cloudflare Workers 서버를 실제 배포했습니다. 결제 계정·Blaze·Workers 유료 구독을 추가하지 않았습니다. 배포 후 Cloud Billing API에서 `billingEnabled=false`, 빈 `billingAccountName`을 확인했습니다.

- Hosting: https://wooriban-2027.web.app
- API: https://wooriban-2027-api.wooriban-2027.workers.dev
- 프로젝트: `wooriban-2027`, 기본 Firestore: Standard / `asia-northeast3`.
- 학급 `2027-1-11`, 2027학년도, 학생 18명과 교사 1명 membership 구성 완료. 초기 포인트·공지·감사 이력은 비어 있습니다.
- Hosting live 버전 `293841b2aa5c57a6`, 2026-11-12 20:29 KST 배포. Hosting API에서 `FINALIZED` 및 live release를 확인했고 번들의 API 주소와 서버 비밀값 미포함도 확인했습니다.
- Google·이메일/비밀번호 Auth와 deny-all Firestore Rules 유지. Functions·Secret Manager는 배포하지 않았습니다.
- 최종 Worker 버전 `04f64559-5bfd-4c06-91cd-fd0c030377e7`. 전용 서버 계정은 발급 후 Auth 관리 권한을 제거하고 `roles/firebaseauth.viewer`와 `roles/datastore.user`만 유지합니다. 이 런타임 계정으로 학생 생성·변경·삭제를 실행하지 않습니다.

원본 시트에서는 `학생코드!A2:B61`의 학번·이름만 읽었습니다. C열의 기존 학생 비밀번호 데이터는 읽거나 사용하지 않았습니다. 학생 18명을 `--workers`로 한 번 발급했고 새 PIN은 권한 600의 `imports/student-login-codes.private.json`에만 보관했습니다. 이 파일·원본 명단·`.env.local`·서버 키·pepper·OAuth 인증 정보는 Git과 정적 배포에서 제외했습니다.

**학생 발급을 다시 실행하지 마세요.** 학급 상태와 초기화 작업은 이미 존재합니다. 기존 계정·PIN·포인트를 자동 재발급하거나 덮어쓰지 않습니다. 새 환경으로 이동하기 전 비공개 발급 파일을 운영자가 안전하게 보관해야 합니다. Git checkout에는 비공개 파일과 로그인 정보가 포함되지 않습니다.

## 검증 결과

- 로컬 테스트 28개, Worker strict 검사, 실제 Firebase 설정의 프런트 빌드, Functions 호환 빌드 통과.
- 실제 Worker health·CORS·비로그인·타학급 요청 거부 확인.
- 새 PIN 18개 모두 실제 로그인 → Firebase 토큰 교환 → 학급 조회 성공. 학생 응답 필터와 교사 membership, 2027 학년도·0점 초기 상태 확인.
- 학생의 포인트 지급·Firestore 직접 읽기/쓰기 거부. 임시 계정으로 비소속·위조 JWT·타학급·토큰 철회·비활성 계정 거부 확인 후 임시 계정 삭제.
- 임시 문서의 동일 요청 6개 동시 commit이 한 번만 반영됨을 확인하고 문서 삭제. 실제 학생에게 테스트 포인트를 지급하지 않았습니다.
- 실서버에서 발견한 HTTP 400 `FAILED_PRECONDITION` 재시도와 발급 도구의 Firestore REST 프록시 설정을 수정했습니다. 잘못된 입력은 충돌로 재시도하지 않습니다.
- 최종 Worker에서 학생 18명의 로그인 CPU 5~8ms, portal 샘플 1~5ms, 로그인 옵션 6ms를 관측했습니다. 수집 요청은 모두 정상 처리됐으며 장기 부하·일일 무료 쿼터 관찰은 별도입니다.

2026-11-12에는 환경 프록시의 CONNECT 403 및 공유 Chromium의 `ERR_TUNNEL_CONNECTION_FAILED`로 Hosting 브라우저 검증을 진행하지 못했습니다. 최신 환경에서 재검증한 결과는 아래와 같습니다. 배포 성공과 인증 후 브라우저 검증 완료를 구분해 보고해야 합니다. CPU 실측과 잔여 주의사항은 `worker/README.md`에 기록합니다.

## Hosting 브라우저 재검증 — 2026-11-13

- 최신 환경 status에서 필요한 10개 도메인과 `observations_current=true`, 네트워크 정책 `enforced`를 확인했습니다. 새 연결에서 Hosting HTTP 200, Worker `/health`의 `ok=true`, `configured=true`를 확인했습니다. 이전 Hosting 접속 차단은 해소됐습니다.
- 실제 배포 주소를 Chromium으로 열어 로그인 화면·2027학년도·1학년 11반·학교명을 확인했습니다. 1440×1050 및 390×844 화면에서 가로 넘침이 없었습니다. 모바일 결과는 화면 크기 에뮬레이션이며 실기기 설치 검증은 아닙니다.
- 학번 드롭다운에 중복 없는 숫자 학번 18개가 표시되고 이름은 노출되지 않았습니다. PIN 입력은 마스킹·숫자 키보드·4자리 제약을 사용합니다. 빈 입력·3자리·문자 입력이 브라우저에서 차단됐으며 이 검사 중 `/studentLogin` 요청은 보내지 않았습니다.
- 자동로그인은 기본 꺼짐이며 학생·교사 폼의 체크 상태가 연동됐습니다. 오프라인 학생 로그인 비활성화·온라인 복귀 시 활성화, 비로그인 상태의 브라우저 새로고침을 확인했습니다. 로그인 화면 UI 검사 11개가 통과했습니다.
- 교사 로그인 펼침과 Google 팝업이 실제 `accounts.google.com` 로그인 화면까지 열리는 것을 확인했습니다. 자격 증명을 입력하거나 운영자 인증을 완료한 결과는 아닙니다. Google 화면의 `fonts.gstatic.com` 글꼴 요청 일부는 환경 정책에 막혔지만 로그인 폼은 표시됐습니다.
- 서비스 워커가 실제 Hosting 주소에서 `activated` 상태인 것을 확인했습니다. PWA 실기기 설치·오프라인 인증·FCM 수신을 검증한 결과는 아닙니다.
- 기존 `npm test` 28/28 및 `npm run worker:check`를 다시 통과했습니다. 프런트·Worker·Rules를 변경하거나 재배포하지 않았습니다.
- 새 환경에는 `imports/student-login-codes.private.json`과 로그인 세션이 없습니다. **실제 학생 로그인, 운영자 Google 인증 완료, 인증 후 앱 새로고침·브라우저 새로고침·로그아웃은 아직 미검증**입니다. 기존 계정·PIN 재발급, 원본 시트/기존 비밀번호 조회, 결제 연결은 실행하지 않았습니다.

인증 후에는 다음 동작을 구분해 확인합니다. 자동로그인 미체크는 메모리 세션이므로 브라우저 새로고침 시 로그인 화면으로 돌아오는 것이 정상입니다. 앱의 `↻ 새로고침`은 세션을 유지해야 합니다. 자동로그인 체크 시 브라우저 새로고침 후 같은 사용자의 화면을 복원하고, `로그아웃 ↗` 후에는 다시 새로고침해도 비로그인 상태여야 합니다. 학생의 설정 메뉴 부재와 개인 기록 필터, 교사 메뉴도 실제 로그인 후 확인해야 합니다.

## 다음 작업

1. 최신 환경의 10개 도메인 적용과 Hosting 새 연결은 확인 완료했습니다. 도메인을 다시 입력하도록 요청하지 않습니다. 기존 18명 계정을 재발급하거나 원본 비밀번호 열을 읽지 않습니다. 비공개 PIN 전달 파일은 운영자가 안전하게 보관하며 Git checkout에는 포함하지 않습니다.
2. 실제 Hosting 주소에서 운영자가 기존 발급 PIN 또는 Google 로그인을 직접 입력한 뒤 학생·교사 권한, 로그인 유지·새로고침·로그아웃을 검증합니다. 비밀번호나 인증 코드를 채팅에 요청하지 않습니다. 팝업 표시만으로 Google 인증 완료를 보고하지 않습니다.
3. CPU·무료 쿼터 관찰과 README의 단일 문서 700KB, 백업·복구·삭제 일정, FCM 등의 미완료 요구사항을 처리합니다. 결제 연결이나 유료 업그레이드로 우회하지 않습니다.

## 이후 코드 배포

`VITE_API_BASE`는 위 API 주소여야 합니다. 비우면 과거 callable Functions를 사용합니다. 전용 서버 자격 증명은 Wrangler secrets에만 두며 운영자 OAuth refresh token은 배포하지 않습니다.

```sh
npm test
npm run worker:check
npm run build
npm --prefix functions run build
npx -y wrangler@latest deploy
npx -y firebase-tools@latest deploy --only hosting --project wooriban-2027
```

Rules 변경은 `npx -y firebase-tools@latest deploy --only firestore:rules --project wooriban-2027`로 별도 배포합니다. 전체 deploy나 Functions·Secret Manager 배포를 실행하지 않습니다.
