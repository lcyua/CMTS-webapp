import {State} from '../src/domain';
import {digest} from './credentials';
import {Conflict,Document,encode,Store} from './store';
import {findStoredRecord} from './state-repository';

export const PUSH_DEVICE_LIMIT=5;
export const PUSH_QUEUE_LIMIT=256;
export const PUSH_NEW_JOB_LIMIT=32;
const DEVICE_MAX_AGE=90*86400000,JOB_MAX_AGE=86400000,TERMINAL_RETENTION=7*86400000;
const devicePattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const tokenPattern=/^[A-Za-z0-9:_\-.]{20,4096}$/;
const jobPattern=/^[a-f0-9]{64}$/;
interface Device {deviceId:string;token:string;createdAt:number;lastSeenAt:number}
interface Registry {devices:Device[];updatedAt:number}
export interface PushJob {id:string;uid:string;inboxId:string;createdAt:number;dueAt?:number;expiresAt?:number;attempts:number;status:'pending'|'done'|'failed'|'discarded';leaseId?:string;deliveredDeviceIds:string[]}
export interface PushWrite {path:string;value:unknown;previous:Document|null}
export const pushControlPath=(classId:string)=>`classes/${classId}/private/pushQueue`;
export const pushRegistryPath=async(classId:string,uid:string)=>`classes/${classId}/pushUsers/${await digest(uid)}`;
const devices=(value:any):Device[]=>Array.isArray(value?.devices)?value.devices.filter((d:any)=>d&&devicePattern.test(d.deviceId)&&tokenPattern.test(d.token)&&Number.isFinite(d.createdAt)&&Number.isFinite(d.lastSeenAt)).slice(0,PUSH_DEVICE_LIMIT):[];
function activeMember(state:State,uid:string){const member=state.members.find(m=>m.id===uid&&m.active);if(!member)throw Error('활성 학급 계정이 필요합니다.');return member;}

/** Tokens remain in server-only documents; callers receive counts, never tokens. */
export async function updatePushDevice(store:Store,classId:string,uid:string,_state:State,input:any,enabled:boolean,now=Date.now()){
 const action=input?.action;
 if(!['register','unregister','unregisterAll'].includes(action))throw Error('기기 알림 요청을 확인하세요.');
 if(action!=='unregisterAll'&&(typeof input.deviceId!=='string'||!devicePattern.test(input.deviceId)))throw Error('기기 정보를 확인하세요.');
 if(action==='register'&&!enabled)throw Error('기기 알림이 꺼져 있습니다.');
 if(action==='register'&&(typeof input.token!=='string'||!tokenPattern.test(input.token)))throw Error('기기 알림 등록 정보를 확인하세요.');
 const path=await pushRegistryPath(classId,uid),statePath=`classes/${classId}/private/state`;
 const tokenPath=action==='register'?`classes/${classId}/pushTokens/${await digest(input.token)}`:null;
 for(let attempt=0;attempt<8;attempt++){
  const docs=await store.getMany([statePath,path,...(tokenPath?[tokenPath]:[])]),state=store.value(docs[0]) as State|null;
  if(!state)throw Error('학급이 설정되지 않았습니다.');
  const member=activeMember(state,uid);
  if(action==='register'&&member.notifications?.enabled===false)throw Error('기기 알림이 꺼져 있습니다.');
  const ownership=tokenPath?store.value(docs[2]):null;
  if(ownership&&ownership.uid!==uid)throw Error('이 기기의 이전 알림 연결을 해제한 뒤 다시 시도해 주세요.');
  let list=devices(store.value(docs[1])).filter(d=>d.lastSeenAt>=now-DEVICE_MAX_AGE);
  if(action==='unregisterAll')list=[];
  else if(action==='unregister')list=list.filter(d=>d.deviceId!==input.deviceId);
  else {
   const previous=list.find(d=>d.deviceId===input.deviceId);
   list=list.filter(d=>d.deviceId!==input.deviceId&&d.token!==input.token);
   if(list.length>=PUSH_DEVICE_LIMIT)throw Error('기기 알림은 계정당 5대까지 등록할 수 있습니다. 다른 기기의 연결을 해제해 주세요.');
   list.push({deviceId:input.deviceId,token:input.token,createdAt:previous?.createdAt||now,lastSeenAt:now});
  }
  const name=(relative:string)=>`projects/${store.project}/databases/(default)/documents/${relative}`;
  const writes:any[]=[{verify:docs[0]!.name,currentDocument:{updateTime:docs[0]!.updateTime}},{update:{name:name(path),fields:encode({devices:list,updatedAt:now} satisfies Registry).mapValue.fields},currentDocument:docs[1]?{updateTime:docs[1]!.updateTime}:{exists:false}}];
  if(tokenPath)writes.push({update:{name:name(tokenPath),fields:encode({uid,updatedAt:now,expiresAt:now+DEVICE_MAX_AGE}).mapValue.fields},currentDocument:docs[2]?{updateTime:docs[2]!.updateTime}:{exists:false}});
  try{await store.request(`${store.base}:commit`,{method:'POST',body:JSON.stringify({writes})});return {registered:action==='register',deviceCount:list.length};}catch(e){if(!(e instanceof Conflict))throw e;}
 }
 throw Error('다른 기기에서 알림 설정을 변경했습니다. 다시 시도해 주세요.');
}

