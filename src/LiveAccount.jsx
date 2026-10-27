import React,{useState,useEffect,useRef} from 'react';
import {RefreshCcw,Share2,Trash2,KeyRound,Gift,AtSign,Coins,Heart,TriangleAlert,ExternalLink} from 'lucide-react';
import {Button} from './main.jsx';
import {Panel,Empty} from './Dashboard.jsx';
import {account,API_BASE,errorMessage} from './api.js';
import {useConfig,useLoader,date,day,SignInPrompt,ErrorNotice,TextAction,StatusPill,TxLink,CopyButton} from './LiveShared.jsx';
import {PAYOUT_STATUS} from './live.js';

const kindLabel={job:'Job',quick_tasks:'Quick tasks',milestone:'Milestone',pay_run:'Pay run'};

export function LiveEarnings({live,notify}){
 const{session}=live;const{config}=useConfig();
 const pay=useLoader(()=>session?account.payouts(session.token):Promise.resolve(null),[session]);
 const history=useLoader(()=>session?account.history(session.token):Promise.resolve(null),[session]);
 const shares=useLoader(()=>session?account.shares(session.token):Promise.resolve(null),[session]);
 const[picked,setPicked]=useState(new Set()),[title,setTitle]=useState('Selected work'),[busy,setBusy]=useState(false);
 if(!session)return <Panel title="Pay & history"><SignInPrompt live={live} text="Sign in with your wallet to see your payouts, tips and work history."/></Panel>;
 const key=e=>`${e.kind}:${e.ref}`;const toggle=e=>setPicked(s=>{const n=new Set(s);n.has(key(e))?n.delete(key(e)):n.add(key(e));return n});
 async function share(){if(busy||!picked.size)return;setBusy(true);try{const entries=history.data.entries.filter(e=>picked.has(key(e))).map(e=>({kind:e.kind,ref:e.ref}));const s=await account.createShare(session.token,{title:title.trim()||'Selected work',entries});notify('Share link created.');setPicked(new Set());shares.reload();navigator.clipboard?.writeText(`${location.origin}/h/${s.slug}`).catch(()=>{})}catch(e){notify(errorMessage(e))}finally{setBusy(false)}}
 const t=pay.data?.totals;
 return <>
  <div className="metric-grid three live-metrics"><div><span>Received</span><b>{t?`${t.received} USDG`:'—'}</b></div><div><span>Being sent</span><b>{t?`${t.pending} USDG`:'—'}</b></div><div><span>Tips</span><b>{t?`${t.tips} USDG`:'—'}</b></div></div>
  <Panel title="Payouts" subtitle="Every escrow payout and refund to your wallet, with its transaction." action={<button className="text-link" onClick={pay.reload}><RefreshCcw size={14}/>Refresh</button>}>{pay.error?<ErrorNotice message={pay.error} onRetry={pay.reload}/>:!pay.data?<p className="live-loading">Loading payouts…</p>:pay.data.entries.length?<div className="work-table"><div className="work-row work-table-head"><span>Payout</span><span>Amount</span><span>Status</span><span>Transaction</span></div>{pay.data.entries.map((e,i)=><div className="work-row" key={i}><div><b>{e.label}</b><span>{date(e.completedAt||e.createdAt)}{e.note?` · ${e.note}`:''}</span></div><strong>{e.amount}<small>USDG</small></strong><StatusPill map={PAYOUT_STATUS} value={e.status}/><span>{e.transactionHash?<TxLink config={config} hash={e.transactionHash}/>:'—'}</span></div>)}</div>:<Empty title="No payouts yet" text="Pay from approved work and refunds shows up here."/>}
   {pay.data?.tips.length>0&&<div className="live-history"><h4><Heart size={15}/>Tips received</h4><ol className="live-events">{pay.data.tips.map(tp=><li key={tp.transactionHash}><span className="mono">{date(tp.createdAt)}</span>{tp.amount} USDG{tp.message?` — “${tp.message}”`:''} · <TxLink config={config} hash={tp.transactionHash}/></li>)}</ol></div>}
  </Panel>
  <Panel title="Work history" subtitle={history.data?`${history.data.entries.length} paid entr${history.data.entries.length===1?'y':'ies'} from ${history.data.distinctClients} distinct client${history.data.distinctClients===1?'':'s'}. Only work paid from escrow appears here.`:'Only work paid from escrow appears here.'}>
   {history.error?<ErrorNotice message={history.error} onRetry={history.reload}/>:!history.data?<p className="live-loading">Loading history…</p>:history.data.entries.length?<>
    <div className="work-table">{history.data.entries.map(e=><label className="work-row history-row" key={key(e)}><input type="checkbox" checked={picked.has(key(e))} onChange={()=>toggle(e)} aria-label={`Share ${e.title}`}/><div><b>{e.title}</b><span>{kindLabel[e.kind]} · {e.client} · {day(e.date)}</span></div><strong>{e.amount}<small>USDG</small></strong><span>{e.transactions.length===1?<TxLink config={config} hash={e.transactions[0]}/>:`${e.transactions.length} payouts`}</span></label>)}</div>
    <div className="share-bar"><input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} aria-label="Share title"/><Button className="small" disabled={!picked.size||busy} onClick={share}><Share2 size={15}/>Share {picked.size||''} selected</Button></div>
    <p className="field-note"><TriangleAlert size={13}/> A share page shows your wallet address, the clients’ names and the payout transactions for the entries you pick. Anyone with the link can see them until you withdraw it.</p>
   </>:<Empty title="No paid work yet" text="Approved jobs, quick tasks, milestones and Pay runs build your history."/>}
   {shares.data?.length>0&&<div className="live-history"><h4>Your share links</h4><ol className="live-events">{shares.data.map(sh=><li key={sh.id}><span className="mono">{day(sh.createdAt)}</span><a href={`/h/${sh.slug}`} target="_blank" rel="noreferrer">{sh.title}</a> · {sh.entryCount} entr{sh.entryCount===1?'y':'ies'} <CopyButton text={`${location.origin}/h/${sh.slug}`} label="Copy link"/><button className="text-link" onClick={async()=>{await account.revokeShare(session.token,sh.id).catch(e=>notify(errorMessage(e)));notify('Share link withdrawn.');shares.reload()}}><Trash2 size={13}/>Withdraw</button></li>)}</ol></div>}
  </Panel>
 </>;
}

