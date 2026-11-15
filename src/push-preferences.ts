export const pushPreferenceKey=(uid:string)=>'wooriban.push-enabled.'+uid;

/** Missing choices receive by default; an explicit device or account opt-out wins. */
export function receivesPush(preference:string|null|undefined,memberEnabled=true){return memberEnabled&&preference!=='false';}
export function validPushKey(value:unknown):value is string {return typeof value==='string'&&/^[A-Za-z0-9_-]{87}$/.test(value);}
export function pushPermissionStep(preference:string|null|undefined,permission:NotificationPermission|'unsupported',memberEnabled=true){
 if(!receivesPush(preference,memberEnabled))return 'off';
 if(permission==='granted')return 'connect';
 if(permission==='default')return 'allow';
 return permission==='denied'?'blocked':'unsupported';
}
