export type HistoryTable='events'|'attempts'|'lots'|'inbox'|'payouts'|'requests'|'exams'|'audits'|'notices'|'quizzes';
export interface HistoryPage {records:Record<string,any>[];cursor?:string|null;nextCursor?:string|null;legacyRemaining?:number}
