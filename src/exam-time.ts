import {clockTime} from './validation';

type ExamTime={start?:unknown;end?:unknown;timeMode?:unknown};

// Existing applications may have a known interval. New ones record only the
// supplied start; never assume a duration or a whole-day reservation.
export function examIntervalEnd(exam:ExamTime):string|undefined {
 return exam.timeMode!=='start'&&clockTime(exam.start)&&clockTime(exam.end)&&exam.end>exam.start?exam.end:undefined;
}

export function examTimesConflict(a:ExamTime,b:ExamTime):boolean {
 if(!clockTime(a.start)||!clockTime(b.start))return false;
 const aEnd=examIntervalEnd(a),bEnd=examIntervalEnd(b);
 if(aEnd&&bEnd)return a.start<bEnd&&b.start<aEnd;
 if(aEnd)return b.start>=a.start&&b.start<aEnd;
 if(bEnd)return a.start>=b.start&&a.start<bEnd;
 return a.start===b.start;
}

export function formatExamTime(exam:ExamTime):string {
 if(!clockTime(exam.start))return '시작 시간 미기록';
 const end=examIntervalEnd(exam);
 return end?`${exam.start}–${end}`:`${exam.start} 시작`;
}
