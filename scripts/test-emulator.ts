/** Integration checks use synthetic data and refuse all production endpoints. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initializeApp as initializeClient, deleteApp} from 'firebase/app';
import {getAuth as clientAuth, connectAuthEmulator, signInWithEmailAndPassword} from 'firebase/auth';
import {getFunctions, connectFunctionsEmulator, httpsCallable} from 'firebase/functions';
import {seed} from '../src/seed';
const projectId='demo-class-portal';
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST']) {
 if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key]||''))throw Error('Local emulators are required.');
}
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const admin=require('firebase-admin/app');
admin.initializeApp({projectId});
const auth=require('firebase-admin/auth').getAuth();
const db=require('firebase-admin/firestore').getFirestore();
const classId='integration-2027-1-11',ref=db.doc(`classes/${classId}/private/state`);
if((await ref.get()).exists)throw Error('Integration data already exists; refusing overwrite.');
for(const uid of ['teacher','student1','student2','outsider'])await auth.createUser({uid,email:`${uid}@example.test`,password:'EmulatorOnly-2026!'});
await ref.create(seed());
const apps:ReturnType<typeof initializeClient>[]=[];
async function client(uid?:string){
 const app=initializeClient({projectId,apiKey:'demo-api-key',appId:'demo-app'},uid||'anonymous');apps.push(app);
 const a=clientAuth(app);connectAuthEmulator(a,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});
 if(uid)await signInWithEmailAndPassword(a,`${uid}@example.test`,'EmulatorOnly-2026!');
 const fn=getFunctions(app,'asia-northeast3');connectFunctionsEmulator(fn,'127.0.0.1',5001);
 return {call:(action:string,p:object={},key=crypto.randomUUID())=>httpsCallable(fn,'portal')({classId,action,p,key}),auth:a};
}
try{
 const [teacher,student,outsider,anonymous]=await Promise.all([client('teacher'),client('student1'),client('outsider'),client()]);
 await assert.rejects(anonymous.call('readState'));
 await assert.rejects(outsider.call('readState'));
 await assert.rejects(student.call('points',{uid:'student1',amount:10,reason:'Forbidden'}));
 for(const c of [teacher,student,anonymous]){
  const token=await c.auth.currentUser?.getIdToken();
  const headers:Record<string,string>={'Content-Type':'application/json'};if(token)headers.Authorization=`Bearer ${token}`;
  const base=`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/classes/${classId}`;
  const read=await fetch(`${base}/private/state`,{headers});assert.equal(read.status,403);
  const write=await fetch(`${base}/pinAccounts/forbidden`,{method:'PATCH',headers,body:JSON.stringify({fields:{active:{booleanValue:true}}})});assert.equal(write.status,403);
 }
 const before=(await ref.get()).data().lots.filter((l:any)=>l.uid==='student1').reduce((n:number,l:any)=>n+l.available,0);
 await Promise.all(Array.from({length:6},()=>teacher.call('points',{uid:'student1',amount:7,reason:'Idempotency integration'},'same-request')));
 const after=(await ref.get()).data().lots.filter((l:any)=>l.uid==='student1').reduce((n:number,l:any)=>n+l.available,0);
 assert.equal(after-before,7,'Concurrent retries must grant exactly once');
 const visible=(await student.call('readState')).data as any;
 assert.ok(visible.lots.every((l:any)=>l.uid==='student1'));
 assert.ok(visible.quizzes.every((q:any)=>!('answer' in q)&&!('explanation' in q)));
 assert.deepEqual(visible.audits,[]);
 const state=(await ref.get()).data();state.members.find((m:any)=>m.id==='student1').active=false;await ref.set(state);
 await assert.rejects(student.call('readState'));
 console.log('PASS: real Auth, callable membership/roles, deny-all Rules, concurrent idempotency, privacy and revocation.');
}finally{await Promise.all(apps.map(deleteApp));await db.terminate();await admin.deleteApp(admin.getApp());}
