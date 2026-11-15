import {test} from 'node:test';
import assert from 'node:assert/strict';
import {command,kstDate} from '../src/domain';
import {emptyClass} from '../src/roster';
import {preparePushWrites,PushJob} from '../worker/push';
import {Store} from '../worker/store';

const now=Date.parse('2027-01-20T03:00:00Z'),classId='demo-notification-defaults';
function classroom(){
 return emptyClass({uid:'test-teacher',name:'테스트 교사'},Array.from({length:18},(_,index)=>({uid:'test-student-'+index,studentNo:String(index+1).padStart(5,'0'),name:'테스트 학생 '+(index+1),email:`student${index}@example.test`})),2027,'테스트 학급');
}
function localStore(){return new Store('demo-class-portal',async()=>{throw Error('These tests must not authenticate or access a live service.');});}

test('all 18 initially provisioned students receive inbox notifications and qualify for push by default',async()=>{
 const s=classroom(),students=s.members.filter(member=>member.role==='student');
 assert.equal(students.length,18);assert.ok(students.every(member=>member.notifications===undefined));
 assert.deepEqual(s.settings.find(row=>row.id==='notifications'),{id:'notifications',grant:true,spend:true,earn:true,version:1});
 command(s,'test-teacher','notify',{body:'기본 수신 확인'},'default-notice',now);
 assert.equal(s.inbox.length,18);assert.deepEqual(new Set(s.inbox.map(row=>row.uid)),new Set(students.map(member=>member.id)));
 const queue=await preparePushWrites(localStore(),classId,new Set(),s,null,now);
 assert.equal(queue.queued,18);assert.equal(queue.dropped,0);
 assert.deepEqual(new Set(queue.writes.slice(1).map(write=>(write.value as PushJob).uid)),new Set(students.map(member=>member.id)));
 assert.ok(students.every(member=>member.notifications===undefined),'Default-on semantics must not rewrite existing membership preferences.');
});

test('explicit notification refusal is preserved and only the active user can reenable receiving',async()=>{
 const s=classroom(),uid='test-student-0';
 command(s,uid,'preferences',{enabled:false},'opt-out',now);
 command(s,'test-student-1','preferences',{enabled:true},'other-user-default',now);
 assert.equal(s.members.find(member=>member.id===uid)!.notifications.enabled,false,'Another user enabling their own preference cannot override refusal.');
 command(s,'test-teacher','notify',{body:'수신 거부 유지'},'notice-after-opt-out',now);
 assert.equal(s.inbox.length,17);assert.ok(s.inbox.every(row=>row.uid!==uid));
 const optedOut=await preparePushWrites(localStore(),classId,new Set(),s,null,now);assert.equal(optedOut.queued,17);
 const previousIds=new Set(s.inbox.map(row=>row.id));
 command(s,uid,'preferences',{enabled:true},'opt-in',now);
 command(s,'test-teacher','notify',{uids:[uid],body:'직접 수신 재개'},'notice-after-opt-in',now);
 assert.equal(s.inbox.length,18);
 const optedIn=await preparePushWrites(localStore(),classId,previousIds,s,null,now);
 assert.equal(optedIn.queued,1);assert.equal((optedIn.writes[1].value as PushJob).uid,uid);
 const inboxCount=s.inbox.length;
 command(s,uid,'preferences',{enabled:false},'opt-out-again',now);
 command(s,'test-teacher','notify',{uids:[uid],body:'새 알림은 만들지 않음'},'notice-after-second-opt-out',now);
 assert.equal(s.inbox.length,inboxCount,'Opting out preserves earlier inbox history.');
 assert.equal((await preparePushWrites(localStore(),classId,previousIds,s,null,now)).queued,0,'An unread existing notification becomes ineligible after opting out.');
 const inactive=s.members.find(member=>member.id==='test-student-1')!;inactive.active=false;
 const beforeInactive=new Set(s.inbox.map(row=>row.id));
 assert.throws(()=>command(s,inactive.id,'preferences',{enabled:true},'inactive-opt-in',now),/활성 학급/);
 command(s,'test-teacher','notify',{body:'활성 수신자에게만'},'active-recipients',now);
 const remaining=await preparePushWrites(localStore(),classId,beforeInactive,s,null,now);
 assert.equal(remaining.queued,16);assert.ok(remaining.writes.slice(1).every(write=>![uid,inactive.id].includes((write.value as PushJob).uid)));
});

test('default point notification categories work while explicit class policy opt-outs remain respected',()=>{
 const s=classroom(),uid='test-student-0';
 s.quizzes=[{id:'daily-test',date:kstDate(now),question:'테스트 문제',options:['가','나','다','라'],answer:1,explanation:'테스트 해설',active:true,version:1}];
 command(s,'test-teacher','points',{uid,amount:10,reason:'테스트 지급'},'grant-default',now);
 command(s,uid,'quiz',{choice:1,version:1},'earn-default',now);
 command(s,'test-teacher','points',{uid,amount:-1,reason:'테스트 차감'},'spend-default',now);
 assert.deepEqual(s.inbox.map(row=>row.category),['grant','earn','spend']);
 command(s,'test-teacher','save',{table:'settings',id:'notifications',version:1,data:{grant:false}},'disable-grant-category',now);
 command(s,'test-teacher','points',{uid,amount:10,reason:'지급 알림은 끔'},'grant-disabled',now);
 assert.equal(s.inbox.length,3);assert.equal(s.settings.find(row=>row.id==='notifications')!.grant,false);
 command(s,uid,'preferences',{enabled:false},'student-disabled',now);
 command(s,'test-teacher','save',{table:'settings',id:'notifications',version:2,data:{grant:true}},'enable-grant-category',now);
 command(s,'test-teacher','points',{uid,amount:10,reason:'개인 수신 거부 유지'},'grant-with-personal-refusal',now);
 assert.equal(s.inbox.length,3,'Class policy enabling cannot override a personal refusal.');
});
