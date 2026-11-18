import type {State} from '../src/domain';
import {digest} from './credentials';
import {pushMessage,pushRegistryPath} from './push';
import {Conflict,encode,Store,UpstreamError} from './store';

const COOLDOWN=60000,DEVICE_MAX_AGE=90*86400000;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const tokenFormat=/^[A-Za-z0-9:_\-.]{20,4096}$/;
const providerCodes=new Set(['UNREGISTERED','INVALID_ARGUMENT','SENDER_ID_MISMATCH','QUOTA_EXCEEDED','UNAVAILABLE','INTERNAL','THIRD_PARTY_AUTH_ERROR','APNS_AUTH_ERROR','PERMISSION_DENIED','UNAUTHENTICATED','NOT_FOUND','RESOURCE_EXHAUSTED','DEADLINE_EXCEEDED']);

/** Safe application status only; raw provider messages, credentials and registration tokens are never exposed. */
export class PushTestError extends UpstreamError {
 constructor(readonly status:number,readonly code:string,message:string,upstreamStatus?:number,upstreamCode?:string){super(message,upstreamStatus,upstreamCode);}
}
const invalid=()=>new PushTestError(400,'PUSH_TEST_INVALID_REQUEST','테스트 알림 요청을 확인해 주세요.');
function teacher(state:State|null,uid:string){
 const member=state?.members?.find(member=>member.id===uid&&member.active===true&&member.role==='teacher');
 if(!member)throw new PushTestError(403,'PUSH_TEST_TEACHER_REQUIRED','활성 교사 계정에서만 내 기기 테스트를 실행할 수 있습니다.');
 if(member.notifications?.enabled===false)throw new PushTestError(409,'PUSH_TEST_OPTED_OUT','내 알림 수신을 켠 뒤 다시 시도해 주세요.');
 return member;
}
const deviceMissing=()=>new PushTestError(409,'PUSH_TEST_DEVICE_REQUIRED','이 기기의 알림을 먼저 연결하거나 다시 연결한 뒤 테스트해 주세요.');
function providerFailure(status:number,code?:string):PushTestError {
 if(code==='THIRD_PARTY_AUTH_ERROR'||code==='APNS_AUTH_ERROR')return new PushTestError(503,'PUSH_TEST_VAPID_REQUIRED','공개 VAPID 키와 Firebase 기기 알림 인증 설정을 확인해 주세요.',status,code);
 if(code==='UNREGISTERED'||code==='INVALID_ARGUMENT'||status===404)return new PushTestError(409,'PUSH_TEST_DEVICE_EXPIRED','이 기기의 알림 연결이 만료됐습니다. 기기 알림을 끄고 다시 연결해 주세요.',status,code);
 if(code==='SENDER_ID_MISMATCH')return new PushTestError(409,'PUSH_TEST_PROJECT_MISMATCH','이 기기의 Firebase 프로젝트와 알림 설정을 확인하고 다시 연결해 주세요.',status,code);
 if(status===403||status===401||code==='PERMISSION_DENIED'||code==='UNAUTHENTICATED')return new PushTestError(503,'PUSH_TEST_PERMISSION_REQUIRED','기기 알림 발송 권한과 Firebase Cloud Messaging API 설정을 확인해 주세요.',status,code);
 if(status===429||code==='QUOTA_EXCEEDED'||code==='RESOURCE_EXHAUSTED')return new PushTestError(503,'PUSH_TEST_FCM_QUOTA','기기 알림 발송 한도에 도달했습니다. 잠시 뒤 다시 시도해 주세요.',status,code);
 return new PushTestError(503,'PUSH_TEST_UNAVAILABLE','테스트 알림을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.',status,code);
}

