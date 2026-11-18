import test from 'node:test';
import assert from 'node:assert/strict';
import {examStudentOptions,matchesExam,type ExamFilters} from '../src/exam-filters';
import {collectExamExport} from '../src/exam-export';

const filters:ExamFilters={studentUid:'s1',studentNo:'00102',date:'',status:'',typeId:''};
test('student selection follows UID across profile changes and never matches another UID by number',()=>{
 assert.equal(matchesExam({uid:'s1',studentNo:'00101',name:'이전 이름'},filters),true);
 assert.equal(matchesExam({uid:'s2',studentNo:'00102'},filters),false);
 assert.equal(matchesExam({studentNo:'00102'},filters),true);
 assert.equal(matchesExam({studentNo:'0010'},filters),false);
});
test('student dropdown includes inactive and historical applicants without duplicate numbers for anonymous legacy rows',()=>{
 const options=examStudentOptions([{id:'s1',role:'student',active:true,studentNo:'00102',name:'새 이름'},{id:'s2',role:'student',active:false,studentNo:'00103',name:'이전 학생'},{id:'teacher',role:'teacher',name:'교사'}],[{uid:'s1',studentNo:'00101',name:'옛 이름'},{uid:'old',studentNo:'00104',name:'기록 학생'},{studentNo:'00102'},{studentNo:'00105',name:'이전 기록'}]);
 assert.deepEqual(options.map(option=>option.value),['uid:s1','uid:s2','uid:old','number:00105']);
 assert.equal(options[0].studentNo,'00102');assert.equal(options[1].inactive,true);
});
test('paged workbook uses the same UID selection as visible results',async()=>{
 const records=[{id:'a',uid:'s1',studentNo:'00101'},{id:'b',uid:'s2',studentNo:'00102'}];
 const exported=await collectExamExport(async cursor=>cursor?{records:[records[1]],nextCursor:null}:{records:[records[0]],nextCursor:'two'},filters);
 assert.deepEqual(exported,records.filter(row=>matchesExam(row,filters)));
});
