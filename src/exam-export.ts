import type {HistoryPage} from './history';
import {kstDate} from './domain';
type Row=Record<string,any>;
export type ExamFilters={text:string;status:string;date:string;typeId:string};

/** Export the selected result across server pages, refusing a silent partial workbook. */
export async function collectExamExport(load:(cursor?:string|null)=>Promise<HistoryPage>,filters:ExamFilters,maximum=5000){
 const result:Row[]=[],ids=new Set<string>(),cursors=new Set<string>();let cursor:string|null|undefined;
 do{
  const page=await load(cursor);
  for(const row of page.records){
   if(ids.has(row.id))continue;ids.add(row.id);
   if(ids.size>maximum)throw Error('내보내기 한도입니다. 기간별 운영 백업을 이용해 주세요.');
   if((!filters.text||(String(row.name||'')+' '+String(row.studentNo||'')).includes(filters.text))&&(!filters.status||row.status===filters.status)&&(!filters.date||row.date===filters.date)&&(!filters.typeId||row.typeId===filters.typeId))result.push(row);
  }
  cursor=page.nextCursor;
  if(cursor){if(cursors.has(cursor))throw Error('기록 조회가 반복되어 내보내기를 중단했습니다. 다시 시도해 주세요.');cursors.add(cursor);}
 }while(cursor);
 return result;
}

export async function writeExamWorkbook(exams:Row[]){
 const x=await import('xlsx'),labels:Record<string,string>={pending:'대기',approved:'승인',rejected:'반려',cancelled:'취소'};
 const rows=[['학번','이름','시험 종목','시험일','시작 시간','종료 시간','상태'],...exams.map(exam=>[String(exam.studentNo),exam.name,exam.typeName,exam.date,exam.start,exam.end,labels[exam.status]||exam.status])];
 const sheet=x.utils.aoa_to_sheet(rows);
 Object.values(sheet).forEach((cell:any)=>{if(cell&&typeof cell==='object'&&'v'in cell){cell.t='s';delete cell.f;}});
 const workbook=x.utils.book_new();x.utils.book_append_sheet(workbook,sheet,'시험 신청');x.writeFile(workbook,'시험신청_'+kstDate()+'.xlsx');
}
