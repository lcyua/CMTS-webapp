/** Local emulator only: refuses any real Firestore/Auth endpoint. */
import {createRequire} from 'node:module';
const adminRequire=createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeApp}=adminRequire('firebase-admin/app');
const {getFirestore}=adminRequire('firebase-admin/firestore');
const {getAuth}=adminRequire('firebase-admin/auth');
import {seed} from '../src/seed';
const local=(v:string|undefined)=>!!v&&/^(127\.0\.0\.1|localhost):\d+$/.test(v);
if(!local(process.env.FIRESTORE_EMULATOR_HOST)||!local(process.env.FIREBASE_AUTH_EMULATOR_HOST))throw Error('로컬 Auth/Firestore Emulator 주소가 필요합니다. 실제 프로젝트에서는 실행할 수 없습니다.');
initializeApp({projectId:'demo-class-portal'});
const db=getFirestore(),auth=getAuth();
for(const uid of ['teacher','student1','student2']){try{await auth.getUser(uid);}catch{await auth.createUser({uid,email:uid+'@example.test',password:'EmulatorOnly-2026!'});}}
const ref=db.doc('classes/2027-1-11/private/state');if((await ref.get()).exists)throw Error('학급 데이터가 이미 있습니다. 덮어쓰지 않았습니다.');await ref.set(seed());console.log('로컬 Emulator 초기화 완료. 계정: teacher / student1 / student2 @example.test');
