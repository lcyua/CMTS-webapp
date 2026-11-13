import React,{useState} from 'react';
import {kstDate,RecordData,State} from './domain';
import {settingData} from './validation';
import {getHistory} from './api';
import {cleanDefinition,mergeDefinitionRows} from './settings-history';
import './settings-editor.css';

const titles={notices:'공지',items:'상점 품목',roles:'학급 역할',allowances:'수당',quizzes:'일일 문제',examTypes:'시험 종목',settings:'운영 안내'};
type Table=keyof typeof titles;
type Props={s:State;busy:boolean;save:(payload:RecordData)=>Promise<boolean>;initialTable?:Table};
type Editor={table:Table;id:string;snapshot:RecordData|null;draft:RecordData};
type DefinitionTable='notices'|'quizzes';
type DefinitionPage={records:RecordData[];cursor:string|null;loaded:boolean;loading:boolean;error:string};
const emptyPage=():DefinitionPage=>({records:[],cursor:null,loaded:false,loading:false,error:''});
const settingTitles:Record<string,string>={class:'학급 기본 정보',shop:'상점 안내',notifications:'학급 자동 알림'};

function defaults(table:Table,entryId:string,s:State):RecordData{
 switch(table){
  case 'notices':return {title:'',body:'',url:'',important:false,active:true};
  case 'items':return {name:'',price:10,needDate:false,active:true};
  case 'roles':return {name:'',points:10,uids:[],active:true};
  case 'allowances':return {name:'',points:5,method:'',active:true};
  case 'quizzes':return {date:kstDate(),question:'',options:['','','',''],answer:1,explanation:'',active:true};
  case 'examTypes':return {name:'',active:true};
  case 'settings':return entryId==='class'?{year:s.settings.find(row=>row.id==='class')?.year||2027,className:'1학년 11반'}:entryId==='notifications'?{grant:true,spend:true,earn:true}:{message:''};
 }
}
function open(s:State,table:Table,entryId=table==='settings'?'class':''):Editor{
 const row=entryId?s[table].find(row=>row.id===entryId):undefined;
 const snapshot=row?structuredClone(cleanDefinition(row)):null;
 return {table,id:entryId,snapshot,draft:{...defaults(table,entryId,s),...(snapshot||{})}};
}
function rowTitle(table:Table,row:RecordData):string{
 const title=table==='quizzes'?`${row.date} · ${row.question}`:row.title||row.name||row.id;
 return `${title}${row.active===false?' (사용 중지)':''}`;
}