/** Authenticated operator action: exactly one of the requesting teacher's currently registered devices. */
export async function sendOwnPushTest(store:Store,classId:string,uid:string,state:State,input:unknown,oauthToken:()=>Promise<string>,enabled:boolean,now=Date.now()):Promise<{sent:true}>{
 if(!enabled)throw new PushTestError(409,'PUSH_TEST_DISABLED','기기 알림 기능이 아직 활성화되지 않았습니다.');
 if(typeof classId!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(classId)||typeof uid!=='string'||!uid||uid.length>128||!Number.isSafeInteger(now)||now<0)throw invalid();
 if(!input||typeof input!=='object'||Array.isArray(input))throw invalid();
 const data=input as Record<string,unknown>;
 if(Object.keys(data).some(key=>!['action','deviceId','classId'].includes(key))||data.action!=='test'||typeof data.deviceId!=='string'||!uuid.test(data.deviceId)||data.classId!==undefined&&data.classId!==classId)throw invalid();
 teacher(state,uid);
 const statePath=`classes/${classId}/private/state`,registryPath=await pushRegistryPath(classId,uid),limitPath=`classes/${classId}/pushTestLimits/${await digest(uid)}`;
 let targetToken:string|undefined;
 for(let attempt=0;attempt<8;attempt++){
  const [stateDoc,registryDoc,limitDoc]=await store.getMany([statePath,registryPath,limitPath]);
  teacher(store.value(stateDoc) as State|null,uid);
  const registry=store.value(registryDoc),entries=Array.isArray(registry?.devices)?registry.devices:[];
  const matches=entries.filter((device:any)=>device&&device.deviceId===data.deviceId);
  if(!stateDoc||!registryDoc||entries.length>5||matches.length!==1)throw deviceMissing();
  const device=matches[0];
  if(typeof device.token!=='string'||!tokenFormat.test(device.token)||!Number.isFinite(device.createdAt)||!Number.isFinite(device.lastSeenAt)||device.createdAt>device.lastSeenAt||device.lastSeenAt<now-DEVICE_MAX_AGE||device.lastSeenAt>now+86400000)throw deviceMissing();
  const limit=store.value(limitDoc);
  if(limitDoc&&(!Number.isSafeInteger(limit?.nextAllowedAt)||limit.nextAllowedAt<0))throw new PushTestError(503,'PUSH_TEST_LIMIT_UNAVAILABLE','테스트 알림 간격을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  if(limit&&now<limit.nextAllowedAt)throw new PushTestError(429,'PUSH_TEST_RATE_LIMIT','테스트 알림은 교사 계정당 1분에 한 번 보낼 수 있습니다.');
  const limitName=`projects/${store.project}/databases/(default)/documents/${limitPath}`;
  const writes=[
   {verify:stateDoc.name,currentDocument:{updateTime:stateDoc.updateTime}},
   {verify:registryDoc.name,currentDocument:{updateTime:registryDoc.updateTime}},
   {update:{name:limitName,fields:encode({lastAttemptAt:now,nextAllowedAt:now+COOLDOWN,expiresAt:new Date(now+86400000)}).mapValue.fields},currentDocument:limitDoc?{updateTime:limitDoc.updateTime}:{exists:false}}
  ];
  try{
   await store.request(`${store.base}:commit`,{method:'POST',body:JSON.stringify({writes})});
   targetToken=device.token;break;
  }catch(e){if(!(e instanceof Conflict))throw e;}
 }
 if(!targetToken)throw new PushTestError(503,'PUSH_TEST_SETTINGS_CHANGED','알림 설정이 변경됐습니다. 새로고침 후 다시 시도해 주세요.');
 // The reserved cooldown remains even on OAuth, network or FCM failure.
 const signal=AbortSignal.timeout(10000);
 let onAbort:()=>void=()=>{};
 try{
  const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(new PushTestError(504,'PUSH_TEST_TIMEOUT','테스트 알림 요청 시간이 초과됐습니다. 잠시 뒤 다시 시도해 주세요.',undefined,'DEADLINE_EXCEEDED'));if(signal.aborted)onAbort();else signal.addEventListener('abort',onAbort,{once:true});});
  const oauth=await Promise.race([oauthToken(),aborted]);
  if(typeof oauth!=='string'||!oauth||/[\r\n]/.test(oauth))throw new PushTestError(503,'PUSH_TEST_AUTH_UNAVAILABLE','기기 알림 서버 인증을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  const standard=pushMessage({id:await digest(JSON.stringify(['self-test',classId,uid,data.deviceId,now]))},targetToken);
  const message={message:{...standard.message,data:{...standard.message.data,kind:'self-test'}}};
  const response=await Promise.race([fetch(`https://fcm.googleapis.com/v1/projects/${store.project}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${oauth}`,'Content-Type':'application/json'},body:JSON.stringify(message),signal}),aborted]);
  if(response.ok){void response.body?.cancel().catch(()=>{});return {sent:true};}
  const body=await Promise.race([response.json().catch(()=>null),aborted]) as any;
  const detail=Array.isArray(body?.error?.details)?body.error.details.find((item:any)=>item?.['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode:undefined;
  const raw=typeof detail==='string'?detail:body?.error?.status;
  throw providerFailure(response.status,typeof raw==='string'&&providerCodes.has(raw)?raw:undefined);
 }catch(e){
  if(e instanceof PushTestError)throw e;
  if(signal.aborted)throw new PushTestError(504,'PUSH_TEST_TIMEOUT','테스트 알림 요청 시간이 초과됐습니다. 잠시 뒤 다시 시도해 주세요.',undefined,'DEADLINE_EXCEEDED');
  if(e instanceof UpstreamError)throw new PushTestError(503,'PUSH_TEST_AUTH_UNAVAILABLE','기기 알림 서버 인증과 발송 권한을 확인해 주세요.',e.upstreamStatus,providerCodes.has(e.upstreamCode||'')?e.upstreamCode:undefined);
  throw new PushTestError(503,'PUSH_TEST_UNAVAILABLE','테스트 알림 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
 }finally{signal.removeEventListener('abort',onAbort);}
}
