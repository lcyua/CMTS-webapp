import test from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode} from '../worker/store';

test('login-limit expiry uses Firestore timestamp values required by TTL',()=>{
 const expiry=new Date('2026-11-14T00:00:00.000Z');
 const fields=encode({start:1000,count:1,expiresAt:expiry}).mapValue.fields;
 assert.deepEqual(fields.expiresAt,{timestampValue:expiry.toISOString()});
 assert.deepEqual(fields.start,{integerValue:'1000'});
 const restored=decode({mapValue:{fields}});
 assert.equal(restored.start,1000);
 assert.equal(restored.count,1);
 assert.equal(Date.parse(restored.expiresAt),expiry.getTime());
 assert.throws(()=>encode(new Date(NaN)),RangeError);
});
