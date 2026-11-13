import {test} from 'node:test';
import assert from 'node:assert/strict';
import {command,visible,kstDate,balance} from '../src/domain';
import {seed} from '../src/seed';
import {calendarDate,calendarMonth} from '../src/validation';

test('unknown action fields and malformed payloads cannot grow or mutate class state',()=>{
 const s=seed(),before=structuredClone(s);
 for(const payload of [null,[],{enabled:true,extra:'x'.repeat(60000)},{enabled:'true'}])assert.throws(()=>command(s,'student1','preferences',payload as any,'malformed'));
 assert.deepEqual(s,before);
 assert.throws(()=>command(s,'student1','preferences',{enabled:false},'x'.repeat(121)),/요청 키/);
 assert.deepEqual(s,before);
});

test('calendar validation rejects impossible dates and months, including leap-day mistakes',()=>{
 assert.equal(calendarDate('2028-02-29'),true);
 for(const date of ['2027-02-29','2028-02-30','2027-04-31','2027-00-01','2027-13-01','2027-01-00','2027-1-01'])assert.equal(calendarDate(date),false,date);
 assert.equal(calendarMonth('2027-12'),true);
 for(const month of ['2027-00','2027-13','2027-1'])assert.equal(calendarMonth(month),false,month);
 const s=seed(),before=structuredClone(s);
 assert.throws(()=>command(s,'student1','exam',{typeId:'itq',date:'2099-02-30',start:'10:00',end:'11:00'},'invalid-date'));
 assert.throws(()=>command(s,'student1','shop',{itemId:'outing',date:'2099-02-30'},'invalid-shop-date'));
 assert.throws(()=>command(s,'teacher','payout',{month:'2027-13'},'invalid-month'));
 assert.deepEqual(s,before);
});

test('teachers and unknown membership roles cannot invoke student commands',()=>{
 const s=seed(),before=structuredClone(s);
 for(const [action,payload] of [['shop',{itemId:'snack'}],['quiz',{choice:2,version:1}],['exam',{typeId:'itq',date:'2099-01-01',start:'10:00',end:'11:00'}]] as const)assert.throws(()=>command(s,'teacher',action,payload,'teacher-'+action),/학생/);
 assert.deepEqual(s,before);
 s.members.push({id:'invalid-role',role:'administrator',active:true,name:'Invalid'});
 assert.throws(()=>command(s,'invalid-role','preferences',{enabled:false},'invalid-role'),/활성/);
 assert.throws(()=>visible(s,'invalid-role'),/비활성/);
});

test('setting schemas reject wrong types, unknown fields and oversized strings before mutation',()=>{
 const s=seed(),before=structuredClone(s);
 const cases=[
  {table:'notices',id:'n1',version:1,data:{title:{name:'bad'}}},
  {table:'notices',id:'n1',version:1,data:{body:'x'.repeat(20001)}},
  {table:'notices',id:'n1',version:1,data:{url:'https://user:secret@example.com'}},
  {table:'notices',id:'n1',version:1,data:{active:'false'}},
  {table:'items',id:'snack',version:1,data:{price:100001}},
  {table:'items',id:'snack',version:1,data:{unknown:'extra'}},
  {table:'roles',id:'r1',version:1,data:{uids:['teacher']}},
  {table:'roles',id:'r1',version:1,data:{uids:['student1','student1']}},
  {table:'settings',id:'class',version:1,data:{year:{value:2027}}},
  {table:'settings',id:'other',data:{message:'unsupported'}},
  {table:'settings',id:'notifications',data:{grant:'true'}},
  {table:'examTypes',id:'new-type',data:{name:'',active:true}},
  {table:'quizzes',id:'new-quiz',data:{date:'2099-01-01',question:'Question',options:[{},'B','C','D'],answer:1,active:true}}
 ];
 for(const [index,payload] of cases.entries()){assert.throws(()=>command(s,'teacher','save',payload,'bad-setting-'+index));assert.deepEqual(s,before);}
});

test('existing JSON editor metadata is accepted unchanged but cannot be forged',()=>{
 const s=seed(),notice=s.notices[0];
 command(s,'teacher','save',{table:'notices',id:notice.id,version:notice.version,data:{...notice,title:'수정된 제목'}},'metadata-ok');
 assert.equal(notice.version,2);assert.equal(notice.title,'수정된 제목');
 const before=structuredClone(s);
 assert.throws(()=>command(s,'teacher','save',{table:'notices',id:notice.id,version:notice.version,data:{...notice,createdAt:1}},'metadata-forged'),/변경할 수 없습니다/);
 assert.deepEqual(s,before);
});

