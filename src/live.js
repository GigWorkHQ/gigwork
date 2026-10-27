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

// Decimal string -> raw integer string, without floating point.
export function toRaw(value,decimals=6){const[whole,fraction='']=String(value).trim().split('.');return (BigInt(whole||'0')*10n**BigInt(decimals)+BigInt((fraction+'0'.repeat(decimals)).slice(0,decimals)||'0')).toString()}

export const REVIEW_STATUS=Object.freeze({waiting:['Waiting for reviewer draw','coral'],assigned:['With an independent reviewer','yellow'],escalated:['With the GigWork team','coral'],resolved:['Review resolved','blue']});
export const BATCH_STATUS=Object.freeze({awaiting_funding:['Awaiting funding','coral'],live:['Live','green'],closing:['Closing','yellow'],closed:['Closed','blue'],cancelled:['Cancelled','coral']});
export const TASK_STATUS=Object.freeze({claimed:['In progress','yellow'],submitted:['In review','blue'],credited:['Credited','green'],rejected:['Rejected','coral'],disputed:['In review dispute','coral'],rejected_final:['Not paid','coral'],released:['Released','blue']});
export const GIG_STATUS=Object.freeze({draft:['Fund to list','coral'],open:['Open','green'],active:['Active','yellow'],completed:['Completed','blue'],cancelled:['Cancelled','coral']});
export const MILESTONE_STATUS=Object.freeze({unfunded:['Not funded','coral'],funded:['Funded','green'],in_progress:['In progress','yellow'],submitted:['In review','blue'],revision_requested:['Changes requested','yellow'],approved:['Approved','green'],disputed:['Disputed','coral'],refunded:['Refunded','blue'],split:['Split by review','blue'],cancelled:['Cancelled','coral']});
export const CONTRACT_STATUS=Object.freeze({offered:['Offer pending','yellow'],active:['Active','green'],declined:['Declined','coral'],withdrawn:['Withdrawn','coral'],ended:['Ended','blue']});
export const PERIOD_STATUS=Object.freeze({reserved:['Reserved','green'],paid:['Paid','blue'],refunded:['Refunded','coral'],awaiting_funding:['Awaiting funding','coral'],cancelled:['Cancelled','coral']});
export const PAYOUT_STATUS=Object.freeze({pending:['Sending','yellow'],complete:['Paid','green'],failed:['Failed','coral']});
export const TASK_TYPES=['judge','verify','label','test','other'];
export const capitalize=s=>s?s[0].toUpperCase()+s.slice(1):'';

// Quick-task batches: one item per line, optional "| option A | option B" answer choices.
export function parseItems(text){return lines(text).map(line=>{const[prompt,...options]=line.split('|').map(p=>p.trim());return {prompt,options:options.filter(Boolean)}})}
export function hourlyRate(pay,minutes){const p=Number(pay),m=Number(minutes);return p>0&&m>0?p*60/m:0}
export function validateBatchDraft(d,{decimals=6}={}){
 const e={},items=parseItems(d.items);
 if((d.title||'').trim().length<3)e.title='Use 3–160 characters.';
 if((d.instructions||'').trim().length<20)e.instructions='Write at least 20 characters of clear instructions.';
 const pay=validateAmount(d.pay,decimals);if(pay)e.pay=pay;
 const minutes=Number(d.minutes);if(!Number.isInteger(minutes)||minutes<1||minutes>240)e.minutes='Estimate 1–240 whole minutes.';
 else if(!pay&&hourlyRate(d.pay,minutes)<6)e.pay='Pay must work out to at least 6 USDG per hour for the estimated time.';
 const workers=Number(d.workersPerItem);if(!Number.isInteger(workers)||workers<1||workers>50)e.workersPerItem='Use 1–50 workers per item.';
 const review=Number(d.reviewHours);if(!Number.isInteger(review)||review<24||review>336)e.reviewHours='Review windows are 24–336 hours.';
 if(!items.length)e.items='Add at least one item, one per line.';else if(items.length>1000)e.items='Use at most 1,000 items.';else if(items.some(i=>i.options.length===1||new Set(i.options).size!==i.options.length))e.items='Give each item either no options or at least two distinct options.';
 return e;
}
export function batchPayload(d){return {title:d.title.trim(),instructions:d.instructions.trim(),taskType:d.taskType,pay:String(d.pay).trim(),minutes:Number(d.minutes),workersPerItem:Number(d.workersPerItem),claimMinutes:Number(d.claimMinutes||10),reviewHours:Number(d.reviewHours),durationDays:Number(d.durationDays||7),items:parseItems(d.items)}}
export function fromRaw(raw,decimals=6){const s=BigInt(raw).toString().padStart(decimals+1,'0');return `${s.slice(0,-decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/,'')}
export function batchTotal(pay,itemCount,workers,decimals=6){if(validateAmount(pay,decimals))return null;return fromRaw(BigInt(toRaw(pay,decimals))*BigInt(itemCount)*BigInt(workers||0),decimals)}

export function validateGigDraft(d,{decimals=6}={}){
 const e={};
 if((d.title||'').trim().length<3)e.title='Use 3–160 characters.';
 if(!(d.description||'').trim())e.description='Describe the project.';
 if(!(d.category||'').trim())e.category='Pick a category.';
 if(!d.milestones.length)e.milestones='Add at least one milestone.';
 else if(d.milestones.length>20)e.milestones='Use at most 20 milestones.';
 else if(d.milestones.some(m=>!m.title.trim()||validateAmount(m.amount,decimals)||(m.dueDays&&!(Number.isInteger(Number(m.dueDays))&&Number(m.dueDays)>=1&&Number(m.dueDays)<=365))))e.milestones='Each milestone needs a title, a valid USDG amount, and an optional due time of 1–365 days.';
 if(d.worker&&!/^@?[a-z0-9_]{3,24}$|^0x[0-9a-fA-F]{40}$/.test(d.worker.trim()))e.worker='Use a pay handle like @maya or a 0x wallet, or leave empty to list publicly.';
 return e;
}
export function gigPayload(d){return {title:d.title.trim(),description:d.description.trim(),category:d.category.trim(),reviewHours:Number(d.reviewHours||72),...(d.worker.trim()?{worker:d.worker.trim()}:{}),milestones:d.milestones.map(m=>({title:m.title.trim(),amount:String(m.amount).trim(),...(m.dueDays?{dueDays:Number(m.dueDays)}:{})}))}}
export function validateContractDraft(d,{decimals=6}={}){
 const e={};
 if(!/^@?[a-z0-9_]{3,24}$|^0x[0-9a-fA-F]{40}$/.test((d.worker||'').trim()))e.worker='Use the worker’s pay handle (@maya) or 0x wallet.';
 if((d.title||'').trim().length<3)e.title='Use 3–160 characters.';
 if(!(d.description||'').trim())e.description='Describe the ongoing work.';
 const rate=validateAmount(d.rate,decimals);if(rate)e.rate=rate;
 if(![7,14,30].includes(Number(d.periodDays)))e.periodDays='Choose a weekly, two-week or 30-day period.';
 return e;
}
