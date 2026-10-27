import React,{useState,useEffect} from 'react';
import {ShieldCheck,ExternalLink,Users,Check,TriangleAlert} from 'lucide-react';
import {Brand} from './main.jsx';
import {publicApi,loadConfig,errorMessage} from './api.js';
import './dashboard.css';
import './dashboard-refined.css';
import './live.css';

const kindLabel={job:'Job',quick_tasks:'Quick tasks',milestone:'Milestone',pay_run:'Pay run'};
const sha256=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
// Same canonical form the server commits to; recomputed here so the page proves itself.
export const commitmentInput=e=>JSON.stringify([e.kind,e.ref,e.title,e.client,e.amountRaw,e.date,[...e.transactions].sort(),e.salt]);

export function SharedHistory(){
 const slug=location.pathname.split('/')[2]||'';const[data,setData]=useState(null),[error,setError]=useState(''),[config,setConfig]=useState(null),[verified,setVerified]=useState({});
 useEffect(()=>{publicApi.history(slug).then(setData).catch(e=>setError(errorMessage(e)));loadConfig().then(setConfig).catch(()=>{})},[slug]);
 useEffect(()=>{if(!data)return;Promise.all(data.entries.map(async e=>[e.ref,(await sha256(commitmentInput(e)))===e.commitment])).then(r=>setVerified(Object.fromEntries(r)))},[data]);
 useEffect(()=>{document.title=data?`${data.title} · GigWork work history`:'GigWork work history'},[data]);
 return <div className="share-page"><header className="share-header"><Brand/><a href="/app/overview" className="text-link">Open GigWork</a></header><main className="share-main">
  {error?<div className="inline-notice coral"><TriangleAlert size={19}/><p>{error}</p></div>:!data?<p className="live-loading">Loading shared history…</p>:<>
   <span className="eyebrow">SHARED WORK HISTORY</span><h1>{data.title}</h1>
   <p className="share-who">{data.worker.handle?<b>{data.worker.handle}</b>:null} <span className="mono">{data.worker.wallet}</span></p>
   <div className="metric-grid three live-metrics"><div><span>Entries</span><b>{data.entries.length}</b></div><div><span>Distinct clients</span><b><Users size={15}/> {data.distinctClients}</b></div><div><span>Paid from escrow</span><b>{data.total} USDG</b></div></div>
   <div className="work-table">{data.entries.map(e=><div className="work-row" key={`${e.kind}-${e.ref}`}><div><b>{e.title}</b><span>{kindLabel[e.kind]} · {e.client} · {e.date}</span></div><strong>{e.amount}<small>USDG</small></strong><span title={`Commitment ${e.commitment}`}>{verified[e.ref]?<><Check size={13}/> Commitment verified</>:'Checking…'}</span><span>{e.transactions.slice(0,3).map(tx=>config?<a key={tx} href={`${config.explorerUrl}/tx/${tx}`} target="_blank" rel="noreferrer">Payout tx <ExternalLink size={12}/></a>:<span key={tx} className="mono">{tx.slice(0,10)}…</span>)}{e.transactions.length>3?` +${e.transactions.length-3}`:''}</span></div>)}</div>
   <div className="inline-notice muted-notice"><ShieldCheck size={18}/><p>Every entry is a payout from a GigWork escrow to this wallet, with its on-chain transaction. The worker chose which entries to show. This page proves the work was approved and paid; it is not a rating of quality.</p></div>
  </>}
 </main></div>;
}
