import {initializeApp} from 'firebase/app';
import {getAuth,browserLocalPersistence,onAuthStateChanged,inMemoryPersistence,setPersistence,signInWithCustomToken,signInWithEmailAndPassword,signInWithPopup,GoogleAuthProvider,signOut,connectAuthEmulator} from 'firebase/auth';
import {getFunctions,httpsCallable,connectFunctionsEmulator} from 'firebase/functions';
import {loadDemoSession,saveDemoSession,clearDemoSession} from './session';
import {State,command,visible} from './domain';import {seed} from './seed';
const env={env:import.meta.env};export const live=!!env.env.VITE_FIREBASE_PROJECT_ID;
let demo=seed();export let currentUid='';
const demoListeners=new Set<()=>void>();
function setDemoUser(uid:string,remember:boolean){saveDemoSession(uid,remember);currentUid=uid;demoListeners.forEach(f=>f());}
const app=live?initializeApp({apiKey:env.env.VITE_FIREBASE_API_KEY,authDomain:env.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:env.env.VITE_FIREBASE_PROJECT_ID,appId:env.env.VITE_FIREBASE_APP_ID,storageBucket:env.env.VITE_FIREBASE_STORAGE_BUCKET,messagingSenderId:env.env.VITE_FIREBASE_MESSAGING_SENDER_ID}):null;
const auth=app?getAuth(app):null;const fn=app?getFunctions(app,'asia-northeast3'):null;
if(auth&&fn&&env.env.VITE_USE_EMULATORS==='true'){connectAuthEmulator(auth,'http://127.0.0.1:9099');connectFunctionsEmulator(fn,'127.0.0.1',5001);}
export const classId=env.env.VITE_CLASS_ID||'2027-1-11';
export async function login(id:string,pw:string,google=false,remember=false){if(auth){await setPersistence(auth,remember?browserLocalPersistence:inMemoryPersistence);const r=google?await signInWithPopup(auth,new GoogleAuthProvider()):await signInWithEmailAndPassword(auth,id,pw);currentUid=r.user.uid;}else setDemoUser(id,remember);return refresh();}
export async function refresh():Promise<State>{if(fn){const r=await httpsCallable(fn,'portal')({classId,action:'readState'});return r.data as State;}return visible(demo,currentUid);}
export async function send(action:string,p:Record<string,any>,key=crypto.randomUUID()){if(!navigator.onLine)throw Error('오프라인에서는 제출할 수 없습니다.');if(fn)await httpsCallable(fn,'portal')({classId,action,p,key});else{const next=structuredClone(demo);command(next,currentUid,action,p,key);demo=next;}return refresh();}
export async function logout(){if(auth)await signOut(auth);clearDemoSession();currentUid='';demoListeners.forEach(f=>f());}

export async function loginStudent(studentNo:string,pin:string,remember=false):Promise<State>{
 if(!/^\d{1,30}$/.test(studentNo)||!/^\d{4}$/.test(pin))throw Error('학번과 4자리 숫자 비밀번호를 입력하세요.');
 if(!auth||!fn){if(pin!=='2468'||!['01101','01102'].includes(studentNo))throw Error('데모 학번은 01101 또는 01102, 코드는 2468입니다.');setDemoUser(studentNo==='01101'?'student1':'student2',remember);return refresh();}
 await setPersistence(auth,remember?browserLocalPersistence:inMemoryPersistence);
 const response=await httpsCallable<{classId:string;studentNo:string;pin:string},{token:string}>(fn,'studentLogin')({classId,studentNo,pin});
 const user=await signInWithCustomToken(auth,response.data.token);currentUid=user.user.uid;return refresh();
}

export function observeSession(onState:(s:State|null)=>void,onError:(e:unknown)=>void){
 let sequence=0,active=true;
 async function restore(uid:string|null){const generation=++sequence;currentUid=uid||'';if(!uid){onState(null);return;}try{const state=await refresh();if(active&&sequence===generation)onState(state);}catch(e){if(active&&sequence===generation){currentUid='';onState(null);onError(e);}}}
 if(auth){const stop=onAuthStateChanged(auth,u=>{void restore(u?.uid||null);},e=>{if(active){currentUid='';onState(null);onError(e);}});return()=>{active=false;sequence++;stop();};}
 const listener=()=>{void restore(currentUid||null);};demoListeners.add(listener);
 const changed=(e:StorageEvent)=>{if(e.key==='wooriban.demo-session'||e.key===null)void restore(loadDemoSession());};window.addEventListener('storage',changed);
 void restore(loadDemoSession());
 return()=>{active=false;sequence++;demoListeners.delete(listener);window.removeEventListener('storage',changed);};
}

export async function getLoginStudentNumbers():Promise<string[]>{
 if(fn){const response=await httpsCallable<{classId:string},{studentNumbers:string[]}>(fn,'studentLoginOptions')({classId});return response.data.studentNumbers;}
 return demo.members.filter(m=>m.role==='student'&&m.active).map(m=>String(m.studentNo)).sort();
}