/** Called inside the state repository's atomic commit, after the domain command. */
export async function preparePushWrites(store:Store,classId:string,beforeInboxIds:ReadonlySet<string>,state:State,controlDoc:Document|null,now=Date.now(),writeCapacity=500):Promise<{writes:PushWrite[];queued:number;dropped:number}>{
 const pending=Math.max(0,Math.min(PUSH_QUEUE_LIMIT,Number(store.value(controlDoc)?.pending)||0));
 const fresh=state.inbox.filter(n=>!beforeInboxIds.has(n.id)&&!n.read&&state.members.some(m=>m.id===n.uid&&m.active&&m.notifications?.enabled!==false));
 const unique=[...new Map(fresh.map(n=>[n.uid+'\0'+n.id,n])).values()];
 if(!unique.length)return {writes:[],queued:0,dropped:0};
 const capacity=Number.isFinite(writeCapacity)?Math.max(0,Math.min(500,Math.floor(writeCapacity))):0;
 if(capacity<1)return {writes:[],queued:0,dropped:unique.length};
 const accepted=unique.slice(0,Math.min(PUSH_NEW_JOB_LIMIT,PUSH_QUEUE_LIMIT-pending,capacity-1)),dropped=unique.length-accepted.length;
 const jobs=await Promise.all(accepted.map(async n=>{
  const id=await digest(classId+'\0'+n.uid+'\0'+n.id);
  const value:PushJob={id,uid:n.uid,inboxId:n.id,createdAt:now,dueAt:now,attempts:0,status:'pending',deliveredDeviceIds:[]};
  return {path:`classes/${classId}/pushQueue/${id}`,value,previous:null};
 }));
 return {writes:[{path:pushControlPath(classId),value:{pending:pending+jobs.length,dropped:(Number(store.value(controlDoc)?.dropped)||0)+dropped,updatedAt:now},previous:controlDoc},...jobs],queued:jobs.length,dropped};
}

export function pushMessage(job:Pick<PushJob,'id'>,token:string){
 return {message:{token,data:{title:'우리반 학급 포털',body:'새 학급 알림이 있습니다. 앱에서 확인해 주세요.',id:job.id},webpush:{headers:{TTL:'3600',Urgency:'normal',Topic:job.id.slice(0,32)}}}};
}

async function query(store:Store,classId:string,field:string,before:number,limit:number,collectionId='pushQueue'):Promise<Document[]>{
 const response=await store.request(`${store.base}/classes/${classId}:runQuery`,{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId}],where:{fieldFilter:{field:{fieldPath:field},op:'LESS_THAN_OR_EQUAL',value:{integerValue:String(before)}}},orderBy:[{field:{fieldPath:field},direction:'ASCENDING'}],limit}})});
 const rows=await response.json() as {document?:Document}[];return rows.flatMap(r=>r.document?[r.document]:[]);
}
class SkipJob extends Error{}
const terminal=(job:PushJob,status:PushJob['status'],now:number)=>{const {dueAt,leaseId,...rest}=job;return {...rest,status,expiresAt:now+TERMINAL_RETENTION};};
async function prune(store:Store,classId:string,now:number){
 const old=[...await query(store,classId,'expiresAt',now,10),...await query(store,classId,'expiresAt',now,10,'pushTokens')];if(!old.length)return;
 await store.request(`${store.base}:commit`,{method:'POST',body:JSON.stringify({writes:old.map(doc=>({delete:doc.name,currentDocument:{updateTime:doc.updateTime}}))})});
}

