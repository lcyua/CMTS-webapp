import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseQuizBankCsv,quizBankDraft,QUIZ_BANK_TEMPLATE,QUIZ_BANK_MAX_BYTES} from '../src/quiz-bank';

const header='날짜,문제,보기1,보기2,보기3,보기4,정답,해설';
const sample='2027-03-01,문제,하나,둘,셋,넷,2,해설';

test('private spreadsheet CSV template imports a question without requiring a schedule',()=>{
 const bank=parseQuizBankCsv(QUIZ_BANK_TEMPLATE);
 assert.equal(bank.rows.length,1);assert.equal(bank.issues.length,0);assert.equal(bank.rows[0].date,'');assert.equal(bank.rows[0].answer,2);
});

test('CSV reads BOM, quoted commas, double quotes and multiline cells with physical row locations',()=>{
 const bank=parseQuizBankCsv('\uFEFF'+header+'\r\n2027-03-01,"문제, \"\"인용\"\"\n두 번째 줄",하나,둘,셋,넷,2,"해설, 설명"\r\n\r\n,두번째,가,나,다,라,5,\r\n');
 assert.equal(bank.rows[0].question,'문제, "인용"\n두 번째 줄');assert.equal(bank.rows[0].explanation,'해설, 설명');
 assert.deepEqual(bank.rows[0].options,['하나','둘','셋','넷']);assert.equal(bank.rows[0].row,2);
 assert.deepEqual(bank.issues,[{row:5,message:'정답은 보기 번호 1~4 중 하나로 입력하세요.'}]);
});

test('header aliases can be reordered but unknown, duplicate and inherited names cannot import metadata',()=>{
 const data=parseQuizBankCsv('question,answer,option4,option3,option2,option1,explanation,date\n문제,4,라,다,나,가,해설,2027-03-01');
 assert.deepEqual(data.rows[0].options,['가','나','다','라']);assert.equal(data.rows[0].date,'2027-03-01');
 for(const bad of ['id','active','__proto__','constructor','date']){
  const invalid=header.replace('정답',bad);assert.throws(()=>parseQuizBankCsv(invalid+'\n'+sample),/머리글/);
 }
});

test('row errors are isolated, bounded and do not echo question contents',()=>{
 const bank=parseQuizBankCsv(header+'\n'+sample+'\n2027-02-30,비공개문제,하나,둘,셋,넷,2,\n2027-03-02,비공개문제,하나,둘,셋,넷,1.0,\n2027-03-03,비공개문제,,둘,셋,넷,2,\n2027-03-04,비공개문제,하나,둘,셋,넷,2,해설,추가');
 assert.equal(bank.total,5);assert.equal(bank.rows.length,1);assert.equal(bank.issues.length,4);
 assert.equal(JSON.stringify(bank.issues).includes('비공개문제'),false);assert.deepEqual(bank.issues.map(issue=>issue.row),[3,4,5,6]);
});

test('malformed CSV and oversized banks fail without producing partial drafts',()=>{
 for(const bad of ['"날짜,문제','날짜,x"','"날짜" x',header+'\n"미완료'])assert.throws(()=>parseQuizBankCsv(bad),/따옴표|CSV/);
 assert.throws(()=>parseQuizBankCsv(header),/불러올 문제/);
 assert.throws(()=>parseQuizBankCsv(' '),/머리글과 문제/);
 assert.throws(()=>parseQuizBankCsv(header+'\n'+Array.from({length:201},()=>sample).join('\n')),/200문제/);
 assert.throws(()=>parseQuizBankCsv('가'.repeat(Math.floor(QUIZ_BANK_MAX_BYTES/3)+1)),/1MB/);
});

test('question and explanation limits match the editor; formulas are inert text',()=>{
 const bank=parseQuizBankCsv(header+'\n,=SUM(1),보기1,보기2,보기3,보기4,1,\n,'+'문'.repeat(2001)+',보기1,보기2,보기3,보기4,1,');
 assert.equal(bank.rows[0].question,'=SUM(1)');assert.equal(bank.issues.length,1);assert.match(bank.issues[0].message,/문제 형식 또는 길이/);
});

test('applying a bank row makes an inactive new draft, preserving the source and no identifiers',()=>{
 const row=parseQuizBankCsv(header+'\n'+sample).rows[0];
 const draft=quizBankDraft(row,'2027-03-02','2027-03-01');
 assert.equal(draft.active,false);assert.equal(draft.date,'2027-03-02');assert.equal(Object.hasOwn(draft,'id'),false);assert.equal(Object.hasOwn(draft,'row'),false);assert.equal(Object.hasOwn(draft,'version'),false);
 draft.options[0]='수정';assert.equal(row.options[0],'하나');assert.equal(row.date,'2027-03-01');
 assert.throws(()=>quizBankDraft(row,'2027-02-28','2027-03-01'),/오늘 이후/);assert.throws(()=>quizBankDraft(row,'2027-02-30','2027-03-01'),/오늘 이후/);
});
