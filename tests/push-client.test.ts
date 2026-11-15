import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPushController,PushRuntime} from '../src/push-controller';
import {pushPermissionStep,receivesPush,validPushKey} from '../src/push-preferences';

const key='B'+'a'.repeat(86),otherKey='B'+'b'.repeat(86),deviceId='00000000-0000-4000-8000-000000000001';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function fixture(permission:NotificationPermission='granted',enabled=true){
 let uid='student1',currentPermission=permission,supported=true,now=1000000;
 const preferences=new Map<string,string>(),transports=new Map<string,boolean>(),calls:{owner:string;input:any}[]=[],events:string[]=[],workers:boolean[]=[];
 let requests=0,tokens=0,deletions=0;
 let tokenWork=async()=>`fake-token-${uid}`,deleteWork=async()=>{},callWork=async(_input:any)=>{};
 const runtime:PushRuntime={
  now:()=>now,
  uid:()=>uid,supported:async()=>supported,permission:()=>currentPermission,
  requestPermission:async()=>{requests++;events.push('prompt');currentPermission='granted';return currentPermission;},
  preference:owner=>preferences.get(owner)??null,setPreference:(owner,value)=>{preferences.set(owner,String(value));},
  hasTransport:owner=>transports.get(owner)===true,setTransport:(owner,value)=>{transports.set(owner,value);},
  deviceId:()=>deviceId,
  token:async()=>{tokens++;events.push('token:'+uid);return tokenWork();},
  deleteToken:async()=>{deletions++;events.push('delete:start');await deleteWork();events.push('delete:end');},
  workerPermission:async value=>{workers.push(value);events.push('worker:'+value);},listen:()=>()=>{}
 };
 const client=createPushController(true,async input=>{calls.push({owner:uid,input});await callWork(input);},runtime,{enabled,vapidKey:key},2);
 return {client,runtime,preferences,transports,calls,events,workers,get requests(){return requests;},get tokens(){return tokens;},get deletions(){return deletions;},setNow:(value:number)=>{now=value;},setUid:(value:string)=>{uid=value;},setPermission:(value:NotificationPermission)=>{currentPermission=value;},setSupported:(value:boolean)=>{supported=value;},setToken:(value:typeof tokenWork)=>{tokenWork=value;},setDelete:(value:typeof deleteWork)=>{deleteWork=value;},setCall:(value:typeof callWork)=>{callWork=value;}};
}

test('unset device choice receives by default; explicit device/account opt-outs win',()=>{
 assert.equal(receivesPush(null),true);assert.equal(receivesPush(undefined),true);assert.equal(receivesPush('true'),true);assert.equal(receivesPush('false'),false);
 assert.equal(receivesPush(null,false),false);assert.equal(receivesPush('true',false),false);
 assert.equal(pushPermissionStep(null,'granted'),'connect');assert.equal(pushPermissionStep(null,'default'),'allow');assert.equal(pushPermissionStep(null,'denied'),'blocked');assert.equal(pushPermissionStep('false','granted'),'off');
 assert.equal(validPushKey(key),true);assert.equal(validPushKey('server-secret'),false);
});

test('default granted permission auto-registers without prompting or storing a token in preferences',async()=>{
 const f=fixture();await f.client.sync();
 assert.equal(f.requests,0);assert.equal(f.tokens,1);assert.equal(f.preferences.size,0);
 assert.equal((await f.client.status()).registered,true);assert.equal((await f.client.status()).optedIn,true);
 assert.deepEqual(f.calls.map(c=>c.input.action),['register']);assert.deepEqual(f.workers,[true]);
});

test('repeated and overlapping portal refreshes share a registration without extra writes',async()=>{
 const f=fixture(),reply=deferred<void>();f.setCall(input=>input.action==='register'?reply.promise:Promise.resolve());
 const concurrent=Promise.all(Array.from({length:8},()=>f.client.sync()));await tick();
 assert.equal(f.tokens,1);assert.equal(f.calls.length,1);
 reply.resolve();await concurrent;
 await Promise.all(Array.from({length:8},()=>f.client.sync()));
 assert.equal(f.tokens,1);assert.equal(f.calls.length,1);assert.equal((await f.client.status()).registered,true);
});

test('an open app periodically renews its token registration without prompting',async()=>{
 const f=fixture();await f.client.sync();f.setNow(1000000+6*3600000-1);await f.client.sync();assert.equal(f.tokens,1);
 f.setNow(1000000+6*3600000);await f.client.sync();assert.equal(f.tokens,2);assert.equal(f.requests,0);assert.equal((await f.client.status()).registered,true);
});

test('default browser permission waits for explicit enable; denied permission never prompts on load',async()=>{
 const f=fixture('default');await f.client.sync();assert.equal(f.requests,0);assert.equal(f.tokens,0);assert.equal(f.calls.length,0);assert.equal((await f.client.status()).optedIn,true);
 await f.client.enable();assert.equal(f.requests,1);assert.equal(f.events[0],'prompt');assert.equal(f.tokens,1);assert.equal((await f.client.status()).registered,true);
 const denied=fixture('denied');await denied.client.sync();await assert.rejects(denied.client.enable(),/브라우저 설정/);assert.equal(denied.requests,0);assert.equal(denied.tokens,0);assert.equal(denied.preferences.size,0);
});

test('explicit device opt-out survives config changes and granted browser permission',async()=>{
 const f=fixture();f.preferences.set('student1','false');await f.client.sync();
 f.client.configure({enabled:true,vapidKey:otherKey});await f.client.sync();
 assert.equal(f.tokens,0);assert.equal(f.calls.length,0);assert.equal(f.preferences.get('student1'),'false');assert.equal((await f.client.status()).optedIn,false);
});

