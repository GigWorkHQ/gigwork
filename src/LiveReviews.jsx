import React,{useState} from 'react';
import {ArrowUpRight,Gavel,RefreshCcw,Flag,UserPlus,Wallet,ExternalLink} from 'lucide-react';
import {Button} from './main.jsx';
import {Panel,Empty,Modal} from './Dashboard.jsx';
import {reviews,team,errorMessage} from './api.js';
import {useConfig,useLoader,date,SignInPrompt,ErrorNotice,Timeline,StatusPill,CopyButton,AddressLink} from './LiveShared.jsx';
import {TeamDisputes} from './LiveJobs.jsx';
import {REVIEW_STATUS} from './live.js';

const subjectLabel={job:'Job dispute',assignment:'Quick-task rejection',milestone:'Milestone dispute'};

function CaseTable({items,onOpen}){return <div className="work-table"><div className="work-row work-table-head"><span>Case</span><span>Opened</span><span>Status</span><span>Next step</span></div>{items.map(c=><div className="work-row" key={c.id}><div><b>{subjectLabel[c.subjectKind]}</b><span>{c.openedByClient?'Raised by the client':'Raised by the worker'}{c.dueAt?` · decision due ${date(c.dueAt)}`:''}{c.draws?` · draw ${c.draws}`:''}</span></div><span>{date(c.createdAt)}</span><StatusPill map={REVIEW_STATUS} value={c.status}/><button className="text-link" onClick={()=>onOpen(c.id)}>Review<ArrowUpRight size={15}/></button></div>)}</div>}

export function ReviewerQueue({live,notify}){
 const{session}=live;const[selected,setSelected]=useState(null);
 const queue=useLoader(()=>session?reviews.me(session.token):Promise.resolve(null),[session]);
 if(!session)return <Panel title="Reviews"><SignInPrompt live={live} text="Sign in with your reviewer wallet."/></Panel>;
 return <><Panel title="Cases assigned to you" subtitle={queue.data?`You have resolved ${queue.data.resolvedCount} case${queue.data.resolvedCount===1?'':'s'}. Cases are drawn at random after a delay, and you are never drawn for your own work.`:''} action={<button className="text-link" onClick={queue.reload}><RefreshCcw size={14}/>Refresh</button>}>
  {queue.error?<ErrorNotice message={queue.error} onRetry={queue.reload}/>:!queue.data?<p className="live-loading">Loading…</p>:!queue.data.isReviewer?<Empty title="Not a reviewer" text="The GigWork team adds independent reviewers. Ask them if you’d like to review disputes."/>:queue.data.assigned.length?<CaseTable items={queue.data.assigned} onOpen={setSelected}/>:<Empty title="No cases right now" text="New cases appear here when you are drawn. Each has a 72-hour deadline."/>}
 </Panel>{selected&&<CaseModal id={selected} load={()=>reviews.get(session.token,selected)} resolve={body=>reviews.resolve(session.token,selected,body)} notify={notify} onClose={()=>setSelected(null)} onResolved={()=>{setSelected(null);queue.reload()}}/>}</>;
}

export function TeamConsole({live,notify}){
 const{session}=live;const[tab,setTab]=useState('cases');
 if(!session)return <Panel title="Team"><SignInPrompt live={live} text="Sign in with a GigWork team wallet."/></Panel>;
 if(!live.isTeam)return <Panel title="Team"><Empty title="Team wallets only" text="This wallet is not on the GigWork team list."/></Panel>;
 return <><div className="market-tabs live-toolbar">{[['cases','Review cases'],['disputes','Job disputes'],['reviewers','Reviewers'],['vault','Bonus budget']].map(([id,t])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{t}</button>)}</div>
  {tab==='cases'&&<TeamCases session={session} notify={notify}/>}
  {tab==='disputes'&&<TeamDisputes live={live} notify={notify}/>}
  {tab==='reviewers'&&<Reviewers session={session} notify={notify}/>}
  {tab==='vault'&&<BonusVault session={session}/>}
 </>;
}

