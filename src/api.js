// Live GigWork API client. The base URL is public configuration; never put secrets in VITE_* variables.
export const API_BASE=(import.meta.env?.VITE_API_BASE_URL||'https://gigwork-api-uhpj.onrender.com').replace(/\/+$/,'');
const SESSION_KEY='gigwork-session-v1';
export const SESSION_EXPIRED='gigwork:session-expired';

export class ApiError extends Error{constructor(status,code,message,fields){super(message);this.status=status;this.code=code;this.fields=fields}}

export function readSession(){try{const s=JSON.parse(localStorage.getItem(SESSION_KEY));if(s?.token&&new Date(s.expiresAt)>new Date())return s;localStorage.removeItem(SESSION_KEY)}catch{}return null}
export function saveSession(s){try{s?localStorage.setItem(SESSION_KEY,JSON.stringify(s)):localStorage.removeItem(SESSION_KEY)}catch{}}

export function errorMessage(e){if(e instanceof ApiError&&e.fields?.length)return `${e.message} ${e.fields.map(f=>`${f.path||'request'}: ${f.message}`).join('; ')}`;return e?.message||'Something went wrong. Try again.'}

export async function api(path,{method='GET',body,token}={}){
 let response;
 try{response=await fetch(`${API_BASE}${path}`,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body!==undefined?JSON.stringify(body):undefined})}
 catch{throw new ApiError(0,'network_error','GigWork could not be reached. Check your connection and try again.')}
 if(response.status===204)return null;
 const payload=await response.json().catch(()=>null);
 if(!response.ok){
  const error=payload?.error||{};
  if(token&&response.status===401){saveSession(null);if(typeof window!=='undefined')window.dispatchEvent(new Event(SESSION_EXPIRED))}
  throw new ApiError(response.status,error.code||'http_error',error.message||`Request failed (${response.status}).`,error.fields);
 }
 return payload;
}

let configRequest=null;
export function loadConfig(){configRequest??=api('/v1/config').then(r=>r.data).catch(e=>{configRequest=null;throw e});return configRequest}

export const auth={
 nonce:address=>api('/v1/auth/nonce',{method:'POST',body:{address}}).then(r=>r.data),
 verify:(address,nonce,signature)=>api('/v1/auth/verify',{method:'POST',body:{address,nonce,signature}}).then(r=>r.data),
 logout:token=>api('/v1/auth/logout',{method:'POST',token}),
};

export const jobs={
 ready:(page=1,limit=30)=>api(`/v1/jobs/ready?page=${page}&limit=${limit}`),
 mine:token=>api('/v1/jobs/mine',{token}).then(r=>r.data),
 get:(token,id)=>api(`/v1/jobs/${id}`,{token}).then(r=>r.data),
 create:(token,body)=>api('/v1/jobs',{method:'POST',token,body}).then(r=>r.data),
 fund:(token,id,transactionHash)=>api(`/v1/jobs/${id}/fund`,{method:'POST',token,body:{transactionHash}}).then(r=>r.data),
 claim:(token,id)=>api(`/v1/jobs/${id}/claim`,{method:'POST',token,body:{}}).then(r=>r.data),
 submit:(token,id,body)=>api(`/v1/jobs/${id}/submissions`,{method:'POST',token,body}).then(r=>r.data),
 submissions:(token,id)=>api(`/v1/jobs/${id}/submissions`,{token}).then(r=>r.data),
 requestRevision:(token,id,feedback)=>api(`/v1/jobs/${id}/revisions`,{method:'POST',token,body:{feedback}}).then(r=>r.data),
 revisions:(token,id)=>api(`/v1/jobs/${id}/revisions`,{token}).then(r=>r.data),
 accept:(token,id)=>api(`/v1/jobs/${id}/accept`,{method:'POST',token,body:{}}).then(r=>r.data),
 dispute:(token,id,reason)=>api(`/v1/jobs/${id}/disputes`,{method:'POST',token,body:{reason}}).then(r=>r.data),
};

export const team={
 disputes:token=>api('/v1/team/disputes',{token}).then(r=>r.data),
 dispute:(token,id)=>api(`/v1/team/disputes/${id}`,{token}).then(r=>r.data),
 resolve:(token,id,outcome,note)=>api(`/v1/team/disputes/${id}/resolve`,{method:'POST',token,body:{outcome,note}}).then(r=>r.data),
};

const q=params=>{const s=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined&&v!==''));return s.toString()?`?${s}`:''};
const post=(path,token,body={})=>api(path,{method:'POST',token,body}).then(r=>r?.data);
const get=(path,token)=>api(path,{token}).then(r=>r.data);

jobs.cancel=(token,id)=>post(`/v1/jobs/${id}/cancel`,token);

