import React,{useState,useRef} from 'react';
import {ArrowUpRight,ArrowRight,Check,Plus,ShieldCheck,Wallet,Lock,Send,RefreshCcw,Flag,X,Bot,CheckCheck} from 'lucide-react';
import {Button} from './main.jsx';
import {Panel,Empty,Modal} from './Dashboard.jsx';
import {tasks,batches,errorMessage} from './api.js';
import {useConfig,useLoader,date,SignInPrompt,ErrorNotice,TextAction,FundTransfer,StatusPill,ReviewStatus,TxLink,Countdown} from './LiveShared.jsx';
import {BATCH_STATUS,TASK_STATUS,PAYOUT_STATUS,TASK_TYPES,capitalize,validateBatchDraft,batchPayload,batchTotal,parseItems,hourlyRate,fromRaw} from './live.js';

const typeColor={judge:'green',verify:'blue',label:'pink',test:'yellow',other:'purple'};

export function LiveTasks({live,notify,client}){return client?<ClientBatches live={live} notify={notify}/>:<WorkerTasks live={live} notify={notify}/>}

function WorkerTasks({live,notify}){
 const{session}=live;const[tab,setTab]=useState('find'),[type,setType]=useState(''),[working,setWorking]=useState(null);
 const open=useLoader(()=>tasks.list(type),[type]);
 const mine=useLoader(()=>session?tasks.assignments(session.token):Promise.resolve(null),[session]);
 const active=mine.data?.filter(a=>a.status==='claimed'&&new Date(a.leaseUntil)>new Date())||[];
 async function claim(batch){if(!session)return live.signIn();try{const a=await tasks.claim(session.token,batch.id);setWorking({...a,title:batch.title,instructions:batch.instructions,pay:batch.pay,taskType:batch.taskType});open.reload()}catch(e){notify(errorMessage(e))}}
 return <>
  <div className="live-toolbar"><div className="market-tabs">{[['find','Find tasks'],['mine','My tasks']].map(([id,t])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{t}{id==='mine'&&active.length?<span className="tab-count">{active.length}</span>:null}</button>)}</div><div className="live-toolbar-actions"><button className="text-link" onClick={()=>{open.reload();mine.reload()}}><RefreshCcw size={14}/>Refresh</button></div></div>
  {tab==='find'&&<Panel title="Funded quick tasks" subtitle="Every batch is fully funded in USDG escrow before it lists, and pays at least 6 USDG per estimated hour." action={<div className="market-tabs">{['',...TASK_TYPES].map(t=><button key={t||'all'} className={type===t?'active':''} onClick={()=>setType(t)}>{t?capitalize(t):'All'}</button>)}</div>}>
   {open.error?<ErrorNotice message={open.error} onRetry={open.reload}/>:!open.data?<p className="live-loading">Loading tasks…</p>:open.data.length?<div className="work-table"><div className="work-row work-table-head"><span>Task</span><span>Pay</span><span>Estimated rate</span><span>Next step</span></div>{open.data.map(b=><div className="work-row" key={b.id}><div><b>{b.title}</b><span><span className={`type-dot ${typeColor[b.taskType]}`}/>{capitalize(b.taskType)} · {b.minutes} min · {b.available} left · {b.source==='agent'?'Agent request':`Client ${b.client.startsWith('@')?b.client:b.client.slice(0,8)+'…'}`}</span></div><strong>{b.pay}<small>USDG</small></strong><span className="mono">{b.hourlyRate}/h</span><button className="text-link" onClick={()=>claim(b)}>{session?'Claim a task':'Sign in to claim'}<ArrowUpRight size={15}/></button></div>)}</div>:<Empty title="No funded tasks right now" text="Funded batches appear here as soon as their escrow transfer is confirmed."/>}
  </Panel>}
  {tab==='mine'&&<Panel title="Your tasks" subtitle="Claimed, submitted and credited work. Credited pay is sent from the batch escrow to your wallet.">{!session?<SignInPrompt live={live} text="Sign in with your wallet to see your tasks."/>:mine.error?<ErrorNotice message={mine.error} onRetry={mine.reload}/>:!mine.data?<p className="live-loading">Loading your tasks…</p>:mine.data.length?<div className="work-table"><div className="work-row work-table-head"><span>Task</span><span>Pay</span><span>Status</span><span>Next step</span></div>{mine.data.map(a=><AssignmentRow key={a.id} a={a} session={session} notify={notify} onOpen={()=>setWorking(a)} onChanged={mine.reload}/>)}</div>:<Empty title="No tasks yet" text="Claim a funded task to get started." action={<button className="text-link" onClick={()=>setTab('find')}>Find tasks <ArrowUpRight size={14}/></button>}/>}</Panel>}
  <div className="inline-notice muted-notice"><ShieldCheck size={18}/><p>Skip any task without penalty. If the client doesn’t review your submission inside its window (at least 24 hours), it is credited by default. A rejection must include a reason, and you can send it to an independent reviewer.</p></div>
  {working&&<WorkModal assignment={working} session={session} notify={notify} onClose={()=>setWorking(null)} onDone={()=>{setWorking(null);mine.reload();open.reload()}}/>}
 </>;
}

