import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../src/seed';
import {balance,kstDate,type State} from '../src/domain';
import {Store,Conflict,encode,decode,type Document} from '../worker/store';
import {HISTORY_TABLES,StateRepository,partitionState,type Write} from '../worker/state-repository';

class MemoryStore extends Store {
 docs=new Map<string,Document>();queries:string[]=[];version=0;conflicts=0;commits=0;
 constructor(state:State){super('demo-class-portal',async()=>'test-only');this.set('classes/test/private/state',state);}
 set(path:string,value:unknown){const document={name:`projects/demo-class-portal/databases/(default)/documents/${path}`,fields:encode(value).mapValue.fields,updateTime:String(++this.version)};this.docs.set(path,document);}
 override async get(path:string){return structuredClone(this.docs.get(path)||null);}
 override async getMany(paths:string[]){return Promise.all(paths.map(path=>this.get(path)));}
 override async put(writes:Write[]){
  if(this.conflicts>0){this.conflicts--;throw new Conflict();}
  for(const write of writes){const current=this.docs.get(write.path);if(write.previous?current?.updateTime!==write.previous.updateTime:!!current)throw new Conflict();}
  for(const write of writes)this.set(write.path,write.value);this.commits++;
 }
 override async request(url:string,init:RequestInit={}){
  assert.ok(url.endsWith(':runQuery'));const parent=url.slice(this.base.length+1,-':runQuery'.length),q=JSON.parse(String(init.body)).structuredQuery;
  const collection=`${parent}/${q.from[0].collectionId}/`;this.queries.push(collection);let documents=[...this.docs.entries()].filter(([path])=>path.startsWith(collection)&&!path.slice(collection.length).includes('/')).map(([,doc])=>doc);
  const field=(doc:Document,path:string)=>path==='__name__'?doc.name:path.split('.').reduce((v:any,k)=>v?.[k],this.value(doc));
  const compare=(a:Document,b:Document)=>{for(const order of q.orderBy){const av=field(a,order.field.fieldPath),bv=field(b,order.field.fieldPath);if(av===bv)continue;const n=av>bv?1:-1;return order.direction==='DESCENDING'?-n:n;}return 0;};
  if(q.where){const f=q.where.fieldFilter,v=decode(f.value);documents=documents.filter(doc=>{const actual=field(doc,f.field.fieldPath);return f.op==='EQUAL'?actual===v:f.op==='GREATER_THAN'?actual>v:f.op==='GREATER_THAN_OR_EQUAL'?actual>=v:f.op==='IN'?v.includes(actual):false;});}
  documents.sort(compare);
  if(q.startAt){const values=q.startAt.values.map((v:any)=>'referenceValue'in v?v.referenceValue:decode(v));documents=documents.filter(doc=>{for(let i=0;i<q.orderBy.length;i++){const actual=field(doc,q.orderBy[i].field.fieldPath);if(actual===values[i])continue;return q.orderBy[i].direction==='DESCENDING'?actual<values[i]:actual>values[i];}return false;});}
  return Response.json(documents.slice(0,q.limit).map(document=>({document})));
 }
 main(){return this.value(this.docs.get('classes/test/private/state')!) as State&{_storage:any};}
 records(table:string){return [...this.docs.entries()].filter(([path])=>path.startsWith(`classes/test/history_${table}/`)).map(([,doc])=>this.value(doc).record);}
}
const simple=()=>{const state=seed();for(const table of HISTORY_TABLES)state[table]=[];return state;};

