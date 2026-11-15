import {receivesPush,validPushKey} from './push-preferences';
export type PushCall=(input:{action:'register'|'unregister'|'unregisterAll'|'test';deviceId?:string;token?:string})=>Promise<unknown>;
export interface PushStatus {configured:boolean;supported:boolean;permission:NotificationPermission|'unsupported';registered:boolean;optedIn:boolean}
export interface PushRuntime {
 now?:()=>number;
 uid:()=>string;supported:()=>Promise<boolean>;permission:()=>NotificationPermission|'unsupported';requestPermission:()=>Promise<NotificationPermission>;
 preference:(uid:string)=>string|null;setPreference:(uid:string,enabled:boolean)=>void;hasTransport:(uid:string)=>boolean;setTransport:(uid:string,registered:boolean)=>void;
 deviceId:()=>string;token:(vapidKey:string)=>Promise<string>;deleteToken:()=>Promise<unknown>;workerPermission:(enabled:boolean)=>Promise<void>;listen:(onPush:()=>void)=>()=>void;
}
class CancelledRegistration extends Error{}
const timeout=async<T>(promise:Promise<T>,milliseconds:number):Promise<T|undefined>=>{let timer:ReturnType<typeof setTimeout>|number|undefined;try{return await Promise.race([promise,new Promise<undefined>(resolve=>{timer=setTimeout(resolve,milliseconds);})]);}finally{if(timer)clearTimeout(timer);}};

