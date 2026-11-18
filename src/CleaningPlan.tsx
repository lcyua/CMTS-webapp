import React,{useState} from 'react';
import type {RecordData} from './domain';
import {commandInput} from './validation';
import './cleaning-plan.css';

export interface CleaningPlanProps {
 plan:RecordData;
 members:readonly RecordData[];
 teacher:boolean;
 editable:boolean;
 disabled?:boolean;
 save:(payload:RecordData)=>Promise<boolean>;
}
type Draft={id:string;version:number;assignments:string[];labels:string[];originalAssignments:string[];originalLabels:string[]};

function snapshot(plan:RecordData):Draft {
 const assignments=[...plan.assignments] as string[];
 const labels=assignments.map((_,index)=>typeof plan.labels?.[index]==='string'&&plan.labels[index].trim()?plan.labels[index]:`구역 ${index+1}`);
 return {id:plan.id,version:plan.version,assignments,labels,originalAssignments:[...assignments],originalLabels:[...labels]};
}

export function CleaningPlan({plan,members,teacher,editable,disabled=false,save}:CleaningPlanProps){
 const [editor,setEditor]=useState<Draft|null>(null),[submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const draft=editor??snapshot(plan),locked=disabled||submitting;
 const stale=Boolean(editor&&editor.version!==plan.version);
 const dirty=Boolean(editor&&(JSON.stringify(editor.assignments)!==JSON.stringify(editor.originalAssignments)||JSON.stringify(editor.labels)!==JSON.stringify(editor.originalLabels)));
 const students=members.filter(member=>member.role==='student'),activeStudents=students.filter(member=>member.active);
 const studentName=(uid:string)=>students.find(member=>member.id===uid)?.name||'배정 학생';
 function update(next:Draft){setEditor(next);setError('');setMessage('');}
 function addZone(){
  if(locked||stale||!teacher||!editable||draft.assignments.length>=60)return;
  let number=draft.assignments.length+1;while(draft.labels.some(label=>label.trim()===`구역 ${number}`))number++;
  update({...draft,assignments:[...draft.assignments,''],labels:[...draft.labels,`구역 ${number}`]});
 }
 async function submit(event:React.FormEvent){
  event.preventDefault();if(locked||stale||!editable||!dirty)return;
  setError('');setMessage('');
  const payload={id:draft.id,version:draft.version,assignments:[...draft.assignments],...(teacher?{labels:draft.labels.map(label=>label.trim().normalize('NFC'))}:{})};
  try{
   commandInput('plan',payload,'cleaning-plan-form');
   const assigned=draft.assignments.filter(Boolean);
   if(new Set(assigned).size!==assigned.length)throw Error('한 학생을 여러 청소구역에 중복 배정할 수 없습니다.');
   setSubmitting(true);
   if(await save(payload)){setEditor(null);setMessage('청소구역과 배정을 저장했습니다.');}
  }catch(cause){setError(cause instanceof Error?cause.message:'청소구역을 저장하지 못했습니다.');}
  finally{setSubmitting(false);}
 }
 return <section className="cleaning-plan"><h2>{plan.name} <small>v{plan.version}</small></h2>
 {teacher&&editable&&<p className="hint">구역 이름을 바꾸거나 새 구역을 추가한 뒤 배치 저장을 누르세요.</p>}
 <form onSubmit={event=>void submit(event)}>
  <div className="cleaning-zones">{draft.assignments.map((uid,index)=><div className="cleaning-zone" key={index}>
   {teacher&&editable?<label>구역 {index+1} 이름<input value={draft.labels[index]} maxLength={100} required disabled={locked||stale} onChange={event=>update({...draft,labels:draft.labels.map((label,i)=>i===index?event.target.value:label)})}/></label>:<h3>{draft.labels[index]}</h3>}
   {editable?<label>담당 학생<select value={uid} disabled={locked||stale} onChange={event=>update({...draft,assignments:draft.assignments.map((assigned,i)=>i===index?event.target.value:assigned)})}>
    <option value="">미배정</option>
    {uid&&!activeStudents.some(member=>member.id===uid)&&<option value={uid}>{studentName(uid)} · 현재 배정</option>}
    {activeStudents.map(member=><option value={member.id} key={member.id}>{member.name}</option>)}
   </select></label>:<p className="assignment">{uid?studentName(uid):'미배정'}</p>}
  </div>)}</div>
  {editable&&<div className="actions">
   {teacher&&<button type="button" className="secondary" disabled={locked||stale||draft.assignments.length>=60} onClick={addZone}>+ 구역 추가</button>}
   <button type="submit" disabled={locked||stale||!dirty}>{submitting?'저장 중…':'배치 저장'}</button>
   {editor&&<button type="button" className="secondary" disabled={locked} onClick={()=>{setEditor(null);setError('');setMessage('');}}>{stale?'최신 배치 불러오기':'변경 취소'}</button>}
  </div>}
  {teacher&&editable&&draft.assignments.length>=60&&<p className="hint">청소구역은 최대 60개까지 추가할 수 있습니다.</p>}
  {stale&&<p className="error" role="alert">다른 곳에서 배치가 바뀌었습니다. 최신 배치를 불러온 뒤 다시 수정하세요.</p>}
  {error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </form>
 </section>;
}
