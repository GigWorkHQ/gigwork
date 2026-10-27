import React,{useState,useEffect,useCallback,useRef} from 'react';
import {ArrowUpRight,ArrowRight,Check,Plus,ShieldCheck,Clock,Wallet,Lock,RefreshCcw,LogIn,LogOut,Flag,Gavel,FileText,Calendar} from 'lucide-react';
import {Button,Pill} from './main.jsx';
import './live.css';
import {Panel,Empty,Modal} from './Dashboard.jsx';
import {auth,jobs,team,account,readSession,saveSession,errorMessage,SESSION_EXPIRED} from './api.js';
import {connectWallet,signMessage,shortAddress,onWalletChange,hasWallet} from './wallet.js';
import {availableActions,roleIn,statusLabel,statusColor,validateJobDraft,jobPayload,lines} from './live.js';
import {useConfig,date,SignInPrompt,ErrorNotice,TextAction,SubmitWork,Timeline,FundTransfer,TipPanel,ReviewStatus} from './LiveShared.jsx';
export {useConfig,Timeline} from './LiveShared.jsx';

export const JobStatus=({value})=><Pill color={statusColor(value)}>{['ready','completed'].includes(value)&&<Check size={11}/>}{statusLabel(value)}</Pill>;


// Wallet sign-in: request a nonce, sign the exact server message, then verify.
export function useLiveSession(notifyFn){
 const notifyRef=useRef(notifyFn);notifyRef.current=notifyFn;const notify=useCallback(m=>notifyRef.current(m),[]);
 const[session,setSession]=useState(readSession),[busy,setBusy]=useState(false),[profile,setProfile]=useState(null);const isTeam=Boolean(profile?.isTeam),isReviewer=Boolean(profile?.isReviewer);
 const signOut=useCallback(async(quiet=false)=>{const current=readSession();saveSession(null);setSession(null);setProfile(null);if(current)await auth.logout(current.token).catch(()=>{});if(!quiet)notify('Signed out.')},[notify]);
 useEffect(()=>{const expired=()=>{setSession(null);setProfile(null);notify('Your session ended. Sign in again to continue.')};window.addEventListener(SESSION_EXPIRED,expired);return()=>window.removeEventListener(SESSION_EXPIRED,expired)},[notify]);
 useEffect(()=>onWalletChange(accounts=>{if(session&&accounts[0]?.toLowerCase()!==session.walletAddress){signOut(true);notify('Wallet account changed. Sign in with the new account to continue.')}}),[session,signOut,notify]);
 const refreshProfile=useCallback(async()=>{const current=readSession();if(!current){setProfile(null);return}try{setProfile(await account.me(current.token))}catch{setProfile(null)}},[]);
 useEffect(()=>{refreshProfile()},[session,refreshProfile]);
 async function signIn(){if(busy)return;setBusy(true);try{const address=await connectWallet();const challenge=await auth.nonce(address);const signature=await signMessage(address,challenge.message);const s=await auth.verify(address,challenge.nonce,signature);saveSession(s);setSession(s);notify(`Signed in as ${shortAddress(s.walletAddress)}.`)}catch(e){notify(errorMessage(e))}finally{setBusy(false)}}
 return {session,busy,isTeam,isReviewer,profile,refreshProfile,signIn,signOut};
}

export function WalletButton({live}){const{session,busy,signIn,signOut}=live;return session?<div className="wallet-chip"><span className="wallet-dot"/><b title={session.walletAddress}>{live.profile?.handle||shortAddress(session.walletAddress)}</b><button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={()=>signOut()}><LogOut size={15}/></button></div>:<Button className="small wallet-signin" disabled={busy} onClick={signIn} title={hasWallet()?'Sign in with your wallet':'Install a browser wallet to sign in'}><LogIn size={15}/>{busy?'Check your wallet…':'Sign in'}</Button>}


