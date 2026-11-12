import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode,Store,accessToken} from '../worker/store';
import {generateKeyPair,exportPKCS8,jwtVerify} from 'jose';
import {pinPassword} from '../worker/credentials';
import {nextAttempt} from '../src/login-rate';
test('Workers PIN derivative binds the PIN, server pepper and individual salt',async()=>{
 const salt='ab'.repeat(16),pepper='server-only-'.repeat(4);
 const password=await pinPassword('0012',pepper,salt);
 assert.match(password,/^[a-f0-9]{64}$/);assert.equal(password,await pinPassword('0012',pepper,salt));
 assert.notEqual(password,await pinPassword('0013',pepper,salt));
 assert.notEqual(password,await pinPassword('0012',pepper+'x',salt));
 assert.notEqual(password,await pinPassword('0012',pepper,'cd'.repeat(16)));
 await assert.rejects(pinPassword('１２３４',pepper,salt));
});
test('Firestore REST preserves nested domain state and integer values',()=>{
 const value={members:[{id:'fake-student',active:true}],lots:[{available:0,expiresAt:1800000000000}],nil:null,settings:{name:'우리반',ratio:0.5},empty:[]};
 assert.deepEqual(decode(encode(value)),value);
});
for(const conflictStatus of [409,412,400])test(`REST atomic preconditions retry HTTP ${conflictStatus} without duplicate grants or excess login attempts`,async()=>{
 const original=globalThis.fetch;
 const docs=new Map<string,{fields:any;updateTime:string}>();let version=0;
 globalThis.fetch=async(input,init)=>{
  const url=String(input);if(url.endsWith(':commit')){
   const {writes}=JSON.parse(String(init?.body));
   for(const w of writes){const previous=docs.get(w.update.name);if(w.currentDocument.exists===false?!!previous:previous?.updateTime!==w.currentDocument.updateTime)return Response.json({error:{status:'FAILED_PRECONDITION'}},{status:conflictStatus});}
   for(const w of writes)docs.set(w.update.name,{fields:w.update.fields,updateTime:String(++version)});
   return Response.json({});
  }
  if(url.endsWith(':batchGet')){
   const {documents}=JSON.parse(String(init?.body));
   // Firestore may return batch documents in a different order.
   return Response.json(documents.map((name:string)=>{const doc=docs.get(name);return doc?{found:{name,...doc}}:{missing:name};}).reverse());
  }
  const name=url.slice(url.indexOf('projects/'));const d=docs.get(name);
  return d?Response.json({name,...d}):new Response('{}',{status:404});
 };
 try{
  const store=new Store('demo-class-portal',async()=>'emulator-only');
  await Promise.all(Array.from({length:6},()=>store.change(['state'],([s])=>({values:[s||{points:7,key:'same'}],result:null}))));
  assert.equal(store.value(await store.get('state')).points,7);
  const attempts=await Promise.allSettled(Array.from({length:6},()=>store.change(['account','ip'],old=>({values:old.map((x,i)=>nextAttempt(x||undefined,1000,i===0?5:50)),result:null}))));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,5);
  assert.equal(store.value(await store.get('account')).count,5);
  assert.equal(store.value(await store.get('ip')).count,5,'Rejected commit cannot partially update the IP gate');
 }finally{globalThis.fetch=original;}
});
test('REST invalid arguments fail immediately instead of retrying as conflicts',async()=>{
 const original=globalThis.fetch;let commits=0;
 globalThis.fetch=async(input)=>String(input).endsWith(':commit')?(commits++,Response.json({error:{status:'INVALID_ARGUMENT'}},{status:400})):new Response('{}',{status:404});
 try{
  const store=new Store('demo-class-portal',async()=>'emulator-only');
  await assert.rejects(store.change(['state'],()=>({values:[{count:1}],result:null})),/Database unavailable \(400\)/);
  assert.equal(commits,1);
 }finally{globalThis.fetch=original;}
});
test('concurrent server authentication shares one exchange and recovers after failure',async()=>{
 const original=globalThis.fetch;const {privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true});
 const sa={client_email:'deployment-test@example.invalid',private_key:await exportPKCS8(privateKey),project_id:'demo-class-portal'};
 let calls=0,fail=false;
 globalThis.fetch=async(input,init)=>{
  assert.equal(String(input),'https://oauth2.googleapis.com/token');calls++;
  const assertion=new URLSearchParams(init?.body as URLSearchParams).get('assertion')!;
  const {payload}=await jwtVerify(assertion,publicKey,{audience:'https://oauth2.googleapis.com/token'});
  assert.match(String(payload.iss),/@example\.invalid$/);
  return fail?new Response('{}',{status:503}):Response.json({access_token:'test-only-token-'+calls,expires_in:3600});
 };
 try{
  const tokens=await Promise.all(Array.from({length:12},()=>accessToken(sa)));
  assert.equal(calls,1);assert.equal(new Set(tokens).size,1);
  assert.equal(await accessToken(sa),tokens[0]);assert.equal(calls,1);
  const other={...sa,client_email:'retry-test@example.invalid'};fail=true;
  await assert.rejects(accessToken(other),/Server authentication unavailable/);
  fail=false;assert.equal(await accessToken(other),'test-only-token-3');assert.equal(calls,3);
 }finally{globalThis.fetch=original;}
});
