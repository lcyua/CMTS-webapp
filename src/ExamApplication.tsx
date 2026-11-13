import React, {useState} from 'react';
import {kstDate, RecordData, State} from './domain';

type Props = {s:State; disabled:boolean; save:(p:RecordData)=>Promise<boolean>};

export function ExamApplication({s,disabled,save}:Props){
 const [editing,setEditing]=useState<RecordData|null>(null);
 const [submitting,setSubmitting]=useState(false);
 const [error,setError]=useState('');
 const pending=s.exams.filter(exam=>exam.status==='pending');
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  const form=event.currentTarget;
  const values=Object.fromEntries(new FormData(form));
  setError('');setSubmitting(true);
  try{
   if(await save({...values,...(editing?{id:editing.id,version:editing.version??1}:{})})){
    setEditing(null);form.reset();
   }
  }catch(e){setError(e instanceof Error?e.message:'신청을 저장하지 못했습니다.');}
  finally{setSubmitting(false);}
 }
 return <section>
  <h2>{editing?'출석인정결석 신청 수정':'출석인정결석 신청'}</h2>
  <form className="examform" key={editing?`${editing.id}_${editing.version??1}`:'new'} onSubmit={submit}>
   <label>시험 종목<select name="typeId" defaultValue={editing?.typeId||s.examTypes.find(type=>type.active)?.id||''} required disabled={disabled||submitting}>
    <option value="" disabled>시험 종목 선택</option>
    {s.examTypes.filter(type=>type.active||type.id===editing?.typeId).map(type=><option value={type.id} key={type.id}>{type.name}{type.active?'':' (접수 중지)'}</option>)}
   </select></label>
   <label>시험일<input type="date" name="date" min={kstDate()} defaultValue={editing?.date||''} required disabled={disabled||submitting}/></label>
   <label>시작<input type="time" name="start" defaultValue={editing?.start||''} required disabled={disabled||submitting}/></label>
   <label>종료<input type="time" name="end" defaultValue={editing?.end||''} required disabled={disabled||submitting}/></label>
   <button disabled={disabled||submitting||!s.examTypes.some(type=>type.active)}>{editing?'수정 저장':'신청 제출'}</button>
   {editing&&<button type="button" className="secondary" disabled={submitting} onClick={()=>{setEditing(null);setError('');}}>수정 취소</button>}
  </form>
  {!s.examTypes.some(type=>type.active)&&<p>현재 접수 중인 시험 종목이 없습니다.</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  {pending.length>0&&<div><h3>대기 중인 내 신청 수정</h3>{pending.map(exam=><div className="row" key={exam.id}>
   <span>{exam.typeName} · {exam.date} {exam.start}–{exam.end}</span>
   <button type="button" className="secondary" disabled={disabled||submitting} onClick={()=>{setEditing(exam);setError('');}}>신청 수정</button>
  </div>)}</div>}
 </section>;
}
