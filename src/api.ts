import {initializeApp} from 'firebase/app';
import {getAuth,browserLocalPersistence,onAuthStateChanged,inMemoryPersistence,setPersistence,signInWithCustomToken,signInWithEmailAndPassword,signInWithPopup,GoogleAuthProvider,signOut,connectAuthEmulator} from 'firebase/auth';
import {getFunctions,httpsCallable,connectFunctionsEmulator} from 'firebase/functions';
import {loadDemoSession,saveDemoSession,clearDemoSession} from './session';
import {State,command,visible} from './domain';import {seed} from './seed';
import {createPushClient} from './push';
import type {HistoryPage,HistoryTable} from './history';
const env={env:import.meta.env};export const live=!!env.env.VITE_FIREBASE_PROJECT_ID;
let demo=seed();export let currentUid='';
const demoListeners=new Set<()=>void>();
function setDemoUser(uid:string,remember:boolean){saveDemoSession(uid,remember);currentUid=uid;demoListeners.forEach(f=>f());}
const app=live?initializeApp({apiKey:env.env.VITE_FIREBASE_API_KEY,authDomain:env.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:env.env.VITE_FIREBASE_PROJECT_ID,appId:env.env.VITE_FIREBASE_APP_ID,storageBucket:env.env.VITE_FIREBASE_STORAGE_BUCKET,messagingSenderId:env.env.VITE_FIREBASE_MESSAGING_SENDER_ID}):null;
const auth=app?getAuth(app):null;const fn=app?getFunctions(app,'asia-northeast3'):null;
if(auth&&fn&&env.env.VITE_USE_EMULATORS==='true'){connectAuthEmulator(auth,'http://127.0.0.1:9099');connectFunctionsEmulator(fn,'127.0.0.1',5001);}
export const classId=env.env.VITE_CLASS_ID||'2027-1-11';
export const push=createPushClient(app,input=>invoke('pushDevice',{classId,...input}),env.env.VITE_FIREBASE_VAPID_KEY||'',env.env.VITE_ENABLE_PUSH==='true');
async function invoke<T=any>(name:string,data:object):Promise<{data:T}>{
 const base=env.env.VITE_API_BASE;
 if(!base){if(!fn)throw Error('서버 연결 설정이 없습니다.');return await httpsCallable<object,T>(fn,name)(data);}
 if(!/^https:\/\//.test(base))throw Error('안전한 서버 주소가 필요합니다.');
 const headers:Record<string,string>={'Content-Type':'application/json'};
 if(auth?.currentUser)headers.Authorization=`Bearer ${await auth.currentUser.getIdToken()}`;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
 try{
  let response:Response;
  try{response=await fetch(`${base.replace(/\/$/,'')}/${name}`,{method:'POST',headers,body:JSON.stringify(data),signal:controller.signal});}catch{throw Error('서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.');}
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw Error(typeof result?.error==='string'?result.error:'서버 요청에 실패했습니다. 잠시 뒤 다시 시도해 주세요.');
  if(result===null)throw Error('서버 응답을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  return {data:result as T};
 }finally{clearTimeout(timeout);}
}
export async function login(id:string,pw:string,google=false,remember=false){if(auth){if(auth.currentUser)await push.cleanup().catch(()=>{});await setPersistence(auth,remember?browserLocalPersistence:inMemoryPersistence);const r=google?await signInWithPopup(auth,new GoogleAuthProvider()):await signInWithEmailAndPassword(auth,id,pw);currentUid=r.user.uid;}else setDemoUser(id,remember);return refresh();}
export async function refresh():Promise<State>{if(fn){const r=await invoke<State>('portal',{classId,action:'readState',clientVersion:2});return r.data;}return visible(demo,currentUid);}
export async function send(action:string,p:Record<string,any>,key=crypto.randomUUID()){if(!navigator.onLine)throw Error('오프라인에서는 제출할 수 없습니다.');if(fn)await invoke('portal',{classId,action,p,key});else{const next=structuredClone(demo);command(next,currentUid,action,p,key);demo=next;}if(action==='preferences'&&p.enabled===false)await push.disableAll().catch(()=>{});return refresh();}
export async function logout(){await push.cleanup().catch(()=>{});if(auth)await signOut(auth);clearDemoSession();currentUid='';demoListeners.forEach(f=>f());}

export async function loginStudent(studentNo:string,pin:string,remember=false):Promise<State>{
 if(!/^\d{1,30}$/.test(studentNo)||!/^\d{4}$/.test(pin))throw Error('학번과 4자리 숫자 비밀번호를 입력하세요.');
 if(!auth||!fn){if(pin!=='2468'||!['01101','01102'].includes(studentNo))throw Error('데모 학번은 01101 또는 01102, 코드는 2468입니다.');setDemoUser(studentNo==='01101'?'student1':'student2',remember);return refresh();}
 if(auth.currentUser)await push.cleanup().catch(()=>{});
 await setPersistence(auth,remember?browserLocalPersistence:inMemoryPersistence);
 const response=await invoke<{token:string}>('studentLogin',{classId,studentNo,pin});
 const user=await signInWithCustomToken(auth,response.data.token);currentUid=user.user.uid;return refresh();
}

export function observeSession(onState:(s:State|null)=>void,onError:(e:unknown)=>void){
 let sequence=0,active=true;
 async function restore(uid:string|null){const generation=++sequence;currentUid=uid||'';if(!uid){void push.pause();onState(null);return;}try{const state=await refresh();if(active&&sequence===generation){onState(state);if(state.members.find(m=>m.id===uid)?.notifications?.enabled===false)void push.pause();else void push.sync();}}catch(e){if(active&&sequence===generation){currentUid='';void push.pause();onState(null);onError(e);}}}
 if(auth){const stop=onAuthStateChanged(auth,u=>{void restore(u?.uid||null);},e=>{if(active){currentUid='';onState(null);onError(e);}});return()=>{active=false;sequence++;stop();};}
 const listener=()=>{void restore(currentUid||null);};demoListeners.add(listener);
 const changed=(e:StorageEvent)=>{if(e.key==='wooriban.demo-session'||e.key===null)void restore(loadDemoSession());};window.addEventListener('storage',changed);
 void restore(loadDemoSession());
 return()=>{active=false;sequence++;demoListeners.delete(listener);window.removeEventListener('storage',changed);};
}

export async function getLoginStudentNumbers():Promise<string[]>{
 if(fn){const response=await invoke<{studentNumbers:string[]}>('studentLoginOptions',{classId});return response.data.studentNumbers;}
 return demo.members.filter(m=>m.role==='student'&&m.active).map(m=>String(m.studentNo)).sort();
}

export async function getHistory(table:HistoryTable,cursor?:string|null):Promise<HistoryPage>{
 if(fn){const response=await invoke<HistoryPage>('portal',{classId,action:'readHistory',p:{table,...(cursor?{cursor}:{}),limit:25}});return response.data;}
 const state=visible(demo,currentUid),teacher=state.members.find(member=>member.id===currentUid)?.role==='teacher';
 if(!teacher&&['audits','payouts','lots','quizzes'].includes(table))throw Error('기록 조회 권한이 없습니다.');
 const rows=state[table].filter(row=>table!=='notices'||teacher||row.active).slice().sort((a,b)=>(b.at||b.acquiredAt||b.createdAt||0)-(a.at||a.acquiredAt||a.createdAt||0)||b.id.localeCompare(a.id));
 const offset=cursor&&/^demo:\d+$/.test(cursor)?Number(cursor.slice(5)):0;
 return {records:rows.slice(offset,offset+25),nextCursor:offset+25<rows.length?`demo:${offset+25}`:null,legacyRemaining:0};
}
