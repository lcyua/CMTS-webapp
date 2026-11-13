import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {seed} from '../src/seed';
import {command} from '../src/domain';
import {decode,Document,encode,Store} from '../worker/store';
import {dispatchPush,preparePushWrites,pushControlPath,pushMessage,pushRegistryPath,updatePushDevice} from '../worker/push';
import {createPushClient} from '../src/push';

const classId='2027-1-11',now=1800000000000;
const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006'];
const token=(n:number)=>'mock-registration-token-'+n;
function memory(){
 const docs=new Map<string,Document>(),base='projects/demo-class-portal/databases/(default)/documents/';let version=0;
 const sent:any[]=[];let fcm:(body:any)=>Response|Promise<Response>=()=>Response.json({name:'mock-message'}),beforeCommit:(()=>void)|null=null;
 const write=(path:string,value:any)=>{const name=base+path;docs.set(name,{name,fields:encode(value).mapValue.fields,updateTime:String(++version)});};
 const read=(path:string)=>{const d=docs.get(base+path);return d?decode({mapValue:{fields:d.fields}}):null;};
 const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input);
  if(url.startsWith('https://fcm.googleapis.com/')){const body=JSON.parse(String(init?.body));sent.push(body);return fcm(body);}
  if(url.endsWith(':commit')){
   const {writes}=JSON.parse(String(init?.body));
   if(beforeCommit){const action=beforeCommit;beforeCommit=null;action();}
   for(const w of writes){const name=w.verify||w.delete||w.update.name,existing=docs.get(name),c=w.currentDocument;if(c&&(c.exists===false?!!existing:c.updateTime!==existing?.updateTime))return Response.json({error:{status:'FAILED_PRECONDITION'}},{status:400});}
   for(const w of writes){if(w.verify)continue;if(w.delete)docs.delete(w.delete);else docs.set(w.update.name,{name:w.update.name,fields:w.update.fields,updateTime:String(++version)});}
   return Response.json({});
  }
  if(url.endsWith(':batchGet')){const {documents}=JSON.parse(String(init?.body));return Response.json(documents.map((name:string)=>docs.has(name)?{found:docs.get(name)}:{missing:name}).reverse());}
  if(url.endsWith(':runQuery')){
   const {structuredQuery:q}=JSON.parse(String(init?.body)),parent=url.slice(url.indexOf('projects/')).replace(':runQuery','')+'/',collection=q.from[0].collectionId;
   const rows=[...docs.values()].filter(d=>d.name.startsWith(parent+collection+'/')&&!d.name.slice((parent+collection+'/').length).includes('/'));
   const filter=q.where?.fieldFilter,field=filter?.field?.fieldPath;
   const get=(d:Document,key:string)=>key.split('.').reduce((v:any,k)=>v?.[k],decode({mapValue:{fields:d.fields}}));
   const value=filter?decode(filter.value):null;
   const filtered=filter?rows.filter(d=>filter.op==='EQUAL'?get(d,field)===value:typeof get(d,field)==='number'&&get(d,field)<=value):rows;
   if(q.orderBy)filtered.sort((a,b)=>get(a,q.orderBy[0].field.fieldPath)-get(b,q.orderBy[0].field.fieldPath));
   return Response.json(filtered.slice(0,q.limit||100).map(document=>({document})));
  }
  const name=url.slice(url.indexOf('projects/')),doc=docs.get(name);return doc?Response.json(doc):new Response('{}',{status:404});
 };
 return {docs,write,read,sent,fetcher,setBeforeCommit:(fn:()=>void)=>{beforeCommit=fn;},setFcm:(fn:typeof fcm)=>{fcm=fn;},store:new Store('demo-class-portal',async()=>'mock-oauth')};
}
async function usingMemory(run:(m:ReturnType<typeof memory>)=>Promise<void>){const original=globalThis.fetch,m=memory();globalThis.fetch=m.fetcher;try{await run(m);}finally{globalThis.fetch=original;}}

