import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportPKCS8} from 'jose';
import {command,visible,type State} from '../src/domain';
import {seed} from '../src/seed';
import {loginStudentNumbers} from '../src/login-options';
import {digest,pinPassword} from '../worker/credentials';
import {Store,Conflict,encode,type Document} from '../worker/store';
import {StateRepository,HISTORY_TABLES,type Write} from '../worker/state-repository';
import worker from '../worker/index';

const classId='profile-test',statePath=`classes/${classId}/private/state`;
const pinPath=async(studentNo:string)=>`classes/${classId}/pinAccounts/${await digest(classId+':'+studentNo)}`;
const payload=(name='바뀐 이름',studentNo='01101',previousStudentNo='01101',version=1)=>({uid:'student1',name,studentNo,previousStudentNo,version});
function state(){const value=seed();for(const table of HISTORY_TABLES)value[table]=[];value.members=value.members.filter(member=>['teacher','student1','student2'].includes(member.id));return value;}
class MemoryStore extends Store {
 docs=new Map<string,Document>();reads:string[]=[];commits:Write[][]=[];sequence=0;beforeCommit:((writes:Write[])=>void)|null=null;
 constructor(){super('demo-profile-project',async()=>'synthetic-only');this.set(statePath,state());}
 set(path:string,value:unknown){this.docs.set(path,{name:`${this.base.slice(this.base.indexOf('projects/'))}/${path}`,fields:encode(value).mapValue.fields,updateTime:String(++this.sequence)});}
 read(path:string){return this.value(this.docs.get(path)||null);}
 main(){return this.read(statePath) as State;}
 override async get(path:string){this.reads.push(path);return structuredClone(this.docs.get(path)||null);}
 override async getMany(paths:string[]){return Promise.all(paths.map(path=>this.get(path)));}
 override async put(writes:Write[]){
  const hook=this.beforeCommit;this.beforeCommit=null;hook?.(writes);
  for(const write of writes){const existing=this.docs.get(write.path);if(write.previous?existing?.updateTime!==write.previous.updateTime:!!existing)throw new Conflict();}
  for(const write of writes)this.set(write.path,write.value);this.commits.push(structuredClone(writes));
 }
 override async request(url:string){assert.ok(url.endsWith(':runQuery'),'No Auth, PIN, or other real service calls are allowed');return Response.json([]);}
 credentialReads(){return this.reads.filter(path=>path.includes('/pinAccounts/'));}
 auditRecords(){return [...this.docs.entries()].filter(([path])=>path.includes('/history_audits/')).map(([,document])=>this.value(document).record);}
}
async function fixture(){
 const store=new MemoryStore();const account={uid:'student1',studentNo:'01101',active:true,scheme:'firebase-password-v1',salt:'a'.repeat(32),authEmail:'student1@students.wooriban-2027.invalid',version:1,createdAt:100};
 store.set(await pinPath('01101'),account);return {store,account,repository:new StateRepository(store,classId)};
}

test('profile edits require a teacher, keep leading zeros and trim names without touching account identity',()=>{
 const value=state(),old=structuredClone(value.members.find(member=>member.id==='student1')!);
 command(value,'teacher','memberProfile',payload('  새 이름  ','00101'),'profile');
 const updated=value.members.find(member=>member.id==='student1')!;
 assert.equal(updated.name,'새 이름');assert.equal(updated.studentNo,'00101');assert.equal(updated.profileVersion,2);
 assert.equal(updated.id,old.id);assert.equal(updated.active,old.active);assert.deepEqual(updated.delegations,old.delegations);
 for(const actor of ['student1','student2','outsider'])assert.throws(()=>command(state(),actor,'memberProfile',payload(),'forbidden'),/교사|활성 학급/);
 assert.throws(()=>command(state(),'teacher','memberProfile',{...payload(),uid:'teacher'},'teacher-target'),/학생이 없습니다/);
});

test('profile schema rejects passwords, role injection, numeric student numbers and stale snapshots before mutation',()=>{
 const invalid=[{...payload(),pin:'1234'},{...payload(),password:'1234'},{...payload(),role:'teacher'},{...payload(),studentNo:101},{...payload(),studentNo:' 01101'},{...payload(),name:' '},{...payload(),version:0},{...payload(),version:2},{...payload(),previousStudentNo:'09999'}];
 for(const input of invalid){const value=state(),before=structuredClone(value);assert.throws(()=>command(value,'teacher','memberProfile',input,'invalid'));assert.deepEqual(value,before);}
 const inactive=state();inactive.members.push({id:'inactive',name:'비활성',studentNo:'00999',role:'student',active:false});
 assert.throws(()=>command(inactive,'teacher','memberProfile',payload('이름','00999'),'duplicate'),/비활성/);
});

test('a name-only update performs zero credential reads and preserves every login field',async()=>{
 const {store,account,repository}=await fixture();const old=structuredClone(store.main().plans);
 await repository.execute('teacher','memberProfile',payload('  이름만 수정  '),'name');
 assert.equal(store.main().members.find(member=>member.id==='student1')?.name,'이름만 수정');assert.equal(store.credentialReads().length,0);
 assert.deepEqual(store.read(await pinPath('01101')),account);assert.deepEqual(store.main().plans,old);
 assert.equal(store.main().members.find(member=>member.id==='student1')?.studentNo,'01101');
});

