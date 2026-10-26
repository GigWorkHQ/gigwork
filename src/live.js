// Pure helpers for the live job flow. Amounts stay decimal strings; token math happens on the server and on-chain.
export const JOB_STATUS=Object.freeze({awaiting_funding:['Awaiting funding','coral'],ready:['Funded · open','green'],in_progress:['In progress','yellow'],submitted:['In review','blue'],revision_requested:['Changes requested','yellow'],disputed:['Disputed','coral'],settlement_pending:['Paying out','blue'],completed:['Paid','green'],refunded:['Refunded','blue'],expired:['Expired','coral'],cancelled:['Cancelled','coral']});
export const statusLabel=status=>JOB_STATUS[status]?.[0]||status;
export const statusColor=status=>JOB_STATUS[status]?.[1]||'blue';
const AMOUNT=/^(?:0|[1-9]\d{0,11})(?:\.\d{1,18})?$/;

export function roleIn(job,wallet){const me=wallet?.toLowerCase();if(!me)return null;if(job.clientWallet?.toLowerCase()===me)return 'client';if(job.doerWallet?.toLowerCase()===me)return 'doer';return null}

export function availableActions(job,wallet){
 const role=roleIn(job,wallet),s=job.status;
 return {
  fund:role==='client'&&s==='awaiting_funding',
  claim:Boolean(wallet)&&role!=='client'&&s==='ready',
  submit:role==='doer'&&['in_progress','revision_requested'].includes(s),
  review:role==='client'&&s==='submitted',
  dispute:Boolean(role)&&['in_progress','submitted','revision_requested'].includes(s),
  history:Boolean(role)&&!['awaiting_funding','ready'].includes(s),
 };
}

export const lines=text=>String(text||'').split('\n').map(l=>l.trim()).filter(Boolean);

export function validateAmount(value,decimals=6){
 const v=String(value||'').trim();
 if(!AMOUNT.test(v))return 'Enter a plain decimal amount, such as 25 or 12.50.';
 if((v.split('.')[1]||'').length>decimals)return `USDG supports at most ${decimals} decimal places.`;
 if(!/[1-9]/.test(v))return 'The amount must be greater than zero.';
 return '';
}

export function validateJobDraft(d,{decimals=6,now=Date.now()}={}){
 const e={},criteria=lines(d.criteria);
 const title=(d.title||'').trim(),description=(d.description||'').trim();
 if(title.length<3||title.length>160)e.title='Use 3–160 characters.';
 if(!description)e.description='Describe the work.';else if(description.length>20000)e.description='Keep the description under 20,000 characters.';
 if(!criteria.length)e.criteria='Add at least one acceptance criterion, one per line.';
 else if(criteria.length>20)e.criteria='Use at most 20 criteria.';
 else if(criteria.some(c=>c.length>500))e.criteria='Keep each criterion under 500 characters.';
 const amount=validateAmount(d.amount,decimals);if(amount)e.amount=amount;
 if(d.deadline){const t=new Date(d.deadline).getTime();if(!Number.isFinite(t)||t<=now)e.deadline='Choose a future deadline, or leave it empty.'}
 return e;
}

export function jobPayload(d){return {title:d.title.trim(),description:d.description.trim(),acceptanceCriteria:lines(d.criteria),asset:'usdg',amount:String(d.amount).trim(),...(d.deadline?{deadlineAt:new Date(d.deadline).toISOString()}:{})}}

export function validateSubmission(d){
 const e={},evidence=lines(d.evidence);
 if(!d.summary?.trim())e.summary='Summarize what you delivered.';
 if(!d.deliverable?.trim())e.deliverable='Add the deliverable or a link to it.';
 if(evidence.length>20)e.evidence='Use at most 20 evidence links.';
 else if(evidence.some(u=>{try{return !/^https?:$/.test(new URL(u).protocol)}catch{return true}}))e.evidence='Each evidence line must be a full http(s) URL.';
 return e;
}
