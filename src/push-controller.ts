import {receivesPush,validPushKey} from './push-preferences';
export type PushCall=(input:{action:'register'|'unregister'|'unregisterAll'|'test';deviceId?:string;token?:string})=>Promise<unknown>;
export interface PushStatus {
 configured:boolean;supported:boolean;permission:NotificationPermission|'unsupported';registered:boolean;optedIn:boolean;
 phase:'idle'|'permission'|'connecting';error:string;
}
export interface PushRuntime {
 now?:()=>number;
 uid:()=>string;supported:()=>Promise<boolean>;permission:()=>NotificationPermission|'unsupported';requestPermission:()=>Promise<NotificationPermission>;
 observePermission?:(changed:()=>void)=>()=>void;
 preference:(uid:string)=>string|null;setPreference:(uid:string,enabled:boolean)=>void;hasTransport:(uid:string)=>boolean;setTransport:(uid:string,registered:boolean)=>void;
 deviceId:()=>string;token:(vapidKey:string)=>Promise<string>;deleteToken:()=>Promise<unknown>;workerPermission:(enabled:boolean)=>Promise<void>;listen:(onPush:()=>void)=>()=>void;
}
export interface PushTiming {permissionMs?:number;connectionMs?:number;supportMs?:number}
class CancelledRegistration extends Error{}
const timeout=async<T>(promise:Promise<T>,milliseconds:number):Promise<T|undefined>=>{let timer:ReturnType<typeof setTimeout>|number|undefined;try{return await Promise.race([promise,new Promise<undefined>(resolve=>{timer=setTimeout(resolve,milliseconds);})]);}finally{if(timer)clearTimeout(timer);}};
async function deadline<T>(promise:Promise<T>,milliseconds:number,message:string):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|number|undefined;
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),milliseconds);})]);}
 finally{if(timer)clearTimeout(timer);}
}