test('revoked browser permission stops local delivery and reconnects only after permission returns',async()=>{
 const f=fixture();await f.client.sync();f.setPermission('denied');
 assert.equal((await f.client.status()).registered,false);
 await f.client.sync();assert.equal(f.workers.at(-1),false);assert.equal(f.requests,0);assert.equal(f.tokens,1);
 f.setPermission('default');await f.client.sync();assert.equal(f.requests,0);assert.equal(f.tokens,1);
 f.setPermission('granted');await f.client.sync();assert.equal(f.tokens,2);assert.equal((await f.client.status()).registered,true);assert.equal(f.preferences.size,0);
});

test('logout removes transport while preserving unset and explicit receiving preferences',async()=>{
 for(const preference of [null,'true']){
  const f=fixture();if(preference!==null)f.preferences.set('student1',preference);
  await f.client.sync();await f.client.cleanup();
  assert.equal(f.preferences.get('student1')??null,preference);assert.equal(f.deletions,1);assert.equal(f.workers.at(-1),false);assert.equal((await f.client.status()).registered,false);
  await f.client.sync();assert.equal((await f.client.status()).registered,true);assert.equal(f.calls.filter(c=>c.input.action==='register').length,2);
 }
});

test('explicit disable persists false while account-off only suspends existing device preference',async()=>{
 const f=fixture();await f.client.sync();await f.client.disable();await f.client.sync();
 assert.equal(f.preferences.get('student1'),'false');assert.equal((await f.client.status()).optedIn,false);assert.equal(f.calls.filter(c=>c.input.action==='register').length,1);
 const account=fixture();await account.client.sync(false);assert.equal(account.tokens,0);assert.equal((await account.client.status()).optedIn,false);await assert.rejects(account.client.enable(),/내 알림 수신/);
 await account.client.disableAll();assert.equal(account.preferences.size,0);assert.equal(account.calls.at(-1)?.input.action,'unregisterAll');await account.client.sync(true);assert.equal((await account.client.status()).registered,true);
});

test('slow old token generation cannot register the old account after logout or erase a new token',async()=>{
 const f=fixture(),oldToken=deferred<string>();f.setToken(()=>oldToken.promise);
 const oldSync=f.client.sync();await tick();assert.equal(f.tokens,1);
 await f.client.cleanup();f.setUid('student2');f.setToken(async()=>'fake-new-token');
 await f.client.sync();assert.equal(f.tokens,1,'New sync returns while old cleanup is pending');
 oldToken.resolve('fake-old-token');await oldSync;await tick();await tick();
 assert.equal(f.calls.filter(c=>c.input.action==='register').length,1);assert.equal(f.calls.find(c=>c.input.action==='register')?.owner,'student2');
 assert.ok(f.events.indexOf('delete:end')<f.events.indexOf('token:student2'));
 assert.equal((await f.client.status()).registered,true);assert.equal(f.preferences.size,0);
});

test('an old backend response cannot disable or claim the new account registration',async()=>{
 const f=fixture(),oldReply=deferred<void>();f.setCall(input=>input.action==='register'&&input.token==='fake-token-student1'?oldReply.promise:Promise.resolve());
 const oldSync=f.client.sync();await tick();assert.equal(f.calls[0].owner,'student1');
 await f.client.cleanup();f.setUid('student2');await f.client.sync();assert.equal((await f.client.status()).registered,true);
 const lastWorker=f.workers.at(-1);oldReply.resolve();await oldSync;await tick();
 assert.equal(f.workers.at(-1),lastWorker);assert.equal(f.workers.at(-1),true);assert.equal((await f.client.status()).registered,true);
});

test('slow token deletion defers registration without a ten-second sync wait',async()=>{
 const f=fixture(),deletion=deferred<void>();await f.client.sync();f.setDelete(()=>deletion.promise);
 await f.client.cleanup();f.setUid('student2');const started=Date.now();await f.client.sync();assert.ok(Date.now()-started<100);assert.equal(f.tokens,1);
 deletion.resolve();await tick();await tick();assert.equal(f.tokens,2);assert.equal((await f.client.status()).registered,true);
});

test('failed offline cleanup retries deletion before a different account gets a token',async()=>{
 const f=fixture();await f.client.sync();let attempts=0;
 f.setDelete(async()=>{if(attempts++===0)throw Error('Synthetic offline deletion');});
 await f.client.cleanup();f.setUid('student2');await f.client.sync();
 assert.equal(f.deletions,2);assert.equal((await f.client.status()).registered,true);
 const lastDelete=f.events.lastIndexOf('delete:end'),newToken=f.events.indexOf('token:student2');
 assert.ok(lastDelete>=0&&lastDelete<newToken);assert.equal(f.preferences.size,0);
});

test('public server config enables granted defaults and invalid/off config cancels safely',async()=>{
 const f=fixture('granted',false);await f.client.sync();assert.equal(f.tokens,0);
 f.client.configure({enabled:true,vapidKey:key});await f.client.sync();assert.equal((await f.client.status()).registered,true);
 f.client.configure({enabled:true,vapidKey:'invalid'});await tick();assert.equal((await f.client.status()).configured,false);assert.equal(f.workers.at(-1),false);
 await f.client.sync();assert.equal(f.tokens,1);f.client.configure({enabled:false,vapidKey:key});await f.client.sync();assert.equal(f.tokens,1);
});

test('test notification is an explicit registered-device action with no recipient or token',async()=>{
 const f=fixture();await assert.rejects(f.client.test(),/연결한 뒤/);await f.client.sync();assert.equal(f.calls.some(c=>c.input.action==='test'),false);
 await f.client.test();assert.deepEqual(f.calls.at(-1)?.input,{action:'test',deviceId});
});
