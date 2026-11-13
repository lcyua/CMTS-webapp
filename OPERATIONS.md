# 무료 운영의 백업·복구·보관 일정

대상은 이미 생성된 `wooriban-2027` 프로젝트의 Standard `(default)` Firestore, 학급 `2027-1-11`입니다. 도구는 기본 학급 문서와 현재 저장 세대의 원장·신청·문제풀이·알림·감사 이력, 요청 영수증을 논리 학급 백업으로 묶습니다. Firebase Auth, `pinAccounts`, PIN 전달 파일, 서비스 계정 키·pepper, 기기 푸시 토큰은 조회·복원·삭제하지 않습니다. 기존 18명 계정·PIN을 재발급하는 도구가 아닙니다.

이 도구는 로컬에서 준비·검사했으며 실제 운영 백업 생성, 복구, 정리 또는 스케줄 등록은 이 작업에서 실행하지 않았습니다. 결제 연결·유료 Firestore export·Cloud Scheduler가 필요하지 않습니다. 예약 실행에는 안전하게 관리하는 상시 실행 호스트가 필요합니다. 호스트가 꺼져 있거나 인증이 만료되면 백업도 실행되지 않습니다.

## 준비와 기본 동작

Node 22 이상과 `npm ci`, `npm --prefix functions ci`가 필요합니다. 기존 관리 ADC 인증을 사용하고 프로젝트에 필요한 Firestore 접근 권한만 부여합니다. 비밀키·토큰을 명령 인수나 채팅에 입력하지 않습니다. 프록시 환경에서는 기존 `HTTPS_PROXY`와 CA 설정을 유지합니다. SDK는 REST 전송과 프록시 agent를 사용합니다.

`--apply`가 없으면 백업·복구·정리는 원격에 연결하지 않는 계획 출력입니다. `check`는 지정한 로컬 백업만 검사하고 `prune-local`은 지정한 로컬 폴더만 검사합니다. 변경 실행에는 `--apply --confirm wooriban-2027/2027-1-11`을 모두 지정해야 합니다. 잘못된 프로젝트, 누락된 학급 ID, 에뮬레이터 변수가 있으면 중단합니다.

```sh
npx tsx scripts/class-maintenance.ts backup --project wooriban-2027 --class-id 2027-1-11
bash scripts/maintenance-daily.sh
```

도구는 학생 이름·학번·본문·비밀번호를 로그에 출력하지 않습니다. 로그에는 대상 ID, 개수, 버전 시간, 백업 경로만 기록합니다. `imports/`는 Git과 소스 ZIP·정적 Hosting에서 제외합니다.

## 백업

기본 저장 폴더는 `imports/backups/`입니다. 본인 소유의 폴더 700·파일 600만 허용하고 심볼릭 링크는 거부합니다. 같은 파일을 덮어쓰지 않는 새 파일을 생성하고 쓰기 후 fsync합니다. 백업에는 형식 버전·대상 경로·저장 구조·원본 문서 updateTime·생성 시간·SHA-256 체크섬을 포함합니다.

분리 저장에서는 읽기 전용 Firestore 트랜잭션 안에서 기본 문서, 현재 세대의 모든 `history_*` 기본 컬렉션, `commandReceipts`를 500개씩 끝까지 읽습니다. 모든 페이지는 같은 시점에 고정되며 메타데이터의 개수와 실제 이력 개수가 다르면 중단합니다. 학생별 조회 사본은 중복 백업하지 않고 복구할 때 다시 만듭니다. 논리 학급 데이터는 32MiB, 영수증을 포함한 파일은 40MiB, 개별 기록은 700KB로 제한합니다. 상한을 넘으면 일부만 저장하지 않고 백업을 중단합니다. 기존 단일 문서 구조도 지원합니다.

```sh
npx tsx scripts/class-maintenance.ts backup --project wooriban-2027 --class-id 2027-1-11 --apply --confirm wooriban-2027/2027-1-11
npx tsx scripts/class-maintenance.ts check --project wooriban-2027 --class-id 2027-1-11 --file imports/backups/발급된백업파일.class-backup.json
```