test('push device registration is limited, isolated, and bound to active state in the same commit',async()=>usingMemory(async m=>{
 const state=seed();m.write(`classes/${classId}/private/state`,state);
 for(let i=0;i<5;i++)await updatePushDevice(m.store,classId,'student1',state,{action:'register',deviceId:ids[i],token:token(i)},true,now);
 const path=await pushRegistryPath(classId,'student1');assert.equal(m.read(path).devices.length,5);
 await assert.rejects(updatePushDevice(m.store,classId,'student1',state,{action:'register',deviceId:ids[5],token:token(5)},true,now),/5대/);
 await updatePushDevice(m.store,classId,'student1',state,{action:'unregister',deviceId:ids[0],uid:'student2'},false,now);
 assert.equal(m.read(path).devices.length,4);assert.equal(m.read(await pushRegistryPath(classId,'student2')),null);
 await assert.rejects(updatePushDevice(m.store,classId,'student2',state,{action:'register',deviceId:ids[0],token:token(1)},true,now),/이전 알림 연결/);
 const latest=seed();latest.members.find(x=>x.id==='student1')!.active=false;m.write(`classes/${classId}/private/state`,latest);
 await assert.rejects(updatePushDevice(m.store,classId,'student1',state,{action:'register',deviceId:ids[0],token:token(9)},true,now),/활성 학급/,'Stale caller state cannot bypass current membership');
}));

test('membership revocation racing registration fails the state verify precondition',async()=>usingMemory(async m=>{
 const state=seed();m.write(`classes/${classId}/private/state`,state);
 m.setBeforeCommit(()=>{const latest=seed();latest.members.find(x=>x.id==='student1')!.active=false;m.write(`classes/${classId}/private/state`,latest);});
 await assert.rejects(updatePushDevice(m.store,classId,'student1',state,{action:'register',deviceId:ids[0],token:token(0)},true,now),/활성 학급/);
 assert.equal(m.read(await pushRegistryPath(classId,'student1')),null);
}));

test('push queue capacity preserves app inbox and payload never contains private contents',async()=>usingMemory(async m=>{
 const state=seed();state.inbox=Array.from({length:40},(_,i)=>({id:'inbox-'+i,uid:'student1',title:'PRIVATE STUDENT',body:'SECRET POINTS',read:false,at:now}));
 m.write(pushControlPath(classId),{pending:250,dropped:2});
 const prepared=await preparePushWrites(m.store,classId,new Set(),state,await m.store.get(pushControlPath(classId)),now);
 assert.equal(prepared.queued,6);assert.equal(prepared.dropped,34);assert.equal(state.inbox.length,40);
 const control=prepared.writes[0].value as any;assert.equal(control.pending,256);assert.equal(control.dropped,36);
 const serialized=JSON.stringify(prepared.writes);assert.ok(!serialized.includes('PRIVATE STUDENT'));assert.ok(!serialized.includes('SECRET POINTS'));
 const message=JSON.stringify(pushMessage({id:'ab'.repeat(32)},token(1)));assert.ok(!message.includes('student1'));assert.match(message,/새 학급 알림/);
 const duplicate=await preparePushWrites(m.store,classId,new Set(state.inbox.map(n=>n.id)),state,null,now);assert.equal(duplicate.writes.length,0);
}));

test('60-student payout push work fits the remaining atomic commit budget without losing inbox rows',async()=>usingMemory(async m=>{
 const state=seed(),students=Array.from({length:60},(_,i)=>({id:'student-'+i,studentNo:String(11100+i),name:'Mock student '+i,role:'student',active:true}));
 state.members=[{id:'teacher',name:'Mock teacher',role:'teacher',active:true},...students];
 state.roles=[{id:'full-class-role',name:'Mock role',points:1,uids:students.map(s=>s.id),active:true,version:1}];
 state.inbox=[];state.lots=[];state.events=[];state.audits=[];state.payouts=[];
 command(state,'teacher','payout',{month:'2027-01'},'full-class-payout',now);
 assert.equal(state.inbox.length,60);
 const tight=await preparePushWrites(m.store,classId,new Set(),state,null,now,17);
 assert.equal(tight.writes.length,17);assert.equal(tight.queued,16);assert.equal(tight.dropped,44);assert.equal((tight.writes[0].value as any).dropped,44);
 const none=await preparePushWrites(m.store,classId,new Set(),state,null,now,0);
 assert.deepEqual(none,{writes:[],queued:0,dropped:60});
 assert.equal(state.inbox.length,60,'Push overflow cannot remove app inbox records');
}));

