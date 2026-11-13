export class RateLimitError extends Error {constructor(){super('rate-limit');}}
export function nextAttempt(previous:{start:number;count:number}|undefined,now:number,limit:number){
 const state=!previous||now>=previous.start+15*60*1000?{start:now,count:0}:{...previous};
 if(state.count>=limit)throw new RateLimitError();state.count++;return state;
}
