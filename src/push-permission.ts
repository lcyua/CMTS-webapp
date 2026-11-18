type PermissionRequest=(callback:(permission:NotificationPermission)=>void)=>Promise<NotificationPermission>|void;

/** Some mobile browsers finish the callback without settling the returned promise. */
export function requestNotificationPermission(request:PermissionRequest):Promise<NotificationPermission>{
 return new Promise((resolve,reject)=>{
  try{const result=request(resolve);if(result?.then)void result.then(resolve,reject);}catch(error){reject(error);}
 });
}

/** A stale lookup must never post an allow message after logout/account changes. */
export async function findPushWorker(lookup:()=>Promise<ServiceWorkerRegistration|undefined>,current:()=>boolean,waitMs=1000):Promise<ServiceWorker|null>{
 let timer:ReturnType<typeof setTimeout>|number|undefined;
 try{
  const registration=await Promise.race([lookup(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('앱의 알림 연결 확인이 지연되고 있습니다. 브라우저를 다시 열어 주세요.')),waitMs);})]);
  return current()?registration?.active??null:null;
 }finally{if(timer)clearTimeout(timer);}
}