export const account={
 me:token=>get('/v1/me',token),
 setHandle:(token,handle)=>api('/v1/me/handle',{method:'PUT',token,body:{handle}}).then(r=>r.data),
 apiKeys:token=>get('/v1/me/api-keys',token),
 createApiKey:(token,label)=>post('/v1/me/api-keys',token,{label}),
 revokeApiKey:(token,id)=>api(`/v1/me/api-keys/${id}`,{method:'DELETE',token}),
 payoutOptions:token=>get('/v1/payouts/options',token),
 setElection:(token,body)=>api('/v1/payouts/election',{method:'PUT',token,body}).then(r=>r.data),
 payouts:token=>get('/v1/payouts',token),
 history:token=>get('/v1/history',token),
 shares:token=>get('/v1/history/shares',token),
 createShare:(token,body)=>post('/v1/history/shares',token,body),
 revokeShare:(token,id)=>api(`/v1/history/shares/${id}`,{method:'DELETE',token}),
 referrals:token=>get('/v1/referrals',token),
 redeem:(token,code)=>post('/v1/referrals/redeem',token,{code}),
 claimBonus:(token,id)=>post(`/v1/referrals/bonuses/${id}/claim`,token),
 tipQuote:(token,subjectKind,subjectId)=>get(`/v1/tips/quote${q({subjectKind,subjectId})}`,token),
 tip:(token,body)=>post('/v1/tips',token,body),
};

export const publicApi={
 history:slug=>get(`/v1/public/history/${slug}`),
 handle:handle=>get(`/v1/public/handles/${encodeURIComponent(handle.replace(/^@/,''))}`),
};

export const tasks={
 list:type=>get(`/v1/tasks${q({type})}`),
 assignments:token=>get('/v1/tasks/assignments',token),
 claim:(token,batchId)=>post(`/v1/tasks/${batchId}/claim`,token),
 submit:(token,id,body)=>post(`/v1/tasks/assignments/${id}/submit`,token,body),
 release:(token,id)=>post(`/v1/tasks/assignments/${id}/release`,token),
 dispute:(token,id,reason)=>post(`/v1/tasks/assignments/${id}/dispute`,token,{reason}),
};

export const batches={
 create:(token,body)=>post('/v1/batches',token,body),
 mine:token=>get('/v1/batches/mine',token),
 get:(token,id)=>get(`/v1/batches/${id}`,token),
 fund:(token,id,transactionHash)=>post(`/v1/batches/${id}/fund`,token,{transactionHash}),
 close:(token,id)=>post(`/v1/batches/${id}/close`,token),
 submissions:(token,id)=>get(`/v1/batches/${id}/submissions`,token),
 approve:(token,id,assignmentId)=>post(`/v1/batches/${id}/assignments/${assignmentId}/approve`,token),
 approveAll:(token,id)=>post(`/v1/batches/${id}/approve-all`,token),
 reject:(token,id,assignmentId,reason)=>post(`/v1/batches/${id}/assignments/${assignmentId}/reject`,token,{reason}),
};

export const gigs={
 open:()=>get('/v1/gigs/open'),
 mine:token=>get('/v1/gigs/mine',token),
 get:(token,id)=>get(`/v1/gigs/${id}`,token),
 create:(token,body)=>post('/v1/gigs',token,body),
 invite:(token,id,worker)=>post(`/v1/gigs/${id}/invite`,token,{worker}),
 accept:(token,id)=>post(`/v1/gigs/${id}/accept`,token),
 cancel:(token,id)=>post(`/v1/gigs/${id}/cancel`,token),
 milestone:(token,id,milestoneId,action,body)=>post(`/v1/gigs/${id}/milestones/${milestoneId}/${action}`,token,body),
};

export const contracts={
 mine:token=>get('/v1/contracts/mine',token),
 get:(token,id)=>get(`/v1/contracts/${id}`,token),
 create:(token,body)=>post('/v1/contracts',token,body),
 accept:(token,id)=>post(`/v1/contracts/${id}/accept`,token),
 decline:(token,id)=>post(`/v1/contracts/${id}/decline`,token),
 reserve:(token,id,transactionHash)=>post(`/v1/contracts/${id}/periods`,token,{transactionHash}),
 proposeRate:(token,id,rate)=>post(`/v1/contracts/${id}/rate`,token,{rate}),
 respondRate:(token,id,accept)=>post(`/v1/contracts/${id}/rate/respond`,token,{accept}),
 end:(token,id)=>post(`/v1/contracts/${id}/end`,token),
};

export const reviews={
 me:token=>get('/v1/reviews/me',token),
 get:(token,id)=>get(`/v1/reviews/${id}`,token),
 resolve:(token,id,body)=>post(`/v1/reviews/${id}/resolve`,token,body),
};

Object.assign(team,{
 reviews:token=>get('/v1/team/reviews',token),
 review:(token,id)=>get(`/v1/team/reviews/${id}`,token),
 resolveReview:(token,id,body)=>post(`/v1/team/reviews/${id}/resolve`,token,body),
 reviewers:token=>get('/v1/team/reviewers',token),
 addReviewer:(token,user)=>post('/v1/team/reviewers',token,{user}),
 deactivateReviewer:(token,userId)=>post(`/v1/team/reviewers/${userId}/deactivate`,token),
 bonusVault:token=>get('/v1/team/bonus-vault',token),
});
