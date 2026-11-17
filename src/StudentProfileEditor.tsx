import React,{useState} from 'react';
import type {RecordData,State} from './domain';
import {commandInput} from './validation';
import './student-profile-editor.css';

type Snapshot={uid:string;name:string;previousStudentNo:string;version:number};
type Editor={snapshot:Snapshot;name:string;studentNo:string};
type Props={s:State;busy:boolean;save:(payload:RecordData)=>Promise<boolean>};

/** Only name/student number are edited here. Credentials never enter this form. */
export function StudentProfileEditor({s,busy,save}:Props){
 const [filter,setFilter]=useState(''),[editor,setEditor]=useState<Editor|null>(null),[submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const students=s.members.filter(member=>member.role==='student');
 const shown=students.filter(member=>!filter||`${member.studentNo} ${member.name}`.includes(filter));
 const current=editor?students.find(member=>member.id===editor.snapshot.uid):null;
 const stale=Boolean(editor&&(!current||(current.profileVersion??1)!==editor.snapshot.version||current.studentNo!==editor.snapshot.previousStudentNo));
 const dirty=Boolean(editor&&(editor.name!==editor.snapshot.name||editor.studentNo!==editor.snapshot.previousStudentNo));
 const disabled=busy||submitting;
 function open(member:RecordData){
  if(dirty&&!window.confirm('작성 중인 학생정보 변경을 취소하고 다른 학생을 열까요?'))return;
  const snapshot={uid:String(member.id),name:String(member.name||''),previousStudentNo:String(member.studentNo||''),version:Number(member.profileVersion??1)};
  setEditor({snapshot,name:snapshot.name,studentNo:snapshot.previousStudentNo});setError('');setMessage('');
 }
 function close(){if(dirty&&!window.confirm('작성 중인 변경사항을 취소할까요?'))return;setEditor(null);setError('');}
 async function submit(event:React.FormEvent){
  event.preventDefault();if(!editor||disabled||stale||!dirty)return;
  setError('');setMessage('');
  const payload={...editor.snapshot,name:editor.name.trim(),studentNo:editor.studentNo};
  try{
   commandInput('memberProfile',payload,'student-profile-form');
   if(students.some(member=>member.id!==payload.uid&&member.studentNo===payload.studentNo))throw Error('이미 등록된 학번입니다. 비활성 학생의 학번도 중복 사용할 수 없습니다.');
   if(payload.studentNo!==payload.previousStudentNo&&!window.confirm(`학번을 ${payload.previousStudentNo}에서 ${payload.studentNo}(으)로 바꿀까요? 이후 새 학번으로 로그인하며 기존 계정·PIN·포인트·기록은 유지됩니다.`))return;
   setSubmitting(true);
   if(await save(payload)){setEditor(null);setMessage('학생 이름·학번을 저장했습니다. 기존 계정과 PIN은 유지됩니다.');}
  }catch(cause){setError(cause instanceof Error?cause.message:'학생정보를 저장하지 못했습니다.');}
  finally{setSubmitting(false);}
 }
 return <section className="student-profile-editor"><h2>학생 이름 · 학번 관리</h2>
 <p className="hint">이름과 학번은 교사만 수정할 수 있습니다. 학번을 바꿔도 같은 학생 계정과 PIN, 포인트·신청 기록은 유지됩니다. PIN 원문은 이 화면에서 조회하지 않습니다.</p>
 <label>학생 찾기<input type="search" value={filter} onChange={event=>setFilter(event.target.value)} placeholder="이름 또는 학번"/></label>
 <div className="student-profile-table"><table><thead><tr><th scope="col">학번</th><th scope="col">이름</th><th scope="col">상태</th><th scope="col">관리</th></tr></thead><tbody>{shown.map(member=><tr key={member.id}><td>{member.studentNo}</td><td>{member.name}</td><td>{member.active?'활성':'비활성'}</td><td><button type="button" className="secondary" disabled={disabled} aria-label={`${member.name} 학생정보 수정`} onClick={()=>open(member)}>수정</button></td></tr>)}</tbody></table></div>
 {!shown.length&&<p>검색 결과가 없습니다.</p>}
 {editor&&<form className="student-profile-form" onSubmit={event=>void submit(event)}>
 <h3>{editor.snapshot.name} 학생정보 수정</h3>
 <label>이름<input name="studentName" value={editor.name} maxLength={100} required disabled={disabled} onChange={event=>{setEditor({...editor,name:event.target.value});setError('');}} autoComplete="off"/></label>
 <label>학번<input name="studentNumber" value={editor.studentNo} inputMode="numeric" pattern="[0-9]{1,30}" maxLength={30} required disabled={disabled} onChange={event=>{setEditor({...editor,studentNo:event.target.value});setError('');}} autoComplete="off"/><small>앞자리 0을 포함해 입력하세요. 다른 학생의 학번은 사용할 수 없습니다.</small></label>
 {stale&&<p className="error" role="alert">다른 곳에서 학생정보가 바뀌었습니다. 작성 내용을 확인한 뒤 최신 정보를 불러오세요.</p>}
 <div className="actions"><button type="submit" disabled={disabled||stale||!dirty}>{submitting?'저장 중…':'학생정보 저장'}</button><button type="button" className="secondary" disabled={disabled||!current} onClick={()=>current&&open(current)}>최신 정보 불러오기</button><button type="button" className="secondary" disabled={disabled} onClick={close}>닫기</button></div>
 </form>}
 {message&&<p role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}
 </section>;
}