function TeamCases({session,notify}){
 const cases=useLoader(()=>team.reviews(session.token),[]);const[selected,setSelected]=useState(null);
 return <><Panel title="Open review cases" subtitle="Escalated cases need the team. The team can also step in on any open case." action={<button className="text-link" onClick={cases.reload}><RefreshCcw size={14}/>Refresh</button>}>{cases.error?<ErrorNotice message={cases.error} onRetry={cases.reload}/>:!cases.data?<p className="live-loading">Loading…</p>:cases.data.length?<CaseTable items={cases.data} onOpen={setSelected}/>:<Empty title="No open cases" text="Disputes and rejected tasks sent to review appear here."/>}</Panel>
 {selected&&<CaseModal id={selected} load={()=>team.review(session.token,selected)} resolve={body=>team.resolveReview(session.token,selected,body)} notify={notify} onClose={()=>setSelected(null)} onResolved={()=>{setSelected(null);cases.reload()}}/>}</>;
}

function Reviewers({session,notify}){
 const list=useLoader(()=>team.reviewers(session.token),[]);const[user,setUser]=useState(''),[busy,setBusy]=useState(false);
 async function add(e){e.preventDefault();if(busy||!user.trim())return;setBusy(true);try{await team.addReviewer(session.token,user.trim());notify('Reviewer added.');setUser('');list.reload()}catch(err){notify(errorMessage(err))}finally{setBusy(false)}}
 return <Panel title="Independent reviewers" subtitle="Cases are drawn at random from active reviewers, excluding the client and worker on the case.">
  <form className="share-bar" onSubmit={add}><input value={user} onChange={e=>setUser(e.target.value)} placeholder="@handle or 0x wallet" aria-label="Reviewer handle or wallet"/><Button type="submit" className="small" disabled={busy||!user.trim()}><UserPlus size={15}/>Add reviewer</Button></form>
  {list.error?<ErrorNotice message={list.error} onRetry={list.reload}/>:!list.data?<p className="live-loading">Loading…</p>:list.data.length?<div className="work-table">{list.data.map(r=><div className="work-row" key={r.userId}><div><b>{r.handle||r.wallet}</b><span className="mono">{r.wallet}</span></div><span>{r.assigned} open · {r.resolved} resolved</span><span>{r.active?'Active':'Inactive'}</span>{r.active?<button className="text-link" onClick={async()=>{try{await team.deactivateReviewer(session.token,r.userId);notify('Reviewer deactivated; their open cases will be redrawn.');list.reload()}catch(e){notify(errorMessage(e))}}}>Deactivate</button>:<button className="text-link" onClick={async()=>{try{await team.addReviewer(session.token,r.wallet);list.reload()}catch(e){notify(errorMessage(e))}}}>Reactivate</button>}</div>)}</div>:<Empty title="No reviewers yet" text="Without reviewers, every case goes straight to the team."/>}
 </Panel>;
}

function BonusVault({session}){
 const{config}=useConfig();const vault=useLoader(()=>team.bonusVault(session.token),[]);const v=vault.data;
 return <Panel title="Referral bonus budget" subtitle="A separate escrow wallet that pays referral bonuses. It never touches client escrow. Fund it by sending USDG to its address." action={<button className="text-link" onClick={vault.reload}><RefreshCcw size={14}/>Refresh</button>}>
  {vault.error?<ErrorNotice message={vault.error} onRetry={vault.reload}/>:!v?<p className="live-loading">Loading…</p>:<><div className="metric-grid three live-metrics"><div><span>Balance</span><b>{v.balance??'—'} USDG</b></div><div><span>Available</span><b>{v.available??'—'} USDG</b></div><div><span>Paid out</span><b>{v.paid} USDG · {v.paidCount}</b></div></div><div className="handle-current"><Wallet size={18}/><AddressLink config={config} address={v.address}/><CopyButton text={v.address} label="Copy address"/></div></>}
 </Panel>;
}

