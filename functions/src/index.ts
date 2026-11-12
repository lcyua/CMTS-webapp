import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {State,tables,command,visible} from '../../src/domain';
initializeApp();const db=getFirestore();
// Pilot adapter: bounded per-class transactions, replace with indexed document queries
// before production scale. Never expose the server-only state document directly.
export const portal=onCall({region:'asia-northeast3',maxInstances:5},async req=>{
 if(!req.auth)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 const {classId,action,p={},key}=req.data||{};
 if(typeof classId!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(classId))throw new HttpsError('invalid-argument','학급 ID 오류');
 const uid=req.auth.uid,ref=db.doc(`classes/${classId}/private/state`);
 try{return await db.runTransaction(async tx=>{
 const snap=await tx.get(ref);if(!snap.exists)throw Error('학급이 설정되지 않았습니다.');const s=snap.data() as State;
 const m=s.members.find(m=>m.id===uid);if(!m?.active)throw Error('학급 접근 권한이 없습니다.');
 if(action==='readState')return visible(s,uid);
 if(typeof key!=='string'||!/^[-a-zA-Z0-9_]{1,120}$/.test(key))throw Error('요청 키 오류');
 command(s,uid,action,p,key);
 // Firestore document maximum is 1 MiB; leave space and fail atomically.
 if(Buffer.byteLength(JSON.stringify(s))>700000)throw Error('시범 운영 데이터 한도입니다. 관리자에게 문의하세요.');
 for(const t of tables)if(!Array.isArray(s[t]))throw Error('학급 데이터 오류');
 tx.set(ref,s);return {ok:true};});
 }catch(e){throw new HttpsError('failed-precondition',e instanceof Error?e.message:'처리 실패');}
});

// Student credentials remain server-only. Four-digit code is scoped by class + student number.
import {getAuth} from 'firebase-admin/auth';
import {createHash} from 'node:crypto';
import {defineSecret} from 'firebase-functions/params';
import {hashPin,verifyPin,validPin,nextAttempt} from './student-pin';
const pinPepper=defineSecret('STUDENT_PIN_PEPPER');
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const studentLogin=onCall({region:'asia-northeast3',maxInstances:5,secrets:[pinPepper],timeoutSeconds:20},async req=>{
 const {classId,studentNo,pin}=req.data||{};
 if(typeof classId!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(classId)||typeof studentNo!=='string'||!/^\d{1,30}$/.test(studentNo)||!validPin(pin))throw new HttpsError('invalid-argument','학번과 숫자 4자리 코드를 입력하세요.');
 const now=Date.now(),key=digest(classId+':'+studentNo);
 const accountRef=db.doc(`classes/${classId}/pinAccounts/${key}`),stateRef=db.doc(`classes/${classId}/private/state`);
 const gates=[db.doc(`loginLimits/account_${key}`),db.doc(`loginLimits/ip_${digest(req.rawRequest.ip||'unknown')}`)];
 const windows:number[]=[];
 try{await db.runTransaction(async tx=>{const snapshots=await Promise.all(gates.map(r=>tx.get(r)));const next=snapshots.map((snap,i)=>nextAttempt(snap.data() as {start:number;count:number}|undefined,now,i===0?5:50));for(let i=0;i<gates.length;i++){windows[i]=next[i].start;tx.set(gates[i],{...next[i],expiresAt:new Date(next[i].start+86400000)});}});}catch{throw new HttpsError('resource-exhausted','로그인 시도가 많습니다. 15분 뒤 다시 시도하세요.');}
 const credential=(await accountRef.get()).data(),pepper=pinPepper.value();
 const dummy=credential||await hashPin('0000',pepper,'0'.repeat(32));
 const matched=await verifyPin(pin,pepper,dummy.salt,dummy.hash);
 if(!credential||!matched)throw new HttpsError('unauthenticated','학번 또는 코드가 일치하지 않습니다.');
 const user=await getAuth().getUser(credential.uid);
 if(user.disabled)throw new HttpsError('unauthenticated','학번 또는 코드가 일치하지 않습니다.');
 await db.runTransaction(async tx=>{
  const [latest,state,...limits]=await Promise.all([tx.get(accountRef),tx.get(stateRef),...gates.map(g=>tx.get(g))]);
  const c=latest.data(),members=(state.data()?.members||[]) as State['members'];
  if(!c?.active||c.hash!==credential.hash||!members.some(m=>m.id===credential.uid&&m.active&&m.role==='student'&&m.studentNo===studentNo))throw new HttpsError('unauthenticated','학번 또는 코드가 일치하지 않습니다.');
  limits.forEach((l,i)=>{const d=l.data();if(d&&d.start===windows[i])tx.update(gates[i],{count:Math.max(0,d.count-1)});});
 });
 return {token:await getAuth().createCustomToken(credential.uid)};
});

// Explicit login dropdown contains only student numbers, never names, UIDs or secrets.
import {loginStudentNumbers} from '../../src/login-options';
export const studentLoginOptions=onCall({region:'asia-northeast3',maxInstances:3,timeoutSeconds:10},async req=>{
 const classId=req.data?.classId;
 if(typeof classId!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(classId))throw new HttpsError('invalid-argument','학급 설정을 확인하세요.');
 const state=(await db.doc(`classes/${classId}/private/state`).get()).data();
 return {studentNumbers:loginStudentNumbers(state?.members||[])};
});
