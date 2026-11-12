# Firebase Spark + Cloudflare Workers Free

이 어댑터는 Firebase Functions 및 Secret Manager 없이 기존 UI와 Firebase Auth/Firestore를 연결합니다. **현재 로컬 검증만 완료했으며 운영 배포·학생 발급·무료 CPU 한도 실측은 미완료입니다.**

## 서버 비밀값

Wrangler secret으로만 설정합니다. `.env.local`의 `VITE_*`, Git, 정적 배포 디렉터리에 넣지 않습니다.

- `FIREBASE_SERVICE_ACCOUNT`: `wooriban-2027`의 전용 서버 계정 JSON. Firestore 및 Auth 관리에 필요한 권한만 부여해야 합니다. 운영자 OAuth refresh token을 서버에 배포하지 않습니다.
- `FIREBASE_WEB_API_KEY`: 등록된 웹앱 API 키.
- `STUDENT_PIN_PEPPER`: 발급 도구와 같은 무작위 서버 비밀값(32자 이상).

프로젝트/학급/허용 Origin은 `wrangler.jsonc`에 고정합니다. 신규 Cloudflare 계정은 Free를 유지하고 유료 구독이나 결제 연결을 추가하지 않습니다.

## 학생 발급 방식

기존 `scripts/provision-student-pins.ts`에 `--workers`를 추가하면 `firebase-password-v1` 계정을 생성합니다. 기존 scrypt 방식과 혼용하거나 이미 발급한 계정을 자동 재발급하지 않습니다. 발급 전에 Worker 비밀값·Auth·전용 서비스 계정 접근·배포를 먼저 검증해야 합니다.

학생 PIN은 임의의 4자리 문자열이며 앞자리 0을 보존합니다. 계정별 salt와 서버 pepper로 HMAC을 계산한 결과를 Firebase Auth의 긴 비밀번호로 설정합니다. 실제 비밀번호 해싱과 검증은 Firebase Auth가 수행합니다. Worker는 학번별 5회/IP별 50회의 15분 제한을 원자적으로 예약하고, 성공 후에만 차감합니다. 클라이언트에는 파생 비밀번호나 salt/pepper를 보내지 않고 5분 수명의 Firebase custom token만 반환합니다. 이후 Firebase SDK가 로그인 세션을 관리합니다.

비공개 발급 파일에는 교사가 학생별로 전달할 원본 PIN을 보관합니다. 발급 중단 시 복구 정보를 확인해야 하며 자동 재발급하지 않습니다. 실제 시트의 비밀번호 열은 조회하지 않습니다.

## 서버 권한 및 데이터

`portal`은 Firebase ID token의 서명/발급자/대상/만료를 검증하고 Auth 사용자 비활성화·토큰 철회·학급 membership을 확인합니다. 도메인 명령과 학생 응답 필터는 기존 코드를 재사용합니다. Firestore REST의 원자적 commit과 문서 updateTime 사전조건으로 중복 지급·경합 시 재시도를 처리합니다. 보안 규칙은 계속 모든 클라이언트 직접 접근을 거부합니다.

현재 단일 비공개 학급 문서 및 700KB 제한은 유지됩니다. 컬렉션 분리/커서 조회, 정정·백업·복구·삭제 일정, 운영 설정 스키마 보완, FCM/실기기 검증 등 README의 미완료 항목이 해결된 것으로 간주하면 안 됩니다. 서버 이전만으로 모든 실운영 요구사항이 완성되지는 않습니다.

## 검증 및 배포 순서

1. `npm test`, `npm run worker:check`, `npm run build`, Functions 호환 빌드 확인.
2. `npx -y wrangler@latest deploy --dry-run --outdir /tmp/wooriban-worker-build`로 번들 점검.
3. Cloudflare CLI 로그인, 전용 Firebase 서비스 계정과 Wrangler secrets 구성. 비밀값은 CLI 입력/비공개 파일에서만 처리.
4. Worker 배포 후 `/health`, CORS, 실제 Google ID token, 비인가/타학급 접근 거부, 동시 요청, CPU 및 무료 한도 검증.
5. `--workers`로 실제 명단을 1회 발급하고 teacher membership/학년도/0점 초기 상태 확인. 가상 seed를 실데이터에 사용하지 않음.
6. 배포된 Worker HTTPS URL을 `.env.local`의 `VITE_API_BASE`로 설정하고 다시 빌드. `npx -y firebase-tools@latest deploy --only hosting --project wooriban-2027` 실행.
7. 실제 Hosting 주소에서 드롭다운·학생 로그인·교사 로그인·권한·새로고침/로그아웃 검증 후에만 완료 보고.

프런트에서 `VITE_API_BASE`가 비어 있으면 기존 callable Functions를 사용합니다. Worker 미배포 상태에서 프런트만 배포하지 않습니다.
