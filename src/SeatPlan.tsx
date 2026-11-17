import React,{useId} from 'react';
import type {RecordData} from './domain';
import './seat-plan.css';

export interface SeatPlanProps {
 assignments:readonly string[];
 members:readonly RecordData[];
 version:number;
 editable:boolean;
 disabled?:boolean;
 inputPrefix?:string;
}

/** Classroom view only: existing assignment order and form field indexes stay intact. */
export function SeatPlan({assignments,members,version,editable,disabled=false,inputPrefix='p'}:SeatPlanProps){
 const helpId=useId();
 const students=members.filter(member=>member.role==='student');
 const activeStudents=students.filter(member=>member.active);
 const studentName=(uid:string)=>students.find(member=>member.id===uid)?.name||'배정 학생';
 const seat=(index:number)=>{
  const uid=assignments[index]||'',exists=index<assignments.length,canEdit=editable&&exists;
  const position=index<18?`${Math.floor(index/6)+1}행 ${index%6+1}열`:`추가 기록 ${index+1}`;
  return <label className={'seat-card'+(!exists?' seat-card-empty':'')} key={index}>
   <span className="seat-number">{index<18?`좌석 ${index+1}`:`추가 ${index+1}`}</span>
   {canEdit?<select name={inputPrefix+index} aria-label={`${position} 학생`} defaultValue={uid} key={`${version}_${index}`} disabled={disabled}>
    <option value="">미배정</option>
    {uid&&!activeStudents.some(member=>member.id===uid)&&<option value={uid}>{studentName(uid)} · 현재 배정</option>}
    {activeStudents.map(member=><option value={member.id} key={member.id}>{member.name}</option>)}
   </select>:<span className="seat-name" title={uid?studentName(uid):undefined}>{uid?studentName(uid):'미배정'}</span>}
  </label>;
 };
 return <div className="seat-plan">
  <p className="seat-plan-description">3행 6열 · 가로 두 자리씩 짝꿍입니다.</p>
  <p id={helpId} className="seat-scroll-hint">좌석표를 좌우로 움직여 모든 자리를 확인할 수 있습니다.</p>
  <div className="seat-plan-viewport" tabIndex={0} aria-label="교실 좌석표" aria-describedby={helpId}>
   <div className="seat-plan-board">
    <div className="seat-plan-front"><span>칠판 · 교실 앞</span></div>
    <div className="seat-column-headings" aria-hidden="true"><span/>{[0,1,2].map(pair=><span key={pair}>{pair*2+1}·{pair*2+2}열 짝꿍</span>)}</div>
    <div className="seat-plan-rows" role="group" aria-label="3행 6열, 1·2열과 3·4열과 5·6열이 짝꿍">
     {[0,1,2].map(row=><div className="seat-plan-row" key={row} role="group" aria-label={`${row+1}행`}>
      <span className="seat-row-label" aria-hidden="true">{row+1}행</span>
      {[0,1,2].map(pair=><div className="seat-pair" key={pair} role="group" aria-label={`${row+1}행 ${pair*2+1}·${pair*2+2}열 짝꿍`}>
       {seat(row*6+pair*2)}{seat(row*6+pair*2+1)}
      </div>)}
     </div>)}
    </div>
   </div>
  </div>
  {assignments.length<18&&editable&&<p className="hint">현재 배치 기록에 없는 빈칸은 보기 전용입니다.</p>}
  {assignments.length>18&&<div className="seat-plan-overflow">
   <p role="alert">18자리를 초과한 기존 배정 {assignments.length-18}건이 있습니다. 아래 기록도 함께 유지합니다.</p>
   <div className="seat-overflow-records">{assignments.slice(18).map((_,offset)=>seat(18+offset))}</div>
  </div>}
 </div>;
}
