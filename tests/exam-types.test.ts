import{test}from'node:test';
import assert from'node:assert/strict';
import{defaultExamTypes}from'../src/exam-types';
import{seed}from'../src/seed';
import{emptyClass}from'../src/roster';
import{command}from'../src/domain';

const requestedNames=['전기기능사','승강기기능사','설비보전기능사','전자기기기능사','자동화설비기능사','용접기능사','정보처리기능사','신재생에너지기능사'];

test('new demo and class offer the requested eight active exam choices in order',()=>{
 const demo=seed(),newClass=emptyClass({uid:'teacher',name:'합성 교사'},[],2027,'검토 학급');
 for(const types of [demo.examTypes,newClass.examTypes]){
  assert.deepEqual(types.map(type=>type.name),requestedNames);
  assert.equal(new Set(types.map(type=>type.id)).size,requestedNames.length);
  assert.ok(types.every(type=>type.active===true&&type.version===1));
 }
});

test('editing a class catalog cannot mutate another class or the default catalog',()=>{
 const first=defaultExamTypes(),second=defaultExamTypes();
 first[0].name='변경한 종목';
 assert.equal(second[0].name,'전기기능사');
 assert.equal(defaultExamTypes()[0].name,'전기기능사');
});

test('requested catalog can accept a new application while a legacy application keeps its type snapshot',()=>{
 const state=seed();
 const legacy={id:'legacy-exam',uid:'student1',studentNo:'01101',name:'합성 학생',typeId:'itq',typeName:'ITQ',date:'2098-01-01',start:'10:00',end:'11:00',status:'approved',version:1};
 state.exams.push(legacy);
 const before=structuredClone(legacy);
 command(state,'student1','exam',{typeId:state.examTypes[0].id,date:'2099-01-01',start:'10:00',end:'11:00'},'new-catalog-exam');
 assert.deepEqual(state.exams[0],before);
 assert.equal(state.exams[1].typeName,'전기기능사');
 assert.equal(state.exams[1].typeId,'electrical-technician');
});