function AssignmentRow({a,session,notify,onOpen,onChanged}){
 const open=a.status==='claimed'&&new Date(a.leaseUntil)>new Date();
 const[disputing,setDisputing]=useState(false);
 return <><div className="work-row"><div><b>{a.title} · item {a.itemPosition}</b><span>{capitalize(a.taskType)}{a.status==='submitted'&&a.reviewDueAt?` · credited by default ${date(a.reviewDueAt)}`:''}{a.payout?` · payout ${PAYOUT_STATUS[a.payout.status]?.[0].toLowerCase()}`:''}</span></div><strong>{a.pay}<small>USDG</small></strong><StatusPill map={TASK_STATUS} value={a.status==='claimed'&&!open?'released':a.status}/>{open?<button className="text-link" onClick={onOpen}>Continue<ArrowUpRight size={15}/></button>:a.status==='rejected'&&new Date(a.disputeDueAt)>new Date()?<button className="text-link" onClick={()=>setDisputing(!disputing)}><Flag size={14}/>Send to review</button>:a.payout?.transactionHash?<span className="field-note">Paid</span>:<span/>}</div>
  {a.status==='rejected'&&a.rejectionReason&&<div className="live-row-detail"><p><b>Client’s reason:</b> {a.rejectionReason}</p>{disputing&&<TextAction label="Why your answer meets the instructions" placeholder="An independent reviewer reads the instructions, your answer and this note." button="Send to review" min={10} onSubmit={async reason=>{try{await tasks.dispute(session.token,a.id,reason);notify('Sent to an independent reviewer.');onChanged()}catch(e){notify(errorMessage(e))}}}/>}</div>}
  {a.review&&<div className="live-row-detail"><ReviewStatus review={a.review}/></div>}</>;
}