function CaseModal({id,load,resolve,notify,onClose,onResolved}){
 const data=useLoader(load,[id]);const[outcome,setOutcome]=useState(''),[share,setShare]=useState('50'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const d=data.data,s=d?.subject;
 async function submit(e){e.preventDefault();if(busy||!outcome||!note.trim())return;setBusy(true);setError('');try{await resolve({outcome,note:note.trim(),...(outcome==='split'?{workerShareBps:Math.round(Number(share)*100)}:{})});notify('Case resolved. Escrow settlement has started.');onResolved()}catch(err){setError(errorMessage(err));setBusy(false)}}
 return <Modal wide title={s?.title||'Review case'} onClose={onClose}><div className="dialog-body">{!d?(data.error?<ErrorNotice message={data.error}/>:<p className="live-loading">Loading case…</p>):<>
  <div className="detail-kicker"><StatusPill map={REVIEW_STATUS} value={d.case.status}/><span>{subjectLabel[d.case.subjectKind]} · {s.amount} USDG · client {s.client} · worker {s.worker}</span></div>
  <div className="task-instructions"><h4>Brief</h4><p className="live-description">{s.brief}</p>{s.criteria&&<ul>{s.criteria.map(c=><li key={c}>{c}</li>)}</ul>}</div>
  <div className="inline-notice coral"><Flag size={18}/><p><b>{d.case.openedByClient?'Client':'Worker'}’s reason</b><br/>{d.reason}</p></div>
  {s.kind==='assignment'&&<div className="live-history"><h4>Item</h4><p className="live-description">{s.prompt}</p>{s.options?.length>0&&<p className="field-note">Options: {s.options.join(' · ')}</p>}<h4>Worker’s answer</h4><p><b>{s.response?.choice}</b>{s.response?.answer?` — ${s.response.answer}`:''}</p>{s.rejectionReason&&<><h4>Client’s rejection</h4><p>{s.rejectionReason}</p></>}</div>}
  {s.kind==='job'&&<div className="live-history"><h4>Submissions & feedback</h4><Timeline submissions={s.submissions} revisions={s.revisions}/></div>}
  {s.kind==='milestone'&&<div className="live-history"><h4>Deliveries & feedback</h4>{s.thread?.length?<ol className="live-timeline">{s.thread.map((t,i)=><li key={i} className={t.type==='feedback'?'revision':''}><span className="mono">{t.type==='submission'?'DELIVERY':'CHANGES REQUESTED'} · {date(t.at)}</span>{t.type==='submission'?<><b>{t.summary}</b><pre className="live-deliverable">{t.deliverable}</pre>{t.evidence?.map(u=><a key={u} href={u} target="_blank" rel="noreferrer noopener">{u}<ExternalLink size={12}/></a>)}</>:<p>{t.text}</p>}</li>)}</ol>:<p className="field-note">Nothing was delivered.</p>}</div>}
  {d.case.status==='resolved'?<div className="inline-notice blue"><Gavel size={18}/><p>Resolved: {d.case.resolution}. {d.note}</p></div>:<form className="live-text-action" onSubmit={submit}><fieldset className="live-outcome"><legend>Decision</legend>
   <label className={outcome==='pay_worker'?'selected':''}><input type="radio" name="outcome" checked={outcome==='pay_worker'} onChange={()=>setOutcome('pay_worker')}/>Pay the worker {s.amount} USDG</label>
   <label className={outcome==='refund_client'?'selected':''}><input type="radio" name="outcome" checked={outcome==='refund_client'} onChange={()=>setOutcome('refund_client')}/>{s.kind==='assignment'?'Uphold the rejection (not paid)':`Refund the client ${s.amount} USDG`}</label>
   {d.allowsSplit&&<label className={outcome==='split'?'selected':''}><input type="radio" name="outcome" checked={outcome==='split'} onChange={()=>setOutcome('split')}/>Split: worker gets <input className="split-input" inputMode="decimal" value={share} onChange={e=>setShare(e.target.value.replace(/[^\d.]/g,''))} onFocus={()=>setOutcome('split')}/>%</label>}
  </fieldset><label className="form-field">Decision note<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={10000} placeholder="Explain the decision against the brief."/></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" className="small" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" className="small" disabled={busy||!outcome||!note.trim()}><Gavel size={15}/>{busy?'Resolving…':'Resolve and settle'}</Button></div></form>}
 </>}</div></Modal>;
}
