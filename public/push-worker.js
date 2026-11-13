// The data payload deliberately carries no names, balances, or message contents.
const PUSH_TITLE='우리반 학급 포털';
const PUSH_BODY='새 학급 알림이 있습니다. 앱에서 확인해 주세요.';
const pushStore=()=>new Promise((resolve,reject)=>{const request=indexedDB.open('wooriban-push-preferences',1);request.onupgradeneeded=()=>request.result.createObjectStore('settings');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
async function pushPermission(value){
 const db=await pushStore();
 try{return await new Promise((resolve,reject)=>{const transaction=db.transaction('settings',value===undefined?'readonly':'readwrite');const request=value===undefined?transaction.objectStore('settings').get('enabled'):transaction.objectStore('settings').put(value,'enabled');request.onsuccess=()=>{if(value===undefined)resolve(request.result===true);};transaction.oncomplete=()=>{if(value!==undefined)resolve(value);};transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});}finally{db.close();}
}
self.addEventListener('message',event=>{
 if(event.data?.type!=='WOORIBAN_PUSH_PERMISSION'||typeof event.data.enabled!=='boolean')return;
 event.waitUntil(pushPermission(event.data.enabled).then(()=>event.ports[0]?.postMessage({ok:true})).catch(()=>event.ports[0]?.postMessage({ok:false})));
});
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  if(!await pushPermission().catch(()=>false))return;
  let payload;try{payload=event.data?.json();}catch{return;}
  const id=payload?.data?.id;
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const visible=windows.filter(client=>new URL(client.url).origin===self.location.origin&&client.visibilityState==='visible');
  if(visible.length){visible.forEach(client=>client.postMessage({type:'WOORIBAN_PUSH',id}));return;}
  await self.registration.showNotification(PUSH_TITLE,{body:PUSH_BODY,icon:'/icon-192.png',badge:'/icon-192.png',tag:'wooriban-'+id,data:{wooriban:true},renotify:false});
 })());
});
self.addEventListener('notificationclick',event=>{
 if(event.notification.data?.wooriban!==true)return;
 event.notification.close();
 event.waitUntil((async()=>{
  const target=new URL('/',self.location.origin).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
  if(existing){await existing.focus();existing.postMessage({type:'WOORIBAN_PUSH'});return;}
  await self.clients.openWindow(target);
 })());
});
