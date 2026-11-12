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

Hosting 화면의 드롭다운·Google 팝업·새로고침 유지·로그아웃·실기기 PWA 검증은 **미완료**입니다. 환경 프록시의 CONNECT 403 및 공유 Chromium의 `ERR_TUNNEL_CONNECTION_FAILED`를 확인했습니다. 배포 성공과 브라우저 검증 완료를 구분해 보고해야 합니다. CPU 실측과 잔여 주의사항은 `worker/README.md`에 기록합니다.

## 다음 작업

1. 사용자가 제공한 환경 설정 스크린샷에서 필요한 10개 도메인을 정확하게 입력한 것을 확인했습니다. `wooriban-2027.web.app`, `wooriban-2027.firebaseapp.com`, `www.gstatic.com`, `apis.google.com`을 다시 입력하도록 요청하지 않습니다. 기존 실행 환경은 여전히 이전 6개 도메인의 revision 1을 사용하며 새 연결도 CONNECT 403입니다. 현재 채팅에는 실행 정책 변경 도구가 없습니다. 설정 화면의 저장·게시를 완료한 최신 환경을 새 클라우드 작업에서 선택하고, 먼저 status와 새 연결로 적용 여부를 확인해야 합니다. 이때 기존 18명 계정을 재발급하거나 원본 비밀번호 열을 읽지 않습니다. 새 작업으로 옮기기 전 비공개 새 PIN 전달 파일을 운영자가 보관해야 합니다.
2. 실제 Hosting 주소에서 학생 로그인, 운영자 Google 로그인, 권한, 로그인 유지·새로고침·로그아웃을 검증합니다. 비밀번호나 인증 코드를 채팅에 요청하지 않습니다.
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
