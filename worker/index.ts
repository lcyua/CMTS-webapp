import {createRemoteJWKSet,jwtVerify,SignJWT} from 'jose';
import type {State} from '../src/domain';
import {loginStudentNumbers} from '../src/login-options';
import {nextAttempt,RateLimitError} from '../src/login-rate';
import {accessToken,ServiceAccount,signingKey,Store,UpstreamError} from './store';
import {digest,pinPassword} from './credentials';
import {StateRepository,CommandRateLimitError,type HistoryTable} from './state-repository';
import {updatePushDevice,preparePushWrites,pushControlPath,dispatchPush} from './push';
interface Env {FIREBASE_PROJECT_ID:string;CLASS_ID:string;ALLOWED_ORIGINS:string;FIREBASE_WEB_API_KEY:string;FIREBASE_SERVICE_ACCOUNT:string;STUDENT_PIN_PEPPER:string;PUSH_ENABLED?:string}
class HttpError extends Error {constructor(readonly status:number,message:string){super(message);}}
const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
async function user(sa:ServiceAccount,project:string,uid:string){
 const r=await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`,{method:'POST',headers:{Authorization:`Bearer ${await accessToken(sa)}`,'Content-Type':'application/json'},body:JSON.stringify({localId:[uid]})});
 if(!r.ok)throw new UpstreamError('Authentication unavailable');const body=await r.json() as any;const u=body.users?.[0];if(!u||u.disabled)throw new HttpError(401,'계정이 비활성화되었습니다.');return u;
}
export default {async fetch(req:Request,env:Env):Promise<Response>{
 const origin=req.headers.get('Origin');const allowed=env.ALLOWED_ORIGINS.split(',');
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 if(origin&&!allowed.includes(origin))return new Response(null,{status:403});
 if(origin)headers['Access-Control-Allow-Origin']=origin;
 headers['Access-Control-Allow-Headers']='Authorization,Content-Type';headers['Access-Control-Allow-Methods']='POST,OPTIONS';
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(new URL(req.url).pathname==='/health')return json({ok:true,service:'wooriban-api',apiVersion:2,configured:!!env.FIREBASE_SERVICE_ACCOUNT&&!!env.STUDENT_PIN_PEPPER,features:{history:true,push:env.PUSH_ENABLED==='true'}});
 try{
  if(req.method!=='POST')throw new HttpError(405,'POST required');
  const route=new URL(req.url).pathname;if(!['/portal','/studentLogin','/studentLoginOptions','/pushDevice'].includes(route))throw new HttpError(404,'Not found');
  // Bound streamed bodies too, even when Content-Length is missing or false.
  const reader=req.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536){await reader.cancel();throw new HttpError(413,'입력이 너무 큽니다.');}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let data:any;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'요청 입력을 확인하세요.');}if(!data||typeof data!=='object'||Array.isArray(data))throw new HttpError(400,'요청 입력을 확인하세요.');if(data.classId!==env.CLASS_ID)throw new HttpError(403,'학급 접근 권한이 없습니다.');
  const sa=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;if(sa.project_id!==env.FIREBASE_PROJECT_ID)throw Error('Server project mismatch');
  const store=new Store(env.FIREBASE_PROJECT_ID,()=>accessToken(sa)),statePath=`classes/${env.CLASS_ID}/private/state`;
  if(route==='/studentLoginOptions'){
   const state=store.value(await store.get(statePath));return json({studentNumbers:loginStudentNumbers(state?.members||[])});
  }
  if(route==='/studentLogin'){
   const {studentNo,pin}=data;if(typeof studentNo!=='string'||!/^\d{1,30}$/.test(studentNo)||typeof pin!=='string'||!/^\d{4}$/.test(pin))throw new HttpError(400,'학번과 4자리 비밀번호를 입력하세요.');
   const id=await digest(env.CLASS_ID+':'+studentNo),now=Date.now();
   const gates=[`loginLimits/account_${id}`,`loginLimits/ip_${await digest(req.headers.get('CF-Connecting-IP')||'unknown')}`];
   let windows:number[];
   try{windows=await store.change(gates,old=>{const next=old.map((v,i)=>({...nextAttempt(v||undefined,now,i===0?5:50),expiresAt:new Date(now+86400000)}));return {values:next,result:next.map(v=>v.start)};});}catch(e){if(e instanceof RateLimitError)throw new HttpError(429,'로그인 시도가 많습니다. 15분 뒤 다시 시도하세요.');throw new UpstreamError('Login availability check failed');}
   const account=store.value(await store.get(`classes/${env.CLASS_ID}/pinAccounts/${id}`));
   if(!account?.active||account.scheme!=='firebase-password-v1')throw new HttpError(401,'학번 또는 비밀번호가 일치하지 않습니다.');
   const password=await pinPassword(pin,env.STUDENT_PIN_PEPPER,account.salt);
   const check=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_WEB_API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:account.authEmail,password,returnSecureToken:true})});
   if(check.status>=500||check.status===429)throw new UpstreamError('Authentication unavailable');const verified=await check.json() as any;if(!check.ok||verified.localId!==account.uid)throw new HttpError(401,'학번 또는 비밀번호가 일치하지 않습니다.');
   const state=store.value(await store.get(statePath));if(!state?.members.some((m:any)=>m.id===account.uid&&m.active&&m.role==='student'&&m.studentNo===studentNo))throw new HttpError(401,'학번 또는 비밀번호가 일치하지 않습니다.');
   // signInWithPassword already rejects disabled accounts. Firebase checks again
   // when the client exchanges the custom token; portal also checks every request.
   await store.change(gates,old=>({values:old.map((v,i)=>v?.start===windows[i]?{...v,count:Math.max(0,v.count-1)}:v),result:null}));
   const token=await new SignJWT({uid:account.uid}).setProtectedHeader({alg:'RS256'}).setIssuer(sa.client_email).setSubject(sa.client_email).setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit').setIssuedAt().setExpirationTime('5m').sign(await signingKey(sa));
   return json({token});
  }
  const bearer=req.headers.get('Authorization');if(!bearer?.startsWith('Bearer '))throw new HttpError(401,'로그인이 필요합니다.');
  let claims;try{claims=(await jwtVerify(bearer.slice(7),jwks,{issuer:`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,audience:env.FIREBASE_PROJECT_ID,algorithms:['RS256']})).payload;}catch{throw new HttpError(401,'다시 로그인하세요.');}
  if(!claims.sub)throw new HttpError(401,'다시 로그인하세요.');const uid=claims.sub,u=await user(sa,env.FIREBASE_PROJECT_ID,uid);
  if(Number(claims.auth_time||0)<Number(u.validSince||0))throw new HttpError(401,'다시 로그인하세요.');
  if(route==='/pushDevice'){
   const state=store.value(await store.get(statePath)) as State|null;if(!state)throw new HttpError(404,'학급이 설정되지 않았습니다.');
   return json(await updatePushDevice(store,env.CLASS_ID,uid,state,data,env.PUSH_ENABLED==='true'));
  }
  const {action,p={},key}=data;
  const repository=new StateRepository(store,env.CLASS_ID);
  if(action==='readState'){
   const state=await repository.readState(uid);
   // Keep the previous deployed UI usable while Hosting and Worker releases roll forward.
   if(data.clientVersion!==2){
    const tables:HistoryTable[]=['events','attempts','inbox','requests','exams'];if(state.members.find(member=>member.id===uid)?.role==='teacher')tables.push('payouts');
    for(const table of tables){const page=await repository.listHistory(uid,table,null,50);const rows=new Map(state[table].map(row=>[row.id,row]));for(const row of page.records)rows.set(row.id,row);state[table]=[...rows.values()];}
    for(const row of [...state.requests,...state.exams])row.version??=1;
   }
   return json(state);
  }
  if(action==='readHistory'){
   if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.table!=='string'||(p.cursor!==undefined&&typeof p.cursor!=='string')||(p.limit!==undefined&&typeof p.limit!=='number'))throw new HttpError(400,'기록 조회 입력을 확인하세요.');
   return json(await repository.listHistory(uid,p.table as HistoryTable,p.cursor,p.limit??25));
  }
  if(typeof key!=='string'||!/^[-a-zA-Z0-9_]{1,120}$/.test(key)||!p||typeof p!=='object'||Array.isArray(p))throw new HttpError(400,'요청 입력을 확인하세요.');
  const pushEnabled=env.PUSH_ENABLED==='true';
  await repository.execute(uid,action,p,key,Date.now(),pushEnabled?{extraPaths:[pushControlPath(env.CLASS_ID)],plan:async({before,after,docs,now,writeCapacity})=>preparePushWrites(store,env.CLASS_ID,new Set(before.inbox.map(n=>n.id)),after,docs.get(pushControlPath(env.CLASS_ID))||null,now,writeCapacity)}:{});
  return json({ok:true});
 }catch(e){const status=e instanceof HttpError?e.status:e instanceof CommandRateLimitError?429:e instanceof UpstreamError||e instanceof TypeError?503:400;return json({error:status>=500?'서버 연결을 확인한 뒤 다시 시도하세요.':e instanceof Error?e.message:'처리 실패'},status);}
},async scheduled(_event:unknown,env:Env,ctx:{waitUntil(promise:Promise<unknown>):void}){
 if(env.PUSH_ENABLED!=='true')return;
 ctx.waitUntil((async()=>{const sa=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;if(sa.project_id!==env.FIREBASE_PROJECT_ID)throw new UpstreamError('Server project mismatch');const store=new Store(env.FIREBASE_PROJECT_ID,()=>accessToken(sa));await dispatchPush(store,env.CLASS_ID,()=>accessToken(sa),{enabled:true,maxJobs:1,isUserActive:async uid=>{try{await user(sa,env.FIREBASE_PROJECT_ID,uid);return true;}catch(e){if(e instanceof HttpError&&e.status===401)return false;throw e;}}});})());
}};
