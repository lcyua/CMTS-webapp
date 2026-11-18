import {test} from 'node:test';
import assert from 'node:assert/strict';
import {command} from '../src/domain';
import {seed} from '../src/seed';

function fixture(){
 const state=seed();
 state.members.find(member=>member.id==='student2')!.delegations=['cleaning'];
 const plan=state.plans.find(entry=>entry.kind==='cleaning')!;
 return {state,plan};
}

test('teacher can rename and append a cleaning zone without losing existing assignments or revision',()=>{
 const {state,plan}=fixture(),before=structuredClone(plan);
 command(state,'teacher','plan',{id:plan.id,version:plan.version,assignments:[...plan.assignments,''],labels:[' 교실 앞 ','교실 뒤','복도','분리수거','창문']},'rename-add',1234);
 assert.deepEqual(plan.assignments,[...before.assignments,'']);
 assert.deepEqual(plan.labels,['교실 앞','교실 뒤','복도','분리수거','창문']);
 assert.equal(plan.version,before.version+1);assert.equal(plan.updatedAt,1234);
 assert.deepEqual(state.audits.find(audit=>audit.action==='planRevision')?.before,before);
 const saved=structuredClone(plan);
 command(state,'teacher','plan',{id:before.id,version:before.version,assignments:[...before.assignments,''],labels:[' 교실 앞 ','교실 뒤','복도','분리수거','창문']},'rename-add',1234);
 assert.deepEqual(plan,saved);
});

test('legacy cleaning assignment update preserves missing labels and existing plan metadata',()=>{
 const {state,plan}=fixture();plan.notes='existing metadata';
 command(state,'teacher','plan',{id:plan.id,version:1,assignments:['student2','student1','','']},'legacy');
 assert.equal(plan.labels,undefined);assert.equal(plan.notes,'existing metadata');
 assert.deepEqual(plan.assignments,['student2','student1','','']);
});

test('delegated student can reassign existing named zones but cannot rename or add zones',()=>{
 const {state,plan}=fixture();plan.labels=['앞','뒤','복도','창문'];
 command(state,'student2','plan',{id:plan.id,version:1,assignments:['student2','student1','','']},'reassign');
 assert.deepEqual(plan.labels,['앞','뒤','복도','창문']);
 const before=structuredClone(state);
 for(const [key,extra] of Object.entries({rename:{assignments:[...plan.assignments],labels:['새 이름','뒤','복도','창문']},add:{assignments:[...plan.assignments,'']}})){
  assert.throws(()=>command(state,'student2','plan',{id:plan.id,version:2,...extra},key),/교사/);
  assert.deepEqual(state,before);
 }
 assert.throws(()=>command(state,'student1','plan',{id:plan.id,version:2,assignments:[...plan.assignments]},'ordinary'),/권한/);
});

test('cleaning zones cannot be deleted or added without a matching name for every assignment',()=>{
 const {state,plan}=fixture(),before=structuredClone(state);
 for(const [key,payload] of Object.entries({remove:{assignments:['student1'],labels:['앞']},unnamed:{assignments:[...plan.assignments,'']},mismatch:{assignments:[...plan.assignments,''],labels:['앞','뒤','복도','창문']}})){
  assert.throws(()=>command(state,'teacher','plan',{id:plan.id,version:1,...payload},key),/삭제|이름|칸 수/);
  assert.deepEqual(state,before);
 }
});

test('cleaning zone labels reject blank, trimmed duplicate, long names and more than 60 zones',()=>{
 const {state,plan}=fixture(),before=structuredClone(state);
 const invalid=[['','뒤','복도','창문'],['앞',' 앞 ','복도','창문'],['x'.repeat(101),'뒤','복도','창문']];
 for(const [index,labels] of invalid.entries()){
  assert.throws(()=>command(state,'teacher','plan',{id:plan.id,version:1,assignments:[...plan.assignments],labels},'names'+index),/이름/);
  assert.deepEqual(state,before);
 }
 assert.throws(()=>command(state,'teacher','plan',{id:plan.id,version:1,assignments:Array(61).fill(''),labels:Array.from({length:61},(_,index)=>'구역 '+index)},'too-many'),/60/);
 assert.deepEqual(state,before);
 command(state,'teacher','plan',{id:plan.id,version:1,assignments:[...plan.assignments,...Array(56).fill('')],labels:Array.from({length:60},(_,index)=>'구역 '+index)},'at-limit');
 assert.equal(plan.assignments.length,60);assert.equal(plan.labels.length,60);
});

test('cleaning additions preserve duplicate and active student validation before any mutation',()=>{
 for(const assignments of [['student1','student1','','',''],['student1','teacher','','',''],['student1','missing','','','']]){
  const {state,plan}=fixture(),before=structuredClone(state);
  assert.throws(()=>command(state,'teacher','plan',{id:plan.id,version:1,assignments,labels:['앞','뒤','복도','창문','새 구역']},'invalid-student'),/중복|배정/);
  assert.deepEqual(state,before);
 }
 const {state,plan}=fixture();state.members.find(member=>member.id==='student2')!.active=false;
 assert.throws(()=>command(state,'teacher','plan',{id:plan.id,version:1,assignments:[...plan.assignments]},'inactive'),/배정/);
});

test('stale cleaning rename or append cannot overwrite a saved plan',()=>{
 const {state,plan}=fixture();
 command(state,'teacher','plan',{id:plan.id,version:1,assignments:[...plan.assignments],labels:['앞','뒤','복도','창문']},'first');
 const before=structuredClone(state);
 assert.throws(()=>command(state,'teacher','plan',{id:plan.id,version:1,assignments:[...plan.assignments,''],labels:['다른 앞','뒤','복도','창문','새 구역']},'stale'),/수정/);
 assert.deepEqual(state,before);
});

test('cleaning extension does not widen seat delegation, labels or fixed seat count',()=>{
 const state=seed(),plan=state.plans.find(entry=>entry.kind==='seat')!,assignments=[...plan.assignments],before=structuredClone(state);
 assert.throws(()=>command(state,'teacher','plan',{id:plan.id,version:1,assignments},'teacher-seat'),/권한/);
 assert.throws(()=>command(state,'student1','plan',{id:plan.id,version:1,assignments:[...assignments,'']},'resize-seat'),/칸 수/);
 assert.throws(()=>command(state,'student1','plan',{id:plan.id,version:1,assignments,labels:assignments.map((_,index)=>'좌석 '+index)},'label-seat'),/이름/);
 assert.deepEqual(state,before);
 command(state,'student1','plan',{id:plan.id,version:1,assignments:['student2','student1',...assignments.slice(2)]},'seat-existing');
 assert.equal(plan.version,2);
});