JSON 백업은 학생의 학급 기록을 포함하는 **평문 개인정보 파일**입니다. 체크섬은 손상 탐지용이며 암호화·전자서명이 아닙니다. 암호화된 디스크에 보관하고 신뢰하는 저장소에 암호화한 별도 사본을 두어야 합니다. 백업과 원본을 같은 임시 클라우드 작업에만 두면 작업 삭제 시 함께 잃습니다. 원본 PIN 전달 파일은 별도 안전한 보관 절차로 유지합니다. 이 도구로 PIN을 읽거나 새로 생성하지 않습니다.

## 복구

복구는 백업 시점의 포인트·신청·공지 등 학급 도메인 기록으로 되돌리는 작업입니다. 먼저 체크섬·대상·테이블·파일 상한을 검사합니다. 현재와 백업의 계정 ID·역할·학번 구성이 다르면 중단하고, 현재 계정의 이름·활성 상태·위임 권한을 그대로 유지합니다. Auth와 PIN 저장소에는 접근하지 않습니다. 현재와 백업의 감사 기록·요청 영수증을 병합하고 복구 감사 기록을 남깁니다. 같은 요청 키의 입력이 다르면 중단합니다.

복구 데이터는 새 `storageGenerations/restore_*` 경로에 400개 이하의 생성 전용 배치로 준비하고 학생별 조회 사본·포인트 요약도 재구성합니다. 기존 이력을 덮어쓰거나 삭제하지 않습니다. 누락된 전역 요청 영수증도 생성 전용으로 복원합니다. 마지막 트랜잭션이 기본 문서 updateTime을 다시 검사한 뒤 새 세대 포인터를 한 번에 바꿉니다. 준비 중 변경이나 오류가 있으면 활성화를 중단하고 현재 세대가 계속 사용됩니다. 비활성 준비 데이터나 이미 복원한 누락 영수증이 남을 수 있으며 자동 삭제하지 않습니다. 기본 설정 문서가 여전히 700KB를 넘으면 준비 전에 중단합니다.

1. 사용자가 접속하지 않는 유지보수 시간에 현재 문서 버전을 확인합니다. 아래 `inspect`는 읽기만 수행하지만 원격 연결 허용을 위해 `--apply`와 대상 확인을 요구합니다.

   ```sh
   npx tsx scripts/class-maintenance.ts inspect --project wooriban-2027 --class-id 2027-1-11 --apply --confirm wooriban-2027/2027-1-11
   ```

2. 사용할 파일을 `check`로 검사하고 복구 계획을 먼저 출력합니다.

   ```sh
   npx tsx scripts/class-maintenance.ts restore --project wooriban-2027 --class-id 2027-1-11 --file imports/backups/백업파일.class-backup.json
   ```

3. `inspect`에서 받은 updateTime 전체(나노초까지)를 `--expect-update-time`에 넣습니다. 실제 복구 전에 현재의 전체 논리 상태와 영수증을 `before-restore` 백업으로 저장합니다. 원본이 그 사이 바뀌면 활성화를 중단하며, 바뀐 버전에 자동으로 덮어쓰지 않습니다.

   ```sh
   npx tsx scripts/class-maintenance.ts restore --project wooriban-2027 --class-id 2027-1-11 --file imports/backups/백업파일.class-backup.json --expect-update-time 'inspect에서받은UTC시간' --apply --confirm wooriban-2027/2027-1-11
   ```

현재 문서 자체가 없는 사고, 계정 구성이 바뀐 사고 또는 감사 요청 키가 충돌한 사고는 이 도구가 자동 처리하지 않습니다. 후속 쓰기를 멈추고 검증된 백업·이력을 검토해야 합니다. 복구로 백업 이후의 업무 상태가 되돌아가므로 실제로 처리한 신청·지급과의 대조가 필요합니다. 복구 후에는 교사·학생 조회, 포인트·예약·신청의 일관성을 확인합니다. 로컬 테스트는 1,001건의 여러 페이지 백업, 세대 전환, 영수증 보존과 동시 변경 시 활성화 중단을 검증합니다. 실제 운영 복구 훈련을 완료한 결과는 아닙니다.

## 보관·정리 일정

