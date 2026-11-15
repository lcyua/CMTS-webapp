type PermissionRequest=(callback:(permission:NotificationPermission)=>void)=>Promise<NotificationPermission>|void;

/** Some mobile browsers finish the callback without settling the returned promise. */
export function requestNotificationPermission(request:PermissionRequest):Promise<NotificationPermission>{
 return new Promise((resolve,reject)=>{
  try{const result=request(resolve);if(result?.then)void result.then(resolve,reject);}catch(error){reject(error);}
 });
}