function WorkModal({assignment:a,session,notify,onClose,onDone}){
 const[choice,setChoice]=useState(''),[answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const hasOptions=a.options?.length>0;
 async function run(fn,message){if(busy)return;setBusy(true);setError('');try{await fn();notify(message);onDone()}catch(e){setError(errorMessage(e));setBusy(false)}}
 return <Modal wide title={a.title||'Quick task'} onClose={onClose}><div className="dialog-body">
  <div className="detail-kicker"><StatusPill map={TASK_STATUS} value="claimed"/><Countdown until={a.leaseUntil} prefix="Claim expires in"/></div>
  {a.instructions&&<div className="task-instructions"><h4>Instructions</h4><p className="live-description">{a.instructions}</p></div>}
  <div className="task-prompt"><span className="mono">ITEM {a.itemPosition}</span><p className="live-description">{a.prompt}</p></div>
  <form className="live-text-action" onSubmit={e=>{e.preventDefault();run(()=>tasks.submit(session.token,a.id,hasOptions?{choice,answer:answer.trim()}:{answer:answer.trim()}),'Submitted. The client has at least 24 hours to review it.')}}>
   {hasOptions&&<fieldset className="live-outcome"><legend>Your answer</legend>{a.options.map(o=><label key={o} className={choice===o?'selected':''}><input type="radio" name="choice" checked={choice===o} onChange={()=>setChoice(o)}/>{o}</label>)}</fieldset>}
   <label className="form-field">{hasOptions?'Why · optional':'Your answer'}<textarea value={answer} onChange={e=>setAnswer(e.target.value)} maxLength={5000} placeholder={hasOptions?'A short reason helps if the client disagrees.':'Write your answer.'}/></label>
   {error&&<p className="form-error" role="alert">{error}</p>}
   <div className="dialog-actions"><Button type="button" className="small" variant="outline" disabled={busy} onClick={()=>run(()=>tasks.release(session.token,a.id),'Task released. No penalty applied.')}><X size={15}/>Skip task</Button><Button type="submit" className="small" disabled={busy||(hasOptions?!choice:!answer.trim())}><Send size={15}/>Submit · {a.pay} USDG</Button></div>
  </form>
 </div></Modal>;
}

function ClientBatches({live,notify}){
 const{session}=live;const{config}=useConfig();const[creating,setCreating]=useState(false),[selected,setSelected]=useState(null);
 const mine=useLoader(()=>session?batches.mine(session.token):Promise.resolve(null),[session]);
 return <>
  <div className="live-toolbar"><p className="field-note">Post Judge, Verify, Label or Test work in batches. Agents can post the same batches with an API key.</p><div className="live-toolbar-actions"><button className="text-link" onClick={mine.reload}><RefreshCcw size={14}/>Refresh</button><Button className="small" onClick={()=>session?setCreating(true):live.signIn()}><Plus size={15}/>New batch</Button></div></div>
  <Panel title="Your task batches" subtitle="Funding, progress and refunds for each batch.">{!session?<SignInPrompt live={live} text="Sign in with your wallet to post and manage task batches."/>:mine.error?<ErrorNotice message={mine.error} onRetry={mine.reload}/>:!mine.data?<p className="live-loading">Loading batches…</p>:mine.data.length?<div className="work-table"><div className="work-row work-table-head"><span>Batch</span><span>Total</span><span>Status</span><span>Next step</span></div>{mine.data.map(b=><div className="work-row" key={b.id}><div><b>{b.source==='agent'&&<Bot size={13}/>} {b.title}</b><span>{b.itemsCount} items × {b.workersPerItem} · {b.pay} USDG each · {b.credited}/{b.slots} credited{b.awaitingReview?` · ${b.awaitingReview} to review`:''}</span></div><strong>{b.total}<small>USDG</small></strong><StatusPill map={BATCH_STATUS} value={b.status}/><button className="text-link" onClick={()=>setSelected(b.id)}>{b.status==='awaiting_funding'?'Fund escrow':b.awaitingReview?'Review work':'Open'}<ArrowUpRight size={15}/></button></div>)}</div>:<Empty title="No batches yet" text="Create a batch, fund it, and it lists for workers immediately." action={<Button className="small" onClick={()=>setCreating(true)}><Plus size={15}/>New batch</Button>}/>}</Panel>
  {creating&&<CreateBatchModal session={session} config={config} onClose={()=>setCreating(false)} onCreated={b=>{setCreating(false);mine.reload();setSelected(b.id);notify('Batch created. Fund its escrow to list it.')}}/>}
  {selected&&<BatchModal id={selected} session={session} config={config} notify={notify} onClose={()=>{setSelected(null);mine.reload()}}/>}
 </>;
}

function CreateBatchModal({session,config,onClose,onCreated}){
 const[d,setD]=useState({title:'',instructions:'',taskType:'judge',pay:'',minutes:'2',workersPerItem:'1',reviewHours:'24',claimMinutes:'10',durationDays:'7',items:''}),[errors,setErrors]=useState({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);const set=(k,v)=>setD(s=>({...s,[k]:v}));
 const items=parseItems(d.items),total=batchTotal(d.pay,items.length,Number(d.workersPerItem)||0,config?.usdg.decimals??6),rate=hourlyRate(d.pay,d.minutes);
 async function submit(e){e.preventDefault();if(busy)return;const err=validateBatchDraft(d,{decimals:config?.usdg.decimals??6});setErrors(err);if(Object.keys(err).length)return;setBusy(true);setError('');try{onCreated(await batches.create(session.token,batchPayload(d)))}catch(e){setError(errorMessage(e));setBusy(false)}}
 const field=(k,label,props={})=><label className="form-field">{label}<input value={d[k]} onChange={e=>set(k,e.target.value)} {...props}/>{errors[k]&&<small className="form-error">{errors[k]}</small>}</label>;
 return <Modal wide title="New task batch" onClose={onClose}><form className="batch-form" onSubmit={submit} noValidate><div className="form-grid">
  <label className="form-field full">Batch title<input value={d.title} onChange={e=>set('title',e.target.value)} maxLength={160} placeholder="e.g. Pick the clearer support answer"/>{errors.title&&<small className="form-error">{errors.title}</small>}</label>
  <label className="form-field">Task type<select value={d.taskType} onChange={e=>set('taskType',e.target.value)}>{TASK_TYPES.map(t=><option key={t} value={t}>{capitalize(t)}</option>)}</select></label>
  {field('pay','Pay per task · USDG',{inputMode:'decimal',placeholder:'0.48'})}
  {field('minutes','Estimated minutes',{inputMode:'numeric'})}
  {field('workersPerItem','Workers per item',{inputMode:'numeric'})}
  {field('reviewHours','Review window · hours (min 24)',{inputMode:'numeric'})}
  {field('durationDays','Listing duration · days',{inputMode:'numeric'})}
  <label className="form-field full">Instructions<textarea value={d.instructions} onChange={e=>set('instructions',e.target.value)} maxLength={20000} placeholder="What workers should do, with an example of a good answer. No personal data."/>{errors.instructions&&<small className="form-error">{errors.instructions}</small>}</label>
  <label className="form-field full">Items · one per line, optional choices after “|”<textarea className="mono" value={d.items} onChange={e=>set('items',e.target.value)} placeholder={'Which answer explains rainbows better? | Answer A | Answer B\nIs this translation faithful? | Yes | No'}/><small>{items.length} item{items.length===1?'':'s'}.</small>{errors.items&&<small className="form-error">{errors.items}</small>}</label>
 </div><div className="inline-notice blue"><Lock size={19}/><p>{total?<>You’ll fund <b>{total} USDG</b> ({items.length} items × {d.workersPerItem||0} workers × {d.pay} USDG). Estimated rate: <b>{rate.toFixed(2)} USDG/hour</b>.</>:'Enter pay and items to see the total.'} Unused funds are refunded when the batch closes. Workers pay no fees.</p></div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" className="small" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" className="small" disabled={busy}>{busy?'Creating…':'Create batch'}<ArrowRight size={15}/></Button></div></form></Modal>;
}

function BatchModal({id,session,config,notify,onClose}){
 const batch=useLoader(()=>batches.get(session.token,id),[id]);
 const subs=useLoader(()=>batches.submissions(session.token,id),[id]);
 const busy=useRef(false);const[rejecting,setRejecting]=useState(null);
 const b=batch.data;const reload=()=>{batch.reload();subs.reload()};
 async function act(fn,message){if(busy.current)return;busy.current=true;try{await fn();notify(message);reload()}catch(e){notify(errorMessage(e))}finally{busy.current=false}}
 const toReview=subs.data?.filter(a=>a.status==='submitted')||[];
 return <Modal wide title={b?.title||'Task batch'} onClose={onClose}><div className="dialog-body">{!b?(batch.error?<ErrorNotice message={batch.error}/>:<p className="live-loading">Loading batch…</p>):<>
  <div className="detail-kicker"><StatusPill map={BATCH_STATUS} value={b.status}/><span>{b.itemsCount} items × {b.workersPerItem} workers · {b.pay} USDG each · {b.hourlyRate} USDG/h · review {b.reviewHours}h</span></div>
  {b.status==='awaiting_funding'&&<FundTransfer title="Fund this batch’s escrow" pendingKey={`gigwork-funding-batch-${b.id}`} amount={b.total} amountRaw={b.totalRaw} to={b.escrowAddress} token={b.tokenAddress} session={session} config={config} confirm={hash=>batches.fund(session.token,b.id,hash)} onDone={()=>{notify('Batch funded and listed for workers.');reload()}}/>}
  <div className="metric-grid three live-metrics"><div><span>Credited</span><b>{b.credited}/{b.slots}</b></div><div><span>Open slots</span><b>{b.status==='live'?b.available:0}</b></div><div><span>Closes</span><b>{b.expiresAt?date(b.expiresAt):'After funding'}</b></div></div>
  {b.refund?.length>0&&<div className="inline-notice blue"><Wallet size={18}/><p>Unused {fromRaw(b.refund[0].amountRaw,config?.usdg.decimals??6)} USDG refund · {b.refund[0].status==='complete'?<TxLink config={config} hash={b.refund[0].transactionHash}>refunded</TxLink>:'sending'}</p></div>}
  <div className="live-history"><h4>Submissions {toReview.length>0&&<Button className="small" onClick={()=>act(()=>batches.approveAll(session.token,b.id),`Approved ${toReview.length} submission${toReview.length>1?'s':''}.`)}><CheckCheck size={15}/>Approve all {toReview.length}</Button>}</h4>
   {subs.error?<ErrorNotice message={subs.error} onRetry={subs.reload}/>:!subs.data?<p className="live-loading">Loading…</p>:subs.data.length?<ol className="live-timeline">{subs.data.map(a=><li key={a.id} className={a.status==='rejected'||a.status==='disputed'?'revision':''}><span className="mono">ITEM {a.itemPosition} · {a.worker} · {TASK_STATUS[a.status]?.[0]}{a.reviewDueAt&&a.status==='submitted'?` · auto-credit ${date(a.reviewDueAt)}`:''}</span><p>{a.prompt}</p><b>{a.response?.choice||''}{a.response?.choice&&a.response?.answer?' — ':''}{a.response?.answer||''}</b>{a.status==='submitted'&&<div className="row-actions"><Button className="small" onClick={()=>act(()=>batches.approve(session.token,b.id,a.id),'Approved. The worker is being paid.')}><Check size={14}/>Approve</Button><Button className="small" variant="outline" onClick={()=>setRejecting(rejecting===a.id?null:a.id)}>Reject</Button></div>}{rejecting===a.id&&<TextAction label="Reason for rejecting" placeholder="Cite the instruction the answer misses. The worker can send this to an independent reviewer." button="Reject" variant="outline" min={10} onSubmit={reason=>act(()=>batches.reject(session.token,b.id,a.id,reason),'Rejected with your reason.').then(()=>setRejecting(null))}/>}{a.rejectionReason&&<p className="field-note">Your reason: {a.rejectionReason}</p>}{a.review&&<ReviewStatus review={a.review}/>}</li>)}</ol>:<p className="field-note">No submissions yet.</p>}
  </div>
  {['awaiting_funding','live'].includes(b.status)&&<div className="live-text-action"><p className="field-note">{b.status==='live'?'Closing stops new claims. Claimed and submitted work finishes normally, then the unused balance is refunded to your wallet.':'This batch is not funded. Closing cancels it.'}</p><Button className="small" variant="outline" onClick={()=>act(()=>batches.close(session.token,b.id),b.status==='live'?'Batch closing. Unused funds will be refunded.':'Batch cancelled.')}>{b.status==='live'?'Close batch':'Cancel batch'}</Button></div>}
  <p className="field-note">Escrow {b.escrowAddress}{b.fundingTransaction&&<> · <TxLink config={config} hash={b.fundingTransaction}>funding tx</TxLink></>}</p>
 </>}</div></Modal>;
}