/** At most five jobs and five tokens/job; default one job protects the free CPU budget. */
export async function dispatchPush(store:Store,classId:string,oauthToken:()=>Promise<string>,options:{enabled:boolean;maxJobs?:number;now?:number;isUserActive?:(uid:string)=>Promise<boolean>}){
 const summary={enabled:options.enabled,processed:0,sent:0,retried:0,invalidTokens:0,discarded:0};
 if(!options.enabled)return summary;
 const now=options.now??Date.now(),maxJobs=Math.min(5,Math.max(1,Math.trunc(options.maxJobs||1)));
 const state=store.value(await store.get(`classes/${classId}/private/state`)) as State|null;if(!state)throw Error('학급이 설정되지 않았습니다.');
 const due=await query(store,classId,'dueAt',now,maxJobs);
 for(const document of due){
  const id=document.name.split('/').at(-1)!;if(!jobPattern.test(id))continue;
  const path=`classes/${classId}/pushQueue/${id}`,leaseId=crypto.randomUUID();
  let job:PushJob;
  try{job=await store.change([path],([value])=>{
   if(!value||value.status!=='pending'||typeof value.dueAt!=='number'||value.dueAt>now)throw new SkipJob();
   const next={...value,dueAt:now+120000,leaseId,attempts:Math.max(0,Number(value.attempts)||0)+1};return {values:[next],result:next as PushJob};
  });}catch(e){if(e instanceof SkipJob)continue;throw e;}
  summary.processed++;
  const registryPath=await pushRegistryPath(classId,job.uid),member=state.members.find(m=>m.id===job.uid&&m.active);
  const notice=job.attempts>5?null:state.inbox.find(n=>n.id===job.inboxId&&n.uid===job.uid)||(await findStoredRecord(store,classId,'inbox',job.inboxId))?.record;
  const expired=now-job.createdAt>JOB_MAX_AGE||job.attempts>5;
  const eligible=!!member&&member.notifications?.enabled!==false&&!!notice&&notice.uid===job.uid&&!notice.read&&!expired;
  const authActive=eligible&&options.isUserActive?await options.isUserActive(job.uid):true;
  const discard=!eligible||!authActive;
  const registry=store.value(await store.get(registryPath)),list=discard?[]:devices(registry).filter(d=>d.lastSeenAt>=now-DEVICE_MAX_AGE&&!job.deliveredDeviceIds?.includes(d.deviceId));
  const invalid=new Set<string>(),delivered=new Set(job.deliveredDeviceIds||[]);let transient=false;
  await Promise.all(list.map(async device=>{
   try{
    const response=await fetch(`https://fcm.googleapis.com/v1/projects/${store.project}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${await oauthToken()}`,'Content-Type':'application/json'},body:JSON.stringify(pushMessage(job,device.token)),signal:AbortSignal.timeout(15000)});
    if(response.ok){await response.body?.cancel();delivered.add(device.deviceId);summary.sent++;return;}
    const body=await response.json().catch(()=>null) as any;
    const code=body?.error?.details?.find((d:any)=>d?.['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode;
    if(code==='UNREGISTERED'){invalid.add(device.token);summary.invalidTokens++;}else transient=true;
   }catch{transient=true;}
  }));
  const retry=transient&&job.attempts<5&&!discard;
  await store.change([path,pushControlPath(classId),registryPath],([current,control,latestRegistry])=>{
   if(current?.leaseId!==leaseId||current.status!=='pending')throw new SkipJob();
   const base={...current,deliveredDeviceIds:[...delivered].slice(0,PUSH_DEVICE_LIMIT)};
   let next:PushJob;
   if(retry){const {leaseId:_,...withoutLease}=base;next={...withoutLease,dueAt:now+Math.min(3600000,60000*2**job.attempts)};}
   else next=terminal(base,discard?'discarded':transient?'failed':'done',now);
   return {values:[next,{...(control||{}),pending:retry?Math.max(0,Number(control?.pending)||0):Math.max(0,(Number(control?.pending)||0)-1),updatedAt:now},{devices:devices(latestRegistry).filter(d=>!invalid.has(d.token)&&d.lastSeenAt>=now-DEVICE_MAX_AGE),updatedAt:now}],result:null};
  });
  if(retry)summary.retried++;if(discard)summary.discarded++;
 }
 try{await prune(store,classId,now);}catch(e){if(!(e instanceof Conflict))throw e;}
 return summary;
}