export function LiveAccountSettings({live,notify}){
 const{session}=live;
 if(!session)return <Panel title="Account"><SignInPrompt live={live} text="Sign in with your wallet to set your pay handle, referrals, payout choice and API keys."/></Panel>;
 return <><HandlePanel live={live} notify={notify}/><PayoutPanel session={session} notify={notify}/><ReferralPanel session={session} notify={notify}/><ApiKeyPanel session={session} notify={notify}/></>;
}

function HandlePanel({live,notify}){
 const{session,profile,refreshProfile}=live;
 return <Panel title="Pay handle" subtitle="A short name clients can use to invite you to gigs and contracts, instead of your wallet address.">
  <div className="handle-current"><AtSign size={18}/><b>{profile?.handle||'No handle yet'}</b><span className="mono">{session.walletAddress}</span></div>
  <TextAction label={profile?.handle?'Change handle':'Choose a handle'} placeholder="maya_design" button="Save handle" onSubmit={async handle=>{try{await account.setHandle(session.token,handle);await refreshProfile();notify('Pay handle saved.')}catch(e){notify(errorMessage(e))}}}/>
  <p className="field-note">3–24 lowercase letters, numbers or underscores. Your handle is public and resolves to your wallet.</p>
 </Panel>;
}

function PayoutPanel({session,notify}){
 const options=useLoader(()=>account.payoutOptions(session.token),[]);const[d,setD]=useState(null),[busy,setBusy]=useState(false);
 useEffect(()=>{if(options.data&&!d){const e=options.data.election;setD({stockSymbol:e.stockSymbol||options.data.stockTokens[0]?.symbol||'',percent:String((e.stockBps||0)/100),country:e.country||'',ack:false})}},[options.data]);
 const o=options.data;
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);try{const bps=Math.round(Number(d.percent||0)*100);await account.setElection(session.token,{stockSymbol:bps?d.stockSymbol:null,stockBps:bps,country:d.country.trim().toUpperCase(),acknowledgeRisk:d.ack});notify(bps?'Payout choice saved.':'Payouts set to 100% USDG.');options.reload()}catch(err){notify(errorMessage(err))}finally{setBusy(false)}}
 return <Panel title="Payout choice" subtitle="USDG is the default. Where eligible, you can choose to have part of your pay in a stock token.">
  {options.error?<ErrorNotice message={options.error} onRetry={options.reload}/>:!o||!d?<p className="live-loading">Loading…</p>:!o.stockTokens.length?<div className="inline-notice blue"><Coins size={18}/><p>Stock-token payouts aren’t offered yet. All pay is sent in USDG.</p></div>:<form className="live-text-action" onSubmit={save}>
   <div className="form-grid"><label className="form-field">Stock token<select value={d.stockSymbol} onChange={e=>setD({...d,stockSymbol:e.target.value})}>{o.stockTokens.map(t=><option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}</select></label><label className="form-field">Share of pay · % (0–{o.maxStockBps/100})<input inputMode="decimal" value={d.percent} onChange={e=>setD({...d,percent:e.target.value.replace(/[^\d.]/g,'')})}/></label><label className="form-field">Country of residence · 2 letters<input value={d.country} maxLength={2} onChange={e=>setD({...d,country:e.target.value.toUpperCase()})} placeholder="NG"/></label></div>
   <label className="check-row"><input type="checkbox" checked={d.ack} onChange={e=>setD({...d,ack:e.target.checked})}/>I understand stock tokens are issuer products, not shares, and their price can fall.</label>
   {!o.routeEnabled&&<p className="field-note"><TriangleAlert size={13}/> No verified swap route is enabled yet, so your full pay is still sent in USDG. Each payout records that your choice fell back to USDG.</p>}
   <p className="field-note">Not available to residents of {o.excludedCountries.join(', ')}.</p>
   <Button type="submit" className="small" disabled={busy||!d.country}>{busy?'Saving…':'Save payout choice'}</Button>
  </form>}
 </Panel>;
}

