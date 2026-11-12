import React,{useState} from 'react';
import {State,RecordData} from './domain';
type Props={s:State;disabled:boolean;act:(a:string,p:RecordData)=>Promise<void>};
export function NoticeManager({s,disabled,act}:Props){
 const [editing,setEditing]=useState<RecordData|null>(null),[open,setOpen]=useState(false);
 return <section><div className="row"><h2>공지사항 관리</h2><button disabled={disabled} onClick={()=>{setEditing(null);setOpen(true)}}>+ 공지 작성</button></div>
 {open&&<form key={editing?.id||'new'} onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void act('save',{table:'notices',id:editing?.id,version:s.notices.find(n=>n.id===editing?.id)?.version,data:{title:String(d.get('title')).trim(),body:String(d.get('body')).trim(),url:String(d.get('url')).trim(),important:d.get('important')==='on',active:true}})}}>
 <label>제목<input name="title" defaultValue={editing?.title||''} required maxLength={200}/></label><label>내용<textarea name="body" defaultValue={editing?.body||''} required maxLength={20000}/></label><label>첨부 링크<input name="url" type="url" placeholder="https://" defaultValue={editing?.url||''}/></label><label className="check"><input type="checkbox" name="important" defaultChecked={!!editing?.important}/>중요 공지</label><div className="actions"><button disabled={disabled}>{editing?'수정 저장':'공지 게시'}</button><button type="button" className="secondary" onClick={()=>{setEditing(null);setOpen(false)}}>편집 취소</button></div></form>}
 {s.notices.filter(n=>n.active).map(n=><div key={n.id} className="row"><b>{n.title}</b><div className="actions"><button disabled={disabled} className="secondary" onClick={()=>{setEditing(n);setOpen(true)}}>수정</button><button className="secondary" disabled={disabled} onClick={()=>{if(confirm('이 공지를 삭제할까요?'))void act('save',{table:'notices',id:n.id,version:n.version,data:{active:false}})}}>삭제</button></div></div>)}
 </section>
}
export function ShopManager({s,disabled,act}:Props){
 const[editing,edit]=useState<RecordData|null>(null),[open,O]=useState(false);
 return <section><div className="row"><h2>포인트 상점 품목 관리</h2><button disabled={disabled} onClick={()=>{edit(null);O(true)}}>+ 품목 추가</button></div>
 {open&&<form key={editing?.id||'new'} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void act('save',{table:'items',id:editing?.id,version:s.items.find(x=>x.id===editing?.id)?.version,data:{name:String(f.get('name')).trim(),price:Number(f.get('price')),needDate:f.get('needDate')==='on',active:true}})}}><label>품목명<input name="name" defaultValue={editing?.name||''} maxLength={100} required/></label><label>가격 (P)<input name="price" type="number" min="0" max="100000" step="1" defaultValue={editing?.price??10} required/></label><label className="check"><input name="needDate" type="checkbox" defaultChecked={!!editing?.needDate}/>신청 날짜 필수</label><div className="actions"><button disabled={disabled}>저장</button><button type="button" className="secondary" onClick={()=>{edit(null);O(false)}}>편집 취소</button></div></form>}
 {s.items.map(i=><div className="row" key={i.id}><div><b>{i.name} · {i.price} P</b><p>{i.active?'판매 중':'판매 중지'}{i.needDate?' · 날짜 필수':''}</p></div><div className="actions"><button className="secondary" disabled={disabled} onClick={()=>{edit(i);O(true)}}>편집</button><button className="secondary" disabled={disabled} onClick={()=>{if(confirm(i.active?'이 품목을 상점에서 제거할까요? 기존 신청은 유지됩니다.':'품목을 다시 판매할까요?'))void act('save',{table:'items',id:i.id,version:i.version,data:{active:!i.active}})}}>{i.active?'제거':'다시 판매'}</button></div></div>)}
 </section>
}
export function NotificationSettings({s,me,teacher,disabled,act}:Props&{me:RecordData;teacher:boolean}){
 const policy=s.settings.find(x=>x.id==='notifications')||{};
 return <section><h2>알림 설정</h2><label className="switch-row"><span>내 알림 수신</span><input type="checkbox" checked={me.notifications?.enabled!==false} disabled={disabled} onChange={e=>void act('preferences',{enabled:e.target.checked})}/></label>
 <p className="hint">수신을 꺼도 알림내역에서 이전 기록을 확인할 수 있습니다. 현재는 앱 내 알림에 적용됩니다.</p>
 {teacher&&<><h3>학급 자동 알림</h3><p className="hint">유형별로 학급 알림 생성을 설정합니다. 포인트 원장과 신청 처리에는 영향을 주지 않습니다.</p>{Object.entries({grant:'포인트 지급 알림',spend:'포인트 소모 알림',earn:'퀴즈 포인트 획득 알림'}).map(([key,title])=><label className="switch-row" key={key}><span>{title}</span><input type="checkbox" checked={policy[key]!==false} disabled={disabled} onChange={e=>void act('save',{table:'settings',id:'notifications',version:policy.version,data:{[key]:e.target.checked}})}/></label>)}</>}
 </section>
}