/** Browser-independent lifecycle makes account changes and slow transports testable. */
export function createPushController(available:boolean,call:PushCall,runtime:PushRuntime,initial:{enabled:boolean;vapidKey:string},cleanupWaitMs=3000){
 let config={enabled:initial.enabled&&validPushKey(initial.vapidKey),vapidKey:initial.vapidKey};
 let generation=0,registeredOwner='',registeredGeneration=-1,registeredAt=0,memberEnabled=true;
 let registration:{owner:string;generation:number;promise:Promise<void>}|null=null;
 let tokenTail:Promise<unknown>=Promise.resolve(),workerTail:Promise<unknown>=Promise.resolve(),pendingCleanup:Promise<unknown>|null=null,cleanupNeedsRetry=false;
 let deferredSync:{owner:string;generation:number}|null=null;
 const listeners=new Set<()=>void>(),changed=()=>listeners.forEach(f=>f());
 const configured=()=>available&&config.enabled&&validPushKey(config.vapidKey);
 const receiving=(owner=runtime.uid())=>!!owner&&receivesPush(runtime.preference(owner),memberEnabled);
 const current=(owner:string,version:number)=>runtime.uid()===owner&&generation===version&&configured()&&receiving(owner);
 const assertCurrent=(owner:string,version:number)=>{if(!current(owner,version))throw new CancelledRegistration('로그인 계정이나 알림 설정이 변경되었습니다.');};
 function tokenOperation<T>(operation:()=>Promise<T>){const work=tokenTail.then(operation,operation);tokenTail=work.catch(()=>{});return work;}
 function workerPermission(allow:boolean,version=generation){const operation=workerTail.catch(()=>{}).then(async()=>{if(version!==generation)return;await runtime.workerPermission(allow);});workerTail=operation.catch(()=>{});return operation;}
 function clearRegistered(){registeredOwner='';registeredGeneration=-1;registeredAt=0;changed();}
 async function pause(){const needed=!!registeredOwner||!!registration||runtime.hasTransport(runtime.uid());generation++;clearRegistered();if(needed)await workerPermission(false).catch(()=>{});}
 function configure(value:{enabled:boolean;vapidKey:string}){
  const next={enabled:value?.enabled===true&&validPushKey(value?.vapidKey),vapidKey:validPushKey(value?.vapidKey)?value.vapidKey:''};
  if(config.enabled===next.enabled&&config.vapidKey===next.vapidKey)return;
  config=next;void pause();changed();
 }
 async function status():Promise<PushStatus>{const supported=configured()&&await runtime.supported(),permission=supported?runtime.permission():'unsupported';const owner=runtime.uid();return {configured:configured(),supported,permission,registered:permission==='granted'&&!!owner&&registeredOwner===owner&&registeredGeneration===generation&&receiving(owner),optedIn:receiving(owner)};}
 async function register(){
  const owner=runtime.uid(),version=generation;
  if(!owner)throw Error('먼저 로그인해 주세요.');
  if(!configured()||!await runtime.supported())throw Error('이 브라우저에서는 기기 알림을 사용할 수 없습니다.');
  assertCurrent(owner,version);
  if(runtime.permission()!=='granted')throw Error(runtime.permission()==='denied'?'브라우저 설정에서 이 사이트의 알림을 허용해 주세요.':'기기 알림 권한을 허용해 주세요.');
  if(pendingCleanup)throw Error('이전 기기 알림 연결을 정리하고 있습니다. 잠시 후 다시 시도해 주세요.');
  // A failed offline cleanup must not let the next account reuse the old account's token.
  if(cleanupNeedsRetry){await tokenOperation(async()=>{assertCurrent(owner,version);await runtime.deleteToken();assertCurrent(owner,version);});cleanupNeedsRetry=false;}
  const key=config.vapidKey;
  const token=await tokenOperation(async()=>{assertCurrent(owner,version);const result=await runtime.token(key);assertCurrent(owner,version);return result;});
  if(!token)throw Error('기기 알림 연결을 만들지 못했습니다. 다시 시도해 주세요.');
  assertCurrent(owner,version);await call({action:'register',deviceId:runtime.deviceId(),token});assertCurrent(owner,version);
  runtime.setTransport(owner,true);await workerPermission(true,version);assertCurrent(owner,version);
  registeredOwner=owner;registeredGeneration=version;registeredAt=runtime.now?.()??Date.now();changed();
 }
 function startRegistration(){
  const owner=runtime.uid(),version=generation;
  if(registration?.owner===owner&&registration.generation===version)return registration.promise;
  const promise=register().catch(async error=>{if(current(owner,version)){clearRegistered();await workerPermission(false,version).catch(()=>{});}throw error;}).finally(()=>{if(registration?.promise===promise)registration=null;});
  registration={owner,generation:version,promise};return promise;
 }
 async function enable(){
  const owner=runtime.uid();if(!owner)throw Error('먼저 로그인해 주세요.');
  if(!configured())throw Error('기기 알림을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.');
  if(!memberEnabled)throw Error('먼저 ‘내 알림 수신’을 켜 주세요.');
  // The button calls this before asynchronous capability checks preserve its gesture.
  if(runtime.permission()==='default'){const permission=await runtime.requestPermission();if(runtime.uid()!==owner)throw Error('로그인 계정이 변경되었습니다. 다시 시도해 주세요.');if(permission!=='granted')throw Error(permission==='denied'?'브라우저 설정에서 이 사이트의 알림을 허용해 주세요.':'기기 알림 권한을 허용해 주세요.');}
  if(runtime.permission()!=='granted')throw Error(runtime.permission()==='denied'?'브라우저 설정에서 이 사이트의 알림을 허용해 주세요.':'이 브라우저에서는 기기 알림을 사용할 수 없습니다.');
  runtime.setPreference(owner,true);changed();await startRegistration();
 }
 async function sync(enabledMember=true){
  memberEnabled=enabledMember;const owner=runtime.uid();
  if(!memberEnabled){await pause();return;}
  if(!configured()||!owner||!receiving(owner))return;
  if(runtime.permission()!=='granted'){if(registeredOwner===owner||registration?.owner===owner)await pause();return;}
  // Normal portal refreshes must not rewrite the same device registration repeatedly.
  const age=(runtime.now?.()??Date.now())-registeredAt;
  if(registeredOwner===owner&&registeredGeneration===generation&&age>=0&&age<6*3600000)return;
  if(pendingCleanup){deferredSync={owner,generation};return;}
  try{await startRegistration();}catch{}
 }
 async function cleanup(all=false){
  const owner=runtime.uid(),hadTransport=!!owner&&(registeredOwner===owner||runtime.hasTransport(owner)||!!registration||configured()&&runtime.permission()==='granted');
  generation++;deferredSync=null;clearRegistered();if(owner)runtime.setTransport(owner,false);
  if(hadTransport)await workerPermission(false).catch(()=>{});
  if(!available||!owner||(!hadTransport&&!all))return;
  const requests:Promise<unknown>[]=[];
  if(runtime.uid()===owner)requests.push(call(all?{action:'unregisterAll'}:{action:'unregister',deviceId:runtime.deviceId()}));
  if(hadTransport)requests.push(tokenOperation(async()=>{if(await runtime.supported())await runtime.deleteToken();}));
  const work=Promise.allSettled(requests);pendingCleanup=work;
  void work.then(results=>{if(pendingCleanup!==work)return;cleanupNeedsRetry=results.some(result=>result.status==='rejected');pendingCleanup=null;const deferred=deferredSync;deferredSync=null;if(deferred&&current(deferred.owner,deferred.generation))void sync(memberEnabled);});
  await timeout(work,cleanupWaitMs);
 }
 async function disable(){const owner=runtime.uid();if(owner)runtime.setPreference(owner,false);await cleanup();changed();}
 async function disableAll(){await cleanup(true);}
 async function test(){if(!(await status()).registered)throw Error('이 기기에 알림을 연결한 뒤 다시 시도해 주세요.');await call({action:'test',deviceId:runtime.deviceId()});}
 return {configure,status,enable,sync,cleanup,disable,disableAll,test,pause,listen:runtime.listen,onChange(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}};
}
