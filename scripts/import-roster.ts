/** Validate locally by default. --apply uses ADC; never accepts keys or passwords. */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import * as XLSX from 'xlsx';
import {validateRoster,emptyClass} from '../src/roster';
const args=process.argv.slice(2);const option=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined};
const input=option('--file');if(!input)throw Error('사용: npx tsx scripts/import-roster.ts --file 명단.csv [--apply --teacher-email ... --teacher-name ... --year 2027 --class-name ... --class-id ...]');
const workbook=XLSX.read(readFileSync(input),{type:'buffer',raw:true,cellFormula:true});
const sheet=workbook.Sheets[workbook.SheetNames[0]];
if(Object.values(sheet).some((c:any)=>c?.f))throw Error('수식 셀이 있습니다. 명단은 값만 제공하세요.');
const rows=validateRoster(XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:true}));
console.log(`명단 검증 완료: ${rows.length}명. 이름·이메일·비밀번호를 로그에 출력하지 않습니다.`);
if(args.includes('--apply')){
 const teacherEmail=option('--teacher-email'),teacherName=option('--teacher-name'),year=Number(option('--year')),className=option('--class-name'),classId=option('--class-id');
 if(!teacherEmail||!teacherName||!className||!classId||!/^[-a-zA-Z0-9_]{1,80}$/.test(classId)||!Number.isInteger(year))throw Error('교사 이메일·교사명·학년도·학급명·학급 ID가 필요합니다.');
 if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('실제 데이터 이전은 에뮬레이터 설정을 제거한 후 진행하세요.');
 const adminRequire=createRequire(new URL('../functions/package.json',import.meta.url));
 const {initializeApp,applicationDefault}=adminRequire('firebase-admin/app');
 const {getAuth}=adminRequire('firebase-admin/auth');const {getFirestore}=adminRequire('firebase-admin/firestore');
 initializeApp({credential:applicationDefault(),projectId:'wooriban-2027'});const auth=getAuth(),db=getFirestore();
 const teacher=await auth.getUserByEmail(teacherEmail);if(teacher.disabled)throw Error('교사 계정이 비활성화되었습니다.');
 const students=[];
 for(let i=0;i<rows.length;i++){try{const account=await auth.getUserByEmail(rows[i].email);if(account.disabled)throw Error('inactive');students.push({...rows[i],uid:account.uid});}catch{throw Error(`${i+2}행: 연결할 활성 Firebase Auth 계정이 없습니다. 계정 발급·첫 로그인을 확인하세요.`);}}
 const state=emptyClass({uid:teacher.uid,name:teacherName},students,year,className);
 if(Buffer.byteLength(JSON.stringify(state))>700000)throw Error('학급 데이터 한도 초과');
 const ref=db.doc(`classes/${classId}/private/state`);
 await db.runTransaction(async (tx:any)=>{if((await tx.get(ref)).exists)throw Error('기존 학급이 있어 중단했습니다. 기존 데이터는 덮어쓰지 않습니다.');tx.create(ref,state);});
 console.log(`Firebase 학급 초기화 완료: ${students.length}명. 초기 잔액 0 P, 과거 잔액·계정 자격 증명은 이전하지 않았습니다.`);
}else console.log('검증 전용입니다. 원격 연결·학생 등록은 실행하지 않았습니다.');
