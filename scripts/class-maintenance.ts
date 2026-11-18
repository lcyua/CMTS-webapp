/** No remote access or deletion by default. Never reads Auth or pinAccounts. */
import {createRequire} from 'node:module';
import https from 'node:https';
import {resolve} from 'node:path';
import {accountLimitPaths,assertTarget,captureSnapshot,firestoreTimestamp,loginLimitMaintenance,maintenanceProject,planPrune,applyPrune,privateDirectory,readSnapshot,restoreSnapshot,statePath,stateSummary,storageLayout,writeSnapshot} from './maintenance-core';

const args=process.argv.slice(2),operation=args[0];
const options=new Set(['--project','--class-id','--dir','--file','--expect-update-time','--confirm','--keep-last','--older-than-days','--reason']);
const values:Record<string,string>={};let apply=false;
for(let i=1;i<args.length;i++){if(args[i]==='--apply'){if(apply)throw Error('--apply 중복');apply=true;continue;}if(!options.has(args[i])||!args[i+1]||args[i+1].startsWith('--')||values[args[i]])throw Error('알 수 없거나 중복된 옵션입니다.');values[args[i]]=args[++i];}
if(!['inspect','backup','restore','prune-local','check','cleanup-login-limits'].includes(operation))throw Error('사용: npx tsx scripts/class-maintenance.ts inspect|backup|restore|prune-local|check|cleanup-login-limits --project wooriban-2027 --class-id 2027-1-11 [--dir imports/backups] [--file 백업파일] [--apply --confirm wooriban-2027/2027-1-11]');
const projectId=values['--project']||maintenanceProject,classId=values['--class-id'];assertTarget(projectId,classId);
const directory=resolve(values['--dir']||'imports/backups');
if(apply&&values['--confirm']!==`${projectId}/${classId}`)throw Error('--apply에는 --confirm 프로젝트/학급ID가 필요합니다.');
if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('운영 도구에서는 에뮬레이터 변수를 제거하세요.');
const input=['restore','check'].includes(operation)?values['--file']:undefined;
if(['restore','check'].includes(operation)&&!input)throw Error('--file 백업 경로가 필요합니다.');
const snapshot=input?readSnapshot(input,projectId,classId):undefined;
if(operation==='check'){
 console.log(JSON.stringify({operation,projectId,classId,valid:true,sourceUpdateTime:snapshot!.sourceUpdateTime,createdAt:snapshot!.createdAt,tables:stateSummary(snapshot!.state)}));
}else if(operation==='prune-local'){
 const plan=planPrune(directory,projectId,classId,Number(values['--keep-last']||30),Number(values['--older-than-days']||30));
 console.log(JSON.stringify({operation,projectId,classId,mode:apply?'apply':'dry-run',count:plan.length,bytes:plan.reduce((n,p)=>n+p.bytes,0)}));
 if(apply)applyPrune(plan,projectId,classId);
}else if(!apply){
 console.log(JSON.stringify({operation,projectId,classId,documentPath:statePath(classId),mode:'dry-run',remoteAccess:false,...(snapshot?{sourceUpdateTime:snapshot.sourceUpdateTime,tables:stateSummary(snapshot.state)}:{})}));
 console.log('--apply와 --confirm을 지정하기 전에는 원격 연결·복구·파일 생성을 실행하지 않습니다.');
}else{
 if(operation==='restore'&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(values['--expect-update-time']||''))throw Error('복구에는 inspect에서 확인한 --expect-update-time이 필요합니다.');
 const require=createRequire(new URL('../functions/package.json',import.meta.url));
 const {initializeApp,applicationDefault,deleteApp}=require('firebase-admin/app');
 const {initializeFirestore}=require('firebase-admin/firestore');
 const proxy=process.env.HTTPS_PROXY;const httpAgent=proxy?new (require('https-proxy-agent').HttpsProxyAgent)(proxy):undefined;
 if(httpAgent)https.globalAgent=httpAgent;
 const app=initializeApp({credential:applicationDefault(httpAgent),httpAgent,projectId},`maintenance-${Date.now()}`),db=initializeFirestore(app,{preferRest:true});
 const ref=db.doc(statePath(classId));
 try{
  if(operation==='inspect'||operation==='cleanup-login-limits'){
   const document=await ref.get();if(!document.exists)throw Error('기존 학급이 없습니다.');const source=document.data(),layout=storageLayout(source),state={...source};delete state._storage;
   if(operation==='inspect')console.log(JSON.stringify({operation,projectId,classId,updateTime:firestoreTimestamp(document.updateTime),layout:layout.layout,tables:Object.fromEntries(Object.entries(stateSummary(state)).map(([table,count])=>[table,count+(layout.counts[table]||0)]))}));
   else {
   const counts={migrated:0,deleted:0,unchanged:0};
   for(const path of accountLimitPaths(state,classId)){
    const result=await db.runTransaction(async(tx:any)=>{const gateRef=db.doc(path),gate=await tx.get(gateRef);if(!gate.exists)return 'unchanged';const plan=loginLimitMaintenance(gate.data());if(plan.action==='delete'){tx.delete(gateRef);return 'deleted';}if(plan.action==='migrate'){tx.update(gateRef,{expiresAt:new Date(plan.expiresAt!)});return 'migrated';}return 'unchanged';});
    counts[result as keyof typeof counts]++;
   }
   console.log(JSON.stringify({operation,projectId,classId,...counts,ipGates:'unchanged'}));
   }
  }else{
   const captured=await captureSnapshot(db,{projectId,classId,createdAt:new Date().toISOString(),reason:operation==='restore'?'before-restore':values['--reason']==='scheduled'?'scheduled':'manual'});
   const current=captured.snapshot,updateTime=current.sourceUpdateTime;
   if(operation==='backup'){
   const reason=values['--reason']||'manual';if(!['manual','scheduled'].includes(reason))throw Error('백업 사유는 manual 또는 scheduled입니다.');
   const path=writeSnapshot(directory,current);
   console.log(JSON.stringify({operation,projectId,classId,file:path,sourceUpdateTime:updateTime}));
   }else{
   if(updateTime!==values['--expect-update-time'])throw Error('inspect 이후 학급이 변경됐습니다. 새 상태를 확인하세요.');
   privateDirectory(directory);const before=writeSnapshot(directory,current);
   const restored=await restoreSnapshot(db,snapshot!,current,captured.source,updateTime);
   console.log(JSON.stringify({operation,projectId,classId,restored:true,beforeRestoreBackup:before,sourceUpdateTime:snapshot!.sourceUpdateTime,...restored}));
   }
  }
 }finally{await db.terminate();await deleteApp(app);}
}