function ReferralPanel({session,notify}){
 const{config}=useConfig();const ref=useLoader(()=>account.referrals(session.token),[]);const r=ref.data;const claiming=useRef(false);
 const fromUrl=typeof location!=='undefined'?new URLSearchParams(location.search).get('ref'):null;
 async function claim(id){if(claiming.current)return;claiming.current=true;try{await account.claimBonus(session.token,id);notify('Bonus claimed. It is being sent to your wallet.');ref.reload()}catch(e){notify(errorMessage(e))}finally{claiming.current=false}}
 return <Panel title="Referrals" subtitle={r?`When someone you invite completes ${r.program.minApproved} approved pieces of work and has been here ${r.program.minDays} days, you each get ${r.program.bonus} USDG from the bonus budget.`:'Invite people you know.'} action={<button className="text-link" onClick={ref.reload}><RefreshCcw size={14}/>Refresh</button>}>
  {ref.error?<ErrorNotice message={ref.error} onRetry={ref.reload}/>:!r?<p className="live-loading">Loading…</p>:<>
   <div className="handle-current"><Gift size={18}/><b className="mono">{r.code}</b><CopyButton text={`${location.origin}/app/account?ref=${r.code}`} label="Copy invite link"/><span>{r.invitees.length}/{r.program.maxInvites} invites used</span></div>
   {!r.referred&&<TextAction label="Were you invited? Enter their code (first 14 days only)" placeholder={fromUrl||'abcd2345'} button="Use code" onSubmit={async code=>{try{await account.redeem(session.token,code);notify('Referral code applied.');ref.reload()}catch(e){notify(errorMessage(e))}}}/>}
   {fromUrl&&!r.referred&&<p className="field-note">Your invite code is <b className="mono">{fromUrl}</b>.</p>}
   {r.myProgress&&<p className="field-note">Your progress: {r.myProgress.approved}/{r.program.minApproved} approved pieces of work.</p>}
   {r.invitees.length>0&&<ol className="live-events">{r.invitees.map((i,k)=><li key={k}><span className="mono">{day(i.referredAt)}</span>{i.who} · {i.approved}/{r.program.minApproved} approved</li>)}</ol>}
   {r.bonuses.length>0&&<div className="work-table">{r.bonuses.map(b=><div className="work-row" key={b.id}><div><b>{b.role==='referrer'?'Referral bonus':'Welcome bonus'}</b><span>{day(b.createdAt)}</span></div><strong>{b.amount}<small>USDG</small></strong><span>{b.status==='claimable'?'Ready to claim':b.payoutStatus==='complete'?<TxLink hash={b.transactionHash} config={config}>Paid</TxLink>:'Sending'}</span>{b.status==='claimable'?<Button className="small" onClick={()=>claim(b.id)}>Claim</Button>:<span/>}</div>)}</div>}
   <p className="field-note">Bonus budget available: {r.program.budgetAvailable??'unknown'} USDG. Bonuses are paid from a separate budget, never from client escrow. If the budget is empty, your bonus stays claimable.</p>
  </>}
 </Panel>;
}