test('repository atomically migrates bounded legacy rows and preserves old/new idempotency',async()=>{
 const state=simple();state.audits=Array.from({length:175},(_,i)=>({id:`student1_legacy${i}`,actor:'student1',action:'preferences',input:JSON.stringify({action:'preferences',p:{enabled:true}}),at:i+1}));const store=new MemoryStore(state),repository=new StateRepository(store,'test');store.conflicts=1;
 const first=await repository.execute('student1','preferences',{enabled:false},'new',Date.now());assert.equal(first.migrated,80);assert.equal(store.main().audits.length,95);assert.equal(store.records('audits').length,81);
 const committed=store.commits;assert.equal((await repository.execute('student1','preferences',{enabled:false},'new')).duplicate,true);assert.equal(store.commits,committed);
 assert.equal((await repository.execute('student1','preferences',{enabled:true},'legacy0')).duplicate,true);await assert.rejects(repository.execute('student1','preferences',{enabled:false},'legacy0'),/동일 요청/);
 await repository.execute('student1','preferences',{enabled:true},'next');await repository.execute('student1','preferences',{enabled:false},'last');assert.equal(store.main().audits.length,0);assert.equal(store.records('audits').length,178);
 assert.equal(store.records('audits').filter(r=>String(r.id).startsWith('student1_legacy')).length,175);
});

test('repository partitions sixty days of eighteen student quiz awards without dropping history',async()=>{
 const state=simple();state.members=[{id:'teacher',role:'teacher',active:true,name:'Teacher'},...Array.from({length:18},(_,i)=>({id:`student${i}`,role:'student',active:true,name:`Student ${i}`,studentNo:String(i+1).padStart(5,'0')}))];state.quizzes=[];const store=new MemoryStore(state),repository=new StateRepository(store,'test');const today=Date.now();let maximum=0;
 for(let day=0;day<60;day++){const now=today-(59-day)*86400000,date=kstDate(now);await repository.execute('teacher','save',{table:'quizzes',id:'q'+day,data:{date,question:'Question',options:['One','Two','Three','Four'],answer:1,explanation:'Explanation',active:true}},'quiz'+day,now);for(let student=0;student<18;student++){await repository.execute(`student${student}`,'quiz',{choice:1,version:1},`answer${day}`,now);maximum=Math.max(maximum,Buffer.byteLength(JSON.stringify(store.main())));}}
 assert.ok(maximum<150000,`main state grew to ${maximum}`);assert.equal(store.records('attempts').length,1080);assert.equal(store.records('lots').length,1080);assert.equal(store.records('events').length,1080);assert.equal(store.records('inbox').length,1080);
 store.queries=[];const student=await repository.readState('student0');assert.ok(!store.queries.some(q=>/history_(lots|events|inbox|payouts|audits)/.test(q)));assert.equal(balance(student,'student0').available,600);assert.equal(student.history.counts.attempts,60);assert.equal(student.history.unreadInbox,60);assert.ok(student.inbox.length<=50);assert.equal((student as any)._storage,undefined);assert.ok(!JSON.stringify(student.history).includes('student1'));
 const history=await repository.listHistory('student0','attempts',null,50);assert.equal(history.records.length,50);assert.ok(history.cursor);const second=await repository.listHistory('student0','attempts',history.cursor,50);assert.equal(second.records.length,10);assert.equal(new Set([...history.records,...second.records].map(r=>r.historyId)).size,60);
});

test('archived inbox read is owned, atomic, and reflected in complete unread total',async()=>{
 const state=simple();state.inbox=[{id:'old',uid:'student1',title:'Message',body:'Body',at:1,read:false}];const store=new MemoryStore(state),repository=new StateRepository(store,'test');await repository.execute('student1','preferences',{enabled:false},'migrate');const page=await repository.listHistory('student1','inbox');const id=page.records[0].id;assert.match(id,/^archive_/);await assert.rejects(repository.execute('student2','read',{id},'forbidden'),/알림/);assert.equal((await repository.readState('student1')).history.unreadInbox,1);await repository.execute('student1','read',{id},'read');assert.equal((await repository.readState('student1')).history.unreadInbox,0);assert.equal(store.records('inbox')[0].id,'old');assert.equal(store.records('inbox')[0].read,true);
});

