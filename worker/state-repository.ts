import {command,visible,type State,type RecordData} from '../src/domain';
import {Store,Conflict,encode,type Document} from './store';
import {commandInput} from '../src/validation';

export const HISTORY_TABLES=['audits','events','attempts','lots','inbox','payouts','requests','exams','quizzes','notices'] as const;
export type HistoryTable=typeof HISTORY_TABLES[number];
export const STORAGE_META_KEY='_storage';
export interface Write {path:string;value:unknown;previous:Document|null}
export class CommandRateLimitError extends Error {readonly status=429;constructor(){super('요청이 많습니다. 1분 뒤 다시 시도하세요.');}}
interface Metadata {version:1;generation?:string;gates?:Record<string,{start:number;count:number}>;balances?:Record<string,Record<string,{available:number;reserved:number}>>;nextSequence:number;revision:number;activeNotices?:number;counts:Record<string,number>;ownerCounts:Record<string,Record<string,number>>;unreadInbox:Record<string,number>}
type StoredState=State&{_storage?:Metadata};
export interface StoredRecord {document:Document;path:string;record:RecordData;sequence:number}
export interface ExecuteOptions {extraPaths?:string[];plan?:(context:{before:State;after:State;docs:Map<string,Document|null>;now:number;writeCapacity:number})=>Promise<{writes:Write[]}>|{writes:Write[]}}
export interface HistoryPage {records:RecordData[];cursor:string|null;nextCursor:string|null;legacyRemaining:number}
const PERSONAL=new Set<HistoryTable>(['events','attempts','inbox','exams','requests','notices']);
const MAX_QUERY=4096, MIGRATION_BATCH=80, RECENT=50;
const pathOf=(d:Document)=>d.name.slice(d.name.indexOf('/documents/')+11);
export function historyCollectionPath(classId:string,table:HistoryTable,generation?:string,uid?:string){if(generation&&!/^[-a-zA-Z0-9_]{1,80}$/.test(generation))throw Error('Invalid storage generation.');const base=generation?`classes/${classId}/storageGenerations/${generation}`:`classes/${classId}`;return uid?`${base}/members/${uid}/history_${table}`:`${base}/history_${table}`;}
const primary=(classId:string,table:HistoryTable,generation?:string)=>historyCollectionPath(classId,table,generation);
const ownerView=(classId:string,uid:string,table:HistoryTable,generation?:string)=>historyCollectionPath(classId,table,generation,uid);
const stamp=(record:RecordData)=>Number.isFinite(record.at)?record.at:Number.isFinite(record.acquiredAt)?record.acquiredAt:Number.isFinite(record.createdAt)?record.createdAt:0;
const recordId=(record:RecordData,sequence:number)=>`${String(Math.max(0,Math.trunc(stamp(record)))).padStart(16,'0')}_${String(sequence).padStart(16,'0')}`;
const initialMeta=():Metadata=>({version:1,nextSequence:0,revision:0,activeNotices:0,balances:{},counts:{},ownerCounts:{},unreadInbox:{}});
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const wrapper=(table:HistoryTable,record:RecordData,sequence:number)=>({record,sequence,...(table==='quizzes'?{publishedDate:record.active?record.date:null}:{}),...(table==='notices'?{importantActive:!!record.active&&!!record.important}:{})});
const owner=(record:RecordData)=>typeof record.uid==='string'?record.uid:null;
function adjustBalance(meta:Metadata,record:RecordData,direction:number){
 const uid=owner(record);if(!uid||!Number.isFinite(record.expiresAt))throw Error('Invalid lot balance metadata.');
 const buckets=(meta.balances??={})[uid]??=((meta.balances??={})[uid]={});const key=String(record.expiresAt),bucket=buckets[key]??={available:0,reserved:0};
 bucket.available+=direction*Number(record.available||0);bucket.reserved+=direction*Number(record.reserved||0);
 if(bucket.available<0||bucket.reserved<0||!Number.isSafeInteger(bucket.available)||!Number.isSafeInteger(bucket.reserved))throw Error('Invalid lot balance totals.');
 if(!bucket.available&&!bucket.reserved)delete buckets[key];
}

