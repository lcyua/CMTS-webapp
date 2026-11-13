import {createHmac,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const validPin=(pin:unknown):pin is string=>typeof pin==='string'&&/^\d{4}$/.test(pin);
export async function hashPin(pin:string,pepper:string,salt=randomBytes(16).toString('hex')){
 if(!validPin(pin)||pepper.length<32)throw Error('4자리 코드와 서버 전용 비밀값이 필요합니다.');
 const input=createHmac('sha256',pepper).update(pin).digest('hex');
 const digest=await scrypt(input,salt,32) as Buffer;
 return {salt,hash:digest.toString('hex')};
}
export async function verifyPin(pin:string,pepper:string,salt:string,hash:string){
 if(!validPin(pin)||!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{64}$/.test(hash))return false;
 const result=await hashPin(pin,pepper,salt);return timingSafeEqual(Buffer.from(result.hash,'hex'),Buffer.from(hash,'hex'));
}
export {nextAttempt} from '../../src/login-rate';