function JobTable({items,wallet,onOpen}){return <div className="work-table"><div className="work-row work-table-head"><span>Job</span><span>Pay</span><span>Status</span><span>Next step</span></div>{items.map(j=>{const role=roleIn(j,wallet);return <div className="work-row" key={j.id}><div><b>{j.title}</b><span>{role==='client'?'You hired':role==='doer'?'You’re doing this':`Client ${shortAddress(j.clientWallet)}`}{j.deadlineAt?` · Due ${date(j.deadlineAt)}`:''}</span></div><strong>{j.amount}<small>USDG</small></strong><JobStatus value={j.status}/><button className="text-link" onClick={()=>onOpen(j)}>{role==='client'&&j.status==='awaiting_funding'?'Fund escrow':j.status==='ready'&&role!=='client'?'View & claim':'View details'}<ArrowUpRight size={15}/></button></div>})}</div>}

export function LiveJobs({live,notify}){
 const{session}=live;const{config,configError}=useConfig();
 const[tab,setTab]=useState(session?'mine':'open'),[open,setOpen]=useState({items:[],page:0,more:true,loading:false,error:''}),[mine,setMine]=useState({items:null,loading:false,error:''}),[selected,setSelected]=useState(null),[creating,setCreating]=useState(false);
 const loadOpen=useCallback(async(page=1)=>{setOpen(s=>({...s,loading:true,error:''}));try{const r=await jobs.ready(page,30);setOpen(s=>({items:page===1?r.data:[...s.items,...r.data.filter(j=>!s.items.some(x=>x.id===j.id))],page,more:r.data.length===r.limit,loading:false,error:''}))}catch(e){setOpen(s=>({...s,loading:false,error:errorMessage(e)}))}},[]);
 const loadMine=useCallback(async()=>{if(!session)return;setMine(s=>({...s,loading:true,error:''}));try{setMine({items:await jobs.mine(session.token),loading:false,error:''})}catch(e){setMine(s=>({...s,loading:false,error:errorMessage(e)}))}},[session]);
 useEffect(()=>{loadOpen(1)},[loadOpen]);
 useEffect(()=>{if(session)loadMine();else{setMine({items:null,loading:false,error:''});setTab('open')}},[session,loadMine]);
 const refresh=()=>{loadOpen(1);loadMine()};
 const counts=mine.items?{active:mine.items.filter(j=>!['completed','refunded','expired','cancelled'].includes(j.status)).length,funding:mine.items.filter(j=>j.status==='awaiting_funding'&&roleIn(j,session?.walletAddress)==='client').length}:null;
 return <>
  <div className="live-toolbar"><div className="market-tabs">{[['open','Open jobs'],['mine','My jobs']].map(([id,t])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{t}{id==='mine'&&counts?.active?<span className="tab-count">{counts.active}</span>:null}</button>)}</div><div className="live-toolbar-actions"><button className="text-link" onClick={refresh}><RefreshCcw size={14}/>Refresh</button><Button className="small" onClick={()=>session?setCreating(true):live.signIn()} disabled={live.busy}><Plus size={15}/>Post a job</Button></div></div>
  {configError&&<ErrorNotice message={`Network settings could not be loaded: ${configError}`}/>}
  {counts?.funding>0&&tab==='mine'&&<div className="inline-notice yellow"><Wallet size={19}/><p>{counts.funding} of your job{counts.funding>1?'s are':' is'} waiting for USDG funding. Workers can only see a job after its escrow is funded and confirmed.</p></div>}
  {tab==='open'&&<Panel title="Funded jobs" subtitle={`Every job here has its full pay locked in USDG escrow on ${config?.chainName||'Robinhood Chain'}.`}>{open.error?<ErrorNotice message={open.error} onRetry={()=>loadOpen(1)}/>:open.items.length?<><JobTable items={open.items} wallet={session?.walletAddress} onOpen={setSelected}/>{open.more&&<div className="live-more"><Button className="small" variant="outline" disabled={open.loading} onClick={()=>loadOpen(open.page+1)}>{open.loading?'Loading…':'Load more'}</Button></div>}</>:open.loading?<p className="live-loading">Loading funded jobs…</p>:<Empty title="No funded jobs right now" text="New jobs appear here as soon as their escrow funding is confirmed on-chain." action={<Button className="small" onClick={()=>session?setCreating(true):live.signIn()}><Plus size={15}/>Post the first job</Button>}/>}</Panel>}
  {tab==='mine'&&<Panel title="Jobs you hired for or are doing" subtitle="Your most recent 100 jobs, newest activity first.">{!session?<SignInPrompt live={live} text="Sign in with your wallet to see jobs you posted or claimed."/>:mine.error?<ErrorNotice message={mine.error} onRetry={loadMine}/>:mine.items?.length?<JobTable items={mine.items} wallet={session.walletAddress} onOpen={setSelected}/>:mine.loading||!mine.items?<p className="live-loading">Loading your jobs…</p>:<Empty title="No jobs yet" text="Post a job, or claim a funded one from Open jobs." action={<button className="text-link" onClick={()=>setTab('open')}>Browse open jobs <ArrowUpRight size={14}/></button>}/>}</Panel>}
  <div className="inline-notice muted-notice"><ShieldCheck size={18}/><p>Clients fund each job by sending its exact USDG amount to a dedicated escrow address. Accepted work is paid from escrow; if the client stays silent past the review window, it is approved by default. Disputes go to an independent reviewer.</p></div>
  {creating&&<CreateJobModal session={session} config={config} onClose={()=>setCreating(false)} onCreated={job=>{setCreating(false);setTab('mine');loadMine();setSelected(job);notify('Job created. Fund its escrow to publish it.')}}/>}
  {selected&&<JobModal initial={selected} live={live} config={config} notify={notify} onClose={()=>setSelected(null)} onChanged={refresh}/>}
 </>;
}

