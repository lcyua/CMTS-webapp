import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanDefinition,mergeDefinitionRows} from '../src/settings-history';
import {settingData} from '../src/validation';
import {seed} from '../src/seed';

test('history envelope metadata never becomes an editable setting or identifier',()=>{
 const s=seed(),original=s.notices[0];
 const row=cleanDefinition({...original,id:'archive_transport_id',originalId:original.id,historyId:'transport-id',archived:true});
 assert.equal(row.id,original.id);assert.equal('archived'in row,false);assert.equal('historyId'in row,false);assert.equal('originalId'in row,false);
 assert.doesNotThrow(()=>settingData(s,'notices',row.id,{title:'Edited archived notice'},row));
});

test('paged definitions deduplicate by stable ID and preserve newer live and locally saved versions',()=>{
 const current=[{id:'recent',version:3,title:'Latest live notice'}];
 const history=[{id:'recent',version:1,title:'Stale history',archived:true},{id:'old',version:2,title:'Older notice',archived:true}];
 const first=mergeDefinitionRows(current,history);assert.equal(first.length,2);assert.equal(first[0].title,'Latest live notice');assert.equal(first[1].id,'old');
 const saved={id:'old',version:3,title:'Saved update'};
 const updated=mergeDefinitionRows(current,mergeDefinitionRows([saved],history));assert.equal(updated.find(row=>row.id==='old')!.title,'Saved update');
 const fresh=mergeDefinitionRows([{id:'old',version:4,title:'Changed elsewhere'}],updated);assert.equal(fresh.find(row=>row.id==='old')!.version,4);
});
