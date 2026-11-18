import {FirebaseApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
import {deleteToken,getMessaging,getToken,isSupported,Messaging} from 'firebase/messaging';
import {createPushController,PushCall,PushRuntime} from './push-controller';
import {pushPreferenceKey} from './push-preferences';
import {findPushWorker,requestNotificationPermission} from './push-permission';
export type {PushStatus} from './push-controller';
export type PushClient=ReturnType<typeof createPushClient>;
const DEVICE_KEY='wooriban.push-device';
const transportKey=(uid:string)=>'wooriban.push-transport.'+uid;

/** Firebase owns token storage. App storage contains preferences and device identity. */
export function createPushClient(app:FirebaseApp|null,call:PushCall,vapidKey:string,enabled=false){
 let messaging:Messaging|undefined,support:Promise<boolean>|undefined;
 const memory=new Map<string,string>();
 const read=(key:string)=>{try{return localStorage.getItem(key)??memory.get(key)??null;}catch{return memory.get(key)??null;}};
 const write=(key:string,value:string)=>{memory.set(key,value);try{localStorage.setItem(key,value);}catch{}};
 const instance=()=>messaging??=getMessaging(app!);
 const workerPermission=async(allow:boolean,current=()=>true)=>{
  if(typeof navigator==='undefined'||!('serviceWorker'in navigator))return;
  const worker=await findPushWorker(()=>navigator.serviceWorker.getRegistration('/'),current);if(!current())return;if(!worker){if(allow)throw Error('앱의 알림 연결을 찾지 못했습니다. 사이트를 새로고침한 뒤 다시 시도해 주세요.');return;}
  await new Promise<void>((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('앱을 새로고침한 뒤 다시 시도해 주세요.'));},1000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data?.ok?resolve():reject(Error('기기 알림 설정을 저장하지 못했습니다.'));};if(!current()){clearTimeout(timer);channel.port1.close();resolve();return;}worker.postMessage({type:'WOORIBAN_PUSH_PERMISSION',enabled:allow},[channel.port2]);});
 };
 const runtime:PushRuntime={
  uid:()=>app?getAuth(app).currentUser?.uid||'':'',
  supported:()=>support??=(typeof window==='undefined'||!('Notification'in window)||!('serviceWorker'in navigator)?Promise.resolve(false):isSupported().catch(()=>false)),
  permission:()=>typeof Notification==='undefined'?'unsupported':Notification.permission,
  requestPermission:()=>requestNotificationPermission(callback=>Notification.requestPermission(callback)),
  observePermission:changed=>{
   let active=true,status:PermissionStatus|undefined;
   const update=()=>{if(active)changed();};
   const visible=()=>{if(document.visibilityState==='visible')update();};
   window.addEventListener('focus',update);document.addEventListener('visibilitychange',visible);
   try{if(navigator.permissions)void navigator.permissions.query({name:'notifications'}).then(result=>{if(active){status=result;status.addEventListener('change',update);}}).catch(()=>{});}catch{}
   return()=>{active=false;window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',visible);status?.removeEventListener('change',update);};
  },
  preference:uid=>read(pushPreferenceKey(uid)),
  setPreference:(uid,value)=>write(pushPreferenceKey(uid),String(value)),
  hasTransport:uid=>!!uid&&(read(transportKey(uid))==='true'||read(pushPreferenceKey(uid))==='true'),
  setTransport:(uid,value)=>write(transportKey(uid),String(value)),
  deviceId:()=>{let id=read(DEVICE_KEY);if(!id){id=crypto.randomUUID();write(DEVICE_KEY,id);}return id;},
  token:async key=>{
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{const registration=await Promise.race([navigator.serviceWorker.ready,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('앱을 새로고침한 뒤 다시 시도해 주세요.')),3000);})]);if(new URL(registration.active?.scriptURL||'',location.origin).pathname!=='/sw.js')throw Error('앱을 새로고침한 뒤 다시 시도해 주세요.');return await getToken(instance(),{vapidKey:key,serviceWorkerRegistration:registration});}
   catch(error){
    const detail=error as {code?:unknown;name?:unknown}|null,code=typeof detail?.code==='string'?detail.code:'',name=detail?.name;
    if(code==='messaging/permission-blocked'||name==='NotAllowedError')throw Error('브라우저 설정에서 이 사이트의 알림과 브라우저 앱의 알림을 모두 허용해 주세요.');
    if(code==='messaging/unsupported-browser'||name==='NotSupportedError')throw Error('이 브라우저에서는 기기 알림 연결을 사용할 수 없습니다. 최신 브라우저에서 다시 열어 주세요.');
    if(code?.startsWith('installations/')||code?.startsWith('messaging/'))throw Error('알림 서비스에 기기를 연결하지 못했습니다. 네트워크 연결과 브라우저 알림 설정을 확인한 뒤 다시 시도해 주세요.');
    if(error instanceof Error&&error.message==='앱을 새로고침한 뒤 다시 시도해 주세요.')throw error;
    throw Error('브라우저의 기기 알림 연결을 만들지 못했습니다. 브라우저를 다시 열고 시도해 주세요.');
   }finally{if(timer)clearTimeout(timer);}
  },
  deleteToken:()=>deleteToken(instance()),
  workerPermission,
  listen:onPush=>{
   if(typeof navigator==='undefined'||!('serviceWorker'in navigator))return ()=>{};
   const listener=(event:MessageEvent)=>{const source=event.source as ServiceWorker|null;if(event.data?.type==='WOORIBAN_PUSH'&&source?.scriptURL===new URL('/sw.js',location.origin).href)onPush();};navigator.serviceWorker.addEventListener('message',listener);return ()=>navigator.serviceWorker.removeEventListener('message',listener);
  }
 };
 return createPushController(!!app,call,runtime,{enabled,vapidKey});
}
