import type {RecordData} from './domain';

export type ExamFilters={studentUid:string;studentNo:string;status:string;date:string;typeId:string};
export type ExamStudentOption={value:string;uid:string;studentNo:string;name:string;inactive:boolean};

/** Keep historical applicants selectable, including inactive or renamed students. */
export function examStudentOptions(members:readonly RecordData[],exams:readonly RecordData[]):ExamStudentOption[]{
 const options=new Map<string,ExamStudentOption>();
 for(const member of members.filter(member=>member.role==='student')){
  const uid=String(member.id),studentNo=String(member.studentNo||'');
  options.set('uid:'+uid,{value:'uid:'+uid,uid,studentNo,name:String(member.name||''),inactive:!member.active});
 }
 for(const exam of exams){
  const uid=String(exam.uid||''),studentNo=String(exam.studentNo||'');
  if(!uid&&(!studentNo||[...options.values()].some(option=>option.studentNo===studentNo)))continue;
  const value=uid?'uid:'+uid:'number:'+studentNo;
  if(!options.has(value))options.set(value,{value,uid,studentNo,name:String(exam.name||''),inactive:true});
 }
 return [...options.values()].sort((a,b)=>a.studentNo.localeCompare(b.studentNo,'ko',{numeric:true})||a.name.localeCompare(b.name,'ko'));
}

/** UID preserves a student's selection after their displayed name or number changes. */
export function matchesExam(row:RecordData,filters:ExamFilters):boolean{
 const studentMatches=filters.studentUid
  ? row.uid?row.uid===filters.studentUid:!!filters.studentNo&&String(row.studentNo||'')===filters.studentNo
  : !filters.studentNo||String(row.studentNo||'')===filters.studentNo;
 return Boolean(studentMatches&&(!filters.status||row.status===filters.status)&&(!filters.date||row.date===filters.date)&&(!filters.typeId||row.typeId===filters.typeId));
}