function CreateJobModal({session,config,onClose,onCreated}){
 const[d,setD]=useState({title:'',description:'',criteria:'',amount:'',deadline:''}),[errors,setErrors]=useState({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);const set=(k,v)=>setD(s=>({...s,[k]:v}));
 async function submit(e){e.preventDefault();if(busy)return;const err=validateJobDraft(d,{decimals:config?.usdg.decimals??6});setErrors(err);if(Object.keys(err).length)return;setBusy(true);setError('');try{onCreated(await jobs.create(session.token,jobPayload(d)))}catch(e){setError(errorMessage(e));setBusy(false)}}
 return <Modal wide title="Post a funded job" onClose={onClose}><form className="batch-form" onSubmit={submit} noValidate><div className="form-grid">
  <label className="form-field full">Job title<input value={d.title} onChange={e=>set('title',e.target.value)} maxLength={160} placeholder="e.g. Clean up and vectorize our logo"/>{errors.title&&<small className="form-error">{errors.title}</small>}</label>
  <label className="form-field full">Description<textarea value={d.description} onChange={e=>set('description',e.target.value)} maxLength={20000} placeholder="What needs doing, the context, and what you will provide."/>{errors.description&&<small className="form-error">{errors.description}</small>}</label>
  <label className="form-field full">Acceptance criteria · one per line<textarea value={d.criteria} onChange={e=>set('criteria',e.target.value)} placeholder={'SVG and PNG exports\nTransparent background'}/><small>{lines(d.criteria).length}/20 criteria. Workers are paid when the work meets these.</small>{errors.criteria&&<small className="form-error">{errors.criteria}</small>}</label>
  <label className="form-field">Pay · USDG<input inputMode="decimal" value={d.amount} onChange={e=>set('amount',e.target.value.replace(/[^\d.]/g,''))} placeholder="0.00"/>{errors.amount&&<small className="form-error">{errors.amount}</small>}</label>
  <label className="form-field">Deadline · optional<input type="datetime-local" value={d.deadline} onChange={e=>set('deadline',e.target.value)}/>{errors.deadline&&<small className="form-error">{errors.deadline}</small>}</label>
 </div><div className="inline-notice blue"><Lock size={19}/><p>Creating the job does not move funds. Next, you send exactly {d.amount&&!errors.amount?`${d.amount} USDG`:'the listed USDG amount'} from {shortAddress(session.walletAddress)} to the job’s escrow address. The job is listed once that transfer is confirmed.</p></div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" className="small" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" className="small" disabled={busy}>{busy?'Creating…':'Create job'}<ArrowRight size={15}/></Button></div></form></Modal>;
}

function FundPanel({job,session,config,onFunded,notify}){return <FundTransfer title="Fund this job’s escrow" pendingKey={`gigwork-funding-${job.id}`} amount={job.amount} amountRaw={job.amountRaw} to={job.escrowAddress} token={job.tokenAddress} session={session} config={config} confirm={hash=>jobs.fund(session.token,job.id,hash)} onDone={()=>{notify('Escrow funded. Your job is now open to workers.');onFunded()}}/>}




function JobModal({initial,live,config,notify,onClose,onChanged}){
 const{session}=live;const[job,setJob]=useState(initial),[history,setHistory]=useState(null),[error,setError]=useState('');const busyRef=useRef(false);
 const wallet=session?.walletAddress;const role=roleIn(job,wallet);const can=availableActions(job,wallet);
 const reload=useCallback(async()=>{if(!session)return;try{const fresh=await jobs.get(session.token,initial.id);setJob(fresh);setError('');const acts=availableActions(fresh,session.walletAddress);if(acts.history){const[submissions,revisions]=await Promise.all([jobs.submissions(session.token,fresh.id),jobs.revisions(session.token,fresh.id)]);setHistory({submissions,revisions})}}catch(e){setError(errorMessage(e))}},[session,initial.id]);
 useEffect(()=>{reload()},[reload]);
 async function act(fn,message){if(busyRef.current)return;busyRef.current=true;setError('');try{await fn();notify(message);await reload();onChanged()}catch(e){setError(errorMessage(e))}finally{busyRef.current=false}}
 return <Modal wide title="Job details" onClose={onClose}><div className="task-detail-body"><div className="task-detail-main">
  <div className="detail-kicker"><JobStatus value={job.status}/><span>{role==='client'?'You hired':role==='doer'?'You’re doing this':`Client ${shortAddress(job.clientWallet)}`}</span></div>
  <h3>{job.title}</h3><p className="live-description">{job.description}</p>
  <div className="task-instructions"><h4>Acceptance criteria</h4><ul>{job.acceptanceCriteria.map(c=><li key={c}>{c}</li>)}</ul></div>
  {error&&<ErrorNotice message={error}/>}
  {!session&&job.status==='ready'&&<SignInPrompt live={live} text="Sign in with your wallet to claim this job."/>}
  {can.fund&&<FundPanel job={job} session={session} config={config} notify={notify} onFunded={()=>{reload();onChanged()}}/>}
  {can.claim&&<div className="inline-notice green"><ShieldCheck size={19}/><p>The full {job.amount} USDG is already in escrow. Claiming assigns this job to you alone.</p><Button className="small" onClick={()=>act(()=>jobs.claim(session.token,job.id),'Job claimed. Submit your work when it is ready.')}>Claim this job<ArrowRight size={15}/></Button></div>}
  {job.status==='revision_requested'&&role==='doer'&&<div className="inline-notice yellow"><RefreshCcw size={18}/><p>The client asked for changes. Read their feedback below, then submit an updated version.</p></div>}
  {can.submit&&<SubmitWork onSubmit={body=>act(()=>jobs.submit(session.token,job.id,body),'Work submitted for client review.')}/>}
  {can.review&&<div className="live-review"><h4><FileText size={16}/>Review the submission</h4><p>Accepting starts the on-chain payout of {job.amount} USDG to the worker. This cannot be undone.</p><Button className="small" onClick={()=>act(()=>jobs.accept(session.token,job.id),'Work accepted. The payout is being sent from escrow.')}><Check size={15}/>Accept and pay</Button><TextAction label="Or request changes" placeholder="Explain what needs to change, referencing the criteria." button="Request changes" variant="outline" onSubmit={feedback=>act(()=>jobs.requestRevision(session.token,job.id,feedback),'Change request sent to the worker.')}/></div>}
  {history&&<div className="live-history"><h4>Submissions & feedback</h4><Timeline {...history}/></div>}
  {job.status==='submitted'&&job.reviewDueAt&&<div className="inline-notice blue"><Clock size={18}/><p>{role==='client'?'Accept, request changes or dispute':'If the client does not respond'} by {date(job.reviewDueAt)}{role==='client'?'. After that the work is approved and paid by default.':', the work is approved and paid automatically.'}</p></div>}
  {role==='client'&&['awaiting_funding','ready'].includes(job.status)&&<div className="live-text-action"><p className="field-note">{job.status==='ready'?`No one has claimed this job yet. Cancelling refunds the full ${job.amount} USDG from escrow to your wallet.`:'This job has not been funded. Cancelling removes it.'}</p><Button className="small" variant="outline" onClick={()=>act(()=>jobs.cancel(session.token,job.id),job.status==='ready'?'Job cancelled. The refund is being sent from escrow.':'Job cancelled.')}>{job.status==='ready'?'Cancel and refund':'Cancel job'}</Button></div>}
  {role==='client'&&job.status==='in_progress'&&job.deadlineAt&&Date.now()>new Date(job.deadlineAt).getTime()+72*3600000&&<div className="inline-notice yellow"><Clock size={18}/><p>The deadline passed more than 72 hours ago with no submission. You can cancel and get a refund.</p><Button className="small" variant="outline" onClick={()=>act(()=>jobs.cancel(session.token,job.id),'Overdue job cancelled. The refund is being sent.')}>Cancel and refund</Button></div>}
  {job.status==='settlement_pending'&&<div className="inline-notice blue"><Clock size={18}/><p>The payout transaction is being sent and confirmed. This usually takes a few minutes.</p></div>}
  {job.review?<ReviewStatus review={job.review}/>:job.status==='disputed'&&<div className="inline-notice coral"><Gavel size={18}/><p>This job is in dispute. It will be reviewed and either the worker is paid or the client refunded from escrow.</p></div>}
  {role==='client'&&job.status==='completed'&&<TipPanel session={session} config={config} subjectKind="job" subjectId={job.id} notify={notify}/>}
  {can.dispute&&<details className="live-dispute"><summary><Flag size={14}/>Open a dispute</summary><TextAction label="Reason" placeholder="Explain the problem against the acceptance criteria. An independent reviewer decides." button="Open dispute" variant="outline" min={10} onSubmit={reason=>act(()=>jobs.dispute(session.token,job.id,reason),'Dispute opened. An independent reviewer will be drawn.')}/></details>}
 </div><aside className="task-detail-aside"><span className="mono">PAY FOR THIS JOB</span><strong>{job.amount}<small>USDG</small></strong><p>Held in this job’s escrow until accepted or resolved.</p><div className="detail-facts"><span><Wallet size={14}/>Escrow <b className="mono">{config?<a href={`${config.explorerUrl}/address/${job.escrowAddress}`} target="_blank" rel="noreferrer">{shortAddress(job.escrowAddress)}</a>:shortAddress(job.escrowAddress)}</b></span>{job.fundingTransaction&&<span><ShieldCheck size={14}/>Funded <b>{config?<a href={`${config.explorerUrl}/tx/${job.fundingTransaction}`} target="_blank" rel="noreferrer">View tx</a>:'Yes'}</b></span>}<span><Clock size={14}/>Deadline <b>{job.deadlineAt?date(job.deadlineAt):'None'}</b></span><span><Calendar size={14}/>Posted <b>{date(job.createdAt)}</b></span>{job.doerWallet&&<span><Check size={14}/>Worker <b className="mono">{shortAddress(job.doerWallet)}</b></span>}{job.revisionCount>0&&<span><RefreshCcw size={14}/>Revisions <b>{job.revisionCount}</b></span>}</div><div className="small-safe"><ShieldCheck/><p>No worker fees. Funds move only by escrow settlement.</p></div></aside></div></Modal>;
}

export function TeamDisputes({live,notify}){
 const{session}=live;const{config}=useConfig();const[items,setItems]=useState(null),[error,setError]=useState(''),[selected,setSelected]=useState(null);
 const load=useCallback(async()=>{if(!session)return;setError('');try{setItems(await team.disputes(session.token))}catch(e){setError(errorMessage(e))}},[session]);
 useEffect(()=>{load()},[load]);
 if(!session)return <Panel title="Team disputes"><SignInPrompt live={live} text="Sign in with a GigWork team wallet to review disputes."/></Panel>;
 if(!live.isTeam)return <Panel title="Team disputes"><Empty title="Team wallets only" text="This wallet is not on the GigWork team list."/></Panel>;
 return <><Panel title="Active disputes" subtitle="Review the submissions and history, then pay the worker or refund the client from escrow." action={<button className="text-link" onClick={load}><RefreshCcw size={14}/>Refresh</button>}>{error?<ErrorNotice message={error} onRetry={load}/>:!items?<p className="live-loading">Loading disputes…</p>:items.length?<JobTable items={items} wallet={session.walletAddress} onOpen={j=>setSelected(j.id)}/>:<Empty title="No open disputes" text="Disputed jobs will appear here."/>}</Panel>{selected&&<DisputeModal id={selected} session={session} config={config} notify={notify} onClose={()=>setSelected(null)} onResolved={()=>{setSelected(null);load()}}/>}</>;
}

function DisputeModal({id,session,config,notify,onClose,onResolved}){
 const[data,setData]=useState(null),[error,setError]=useState(''),[outcome,setOutcome]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{team.dispute(session.token,id).then(setData).catch(e=>setError(errorMessage(e)))},[id,session]);
 async function resolve(e){e.preventDefault();if(busy||!outcome||!note.trim())return;setBusy(true);setError('');try{await team.resolve(session.token,id,outcome,note.trim());notify(outcome==='pay_doer'?'Resolved: paying the worker from escrow.':'Resolved: refunding the client from escrow.');onResolved()}catch(e){setError(errorMessage(e));setBusy(false)}}
 return <Modal wide title="Resolve dispute" onClose={onClose}><div className="dialog-body">{!data?(error?<ErrorNotice message={error}/>:<p className="live-loading">Loading dispute…</p>):<>
  <div className="detail-kicker"><JobStatus value={data.job.status}/><span>{data.job.amount} USDG · client {shortAddress(data.job.clientWallet)} · worker {shortAddress(data.job.doerWallet)}</span></div>
  <h3>{data.job.title}</h3><p className="live-description">{data.job.description}</p>
  <div className="task-instructions"><h4>Acceptance criteria</h4><ul>{data.job.acceptanceCriteria.map(c=><li key={c}>{c}</li>)}</ul></div>
  <div className="inline-notice coral"><Flag size={18}/><p><b>Dispute opened {date(data.dispute.createdAt)}</b><br/>{data.dispute.reason}</p></div>
  <div className="live-history"><h4>Submissions & feedback</h4><Timeline submissions={data.submissions} revisions={data.revisions}/></div>
  <details className="live-dispute"><summary>Event history ({data.events.length})</summary><ol className="live-events">{data.events.map((ev,i)=><li key={i}><span className="mono">{date(ev.created_at)}</span>{ev.event_type}</li>)}</ol></details>
  {config&&<p className="field-note">Escrow <a href={`${config.explorerUrl}/address/${data.job.escrowAddress}`} target="_blank" rel="noreferrer">{data.job.escrowAddress}</a></p>}
  <form className="live-text-action" onSubmit={resolve}><fieldset className="live-outcome"><legend>Outcome</legend><label className={outcome==='pay_doer'?'selected':''}><input type="radio" name="outcome" checked={outcome==='pay_doer'} onChange={()=>setOutcome('pay_doer')}/>Pay the worker {data.job.amount} USDG</label><label className={outcome==='refund_client'?'selected':''}><input type="radio" name="outcome" checked={outcome==='refund_client'} onChange={()=>setOutcome('refund_client')}/>Refund the client {data.job.amount} USDG</label></fieldset><label className="form-field">Resolution note<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={10000} placeholder="Explain the decision against the acceptance criteria."/></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" className="small" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" className="small" disabled={busy||!outcome||!note.trim()}><Gavel size={15}/>{busy?'Resolving…':'Resolve and settle'}</Button></div></form>
 </>}</div></Modal>;
}