test('archived payout markers prevent duplicate grants after expired lots leave main state',async()=>{
 const state=simple();state.roles=[{id:'role',name:'Role',points:10,uids:['student1'],active:true}];const store=new MemoryStore(state),repository=new StateRepository(store,'test');const now=Date.now()-200*86400000;await repository.execute('teacher','payout',{month:'2026-01'},'first',now);assert.equal(store.records('lots').length,1);await repository.execute('teacher','payout',{month:'2026-01'},'second',Date.now());assert.equal(store.records('lots').length,1);assert.equal(store.records('payouts').length,1);
});

test('expired reserved lot remains available for archived request completion',async()=>{
 const state=simple(),now=Date.now();state.lots=[{id:'lot',uid:'student1',total:10,available:0,reserved:10,spent:0,expired:0,acquiredAt:1,expiresAt:2}];state.requests=[{id:'request',uid:'student1',status:'pending',version:1,price:10,name:'Item',at:1,allocations:[{lotId:'lot',amount:10}]}];const store=new MemoryStore(state),repository=new StateRepository(store,'test');await repository.execute('student1','preferences',{enabled:false},'migrate');await repository.execute('teacher','requestStatus',{id:'request',status:'approved',version:1,reason:''},'approve',now);assert.equal(store.records('lots')[0].reserved,0);assert.equal(store.records('lots')[0].spent,10);assert.equal(store.records('requests')[0].status,'approved');
});

test('partition restore helper preserves every raw row and history survives class writes and rejects foreign or switched-generation cursors',async()=>{
 const state=simple();state.events=Array.from({length:3},(_,i)=>({id:`event${i}`,uid:'student1',type:'grant',amount:1,reason:'Reason',at:i}));const partitioned=partitionState(state,'test');assert.equal(partitioned.records.length,6);assert.deepEqual(partitioned.records.filter(r=>r.path.startsWith('classes/test/history_events/')).map(r=>(r.value as any).record),state.events);const store=new MemoryStore(partitioned.main);for(const row of partitioned.records)store.set(row.path,row.value);const repository=new StateRepository(store,'test');const page=await repository.listHistory('student1','events',null,1);assert.ok(page.cursor);await assert.rejects(repository.listHistory('student2','events',page.cursor),/기록이 변경/);await assert.rejects(repository.listHistory('student1','audits'),/권한/);await repository.execute('student1','preferences',{enabled:false},'change');assert.equal((await repository.listHistory('student1','events',page.cursor)).records.length,2);const restored=partitionState(state,'test',100,'restore_new');for(const row of restored.records)store.set(row.path,row.value);assert.equal((await repository.listHistory('student1','events',page.cursor)).records.length,2);store.set('classes/test/private/state',restored.main);await assert.rejects(repository.listHistory('student1','events',page.cursor),/기록이 변경/);assert.equal((await repository.listHistory('student1','events')).records.length,3);
});


test('legacy colliding raw row IDs are archived without replacing either record',async()=>{
 const state=simple();state.events=[{id:'same',uid:'student1',at:1,amount:1,reason:'First'},{id:'same',uid:'student2',at:2,amount:2,reason:'Second'}];const store=new MemoryStore(state),repository=new StateRepository(store,'test');await repository.execute('student1','preferences',{enabled:false},'migrate');assert.deepEqual(store.records('events'),state.events);assert.equal((await repository.listHistory('teacher','events')).records.length,2);
});

test('member write budgets reset after a minute and idempotent retries do not spend budget',async()=>{
 const store=new MemoryStore(simple()),repository=new StateRepository(store,'test'),now=Date.now();for(let i=0;i<30;i++)await repository.execute('student1','preferences',{enabled:!!(i%2)},'toggle'+i,now);await assert.rejects(repository.execute('student1','preferences',{enabled:false},'excess',now),/1분/);assert.equal((await repository.execute('student1','preferences',{enabled:false},'toggle0',now)).duplicate,true);await repository.execute('student1','preferences',{enabled:false},'reset',now+60000);
});

