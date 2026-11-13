import test from 'node:test';
import assert from 'node:assert/strict';
import {collectExamExport} from '../src/exam-export';
const row=(id:string,status='approved')=>({id,studentNo:'00101',name:'합성 학생',date:'2027-03-01',typeId:'itq',status});
test('exam export filters every history page and deduplicates records across pages',async()=>{
 const calls:(string|null|undefined)[]=[];
 const result=await collectExamExport(async cursor=>{calls.push(cursor);return !cursor?{records:[row('one'),row('two','pending')],nextCursor:'second'}:{records:[row('one'),row('three')],nextCursor:null};},{text:'00101',status:'approved',date:'2027-03-01',typeId:'itq'});
 assert.deepEqual(result.map(item=>item.id),['one','three']);assert.deepEqual(calls,[undefined,'second']);
});
test('exam export refuses repeated cursors and over-limit partial results',async()=>{
 const filters={text:'',status:'',date:'',typeId:''};
 await assert.rejects(collectExamExport(async()=>({records:[row('one')],nextCursor:'again'}),filters),/반복/);
 await assert.rejects(collectExamExport(async()=>({records:[row('one'),row('two')],nextCursor:null}),filters,1),/한도/);
});
