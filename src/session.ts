const KEY='wooriban.demo-session';
const allowed=new Set(['student1','student2','teacher']);
export type SessionStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function loadDemoSession(storage:SessionStorage=localStorage):string|null{
 try{const raw=storage.getItem(KEY);if(!raw)return null;const data=JSON.parse(raw);return data?.v===1&&allowed.has(data.uid)?data.uid:null;}catch{return null;}
}
export function saveDemoSession(uid:string,remember:boolean,storage:SessionStorage=localStorage){
 if(!allowed.has(uid))throw Error('알 수 없는 데모 계정입니다.');
 if(!remember){clearDemoSession(storage);return;}
 try{storage.setItem(KEY,JSON.stringify({v:1,uid}));}catch{throw Error('이 브라우저에서 로그인 상태를 저장할 수 없습니다. 로그인 유지를 해제하고 다시 시도하세요.');}
}
export function clearDemoSession(storage:SessionStorage=localStorage){try{storage.removeItem(KEY);}catch{/* Nonpersistent login still works in restricted browsers. */}}
