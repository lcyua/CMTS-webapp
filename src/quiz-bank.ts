import {calendarDate,text} from './validation';

export const QUIZ_BANK_MAX_BYTES=1024*1024;
export const QUIZ_BANK_MAX_ROWS=200;
const columns=['date','question','option1','option2','option3','option4','answer','explanation'] as const;
type Column=typeof columns[number];
const headers:Record<string,Column>={날짜:'date',문제날짜:'date',date:'date',문제:'question',question:'question',보기1:'option1',option1:'option1',보기2:'option2',option2:'option2',보기3:'option3',option3:'option3',보기4:'option4',option4:'option4',정답:'answer',answer:'answer',해설:'explanation',explanation:'explanation'};
export interface QuizBankRow {row:number;date:string;question:string;options:[string,string,string,string];answer:number;explanation:string}
export interface QuizBankIssue {row:number;message:string}
export interface QuizBankResult {rows:QuizBankRow[];issues:QuizBankIssue[];total:number}
export type QuizBankDraft=Omit<QuizBankRow,'row'> & {active:false};

/** CSV is read locally; neither identifiers nor publish flags can be imported. */
function csvRows(source:string):{row:number;cells:string[]}[]{
 const result:{row:number;cells:string[]}[]=[];
 let cells:string[]=[],cell='',quoted=false,closed=false,line=1,start=1;
 const field=()=>{cells.push(cell);cell='';closed=false;};
 const row=()=>{field();if(cells.some(value=>value.trim()))result.push({row:start,cells});cells=[];start=line+1;};
 for(let i=0;i<source.length;i++){
  const char=source[i];
  if(quoted){
   if(char==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}
   else if(char==='\r'||char==='\n'){if(char==='\r'&&source[i+1]==='\n')i++;cell+='\n';line++;}
   else cell+=char;
  }else if(char===',')field();
  else if(char==='\r'||char==='\n'){if(char==='\r'&&source[i+1]==='\n')i++;row();line++;}
  else if(char==='"'){if(cell||closed)throw Error(`${line}행의 CSV 따옴표 형식을 확인하세요.`);quoted=true;}
  else {if(closed)throw Error(`${line}행의 닫힌 따옴표 뒤에는 쉼표나 줄바꿈만 올 수 있습니다.`);cell+=char;}
 }
 if(quoted)throw Error('닫히지 않은 CSV 따옴표가 있습니다. CSV UTF-8 형식으로 다시 내려받아 주세요.');
 if(cell||cells.length||closed)row();
 return result;
}

export function parseQuizBankCsv(source:string):QuizBankResult{
 if(new TextEncoder().encode(source).length>QUIZ_BANK_MAX_BYTES)throw Error('CSV 파일은 1MB 이하로 나누어 주세요.');
 const parsed=csvRows(source.replace(/^\uFEFF/,''));
 if(!parsed.length)throw Error('CSV 파일에 머리글과 문제를 넣어 주세요.');
 const header=parsed.shift()!,order=header.cells.map(value=>{const name=value.trim().replace(/\s/g,'').toLowerCase();return Object.hasOwn(headers,name)?headers[name]:undefined;});
 if(order.length!==columns.length||order.some(value=>!value)||new Set(order).size!==columns.length)throw Error('머리글은 날짜, 문제, 보기1, 보기2, 보기3, 보기4, 정답, 해설 8개가 필요합니다. 템플릿을 확인해 주세요.');
 if(!parsed.length)throw Error('CSV 파일에 불러올 문제가 없습니다.');
 if(parsed.length>QUIZ_BANK_MAX_ROWS)throw Error('CSV 문제은행은 한 번에 200문제 이하로 나누어 주세요.');
 const rows:QuizBankRow[]=[],issues:QuizBankIssue[]=[];
 for(const entry of parsed){
  try{
   if(entry.cells.length!==columns.length)throw Error('열이 8개인지 확인하세요. 문제 안의 쉼표는 CSV 따옴표로 감싸야 합니다.');
   const data=Object.fromEntries(order.map((name,index)=>[name,entry.cells[index].trim()])) as Record<Column,string>;
   if(data.date&&!calendarDate(data.date))throw Error('날짜는 비워 두거나 YYYY-MM-DD로 입력하세요.');
   text(data.question,'문제',2000);const options=[data.option1,data.option2,data.option3,data.option4] as QuizBankRow['options'];
   for(const option of options)text(option,'문제 보기',1000);
   if(!/^[1-4]$/.test(data.answer))throw Error('정답은 보기 번호 1~4 중 하나로 입력하세요.');
   text(data.explanation,'해설',4000,false);
   rows.push({row:entry.row,date:data.date,question:data.question,options,answer:Number(data.answer),explanation:data.explanation});
  }catch(error){issues.push({row:entry.row,message:error instanceof Error?error.message:'문제 형식을 확인하세요.'});}
 }
 return {rows,issues,total:parsed.length};
}

export function quizBankDraft(row:QuizBankRow,date:string,today:string):QuizBankDraft{
 if(!calendarDate(date)||!calendarDate(today)||date<today)throw Error('출제 날짜는 오늘 이후로 선택해 주세요.');
 return {date,question:row.question,options:[...row.options],answer:row.answer,explanation:row.explanation,active:false};
}
export const QUIZ_BANK_TEMPLATE='\uFEFF날짜,문제,보기1,보기2,보기3,보기4,정답,해설\r\n,공용 기기에서 사용을 마친 뒤 해야 할 일은?,비밀번호 공유,로그아웃,계정 공유,화면만 닫기,2,다음 사용자가 내 계정에 접근하지 못하도록 로그아웃합니다.\r\n';