test('student number rename atomically preserves UID, salt and Auth password derivation and retires old login',async()=>{
 const {store,account,repository}=await fixture();const oldPath=await pinPath('01101'),nextPath=await pinPath('00101');
 const oldPassword=await pinPassword('2468','synthetic-pepper-'.repeat(3),account.salt);
 await repository.execute('teacher','memberProfile',payload('새 이름','00101'),'rename',12345);
 assert.equal(store.commits.length,1);assert.ok(store.commits[0].some(write=>write.path===statePath));assert.ok(store.commits[0].some(write=>write.path===oldPath));assert.ok(store.commits[0].some(write=>write.path===nextPath));
 const next=store.read(nextPath),old=store.read(oldPath);assert.equal(next.uid,account.uid);assert.equal(next.salt,account.salt);assert.equal(next.authEmail,account.authEmail);assert.equal(next.scheme,account.scheme);assert.equal(next.active,true);assert.equal(next.version,2);
 assert.equal(await pinPassword('2468','synthetic-pepper-'.repeat(3),next.salt),oldPassword);
 assert.deepEqual(Object.keys(old).sort(),['active','scheme','studentNo','uid','updatedAt','version']);assert.equal(old.active,false);assert.equal(old.scheme,'student-number-retired-v1');
 assert.deepEqual(loginStudentNumbers(store.main().members),['00101','01102']);
 const audit=JSON.stringify(store.auditRecords());assert.match(audit,/memberProfile/);assert.doesNotMatch(audit,/authEmail|salt|firebase-password-v1|2468|synthetic-pepper/);
});

test('unauthorized, stale and duplicate membership edits do not read credentials or commit',async()=>{
 for(const [actor,input] of [['student1',payload('이름','00101')],['teacher',payload('이름','00101','09999')],['teacher',payload('이름','00101','01101',2)],['teacher',payload('이름','01102')]] as const){
  const {store,repository}=await fixture();await assert.rejects(repository.execute(actor,'memberProfile',input,'reject'));
  assert.equal(store.credentialReads().length,0);assert.equal(store.commits.length,0);
 }
});

test('profile retry returns its receipt without rereading credentials or duplicating a rename',async()=>{
 const {store,repository}=await fixture(),input=payload('이름','00101');await repository.execute('teacher','memberProfile',input,'same');
 store.reads=[];const result=await repository.execute('teacher','memberProfile',input,'same');assert.equal(result.duplicate,true);assert.equal(store.credentialReads().length,0);assert.equal(store.commits.length,1);
 await assert.rejects(repository.execute('teacher','memberProfile',{...input,name:'다름'},'same'),/동일 요청/);
});

test('active mappings, foreign tombstones and malformed own tombstones cannot be claimed',async()=>{
 const destinations=[
  {uid:'other',studentNo:'00101',active:true,scheme:'firebase-password-v1'},
  {uid:'other',studentNo:'00101',active:false,scheme:'student-number-retired-v1',version:2,updatedAt:1},
  {uid:'student1',studentNo:'00101',active:false,scheme:'student-number-retired-v1',version:2,updatedAt:1,salt:'unexpected'},
  {uid:'student1',studentNo:'00101',active:false,scheme:'student-number-retired-v1',version:2,updatedAt:'bad'},
  {uid:'student1',studentNo:'00101',active:false,scheme:'firebase-password-v1',version:2,updatedAt:1}
 ];
 for(const destination of destinations){const {store,repository}=await fixture();store.set(await pinPath('00101'),destination);const before=structuredClone(store.main());await assert.rejects(repository.execute('teacher','memberProfile',payload('이름','00101'),'collision'),/학번/);assert.deepEqual(store.main(),before);assert.equal(store.commits.length,0);}
});

test('the same student can correct a typo back to an exact own retired mapping without resetting a PIN',async()=>{
 const {store,account,repository}=await fixture();await repository.execute('teacher','memberProfile',payload('이름','00101'),'rename');
 await repository.execute('teacher','memberProfile',payload('원래 학번','01101','00101',2),'revert');
 const restored=store.read(await pinPath('01101'));assert.equal(restored.uid,account.uid);assert.equal(restored.salt,account.salt);assert.equal(restored.authEmail,account.authEmail);assert.equal(restored.active,true);assert.equal(restored.version,3);
 assert.equal(store.read(await pinPath('00101')).active,false);assert.equal(store.main().members.find(member=>member.id==='student1')?.profileVersion,3);assert.equal(store.commits.length,2);
});

