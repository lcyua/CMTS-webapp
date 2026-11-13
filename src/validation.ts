import type {RecordData, State} from './domain';

export function record(value:unknown,label='입력'):asserts value is RecordData {
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error(`${label} 형식을 확인하세요.`);
}
export function fields(value:RecordData,allowed:readonly string[],label='입력'){
 if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error(`${label}에 허용되지 않은 항목이 있습니다.`);
}
export function text(value:unknown,label:string,max:number,required=true):string {
 if(typeof value!=='string'||value.length>max||(required&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error(`${label} 형식 또는 길이를 확인하세요.`);
 return value;
}
export function id(value:unknown,label='항목 ID'){return text(value,label,300)&&typeof value==='string'&&/^[-a-zA-Z0-9_]+$/.test(value)?value:(()=>{throw Error(`${label}를 확인하세요.`)})();}
export function integer(value:unknown,min:number,max:number,label:string):number {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw Error(`${label} 범위를 확인하세요.`);return value;
}
export function boolean(value:unknown,label:string):boolean {if(typeof value!=='boolean')throw Error(`${label}는 켜기 또는 끄기로 입력하세요.`);return value;}
export function calendarDate(value:unknown):value is string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const [year,month,day]=value.split('-').map(Number);if(year<2020||year>2100||month<1||month>12||day<1)return false;
 return new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10)===value;
}
export function calendarMonth(value:unknown):value is string {return typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value)&&Number(value.slice(0,4))>=2020&&Number(value.slice(0,4))<=2100;}
export function clockTime(value:unknown):value is string {return typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);}
export function strings(value:unknown,label:string,max:number,allowed?:(value:string)=>boolean):string[]{
 if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'||v.length>300||(allowed&&!allowed(v)))||new Set(value).size!==value.length)throw Error(`${label} 목록을 확인하세요.`);return value;
}

const commandFields:Record<string,readonly string[]>={
 shop:['itemId','date'],requestStatus:['id','status','version','reason'],points:['uid','amount','reason'],payout:['month'],quiz:['choice','version'],
 exam:['id','version','typeId','date','start','end'],examStatus:['id','status','version','reason'],plan:['id','version','assignments'],
 save:['table','id','version','data'],member:['uid','active','delegations'],preferences:['enabled'],notify:['uids','body'],read:['id']
};
export function commandInput(action:unknown,p:unknown,key:unknown):asserts p is RecordData {
 if(typeof action!=='string'||!Object.hasOwn(commandFields,action))throw Error('지원하지 않는 명령입니다.');
 if(typeof key!=='string'||!/^[-a-zA-Z0-9_]{1,120}$/.test(key))throw Error('요청 키를 확인하세요.');
 record(p);fields(p,commandFields[action]);
 for(const field of ['id','uid','itemId','typeId'])if(p[field]!==undefined&&p[field]!=='')id(p[field]);
 if(p.version!==undefined)integer(p.version,1,2147483647,'버전');
 if(p.reason!==undefined)text(p.reason,'처리 사유',2000,false);
}

const settingFields:Record<string,readonly string[]>={
 notices:['title','body','url','important','active'],items:['name','price','needDate','active'],roles:['name','points','uids','active'],
 allowances:['name','points','method','active'],quizzes:['date','question','options','answer','explanation','active'],examTypes:['name','active']
};
const metadata=['id','version','createdAt','updatedAt','submittedAt'];
export function settingData(s:State,table:string,entryId:string,raw:unknown,old:RecordData|undefined):RecordData {
 record(raw,'설정');
 let allowed=settingFields[table];
 if(table==='settings')allowed=entryId==='class'?['year','className']:entryId==='shop'?['message']:entryId==='notifications'?['grant','spend','earn']:[];
 if(!allowed?.length)throw Error('허용되지 않은 설정입니다.');
 fields(raw,[...allowed,...metadata],'설정');
 for(const field of metadata)if(Object.hasOwn(raw,field)&&(!old||raw[field]!==old[field]))throw Error('설정의 ID·버전·시간은 변경할 수 없습니다.');
 const data:RecordData={};for(const field of allowed)if(Object.hasOwn(raw,field))data[field]=raw[field];else if(old&&Object.hasOwn(old,field))data[field]=old[field];
 if(table!=='settings')data.active=data.active===undefined?true:boolean(data.active,'활성 상태');
 if(['items','roles','allowances','examTypes'].includes(table))text(data.name,'이름',100);
 if(table==='notices'){
  text(data.title,'공지 제목',200);text(data.body,'공지 내용',20000);data.important=data.important===undefined?false:boolean(data.important,'중요 공지');data.url=data.url===undefined?'':text(data.url,'첨부 링크',2000,false);
  if(data.url){let url:URL;try{url=new URL(data.url);}catch{throw Error('첨부는 HTTPS 링크만 허용합니다.');}if(url.protocol!=='https:'||url.username||url.password)throw Error('첨부는 HTTPS 링크만 허용합니다.');}
 }
 if(table==='items'){integer(data.price,0,100000,'가격');data.needDate=data.needDate===undefined?false:boolean(data.needDate,'날짜 필수');}
 if(table==='roles'){integer(data.points,1,100000,'역할 점수');strings(data.uids,'담당 학생',60,uid=>s.members.some(m=>m.id===uid&&m.active&&m.role==='student'));}
 if(table==='allowances'){integer(data.points,1,100000,'수당 점수');text(data.method,'제출 방법',1000);}
 if(table==='quizzes'){
  if(!calendarDate(data.date))throw Error('문제 날짜를 확인하세요.');text(data.question,'문제',2000);
  if(!Array.isArray(data.options)||data.options.length!==4)throw Error('보기 4개와 정답 1~4가 필요합니다.');for(const option of data.options)text(option,'문제 보기',1000);
  integer(data.answer,1,4,'정답');data.explanation=data.explanation===undefined?'':text(data.explanation,'해설',4000,false);
 }
 if(table==='settings'){
  if(entryId==='class'){integer(data.year,2020,2100,'학년도');text(data.className,'학급명',100);}
  if(entryId==='shop')text(data.message,'상점 안내',4000,false);
  if(entryId==='notifications')for(const field of allowed)data[field]=data[field]===undefined?true:boolean(data[field],'알림 설정');
 }
 return data;
}
