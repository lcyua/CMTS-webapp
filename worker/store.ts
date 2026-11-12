import {importPKCS8, SignJWT} from 'jose';
export interface ServiceAccount {client_email:string;private_key:string;project_id:string}
export interface Document {name:string;fields:Record<string,any>;updateTime:string}
export const encode=(v:any):any=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?(Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}):Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
export const decode=(v:any):any=>'nullValue'in v?null:'stringValue'in v?v.stringValue:'booleanValue'in v?v.booleanValue:'integerValue'in v?Number(v.integerValue):'doubleValue'in v?v.doubleValue:'timestampValue'in v?v.timestampValue:'arrayValue'in v?(v.arrayValue.values||[]).map(decode):Object.fromEntries(Object.entries(v.mapValue?.fields||{}).map(([k,x])=>[k,decode(x)]));
let cached:{email:string;token:string;until:number}|undefined;
export async function signingKey(sa:ServiceAccount){return importPKCS8(sa.private_key,'RS256');}
export async function accessToken(sa:ServiceAccount){
 if(cached?.email===sa.client_email&&cached.until>Date.now())return cached.token;
 const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase'}).setProtectedHeader({alg:'RS256'}).setIssuer(sa.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(await signingKey(sa));
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
 if(!r.ok)throw Error('Server authentication unavailable');const data=await r.json() as any;
 cached={email:sa.client_email,token:data.access_token,until:Date.now()+Math.max(0,data.expires_in-120)*1000};return cached.token;
}
export class Conflict extends Error{}
export class Store {
 base:string;
 constructor(readonly project:string,readonly token:()=>Promise<string>){this.base=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;}
 async request(url:string,init:RequestInit={}){const r=await fetch(url,{...init,headers:{'Content-Type':'application/json',Authorization:`Bearer ${await this.token()}`,...init.headers}});if(r.status===409||r.status===412)throw new Conflict();if(!r.ok){await r.body?.cancel();throw Error(`Database unavailable (${r.status})`);}return r;}
 async get(path:string):Promise<Document|null>{const r=await fetch(`${this.base}/${path}`,{headers:{Authorization:`Bearer ${await this.token()}`}});if(r.status===404)return null;if(!r.ok){await r.body?.cancel();throw Error('Database unavailable');}return r.json();}
 value(doc:Document|null){return doc?decode({mapValue:{fields:doc.fields}}):null;}
 async put(writes:{path:string;value:unknown;previous:Document|null}[]){await this.request(`${this.base}:commit`,{method:'POST',body:JSON.stringify({writes:writes.map(w=>({update:{name:`projects/${this.project}/databases/(default)/documents/${w.path}`,fields:encode(w.value).mapValue.fields},currentDocument:w.previous?{updateTime:w.previous.updateTime}:{exists:false}}))})});}
 async change<T>(paths:string[],fn:(values:any[])=>{values:any[];result:T}){
  for(let attempt=0;attempt<8;attempt++){
   const docs=await Promise.all(paths.map(p=>this.get(p)));const next=fn(docs.map(d=>this.value(d)));
   try{await this.put(paths.map((path,i)=>({path,value:next.values[i],previous:docs[i]})));return next.result;}catch(e){if(!(e instanceof Conflict))throw e;}
  }throw Error('다른 요청이 처리 중입니다. 잠시 후 다시 시도하세요.');
 }
}
