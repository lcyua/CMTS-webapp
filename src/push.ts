import {FirebaseApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
import {deleteToken,getMessaging,getToken,isSupported,Messaging} from 'firebase/messaging';
import {createPushController,PushCall,PushRuntime} from './push-controller';
import {pushPreferenceKey} from './push-preferences';
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
 const workerPermission=async(allow:boolean)=>{
  if(typeof navigator==='undefined'||!('serviceWorker'in navigator))return;
  const registration=await navigator.serviceWorker.getRegistration('/');if(!registration?.active)return;
  await new Promise<void>((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('앱을 새로고침한 뒤 다시 시도해 주세요.'));},1000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data?.ok?resolve():reject(Error('기기 알림 설정을 저장하지 못했습니다.'));};registration.active!.postMessage({type:'WOORIBAN_PUSH_PERMISSION',enabled:allow},[channel.port2]);});
 };
 const runtime:PushRuntime={
  uid:()=>app?getAuth(app).currentUser?.uid||'':'',
  supported:()=>support??=(typeof window==='undefined'||!('Notification'in window)||!('serviceWorker'in navigator)?Promise.resolve(false):isSupported().catch(()=>false)),
  permission:()=>typeof Notification==='undefined'?'unsupported':Notification.permission,
  requestPermission:()=>Notification.requestPermission(),
  preference:uid=>read(pushPreferenceKey(uid)),
  setPreference:(uid,value)=>write(pushPreferenceKey(uid),String(value)),
  hasTransport:uid=>!!uid&&(read(transportKey(uid))==='true'||read(pushPreferenceKey(uid))==='true'),
  setTransport:(uid,value)=>write(transportKey(uid),String(value)),
  deviceId:()=>{let id=read(DEVICE_KEY);if(!id){id=crypto.randomUUID();write(DEVICE_KEY,id);}return id;},
  token:async key=>{
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{const registration=await Promise.race([navigator.serviceWorker.ready,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('앱을 새로고침한 뒤 다시 시도해 주세요.')),3000);})]);if(new URL(registration.active?.scriptURL||'',location.origin).pathname!=='/sw.js')throw Error('앱을 새로고침한 뒤 다시 시도해 주세요.');return await getToken(instance(),{vapidKey:key,serviceWorkerRegistration:registration});}finally{if(timer)clearTimeout(timer);}
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