async function queued(m:ReturnType<typeof memory>,deviceCount=1){
 const state=seed();state.inbox=[{id:'new-inbox',uid:'student1',body:'DO NOT SEND',read:false,at:now}];m.write(`classes/${classId}/private/state`,state);
 for(let i=0;i<deviceCount;i++)await updatePushDevice(m.store,classId,'student1',state,{action:'register',deviceId:ids[i],token:token(i)},true,now);
 const prepared=await preparePushWrites(m.store,classId,new Set(),state,null,now);await m.store.put(prepared.writes);
 return {state,path:prepared.writes[1].path};
}

test('simultaneous dispatches lease a queued notification once',async()=>usingMemory(async m=>{
 const {path}=await queued(m);const results=await Promise.all([dispatchPush(m.store,classId,async()=>'mock',{enabled:true,now}),dispatchPush(m.store,classId,async()=>'mock',{enabled:true,now})]);
 assert.equal(results.reduce((n,r)=>n+r.sent,0),1);assert.equal(m.sent.length,1);assert.equal(m.read(path).status,'done');assert.equal(m.read(pushControlPath(classId)).pending,0);
 assert.ok(!JSON.stringify(m.sent).includes('DO NOT SEND'));
}));

test('FCM retries skip already delivered devices and remove unregistered tokens',async()=>usingMemory(async m=>{
 const {path}=await queued(m,2);m.setFcm(body=>body.message.token===token(0)?Response.json({name:'ok'}):new Response('{}',{status:503}));
 const first=await dispatchPush(m.store,classId,async()=>'mock',{enabled:true,now});assert.equal(first.sent,1);assert.equal(first.retried,1);assert.equal(m.read(path).status,'pending');
 m.setFcm(()=>Response.json({error:{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'UNREGISTERED'}]}},{status:404}));
 const second=await dispatchPush(m.store,classId,async()=>'mock',{enabled:true,now:now+120000});assert.equal(second.invalidTokens,1);assert.equal(second.sent,0);
 assert.equal(m.sent.filter(x=>x.message.token===token(0)).length,1);assert.equal(m.read(await pushRegistryPath(classId,'student1')).devices.length,1);assert.equal(m.read(path).status,'done');
}));

test('disabled push performs no reads or sends; read/disabled recipients are discarded',async()=>usingMemory(async m=>{
 assert.deepEqual(await dispatchPush(m.store,classId,async()=>{throw Error('must not authenticate');},{enabled:false}),{enabled:false,processed:0,sent:0,retried:0,invalidTokens:0,discarded:0});
 const {state,path}=await queued(m);state.members.find(x=>x.id==='student1')!.notifications={enabled:false};m.write(`classes/${classId}/private/state`,state);
 const result=await dispatchPush(m.store,classId,async()=>{throw Error('must not send');},{enabled:true,now});assert.equal(result.discarded,1);assert.equal(m.sent.length,0);assert.equal(m.read(path).status,'discarded');
}));

test('Auth-only disabled recipient is discarded; Auth outage retains leased job for retry',async()=>usingMemory(async m=>{
 const {path}=await queued(m);
 await assert.rejects(dispatchPush(m.store,classId,async()=>'mock',{enabled:true,now,isUserActive:async()=>{throw Error('mock authentication outage');}}),/mock authentication outage/);
 assert.equal(m.read(path).status,'pending');assert.equal(m.read(pushControlPath(classId)).pending,1);assert.equal(m.sent.length,0);
 const result=await dispatchPush(m.store,classId,async()=>'mock',{enabled:true,now:now+120000,isUserActive:async()=>false});
 assert.equal(result.discarded,1);assert.equal(m.read(path).status,'discarded');assert.equal(m.read(pushControlPath(classId)).pending,0);assert.equal(m.sent.length,0);
}));

for(const read of [false,true])test(`dispatcher verifies archived inbox ownership/read state (read=${read})`,async()=>usingMemory(async m=>{
 const {state,path}=await queued(m);const notice=state.inbox[0];state.inbox=[];m.write(`classes/${classId}/private/state`,state);
 m.write(`classes/${classId}/history_inbox/0001800000000000_0000000000000001`,{record:{...notice,read},sequence:1});
 const result=await dispatchPush(m.store,classId,async()=>'mock',{enabled:true,now});
 assert.equal(result.sent,read?0:1);assert.equal(m.read(path).status,read?'discarded':'done');
}));

