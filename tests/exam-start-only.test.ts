import {test} from 'node:test';
import assert from 'node:assert/strict';
import {command,type RecordData} from '../src/domain';
import {seed} from '../src/seed';
import {examTimesConflict,formatExamTime} from '../src/exam-time';

const date='2099-01-01';
function state(){const s=seed();s.examTypes=[{id:'fixture-exam',name:'시험 fixture',active:true,version:1}];return s;}
const application=(start='10:00')=>({typeId:'fixture-exam',date,start});

test('new exam applications record only the supplied start and retain idempotency',()=>{
 const s=state(),payload=application();command(s,'student1','exam',payload,'new',1000);
 const exam=s.exams[0];assert.equal(exam.start,'10:00');assert.equal(exam.timeMode,'start');assert.equal(Object.hasOwn(exam,'end'),false);
 assert.equal(formatExamTime(exam),'10:00 시작');
 const before=structuredClone(s);command(s,'student1','exam',payload,'new',2000);assert.deepEqual(s,before);
 assert.throws(()=>command(s,'student1','exam',{...payload,start:'11:00'},'new',2000),/동일 요청/);
});

test('start-only conflicts are scoped to the student, day and active statuses',()=>{
 const s=state();command(s,'student1','exam',application(),'first');
 const before=structuredClone(s);assert.throws(()=>command(s,'student1','exam',application(),'duplicate'),/겹치는/);assert.deepEqual(s,before);
 command(s,'student1','exam',application('10:01'),'different-start');
 command(s,'student1','exam',{...application(),date:'2099-01-02'},'different-date');
 command(s,'student2','exam',application(),'different-owner');
 command(s,'teacher','examStatus',{id:s.exams[0].id,status:'approved',version:1},'approve');
 assert.throws(()=>command(s,'student1','exam',application(),'duplicate-approved'),/겹치는/);
 command(s,'student1','examStatus',{id:s.exams[1].id,status:'cancelled',version:1},'cancel');
 command(s,'student1','exam',application('10:01'),'after-cancel');
});

test('known legacy intervals and start-only points use half-open conflict bounds in both directions',()=>{
 const interval={start:'10:00',end:'11:00'};
 for(const [start,conflict] of [['09:59',false],['10:00',true],['10:30',true],['11:00',false]] as const){
  assert.equal(examTimesConflict(interval,{start}),conflict);assert.equal(examTimesConflict({start},interval),conflict);
  const s=state();s.exams=[{id:'legacy',uid:'student1',date,...interval,status:'pending'}];
  if(conflict)assert.throws(()=>command(s,'student1','exam',application(start),'point'),/겹치는/);
  else command(s,'student1','exam',application(start),'point');
 }
 assert.equal(examTimesConflict(interval,{start:'10:30',end:'11:30'}),true);
 assert.equal(examTimesConflict(interval,{start:'11:00',end:'12:00'}),false);
 const s=state();command(s,'student1','exam',application('10:30'),'point');
 assert.throws(()=>command(s,'student1','exam',{...application(),end:'11:00'},'legacy-payload'),/겹치는/);
});

test('explicit legacy end times are validated while absent end times need no invented duration',()=>{
 for(const end of ['',null,'25:00','09:00','10:00']){
  const s=state(),before=structuredClone(s);
  assert.throws(()=>command(s,'student1','exam',{...application(),end},'invalid'));assert.deepEqual(s,before);
 }
 const s=state();command(s,'student1','exam',{...application(),end:'11:00'},'legacy');
 assert.equal(s.exams[0].timeMode,'interval');assert.equal(s.exams[0].end,'11:00');assert.equal(formatExamTime(s.exams[0]),'10:00–11:00');
 assert.throws(()=>command(s,'student1','exam',{...application('12:00'),timeMode:'interval'},'forged-model'),/허용되지/);
});

test('editing a legacy application archives its end and replaces it with an explicit start-only model',()=>{
 const s=state();s.exams=[{id:'legacy',uid:'student1',studentNo:'01101',name:'기존 학생',typeId:'fixture-exam',typeName:'시험 fixture',date,start:'10:00',end:'11:00',status:'pending',at:1000}];
 const legacy=structuredClone(s.exams[0]),payload={...application('12:00'),id:'legacy',version:1};
 command(s,'student1','exam',payload,'edit',2000);
 const exam=s.exams[0];assert.equal(exam.at,1000);assert.equal(exam.updatedAt,2000);assert.equal(exam.version,2);assert.equal(exam.timeMode,'start');assert.equal(Object.hasOwn(exam,'end'),false);
 const revisions=s.audits.filter(a=>a.action==='examRevision');assert.equal(revisions.length,1);assert.deepEqual(revisions[0].before,legacy);
 const before=structuredClone(s);command(s,'student1','exam',payload,'edit',3000);assert.deepEqual(s,before);
 assert.throws(()=>command(s,'student1','exam',payload,'stale',3000),/변경/);
 assert.throws(()=>command(s,'student2','exam',{...payload,version:2},'other-owner',3000),/수정할 수 없는/);
 assert.deepEqual(s,before);
 command(s,'teacher','examStatus',{id:'legacy',status:'approved',version:2},'approve',4000);
 assert.throws(()=>command(s,'student1','exam',{...payload,version:3},'approved-edit',5000),/수정할 수 없는/);
});

test('legacy history formatting retains known ends and handles start-only records consistently',()=>{
 const legacy:RecordData={start:'10:00',end:'11:00'};
 assert.equal(formatExamTime(legacy),'10:00–11:00');
 assert.equal(formatExamTime({...legacy,timeMode:'start'}),'10:00 시작');
 assert.equal(formatExamTime({start:'not-a-clock'}),'시작 시간 미기록');
});