test('submitted quiz contents and answer are frozen, while deactivation and new future questions remain possible',()=>{
 const s=seed(),quiz=s.quizzes[0],originalOptions=[...quiz.options];
 command(s,'student1','quiz',{choice:2,version:1},'attempt');
 assert.equal(s.attempts[0].quizId,quiz.id);assert.equal(s.attempts[0].quizVersion,1);
 assert.equal(typeof quiz.submittedAt,'number');
 for(const patch of [{question:'Changed'}, {options:['Changed','B','C','D']},{answer:1},{explanation:'Changed'},{date:'2099-01-01'}]){
  const before=structuredClone(s);assert.throws(()=>command(s,'teacher','save',{table:'quizzes',id:quiz.id,version:1,data:patch},'change-'+Object.keys(patch)[0]),/제출된 문제/);assert.deepEqual(s,before);
 }
 command(s,'teacher','save',{table:'quizzes',id:quiz.id,version:1,data:{active:false}},'deactivate');
 assert.equal(quiz.active,false);assert.equal(quiz.version,2);
 assert.throws(()=>command(s,'teacher','save',{table:'quizzes',id:'replacement',data:{...Object.fromEntries(['date','question','options','answer','explanation'].map(k=>[k,quiz[k]])),active:true}},'same-day'),/이미 제출/);
 command(s,'teacher','save',{table:'quizzes',id:'future-quiz',data:{date:'2099-01-01',question:'Future question',options:['A','B','C','D'],answer:1,explanation:'Explanation',active:true}},'future');
 quiz.options[0]='direct source mutation';assert.deepEqual(s.attempts[0].options,originalOptions,'attempt preserves a copied historical question');
});

test('quiz freeze survives attempt archival and protects legacy past questions',()=>{
 const s=seed(),quiz=s.quizzes[0];command(s,'student1','quiz',{choice:2,version:1},'first-attempt');
 s.attempts=[];
 assert.throws(()=>command(s,'teacher','save',{table:'quizzes',id:quiz.id,version:1,data:{answer:1}},'after-archive'),/제출된 문제/);
 delete quiz.submittedAt;quiz.date='2020-01-01';
 assert.throws(()=>command(s,'teacher','save',{table:'quizzes',id:quiz.id,version:1,data:{question:'Changed past question'}},'legacy-past'),/제출된 문제/);
});

test('only one active quiz per day and students cannot read future or draft questions',()=>{
 const s=seed();
 const future={id:'future',date:'2099-01-01',question:'Unpublished future question',options:['A','B','C','D'],answer:1,explanation:'Secret',active:true,version:1};
 s.quizzes.push(future,{...future,id:'draft',date:kstDate(),active:false});
 const view=visible(s,'student1');assert.equal(view.quizzes.length,1);assert.equal(view.quizzes[0].answer,undefined);assert.equal(view.quizzes[0].explanation,undefined);
 assert.throws(()=>command(s,'teacher','save',{table:'quizzes',id:'duplicate-future',data:{date:future.date,question:'Duplicate',options:['A','B','C','D'],answer:1,active:true}},'duplicate'),/하나만/);
});

test('exam edits and approvals use optimistic versions and preserve initial application timestamp',()=>{
 const s=seed(),payload={typeId:'itq',date:'2099-01-01',start:'10:00',end:'11:00'};
 command(s,'student1','exam',payload,'new-exam',1000);const exam=s.exams[0];assert.equal(exam.version,1);
 command(s,'student1','exam',{...payload,id:exam.id,version:1,start:'11:00',end:'12:00'},'edit-exam',2000);
 assert.equal(exam.version,2);assert.equal(exam.at,1000);assert.equal(exam.updatedAt,2000);
 const before=structuredClone(s);
 assert.throws(()=>command(s,'teacher','examStatus',{id:exam.id,status:'approved',version:1},'stale-approval'),/변경/);
 assert.throws(()=>command(s,'student1','exam',{...payload,id:exam.id,version:1},'stale-edit'),/변경/);
 assert.deepEqual(s,before);
 command(s,'teacher','examStatus',{id:exam.id,status:'approved',version:2},'approve');assert.equal(exam.version,3);
 assert.throws(()=>command(s,'student1','exam',{...payload,id:exam.id,version:3},'after-approval'),/수정할 수 없는/);
});

