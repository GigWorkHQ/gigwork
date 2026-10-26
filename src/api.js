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
