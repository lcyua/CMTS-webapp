import {State,tables} from './domain';
export type RosterRow={studentNo:string;name:string;email:string};
export function validateRoster(rows:unknown[][]):RosterRow[]{
 if(rows.length<2)throw Error('명단이 비어 있습니다.');
 const header=rows[0].map(v=>String(v??'').trim());
 if(header.length!==3||header.join(',')!=='studentNo,name,email')throw Error('열은 studentNo,name,email 순서로만 입력하세요. 비밀번호는 가져오지 않습니다.');
 const nos=new Set<string>(),emails=new Set<string>();const result:RosterRow[]=[];
 for(let i=1;i<rows.length;i++){
  const row=rows[i];if(row.every(v=>v==null||v===''))continue;
  if(row.length>3||typeof row[0]!=='string')throw Error(`${i+1}행: 학번은 앞자리 0을 보존하는 텍스트여야 합니다.`);
  const [studentNo,name,email]=row.map(v=>String(v??'').trim());const normalized=email.toLowerCase();
  if(!/^[a-zA-Z0-9_-]{1,30}$/.test(studentNo)||!name||name.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))throw Error(`${i+1}행: 학번·이름·이메일 형식을 확인하세요.`);
  if(nos.has(studentNo)||emails.has(normalized))throw Error(`${i+1}행: 중복 학번 또는 이메일입니다.`);
  nos.add(studentNo);emails.add(normalized);result.push({studentNo,name,email:normalized});
 }
 if(!result.length||result.length>60)throw Error('한 학급 명단은 1~60명으로 제한합니다.');return result;
}
export function emptyClass(teacher:{uid:string;name:string},students:(RosterRow&{uid:string})[],year:number,className:string):State{
 if(!teacher.uid||!teacher.name||!Number.isInteger(year)||year<2020||year>2100||!className.trim())throw Error('교사·학년도·학급명을 확인하세요.');
 if(new Set([teacher.uid,...students.map(s=>s.uid)]).size!==students.length+1||students.some(s=>!s.uid))throw Error('계정 UID 중복입니다.');
 const state=Object.fromEntries(tables.map(t=>[t,[]])) as unknown as State;
 state.members=[{id:teacher.uid,name:teacher.name,role:'teacher',active:true},...students.map(s=>({id:s.uid,name:s.name,studentNo:s.studentNo,role:'student',active:true,delegations:[]}))];
 state.settings=[{id:'class',year,className,version:1},{id:'shop',message:'',version:1},{id:'notifications',grant:true,spend:true,earn:true,version:1}];
 state.plans=[{id:'seats',name:'우리 반 좌석',kind:'seat',version:1,assignments:Array(students.length).fill('')},{id:'cleaning',name:'청소구역',kind:'cleaning',version:1,assignments:Array(4).fill('')}];
 return state;
}