`prune-local`은 위 도구가 생성한 정확한 형식·대상의 로컬 백업만 정리합니다. 기본은 **최신 30개를 보존하면서 생성 후 30일이 지난 나머지만 삭제**합니다. 최소 2개·최소 1일보다 낮은 정책은 거부합니다. 다른 파일, PIN 파일, 원격 학급 기록·계정에는 접근하지 않습니다. 손상된 백업이 있으면 자동 삭제를 중단합니다.

```sh
npx tsx scripts/class-maintenance.ts prune-local --project wooriban-2027 --class-id 2027-1-11 --keep-last 30 --older-than-days 30
npx tsx scripts/class-maintenance.ts prune-local --project wooriban-2027 --class-id 2027-1-11 --keep-last 30 --older-than-days 30 --apply --confirm wooriban-2027/2027-1-11
```

`maintenance-daily.sh`는 백업 성공 후 로컬 보관 정리와 해당 학급의 로그인 제한 문서 정리를 차례로 실행합니다. 기본은 전체 계획 출력이고 `--apply` 때만 실행합니다. 중간 실패 시 그날 후속 단계를 중단합니다.

관리 호스트에서 로컬 타임존을 UTC로 확인한 뒤 다음처럼 매일 **17:00 UTC = 다음 날 02:00 KST**에 실행할 수 있습니다. `node`의 실제 경로와 저장소 경로를 그 호스트에 맞춥니다. 중복 작업은 `flock`으로 막습니다. 아래는 설치 예시이며 이 저장소를 받는 것만으로 cron이 등록되지는 않습니다.

```cron
PATH=/usr/local/bin:/usr/bin:/bin
0 17 * * * umask 077; cd /workspace/CMTS-webapp && /usr/bin/flock -n imports/maintenance.lock bash scripts/maintenance-daily.sh --apply >> imports/maintenance.log 2>&1
```

등록 전에 운영자가 `imports/`를 본인 소유 700으로 준비하고 ADC 인증, 실제 백업 생성·체크, 로그 모니터링·디스크 공간 경고를 확인해야 합니다. 백업은 현재 세대의 모든 기본 이력과 요청 영수증을 읽으므로 데이터가 쌓일수록 일일 읽기 사용량이 늘어납니다. 조회 사본은 읽지 않으며 제한 문서 정리는 기본 문서와 학생별 제한 문서만 읽습니다. Firestore 무료 쿼터를 관찰하고 한도나 백업 실패를 결제 연결로 우회하지 않습니다. 백업 실패 알림과 외부 암호화 사본 전송은 관리 호스트에 연결해야 합니다.

## 로그인 제한 문서 정리와 TTL

기존 Worker 버전은 `loginLimits.expiresAt`를 숫자 밀리초로 저장했습니다. Firestore TTL 필드는 Timestamp여야 하므로 숫자 필드는 TTL 대상이 되지 않습니다. TTL 삭제는 무료 사용량에 포함되지 않으며 결제 활성화가 필요할 수 있으므로 이 Spark 프로젝트에서 TTL 정책을 자동 활성화하지 않습니다.

```sh
npx tsx scripts/class-maintenance.ts cleanup-login-limits --project wooriban-2027 --class-id 2027-1-11
npx tsx scripts/class-maintenance.ts cleanup-login-limits --project wooriban-2027 --class-id 2027-1-11 --apply --confirm wooriban-2027/2027-1-11
```

이 명령은 현재 학급의 학생 번호로 계산한 `account_` 제한 문서만 대상으로 삼습니다. 숫자 `expiresAt`를 같은 시각의 Timestamp로 바꾸고, 만료 시각과 15분 제한 창이 **모두** 지난 문서만 트랜잭션에서 다시 확인해 삭제합니다. 활성 제한 창·실패 횟수를 초기화하지 않습니다. 형식이 불완전한 문서는 건드리지 않습니다. 학급을 특정할 수 없는 공유 `ip_` 문서는 정리하지 않으며 프로젝트 전체 정책에 따른 별도 검토가 필요합니다.

학교의 원본 학생 기록·감사·회계 기록 삭제 보관 기간은 이 로컬 백업 정책으로 결정하지 않습니다. 보존 의무와 승인된 삭제 대상을 정하기 전에는 해당 운영 기록을 자동 삭제하지 않습니다.
