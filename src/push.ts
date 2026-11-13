import {FirebaseApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
import {deleteToken,getMessaging,getToken,isSupported,Messaging} from 'firebase/messaging';

type PushCall=(input:{action:'register'|'unregister'|'unregisterAll';deviceId?:string;token?:string})=>Promise<unknown>;
export interface PushStatus {configured:boolean;supported:boolean;permission:NotificationPermission|'unsupported';registered:boolean;optedIn:boolean}
export type PushClient=ReturnType<typeof createPushClient>;
const DEVICE_KEY='wooriban.push-device';
const optKey=(uid:string)=>'wooriban.push-enabled.'+uid;

/** Firebase stores its token in IndexedDB. App storage contains only opt-in and device ID. */
export function createPushClient(app:FirebaseApp|null,call:PushCall,vapidKey:string,enabled=false){
 const configured=!!app&&enabled&&/^[A-Za-z0-9_-]{80,100}$/.test(vapidKey);
 let registered=false,messaging:Messaging|undefined,supported:Promise<boolean>|undefined,pendingCleanup:Promise<PromiseSettledResult<unknown>[]>|null=null;
 const listeners=new Set<()=>void>(),changed=()=>listeners.forEach(f=>f());
 const uid=()=>app?getAuth(app).currentUser?.uid||'':'';
 const optedIn=()=>{try{return !!uid()&&localStorage.getItem(optKey(uid()))==='true';}catch{return false;}};
 const hasAnyOptIn=()=>{try{return Object.keys(localStorage).some(key=>key.startsWith('wooriban.push-enabled.')&&localStorage.getItem(key)==='true');}catch{return false;}};
 const support=()=>supported??=(typeof window==='undefined'||!('Notification'in window)||!('serviceWorker'in navigator)?Promise.resolve(false):isSupported().catch(()=>false));
 const deviceId=()=>{let id=localStorage.getItem(DEVICE_KEY);if(!id){id=crypto.randomUUID();localStorage.setItem(DEVICE_KEY,id);}return id;};
 const getRegistration=async()=>{
  const registration=await Promise.race([navigator.serviceWorker.ready,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('앱을 새로고침한 뒤 다시 시도해 주세요.')),10000))]);
  if(new URL(registration.active?.scriptURL||'',location.origin).pathname!=='/sw.js')throw Error('앱을 새로고침한 뒤 다시 시도해 주세요.');
  return registration;
 };
 const workerPermission=async(allow:boolean)=>{
  if(typeof navigator==='undefined'||!('serviceWorker'in navigator))return;
  const registration=await navigator.serviceWorker.getRegistration('/');if(!registration?.active)return;
  await new Promise<void>((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('앱을 새로고침한 뒤 다시 시도해 주세요.'));},1000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data?.ok?resolve():reject(Error('기기 알림 설정을 저장하지 못했습니다.'));};registration.active!.postMessage({type:'WOORIBAN_PUSH_PERMISSION',enabled:allow},[channel.port2]);});
 };
 const getInstance=()=>messaging??=getMessaging(app!);
 async function status():Promise<PushStatus>{const available=configured&&await support();return {configured,supported:available,permission:available?Notification.permission:'unsupported',registered,optedIn:optedIn()};}
 async function register(requestPermission:boolean){
  const owner=uid();if(!owner)throw Error('먼저 로그인해 주세요.');
  if(!configured||!await support())throw Error('이 브라우저에서는 기기 알림을 사용할 수 없습니다.');
  // A slow token deletion must not race a new account's token registration.
  if(pendingCleanup)await Promise.race([pendingCleanup,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('이전 기기 알림 연결을 정리하고 있습니다. 잠시 후 다시 시도해 주세요.')),10000))]);
  let permission=Notification.permission;
  if(permission==='default'&&requestPermission)permission=await Notification.requestPermission();
  if(permission!=='granted')throw Error(permission==='denied'?'브라우저 설정에서 이 사이트의 알림을 허용해 주세요.':'기기 알림 권한을 허용해 주세요.');
  const registration=await getRegistration();
  const token=await getToken(getInstance(),{vapidKey,serviceWorkerRegistration:registration});
  if(!token)throw Error('기기 알림 연결을 만들지 못했습니다. 다시 시도해 주세요.');
  if(uid()!==owner)throw Error('로그인 계정이 변경되었습니다. 다시 시도해 주세요.');
  await call({action:'register',deviceId:deviceId(),token});
  if(uid()!==owner)throw Error('로그인 계정이 변경되었습니다. 다시 시도해 주세요.');
  await workerPermission(true);
  if(uid()!==owner){await workerPermission(false);throw Error('로그인 계정이 변경되었습니다. 다시 시도해 주세요.');}
  localStorage.setItem(optKey(owner),'true');registered=true;changed();
 }
 async function enable(){try{await register(true);}catch(e){registered=false;await workerPermission(false).catch(()=>{});if(messaging){const work=Promise.allSettled([deleteToken(messaging)]);pendingCleanup=work;void work.finally(()=>{if(pendingCleanup===work)pendingCleanup=null;});await Promise.race([work,new Promise(resolve=>setTimeout(resolve,3000))]);}changed();throw e;}}
 async function sync(){
  if(!configured||!uid()||!optedIn())return;
  try{await register(false);}catch{registered=false;await workerPermission(false).catch(()=>{});changed();}
 }
 async function cleanup(all=false){
  const current=uid(),hadOptIn=optedIn(),needsPause=registered||hadOptIn||hasAnyOptIn();registered=false;
  if(current){try{localStorage.removeItem(optKey(current));}catch{}}
  // Disable display first, including offline logout; network cleanup follows.
  if(needsPause)await workerPermission(false).catch(()=>{});changed();
  if(!app||!current||(!hadOptIn&&!all))return;
  let id:string|null=null;try{id=localStorage.getItem(DEVICE_KEY);}catch{}
  const operations:Promise<unknown>[]=[];
  if(all)operations.push(call({action:'unregisterAll'}));else if(id)operations.push(call({action:'unregister',deviceId:id}));
  if(hadOptIn&&await support())operations.push(deleteToken(getInstance()));
  const work=Promise.allSettled(operations);pendingCleanup=work;
  void work.finally(()=>{if(pendingCleanup===work)pendingCleanup=null;});
  // Logout remains usable during network failure. The worker was disabled first.
  await Promise.race([work,new Promise(resolve=>setTimeout(resolve,3000))]);
 }
 async function disable(){await cleanup();}
 async function disableAll(){await cleanup(true);}
 async function pause(){const needsPause=registered||hasAnyOptIn();registered=false;if(needsPause)await workerPermission(false).catch(()=>{});changed();}
 function listen(onPush:()=>void){
  if(typeof navigator==='undefined'||!('serviceWorker'in navigator))return ()=>{};
  const listener=(event:MessageEvent)=>{const source=event.source as ServiceWorker|null;if(event.data?.type==='WOORIBAN_PUSH'&&source?.scriptURL===new URL('/sw.js',location.origin).href)onPush();};
  navigator.serviceWorker.addEventListener('message',listener);return ()=>navigator.serviceWorker.removeEventListener('message',listener);
 }
 return {status,enable,sync,disable,disableAll,cleanup,pause,listen,onChange(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}};
}
