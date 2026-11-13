import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emptyClass} from '../src/roster';
import {accountLimitPaths,applyPrune,assertTarget,auditReceipts,captureSnapshot,firestoreTimestamp,loginLimitMaintenance,makeSnapshot,materializeState,mergeReceipts,planPrune,readSnapshot,restoreSnapshot,restoreState,storageLayout,validateSnapshot,validateState,writeSnapshot} from '../scripts/maintenance-core';
import {partitionState} from '../worker/state-repository';

const projectId='wooriban-2027',classId='maintenance-test';
const createdAt='2026-11-13T09:00:00.000Z',sourceUpdateTime='2026-11-13T08:59:00.123456789Z';
const meta={projectId,classId,createdAt,sourceUpdateTime,reason:'manual' as const};
function state(){return emptyClass({uid:'teacher-test',name:'Synthetic teacher'},[{uid:'student-test',studentNo:'01101',name:'Synthetic student',email:''}],2027,'Test class');}

test('backup validation checks corruption, format, project, class and exact domain tables',()=>{
 const snapshot=makeSnapshot(state(),meta);assert.deepEqual(validateSnapshot(snapshot,projectId,classId),snapshot);
 const corrupt=structuredClone(snapshot);corrupt.state.settings[0].year=2028;assert.throws(()=>validateSnapshot(corrupt,projectId,classId),/체크섬/);
 assert.throws(()=>validateSnapshot(snapshot,projectId,'another-class'),/대상/);
 assert.throws(()=>assertTarget('another-project',classId));assert.throws(()=>assertTarget(projectId,undefined as any));assert.throws(()=>assertTarget(projectId,'a/b'));
 assert.throws(()=>validateState({...state(),pinAccounts:[]}),/테이블/);
 assert.throws(()=>makeSnapshot(state(),{...meta,createdAt:'2026/11/13'}),/시간/);
 assert.throws(()=>makeSnapshot(state(),{...meta,sourceUpdateTime:'2026-99-13T09:00:00Z'}),/시간/);
});
test('backups reject non-JSON values, dangerous keys, invalid or duplicate member records and oversized state',()=>{
 const invalid=state();invalid.settings[0].bad=undefined;assert.throws(()=>validateState(invalid),/JSON/);
 const dangerous=JSON.parse(JSON.stringify(state()));dangerous.settings[0].constructor={prototype:{admin:true}};assert.throws(()=>validateState(dangerous),/필드/);
 const duplicate=state();duplicate.members.push({...duplicate.members[1]});assert.throws(()=>validateState(duplicate),/중복/);
 const noTeacher=state();noTeacher.members[0].active=false;assert.throws(()=>validateState(noTeacher),/계정/);
 const large=state();large.settings[0].value='x'.repeat(700001);assert.throws(()=>validateState(large),/700KB/);
});
test('restore keeps current membership permissions and command keys while recovering domain state',()=>{
 const original=state();original.notices.push({id:'old-notice',title:'Before'});
 original.audits.push({id:'teacher-test_before',actor:'teacher-test',action:'save',input:'{"before":true}',at:1});
 const snapshot=makeSnapshot(original,meta),current=state();
 current.members[1].active=false;current.members[1].delegations=['seat'];current.members[1].name='Updated synthetic name';
 current.audits.push(...original.audits,{id:'teacher-test_after',actor:'teacher-test',action:'points',input:'{"amount":10}',at:2});
 const result=restoreState(snapshot,current,100,'operation-test');
 assert.deepEqual(result.members,current.members);assert.deepEqual(result.notices,original.notices);
 assert.equal(result.audits.length,3);assert.ok(result.audits.some(a=>a.id==='teacher-test_after'));
 assert.equal(result.audits.at(-1)?.action,'maintenanceRestore');assert.equal(result.audits.at(-1)?.at,100);
 assert.deepEqual(snapshot.state,original);assert.equal(current.notices.length,0);
});
test('restore rejects changed account identity and conflicting historical request keys',()=>{
 const original=state();original.audits.push({id:'same',action:'points',input:'first'});const snapshot=makeSnapshot(original,meta);
 const other=state();other.members[1].id='another-student';assert.throws(()=>restoreState(snapshot,other),/명단/);
 const roleChanged=state();roleChanged.members[1].role='teacher';assert.throws(()=>restoreState(snapshot,roleChanged),/명단/);
 const conflict=state();conflict.audits.push({id:'same',action:'points',input:'changed'});assert.throws(()=>restoreState(snapshot,conflict),/요청 키/);
});
test('logical backup and restore preserve colliding legacy history IDs without merging different actors',()=>{
 const original=state();original.events=[{id:'collision',uid:'student-test',amount:1},{id:'collision',uid:'past-student',amount:2}];
 original.audits=[{id:'collision',actor:'first-actor',action:'points',input:'first',at:1},{id:'collision',actor:'second-actor',action:'points',input:'second',at:2}];
 const snapshot=makeSnapshot(original,meta),current=structuredClone(original);current.audits.push({id:'collision',actor:'third-actor',action:'points',input:'third',at:3});
 const restored=restoreState(snapshot,current,10,'preserve-collisions');assert.deepEqual(restored.events,original.events);assert.equal(restored.audits.length,4);assert.deepEqual(restored.audits.slice(0,3).map(row=>row.actor),['first-actor','second-actor','third-actor']);
 const partition=partitionState(restored,classId);assert.equal(partition.records.filter(row=>row.path.startsWith(`classes/${classId}/history_events/`)).length,2);
});
test('partitioned logical snapshots cover more than one legacy document and preserve all command receipts',()=>{
 const full=state();full.events=Array.from({length:1000},(_,i)=>({id:`event-${i}`,uid:'student-test',reason:'x'.repeat(1000)}));
 const data={actor:'teacher-test',key:'no-op-key',input:JSON.stringify({action:'preferences',p:{enabled:true}}),at:100};
 const receipt={id:createHash('sha256').update(JSON.stringify([data.actor,data.key])).digest('hex'),data};
 const snapshot=makeSnapshot(full,{...meta,layout:'partitioned-v1'},[receipt]);
 assert.ok(Buffer.byteLength(JSON.stringify(snapshot.state))>700000);assert.equal(validateSnapshot(snapshot,projectId,classId).state.events.length,1000);
 assert.deepEqual(mergeReceipts(snapshot.receipts,[receipt]),[receipt]);
 assert.throws(()=>mergeReceipts(snapshot.receipts,[{...receipt,data:{...data,input:'different'}}]),/영수증이 충돌/);
 assert.throws(()=>makeSnapshot(full,{...meta,layout:'partitioned-v1'},[{...receipt,id:'ab'.repeat(32)}]),/영수증 ID/);
});
function fakeDatabase(initial:Map<string,any>){
 const data=new Map([...initial].map(([path,value])=>[path,structuredClone(value)]));let version=1;
 const time=()=>({seconds:1800000000+version,nanoseconds:123456789});
 const document=(path:string,source=data)=>({path,id:path.split('/').at(-1)!,exists:source.has(path),data:()=>structuredClone(source.get(path)),updateTime:time()});
 class Query {constructor(readonly path:string,readonly size=Infinity,readonly after=''){}orderBy(field:string){assert.equal(field,'__name__');return this;}limit(size:number){return new Query(this.path,size,this.after);}startAfter(row:{path:string}){return new Query(this.path,this.size,row.path);}}
 const db:any={data,readOnlyTransactions:0,writeBatches:0,onBatchCommit:null,
  doc:(path:string)=>({path}),collection:(path:string)=>new Query(path),getAll:async(...refs:{path:string}[])=>refs.map(ref=>document(ref.path)),
  runTransaction:async(callback:(tx:any)=>Promise<any>,options?:{readOnly:boolean})=>{if(options?.readOnly)db.readOnlyTransactions++;const source=options?.readOnly?new Map(data):data;const writes:{path:string;value:any}[]=[];
   const result=await callback({get:async(ref:any)=>{if(ref instanceof Query){const paths=[...source.keys()].filter(path=>path.startsWith(ref.path+'/')&&!path.slice(ref.path.length+1).includes('/')&&path>ref.after).sort().slice(0,ref.size);return {docs:paths.map(path=>document(path,source))};}return document(ref.path,source);},set:(ref:{path:string},value:any)=>{assert.ok(!options?.readOnly);writes.push({path:ref.path,value});}});
   for(const write of writes)data.set(write.path,structuredClone(write.value));if(writes.length)version++;return result;
  },
  batch:()=>{const creates:{path:string;value:any}[]=[];return {create:(ref:{path:string},value:any)=>creates.push({path:ref.path,value}),commit:async()=>{assert.ok(creates.length<=400);for(const row of creates)if(data.has(row.path))throw Error('ALREADY_EXISTS');for(const row of creates)data.set(row.path,structuredClone(row.value));db.writeBatches++;if(db.onBatchCommit)db.onBatchCommit(()=>{version++;});}};}
 };return db;
}
test('partition backup captures every primary history page and legacy receipt in one readonly snapshot',async()=>{
 const full=state();full.events=Array.from({length:1001},(_,i)=>({id:`event-${i}`,uid:'student-test',reason:'x'.repeat(800),at:i}));
 full.audits.push({id:'teacher-test_old-key',actor:'teacher-test',action:'points',input:'{"action":"points","p":{"amount":10}}',at:10});
 const partition=partitionState(full,classId,0,'test-generation'),docs=new Map(partition.records.map(row=>[row.path,row.value]));docs.set(`classes/${classId}/private/state`,partition.main);
 const db=fakeDatabase(docs),captured=await captureSnapshot(db,{projectId,classId,createdAt,reason:'manual'});
 assert.equal(db.readOnlyTransactions,1);assert.equal(db.writeBatches,0);assert.equal(captured.snapshot.layout,'partitioned-v1');assert.equal(captured.snapshot.state.events.length,1001);
 assert.deepEqual(captured.snapshot.state.events.map(row=>row.id).sort(),full.events.map(row=>row.id).sort());assert.equal(captured.snapshot.receipts.length,1);assert.ok(!('_storage'in captured.snapshot.state));
 const broken=structuredClone(partition.main);broken._storage!.counts.events++;assert.throws(()=>materializeState(broken,{events:full.events,audits:full.audits}),/개수가/);
 assert.equal(storageLayout(partition.main).generation,'test-generation');
});
test('partition restore stages immutable generations, preserves receipts and switches only by final state CAS',async()=>{
 const original=state();original.events.push({id:'before',uid:'student-test',at:1});original.audits.push({id:'teacher-test_old',actor:'teacher-test',action:'points',input:'old-input',at:1});
 const saved=makeSnapshot(original,meta,auditReceipts(original)),live=structuredClone(original);live.events.push({id:'after',uid:'student-test',at:2});live.members[1].notifications={enabled:false};live.audits.push({id:'12_teacher-test_new',actor:'teacher-test',action:'points',input:'new-input',at:2});
 const partition=partitionState(live,classId,0,'live-generation'),docs=new Map(partition.records.map(row=>[row.path,row.value]));docs.set(`classes/${classId}/private/state`,partition.main);const db=fakeDatabase(docs);
 const current=await captureSnapshot(db,{projectId,classId,createdAt,reason:'before-restore'});const result=await restoreSnapshot(db,saved,current.snapshot,current.source,current.snapshot.sourceUpdateTime,100,'test-restore');
 const restored=await captureSnapshot(db,{projectId,classId,createdAt,reason:'manual'});
 assert.equal(result.generation,'restore_testrestore');assert.deepEqual(restored.snapshot.state.events.map(row=>row.id),['before']);assert.deepEqual(restored.snapshot.state.members,live.members);assert.equal(restored.snapshot.receipts.length,2);
 assert.ok(db.data.has(partition.records[0].path),'old generation remains for recovery');assert.ok(restored.snapshot.state.audits.some(row=>row.action==='maintenanceRestore'));
 const dbConflict=fakeDatabase(docs),captured=await captureSnapshot(dbConflict,{projectId,classId,createdAt,reason:'before-restore'});let changed=false;
 dbConflict.onBatchCommit=(bump:()=>void)=>{if(changed)return;changed=true;const path=`classes/${classId}/private/state`,current=dbConflict.data.get(path);current.members[1].notifications={enabled:true};dbConflict.data.set(path,current);bump();};
 await assert.rejects(restoreSnapshot(dbConflict,saved,captured.snapshot,captured.source,captured.snapshot.sourceUpdateTime,100,'racing-restore'),/활성화를 중단/);
 assert.equal(storageLayout(dbConflict.data.get(`classes/${classId}/private/state`)).generation,'live-generation');assert.equal(dbConflict.data.get(`classes/${classId}/private/state`).members[1].notifications.enabled,true);
});
test('private backup files are immutable, 600 and checked before use; links and public files are refused',()=>{
 const dir=mkdtempSync(join(tmpdir(),'class-backup-test-'));
 try{
  const snapshot=makeSnapshot(state(),meta),first=writeSnapshot(dir,snapshot),second=writeSnapshot(dir,snapshot);
  assert.notEqual(first,second);assert.equal(statSync(first).mode&0o777,0o600);assert.deepEqual(readSnapshot(first,projectId,classId),snapshot);
  assert.equal(JSON.parse(readFileSync(first,'utf8')).state.members.length,2);
  chmodSync(first,0o644);assert.throws(()=>readSnapshot(first,projectId,classId),/비공개/);chmodSync(first,0o600);
  const link=join(dir,'link');symlinkSync(first,link);assert.throws(()=>readSnapshot(link,projectId,classId));
  chmodSync(dir,0o755);assert.throws(()=>writeSnapshot(dir,snapshot),/비공개/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('local retention keeps recent and newest backups, ignores unrelated files and rechecks plan integrity',()=>{
 const dir=mkdtempSync(join(tmpdir(),'class-retention-test-')),now=Date.parse(createdAt);
 try{
  const snapshots=[];
  for(const age of [1,10,40,60])snapshots.push(writeSnapshot(dir,makeSnapshot(state(),{...meta,createdAt:new Date(now-age*86400000).toISOString()})));
  const unrelated=join(dir,'student-login-codes.private.json');writeFileSync(unrelated,'never inspect or delete',{mode:0o600});
  const plan=planPrune(dir,projectId,classId,2,30,now);assert.equal(plan.length,2);
  const changed=JSON.parse(readFileSync(plan[0].path,'utf8'));changed.state.settings[0].year=2028;writeFileSync(plan[0].path,JSON.stringify(changed));
  assert.throws(()=>applyPrune(plan,projectId,classId),/체크섬/);
  writeFileSync(plan[0].path,JSON.stringify(makeSnapshot(state(),{...meta,createdAt:plan[0].createdAt})));
  assert.equal(applyPrune(plan,projectId,classId),2);
  assert.equal(readFileSync(unrelated,'utf8'),'never inspect or delete');
  assert.equal(planPrune(dir,projectId,classId,2,30,now).length,0);
  assert.throws(()=>planPrune(dir,projectId,classId,1,30,now),/최소/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('login limit cleanup is class-scoped, migrates numeric expiry and never removes a live rate window',()=>{
 const known=state(),now=2000000;
 const paths=accountLimitPaths(known,classId);assert.equal(paths.length,1);assert.match(paths[0],/^loginLimits\/account_[a-f0-9]{64}$/);
 assert.notEqual(paths[0],accountLimitPaths(known,'other-class')[0]);assert.ok(paths.every(p=>!p.includes('ip_')));
 assert.deepEqual(loginLimitMaintenance({start:now-100,count:5,expiresAt:now+86400000},now),{action:'migrate',expiresAt:now+86400000});
 assert.deepEqual(loginLimitMaintenance({start:now-100,count:5,expiresAt:now-1000},now),{action:'migrate',expiresAt:now-1000},'Even an inconsistent past expiry must not erase an active window');
 assert.deepEqual(loginLimitMaintenance({start:now-1000000,count:5,expiresAt:now-1000},now),{action:'delete'});
 assert.deepEqual(loginLimitMaintenance({start:now-100,count:5,expiresAt:new Date(now+86400000)},now),{action:'none'});
 assert.deepEqual(loginLimitMaintenance({start:now-100,count:5,expiresAt:{toMillis:()=>now+86400000}},now),{action:'none'});
 for(const value of [{start:now-100,count:5},{start:'bad',count:5,expiresAt:1},{start:1,count:-1,expiresAt:1},{start:1,count:1,expiresAt:Infinity}])assert.equal(loginLimitMaintenance(value,now).action,'none');
});
