import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../src/seed';
import {digest} from '../worker/credentials';
import {pushRegistryPath} from '../worker/push';
import {PushTestError,sendOwnPushTest} from '../worker/push-test';
import {decode,encode,Store,UpstreamError,type Document} from '../worker/store';

const classId='self-test-class',now=1800000000000;
const deviceA='00000000-0000-4000-8000-000000000001',deviceB='00000000-0000-4000-8000-000000000002';
const ownToken='fixture-teacher-registration-token',otherToken='fixture-other-registration-token';
function fixture(){
 const project='demo-class-portal',base=`projects/${project}/databases/(default)/documents/`,docs=new Map<string,Document>(),reads:string[]=[],sent:any[]=[],commits:any[][]=[];
 let version=0,beforeCommit:(()=>void)|undefined,respond:(body:any)=>Response|Promise<Response>=()=>Response.json({name:'fixture-message'});
 const write=(path:string,value:unknown)=>{const name=base+path;docs.set(name,{name,fields:encode(value).mapValue.fields,updateTime:String(++version)});};
 const read=(path:string)=>{const document=docs.get(base+path);return document?decode({mapValue:{fields:document.fields}}):null;};
 const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input);
  if(url===`https://fcm.googleapis.com/v1/projects/${project}/messages:send`){const body=JSON.parse(String(init?.body));sent.push(body);return respond(body);}
  if(!url.startsWith(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`))throw Error('Fixture refuses unexpected network access');
  if(url.endsWith(':batchGet')){const {documents}=JSON.parse(String(init?.body));return Response.json(documents.map((name:string)=>{reads.push(name);return docs.has(name)?{found:docs.get(name)}:{missing:name};}).reverse());}
  if(url.endsWith(':commit')){
   const {writes}=JSON.parse(String(init?.body));if(beforeCommit){const hook=beforeCommit;beforeCommit=undefined;hook();}
   for(const write of writes){const name=write.verify||write.update?.name||write.delete,old=docs.get(name),condition=write.currentDocument;if(condition&&(condition.exists===false?!!old:condition.updateTime!==old?.updateTime))return Response.json({error:{status:'FAILED_PRECONDITION'}},{status:400});}
   commits.push(writes);
   for(const write of writes)if(write.update)docs.set(write.update.name,{name:write.update.name,fields:write.update.fields,updateTime:String(++version)});
   return Response.json({});
  }
  const name=url.slice(url.indexOf('projects/'));reads.push(name);return docs.has(name)?Response.json(docs.get(name)):new Response('{}',{status:404});
 };
 return {store:new Store(project,async()=>'fixture-datastore-token'),write,read,reads,sent,commits,fetcher,onCommit:(hook:()=>void)=>{beforeCommit=hook;},reply:(callback:typeof respond)=>{respond=callback;}};
}
type Fixture=ReturnType<typeof fixture>;
async function using(run:(m:Fixture)=>Promise<void>){const original=globalThis.fetch,m=fixture();globalThis.fetch=m.fetcher;try{await run(m);}finally{globalThis.fetch=original;}}
async function prepare(m:Fixture){
 const state=seed(),path=await pushRegistryPath(classId,'teacher');
 m.write(`classes/${classId}/private/state`,state);
 m.write(path,{devices:[{deviceId:deviceA,token:ownToken,createdAt:now-1000,lastSeenAt:now},{deviceId:deviceB,token:ownToken+'-second',createdAt:now-1000,lastSeenAt:now}]});
 m.write(await pushRegistryPath(classId,'student1'),{devices:[{deviceId:deviceA,token:otherToken,createdAt:now-1000,lastSeenAt:now}]});
 return {state,path,limit:`classes/${classId}/pushTestLimits/${await digest('teacher')}`};
}
const request=(deviceId=deviceA)=>({classId,action:'test',deviceId});
const errorCode=(code:string,status:number)=>(error:unknown)=>error instanceof PushTestError&&error.code===code&&error.status===status;

test('self test uses only the active teacher own device, generic payload and a teacher-wide cooldown',async()=>using(async m=>{
 const {state,path,limit}=await prepare(m),before=JSON.stringify(m.read(`classes/${classId}/private/state`)),registry=JSON.stringify(m.read(path));
 assert.deepEqual(await sendOwnPushTest(m.store,classId,'teacher',state,request(),async()=>'fixture-oauth',true,now),{sent:true});
 assert.equal(m.sent.length,1);assert.equal(m.sent[0].message.token,ownToken);
 assert.equal(m.sent[0].message.data.kind,'self-test');
 const publicPayload=JSON.stringify({...m.sent[0].message,token:undefined});assert.ok(!publicPayload.includes('teacher'));assert.ok(!publicPayload.includes('student'));assert.ok(!publicPayload.includes(state.members[0].name));
 assert.deepEqual(m.reads.filter(name=>name.includes('/pushUsers/')),[`projects/demo-class-portal/databases/(default)/documents/${path}`]);
 assert.equal(m.read(limit).nextAllowedAt,now+60000);assert.equal(JSON.stringify(m.read(`classes/${classId}/private/state`)),before);assert.equal(JSON.stringify(m.read(path)),registry);
 assert.equal(m.commits[0].length,3);assert.equal(m.commits[0].filter(write=>write.verify).length,2);
 await assert.rejects(sendOwnPushTest(m.store,classId,'teacher',state,request(deviceB),async()=>'fixture-oauth',true,now+59999),errorCode('PUSH_TEST_RATE_LIMIT',429));
 assert.equal(m.sent.length,1);
 assert.deepEqual(await sendOwnPushTest(m.store,classId,'teacher',state,request(deviceB),async()=>'fixture-oauth',true,now+60000),{sent:true});
 assert.equal(m.sent[1].message.token,ownToken+'-second');
}));

test('self test rejects students, explicit opt-outs, disabled feature and injected recipients before reads',async()=>using(async m=>{
 const {state}=await prepare(m);
 await assert.rejects(sendOwnPushTest(m.store,classId,'student1',state,request(),async()=>'unused',true,now),errorCode('PUSH_TEST_TEACHER_REQUIRED',403));
 const off=structuredClone(state);off.members.find(member=>member.id==='teacher')!.notifications={enabled:false};
 await assert.rejects(sendOwnPushTest(m.store,classId,'teacher',off,request(),async()=>'unused',true,now),errorCode('PUSH_TEST_OPTED_OUT',409));
 await assert.rejects(sendOwnPushTest(m.store,classId,'teacher',state,request(),async()=>'unused',false,now),errorCode('PUSH_TEST_DISABLED',409));
 for(const extra of [{uid:'student1'},{recipient:'student1'},{token:otherToken},{classId:'another-class'}])await assert.rejects(sendOwnPushTest(m.store,classId,'teacher',state,{...request(),...extra},async()=>'unused',true,now),errorCode('PUSH_TEST_INVALID_REQUEST',400));
 assert.deepEqual(m.reads,[]);assert.deepEqual(m.sent,[]);assert.deepEqual(m.commits,[]);
}));

test('self test rejects revoked membership or registry racing its atomic reservation',async()=>{
 for(const changed of ['membership','preference','registry'])await using(async m=>{
  const {state,path,limit}=await prepare(m);
  m.onCommit(()=>{if(changed==='registry')m.write(path,{devices:[]});else{const latest=structuredClone(state),teacher=latest.members.find(member=>member.id==='teacher')!;if(changed==='membership')teacher.active=false;else teacher.notifications={enabled:false};m.write(`classes/${classId}/private/state`,latest);}});
  await assert.rejects(sendOwnPushTest(m.store,classId,'teacher',state,request(),async()=>'unused',true,now),errorCode(changed==='registry'?'PUSH_TEST_DEVICE_REQUIRED':changed==='preference'?'PUSH_TEST_OPTED_OUT':'PUSH_TEST_TEACHER_REQUIRED',changed==='membership'?403:409));
  assert.equal(m.sent.length,0);assert.equal(m.read(limit),null);
 });
});

test('concurrent self tests reserve one send across the teacher devices',async()=>using(async m=>{
 const {state}=await prepare(m);
 const results=await Promise.allSettled(Array.from({length:6},(_,index)=>sendOwnPushTest(m.store,classId,'teacher',state,request(index%2?deviceA:deviceB),async()=>'fixture-oauth',true,now)));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(m.sent.length,1);
 for(const result of results)if(result.status==='rejected')assert.ok(errorCode('PUSH_TEST_RATE_LIMIT',429)(result.reason));
}));

test('FCM failures keep cooldown and expose only actionable safe provider categories',async()=>{
 for(const [status,provider,code] of [[403,'PERMISSION_DENIED','PUSH_TEST_PERMISSION_REQUIRED'],[404,'UNREGISTERED','PUSH_TEST_DEVICE_EXPIRED'],[401,'THIRD_PARTY_AUTH_ERROR','PUSH_TEST_VAPID_REQUIRED'],[400,'SENDER_ID_MISMATCH','PUSH_TEST_PROJECT_MISMATCH'],[429,'QUOTA_EXCEEDED','PUSH_TEST_FCM_QUOTA'],[503,'INTERNAL','PUSH_TEST_UNAVAILABLE']] as const)await using(async m=>{
  const {state,limit}=await prepare(m);m.reply(()=>Response.json({error:{message:'DO NOT EXPOSE '+ownToken,status:'UNAVAILABLE',details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:provider}]}},{status}));
  await assert.rejects(sendOwnPushTest(m.store,classId,'teacher',state,request(),async()=>'fixture-oauth',true,now),error=>error instanceof PushTestError&&error.code===code&&!error.message.includes(ownToken)&&!error.message.includes('DO NOT EXPOSE')&&error.upstreamCode===provider);
  assert.equal(m.read(limit).nextAllowedAt,now+60000);assert.equal(m.sent.length,1);
 });
});

test('self test refuses unknown, stale, duplicate and malformed device records',async()=>{
 const malformed=[[],[{deviceId:deviceA,token:ownToken,createdAt:now,lastSeenAt:now-91*86400000}],[{deviceId:deviceA,token:'short',createdAt:now,lastSeenAt:now}],Array.from({length:2},()=>({deviceId:deviceA,token:ownToken,createdAt:now,lastSeenAt:now}))];
 for(const entries of malformed)await using(async m=>{const {state,path}=await prepare(m);m.write(path,{devices:entries});await assert.rejects(sendOwnPushTest(m.store,classId,'teacher',state,request(),async()=>'unused',true,now),errorCode('PUSH_TEST_DEVICE_REQUIRED',409));assert.equal(m.sent.length,0);});
});

test('OAuth, network and response-body waits all honor the same bounded self-test deadline',async()=>{
 const timeout=AbortSignal.timeout;AbortSignal.timeout=(delay:number)=>{assert.equal(delay,10000);return timeout(10);};
 try{
  for(const waiting of ['oauth','fetch','body'])await using(async m=>{
   const {state,limit}=await prepare(m),keepAlive=setTimeout(()=>{},100);
   try{
    if(waiting==='fetch')m.reply(()=>new Promise(()=>{}));
    if(waiting==='body')m.reply(()=>({ok:false,status:503,json:()=>new Promise(()=>{})}) as unknown as Response);
    await assert.rejects(sendOwnPushTest(m.store,classId,'teacher',state,request(),waiting==='oauth'?()=>new Promise(()=>{}):async()=>'fixture-oauth',true,now),errorCode('PUSH_TEST_TIMEOUT',504));
    assert.equal(m.read(limit).nextAllowedAt,now+60000);
   }finally{clearTimeout(keepAlive);}
  });
 }finally{AbortSignal.timeout=timeout;}
});

test('OAuth and unexpected network messages never leak through self-test errors',async()=>{
 for(const waiting of ['oauth','fetch'])await using(async m=>{
  const {state}=await prepare(m);if(waiting==='fetch')m.reply(()=>{throw Error('PRIVATE '+ownToken);});
  await assert.rejects(sendOwnPushTest(m.store,classId,'teacher',state,request(),waiting==='oauth'?async()=>{throw new UpstreamError('PRIVATE '+ownToken,403,'PERMISSION_DENIED');}:async()=>'fixture-oauth',true,now),error=>error instanceof PushTestError&&!error.message.includes(ownToken)&&!error.message.includes('PRIVATE'));
 });
});
