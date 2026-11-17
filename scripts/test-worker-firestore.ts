/** Real Firestore REST checks. This runner refuses every non-loopback/non-demo target. */
import assert from 'node:assert/strict';
import {balance,kstDate,type State} from '../src/domain';
import {seed} from '../src/seed';
import {Store,type Document} from '../worker/store';
import {HISTORY_TABLES,StateRepository,partitionState,type Write} from '../worker/state-repository';
import {digest,pinPassword} from '../worker/credentials';

const project='demo-worker-firestore';
const host=process.env.FIRESTORE_EMULATOR_HOST;
if(!host||!/^(127\.0\.0\.1|localhost|\[::1\]):[1-9]\d{0,4}$/.test(host))throw Error('Set FIRESTORE_EMULATOR_HOST to an explicit loopback host:port.');
if(Number(host.slice(host.lastIndexOf(':')+1))>65535)throw Error('Invalid emulator port.');
for(const name of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(process.env[name]&&process.env[name]!==project)throw Error(`${name} must equal ${project}.`);
const nativeFetch=globalThis.fetch;
globalThis.fetch=(async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(!url.startsWith(`http://${host}/v1/projects/${project}/databases/(default)/documents`))throw Error('The emulator test refuses external network access.');
 const response=await nativeFetch(input,{...init,redirect:'error'});
 if(!response.ok&&url.endsWith(':runQuery'))console.error('EMULATOR_QUERY_ERROR',JSON.stringify({url,query:JSON.parse(String(init?.body)),response:await response.clone().json()}));
 return response;
}) as typeof fetch;
const suffix=Date.now().toString(36)+'-'+crypto.randomUUID().slice(0,8);
const stores:EmulatorStore[]=[];

class EmulatorStore extends Store {
 readonly paths=new Set<string>();
 readonly reads:string[]=[];
 readonly scope:string;
 constructor(classId:string){super(project,async()=>'owner');this.scope=`classes/${classId}/`;this.base=`http://${host}/v1/projects/${project}/databases/(default)/documents`;stores.push(this);}
 private guard(path:string){if(!path.startsWith(this.scope)||path.includes('..'))throw Error('Test operation escaped its synthetic class.');}
 override async get(path:string):Promise<Document|null>{this.guard(path);this.reads.push(path);return super.get(path);}
 override async getMany(paths:string[]){paths.forEach(path=>this.guard(path));this.reads.push(...paths);return super.getMany(paths);}
 override async put(writes:Write[]){for(const write of writes){this.guard(write.path);this.paths.add(write.path);}return super.put(writes);}
 override async request(url:string,init:RequestInit={}){if(!url.startsWith(this.base)||!url.startsWith(`http://${host}/`))throw Error('Only this loopback demo database may be contacted.');return super.request(url,init);}
 async clean(){const paths=[...this.paths];for(let start=0;start<paths.length;start+=400)await this.request(`${this.base}:commit`,{method:'POST',body:JSON.stringify({writes:paths.slice(start,start+400).map(path=>({delete:`projects/${project}/databases/(default)/documents/${path}`}))})});for(let start=0;start<paths.length;start+=100)assert.ok((await this.getMany(paths.slice(start,start+100))).every(document=>document===null),'A tracked synthetic document survived cleanup.');}
}
function fixture():State{
 const state=seed();for(const table of HISTORY_TABLES)state[table]=[];
 state.members=[{id:'teacher',role:'teacher',active:true,name:'Synthetic Teacher'},{id:'student1',role:'student',active:true,name:'Synthetic Student One',studentNo:'00001'},{id:'student2',role:'student',active:true,name:'Synthetic Student Two',studentNo:'00002'}];
 state.roles=[];state.items=[{id:'test-item',name:'Synthetic Item',price:40,needDate:false,active:true,version:1}];return state;
}
function check(name:string){console.log(`PASS ${name}`);}

