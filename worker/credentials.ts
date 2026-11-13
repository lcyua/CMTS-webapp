// The short PIN is never a Firebase password or a client-side credential.
// Firebase Auth performs expensive password hashing; only this server can derive its input.
export async function pinPassword(pin:string,pepper:string,salt:string){
 if(!/^\d{4}$/.test(pin)||pepper.length<32||!/^[a-f0-9]{32}$/.test(salt))throw Error('Invalid credential configuration');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`wooriban-pin-v1:${salt}:${pin}`));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
