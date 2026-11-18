import React,{useRef,useState} from 'react';
import {kstDate} from './domain';
import {parseQuizBankCsv,quizBankDraft,QUIZ_BANK_MAX_BYTES,QUIZ_BANK_TEMPLATE,type QuizBankDraft,type QuizBankResult} from './quiz-bank';
import './quiz-bank.css';

interface Props {disabled:boolean;onApply:(draft:QuizBankDraft)=>boolean}

export function QuizBankImport({disabled,onApply}:Props){
 const [bank,setBank]=useState<QuizBankResult|null>(null),[filename,setFilename]=useState(''),[selected,setSelected]=useState<number|null>(null),[date,setDate]=useState(kstDate()),[reading,setReading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const sequence=useRef(0),input=useRef<HTMLInputElement|null>(null);
 const row=bank?.rows.find(row=>row.row===selected),busy=disabled||reading;
 async function load(file:File|undefined){
  const request=++sequence.current;setBank(null);setSelected(null);setFilename('');setError('');setNotice('');
  if(!file){setReading(false);return;}
  setReading(true);
  try{
   if(!/\.csv$/i.test(file.name))throw Error('스프레드시트를 CSV UTF-8(.csv)로 내려받아 선택해 주세요.');
   if(file.size>QUIZ_BANK_MAX_BYTES)throw Error('CSV 파일은 1MB 이하로 나누어 주세요.');
   const parsed=parseQuizBankCsv(await file.text());
   if(request===sequence.current){setBank(parsed);setFilename(file.name);setNotice(`${parsed.total}개 행 중 ${parsed.rows.length}개 문제를 검토할 수 있습니다.`);}
  }catch(error){if(request===sequence.current)setError(error instanceof Error?error.message:'CSV 파일을 읽지 못했습니다.');}
  finally{if(request===sequence.current){setReading(false);if(input.current)input.current.value='';}}
 }
 function clear(){sequence.current++;setBank(null);setSelected(null);setFilename('');setReading(false);setError('');setNotice('');if(input.current)input.current.value='';}
 function template(){const link=document.createElement('a'),url=URL.createObjectURL(new Blob([QUIZ_BANK_TEMPLATE],{type:'text/csv;charset=utf-8'}));link.href=url;link.download='우리반-문제은행-템플릿.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function apply(){
  if(!row||busy)return;
  try{const draft=quizBankDraft(row,date,kstDate());if(onApply(draft)){setError('');setNotice('선택한 문제를 아래의 새 초안으로 불러왔습니다. 내용을 확인하고 ‘사용 중’을 켠 뒤 저장하면 출제됩니다.');}}
  catch(error){setError(error instanceof Error?error.message:'출제 날짜를 확인해 주세요.');}
 }
 return <details className="quiz-bank-import"><summary>스프레드시트 문제은행에서 가져오기</summary>
  <p>비공개 스프레드시트를 문제은행으로 계속 사용하세요. Google Sheets의 ‘파일 → 다운로드 → 쉼표로 구분된 값(.csv)’ 또는 Excel의 ‘CSV UTF-8’로 내려받은 파일을 선택합니다.</p>
  <p className="hint">파일은 이 화면에서만 읽으며 선택·미리보기만으로 서버에 저장되지 않습니다. 날짜는 비워 둘 수 있고, 머리글 8개는 템플릿과 같아야 합니다. 공개 시트 링크로 정답을 노출하지 마세요.</p>
  <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={template}>CSV 템플릿 다운로드</button>{bank&&<button type="button" className="secondary" disabled={disabled} onClick={clear}>불러온 파일 비우기</button>}</div>
  <label>문제은행 CSV 파일<input ref={input} type="file" accept=".csv,text/csv" disabled={busy} onChange={event=>void load(event.target.files?.[0])}/></label>
  {reading&&<p role="status">파일을 읽고 있습니다…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
  {bank&&<>
   <p className="hint">{filename} · 유효 {bank.rows.length}개 · 오류 {bank.issues.length}개 · 최대 200문제 / 1MB</p>
   {bank.issues.length>0&&<div className="error" role="alert"><p>다음 행은 불러올 수 없습니다. 원본 시트에서 수정한 뒤 다시 내려받아 주세요.</p><ul>{bank.issues.map(issue=><li key={issue.row}>{issue.row}행: {issue.message}</li>)}</ul></div>}
   {bank.rows.length>0&&<>
    <div className="quiz-bank-list" role="region" aria-label="문제은행 목록" tabIndex={0}><table><thead><tr><th>선택</th><th>CSV 행</th><th>원본 날짜</th><th>문제</th></tr></thead><tbody>{bank.rows.map(entry=><tr key={entry.row} className={entry.row===selected?'selected':''}><td><input aria-label={`${entry.row}행 문제 선택`} type="radio" name="quiz-bank-row" checked={entry.row===selected} disabled={busy} onChange={()=>{setSelected(entry.row);setDate(entry.date>=kstDate()?entry.date:kstDate());setError('');setNotice('');}}/></td><td>{entry.row}</td><td>{entry.date||'미지정'}</td><td>{entry.question}</td></tr>)}</tbody></table></div>
    {row&&<div className="quiz-bank-preview"><h3>선택한 문제 미리보기</h3><p className="quiz-bank-question">{row.question}</p><ol>{row.options.map((option,index)=><li key={index}>{option}</li>)}</ol><p><b>정답: 보기 {row.answer}</b></p>{row.explanation&&<p className="quiz-bank-explanation">해설: {row.explanation}</p>}<label>출제 날짜<input type="date" aria-label="문제은행 출제 날짜" value={date} min={kstDate()} required disabled={busy} onChange={event=>setDate(event.target.value)}/></label><p className="hint">기존 문제를 덮어쓰지 않고 ‘사용 중’이 꺼진 새 초안으로 불러옵니다. 아래 편집폼에서 검토한 뒤 저장해 주세요.</p><button type="button" className="secondary" disabled={busy||!date} onClick={apply}>선택한 문제를 새 초안으로 불러오기</button></div>}
   </>}
  </>}
 </details>;
}
