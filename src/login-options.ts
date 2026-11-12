import type {RecordData} from './domain';
export function loginStudentNumbers(members:RecordData[]):string[]{
 return [...new Set(members.filter(m=>m.role==='student'&&m.active&&typeof m.studentNo==='string'&&/^\d{1,30}$/.test(m.studentNo)).map(m=>m.studentNo as string))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
}
