import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {constants,closeSync,fchmodSync,fsyncSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,unlinkSync,writeFileSync} from 'node:fs';
import type {Stats} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {State,tables,type RecordData} from '../src/domain';
import {HISTORY_TABLES,historyCollectionPath,partitionState,type HistoryTable} from '../worker/state-repository';

export const maintenanceProject='wooriban-2027';
export const legacyStateByteLimit=700000;
export const stateByteLimit=32*1024*1024;
export const snapshotByteLimit=40*1024*1024;
const backupSuffix='.class-backup.json';
export type Receipt={id:string;data:{actor:string;key:string;input:string;at:number}};
export type Snapshot={format:'wooriban-class-backup';version:1;projectId:string;classId:string;documentPath:string;sourceUpdateTime:string;createdAt:string;reason:'scheduled'|'manual'|'before-restore';layout:'legacy'|'partitioned-v1';state:State;receipts:Receipt[];sha256:string};
export type SnapshotMeta={projectId:string;classId:string;sourceUpdateTime:string;createdAt:string;reason:Snapshot['reason'];layout?:Snapshot['layout']};
export function statePath(classId:string){assertTarget(maintenanceProject,classId);return `classes/${classId}/private/state`;}
export function assertTarget(projectId:string,classId:string){
 if(projectId!==maintenanceProject||typeof classId!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(classId))throw Error('운영 대상 프로젝트·학급 ID를 확인하세요.');
}
function plain(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function jsonValue(value:unknown,depth=0):void{
 if(depth>40)throw Error('백업 데이터의 중첩이 너무 깊습니다.');
 if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'&&Number.isFinite(value))return;
 if(Array.isArray(value)){for(const item of value)jsonValue(item,depth+1);return;}
 if(!plain(value))throw Error('백업에는 JSON 값만 허용됩니다.');
 for(const [key,item] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw Error('지원하지 않는 백업 필드입니다.');jsonValue(item,depth+1);}
}
export function validateState(value:unknown):asserts value is State{
 if(!plain(value)||Object.keys(value).sort().join(',')!==[...tables].sort().join(','))throw Error('학급 상태의 테이블 구조가 다릅니다.');
 jsonValue(value);
 if(Buffer.byteLength(JSON.stringify(value))>stateByteLimit)throw Error('논리 학급 백업이 32MiB 한도를 넘습니다.');
 for(const table of tables){const rows=value[table];if(!Array.isArray(rows))throw Error('학급 테이블은 배열이어야 합니다.');const ids=new Set<string>(),history=HISTORY_TABLES.includes(table as HistoryTable);for(const row of rows){if(!plain(row)||typeof row.id!=='string'||!row.id||row.id.length>300||(!history&&ids.has(row.id)))throw Error('학급 레코드 ID가 누락되었거나 중복입니다.');if(Buffer.byteLength(JSON.stringify(row))>legacyStateByteLimit)throw Error('개별 학급 레코드가 700KB 한도를 넘습니다.');ids.add(row.id);}}
 const members=value.members as Record<string,unknown>[];
 if(!members.length||!members.some(m=>m.role==='teacher'&&m.active===true)||members.some(m=>!['teacher','student'].includes(String(m.role))||typeof m.active!=='boolean'||(m.role==='student'&&!/^\d{1,30}$/.test(String(m.studentNo||'')))))throw Error('학급 계정 구조가 올바르지 않습니다.');
}
function checksum(value:Omit<Snapshot,'sha256'>){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function validateReceipts(value:unknown):asserts value is Receipt[]{
 if(!Array.isArray(value))throw Error('요청 영수증 목록을 확인하세요.');
 const ids=new Set<string>();
 for(const item of value){
  if(!plain(item)||Object.keys(item).sort().join(',')!=='data,id'||typeof item.id!=='string'||!/^[a-f0-9]{64}$/.test(item.id)||ids.has(item.id)||!plain(item.data)||Object.keys(item.data).sort().join(',')!=='actor,at,input,key')throw Error('요청 영수증 형식이 올바르지 않습니다.');
  const {actor,key,input,at}=item.data;
  if(typeof actor!=='string'||!actor||actor.length>256||typeof key!=='string'||!/^[-a-zA-Z0-9_]{1,120}$/.test(key)||typeof input!=='string'||Buffer.byteLength(input)>65536||typeof at!=='number'||!Number.isSafeInteger(at)||at<0||item.id!==createHash('sha256').update(JSON.stringify([actor,key])).digest('hex'))throw Error('요청 영수증 ID·입력이 일치하지 않습니다.');
  ids.add(item.id);
 }
}
export function mergeReceipts(snapshot:Receipt[],current:Receipt[]):Receipt[]{
 validateReceipts(snapshot);validateReceipts(current);const all=new Map(snapshot.map(item=>[item.id,structuredClone(item)]));
 for(const item of current){const old=all.get(item.id);if(old&&(old.data.input!==item.data.input||old.data.actor!==item.data.actor||old.data.key!==item.data.key))throw Error('요청 영수증이 충돌합니다.');all.set(item.id,structuredClone(item));}return [...all.values()];
}
/** Recreate durable idempotency receipts before moving legacy audits out of main state. */
export function auditReceipts(state:State):Receipt[]{
 const receipts=new Map<string,Receipt>();
 for(const audit of state.audits){
  if(typeof audit.actor!=='string'||typeof audit.id!=='string'||typeof audit.input!=='string')continue;
  const prefixes=[`${audit.actor.length}_${audit.actor}_`,audit.actor+'_'];
  const prefix=prefixes.find(value=>audit.id.startsWith(value));if(!prefix)continue;
  const key=audit.id.slice(prefix.length);if(!/^[-a-zA-Z0-9_]{1,120}$/.test(key))continue;
  const data={actor:audit.actor,key,input:audit.input,at:audit.at};
  const receipt={id:createHash('sha256').update(JSON.stringify([data.actor,key])).digest('hex'),data};
  validateReceipts([receipt]);const previous=receipts.get(receipt.id);
  if(previous&&previous.data.input!==data.input)throw Error('감사 기록의 요청 영수증이 충돌합니다.');receipts.set(receipt.id,receipt);
 }
 return [...receipts.values()];
}
/** Only metadata is read here; the returned logical snapshot never contains storage internals. */
export function storageLayout(source:unknown):{layout:Snapshot['layout'];generation?:string;nextSequence:number;revision:number;counts:Record<string,number>}{
 if(!plain(source))throw Error('학급 상태 형식을 확인하세요.');
 if(!Object.hasOwn(source,'_storage')){validateState(source);return {layout:'legacy',nextSequence:0,revision:0,counts:{}};}
 if(Object.keys(source).sort().join(',')!==[...tables,'_storage'].sort().join(','))throw Error('학급 상태의 테이블 구조가 다릅니다.');jsonValue(source);
 const meta=source._storage;if(!plain(meta)||meta.version!==1||!Number.isSafeInteger(meta.nextSequence)||Number(meta.nextSequence)<0||!Number.isSafeInteger(meta.revision)||Number(meta.revision)<0||!plain(meta.counts)||!plain(meta.ownerCounts)||!plain(meta.unreadInbox)||(meta.generation!==undefined&&(typeof meta.generation!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(meta.generation))))throw Error('저장소 메타데이터가 올바르지 않습니다.');
 for(const [table,count] of Object.entries(meta.counts))if(!HISTORY_TABLES.includes(table as HistoryTable)||!Number.isSafeInteger(count)||Number(count)<0)throw Error('저장소 기록 개수가 올바르지 않습니다.');
 const base={...source};delete base._storage;validateState(base);
 return {layout:'partitioned-v1',generation:meta.generation as string|undefined,nextSequence:Number(meta.nextSequence),revision:Number(meta.revision),counts:meta.counts as Record<string,number>};
}
export function materializeState(source:unknown,archived:Partial<Record<HistoryTable,RecordData[]>>={}):State{
 const layout=storageLayout(source),state=structuredClone(source) as State&{_storage?:unknown};delete state._storage;
 for(const table of HISTORY_TABLES){const rows=archived[table]||[];if(rows.length!==(layout.counts[table]||0))throw Error('백업 기록 개수가 저장소 메타데이터와 다릅니다.');state[table].push(...structuredClone(rows));}
 validateState(state);return state;
}
export function firestoreTimestamp(value:{seconds:number;nanoseconds:number}){return new Date(value.seconds*1000).toISOString().slice(0,19)+'.'+String(value.nanoseconds).padStart(9,'0')+'Z';}
/** A readonly transaction pins every page, including receipts, to one Firestore snapshot. */
export async function captureSnapshot(db:any,meta:Omit<SnapshotMeta,'sourceUpdateTime'|'layout'>):Promise<{snapshot:Snapshot;source:Record<string,any>}>{
 assertTarget(meta.projectId,meta.classId);
 return db.runTransaction(async(tx:any)=>{
  const document=await tx.get(db.doc(statePath(meta.classId)));if(!document.exists)throw Error('기존 학급이 없습니다. 이 도구는 학급을 생성하지 않습니다.');
  const source=document.data(),layout=storageLayout(source),archived:Partial<Record<HistoryTable,RecordData[]>>={};let bytes=Buffer.byteLength(JSON.stringify(source));
  const readCollection=async(path:string,receive:(id:string,data:any)=>void)=>{
   let after:unknown;for(;;){let query=db.collection(path).orderBy('__name__').limit(500);if(after)query=query.startAfter(after);const page=await tx.get(query);
    for(const row of page.docs){const data=row.data();bytes+=Buffer.byteLength(JSON.stringify(data));if(bytes>snapshotByteLimit)throw Error('백업 파일이 너무 큽니다.');receive(row.id,data);}
    if(page.docs.length<500)break;after=page.docs.at(-1);
   }
  };
  if(layout.layout==='partitioned-v1')for(const table of HISTORY_TABLES){const rows:RecordData[]=[];await readCollection(historyCollectionPath(meta.classId,table,layout.generation),(id,data)=>{if(!plain(data)||!plain(data.record)||typeof data.sequence!=='number'||!Number.isSafeInteger(data.sequence)||data.sequence<1||!/^\d{16}_\d{16}$/.test(id))throw Error('분리 기록 형식이 올바르지 않습니다.');rows.push(data.record);});archived[table]=rows;}
  const receipts:Receipt[]=[];await readCollection(`classes/${meta.classId}/commandReceipts`,(id,data)=>receipts.push({id,data}));
  const state=materializeState(source,archived),allReceipts=mergeReceipts(receipts,auditReceipts(state));
  return {snapshot:makeSnapshot(state,{...meta,sourceUpdateTime:firestoreTimestamp(document.updateTime),layout:layout.layout},allReceipts),source};
 },{readOnly:true});
}
/** Stage immutable records first; only the final state CAS makes a generation visible. */
export async function restoreSnapshot(db:any,snapshot:Snapshot,current:Snapshot,source:Record<string,any>,expectUpdateTime:string,now=Date.now(),operationId:string=randomUUID()){
 validateSnapshot(snapshot,snapshot.projectId,snapshot.classId);validateSnapshot(current,snapshot.projectId,snapshot.classId);
 if(current.sourceUpdateTime!==expectUpdateTime)throw Error('inspect 이후 학급이 변경됐습니다. 새 상태를 확인하세요.');
 const state=restoreState(snapshot,current.state,now,operationId),receipts=mergeReceipts(mergeReceipts(snapshot.receipts,current.receipts),auditReceipts(state));
 const layout=storageLayout(source),generation='restore_'+operationId.replace(/-/g,'');
 const partition=partitionState(state,snapshot.classId,layout.nextSequence,generation,now);partition.main._storage!.revision=layout.revision+1;
 if(Buffer.byteLength(JSON.stringify(partition.main))>legacyStateByteLimit)throw Error('복구할 기본 학급 문서가 700KB 한도를 넘습니다.');
 const createBatches=async(records:{path:string;value:unknown}[])=>{for(let start=0;start<records.length;start+=400){const batch=db.batch();for(const row of records.slice(start,start+400))batch.create(db.doc(row.path),row.value);await batch.commit();}};
 await createBatches(partition.records);
 for(let start=0;start<receipts.length;start+=400){const rows=receipts.slice(start,start+400),documents=await db.getAll(...rows.map(row=>db.doc(`classes/${snapshot.classId}/commandReceipts/${row.id}`))),missing:{path:string;value:unknown}[]=[];
  for(let i=0;i<rows.length;i++){const row=rows[i],document=documents[i];if(document.exists)mergeReceipts([row],[{id:row.id,data:document.data()}]);else missing.push({path:`classes/${snapshot.classId}/commandReceipts/${row.id}`,value:row.data});}await createBatches(missing);
 }
 await db.runTransaction(async(tx:any)=>{const ref=db.doc(statePath(snapshot.classId)),latest=await tx.get(ref);if(!latest.exists||firestoreTimestamp(latest.updateTime)!==expectUpdateTime)throw Error('복구 준비 중 학급이 변경되어 활성화를 중단합니다. 기존 기록은 유지됩니다.');tx.set(ref,partition.main);});
 return {generation,records:partition.records.length,receipts:receipts.length};
}
export function makeSnapshot(state:unknown,meta:SnapshotMeta,receipts:Receipt[]=[]):Snapshot{
 assertTarget(meta.projectId,meta.classId);validateState(state);
 const iso=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
 if(!iso.test(meta.sourceUpdateTime)||!Number.isFinite(Date.parse(meta.sourceUpdateTime))||!iso.test(meta.createdAt)||!Number.isFinite(Date.parse(meta.createdAt))||!['scheduled','manual','before-restore'].includes(meta.reason))throw Error('백업 시간·사유를 확인하세요.');
 validateReceipts(receipts);if(meta.layout&&!['legacy','partitioned-v1'].includes(meta.layout))throw Error('지원하지 않는 저장 구조입니다.');
 if((meta.layout||'legacy')==='legacy'&&Buffer.byteLength(JSON.stringify(state))>legacyStateByteLimit)throw Error('단일 문서 백업이 700KB 한도를 넘습니다.');
 const body:Omit<Snapshot,'sha256'>={format:'wooriban-class-backup',version:1,projectId:meta.projectId,classId:meta.classId,documentPath:statePath(meta.classId),sourceUpdateTime:meta.sourceUpdateTime,createdAt:meta.createdAt,reason:meta.reason,layout:meta.layout||'legacy',state:structuredClone(state),receipts:structuredClone(receipts)};
 if(Buffer.byteLength(JSON.stringify(body))>snapshotByteLimit)throw Error('백업 파일이 너무 큽니다.');
 return {...body,sha256:checksum(body)};
}
export function validateSnapshot(value:unknown,projectId:string,classId:string):Snapshot{
 assertTarget(projectId,classId);
 if(!plain(value)||value.format!=='wooriban-class-backup'||value.version!==1||value.projectId!==projectId||value.classId!==classId||value.documentPath!==statePath(classId)||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))throw Error('백업 형식 또는 대상이 일치하지 않습니다.');
 if(Object.keys(value).sort().join(',')!==['format','version','projectId','classId','documentPath','sourceUpdateTime','createdAt','reason','layout','state','receipts','sha256'].sort().join(','))throw Error('알 수 없는 백업 필드가 있습니다.');
 const {sha256,...body}=value;
 const expected=checksum(body as Omit<Snapshot,'sha256'>);
 if(!timingSafeEqual(Buffer.from(sha256,'hex'),Buffer.from(expected,'hex')))throw Error('백업 체크섬이 일치하지 않습니다.');
 makeSnapshot(value.state,{projectId,classId,sourceUpdateTime:String(value.sourceUpdateTime),createdAt:String(value.createdAt),reason:value.reason as Snapshot['reason'],layout:value.layout as Snapshot['layout']},value.receipts as Receipt[]);
 return structuredClone(value) as Snapshot;
}
function requirePrivate(stat:Stats,directory:boolean){
 if((directory?!stat.isDirectory():!stat.isFile())||stat.isSymbolicLink()||(stat.mode&0o077)!==0||(typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw Error('백업 경로는 본인 소유의 비공개 일반 파일(600)·폴더(700)여야 합니다.');
}
export function privateDirectory(path:string){
 const absolute=resolve(path);mkdirSync(absolute,{recursive:true,mode:0o700});requirePrivate(lstatSync(absolute),true);return absolute;
}
export function writeSnapshot(directory:string,snapshot:Snapshot){
 validateSnapshot(snapshot,snapshot.projectId,snapshot.classId);
 const dir=privateDirectory(directory),stamp=snapshot.createdAt.replace(/[-:.]/g,'');
 const path=join(dir,`${snapshot.projectId}__${snapshot.classId}__${stamp}__${randomUUID()}${backupSuffix}`);
 const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{fchmodSync(fd,0o600);writeFileSync(fd,JSON.stringify(snapshot)+'\n');fsyncSync(fd);}catch(error){closeSync(fd);unlinkSync(path);throw error;}
 closeSync(fd);return path;
}
export function readSnapshot(path:string,projectId:string,classId:string){
 const fd=openSync(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=fstatSync(fd);requirePrivate(stat,false);if(stat.size>snapshotByteLimit)throw Error('백업 파일이 너무 큽니다.');return validateSnapshot(JSON.parse(readFileSync(fd,'utf8')),projectId,classId);}finally{closeSync(fd);}
}
export function stateSummary(state:State){return Object.fromEntries(tables.map(table=>[table,state[table].length]));}
function identity(state:State){return state.members.map(m=>({id:m.id,role:m.role,studentNo:m.studentNo||''})).sort((a,b)=>a.id.localeCompare(b.id));}
/** Restores domain records while keeping today's accounts/permissions and all command keys. */
export function restoreState(snapshot:Snapshot,current:State,now=Date.now(),operationId:string=randomUUID()):State{
 validateSnapshot(snapshot,snapshot.projectId,snapshot.classId);validateState(current);
 if(JSON.stringify(identity(snapshot.state))!==JSON.stringify(identity(current)))throw Error('현재 학급 계정과 백업 명단이 다릅니다. 자동 복구를 중단합니다.');
 const next=structuredClone(snapshot.state);next.members=structuredClone(current.members);
 const audits=structuredClone(snapshot.state.audits),byActorId=new Map(audits.map(a=>[JSON.stringify([a.id,a.actor||'']),a]));
 const beforeCounts=new Map<string,number>();for(const row of audits){const key=JSON.stringify(row);beforeCounts.set(key,(beforeCounts.get(key)||0)+1);}const seen=new Map<string,number>();
 for(const audit of current.audits){const old=byActorId.get(JSON.stringify([audit.id,audit.actor||'']));if(old&&(old.action!==audit.action||old.input!==audit.input))throw Error('감사 요청 키가 충돌합니다. 수동 검토가 필요합니다.');const key=JSON.stringify(audit),count=(seen.get(key)||0)+1;seen.set(key,count);if(count>(beforeCounts.get(key)||0))audits.push(structuredClone(audit));}
 const auditId=`maintenance-restore_${operationId}`;if(audits.some(a=>a.id===auditId))throw Error('복구 작업 ID가 중복입니다.');
 audits.push({id:auditId,actor:'operator',action:'maintenanceRestore',input:JSON.stringify({snapshotSha256:snapshot.sha256,sourceUpdateTime:snapshot.sourceUpdateTime}),at:now});
 next.audits=audits;validateState(next);return next;
}
export type PrunePlan={path:string;sha256:string;createdAt:string;bytes:number};
/** Only this tool's valid local state snapshots qualify. Unrelated files are never deleted. */
export function planPrune(directory:string,projectId:string,classId:string,keepLast=30,olderThanDays=30,now=Date.now()):PrunePlan[]{
 assertTarget(projectId,classId);
 if(!Number.isInteger(keepLast)||keepLast<2||keepLast>10000||!Number.isInteger(olderThanDays)||olderThanDays<1||olderThanDays>36500)throw Error('최소 2개 백업과 1일 이상의 보관 기간이 필요합니다.');
 const dir=resolve(directory);let stat:Stats;try{stat=lstatSync(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}requirePrivate(stat,true);
 const prefix=`${projectId}__${classId}__`;
 const candidates=readdirSync(dir).filter(name=>name.startsWith(prefix)&&name.endsWith(backupSuffix)).map(name=>{const path=join(dir,name),snapshot=readSnapshot(path,projectId,classId);return {path,sha256:snapshot.sha256,createdAt:snapshot.createdAt,bytes:lstatSync(path).size};}).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||basename(b.path).localeCompare(basename(a.path)));
 return candidates.slice(keepLast).filter(item=>Date.parse(item.createdAt)<now-olderThanDays*86400000);
}
export function applyPrune(plan:PrunePlan[],projectId:string,classId:string){
 for(const item of plan){requirePrivate(lstatSync(dirname(item.path)),true);const current=readSnapshot(item.path,projectId,classId);if(current.sha256!==item.sha256||current.createdAt!==item.createdAt)throw Error('정리 계획 후 백업 파일이 바뀌어 중단합니다.');}
 for(const item of plan)unlinkSync(item.path);
 return plan.length;
}
export function accountLimitPaths(state:State,classId:string){
 assertTarget(maintenanceProject,classId);validateState(state);
 return state.members.filter(m=>m.role==='student').map(m=>'loginLimits/account_'+createHash('sha256').update(classId+':'+m.studentNo).digest('hex'));
}
type LimitExpiry=number|Date|{toMillis:()=>number};
export function loginLimitMaintenance(value:{start?:unknown;count?:unknown;expiresAt?:unknown},now=Date.now()):{action:'none'|'delete'|'migrate';expiresAt?:number}{
 const {start,count}=value,expiresAt=value.expiresAt as LimitExpiry|undefined;
 if(typeof start!=='number'||!Number.isSafeInteger(start)||start<0||typeof count!=='number'||!Number.isSafeInteger(count)||count<0)return {action:'none'};
 const deadline=typeof expiresAt==='number'?expiresAt:expiresAt instanceof Date?expiresAt.getTime():typeof expiresAt?.toMillis==='function'?expiresAt.toMillis():NaN;
 if(!Number.isFinite(deadline)||deadline<=0||deadline>8640000000000000)return {action:'none'};
 if(deadline<=now&&start+15*60*1000<=now)return {action:'delete'};
 return typeof expiresAt==='number'?{action:'migrate',expiresAt:deadline}:{action:'none'};
}
