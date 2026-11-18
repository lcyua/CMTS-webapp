import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,exportPKCS8,SignJWT} from 'jose';
import worker from '../worker/index';
import {encode,decode} from '../worker/store';
import {seed} from '../src/seed';

test('Worker HTTP verifies identities, membership, roles, revocation and private responses',async()=>{
 const original=globalThis.fetch;
 const {privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true});
 const jwk={...await exportJWK(publicKey),kid:'fixture-key',alg:'RS256',use:'sig'};
 const project='demo-class-portal',classId='fixture-class';
 const prefix=`projects/${project}/databases/(default)/documents/`;
 const docs=new Map<string,{fields:any;updateTime:string}>();let version=1,commits=0,databaseDown=false;
 docs.set(prefix+`classes/${classId}/private/state`,{fields:encode(seed()).mapValue.fields,updateTime:String(version)});
 const accounts=new Map(['teacher','student1','student2','outsider'].map(uid=>[uid,{localId:uid,validSince:'0',disabled:false}]));
 globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url==='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')return Response.json({keys:[jwk]});
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-oauth-token',expires_in:3600});
  if(url===`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`){
   const uid=JSON.parse(String(init?.body)).localId[0];return Response.json({users:accounts.has(uid)?[accounts.get(uid)]:[]});
  }
  if(url.startsWith('https://firestore.googleapis.com/')){
   if(databaseDown)return Response.json({error:{status:'UNAVAILABLE'}},{status:503});
   if(url.endsWith(':runQuery'))return Response.json([]);
   if(url.endsWith(':batchGet')){
    const {documents}=JSON.parse(String(init?.body));
    return Response.json(documents.map((name:string)=>{const doc=docs.get(name);return doc?{found:{name,...doc}}:{missing:name};}).reverse());
   }
   if(url.endsWith(':commit')){
    const {writes}=JSON.parse(String(init?.body));
    for(const write of writes){const name=write.update?.name||write.delete;const previous=docs.get(name);const condition=write.currentDocument;if(condition&&(condition.exists===false?!!previous:condition.updateTime&&condition.updateTime!==previous?.updateTime))return Response.json({error:{status:'FAILED_PRECONDITION'}},{status:400});}
    for(const write of writes){const name=write.update?.name||write.delete;if(write.delete)docs.delete(name);else docs.set(name,{fields:write.update.fields,updateTime:String(++version)});}commits++;
    return Response.json({});
   }
   const name=url.slice(url.indexOf('projects/'));const doc=docs.get(name);
   return doc?Response.json({name,...doc}):new Response('{}',{status:404});
  }
  throw Error('Fixture denied an unexpected outbound request: '+url.split('?')[0]);
 };
 const env={FIREBASE_PROJECT_ID:project,CLASS_ID:classId,ALLOWED_ORIGINS:'https://fixture.example',FIREBASE_WEB_API_KEY:'fixture-public-key',FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:project,client_email:'fixture@example.invalid',private_key:await exportPKCS8(privateKey)}),STUDENT_PIN_PEPPER:'fixture-only-'.repeat(4)};
 async function token(uid:string,authTime=Math.floor(Date.now()/1000)){
  return new SignJWT({auth_time:authTime}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(`https://securetoken.google.com/${project}`).setAudience(project).setSubject(uid).setIssuedAt().setExpirationTime('5m').sign(privateKey);
 }
 async function request(uid:string|null,action:string,p:object={},key=crypto.randomUUID(),classOverride=classId){
  const headers:Record<string,string>={'Content-Type':'application/json',Origin:'https://fixture.example'};if(uid)headers.Authorization='Bearer '+await token(uid);
  return worker.fetch(new Request('https://fixture-api.example/portal',{method:'POST',headers,body:JSON.stringify({classId:classOverride,action,p,key})}),env);
 }
 try{
  assert.equal((await request(null,'readState')).status,401);
  assert.equal((await request('outsider','readState')).status,400);
  assert.equal((await request('student1','readState',{},crypto.randomUUID(),'other-class')).status,403);
  const response=await request('student1','readState');assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const state:any=await response.json();
  for(const table of ['lots','events','requests','attempts','exams','inbox'])assert.ok(state[table].every((row:any)=>row.uid==='student1'));
  assert.ok(state.quizzes.every((quiz:any)=>!('answer'in quiz)&&!('explanation'in quiz)));
  assert.deepEqual(state.audits,[]);assert.deepEqual(state.payouts,[]);
  const beforeCommits=commits;
  assert.equal((await request('student1','points',{uid:'student1',amount:100,reason:'forbidden'})).status,400);
  assert.equal(commits,beforeCommits,'Rejected student commands must not write');
  const teacherState:any=await(await request('teacher','readState')).json();assert.equal(teacherState.quizzes[0].answer,2);
  const now=Math.floor(Date.now()/1000);accounts.get('student1')!.validSince=String(now+60);
  assert.equal((await request('student1','readState')).status,401);
  accounts.get('student1')!.validSince='0';accounts.get('student1')!.disabled=true;
  assert.equal((await request('student1','readState')).status,401);
  const forbiddenOrigin=await worker.fetch(new Request('https://fixture-api.example/portal',{method:'POST',headers:{Origin:'https://untrusted.example'},body:'{}'}),env);
  assert.equal(forbiddenOrigin.status,403);
  assert.equal(decode({mapValue:{fields:docs.get(prefix+`classes/${classId}/private/state`)!.fields}}).members.length,3);
  databaseDown=true;
  const options=await worker.fetch(new Request('https://fixture-api.example/studentLoginOptions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({classId})}),env);
  assert.equal(options.status,503);assert.doesNotMatch(JSON.stringify(await options.json()),/Database|UNAVAILABLE/);
  const unavailableLogin=await worker.fetch(new Request('https://fixture-api.example/studentLogin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({classId,studentNo:'01101',pin:'0000'})}),env);
  assert.equal(unavailableLogin.status,503,'An outage is not a 15-minute login lockout');
 }finally{globalThis.fetch=original;}
});
