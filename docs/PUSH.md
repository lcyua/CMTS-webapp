# 기기 푸시 알림

Firebase Cloud Messaging HTTP v1과 기존 무료 Cloudflare Worker를 사용합니다. 기본값은 꺼짐입니다. 앱 내 알림은 이 설정과 관계없이 기존 방식으로 동작합니다.

## 활성화 전 설정

- 공개 웹 설정: `VITE_ENABLE_PUSH=true`, Firebase 콘솔에서 생성한 공개 `VITE_FIREBASE_VAPID_KEY`. 서버 키·PIN·pepper를 이 값에 넣지 않습니다.
- Worker 설정: `PUSH_ENABLED=true`. 기존 전용 런타임 서비스 계정에 FCM 발송용 `roles/firebasecloudmessaging.admin` 권한과 FCM API 사용이 필요합니다. 이 구현은 권한·API·결제 설정을 자동 변경하지 않습니다. 별도 FCM 서버 비밀키를 클라이언트에 넣지 않습니다.
- Worker scheduled 이벤트에서 `dispatchPush`를 호출합니다. 기본값은 실행당 1개 작업, 계정당 최대 5기기입니다. 측정 후에도 `maxJobs`는 최대 5로 제한합니다. 5분 주기의 기본 처리량은 하루 최대 288개 알림 작업입니다. CPU와 Firestore 무료 쿼터를 확인하고 활성화합니다.
- `public/sw.js`가 `/push-worker.js`를 가져와야 합니다. 같은 서비스 워커를 PWA와 Messaging 토큰에 사용합니다. 별도 Firebase 서비스 워커를 루트 범위에 등록하지 않습니다.

## 서버 연결

`/pushDevice`는 기존 Firebase ID token 서명·철회·활성 Auth 사용자 검사 후에만 처리합니다. 서버의 학급 상태에서 현재 UID의 활성 membership을 확인한 뒤 `updatePushDevice(store,classId,uid,state,data,env.PUSH_ENABLED==='true')`를 호출합니다. 등록은 `action:'register',deviceId,token`, 현재 기기 해제는 `action:'unregister',deviceId`, 계정 전체 기기 해제는 `action:'unregisterAll'`입니다. 호출자의 레지스트리만 수정하며 토큰은 반환하지 않습니다.

기기 토큰은 `classes/{classId}/pushUsers/{SHA256(uid)}`에 계정당 최대 5개를 보관합니다. 학급 상태·학생 응답·감사 입력·브라우저 자체 localStorage에 넣지 않습니다. `pushTokens/{SHA256(token)}`의 소유자 기록으로 동일 토큰을 다른 계정에 동시에 연결하는 것을 거부합니다. 등록 commit은 현재 학급 상태의 updateTime도 verify하여 비활성화와 경합한 등록을 거부합니다. 90일 동안 갱신되지 않은 등록·토큰 소유자 기록과 FCM의 `UNREGISTERED` 응답은 제한된 수량씩 제거합니다. 클라이언트는 동의한 기기에서 로그인 복원 시 `sync()`로 등록을 갱신합니다.

도메인 명령 적용 전 inbox ID 집합을 보관한 뒤, 저장소의 같은 commit 안에서 `preparePushWrites` 결과를 함께 저장합니다. 제어 문서 `pushControlPath(classId)`도 같은 사전조건으로 읽고 써야 합니다. 명령과 큐 생성이 분리되면 중간 실패 때 알림을 놓칠 수 있으므로 별도 후처리로 큐를 생성하지 않습니다. 한 명령당 최대 32개·대기 최대 256개를 큐에 넣고 넘치는 건수는 제어 문서의 `dropped`에 남깁니다. 앱 내 알림 원본은 유지합니다.

## 전달·개인정보·로그아웃

잠금 화면에는 고정된 제목·본문만 보냅니다. 학생 이름·포인트·교사 작성 본문은 전송하지 않습니다. 누르면 같은 출처의 앱만 열며 실제 내용은 인증 후 조회합니다. 앱이 보이는 동안에는 시스템 알림 대신 앱에 새로고침 이벤트를 보냅니다.

전달 전 현재 학급 membership·수신 설정과 분리 저장된 inbox 기록의 소유자·읽음 상태를 다시 확인합니다. scheduled 호출은 `isUserActive(uid)`를 기존 Auth 사용자 조회에 연결하여 Auth에서만 비활성화한 사용자도 제외합니다. 인증 서버 일시 오류는 비활성 계정으로 간주하지 않고 lease 만료 후 재시도합니다. 읽은 알림, 비활성·수신 거부 계정, 24시간이 지난 작업은 보내지 않습니다. 전송 실패는 최대 5회 제한된 지수 대기로 재시도하고 완료·실패 기록은 7일 후 제한된 수량씩 지웁니다. 성공이 확인된 기기에는 같은 작업을 다시 보내지 않습니다. 응답 확인 전 네트워크가 끊기면 중복 수신 가능성이 있으며 FCM topic과 알림 tag로 중복 표시를 줄입니다. 정확히 한 번 전달을 보장하지 않습니다.

로그아웃과 계정 전환은 **Firebase signOut/signIn 전에** `push.cleanup()`을 실행합니다. 서비스 워커의 로컬 수신 허용을 먼저 꺼서 오프라인에서도 표시를 차단하고, 서버의 현재 기기 등록과 Firebase 토큰을 정리합니다. 수신 설정 확인은 최대 1초·네트워크 정리는 최대 3초만 기다려 로그아웃이 연결 실패 때문에 막히지 않게 합니다. 지연된 토큰 삭제가 새 토큰을 지우지 않도록 새 등록은 이전 정리 작업이 끝난 뒤 실행합니다. 앱의 ‘내 알림 수신’을 끄면 `push.disableAll()`이 현재 기기의 동의 여부와 관계없이 서버 전체 기기를 해제합니다. 다른 탭의 로그아웃 이벤트에는 `push.pause()`를 호출합니다. 로그인·복원 때 해당 계정이 동의한 기기만 `push.sync()`를 실행하며 자동 권한 팝업을 띄우지 않습니다.

코드는 로컬 모의 전송으로 검사하며 실제 학생에게 시험 메시지를 보내지 않습니다. 실서비스 활성화·CPU 실측·실기기 수신, Android/iOS 홈 화면 설치와 iOS 수신은 별도 확인이 필요합니다.