async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
async function query(store:Store,collection:string,options:{field?:string;op?:string;value?:unknown;limit?:number;after?:string;complete?:boolean}={}):Promise<StoredRecord[]>{
 const slash=collection.lastIndexOf('/'),parent=collection.slice(0,slash),collectionId=collection.slice(slash+1);const maximum=options.limit??MAX_QUERY;const rows:StoredRecord[]=[];let after=options.after;let afterValues:any[]|undefined=after?[{referenceValue:after}]:undefined;
 do{
  const pageLimit=Math.min(500,maximum-rows.length+(options.complete?1:0));
  const structuredQuery:any={from:[{collectionId}],orderBy:[{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:pageLimit};
  // Use a single equality/inequality field. For inequality filters Firestore requires that field first.
  if(options.field){structuredQuery.where={fieldFilter:{field:{fieldPath:options.field},op:options.op||'EQUAL',value:encode(options.value)}};if(options.op&&options.op!=='EQUAL'&&options.op!=='IN')structuredQuery.orderBy=[{field:{fieldPath:options.field},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}];}
  if(afterValues)structuredQuery.startAt={values:afterValues,before:false};
  const response=await store.request(`${store.base}/${parent}:runQuery`,{method:'POST',body:JSON.stringify({structuredQuery})});const result=await response.json() as {document?:Document}[];const docs=result.flatMap(x=>x.document?[x.document]:[]);
  for(const document of docs){const value=store.value(document);if(!value?.record||typeof value.record!=='object')throw Error('Invalid partition record.');rows.push({document,path:pathOf(document),record:value.record,sequence:Number(value.sequence)||0});}
  if(rows.length>maximum)throw Error('조회 한도입니다. 관리자에게 문의하세요.');
  if(!options.complete||docs.length<pageLimit)return rows;
  after=docs.at(-1)?.name;const last=rows.at(-1)!;afterValues=structuredQuery.orderBy.length===1?[{referenceValue:after}]:[encode(last.record[options.field!.slice(7)]),{referenceValue:after}];
 }while(rows.length<maximum);
 if(options.complete)throw Error('조회 한도입니다. 관리자에게 문의하세요.');return rows;
}
export async function findStoredRecord(store:Store,classId:string,table:HistoryTable,id:string,generation?:string):Promise<StoredRecord|null>{if(generation===undefined){const state=store.value(await store.get(`classes/${classId}/private/state`));generation=state?._storage?.generation;}const records=await query(store,primary(classId,table,generation),{field:'record.id',value:id,limit:2});if(records.length>1)throw Error('중복 기록 ID입니다. 관리자에게 문의하세요.');return records[0]||null;}
function auditKey(record:RecordData):string|null{
 if(typeof record.actor!=='string'||typeof record.input!=='string'||typeof record.id!=='string')return null;
 for(const prefix of [`${record.actor.length}_${record.actor}_`,record.actor+'_'])if(record.id.startsWith(prefix)){const key=record.id.slice(prefix.length);if(/^[-a-zA-Z0-9_]{1,120}$/.test(key))return key;}return null;
}
function member(state:State,uid:string){const found=state.members.find(m=>m.id===uid&&m.active&&['student','teacher'].includes(m.role));if(!found)throw Error('활성 학급 계정이 필요합니다.');return found;}
function legacyCount(state:State){return HISTORY_TABLES.reduce((n,t)=>n+state[t].length,0);}

/** Prepare a complete logical snapshot for a fresh, atomic partition restore. */
export function partitionState(source:State,classId:string,startSequence=0,generation?:string,now=Date.now()){
 if(!/^[-a-zA-Z0-9_]{1,80}$/.test(classId)||!Number.isSafeInteger(startSequence)||startSequence<0)throw Error('Invalid partition restore input.');
 const main=structuredClone(source) as StoredState,meta=initialMeta();meta.nextSequence=startSequence;if(generation)meta.generation=generation;
 const records:{path:string;value:unknown}[]=[];
 for(const table of HISTORY_TABLES){for(const record of source[table]){const sequence=++meta.nextSequence,id=recordId(record,sequence),value=wrapper(table,structuredClone(record),sequence);records.push({path:`${primary(classId,table,generation)}/${id}`,value});meta.counts[table]=(meta.counts[table]||0)+1;if(table==='notices'&&record.active)meta.activeNotices=(meta.activeNotices||0)+1;const uid=owner(record);if(uid){records.push({path:`${ownerView(classId,uid,table,generation)}/${id}`,value});const counts=meta.ownerCounts[uid]??={};counts[table]=(counts[table]||0)+1;if(table==='inbox'&&!record.read)meta.unreadInbox[uid]=(meta.unreadInbox[uid]||0)+1;if(table==='lots')adjustBalance(meta,record,1);}}main[table]=[];}
 for(const buckets of Object.values(meta.balances||{}))for(const [expiresAt,bucket] of Object.entries(buckets))if(Number(expiresAt)<=now&&!bucket.reserved)delete buckets[expiresAt];
 main._storage=meta;return {main,records,nextSequence:meta.nextSequence};
}

export class StateRepository {
 readonly statePath:string;
 constructor(readonly store:Store,readonly classId:string){if(!/^[-a-zA-Z0-9_]{1,80}$/.test(classId))throw Error('학급 ID 오류');this.statePath=`classes/${classId}/private/state`;}
 private async receiptPath(uid:string,key:string){return `classes/${this.classId}/commandReceipts/${await hash(JSON.stringify([uid,key]))}`;}
 private async hydrate(state:StoredState,uid:string,action:string,p:RecordData,now:number){
  const generation=state._storage?.generation;const loaded=new Map<HistoryTable,StoredRecord[]>();const add=async(table:HistoryTable,opts:Parameters<typeof query>[2]={},own?:string)=>{const rows=await query(this.store,own?ownerView(this.classId,own,table,generation):primary(this.classId,table,generation),{...opts,complete:opts?.complete??true});const previous=loaded.get(table)||[];const names=new Set(previous.map(r=>r.path));for(const row of rows)if(!names.has(row.path)){previous.push(row);names.add(row.path);}loaded.set(table,previous);};
  const lots=async(target:string)=>{await add('lots',{field:'record.expiresAt',op:'GREATER_THAN',value:now},target);await add('lots',{field:'record.reserved',op:'GREATER_THAN',value:0},target);};
  if(action==='shop'){await lots(uid);await add('requests',{field:'record.status',value:'pending'},uid);}
  else if(action==='points')await lots(String(p.uid));
  else if(action==='requestStatus'){const found=state.requests.find(x=>x.id===p.id)||((await findStoredRecord(this.store,this.classId,'requests',String(p.id)))?.record);if(found){if(state.members.find(m=>m.id===uid)?.role!=='teacher'&&found.uid!==uid)throw Error('본인 신청만 취소할 수 있습니다.');await lots(String(found.uid));await add('requests',{field:'record.id',value:p.id,limit:2});}}
  else if(action==='payout')await add('payouts',{field:'record.month',value:p.month});
  else if(action==='quiz'){const date=new Date(now+9*3600000).toISOString().slice(0,10);await add('quizzes',{field:'publishedDate',value:date});await add('attempts',{field:'record.date',value:date},uid);}
  else if(action==='exam'){await add('exams',{field:'record.date',op:'GREATER_THAN_OR_EQUAL',value:new Date(now+9*3600000).toISOString().slice(0,10)},uid);await add('exams',{field:'record.status',value:'pending'},uid);if(p.id)await add('exams',{field:'record.id',value:p.id,limit:2},uid);}
  else if(action==='examStatus')await add('exams',{field:'record.id',value:p.id,limit:2},state.members.find(m=>m.id===uid)?.role==='teacher'?undefined:uid);
  else if(action==='save'&&p.table==='quizzes'){if(p.id)await add('quizzes',{field:'record.id',value:p.id,limit:2});const old=state.quizzes.find(x=>x.id===p.id)||loaded.get('quizzes')?.find(x=>x.record.id===p.id)?.record;for(const date of new Set([old?.date,p.data?.date].filter(Boolean))){await add('quizzes',{field:'publishedDate',value:date});await add('attempts',{field:'record.date',value:date});}}
  else if(action==='save'&&p.table==='notices'&&p.id)await add('notices',{field:'record.id',value:p.id,limit:2});
  else if(action==='read'){
   if(typeof p.id==='string'&&/^archive_\d{16}_\d{16}$/.test(p.id)){const id=p.id.slice(8),document=await this.store.get(`${primary(this.classId,'inbox',generation)}/${id}`);if(document){const value=this.store.value(document);loaded.set('inbox',[{document,path:pathOf(document),record:{...value.record,id:p.id},sequence:value.sequence}]);}}
   else await add('inbox',{field:'record.id',value:p.id,limit:2},uid);
  }
  for(const [table,rows] of loaded){const ids=new Set(state[table].map(x=>x.id));for(const row of rows)if(!ids.has(row.record.id)){state[table].push(structuredClone(row.record));ids.add(row.record.id);}}
  return loaded;
 }
 async execute(uid:string,action:string,p:RecordData,key:string,now=Date.now(),options:ExecuteOptions={}){
  commandInput(action,p,key);const input=JSON.stringify({action,p}),receiptPath=await this.receiptPath(uid,key);
  for(let attempt=0;attempt<8;attempt++){
   const stateDoc=await this.store.get(this.statePath);if(!stateDoc)throw Error('학급이 설정되지 않았습니다.');const source=this.store.value(stateDoc) as StoredState;const me=member(source,uid);if(['points','payout','save','member','notify'].includes(action)&&me.role!=='teacher')throw Error('교사 권한이 필요합니다.');if(['shop','quiz','exam'].includes(action)&&me.role!=='student')throw Error('학생 계정으로 이용하세요.');if(['requestStatus','examStatus'].includes(action)&&p.status!=='cancelled'&&me.role!=='teacher')throw Error('교사 권한이 필요합니다.');const meta:Metadata=structuredClone(source._storage||initialMeta());if(meta.version!==1)throw Error('지원하지 않는 저장소 버전입니다.');const generation=meta.generation;
   const receiptDoc=await this.store.get(receiptPath),receipt=this.store.value(receiptDoc);if(receipt){if(receipt.actor!==uid||receipt.key!==key||receipt.input!==input)throw Error('동일 요청 키의 입력이 다릅니다.');return {duplicate:true,migrated:0,legacyRemaining:legacyCount(source)};}
   const previousGate=meta.gates?.[uid];const gate=!previousGate||now>=previousGate.start+60000?{start:now,count:0}:{...previousGate};if(gate.count>=30)throw new CommandRateLimitError();gate.count++;(meta.gates??={})[uid]=gate;
   const extraPaths=[...new Set(options.extraPaths||[])];const extraDocs=extraPaths.length?await this.store.getMany(extraPaths):[];const docs=new Map(extraPaths.map((path,i)=>[path,extraDocs[i]]));
   const state=structuredClone(source);const loaded=await this.hydrate(state,uid,action,p,now);const before=structuredClone(state);command(state,uid,action,p,key,now);
   const writes=new Map<string,Write>();const addWrite=(write:Write)=>{const prior=writes.get(write.path);if(prior&&!same(prior.value,write.value))throw Error('Conflicting writes in command.');writes.set(write.path,write);};
   if(!source._storage)addWrite({path:`classes/${this.classId}/migrationBackups/${await hash(stateDoc.updateTime)}`,value:{state:source,sourceUpdateTime:stateDoc.updateTime,createdAt:now},previous:null});
   const legacyReplay=source.audits.some(a=>a.actor===uid&&auditKey(a)===key&&a.input===input);
   const cache=new Map<string,Document|null>([[this.statePath,stateDoc],[receiptPath,receiptDoc],...docs]);
   const wanted=new Set<string>();let compulsoryCost=2+writes.size;
   for(const table of HISTORY_TABLES){const legacy=new Map(source[table].map(r=>[r.id,r])),prior=new Map(before[table].map(r=>[r.id,r]));for(const row of state[table]){const old=legacy.get(row.id),stored=loaded.get(table)?.find(r=>r.record.id===row.id);if(old&&same(old,row))continue;if(stored&&same(prior.get(row.id),row))continue;compulsoryCost+=1+(owner(row)?1:0);if(stored){const id=stored.path.split('/').at(-1)!;cache.set(stored.path,stored.document);wanted.add(`${primary(this.classId,table,generation)}/${id}`);const target=owner(row);if(target)wanted.add(`${ownerView(this.classId,target,table,generation)}/${id}`);}}}
   if(options.plan&&!legacyReplay){const priorWrites=writes.size;const planned=await options.plan({before,after:state,docs,now,writeCapacity:Math.max(0,500-compulsoryCost)});for(const write of planned.writes)addWrite(write);compulsoryCost+=writes.size-priorWrites;}
   const migrationLimit=Math.max(0,Math.min(MIGRATION_BATCH,Math.floor((500-compulsoryCost)/3)));
   let prospectiveMigration=0;for(const table of HISTORY_TABLES)for(const [index,legacy] of source[table].entries()){const current=state[table][index]||legacy;if(!same(current,legacy)||prospectiveMigration<migrationLimit){if(same(current,legacy))prospectiveMigration++;if(table==='audits'){const originalKey=auditKey(current);if(originalKey)wanted.add(await this.receiptPath(current.actor,originalKey));}}}
   const missing=[...wanted].filter(path=>!cache.has(path));for(let i=0;i<missing.length;i+=100){const paths=missing.slice(i,i+100),documents=await this.store.getMany(paths);paths.forEach((path,index)=>cache.set(path,documents[index]));}
   const cachedDoc=async(path:string)=>{if(!cache.has(path))cache.set(path,await this.store.get(path));return cache.get(path)!;};
   const ownedCounts=(uid:string)=>(meta.ownerCounts[uid]??={});let migrated=0,optionalMigrated=0;
   const updateViews=async(table:HistoryTable,row:RecordData,stored?:StoredRecord,legacy=false)=>{
    let sequence:number,id:string,old:Document|null,record=row;
    if(stored){sequence=stored.sequence;id=stored.path.split('/').at(-1)!;const oldValue=this.store.value(stored.document);if(table==='inbox'&&String(row.id).startsWith('archive_'))record={...row,id:oldValue.record.id};old=stored.path.startsWith(primary(this.classId,table,generation)+'/')?stored.document:await cachedDoc(`${primary(this.classId,table,generation)}/${id}`);}
    else {sequence=++meta.nextSequence;id=recordId(row,sequence);old=null;meta.counts[table]=(meta.counts[table]||0)+1;const target=owner(row);if(target)ownedCounts(target)[table]=(ownedCounts(target)[table]||0)+1;}
    const value=wrapper(table,record,sequence);addWrite({path:`${primary(this.classId,table,generation)}/${id}`,value,previous:old});const target=owner(record);
    if(target){const path=`${ownerView(this.classId,target,table,generation)}/${id}`;const previous=stored?stored.path===path?stored.document:await cachedDoc(path):null;addWrite({path,value,previous});}
    if(table==='notices'){const oldRecord=stored?this.store.value(stored.document).record:null;meta.activeNotices=(meta.activeNotices||0)+(record.active?1:0)-(oldRecord?.active?1:0);}
    if(table==='lots'){if(stored)adjustBalance(meta,this.store.value(stored.document).record,-1);adjustBalance(meta,record,1);}
    if(table==='inbox'&&target){const oldRecord=stored?this.store.value(stored.document).record:null;const difference=(!record.read?1:0)-(oldRecord&&!oldRecord.read?1:0);meta.unreadInbox[target]=Math.max(0,(meta.unreadInbox[target]||0)+difference);}
    if(table==='audits'){const originalKey=auditKey(record);if(originalKey){const path=await this.receiptPath(record.actor,originalKey);if(path!==receiptPath){const previous=await cachedDoc(path);const value={actor:record.actor,key:originalKey,input:record.input,at:record.at};if(previous){const oldReceipt=this.store.value(previous);if(oldReceipt.actor!==value.actor||oldReceipt.key!==value.key||oldReceipt.input!==value.input)throw Error('Legacy receipt conflict.');}else addWrite({path,value,previous:null});}}}
    if(legacy)migrated++;
   };
   for(const table of HISTORY_TABLES){
    const legacyRows=source[table];const loadedRows=loaded.get(table)||[];const remaining:RecordData[]=[];const beforeById=new Map(before[table].map(r=>[r.id,r]));
    for(let index=0;index<legacyRows.length;index++){const legacy=legacyRows[index];const current=state[table][index]||legacy;const changed=!same(current,legacy);if(changed||optionalMigrated<migrationLimit){await updateViews(table,current,undefined,true);if(!changed)optionalMigrated++;}else remaining.push(current);}
    const legacyIds=new Set(legacyRows.map(r=>r.id));for(const row of state[table]){if(legacyIds.has(row.id))continue;const stored=loadedRows.find(x=>x.record.id===row.id);if(stored){if(!same(beforeById.get(row.id),row))await updateViews(table,row,stored);}else await updateViews(table,row);}
    state[table]=remaining;
   }
   for(const buckets of Object.values(meta.balances||{}))for(const [expiresAt,bucket] of Object.entries(buckets))if(Number(expiresAt)<=now&&!bucket.reserved)delete buckets[expiresAt];
   meta.revision++;state._storage=meta;addWrite({path:receiptPath,value:{actor:uid,key,input,at:now},previous:null});addWrite({path:this.statePath,value:state,previous:stateDoc});
   if(writes.size>500)throw Error('한 번에 처리할 기록이 많습니다. 관리자에게 문의하세요.');if(new TextEncoder().encode(JSON.stringify(state)).length>700000)throw Error('학급 데이터 한도입니다. 관리자에게 문의하세요.');
   try{await this.store.put([...writes.values()]);return {duplicate:legacyReplay,migrated,legacyRemaining:legacyCount(state)};}catch(error){if(error instanceof Conflict)continue;throw error;}
  }throw Error('다른 요청이 처리 중입니다. 잠시 후 다시 시도하세요.');
 }
 async readState(uid:string){
  const document=await this.store.get(this.statePath);if(!document)throw Error('학급이 설정되지 않았습니다.');const source=this.store.value(document) as StoredState,me=member(source,uid),teacher=me.role==='teacher',state=structuredClone(source),meta=source._storage||initialMeta(),generation=meta.generation;const collection=(table:HistoryTable)=>teacher?primary(this.classId,table,generation):ownerView(this.classId,uid,table,generation);
  const add=async(table:HistoryTable,opts:Parameters<typeof query>[2]={})=>{const rows=await query(this.store,collection(table),opts);const ids=new Set(state[table].map(r=>r.id));for(const row of rows)if(!ids.has(row.record.id)){state[table].push(row.record);ids.add(row.record.id);}};
  if((meta.counts.lots||0)>0&&!meta.balances)throw Error('포인트 집계 마이그레이션이 필요합니다.');for(const [target,buckets] of Object.entries(meta.balances||{})){if(!teacher&&target!==uid)continue;for(const [expiresAt,bucket] of Object.entries(buckets))if(Number(expiresAt)>Date.now()||bucket.reserved)state.lots.push({id:`summary_${target}_${expiresAt}`,uid:target,expiresAt:Number(expiresAt),available:bucket.available,reserved:bucket.reserved});}
  await add('requests',{field:'record.status',value:'pending',complete:true});await add('exams',{field:'record.status',value:'pending',complete:true});
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  if(teacher)await add('quizzes',{limit:20});else{const rows=await query(this.store,primary(this.classId,'quizzes',generation),{field:'publishedDate',value:today,limit:2,complete:true});state.quizzes.push(...rows.map(r=>r.record));await add('attempts',{field:'record.date',value:today,limit:2});}
  const notices=await query(this.store,primary(this.classId,'notices',generation),{field:'record.active',value:true,limit:20}),important=await query(this.store,primary(this.classId,'notices',generation),{field:'importantActive',value:true,limit:20});const noticeIds=new Set(state.notices.map(r=>r.id));for(const row of [...important,...notices])if(!noticeIds.has(row.record.id)){state.notices.push(row.record);noticeIds.add(row.record.id);}
  delete state._storage;const result=visible(state,uid) as State&{history:any};const counts=teacher?meta.counts:meta.ownerCounts[uid]||{};const legacy=Object.fromEntries(HISTORY_TABLES.map(table=>[table,source[table].filter(r=>teacher||(table==='notices'?r.active:r.uid===uid)).length]));
  result.history={counts:Object.fromEntries(HISTORY_TABLES.filter(t=>teacher||PERSONAL.has(t)||t==='lots').map(table=>[table,(!teacher&&table==='notices'?(meta.activeNotices||0):(counts[table]||0))+legacy[table]])),unreadInbox:(meta.unreadInbox[uid]||0)+source.inbox.filter(r=>r.uid===uid&&!r.read).length,legacyRemaining:Object.values(legacy).reduce((n,count)=>n+count,0),recentLimit:RECENT};return result;
 }
 async listHistory(uid:string,table:HistoryTable,cursor?:string|null,limit=25):Promise<HistoryPage>{
  if(!HISTORY_TABLES.includes(table)||!Number.isInteger(limit)||limit<1||limit>50)throw Error('기록 조회 입력을 확인하세요.');const document=await this.store.get(this.statePath);if(!document)throw Error('학급이 설정되지 않았습니다.');const state=this.store.value(document) as StoredState,me=member(state,uid),teacher=me.role==='teacher';if(!teacher&&!PERSONAL.has(table))throw Error('기록 조회 권한이 없습니다.');const generation=state._storage?.generation;const publicNotice=table==='notices';
  const revision=legacyCount(state)?document.updateTime:'generation:'+(generation||'legacy');let page:{v:number;revision:string;table:string;uid:string;after?:string;offset:number}={v:1,revision,table,uid,offset:0};if(cursor){try{page=JSON.parse(atob(cursor));}catch{throw Error('기록 커서가 올바르지 않습니다.');}if(page.v!==1||page.revision!==revision||page.table!==table||page.uid!==uid||!Number.isSafeInteger(page.offset)||page.offset<0||page.after&&(!page.after.startsWith(`${this.store.base.slice(this.store.base.indexOf('projects/'))}/${teacher||publicNotice?primary(this.classId,table,generation):ownerView(this.classId,uid,table,generation)}/`)))throw Error('기록이 변경되었습니다. 처음부터 다시 조회하세요.');}
  const collection=teacher||publicNotice?primary(this.classId,table,generation):ownerView(this.classId,uid,table,generation);const archived=await query(this.store,collection,{after:page.after,limit:limit+1,...(!teacher&&publicNotice?{field:'record.active',value:true}:{})});const inline=state[table].map((record,index)=>({record,index})).filter(x=>teacher||(publicNotice?x.record.active:x.record.uid===uid)).sort((a,b)=>stamp(b.record)-stamp(a.record)||b.index-a.index).slice(page.offset);
  const merged=[...archived.map(row=>({record:row.record,sort:row.path.split('/').at(-1)!,stored:row})),...inline.slice(0,limit+1).map(row=>({record:row.record,sort:recordId(row.record,(state._storage?.nextSequence||0)+row.index+1),stored:null}))].sort((a,b)=>b.sort.localeCompare(a.sort));const selected=merged.slice(0,limit);let after=page.after,offset=page.offset;
  const records=selected.map(row=>{if(row.stored)after=row.stored.document.name;else offset++;const id=row.stored?.path.split('/').at(-1);return {...row.record,...(row.stored?{archived:true,historyId:id,originalId:row.record.id,...(table==='inbox'?{id:'archive_'+id}:{})}:{archived:false})};});
  const more=merged.length>limit||inline.length>selected.filter(x=>!x.stored).length;const nextCursor=more?btoa(JSON.stringify({...page,after,offset})):null;return {records,cursor:nextCursor,nextCursor,legacyRemaining:state[table].filter(record=>teacher||(publicNotice?record.active:record.uid===uid)).length};
 }
}
