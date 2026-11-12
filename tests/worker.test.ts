import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode,Store} from '../worker/store';
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
test('REST atomic preconditions prevent concurrent duplicate grant and excess login attempts',async()=>{
 const original=globalThis.fetch;
 const docs=new Map<string,{fields:any;updateTime:string}>();let version=0;
 globalThis.fetch=async(input,init)=>{
  const url=String(input);if(url.endsWith(':commit')){
   const {writes}=JSON.parse(String(init?.body));
   for(const w of writes){const previous=docs.get(w.update.name);if(w.currentDocument.exists===false?!!previous:previous?.updateTime!==w.currentDocument.updateTime)return new Response('{}',{status:409});}
   for(const w of writes)docs.set(w.update.name,{fields:w.update.fields,updateTime:String(++version)});
   return Response.json({});
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
