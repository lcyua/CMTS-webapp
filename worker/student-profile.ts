import type {RecordData} from '../src/domain';
import {commandInput} from '../src/validation';
import {digest} from './credentials';
import type {Store,Document} from './store';
import type {ExecuteOptions,Write} from './state-repository';

const RETIRED='student-number-retired-v1';
const tombstoneFields=['uid','studentNo','active','scheme','version','updatedAt'];
const validVersion=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<2147483647;
function credential(value:RecordData|null,uid:string,studentNo:string){
 if(!value||value.uid!==uid||value.studentNo!==studentNo||typeof value.active!=='boolean'||value.scheme!=='firebase-password-v1'||!validVersion(value.version)||typeof value.salt!=='string'||!/^[a-f0-9]{32}$/.test(value.salt)||typeof value.authEmail!=='string'||value.authEmail!==`${uid}@students.wooriban-2027.invalid`)throw Error('기존 학생 로그인 정보를 확인할 수 없습니다. 학생정보를 다시 불러오거나 운영자에게 문의하세요.');
 if(value.createdAt!==undefined&&(!Number.isSafeInteger(value.createdAt)||value.createdAt<0))throw Error('기존 학생 로그인 정보의 생성 시간을 확인하세요.');
 return value;
}
function ownRetired(value:RecordData,uid:string,studentNo:string){
 return Object.keys(value).length===tombstoneFields.length&&Object.keys(value).every(key=>tombstoneFields.includes(key))&&value.uid===uid&&value.studentNo===studentNo&&value.active===false&&value.scheme===RETIRED&&validVersion(value.version)&&Number.isSafeInteger(value.updatedAt)&&value.updatedAt>=0;
}

/** Uses only the existing UID and credential metadata; never creates/changes a PIN or Auth account. */
export async function studentProfileOptions(store:Store,classId:string,p:RecordData,other:ExecuteOptions={}):Promise<ExecuteOptions>{
 commandInput('memberProfile',p,'student-profile-plan');
 if(p.studentNo===p.previousStudentNo)return other;
 const oldPath=`classes/${classId}/pinAccounts/${await digest(classId+':'+p.previousStudentNo)}`;
 const nextPath=`classes/${classId}/pinAccounts/${await digest(classId+':'+p.studentNo)}`;
 return {
  extraPaths:[...new Set([oldPath,nextPath,...(other.extraPaths||[])])],
  plan:async context=>{
   const before=context.before.members.find(member=>member.id===p.uid&&member.role==='student');
   const after=context.after.members.find(member=>member.id===p.uid&&member.role==='student');
   if(!before||!after||before.studentNo!==p.previousStudentNo||(before.profileVersion??1)!==p.version||after.studentNo!==p.studentNo||after.profileVersion!==p.version+1)throw Error('학생정보가 변경되었습니다. 최신 정보를 다시 불러오세요.');
   if(!context.docs.has(oldPath)||!context.docs.has(nextPath))throw Error('학생 로그인 정보의 원자적 조회를 확인할 수 없습니다.');
   const oldDoc=context.docs.get(oldPath) as Document|null,nextDoc=context.docs.get(nextPath) as Document|null;
   const old=credential(store.value(oldDoc),p.uid,p.previousStudentNo),destination=store.value(nextDoc) as RecordData|null;
   if(destination&&!ownRetired(destination,p.uid,p.studentNo))throw Error('변경할 학번은 다른 계정에 등록됐거나 사용할 수 없는 학번입니다.');
   const version=Math.max(old.version,destination?.version??0)+1;
   const next={uid:old.uid,studentNo:p.studentNo,active:old.active,scheme:old.scheme,salt:old.salt,authEmail:old.authEmail,version,updatedAt:context.now,...(old.createdAt!==undefined?{createdAt:old.createdAt}:{})};
   const retired={uid:old.uid,studentNo:p.previousStudentNo,active:false,scheme:RETIRED,version:old.version+1,updatedAt:context.now};
   const writes:Write[]=[{path:oldPath,value:retired,previous:oldDoc},{path:nextPath,value:next,previous:nextDoc}];
   if(context.writeCapacity<writes.length)throw Error('학생정보를 저장할 공간이 부족합니다. 잠시 후 다시 시도하세요.');
   const additional=other.plan?await other.plan({...context,writeCapacity:context.writeCapacity-writes.length}):{writes:[]};
   return {writes:[...writes,...additional.writes]};
  }
 };
}