function ApiKeyPanel({session,notify}){
 const keys=useLoader(()=>account.apiKeys(session.token),[]);const[created,setCreated]=useState(null);
 const example=`curl -X POST ${API_BASE}/v1/batches \\\n  -H "Authorization: Bearer ${created?.key||'gwk_…'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Judge answers","instructions":"Pick the clearer answer for each prompt.","taskType":"judge","pay":"0.5","minutes":2,"items":[{"prompt":"Q1","options":["A","B"]}]}'`;
 return <Panel title="Agent API keys" subtitle="Let an AI agent post and fund quick-task batches and read results as you. Keys can’t manage other keys.">
  {keys.error?<ErrorNotice message={keys.error} onRetry={keys.reload}/>:!keys.data?<p className="live-loading">Loading…</p>:<>
   {created&&<div className="inline-notice yellow"><KeyRound size={18}/><p><b>Copy this key now. It won’t be shown again.</b><br/><span className="mono key-reveal">{created.key}</span></p><CopyButton text={created.key}/></div>}
   {keys.data.length>0&&<ol className="live-events">{keys.data.map(k=><li key={k.id}><span className="mono">{k.prefix}…</span>{k.label} · created {day(k.createdAt)}{k.lastUsedAt?` · last used ${date(k.lastUsedAt)}`:' · never used'} <button className="text-link" onClick={async()=>{await account.revokeApiKey(session.token,k.id).catch(e=>notify(errorMessage(e)));notify('API key revoked.');keys.reload()}}><Trash2 size={13}/>Revoke</button></li>)}</ol>}
   <TextAction label="New key label" placeholder="labeling agent" button="Create API key" onSubmit={async label=>{try{setCreated(await account.createApiKey(session.token,label));keys.reload()}catch(e){notify(errorMessage(e))}}}/>
   <details className="live-dispute"><summary><ExternalLink size={14}/>Example: create a batch</summary><pre className="live-deliverable">{example}</pre><p className="field-note">The agent then funds the batch by sending the returned totalRaw of USDG from your wallet to escrowAddress and calling POST /v1/batches/:id/fund with the transaction hash. Results: GET /v1/batches/:id/submissions.</p></details>
  </>}
 </Panel>;
}