test('a supported sixty-student monthly payout fits one atomic commit',async()=>{
 const state=simple();state.members=[{id:'teacher',name:'Teacher',role:'teacher',active:true},...Array.from({length:60},(_,i)=>({id:'student'+i,name:'Student '+i,studentNo:String(i+1),role:'student',active:true}))];state.roles=[{id:'role',name:'Role',points:10,uids:state.members.filter(m=>m.role==='student').map(m=>m.id),active:true}];const store=new MemoryStore(state),repository=new StateRepository(store,'test');await repository.execute('teacher','payout',{month:'2026-11'},'pay');assert.equal(store.records('lots').length,60);assert.equal(store.records('payouts').length,60);assert.equal(store.commits,1);
});


test('a year of expiry buckets shrinks to current balances without deleting historical lots',async()=>{
 const state=simple(),now=Date.now();state.members=[{id:'teacher',name:'Teacher',role:'teacher',active:true},...Array.from({length:18},(_,i)=>({id:'student'+i,name:'Student '+i,studentNo:String(i+1),role:'student',active:true}))];for(let day=0;day<365;day++)for(let student=0;student<18;student++){const acquiredAt=now-(364-day)*86400000;state.lots.push({id:`lot_${day}_${student}`,uid:'student'+student,total:10,available:10,reserved:0,spent:0,expired:0,acquiredAt,expiresAt:acquiredAt+90*86400000});}const partitioned=partitionState(state,'test',0,'year');const store=new MemoryStore(partitioned.main);for(const row of partitioned.records)store.set(row.path,row.value);const repository=new StateRepository(store,'test');await repository.execute('student0','preferences',{enabled:false},'prune',now);assert.equal(store.main()._storage.counts.lots,6570);assert.ok(Buffer.byteLength(JSON.stringify(store.main()))<150000);assert.ok(Object.keys(store.main()._storage.balances.student0).length<=90);const student=await repository.readState('student0');assert.equal(balance(student,'student0',now).available,900);
});

test('partitioned quiz definitions preserve daily answers privately and notices remain active-only',async()=>{
 const store=new MemoryStore(simple()),repository=new StateRepository(store,'test'),now=Date.now();await repository.execute('teacher','save',{table:'quizzes',id:'question',data:{date:kstDate(now),question:'Q',options:['A','B','C','D'],answer:1,explanation:'Secret',active:true}},'question',now);await repository.execute('teacher','save',{table:'notices',id:'visible',data:{title:'Visible',body:'Body',important:false,active:true}},'notice1',now);await repository.execute('teacher','save',{table:'notices',id:'hidden',data:{title:'Hidden',body:'Body',important:false,active:false}},'notice2',now);assert.equal(store.main().quizzes.length,0);assert.equal(store.main().notices.length,0);const student=await repository.readState('student1');assert.equal(student.quizzes.length,1);assert.equal(student.quizzes[0].answer,undefined);assert.equal(student.quizzes[0].explanation,undefined);assert.deepEqual(student.notices.map(n=>n.title),['Visible']);assert.equal(student.history.counts.notices,1);assert.equal((await repository.listHistory('student1','notices')).records.length,1);await assert.rejects(repository.listHistory('student1','quizzes'),/권한/);await repository.execute('student1','quiz',{choice:1,version:1},'answer',now);await assert.rejects(repository.execute('teacher','save',{table:'quizzes',id:'question',version:1,data:{date:kstDate(now),question:'Changed',options:['A','B','C','D'],answer:2,explanation:'Secret',active:true}},'edit',now),/제출|변경/);
});

