/** One-time administrative provisioning. Default is local validation, never an upload. */
import {readFileSync,existsSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {createRequire} from 'node:module';import {randomInt,randomUUID,createHash} from 'node:crypto';
import https from 'node:https';
import {hashPin} from '../functions/src/student-pin';import {emptyClass} from '../src/roster';
import {pinPassword} from '../worker/credentials';
const args=process.argv.slice(2);const option=(flag:string)=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined};
const file=option('--file')||'imports/roster-pending.json';const roster=JSON.parse(readFileSync(file,'utf8'));
if(!Array.isArray(roster.students)||!roster.students.length||roster.students.length>60)throw Error('명단은 1~60명이어야 합니다.');
const students=roster.students.map((s:any)=>({studentNo:String(s.studentNo||'').trim(),name:String(s.name||'').trim()}));
if(students.some((s:any)=>!/^\d{1,30}$/.test(s.studentNo)||!s.name)||new Set(students.map((s:any)=>s.studentNo)).size!==students.length)throw Error('학번 중복 또는 누락된 이름이 있습니다.');
console.log(`학번 로그인 명단 ${students.length}명 검증 완료. 기존 비밀번호는 사용하지 않습니다.`);
if(args.includes('--apply')){
 const classId=option('--class-id'),teacherEmail=option('--teacher-email'),teacherName=option('--teacher-name'),year=Number(option('--year')),className=option('--class-name');
 const pepper=process.env.STUDENT_PIN_PEPPER;
 if(!classId||!/^[-a-zA-Z0-9_]{1,80}$/.test(classId)||!teacherEmail||!teacherName||!className||!Number.isInteger(year)||!pepper||pepper.length<32)throw Error('학급·교사 설정과 서버 비밀값 STUDENT_PIN_PEPPER(32자 이상)가 필요합니다.');
 if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('실제 명단 처리에서는 에뮬레이터 변수를 제거하세요.');
 const adminRequire=createRequire(new URL('../functions/package.json',import.meta.url));const {initializeApp,applicationDefault}=adminRequire('firebase-admin/app');const{getAuth}=adminRequire('firebase-admin/auth');const{initializeFirestore}=adminRequire('firebase-admin/firestore');
 const proxy=process.env.HTTPS_PROXY;const httpAgent=proxy?new (adminRequire('https-proxy-agent').HttpsProxyAgent)(proxy):undefined;
 // Firestore's REST transport uses node-fetch and does not inherit App.httpAgent.
 if(httpAgent)https.globalAgent=httpAgent;
 const app=initializeApp({credential:applicationDefault(httpAgent),httpAgent,projectId:'wooriban-2027'});const auth=getAuth(),db=initializeFirestore(app,{preferRest:true});
 const teacher=await auth.getUserByEmail(teacherEmail);if(teacher.disabled)throw Error('교사 계정이 비활성화되었습니다.');
 const output='imports/student-login-codes.private.json';if(existsSync(output))throw Error('기존 코드 전달 파일이 있어 중단했습니다.');
 const stateRef=db.doc(`classes/${classId}/private/state`),jobRef=db.doc(`classes/${classId}/private/provisioning`);
 // A lock prevents racing setup jobs. Failed jobs retain this lock for explicit recovery.
 await db.runTransaction(async(tx:any)=>{const [state,job]=await Promise.all([tx.get(stateRef),tx.get(jobRef)]);if(state.exists||job.exists)throw Error('기존 학급 또는 초기화 작업이 있습니다. 덮어쓰지 않습니다.');tx.create(jobRef,{status:'started',createdAt:Date.now(),count:students.length});});
 mkdirSync('imports',{recursive:true,mode:0o700});
 const accounts:any[]=[];const save=(status:string)=>{writeFileSync(output+'.tmp',JSON.stringify({classId,status,accounts},null,2),{mode:0o600});renameSync(output+'.tmp',output);};writeFileSync(output,JSON.stringify({classId,status:'provisioning',accounts}),{mode:0o600,flag:'wx'});
 try{
  for(const student of students){
   const uid=randomUUID(),pin=String(randomInt(0,10000)).padStart(4,'0');
   const workers=args.includes('--workers');const authEmail=`${uid}@students.wooriban-2027.invalid`;
   const protectedPin=workers?{salt:randomUUID().replaceAll('-',''),scheme:'firebase-password-v1',authEmail}:await hashPin(pin,pepper);
   // Persist private recovery information before any Auth mutation; never print it.
   accounts.push({...student,uid,pin,status:'pending'});save('provisioning');
   await auth.createUser({uid,displayName:student.name,disabled:false,...(workers?{email:authEmail,password:await pinPassword(pin,pepper,protectedPin.salt)}:{})});
   const id=createHash('sha256').update(classId+':'+student.studentNo).digest('hex');
   await db.doc(`classes/${classId}/pinAccounts/${id}`).create({uid,studentNo:student.studentNo,active:true,...protectedPin,version:1,createdAt:Date.now()});
   accounts[accounts.length-1].status='created';save('provisioning');
  }
  const state=emptyClass({uid:teacher.uid,name:teacherName},accounts.map(a=>({...a,email:''})),year,className);
  await db.runTransaction(async(tx:any)=>{if((await tx.get(stateRef)).exists)throw Error('학급이 이미 있습니다.');tx.create(stateRef,state);tx.update(jobRef,{status:'complete',completedAt:Date.now()});});
  save('complete');
  console.log(`${accounts.length}명 생성 완료. 코드는 비공개 imports 파일에만 저장되었습니다.`);
 }catch{await jobRef.update({status:'needsRecovery',updatedAt:Date.now()});throw Error('초기화가 중단되었습니다. 비공개 복구 파일과 서버 작업 상태를 확인하세요. 재실행·덮어쓰기·기존 코드 재발급은 자동으로 하지 않습니다.');}
}else console.log('검증 전용: 계정 생성·4자리 코드 발급·원격 저장을 실행하지 않았습니다.');
