import React,{useEffect,useState} from 'react';
import * as api from './api';
import type {HistoryTable} from './history';
import type {State} from './domain';

type RecordRow=Record<string,any>;
const date=(value:unknown)=>typeof value==='number'?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'';
const status:Record<string,string>={pending:'대기',approved:'승인',rejected:'반려',cancelled:'취소',grant:'지급',reserve:'예약',debit:'차감',quiz:'퀴즈'};

export function RecordHistory({table,title,revision,teacher=false,name,onState,initiallyOpen=true}:{table:HistoryTable;title:string;revision:string;teacher?:boolean;name?:(uid:string)=>string;onState?:(state:State)=>void;initiallyOpen?:boolean}){
 const [open,setOpen]=useState(initiallyOpen);
 const [records,setRecords]=useState<RecordRow[]>([]),[cursor,setCursor]=useState<string|null|undefined>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[generation,setGeneration]=useState(0);
 useEffect(()=>{if(!open)return;let active=true;setBusy(true);setError('');setRecords([]);setCursor(null);api.getHistory(table).then(page=>{if(active){setRecords(page.records);setCursor(page.nextCursor);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'기록을 불러오지 못했습니다.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[table,revision,generation,open]);
 async function more(){if(!cursor)return;setBusy(true);setError('');try{const page=await api.getHistory(table,cursor);setRecords(previous=>{const seen=new Set(previous.map(row=>row.id));return [...previous,...page.records.filter(row=>!seen.has(row.id))];});setCursor(page.nextCursor);}catch(e){setError(e instanceof Error?e.message:'기록을 불러오지 못했습니다.');}finally{setBusy(false);}}
 if(!open)return <section><button type="button" className="text" onClick={()=>setOpen(true)}>{title} 열기 →</button></section>;
 return <section><h2>{title}</h2>
 {error&&<p role="alert" className="error">{error} <button className="text" onClick={()=>setGeneration(value=>value+1)}>다시 시도</button></p>}
 {records.length===0&&!busy&&!error&&<p>아직 기록이 없습니다.</p>}
 {records.length>0&&<div className="table-wrap"><table><thead><tr><th>일시</th>{teacher&&<th>학생</th>}<th>{table==='events'?'사유':'내용'}</th><th>{table==='events'?'증감':'상태'}</th></tr></thead><tbody>{records.map((row,index)=><tr key={row.id+'_'+index}>
  <td>{table==='exams'?`${row.date} ${row.start}–${row.end}`:date(row.at||row.acquiredAt||row.createdAt)}</td>
  {teacher&&<td>{name?.(row.uid)||row.name||row.uid}</td>}
  <td>{row.reason||row.title||row.question||row.name||row.typeName||status[row.type]||''}{['inbox','notices'].includes(table)&&row.body&&<p className="pre">{row.body}</p>}{table==='notices'&&/^https:\/\//i.test(row.url||'')&&<a href={row.url} target="_blank" rel="noopener noreferrer">첨부 링크 열기 ↗</a>}</td>
  <td>{table==='events'?`${row.amount>0?'+':''}${row.amount} P · ${status[row.type]||row.type}`:table==='attempts'?(row.correct?'정답':'오답'):table==='inbox'?(row.read?'읽음':<button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const state=await api.send('read',{id:row.id});onState?.(state);setGeneration(value=>value+1);}catch(e){setError(e instanceof Error?e.message:'알림을 읽지 못했습니다.');}finally{setBusy(false);}}}>읽음 표시</button>):status[row.status]||''}</td>
 </tr>)}</tbody></table></div>}
 {busy&&<p role="status">기록을 불러오고 있습니다…</p>}
 {cursor&&<button className="secondary" disabled={busy} onClick={()=>void more()}>이전 기록 더 보기</button>}
 </section>;
}