test('credential and destination CAS conflicts cannot partially rename the class profile',async()=>{
 const first=await fixture(),destination=await pinPath('00101');
 first.store.beforeCommit=()=>{first.store.set(destination,{uid:'other',studentNo:'00101',active:true});};
 await assert.rejects(first.repository.execute('teacher','memberProfile',payload('이름','00101'),'race-destination'),/학번/);
 assert.equal(first.store.main().members.find(member=>member.id==='student1')?.studentNo,'01101');assert.equal(first.store.read(await pinPath('01101')).active,true);assert.equal(first.store.commits.length,0);
 const second=await fixture(),oldPath=await pinPath('01101');second.store.beforeCommit=()=>{second.store.set(oldPath,{...second.account,uid:'other'});};
 await assert.rejects(second.repository.execute('teacher','memberProfile',payload('이름','00101'),'race-source'),/로그인 정보/);
 assert.equal(second.store.main().members.find(member=>member.id==='student1')?.studentNo,'01101');assert.equal(second.store.read(destination),null);assert.equal(second.store.commits.length,0);
});

test('state CAS detects a newer teacher profile edit without overwriting it',async()=>{
 const {store,repository}=await fixture();store.beforeCommit=()=>{const next=structuredClone(store.main());Object.assign(next.members.find(member=>member.id==='student1')!,{name:'먼저 저장한 이름',profileVersion:2});store.set(statePath,next);};
 await assert.rejects(repository.execute('teacher','memberProfile',payload('늦은 이름','00101'),'race-profile'),/학생정보가 변경/);
 assert.equal(store.main().members.find(member=>member.id==='student1')?.name,'먼저 저장한 이름');assert.equal(store.read(await pinPath('00101')),null);assert.equal(store.commits.length,0);
});

test('profile mapping plan composes with existing extra writes in the same commit',async()=>{
 const {store,repository}=await fixture(),path=`classes/${classId}/private/syntheticControl`;store.set(path,{count:1});let called=0;
 await repository.execute('teacher','memberProfile',payload('이름','00101'),'composed',Date.now(),{extraPaths:[path],plan:context=>{called++;assert.ok(context.writeCapacity>=1);return {writes:[{path,value:{count:2},previous:context.docs.get(path)!}]};}});
 assert.equal(called,1);assert.equal(store.read(path).count,2);assert.equal(store.commits.length,1);assert.ok(store.commits[0].some(write=>write.path===path));
});


test('member response DTOs exclude injected secret fields for teachers, self and classmates',()=>{
 const source=state();Object.assign(source.members.find(member=>member.id==='student1')!,{salt:'do-not-return',authEmail:'private@example.invalid',pin:'do-not-return',password:'do-not-return',profileVersion:3,notifications:{enabled:true,salt:'do-not-return'}});
 for(const viewer of ['teacher','student1','student2']){const exposed=visible(source,viewer).members.find(member=>member.id==='student1')!;assert.doesNotMatch(JSON.stringify(exposed),/do-not-return|private@example/);if(viewer!=='student2'){assert.equal(exposed.studentNo,'01101');assert.equal(exposed.profileVersion,3);}else assert.equal(exposed.studentNo,undefined);}
});

test('retired or malformed PIN mappings return a safe 401 before any password verification request',async()=>{
 const original=globalThis.fetch,{privateKey}=await generateKeyPair('RS256',{extractable:true});const project='demo-retired-profile',prefix=`projects/${project}/databases/(default)/documents/`,docs=new Map<string,any>();let sequence=0,verificationCalls=0;
 const oldPath=await pinPath('01101');docs.set(prefix+oldPath,{fields:encode({uid:'student1',studentNo:'01101',active:false,scheme:'student-number-retired-v1',version:2,updatedAt:1}).mapValue.fields,updateTime:'0'});
 globalThis.fetch=async(input,init)=>{
  const url=String(input);if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-oauth',expires_in:3600});
  if(url.includes('accounts:signInWithPassword')){verificationCalls++;throw Error('Tombstones must not reach password verification');}
  if(url.endsWith(':batchGet')){const names=JSON.parse(String(init?.body)).documents;return Response.json(names.map((name:string)=>docs.has(name)?{found:{name,...docs.get(name)}}:{missing:name}));}
  if(url.endsWith(':commit')){for(const write of JSON.parse(String(init?.body)).writes)docs.set(write.update.name,{fields:write.update.fields,updateTime:String(++sequence)});return Response.json({});}
  if(url.startsWith('https://firestore.googleapis.com/')){const name=url.slice(url.indexOf('projects/'));return docs.has(name)?Response.json({name,...docs.get(name)}):new Response('{}',{status:404});}
  throw Error('Unexpected synthetic request');
 };
 try{
  const env={FIREBASE_PROJECT_ID:project,CLASS_ID:classId,ALLOWED_ORIGINS:'https://fixture.example',FIREBASE_WEB_API_KEY:'synthetic-key',FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:project,client_email:'synthetic-profile@example.invalid',private_key:await exportPKCS8(privateKey)}),STUDENT_PIN_PEPPER:'synthetic-only-pepper-'.repeat(3)};
  const response=await worker.fetch(new Request('https://fixture.example/studentLogin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({classId,studentNo:'01101',pin:'2468'})}),env);
  assert.equal(response.status,401);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(await response.json(),{error:'학번 또는 비밀번호가 일치하지 않습니다.'});assert.equal(verificationCalls,0);
 }finally{globalThis.fetch=original;}
});