test('draft volume cannot hide the published quiz or an older important announcement',async()=>{
 const state=simple(),now=Date.now();state.quizzes=[{id:'published',date:kstDate(now),question:'Published',options:['A','B','C','D'],answer:1,explanation:'Answer',active:true,version:1,createdAt:1},...Array.from({length:70},(_,i)=>({id:'draft'+i,date:kstDate(now),question:'Draft',options:['A','B','C','D'],answer:2,active:false,version:1,createdAt:i+2}))];state.notices=[{id:'important',title:'Important',body:'Pinned',important:true,active:true,createdAt:1},...Array.from({length:30},(_,i)=>({id:'news'+i,title:'News '+i,body:'Body',important:false,active:true,createdAt:i+2}))];const prepared=partitionState(state,'test');const store=new MemoryStore(prepared.main);for(const row of prepared.records)store.set(row.path,row.value);const repository=new StateRepository(store,'test');const student=await repository.readState('student1');assert.deepEqual(student.quizzes.map(q=>q.id),['published']);assert.ok(student.notices.some(n=>n.id==='important'));
});

test('student privileged commands and malformed payloads stop before archive queries',async()=>{
 const store=new MemoryStore(simple()),repository=new StateRepository(store,'test');await assert.rejects(repository.execute('student1','points',{uid:'student2',amount:1,reason:'Bad'},'forbidden'),/교사/);await assert.rejects(repository.execute('student1','preferences',{enabled:true,extra:'Bad'},'invalid'));assert.equal(store.queries.length,0);assert.equal(store.commits,0);
});

test('simultaneous quiz mutations serialize and grant exactly once',async()=>{
 const state=simple(),now=Date.now();state.quizzes=[{id:'quiz',date:kstDate(now),question:'Question',options:['A','B','C','D'],answer:1,explanation:'Answer',active:true,version:1}];const store=new MemoryStore(state),repository=new StateRepository(store,'test');const results=await Promise.allSettled(['first','second'].map(key=>repository.execute('student1','quiz',{choice:1,version:1},key,now)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.records('lots').length,1);assert.equal(store.records('attempts').length,1);assert.equal((await repository.readState('student1')).lots.reduce((n,l)=>n+l.available,0),10);
});


test('the first migration preserves an exact immutable server snapshot in the same CAS commit',async()=>{
 const state=simple();state.events=[{id:'historic',uid:'student1',at:1,amount:3,reason:'Original'}];const store=new MemoryStore(state),repository=new StateRepository(store,'test'),sourceVersion=store.docs.get('classes/test/private/state')!.updateTime;store.conflicts=1;await repository.execute('student1','preferences',{enabled:false},'migrate',1234);const backups=[...store.docs.entries()].filter(([path])=>path.startsWith('classes/test/migrationBackups/'));assert.equal(backups.length,1);const backup=store.value(backups[0][1]);assert.deepEqual(backup.state,state);assert.equal(backup.sourceUpdateTime,sourceVersion);assert.equal(backup.createdAt,1234);assert.equal(store.commits,1);await repository.execute('student1','preferences',{enabled:false},'migrate',1234);await repository.execute('student1','preferences',{enabled:true},'another',1234);assert.equal([...store.docs.keys()].filter(path=>path.startsWith('classes/test/migrationBackups/')).length,1);assert.deepEqual(store.value(store.docs.get(backups[0][0])!).state,state);
});


test('history cursors use immutable archive order when a mutable request timestamp changes',async()=>{
 const state=simple();state.exams=Array.from({length:3},(_,i)=>({id:'exam'+i,uid:'student1',at:i+1,status:'pending'}));const prepared=partitionState(state,'test');const store=new MemoryStore(prepared.main);for(const row of prepared.records){const value=structuredClone(row.value) as any;if(value.record.id==='exam1')value.record.at=100;store.set(row.path,value);}const repository=new StateRepository(store,'test');const first=await repository.listHistory('student1','exams',null,2);const next=await repository.listHistory('student1','exams',first.cursor,2);assert.equal(new Set([...first.records,...next.records].map(r=>r.historyId)).size,3);assert.equal(first.records.length+next.records.length,3);
});