test('legacy exam records without version use version one without data migration',()=>{
 const s=seed();command(s,'student1','exam',{typeId:'itq',date:'2099-01-01',start:'10:00',end:'11:00'},'new');const exam=s.exams[0];delete exam.version;
 command(s,'student1','examStatus',{id:exam.id,status:'cancelled',version:1},'legacy-cancel');assert.equal(exam.version,2);assert.equal(exam.status,'cancelled');
});

test('notification recipients and bodies are validated before any delivery',()=>{
 const s=seed(),before=structuredClone(s);
 for(const payload of [{uids:['student1','outsider'],body:'Notice'},{uids:['teacher'],body:'Notice'},{uids:['student1','student1'],body:'Notice'},{uids:'student1',body:'Notice'},{body:''},{body:'x'.repeat(2001)}]){
  assert.throws(()=>command(s,'teacher','notify',payload as any,'bad-notice'));assert.deepEqual(s,before);
 }
 s.members.find(m=>m.id==='student2')!.active=false;
 command(s,'teacher','notify',{body:'Only active students'},'valid-notice');assert.deepEqual(s.inbox.map(n=>n.uid),['student1']);
});

test('no-op preference and read actions do not create unbounded audit history',()=>{
 const s=seed();for(let i=0;i<100;i++)command(s,'student1','preferences',{enabled:true},'same-preference-'+i);assert.equal(s.audits.length,0);
 command(s,'teacher','notify',{uids:['student1'],body:'Notice'},'notice');const notice=s.inbox[0];command(s,'student1','read',{id:notice.id},'read');const count=s.audits.length;
 for(let i=0;i<100;i++)command(s,'student1','read',{id:notice.id},'read-again-'+i);assert.equal(s.audits.length,count);
});

test('malformed later payout targets cannot partially credit earlier students',()=>{
 const s=seed();s.roles[1].points=-1;const before=structuredClone(s);
 assert.throws(()=>command(s,'teacher','payout',{month:'2027-01'},'bad-payout'));assert.deepEqual(s,before);
});

test('new IDs distinguish ambiguous actor/key combinations and historical idempotency remains valid',()=>{
 const s=seed();s.members.push({id:'a_b',role:'teacher',name:'Teacher one',active:true},{id:'a',role:'teacher',name:'Teacher two',active:true});
 const payload={uid:'student1',amount:7,reason:'Two independent grants'},before=balance(s,'student1').available;
 command(s,'a_b','points',payload,'c');command(s,'a','points',payload,'b_c');assert.equal(balance(s,'student1').available-before,14);
 assert.equal(new Set(s.events.map(e=>e.id)).size,s.events.length);assert.equal(new Set(s.audits.map(a=>a.id)).size,s.audits.length);
 command(s,'a_b','points',payload,'c');assert.equal(balance(s,'student1').available-before,14);
 s.audits.push({id:'teacher_legacy',actor:'teacher',action:'points',input:JSON.stringify({action:'points',p:payload}),at:1});
 command(s,'teacher','points',payload,'legacy');assert.equal(balance(s,'student1').available-before,14);
});

test('outstanding request caps bound unresolved free-shop and future-exam records',()=>{
 const s=seed();s.items.find(i=>i.id==='snack')!.price=0;
 for(let i=0;i<20;i++)command(s,'student1','shop',{itemId:'snack'},'free-'+i);
 let before=structuredClone(s);assert.throws(()=>command(s,'student1','shop',{itemId:'snack'},'free-over-limit'),/20건/);assert.deepEqual(s,before);
 for(let i=0;i<20;i++){const hour=String(i).padStart(2,'0');command(s,'student1','exam',{typeId:'itq',date:'2099-01-01',start:hour+':00',end:hour+':15'},'exam-'+i);}
 before=structuredClone(s);assert.throws(()=>command(s,'student1','exam',{typeId:'itq',date:'2099-01-01',start:'20:00',end:'20:15'},'exam-over-limit'),/20건/);assert.deepEqual(s,before);
});