test('dispatch job count and failed retry count remain bounded',async()=>usingMemory(async m=>{
 const {state,path}=await queued(m);const job=m.read(path);job.attempts=4;m.write(path,job);m.setFcm(()=>new Response('{}',{status:403}));
 const failed=await dispatchPush(m.store,classId,async()=>'mock',{enabled:true,now});assert.equal(failed.retried,0);assert.equal(m.read(path).status,'failed');assert.equal(m.read(pushControlPath(classId)).pending,0);
 state.inbox=Array.from({length:6},(_,i)=>({id:'bounded-'+i,uid:'student1',read:false,at:now}));m.write(`classes/${classId}/private/state`,state);
 await m.store.put((await preparePushWrites(m.store,classId,new Set(),state,await m.store.get(pushControlPath(classId)),now)).writes);
 m.setFcm(()=>Response.json({name:'ok'}));const bounded=await dispatchPush(m.store,classId,async()=>'mock',{enabled:true,maxJobs:999,now});assert.equal(bounded.processed,5);assert.equal(bounded.sent,5);assert.equal(m.read(pushControlPath(classId)).pending,1);
}));

test('unconfigured push has no service worker or network dependency during logout',async()=>{
 let calls=0;const client=createPushClient(null,async()=>{calls++;},'',false);
 await client.cleanup();await client.pause();await client.sync();
 assert.equal(calls,0);assert.deepEqual(await client.status(),{configured:false,supported:false,permission:'unsupported',registered:false,optedIn:false});
});

test('push service worker only displays generic opted-in notifications and same-origin links',async()=>{
 const handlers:Record<string,Function>={},shown:any[]=[],opened:string[]=[],posted:any[]=[],values=new Map<string,any>();let windows:any[]=[];
 const db={createObjectStore(){},close(){},transaction(_name:string,mode:string){const tx:any={objectStore(){return {get(key:string){const req:any={};setImmediate(()=>{req.result=values.get(key);req.onsuccess?.();tx.oncomplete?.();});return req;},put(value:any,key:string){const req:any={};setImmediate(()=>{values.set(key,value);req.onsuccess?.();tx.oncomplete?.();});return req;}};}};return tx;}};
 const indexedDB={open(){const request:any={};setImmediate(()=>{request.result=db;request.onsuccess?.();});return request;}};
 const self={location:{origin:'https://portal.example'},addEventListener(type:string,handler:Function){handlers[type]=handler;},registration:{async showNotification(title:string,options:any){shown.push({title,...options});}},clients:{async matchAll(){return windows;},async openWindow(url:string){opened.push(url);}}};
 vm.runInNewContext(readFileSync(new URL('../public/push-worker.js',import.meta.url),'utf8'),{self,indexedDB,URL,Promise});
 const trigger=async(type:string,event:any)=>{let work:Promise<unknown>|undefined;handlers[type]({...event,waitUntil(p:Promise<unknown>){work=p;}});await work;};
 const payload={data:{id:'ab'.repeat(32),title:'SECRET NAME',body:'SECRET BALANCE',url:'https://evil.example'}};
 await trigger('push',{data:{json:()=>payload}});assert.equal(shown.length,0,'Default and logged-out state never display a message');
 await trigger('message',{data:{type:'WOORIBAN_PUSH_PERMISSION',enabled:true},ports:[{postMessage(){}}]});
 await trigger('push',{data:{json:()=>payload}});assert.equal(shown.length,1);assert.equal(shown[0].title,'우리반 학급 포털');assert.ok(!JSON.stringify(shown).includes('SECRET'));
 await trigger('notificationclick',{notification:{data:{wooriban:true},close(){}}});assert.deepEqual(opened,['https://portal.example/']);
 windows=[{url:'https://portal.example/',visibilityState:'visible',postMessage(value:any){posted.push(value);}}];
 await trigger('push',{data:{json:()=>payload}});assert.equal(shown.length,1);assert.equal(posted.length,1);
 await trigger('message',{data:{type:'WOORIBAN_PUSH_PERMISSION',enabled:false},ports:[{postMessage(){}}]});
 await trigger('push',{data:{json:()=>payload}});assert.equal(shown.length,1);assert.equal(posted.length,1);
});