const mainErrors:unknown[]=[];
try{
 const classId='worker-rest-'+suffix,store=new EmulatorStore(classId),repository=new StateRepository(store,classId),state=fixture(),now=Date.now();
 await store.put([{path:repository.statePath,value:state,previous:null}]);
 const batch=await store.getMany([repository.statePath,`classes/${classId}/private/missing`]);assert.ok(batch[0]);assert.equal(batch[1],null);
 assert.equal((await repository.readState('student1')).members.find(m=>m.id==='student1')?.name,'Synthetic Student One');assert.equal((await repository.readState('teacher')).quizzes.length,0);check('actual REST batchGet and empty nested runQuery');

 const grant={uid:'student1',amount:50,reason:'Synthetic initial grant'};
 await repository.execute('teacher','points',grant,'initial',now);
 assert.equal(balance(await repository.readState('student1'),'student1',now).available,50);
 const meta=store.value(await store.get(repository.statePath));assert.equal(meta._storage.version,1);assert.equal(meta.lots.length,0);
 const backupId=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(batch[0]!.updateTime))),b=>b.toString(16).padStart(2,'0')).join('');
 const backup=store.value(await store.get(`classes/${classId}/migrationBackups/${backupId}`));assert.deepEqual(backup.state,state);
 assert.equal((await repository.execute('teacher','points',grant,'initial',now)).duplicate,true);
 await assert.rejects(repository.execute('teacher','points',{...grant,amount:51},'initial',now),/동일 요청/);check('atomic migration, immutable backup, summaries and durable receipts');

 const sameGrant={uid:'student1',amount:10,reason:'Synthetic concurrent grant'};
 const repeated=await Promise.all(Array.from({length:6},()=>repository.execute('teacher','points',sameGrant,'same-concurrent-key',now+1)));
 assert.equal(repeated.filter(result=>!result.duplicate).length,1);
 assert.equal(balance(await repository.readState('student1'),'student1',now).available,60);check('six real concurrent commits apply a request once');

 const purchases=await Promise.allSettled(Array.from({length:6},(_,i)=>repository.execute('student1','shop',{itemId:'test-item'},'purchase-'+i,now+2)));
 assert.equal(purchases.filter(result=>result.status==='fulfilled').length,1);
 const afterPurchase=await repository.readState('student1');assert.deepEqual(balance(afterPurchase,'student1',now),{available:20,reserved:40});assert.equal(afterPurchase.requests.length,1);
 const request=afterPurchase.requests[0];await repository.execute('teacher','requestStatus',{id:request.id,status:'approved',version:request.version,reason:'Synthetic approval'},'approve',now+3);
 assert.deepEqual(balance(await repository.readState('student1'),'student1',now),{available:20,reserved:0});check('real CAS conflicts preserve FIFO and reject concurrent overspending');

 const date=kstDate(now);await repository.execute('teacher','save',{table:'quizzes',id:'synthetic-question',data:{date,question:'Synthetic question',options:['One','Two','Three','Four'],answer:1,explanation:'Synthetic explanation',active:true}},'question',now+4);
 const teacherState=await repository.readState('teacher');assert.equal(teacherState.quizzes[0].answer,1);const publicState=await repository.readState('student1');assert.equal(publicState.quizzes[0].answer,undefined);assert.equal(publicState.quizzes[0].explanation,undefined);
 await repository.execute('student1','quiz',{choice:1,version:1},'answer',now+5);await assert.rejects(repository.execute('student1','quiz',{choice:1,version:1},'answer-again',now+6),/이미 제출/);
 assert.equal(balance(await repository.readState('student1'),'student1',now).available,30);
 for(let i=0;i<2;i++)await repository.execute('teacher','save',{table:'notices',id:'synthetic-notice-'+i,data:{title:'Synthetic notice '+i,body:'Body',active:true,important:!!i}},'notice-'+i,now+6);
 const notices=await repository.listHistory('student1','notices',null,1);assert.ok(notices.nextCursor);assert.equal((await repository.listHistory('student1','notices',notices.nextCursor,1)).records.length,1);
 const ownHistory=await repository.listHistory('student1','events',null,1);assert.equal(ownHistory.records.length,1);assert.ok(ownHistory.nextCursor);
 const oldCursor=JSON.parse(atob(ownHistory.nextCursor!));delete oldCursor.afterSequence;const next=await repository.listHistory('student1','events',btoa(JSON.stringify(oldCursor)),1);assert.equal(next.records.length,1);assert.notEqual(next.records[0].historyId,ownHistory.records[0].historyId);
 assert.equal((await repository.listHistory('student2','events')).records.length,0);await assert.rejects(repository.listHistory('student1','audits'),/권한/);
 const inbox=await repository.listHistory('student1','inbox',null,1),unread=(await repository.readState('student1')).history.unreadInbox;
 await assert.rejects(repository.execute('student2','read',{id:inbox.records[0].id},'foreign-inbox',now+7),/알림/);
 await repository.execute('student1','read',{id:inbox.records[0].id},'own-inbox',now+7);assert.equal((await repository.readState('student1')).history.unreadInbox,unread-1);check('published quiz, actual reference cursors, history privacy and archived inbox writes');

 const largeClass='worker-rest-page-'+suffix,largeStore=new EmulatorStore(largeClass),largeState=fixture();
 for(let i=0;i<501;i++)largeState.lots.push({id:'lot-'+i,uid:'student1',total:1,available:1,reserved:0,spent:0,expired:0,acquiredAt:now+i,expiresAt:now+86400000+i});
 for(let i=0;i<72;i++)largeState.events.push({id:'event-'+i,uid:'student1',type:'grant',amount:1,reason:'Synthetic paged event',at:now+i});
 const prepared=partitionState(largeState,largeClass,0,'synthetic_generation',now);
 for(let offset=0;offset<prepared.records.length;offset+=400)await largeStore.put(prepared.records.slice(offset,offset+400).map(row=>({...row,previous:null})));
 const largeRepository=new StateRepository(largeStore,largeClass);await largeStore.put([{path:largeRepository.statePath,value:prepared.main,previous:null}]);
 await largeRepository.execute('teacher','points',{uid:'student1',amount:-1,reason:'Synthetic complete range query'},'debit',now+1);
 assert.equal(balance(await largeRepository.readState('student1'),'student1',now).available,500);
 const firstPage=await largeRepository.listHistory('student1','events',null,50);assert.equal(firstPage.records.length,50);assert.ok(firstPage.nextCursor);
 const lastPage=await largeRepository.listHistory('student1','events',firstPage.nextCursor,50);assert.equal(lastPage.records.length,23);
 assert.equal(new Set([...firstPage.records,...lastPage.records].map(row=>row.historyId)).size,73);check('501-row inequality pagination, generation paths and full bounded history');
 const profileClass='worker-rest-profile-'+suffix,profileStore=new EmulatorStore(profileClass),profileRepository=new StateRepository(profileStore,profileClass),profileState=fixture();
 const profileUIDs=profileState.members.map(member=>member.id).sort(),profilePath=async(studentNo:string)=>`classes/${profileClass}/pinAccounts/${await digest(profileClass+':'+studentNo)}`;
 const originalPath=await profilePath('00001'),renamedPath=await profilePath('00101');
 const credential={uid:'student1',studentNo:'00001',active:true,scheme:'firebase-password-v1',salt:'e'.repeat(32),authEmail:'student1@students.wooriban-2027.invalid',version:1,createdAt:now};
 await profileStore.put([{path:profileRepository.statePath,value:profileState,previous:null},{path:originalPath,value:credential,previous:null}]);
 const originalDerived=await pinPassword('0123','synthetic-native-pepper-'.repeat(3),credential.salt),readsBeforeName=profileStore.reads.length;
 await profileRepository.execute('teacher','memberProfile',{uid:'student1',name:'  Synthetic Renamed Student  ',studentNo:'00001',previousStudentNo:'00001',version:1},'profile-name',now);
 assert.ok(profileStore.reads.slice(readsBeforeName).every(path=>!path.includes('/pinAccounts/')),'Name-only edits must not read credentials.');
 const named=await profileRepository.readState('teacher');assert.equal(named.members.find(member=>member.id==='student1')?.name,'Synthetic Renamed Student');assert.equal(named.members.find(member=>member.id==='student1')?.profileVersion,2);
 assert.deepEqual(profileStore.value(await profileStore.get(originalPath)),credential);
 const rename={uid:'student1',name:'Synthetic Renamed Student',studentNo:'00101',previousStudentNo:'00001',version:2};
 await profileRepository.execute('teacher','memberProfile',rename,'profile-rename',now+1);
 const moved=profileStore.value(await profileStore.get(renamedPath)),retired=profileStore.value(await profileStore.get(originalPath));
 for(const key of ['uid','salt','authEmail','active','scheme'] as const)assert.equal(moved[key],credential[key]);
 assert.equal(moved.studentNo,'00101');assert.equal(moved.version,2);assert.equal(retired.active,false);assert.equal(retired.scheme,'student-number-retired-v1');assert.equal(retired.salt,undefined);assert.equal(retired.authEmail,undefined);
 const renamed=await profileRepository.readState('student1');assert.equal(renamed.members.find(member=>member.id==='student1')?.studentNo,'00101');assert.deepEqual(renamed.members.map(member=>member.id).sort(),profileUIDs);
 const readsBeforeRetry=profileStore.reads.length;assert.equal((await profileRepository.execute('teacher','memberProfile',rename,'profile-rename',now+2)).duplicate,true);assert.ok(profileStore.reads.slice(readsBeforeRetry).every(path=>!path.includes('/pinAccounts/')));
 await profileRepository.execute('teacher','memberProfile',{uid:'student1',name:'Synthetic Renamed Student',studentNo:'00001',previousStudentNo:'00101',version:3},'profile-revert',now+3);
 const restoredCredential=profileStore.value(await profileStore.get(originalPath)),retiredTypo=profileStore.value(await profileStore.get(renamedPath)),restoredProfile=await profileRepository.readState('teacher');
 for(const key of ['uid','salt','authEmail','active','scheme'] as const)assert.equal(restoredCredential[key],credential[key]);
 assert.equal(restoredCredential.version,3);assert.equal(retiredTypo.active,false);assert.equal(retiredTypo.salt,undefined);assert.equal(retiredTypo.authEmail,undefined);
 assert.equal(restoredProfile.members.find(member=>member.id==='student1')?.studentNo,'00001');assert.equal(restoredProfile.members.find(member=>member.id==='student1')?.profileVersion,4);assert.deepEqual(restoredProfile.members.map(member=>member.id).sort(),profileUIDs);
 assert.equal(await pinPassword('0123','synthetic-native-pepper-'.repeat(3),restoredCredential.salt),originalDerived);
 const profileAudits=await profileRepository.listHistory('teacher','audits');assert.equal(profileAudits.records.length,3);assert.doesNotMatch(JSON.stringify(profileAudits.records),/authEmail|salt|firebase-password-v1|synthetic-native-pepper/);assert.doesNotMatch(JSON.stringify(profileAudits.records.map(record=>record.input)),/0123/);check('native profile rename, retired-number revert, credential preservation and zero-read name edits');
 console.log(JSON.stringify({ok:true,project,host,checks:7,syntheticDocuments:[...stores].reduce((count,item)=>count+item.paths.size,0),productionAccess:false}));
}catch(error){mainErrors.push(error);throw error;
}finally{
 const cleanupErrors:unknown[]=[];
 try{for(const store of stores.reverse())try{await store.clean();assert.equal(await store.get(store.scope+'private/state'),null);}catch(error){cleanupErrors.push(error);}}
 finally{globalThis.fetch=nativeFetch;}
 if(cleanupErrors.length)throw new AggregateError([...mainErrors,...cleanupErrors],'Synthetic document cleanup failed; all classes were attempted.');
 console.log('CLEANUP synthetic class documents removed and verified');
}