/** Account changes invalidate late work; browser permission and connection are separate states. */
export function createPushController(available:boolean,call:PushCall,runtime:PushRuntime,initial:{enabled:boolean;vapidKey:string},cleanupWaitMs=3000,timing:PushTiming={}){
 const permissionMs=timing.permissionMs??30000,connectionMs=timing.connectionMs??20000,supportMs=timing.supportMs??3000;
 let config={enabled:initial.enabled&&validPushKey(initial.vapidKey),vapidKey:initial.vapidKey};
 let generation=0,registeredOwner='',registeredGeneration=-1,registeredAt=0,memberEnabled=true;
 let phase:PushStatus['phase']='idle',lastError='';
 let registration:{owner:string;generation:number;promise:Promise<void>}|null=null;
 let enabling:{owner:string;generation:number;promise:Promise<void>}|null=null;
 let permissionReply:((permission:NotificationPermission)=>void)|null=null,stopPermissionObserver:(()=>void)|null=null;
 let tokenTail:Promise<unknown>=Promise.resolve(),workerTail:Promise<unknown>=Promise.resolve(),pendingCleanup:Promise<unknown>|null=null,cleanupNeedsRetry=false;
 let deferredSync:{owner:string;generation:number}|null=null;
 const listeners=new Set<()=>void>(),changed=()=>listeners.forEach(f=>f());
 const configured=()=>available&&config.enabled&&validPushKey(config.vapidKey);
 const receiving=(owner=runtime.uid())=>!!owner&&receivesPush(runtime.preference(owner),memberEnabled);
 const current=(owner:string,version:number)=>runtime.uid()===owner&&generation===version&&configured()&&receiving(owner);
 const assertCurrent=(owner:string,version:number)=>{if(!current(owner,version))throw new CancelledRegistration('로그인 계정이나 알림 설정이 변경되었습니다.');};
 const supported=()=>deadline(runtime.supported(),supportMs,'브라우저의 기기 알림 지원 확인이 지연되고 있습니다. 브라우저를 다시 열고 시도해 주세요.');
 function tokenOperation<T>(operation:()=>Promise<T>){const work=tokenTail.then(operation,operation);tokenTail=work.catch(()=>{});return work;}
 function workerPermission(allow:boolean,version=generation){const operation=workerTail.catch(()=>{}).then(async()=>{if(version!==generation)return;await runtime.workerPermission(allow);});workerTail=operation.catch(()=>{});return operation;}
 function clearRegistered(){registeredOwner='';registeredGeneration=-1;registeredAt=0;changed();}
 async function pause(){const needed=!!registeredOwner||!!registration||runtime.hasTransport(runtime.uid());generation++;phase='idle';lastError='';clearRegistered();if(needed)await workerPermission(false).catch(()=>{});}
 function configure(value:{enabled:boolean;vapidKey:string}){
  const next={enabled:value?.enabled===true&&validPushKey(value?.vapidKey),vapidKey:validPushKey(value?.vapidKey)?value.vapidKey:''};
  if(config.enabled===next.enabled&&config.vapidKey===next.vapidKey)return;
  config=next;void pause();changed();
 }
 async function status():Promise<PushStatus>{
  let support=false,supportError='';
  if(configured())try{support=await supported();}catch(error){supportError=error instanceof Error?error.message:'브라우저의 기기 알림 지원을 확인하지 못했습니다.';}
  const permission=available?runtime.permission():'unsupported',owner=runtime.uid();
  return {configured:configured(),supported:support,permission,registered:configured()&&permission==='granted'&&!!owner&&registeredOwner===owner&&registeredGeneration===generation&&receiving(owner),optedIn:receiving(owner),phase,error:lastError||supportError};
 }
 async function register(){
  const owner=runtime.uid(),version=generation;
  if(!owner)throw Error('먼저 로그인해 주세요.');
  if(!configured()||!await supported())throw Error('이 브라우저에서는 기기 알림을 사용할 수 없습니다.');
  assertCurrent(owner,version);
  if(runtime.permission()!=='granted')throw Error(runtime.permission()==='denied'?'브라우저 설정에서 이 사이트의 알림을 허용해 주세요.':'기기 알림 권한을 허용해 주세요.');
  if(pendingCleanup)throw Error('이전 기기 알림 연결을 정리하고 있습니다. 잠시 후 다시 시도해 주세요.');
  if(cleanupNeedsRetry){await tokenOperation(async()=>{assertCurrent(owner,version);await runtime.deleteToken();assertCurrent(owner,version);});cleanupNeedsRetry=false;}
  const key=config.vapidKey;
  const token=await tokenOperation(async()=>{assertCurrent(owner,version);const result=await runtime.token(key);assertCurrent(owner,version);return result;});
  if(!token)throw Error('기기 알림 연결을 만들지 못했습니다. 다시 시도해 주세요.');
  assertCurrent(owner,version);await call({action:'register',deviceId:runtime.deviceId(),token});assertCurrent(owner,version);
  runtime.setTransport(owner,true);await workerPermission(true,version);assertCurrent(owner,version);
  registeredOwner=owner;registeredGeneration=version;registeredAt=runtime.now?.()??Date.now();lastError='';changed();
 }
 function startRegistration(){
  const owner=runtime.uid(),version=generation;
  if(registration?.owner===owner&&registration.generation===version)return registration.promise;
  phase='connecting';lastError='';changed();
  const work=register();
  const promise=deadline(work,connectionMs,'기기 알림 연결 응답이 지연되고 있습니다. 브라우저를 다시 열고 ‘기기 알림 다시 연결’을 눌러 주세요.').catch(async error=>{
   if(current(owner,version)){
    // A timed-out browser subscription or server response must not register later.
    generation++;phase='idle';lastError=error instanceof Error?error.message:'기기 알림을 연결하지 못했습니다.';clearRegistered();
    await timeout(workerPermission(false),1000).catch(()=>{});
   }
   throw error;
  }).finally(()=>{if(registration?.promise===promise){registration=null;phase='idle';changed();}});
  registration={owner,generation:version,promise};return promise;
 }
 function enable(){
  const owner=runtime.uid(),version=generation;
  if(enabling?.owner===owner&&enabling.generation===version)return enabling.promise;
  const promise=(async()=>{
   if(!owner)throw Error('먼저 로그인해 주세요.');
   if(!configured())throw Error('기기 알림 설정을 불러오지 못했습니다. 사이트를 새로고침한 뒤 다시 시도해 주세요.');
   if(!memberEnabled)throw Error('먼저 ‘내 알림 수신’을 켜 주세요.');
   lastError='';
   if(runtime.permission()==='default'){
    phase='permission';changed();
    // Keep the native call inside the click gesture. Permission-change events also
    // settle this wait on browsers whose legacy callback/promise does not finish.
    const reply=new Promise<NotificationPermission>((resolve,reject)=>{permissionReply=resolve;try{runtime.requestPermission().then(resolve,reject);}catch(error){reject(error);}});
    let permission:NotificationPermission;
    try{permission=await deadline(reply,permissionMs,'브라우저의 알림 권한 응답이 없습니다. 브라우저 설정에서 이 사이트의 알림을 확인한 뒤 다시 시도해 주세요.');}
    finally{if(runtime.uid()===owner&&generation===version)permissionReply=null;}
    if(runtime.uid()!==owner||generation!==version)throw new CancelledRegistration('로그인 계정이나 알림 설정이 변경되었습니다.');
    changed();
    if(permission!=='granted')throw Error(permission==='denied'?'브라우저 설정에서 이 사이트의 알림을 허용해 주세요.':'이 사이트의 알림 권한이 아직 허용되지 않았습니다. 브라우저 설정을 확인해 주세요.');
   }
   if(runtime.uid()!==owner||generation!==version)throw new CancelledRegistration('로그인 계정이나 알림 설정이 변경되었습니다.');
   if(runtime.permission()!=='granted')throw Error(runtime.permission()==='denied'?'브라우저 설정에서 이 사이트의 알림을 허용해 주세요.':'이 사이트의 알림 권한이 아직 확인되지 않았습니다. 브라우저 설정을 확인해 주세요.');
   runtime.setPreference(owner,true);changed();await startRegistration();
  })().catch(error=>{if(runtime.uid()===owner&&generation===version){phase='idle';lastError=error instanceof Error?error.message:'기기 알림을 연결하지 못했습니다.';changed();}throw error;}).finally(()=>{if(enabling?.promise===promise)enabling=null;});
  enabling={owner,generation:version,promise};return promise;
 }
 async function sync(enabledMember=true){
  memberEnabled=enabledMember;const owner=runtime.uid();
  if(!memberEnabled){await pause();return;}
  if(!configured()||!owner||!receiving(owner))return;
  if(runtime.permission()!=='granted'){if(registeredOwner===owner||registration?.owner===owner)await pause();return;}
  const age=(runtime.now?.()??Date.now())-registeredAt;
  if(registeredOwner===owner&&registeredGeneration===generation&&age>=0&&age<6*3600000)return;
  if(pendingCleanup){deferredSync={owner,generation};return;}
  try{await startRegistration();}catch{}
 }
 async function cleanup(all=false){
  const owner=runtime.uid(),hadTransport=!!owner&&(registeredOwner===owner||runtime.hasTransport(owner)||!!registration||configured()&&runtime.permission()==='granted');
  generation++;deferredSync=null;phase='idle';lastError='';permissionReply=null;clearRegistered();if(owner)runtime.setTransport(owner,false);
  if(hadTransport)await workerPermission(false).catch(()=>{});
  if(!available||!owner||(!hadTransport&&!all))return;
  const requests:Promise<unknown>[]=[];
  if(runtime.uid()===owner)requests.push(call(all?{action:'unregisterAll'}:{action:'unregister',deviceId:runtime.deviceId()}));
  if(hadTransport)requests.push(tokenOperation(async()=>{if(await supported())await runtime.deleteToken();}));
  const work=Promise.allSettled(requests);pendingCleanup=work;
  void work.then(results=>{if(pendingCleanup!==work)return;cleanupNeedsRetry=results.some(result=>result.status==='rejected');pendingCleanup=null;const deferred=deferredSync;deferredSync=null;if(deferred&&current(deferred.owner,deferred.generation))void sync(memberEnabled);});
  await timeout(work,cleanupWaitMs);
 }
 async function disable(){const owner=runtime.uid();if(owner)runtime.setPreference(owner,false);await cleanup();changed();}
 async function disableAll(){await cleanup(true);}
 async function test(){if(!(await status()).registered)throw Error('이 기기에 알림을 연결한 뒤 다시 시도해 주세요.');await call({action:'test',deviceId:runtime.deviceId()});}
 function onPermissionChange(){
  const permission=runtime.permission();
  if(permission==='granted'||permission==='denied')permissionReply?.(permission);
  changed();void sync(memberEnabled);
 }
 function onChange(listener:()=>void){
  listeners.add(listener);
  if(!stopPermissionObserver&&runtime.observePermission)stopPermissionObserver=runtime.observePermission(onPermissionChange);
  return()=>{listeners.delete(listener);if(!listeners.size){stopPermissionObserver?.();stopPermissionObserver=null;}};
 }
 return {configure,status,enable,sync,cleanup,disable,disableAll,test,pause,listen:runtime.listen,onChange};
}
