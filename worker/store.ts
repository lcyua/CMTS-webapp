import {importPKCS8, SignJWT} from 'jose';
export class UpstreamError extends Error {}
export interface ServiceAccount {client_email:string;private_key:string;project_id:string}
export interface Document {name:string;fields:Record<string,any>;updateTime:string}
export const encode=(v:any):any=>v===null?{nullValue:null}:v instanceof Date?{timestampValue:v.toISOString()}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?(Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}):Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
export const decode=(v:any):any=>'nullValue'in v?null:'stringValue'in v?v.stringValue:'booleanValue'in v?v.booleanValue:'integerValue'in v?Number(v.integerValue):'doubleValue'in v?v.doubleValue:'timestampValue'in v?v.timestampValue:'arrayValue'in v?(v.arrayValue.values||[]).map(decode):Object.fromEntries(Object.entries(v.mapValue?.fields||{}).map(([k,x])=>[k,decode(x)]));
let cached:{identity:string;token:string;until:number}|undefined;
let keyCache:{privateKey:string;key:ReturnType<typeof importPKCS8>}|undefined;
let tokenFlight:{identity:string;promise:Promise<string>}|undefined;
export function signingKey(sa:ServiceAccount){
 if(keyCache?.privateKey===sa.private_key)return keyCache.key;
 const key=importPKCS8(sa.private_key,'RS256');keyCache={privateKey:sa.private_key,key};return key;
}
export async function accessToken(sa:ServiceAccount){
 const identity=sa.client_email+'\n'+sa.private_key;
 if(cached?.identity===identity&&cached.until>Date.now())return cached.token;
 if(tokenFlight?.identity===identity)return tokenFlight.promise;
 const promise=(async()=>{
  const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase'}).setProtectedHeader({alg:'RS256'}).setIssuer(sa.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(await signingKey(sa));
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  if(!r.ok){await r.body?.cancel();throw new UpstreamError('Server authentication unavailable');}const data=await r.json() as any;
  if(typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(data.expires_in))throw new UpstreamError('Server authentication unavailable');
  cached={identity,token:data.access_token,until:Date.now()+Math.max(0,data.expires_in-120)*1000};return cached.token;
 })();
 tokenFlight={identity,promise};
 try{return await promise;}finally{if(tokenFlight?.promise===promise)tokenFlight=undefined;}
}
export class Conflict extends Error{}
export class Store {
 base:string;
 constructor(readonly project:string,readonly token:()=>Promise<string>){this.base=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;}
 async request(url:string,init:RequestInit={}){
  const r=await fetch(url,{...init,headers:{'Content-Type':'application/json',Authorization:`Bearer ${await this.token()}`,...init.headers}});
  if(r.status===409||r.status===412){await r.body?.cancel();throw new Conflict();}
  if(!r.ok){
   // Firestore REST also reports stale updateTime preconditions as HTTP 400.
   if(r.status===400){const error=await r.json().catch(()=>null) as {error?:{status?:string}}|null;if(['FAILED_PRECONDITION','ABORTED'].includes(error?.error?.status||''))throw new Conflict();}
   if(!r.bodyUsed)await r.body?.cancel();throw new UpstreamError(`Database unavailable (${r.status})`);
  }return r;
 }
 async get(path:string):Promise<Document|null>{const r=await fetch(`${this.base}/${path}`,{headers:{Authorization:`Bearer ${await this.token()}`}});if(r.status===404)return null;if(!r.ok){await r.body?.cancel();throw new UpstreamError('Database unavailable');}return r.json();}
 async getMany(paths:string[]):Promise<(Document|null)[]>{
  if(paths.length===1)return [await this.get(paths[0])];
  const names=paths.map(path=>`projects/${this.project}/databases/(default)/documents/${path}`);
  const response=await this.request(`${this.base}:batchGet`,{method:'POST',body:JSON.stringify({documents:names})});
  const results=await response.json() as {found?:Document;missing?:string}[];
  const docs=new Map(results.map(result=>result.found?[result.found.name,result.found] as const:[result.missing,null] as const));
  return names.map(name=>{if(!docs.has(name))throw Error('Database response incomplete');return docs.get(name)!;});
 }
 value(doc:Document|null){return doc?decode({mapValue:{fields:doc.fields}}):null;}
 async put(writes:{path:string;value:unknown;previous:Document|null}[]){await this.request(`${this.base}:commit`,{method:'POST',body:JSON.stringify({writes:writes.map(w=>({update:{name:`projects/${this.project}/databases/(default)/documents/${w.path}`,fields:encode(w.value).mapValue.fields},currentDocument:w.previous?{updateTime:w.previous.updateTime}:{exists:false}}))})});}
 async change<T>(paths:string[],fn:(values:any[])=>{values:any[];result:T}){
  for(let attempt=0;attempt<8;attempt++){
   const docs=await this.getMany(paths);const next=fn(docs.map(d=>this.value(d)));
   try{await this.put(paths.map((path,i)=>({path,value:next.values[i],previous:docs[i]})));return next.result;}catch(e){if(!(e instanceof Conflict))throw e;}
  }throw new UpstreamError('다른 요청이 처리 중입니다. 잠시 후 다시 시도하세요.');
 }
}