/** Teacher forms hold the version opened by the editor until explicit reload or a successful save. */
export function SettingsEditor({s,busy,save,initialTable='notices'}:Props){
 const [pages,setPages]=useState<Record<DefinitionTable,DefinitionPage>>(()=>({notices:emptyPage(),quizzes:emptyPage()}));
 const effectiveState={...s,notices:mergeDefinitionRows(s.notices,pages.notices.records),quizzes:mergeDefinitionRows(s.quizzes,pages.quizzes.records)};
 const [editor,setEditor]=useState<Editor>(()=>open(s,initialTable));
 const [dirty,setDirty]=useState(false),[submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const {table,id:entryId,snapshot,draft}=editor;
 const current=entryId?effectiveState[table].find(row=>row.id===entryId):undefined;
 const stale=Boolean(snapshot&&(!current||current.version!==snapshot.version));
 const frozen=table==='quizzes'&&Boolean(snapshot&&(current?.submittedAt!==undefined||snapshot.submittedAt!==undefined||snapshot.date<kstDate()||s.attempts.some(attempt=>attempt.quizId===snapshot.id||!attempt.quizId&&attempt.date===snapshot.date)));
 const disabled=busy||submitting;
 const core=frozen?(current||snapshot||draft):draft;
 const change=(field:string,value:unknown)=>{setEditor(editor=>({...editor,draft:{...editor.draft,[field]:value}}));setDirty(true);setError('');setMessage('');};
 function choose(nextTable:Table,nextId?:string){
  if(dirty&&!window.confirm('작성 중인 변경사항을 취소하고 다른 항목을 열까요?'))return;
  setEditor(open(effectiveState,nextTable,nextId));setDirty(false);setError('');setMessage('');
 }
 function reload(){
  if(dirty&&!window.confirm('작성 중인 변경사항을 취소하고 최신 내용을 불러올까요?'))return;
  setEditor(open(effectiveState,table,entryId));setDirty(false);setError('');setMessage('');
 }
 async function loadEarlier(target:DefinitionTable,restart=false){
  const page=pages[target];if(page.loading||!restart&&page.loaded&&!page.cursor)return;
  setPages(previous=>({...previous,[target]:{...previous[target],loading:true,error:''}}));
  try{
   const result=await getHistory(target,!restart&&page.loaded?page.cursor:undefined);
   setPages(previous=>({...previous,[target]:{records:mergeDefinitionRows(previous[target].records,result.records),cursor:result.nextCursor??result.cursor??null,loaded:true,loading:false,error:''}}));
  }catch(e){setPages(previous=>({...previous,[target]:{...previous[target],loading:false,error:e instanceof Error?e.message:'이전 항목을 불러오지 못했습니다.'}}));}
 }
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(disabled||stale)return;
  setError('');setMessage('');
  const targetId=entryId||crypto.randomUUID();
  let raw:RecordData;
  switch(table){
   case 'notices':raw={title:String(draft.title).trim(),body:String(draft.body).trim(),url:String(draft.url||'').trim(),important:draft.important,active:draft.active};break;
   case 'items':raw={name:String(draft.name).trim(),price:Number(draft.price),needDate:draft.needDate,active:draft.active};break;
   case 'roles':raw={name:String(draft.name).trim(),points:Number(draft.points),uids:draft.uids,active:draft.active};break;
   case 'allowances':raw={name:String(draft.name).trim(),points:Number(draft.points),method:String(draft.method).trim(),active:draft.active};break;
   case 'quizzes':raw=frozen?{active:draft.active}:{date:draft.date,question:String(draft.question).trim(),options:draft.options.map((option:string)=>option.trim()),answer:Number(draft.answer),explanation:String(draft.explanation||'').trim(),active:draft.active};break;
   case 'examTypes':raw={name:String(draft.name).trim(),active:draft.active};break;
   case 'settings':raw=targetId==='class'?{year:Number(draft.year),className:String(draft.className).trim()}:targetId==='notifications'?{grant:draft.grant,spend:draft.spend,earn:draft.earn}:{message:String(draft.message||'').trim()};break;
  }
  try{
   const canonical=settingData(effectiveState,table,targetId,raw,snapshot||undefined);
   setSubmitting(true);
   const payload={table,id:targetId,...(snapshot?{version:snapshot.version}:{}),data:raw};
   if(await save(payload)){
    const saved={...(snapshot||{}),...canonical,id:targetId,version:snapshot?snapshot.version+1:1};
    if(table==='notices'||table==='quizzes')setPages(previous=>({...previous,[table]:{...previous[table],records:mergeDefinitionRows([saved],previous[table].records)}}));
    setEditor({table,id:targetId,snapshot:saved,draft:{...defaults(table,targetId,effectiveState),...saved}});setDirty(false);setMessage('변경사항을 저장했습니다.');
   }else setError('저장하지 못했습니다. 오류 안내를 확인한 뒤 다시 시도해 주세요.');
  }catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다. 입력 내용을 확인해 주세요.');}
  finally{setSubmitting(false);}
 }
 const input=(field:string,label:string,maxLength:number,required=true,readOnly=false)=><label>{label}<input name={field} value={String((readOnly?core:draft)[field]??'')} maxLength={maxLength} required={required} disabled={disabled||readOnly} onChange={event=>change(field,event.target.value)}/></label>;
 const area=(field:string,label:string,maxLength:number,required=true,readOnly=false)=><label>{label}<textarea name={field} value={String((readOnly?core:draft)[field]??'')} maxLength={maxLength} required={required} disabled={disabled||readOnly} onChange={event=>change(field,event.target.value)}/></label>;
 const number=(field:string,label:string,min:number,max:number)=><label>{label}<input name={field} type="number" value={draft[field]??''} min={min} max={max} step="1" required disabled={disabled} onChange={event=>change(field,event.target.value)}/></label>;
 const check=(field:string,label:string)=><label className="settings-check"><input name={field} type="checkbox" checked={Boolean(draft[field])} disabled={disabled} onChange={event=>change(field,event.target.checked)}/>{label}</label>;
 return <div className="settings-editor">
  <div className="settings-selectors">
   <label>관리 항목<select aria-label="관리 항목" value={table} disabled={disabled} onChange={event=>choose(event.target.value as Table)}>{Object.entries(titles).map(([value,title])=><option value={value} key={value}>{title}</option>)}</select></label>
   <label>편집할 항목<select aria-label="편집할 항목" value={entryId} disabled={disabled} onChange={event=>choose(table,event.target.value)}>
    {table==='settings'?Object.entries(settingTitles).map(([value,title])=><option key={value} value={value}>{title}</option>):<><option value="">새 {titles[table]} 작성</option>{effectiveState[table].map(row=><option key={row.id} value={row.id}>{rowTitle(table,row)}</option>)}</>}
   </select></label>
  </div>
  {(table==='notices'||table==='quizzes')&&<div className="settings-history">
   {(!pages[table].loaded||pages[table].cursor)&&<button type="button" className="secondary" disabled={disabled||pages[table].loading} onClick={()=>void loadEarlier(table)}>{pages[table].loading?'불러오는 중…':'이전 항목 불러오기'}</button>}
   {pages[table].loaded&&!pages[table].cursor&&!pages[table].loading&&<p role="status" className="hint">이전 항목을 모두 불러왔습니다.</p>}
   {pages[table].error&&<div className="error" role="alert"><p>{pages[table].error}</p><button type="button" className="secondary" disabled={disabled||pages[table].loading} onClick={()=>void loadEarlier(table,true)}>처음부터 다시 불러오기</button></div>}
  </div>}
  {stale&&<div className="error" role="alert"><p>이 항목이 다른 곳에서 변경되었습니다. 최신 내용을 불러온 뒤 수정해 주세요.</p><button type="button" className="secondary" disabled={disabled} onClick={reload}>최신 내용 불러오기</button></div>}
  {frozen&&<p className="info">제출이 시작됐거나 지난 날짜의 문제입니다. 내용과 정답은 보존하며 사용 여부만 변경할 수 있습니다. 다른 날짜의 문제는 새 항목으로 작성해 주세요.</p>}
  <form aria-label={`${titles[table]} 편집`} onSubmit={event=>void submit(event)}>
   <fieldset disabled={disabled}>
    <legend>{table==='settings'?settingTitles[entryId]:snapshot?`${titles[table]} 수정`:`새 ${titles[table]}`}</legend>
    {table==='notices'&&<>{input('title','공지 제목',200)}{area('body','공지 내용',20000)}<label>첨부 링크<input name="url" type="url" placeholder="https://" value={draft.url||''} maxLength={2000} disabled={disabled} onChange={event=>change('url',event.target.value)}/></label>{check('important','중요 공지')}</>}
    {table==='items'&&<>{input('name','품목명',100)}{number('price','가격 (P)',0,100000)}{check('needDate','신청 날짜 필수')}</>}
    {table==='roles'&&<>{input('name','역할명',100)}{number('points','월간 지급 포인트 (P)',1,100000)}<fieldset className="settings-members"><legend>담당 학생</legend>{s.members.filter(member=>member.role==='student').map(member=><label className="settings-check" key={member.id}><input type="checkbox" checked={draft.uids.includes(member.id)} disabled={disabled||!member.active&&!draft.uids.includes(member.id)} onChange={event=>change('uids',event.target.checked?[...draft.uids,member.id]:draft.uids.filter((uid:string)=>uid!==member.id))}/>{member.studentNo} {member.name}{!member.active?' (비활성)':''}</label>)}<p className="hint">활성 학생만 담당자로 저장할 수 있습니다. 비활성 학생은 선택을 해제해 주세요.</p></fieldset></>}
    {table==='allowances'&&<>{input('name','수당명',100)}{number('points','포인트 (P)',1,100000)}{area('method','제출 방법',1000)}</>}
    {table==='quizzes'&&<>
     <label>문제 날짜<input name="date" type="date" value={(frozen?core:draft).date||''} min={frozen?undefined:kstDate()} required disabled={disabled||frozen} onChange={event=>change('date',event.target.value)}/></label>
     {area('question','문제',2000,true,frozen)}
     <fieldset disabled={disabled||frozen}><legend>보기와 정답</legend>{[0,1,2,3].map(index=><label key={index}>보기 {index+1}<input name={`option${index+1}`} value={(frozen?core:draft).options[index]||''} maxLength={1000} required onChange={event=>change('options',draft.options.map((option:string,i:number)=>i===index?event.target.value:option))}/></label>)}<label>정답<select aria-label="정답" name="answer" value={(frozen?core:draft).answer} onChange={event=>change('answer',Number(event.target.value))}>{[1,2,3,4].map(value=><option key={value} value={value}>보기 {value}</option>)}</select></label></fieldset>
     {area('explanation','해설',4000,false,frozen)}
    </>}
    {table==='examTypes'&&input('name','시험 종목명',100)}
    {table==='settings'&&entryId==='class'&&<>{number('year','학년도',2020,2100)}{input('className','학급명',100)}</>}
    {table==='settings'&&entryId==='shop'&&area('message','상점 안내',4000,false)}
    {table==='settings'&&entryId==='notifications'&&<>{check('grant','포인트 지급 알림')}{check('spend','포인트 소모 알림')}{check('earn','퀴즈 포인트 획득 알림')}</>}
    {table!=='settings'&&check('active','사용 중')}
   </fieldset>
   {error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
   <div className="actions"><button disabled={disabled||stale||Boolean(snapshot&&!dirty)}>{submitting?'저장 중…':'저장'}</button><button type="button" className="secondary" disabled={disabled} onClick={()=>{setEditor(open(effectiveState,table,entryId));setDirty(false);setError('');setMessage('');}}>변경 취소</button>{table!=='settings'&&snapshot&&<button type="button" className="secondary" disabled={disabled} onClick={()=>choose(table,'')}>새 항목 작성</button>}</div>
  </form>
 </div>;
}
