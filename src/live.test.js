import test from 'node:test';
import assert from 'node:assert/strict';
import {availableActions,roleIn,validateAmount,validateJobDraft,jobPayload,validateSubmission,statusLabel} from './live.js';
import {transferData} from './wallet.js';

const client='0x00000000000000000000000000000000000000c1',doer='0x00000000000000000000000000000000000000d1',other='0x00000000000000000000000000000000000000e1';
const job=status=>({status,clientWallet:client,doerWallet:['ready','awaiting_funding'].includes(status)?null:doer});

test('actions follow the backend lifecycle and participant roles',()=>{
 assert.equal(roleIn(job('ready'),client.toUpperCase().replace('0X','0x')),'client');
 assert.equal(availableActions(job('awaiting_funding'),client).fund,true);
 assert.equal(availableActions(job('awaiting_funding'),other).fund,false);
 assert.equal(availableActions(job('ready'),client).claim,false);
 assert.equal(availableActions(job('ready'),other).claim,true);
 assert.equal(availableActions(job('ready'),null).claim,false);
 assert.equal(availableActions(job('revision_requested'),doer).submit,true);
 assert.equal(availableActions(job('submitted'),doer).review,false);
 assert.equal(availableActions(job('submitted'),client).review,true);
 for(const s of ['in_progress','submitted','revision_requested'])assert.equal(availableActions(job(s),doer).dispute,true);
 for(const s of ['disputed','settlement_pending','completed'])assert.equal(availableActions(job(s),client).dispute,false);
 assert.equal(availableActions(job('in_progress'),other).history,false);
 assert.equal(statusLabel('settlement_pending'),'Paying out');
});

test('amounts match the backend decimal rules',()=>{
 for(const ok of ['25','12.5','0.000001'])assert.equal(validateAmount(ok,6),'');
 for(const bad of ['','0','0.000','-1','1e3','01','1.','1.0000001'])assert.ok(validateAmount(bad,6),bad);
});

test('job drafts become the exact create payload',()=>{
 const draft={title:'  Logo cleanup ',description:'Vectorize the logo.',criteria:'SVG file\n\n Transparent background ',amount:'40.5',deadline:''};
 assert.deepEqual(validateJobDraft(draft),{});
 assert.deepEqual(jobPayload(draft),{title:'Logo cleanup',description:'Vectorize the logo.',acceptanceCriteria:['SVG file','Transparent background'],asset:'usdg',amount:'40.5'});
 assert.ok(validateJobDraft({...draft,criteria:' \n '}).criteria);
 assert.ok(validateJobDraft({...draft,deadline:'2020-01-01T00:00'}).deadline);
 assert.ok(validateJobDraft({...draft,title:'ab'}).title);
});

test('submissions require content and http(s) evidence',()=>{
 assert.deepEqual(validateSubmission({summary:'Done',deliverable:'https://example.com/file',evidence:'https://example.com/a\n'}),{});
 assert.ok(validateSubmission({summary:'Done',deliverable:'x',evidence:'javascript:alert(1)'}).evidence);
 assert.ok(validateSubmission({summary:' ',deliverable:'x'}).summary);
});

test('USDG transfer calldata encodes recipient and raw amount',()=>{
 assert.equal(transferData('0x00000000000000000000000000000000000000AB','1500000'),'0xa9059cbb'+'0'.repeat(62)+'ab'+'0'.repeat(58)+'16e360');
 assert.throws(()=>transferData('0x12','1'));
 assert.throws(()=>transferData(other,'0'));
});
