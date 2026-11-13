import {boolean,calendarDate,calendarMonth,clockTime,commandInput,id,integer,settingData,strings,text} from './validation';
export type RecordData = Record<string, any>;
export interface State { members:RecordData[]; notices:RecordData[]; items:RecordData[]; roles:RecordData[]; allowances:RecordData[]; lots:RecordData[]; events:RecordData[]; requests:RecordData[]; quizzes:RecordData[]; attempts:RecordData[]; exams:RecordData[]; examTypes:RecordData[]; plans:RecordData[]; inbox:RecordData[]; audits:RecordData[]; payouts:RecordData[]; settings:RecordData[] }
export const tables: (keyof State)[]=['members','notices','items','roles','allowances','lots','events','requests','quizzes','attempts','exams','examTypes','plans','inbox','audits','payouts','settings'];
export const kstDate=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,10);
export function expiry(now:number){const d=new Date(now+9*3600000), y=d.getUTCFullYear(),m=d.getUTCMonth()+3,day=d.getUTCDate();const last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return Date.UTC(y,m,Math.min(day,last)+1)-9*3600000;}
export function balance(s:State,uid:string,now=Date.now()){return {available:s.lots.filter(l=>l.uid===uid&&l.expiresAt>now).reduce((n,l)=>n+l.available,0),reserved:s.lots.filter(l=>l.uid===uid).reduce((n,l)=>n+l.reserved,0)}}
export function command(s:State,actor:string,action:string,p:RecordData,key:string,now=Date.now()){
 commandInput(action,p,key);
 const member=s.members.find(m=>m.id===actor&&m.active&&['student','teacher'].includes(m.role));if(!member)throw Error('활성 학급 계정이 필요합니다.');
 const input=JSON.stringify({action,p});
 const auditId=actor.length+'_'+actor+'_'+key;
 const previous=s.audits.find(a=>a.id===auditId||a.id===actor+'_'+key&&a.actor===actor);if(previous){if(previous.input!==input)throw Error('동일 요청 키의 입력이 다릅니다.');return;}
 const teacher=member.role==='teacher';
 const requireTeacher=()=>{if(!teacher)throw Error('교사 권한이 필요합니다.');};
 const requireStudent=()=>{if(member.role!=='student')throw Error('학생 계정으로 이용하세요.');};
 const activeStudent=(uid:string)=>s.members.some(m=>m.id===uid&&m.active&&m.role==='student');
 const add=(table:keyof State,data:RecordData,entryId=actor.length+'_'+actor+'_'+key+'_'+s[table].length)=>{s[table].push({id:entryId,...data});return entryId};
 const event=(uid:string,type:string,amount:number,reason:string,extra:RecordData={})=>{
  const eventId=add('events',{uid,type,amount,reason,at:now,...extra});
  const category=type==='grant'?(reason==='일일문제풀이'?'earn':'grant'):['approved','debit'].includes(type)?'spend':null;
  const policy=s.settings.find(x=>x.id==='notifications'),recipient=s.members.find(m=>m.id===uid&&m.active&&m.role==='student');
  if(category&&recipient&&policy?.[category]!==false&&recipient.notifications?.enabled!==false)add('inbox',{uid,title:'포인트 알림',body:reason,category,eventId,at:now,read:false});
  return eventId;
 };
 const grant=(uid:string,amount:number,reason:string,entryId:string)=>{
  if(s.lots.some(l=>l.id===entryId))return;
  integer(amount,1,100000,'지급액');
  const eventId=event(uid,'grant',amount,reason);
  add('lots',{uid,total:amount,available:amount,reserved:0,spent:0,expired:0,acquiredAt:now,expiresAt:expiry(now),eventId},entryId);
 };
 const allocate=(uid:string,amount:number,reserve:boolean)=>{
  integer(amount,0,100000,'금액');
  if(balance(s,uid,now).available<amount)throw Error('사용 가능한 포인트가 부족합니다.');
  let remaining=amount;const allocations:RecordData[]=[];
  const lots=s.lots.filter(l=>l.uid===uid&&l.expiresAt>now&&l.available>0).sort((a,b)=>a.acquiredAt-b.acquiredAt||a.id.localeCompare(b.id));
  for(const lot of lots){integer(lot.available,0,Number.MAX_SAFE_INTEGER,'포인트 잔액');integer(lot.reserved,0,Number.MAX_SAFE_INTEGER,'예약 포인트');integer(lot.spent,0,Number.MAX_SAFE_INTEGER,'사용 포인트');}
  for(const lot of lots){const amount=Math.min(remaining,lot.available);if(!amount)break;lot.available-=amount;lot[reserve?'reserved':'spent']+=amount;allocations.push({lotId:lot.id,amount});remaining-=amount;}
  return allocations;
 };
 if(action==='shop'){
  requireStudent();id(p.itemId,'품목');
  const item=s.items.find(i=>i.id===p.itemId&&i.active);if(!item)throw Error('판매 중인 품목이 아닙니다.');
  if(s.requests.filter(r=>r.uid===actor&&r.status==='pending').length>=20)throw Error('처리 대기 중인 상점 신청은 학생당 20건까지 가능합니다.');
  if(p.date!==undefined&&p.date!==''&&(!calendarDate(p.date)||p.date<kstDate(now)))throw Error('오늘 이후의 희망일을 선택하세요.');
  if(item.needDate&&(!calendarDate(p.date)||p.date<kstDate(now)))throw Error('오늘 이후의 희망일을 선택하세요.');
  const allocations=allocate(actor,item.price,true);
  add('requests',{uid:actor,itemId:item.id,name:item.name,price:item.price,date:p.date||'',status:'pending',at:now,version:1,allocations});event(actor,'reserve',-item.price,item.name+' 신청');
 }else if(action==='requestStatus'){
  const r=s.requests.find(r=>r.id===p.id);if(!r||r.status!=='pending'||r.version!==p.version)throw Error('이미 처리되었거나 변경된 신청입니다.');
  if(p.status==='cancelled'){if(r.uid!==actor)throw Error('본인 신청만 취소할 수 있습니다.');}else{requireTeacher();if(!['approved','rejected'].includes(p.status))throw Error('잘못된 처리 상태입니다.');}
  if(!Array.isArray(r.allocations))throw Error('예약 포인트 기록을 확인하세요.');
  const seen=new Set<string>();
  for(const a of r.allocations){const lot=s.lots.find(l=>l.id===a.lotId);if(!lot||lot.uid!==r.uid||seen.has(a.lotId)||!Number.isSafeInteger(a.amount)||a.amount<0||!Number.isSafeInteger(lot.reserved)||lot.reserved<a.amount)throw Error('예약 포인트 기록을 확인하세요.');seen.add(a.lotId);}
  for(const a of r.allocations){const lot=s.lots.find(l=>l.id===a.lotId)!;lot.reserved-=a.amount;if(p.status==='approved')lot.spent+=a.amount;else lot[lot.expiresAt>now?'available':'expired']+=a.amount;}
  Object.assign(r,{status:p.status,version:r.version+1,actor,reason:p.reason||'',processedAt:now});event(r.uid,p.status,p.status==='approved'?0:r.price,r.name+' '+p.status,{requestId:r.id});
 }else if(action==='points'){
  requireTeacher();if(!activeStudent(p.uid))throw Error('대상 학생을 확인하세요.');text(p.reason,'지급·차감 사유',1000);
  if(!Number.isSafeInteger(p.amount)||!p.amount||Math.abs(p.amount)>100000)throw Error('정수 금액과 사유가 필요합니다.');
  if(p.amount>0)grant(p.uid,p.amount,p.reason,'point_'+actor.length+'_'+actor+'_'+key);else event(p.uid,'debit',p.amount,p.reason,{allocations:allocate(p.uid,-p.amount,false)});
 }else if(action==='payout'){
  requireTeacher();if(!calendarMonth(p.month))throw Error('기준 월이 필요합니다.');
  const roles=s.roles.filter(r=>r.active);
  // Validate every target before the first grant so malformed later roles cannot partially pay out.
  for(const role of roles){integer(role.points,1,100000,'역할 점수');strings(role.uids,'담당 학생',60,uid=>s.members.some(m=>m.id===uid&&m.role==='student'));text(role.name,'역할 이름',100);}
  for(const role of roles)for(const uid of role.uids){const entryId=p.month+'_'+role.id+'_'+uid;if(s.payouts.some(x=>x.id===entryId)||!activeStudent(uid))continue;grant(uid,role.points,p.month+' 역할보상: '+role.name,entryId);add('payouts',{month:p.month,uid,roleId:role.id,amount:role.points,at:now},entryId);}
 }else if(action==='quiz'){
  requireStudent();const date=kstDate(now),q=s.quizzes.find(q=>q.date===date&&q.active);if(!q)throw Error('오늘의 문제가 없습니다.');
  if(![1,2,3,4].includes(p.choice))throw Error('보기를 선택하세요.');if(s.attempts.some(a=>a.id===date+'_'+actor||a.date===date&&a.uid===actor))throw Error('오늘 이미 제출했습니다.');if(q.version!==p.version)throw Error('문제가 변경되었습니다. 다시 확인하세요.');
  const correct=q.answer===p.choice;
  add('attempts',{uid:actor,date,quizId:q.id,quizVersion:q.version,choice:p.choice,correct,question:q.question,options:structuredClone(q.options),explanation:q.explanation,at:now},date+'_'+actor);
  if(q.submittedAt===undefined)q.submittedAt=now;
  if(correct)grant(actor,10,'일일문제풀이',date+'_'+actor);else event(actor,'quiz',0,'일일문제풀이');
 }else if(action==='exam'){
  requireStudent();const type=s.examTypes.find(t=>t.id===p.typeId&&t.active);
  if(!type||!calendarDate(p.date)||p.date<kstDate(now)||!clockTime(p.start)||!clockTime(p.end)||p.start>=p.end)throw Error('시험 종류·날짜·시간을 확인하세요.');
  const existing=p.id?s.exams.find(e=>e.id===p.id):null;
  if(p.id&&(!existing||existing.uid!==actor||existing.status!=='pending'))throw Error('수정할 수 없는 신청입니다.');
  if(existing&&p.version!==(existing.version??1))throw Error('시험 신청이 변경되었습니다. 다시 불러오세요.');
  if(!existing&&s.exams.filter(e=>e.uid===actor&&(e.status==='pending'||e.status==='approved'&&e.date>=kstDate(now))).length>=20)throw Error('진행 중인 시험 신청은 학생당 20건까지 가능합니다.');
  if(s.exams.some(e=>e.id!==p.id&&e.uid===actor&&e.date===p.date&&['pending','approved'].includes(e.status)&&e.start<p.end&&e.end>p.start))throw Error('시간이 겹치는 신청이 있습니다.');
  const data={uid:actor,studentNo:member.studentNo,name:member.name,typeId:type.id,typeName:type.name,date:p.date,start:p.start,end:p.end,status:'pending',version:existing?(existing.version??1)+1:1};
  if(existing)Object.assign(existing,data,{updatedAt:now});else add('exams',{...data,at:now});
 }else if(action==='examStatus'){
  const exam=s.exams.find(e=>e.id===p.id);if(!exam||exam.status!=='pending')throw Error('처리할 수 없는 신청입니다.');
  if(p.status==='cancelled'){if(exam.uid!==actor)throw Error('본인 신청만 취소 가능합니다.');}else{requireTeacher();if(!['approved','rejected'].includes(p.status))throw Error('잘못된 상태입니다.');}
  if(p.version!==(exam.version??1))throw Error('시험 신청이 변경되었습니다. 다시 불러오세요.');
  Object.assign(exam,{status:p.status,version:(exam.version??1)+1,actor,reason:p.reason||'',processedAt:now});
 }else if(action==='plan'){
  const plan=s.plans.find(x=>x.id===p.id);if(!plan||(plan.kind==='seat'?(teacher||!member.delegations?.includes('seat')):(!teacher&&!member.delegations?.includes(plan.kind))))throw Error('배치 편집 권한이 없습니다.');
  if(plan.version!==p.version)throw Error('다른 사용자가 수정했습니다. 다시 불러오세요.');
  if(!Array.isArray(p.assignments)||p.assignments.length!==plan.assignments.length||p.assignments.some((uid:unknown)=>typeof uid!=='string'))throw Error('배치 칸 수를 변경할 수 없습니다.');
  const uids=p.assignments.filter(Boolean);if(new Set(uids).size!==uids.length||uids.some((uid:string)=>!activeStudent(uid)))throw Error('학생 중복 또는 잘못된 배정입니다.');
  add('audits',{action:'planRevision',planId:plan.id,before:structuredClone(plan),at:now,actor});Object.assign(plan,{assignments:[...p.assignments],version:plan.version+1,actor,updatedAt:now});
 }else if(action==='save'){
  requireTeacher();if(typeof p.table!=='string'||!['notices','items','roles','allowances','quizzes','examTypes','settings'].includes(p.table))throw Error('허용되지 않은 설정입니다.');
  const table=p.table as keyof State,entryId=p.id||key,old=s[table].find(x=>x.id===entryId);
  const data=settingData(s,table,entryId,p.data,old);
  if(old&&p.version!==old.version)throw Error('설정이 변경되었습니다.');
  if(table==='quizzes'){
   // Keep the freeze after attempts move to history; legacy past questions are immutable too.
   const attempted=old&&(old.submittedAt!==undefined||old.date<kstDate(now)||s.attempts.some(a=>a.quizId===old.id||!a.quizId&&a.date===old.date));
   const content=['date','question','options','answer','explanation'];
   if(attempted&&content.some(field=>JSON.stringify(data[field])!==JSON.stringify(old[field]??(field==='explanation'?'':undefined))))throw Error('제출된 문제가 있어 내용·정답을 변경할 수 없습니다. 새 날짜의 문제를 작성하세요.');
   if((!old||old.date!==data.date)&&data.date<kstDate(now))throw Error('새 문제는 오늘 이후 날짜로 작성하세요.');
   if(!old&&s.attempts.some(a=>a.date===data.date))throw Error('이미 제출한 날짜에는 새 문제를 등록할 수 없습니다.');
   if(data.active&&s.quizzes.some(q=>q.id!==entryId&&q.active&&q.date===data.date))throw Error('같은 날짜에는 활성 문제를 하나만 등록할 수 있습니다.');
  }
  if(old)Object.assign(old,data,{id:old.id,version:old.version+1,updatedAt:now});else add(table,{...data,createdAt:now,version:1},entryId);
 }else if(action==='member'){
  requireTeacher();boolean(p.active,'학생 활성 상태');const delegations=strings(p.delegations??[],'편집 권한',2,value=>['seat','cleaning'].includes(value));
  const m=s.members.find(m=>m.id===p.uid&&m.role==='student');if(!m)throw Error('학생이 없습니다.');m.active=p.active;m.delegations=[...delegations];
 }else if(action==='preferences'){
  boolean(p.enabled,'알림 설정');if((member.notifications?.enabled!==false)===p.enabled)return;member.notifications={...member.notifications,enabled:p.enabled};
 }else if(action==='notify'){
  requireTeacher();text(p.body,'알림 내용',2000);const selected=p.uids===undefined?[]:strings(p.uids,'발송 대상',60,activeStudent);
  const recipients=selected.length?selected:s.members.filter(m=>m.active&&m.role==='student').map(m=>m.id);
  for(const uid of recipients)if(s.members.find(m=>m.id===uid)!.notifications?.enabled!==false)add('inbox',{uid,title:'새 학급 알림이 있습니다.',body:p.body,at:now,read:false});
 }else if(action==='read'){
  const notification=s.inbox.find(n=>n.id===p.id&&n.uid===actor);if(!notification)throw Error('알림이 없습니다.');if(notification.read)return;notification.read=true;
 }
 add('audits',{actor,action,input,at:now},auditId);
}
export function visible(s:State,uid:string,now=Date.now()):State {
 const m=s.members.find(m=>m.id===uid);if(!m?.active||!['student','teacher'].includes(m.role))throw Error('계정이 비활성화되었습니다.');
 const out=structuredClone(s);if(m.role==='teacher')return out;
 out.members=out.members.map(x=>x.id===uid?x:{id:x.id,name:x.name,role:x.role,active:x.active});
 for(const table of ['lots','events','requests','attempts','exams','inbox'] as const)out[table]=out[table].filter(x=>x.uid===uid);
 out.quizzes=out.quizzes.filter(q=>q.active&&q.date===kstDate(now)).map(({answer,explanation,...q})=>q);out.audits=[];out.payouts=[];return out;
}
