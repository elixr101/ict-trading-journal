import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const INSTRUMENTS = ["NQ","ES","GC","MNQ","MES","MGC"];
const SESSIONS = ["Asia","London","NY AM","NY Lunch","NY PM"];
const CATEGORIZED_ICT_CONCEPTS = { "Price Action & Structure": ["BOS", "CHOCH", "MSS", "Displacement", "Liquidity Sweep", "CE of Range"], "PD Arrays & Blocks": ["FVG", "IFVG", "OB", "Breaker Block", "Mitigation Block", "Propulsion Block", "PD Array", "NWOG/NDOG"], "Advanced": ["SMT Divergence", "STDV", "Volume Profile"] };
const ICT_CONCEPTS = Object.values(CATEGORIZED_ICT_CONCEPTS).flat();
const DEFAULT_MODELS = ["Silver Bullet", "ICT 2022 Model", "Turtle Soup", "Judas Swing", "AMD", "NYO Model", "London Sweep", "Market Maker Model", "Optimal Trade Entry"];
const EMOTIONS = ["Confident","Patient","Calm","Disciplined","Focused","Fearful","FOMO","Revenge","Anxious","Greedy","Frustrated","Overconfident","Hesitant"];
const NEGATIVE_EMOTIONS = ["Fearful","FOMO","Revenge","Anxious","Greedy","Frustrated","Overconfident","Hesitant"];
const TRADE_GRADES = ["A+","A","B","C","D","F"];
const MISTAKES = ["Moved Stop","No Confirmation","Oversized","Revenge Trade","Traded Outside Killzone","Chased Entry","Ignored HTF Bias","Early Exit","No Pre-Trade Plan","Broke Daily Loss Rule","Traded During News","Widened Stop","Averaged Down"];
const FIRMS = ["Topstep","Apex","MyFundedFutures","Take Profit Trader","Lucid","Alpha Futures","Funded Next","Other"];
const PHASES = ["Evaluation","Combine","Funded","PA (Performance Account)"];
const TIMEFRAMES = ["1m","5m","15m","1H","4H","Daily","Weekly"];
const RULE_CHECKLIST = ["Identified HTF draw on liquidity","Waited for killzone","Confirmed with LTF entry model","Risk within 1-2% of account","Set stop beyond PD array","Defined target before entry","Checked news calendar"];
const PV = {NQ:20,ES:50,GC:100,MNQ:2,MES:5,MGC:10};

// ─── SQL ADDITIONS NEEDED IN SUPABASE ────────────────────────────────────────
// Run these in Supabase SQL Editor:
// ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text DEFAULT '';
// ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text DEFAULT '';
// Also create a Storage bucket named 'avatars' with public access for pfp uploads

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function calcRR(en,st,ex,dir){const e=parseFloat(en),s=parseFloat(st),x=parseFloat(ex);if(isNaN(e)||isNaN(s)||isNaN(x)||e===s)return"";return((dir==="Long"?x-e:e-x)/Math.abs(e-s)).toFixed(2)+"R";}
function calcPnl(en,ex,c,ins,dir){const e=parseFloat(en),x=parseFloat(ex),ct=parseInt(c);if(isNaN(e)||isNaN(x)||isNaN(ct))return 0;return parseFloat(((dir==="Long"?x-e:e-x)*ct*(PV[ins]||1)).toFixed(2));}
function useIsMobile(){const[w,setW]=useState(typeof window!=="undefined"?window.innerWidth:1200);useEffect(()=>{const h=()=>setW(window.innerWidth);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);return{isMobile:w<640,isTablet:w<1024};}

function dbToTrade(r){return{id:r.id,date:r.date,time:r.time||"",instrument:r.instrument,session:r.session,direction:r.direction,contracts:r.contracts,entry:r.entry,stop:r.stop,target:r.target,exit:r.exit_price,pnl:Number(r.pnl),rr:r.rr,grade:r.grade,ictConcepts:r.ict_concepts||[],emotions:r.emotions||["Calm"],mistakes:r.mistakes||[],rulesFollowed:r.rules_followed||[],htfBias:r.htf_bias,ltfEntry:r.ltf_entry,drawOnLiquidity:r.draw_on_liquidity,entryModel:r.entry_model,confluenceScore:Number(r.confluence_score),preTradeNarrative:r.pre_trade_narrative,postTradeReview:r.post_trade_review,partials:r.partials,notes:r.notes,accountId:r.account_id,chartUrl:r.chart_url||""};}
function tradeToDb(t,uid){return{user_id:uid,date:t.date,time:t.time,instrument:t.instrument,session:t.session,direction:t.direction,contracts:t.contracts,entry:t.entry||null,stop:t.stop||null,target:t.target||null,exit_price:t.exit||null,pnl:t.pnl,rr:t.rr,grade:t.grade,ict_concepts:t.ictConcepts,emotions:t.emotions,mistakes:t.mistakes,rules_followed:t.rulesFollowed,htf_bias:t.htfBias,ltf_entry:t.ltfEntry,draw_on_liquidity:t.drawOnLiquidity,entry_model:t.entryModel,confluence_score:t.confluenceScore,pre_trade_narrative:t.preTradeNarrative,post_trade_review:t.postTradeReview,partials:t.partials,notes:t.notes,account_id:t.accountId||null,chart_url:t.chartUrl||""};}
function dbToAccount(r){return{id:r.id,name:r.name,firm:r.firm,size:Number(r.size),maxLoss:Number(r.max_loss),dailyLoss:Number(r.daily_loss),profitTarget:Number(r.profit_target),currentBalance:Number(r.current_balance),phase:r.phase,status:r.status,balanceHistory:r.balance_history||[]};}
function accountToDb(a,uid){return{user_id:uid,name:a.name,firm:a.firm,size:a.size,max_loss:a.maxLoss,daily_loss:a.dailyLoss,profit_target:a.profitTarget,current_balance:a.currentBalance,phase:a.phase,status:a.status,balance_history:a.balanceHistory||[]};}

// Rebuild balance history from actual trades (fixes sparkline accuracy)
function buildBalanceHistory(account, allTrades) {
  const accTrades = allTrades
    .filter(t => t.accountId === account.id)
    .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
  const hist = [account.size];
  let bal = account.size;
  accTrades.forEach(t => { bal += t.pnl; hist.push(parseFloat(bal.toFixed(2))); });
  return { balanceHistory: hist, currentBalance: parseFloat(bal.toFixed(2)) };
}

function exportCSV(trades){const h=["Date","Time","Instrument","Session","Direction","Contracts","Entry","Stop","Target","Exit","PnL","RR","Grade","ICT Concepts","Emotions","Mistakes","Entry Model","HTF Bias","Chart URL","Notes"];const rows=trades.map(t=>[t.date,t.time,t.instrument,t.session,t.direction,t.contracts,t.entry,t.stop,t.target,t.exit,t.pnl,t.rr,t.grade,(t.ictConcepts||[]).join(";"),(t.emotions||[]).join(";"),(t.mistakes||[]).join(";"),t.entryModel,t.htfBias,t.chartUrl||"",`"${(t.notes||"").replace(/"/g,'""')}"`]);const csv=[h.join(","),...rows.map(r=>r.join(","))].join("\n");const b=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`ict-trades-${new Date().toISOString().slice(0,10)}.csv`;a.click();}
function exportJSON(trades,accounts,customModels,customConcepts){const b=new Blob([JSON.stringify({trades,accounts,customModels,customConcepts},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`ict-journal-${new Date().toISOString().slice(0,10)}.json`;a.click();}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const sbox={background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:18};
const ulbl={fontSize:10,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700};

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
function Pill({label,active,onClick,color}){return<button onClick={onClick} style={{padding:"4px 11px",borderRadius:6,fontSize:11,fontWeight:600,border:active?"none":"1px solid rgba(255,255,255,0.1)",background:active?(color||"rgba(56,189,248,0.18)"):"transparent",color:active?"#e2e8f0":"rgba(255,255,255,0.35)",cursor:"pointer",transition:"all 0.15s",marginRight:3,marginBottom:3,letterSpacing:"0.02em",lineHeight:1.4}}>{label}</button>;}
function StatCard({label,value,sub,accent}){return<div style={{...sbox,padding:"16px 18px",minWidth:130,flex:1}}><div style={{...ulbl,marginBottom:5}}>{label}</div><div style={{fontSize:22,fontWeight:800,color:accent||"#e2e8f0",fontFamily:"'DM Mono',monospace",letterSpacing:"-0.02em"}}>{value}</div>{sub&&<div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:3}}>{sub}</div>}</div>;}
function Input({label,...props}){const dv=props.type==="number"&&(props.value===0||props.value==="0")?"":props.value;return<div style={{display:"flex",flexDirection:"column",gap:3}}>{label&&<label style={ulbl}>{label}</label>}<input {...props} value={dv} placeholder={props.placeholder||(props.type==="number"?"0":"")} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"9px 11px",color:"#e2e8f0",fontSize:13,fontFamily:"'DM Mono',monospace",outline:"none",boxSizing:"border-box",width:"100%",...(props.style||{})}}/></div>;}
function Select({label,options,...props}){return<div style={{display:"flex",flexDirection:"column",gap:3}}>{label&&<label style={ulbl}>{label}</label>}<select {...props} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"9px 11px",color:"#e2e8f0",fontSize:13,fontFamily:"'DM Mono',monospace",outline:"none",boxSizing:"border-box",width:"100%",...(props.style||{})}}>{options.map(o=>typeof o==="object"?<option key={o.value} value={o.value} style={{background:"#111"}}>{o.label}</option>:<option key={o} value={o} style={{background:"#111"}}>{o}</option>)}</select></div>;}
function TextArea({label,...props}){return<div style={{display:"flex",flexDirection:"column",gap:3}}>{label&&<label style={ulbl}>{label}</label>}<textarea {...props} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"9px 11px",color:"#e2e8f0",fontSize:13,fontFamily:"'DM Mono',monospace",outline:"none",minHeight:64,resize:"vertical",boxSizing:"border-box",width:"100%",...(props.style||{})}}/></div>;}
function Btn({children,variant,...props}){const s={primary:{background:"linear-gradient(135deg,#0ea5e9,#6366f1)",color:"#fff",border:"none"},danger:{background:"rgba(239,68,68,0.12)",color:"#f87171",border:"1px solid rgba(239,68,68,0.2)"},ghost:{background:"transparent",color:"rgba(255,255,255,0.45)",border:"1px solid rgba(255,255,255,0.08)"},success:{background:"rgba(34,197,94,0.12)",color:"#4ade80",border:"1px solid rgba(34,197,94,0.2)"}};return<button {...props} style={{padding:"9px 18px",borderRadius:7,fontSize:12,fontWeight:700,cursor:"pointer",transition:"all 0.15s",letterSpacing:"0.02em",...s[variant||"primary"],...(props.style||{})}}>{children}</button>;}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function Sparkline({data}){
  if(!data||data.length<2)return<div style={{height:30}}/>;
  const h=30,w=100;
  const mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-mn)/rng)*h}`).join(" ");
  const color=data[data.length-1]>=data[0]?"#4ade80":"#f87171";
  return(
    <svg viewBox={`0 0 ${w} ${h}`} style={{width:"100%",height:30,marginTop:6}} preserveAspectRatio="none">
      <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.15"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      <polygon fill="url(#spk)" points={`0,${h} ${pts} ${w},${h}`}/>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── CALENDAR ─────────────────────────────────────────────────────────────────
function PnlCalendar({trades,onDayClick}){const[month,setMonth]=useState(()=>{const n=new Date();return{year:n.getFullYear(),month:n.getMonth()};});const dailyPnl=useMemo(()=>{const m={};trades.forEach(t=>{m[t.date]=(m[t.date]||0)+t.pnl;});return m;},[trades]);const monthlyPnl=useMemo(()=>{const prefix=`${month.year}-${String(month.month+1).padStart(2,"0")}`;let total=0;Object.entries(dailyPnl).forEach(([d,v])=>{if(d.startsWith(prefix))total+=v;});return total;},[dailyPnl,month]);const dim=new Date(month.year,month.month+1,0).getDate();const fdow=new Date(month.year,month.month,1).getDay();const mn=new Date(month.year,month.month).toLocaleString("default",{month:"long",year:"numeric"});const cells=[];for(let i=0;i<fdow;i++)cells.push(null);for(let d=1;d<=dim;d++)cells.push(d);const textOutline="0 0 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.5)";return<div style={sbox}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><button onClick={()=>setMonth(m=>m.month===0?{year:m.year-1,month:11}:{...m,month:m.month-1})} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:16,padding:"4px 8px"}}>‹</button><span style={{fontSize:13,fontWeight:700,fontFamily:"'Space Grotesk',sans-serif",color:"#e2e8f0"}}>{mn}</span><button onClick={()=>setMonth(m=>m.month===11?{year:m.year+1,month:0}:{...m,month:m.month+1})} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:16,padding:"4px 8px"}}>›</button></div><div style={{textAlign:"center",marginBottom:12,fontSize:15,fontWeight:800,fontFamily:"'DM Mono',monospace",color:monthlyPnl>=0?"#4ade80":"#f87171"}}>Monthly P&L: ${monthlyPnl>=0?"+":""}{monthlyPnl.toFixed(2)}</div><div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>{["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{textAlign:"center",fontSize:9,color:"rgba(255,255,255,0.25)",fontWeight:700,padding:4}}>{d}</div>)}{cells.map((day,i)=>{if(!day)return<div key={`e${i}`}/>;const ds=`${month.year}-${String(month.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;const pnl=dailyPnl[ds];const has=pnl!==undefined;const bg=!has?"transparent":pnl>0?"rgba(34,197,94,0.15)":pnl<0?"rgba(239,68,68,0.15)":"rgba(255,255,255,0.04)";const col=!has?"rgba(255,255,255,0.25)":pnl>0?"#4ade80":pnl<0?"#f87171":"rgba(255,255,255,0.4)";return<div key={ds} onClick={()=>has&&onDayClick&&onDayClick(ds)} style={{textAlign:"center",borderRadius:6,padding:"6px 2px",background:bg,cursor:has?"pointer":"default"}}><div style={{fontSize:13,color:col,fontWeight:has?700:400,textShadow:textOutline}}>{day}</div>{has&&<div style={{fontSize:11,color:col,fontWeight:700,marginTop:1,textShadow:textOutline}}>${pnl>0?"+":""}{pnl.toFixed(0)}</div>}</div>;})}</div></div>;}

// ─── INTERACTIVE EQUITY CURVE ────────────────────────────────────────────────
function EquityCurve({ trades }) {
  const svgRef = useRef();
  const containerRef = useRef();
  const [tooltip, setTooltip] = useState(null);
  const [zoom, setZoom] = useState({ scale: 1, offsetX: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dims, setDims] = useState({ w: 400, h: 220 });

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const e = entries[0];
      if (e) setDims({ w: e.contentRect.width || 400, h: Math.max(160, e.contentRect.height || 220) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const PAD = { top: 12, right: 16, bottom: 32, left: 56 };
  const W = dims.w - PAD.left - PAD.right;
  const H = dims.h - PAD.top - PAD.bottom;

  const sorted = useMemo(() => [...trades].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)), [trades]);

  const { cumPnl, labels } = useMemo(() => {
    const cumPnl = [0]; const labels = ["Start"];
    let r = 0;
    sorted.forEach(t => { r += t.pnl; cumPnl.push(parseFloat(r.toFixed(2))); labels.push(t.date); });
    return { cumPnl, labels };
  }, [sorted]);

  const totalPts = cumPnl.length;
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? 0.85 : 1.18;
    setZoom(z => {
      const newScale = Math.max(1, Math.min(totalPts / 2, z.scale * delta));
      return { ...z, scale: newScale };
    });
  }, [totalPts]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  if (cumPnl.length < 2) return <div style={{ height: "100%", minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)", fontSize: 12 }}>No trades</div>;

  const maxVal = Math.max(...cumPnl, 0);
  const minVal = Math.min(...cumPnl, 0);
  const valRange = maxVal - minVal || 1;

  const visibleCount = Math.max(2, Math.floor(totalPts / zoom.scale));
  const maxOffset = totalPts - visibleCount;
  const startIdx = Math.max(0, Math.min(maxOffset, Math.round(zoom.offsetX)));
  const endIdx = Math.min(totalPts - 1, startIdx + visibleCount);
  const visPts = cumPnl.slice(startIdx, endIdx + 1);
  const visLabels = labels.slice(startIdx, endIdx + 1);

  const visMax = Math.max(...visPts, 0);
  const visMin = Math.min(...visPts, 0);
  const visRange = visMax - visMin || 1;

  const toX = i => (i / (visPts.length - 1)) * W;
  const toY = v => H - ((v - visMin) / visRange) * H;
  const zeroY = toY(0);

  const points = visPts.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const color = visPts[visPts.length - 1] >= 0 ? "#4ade80" : "#f87171";

  const yTicks = [];
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i++) {
    const val = visMin + (visRange / tickCount) * i;
    yTicks.push({ y: toY(val), label: `$${val >= 0 ? "+" : ""}${val.toFixed(0)}` });
  }

  const xTicks = [];
  const xStep = Math.max(1, Math.floor((visPts.length - 1) / 4));
  for (let i = 0; i < visPts.length; i += xStep) {
    xTicks.push({ x: toX(i), label: visLabels[i] === "Start" ? "Start" : visLabels[i]?.slice(5) || "" });
  }

  const handleMouseMove = (e) => {
    if (dragging && dragStart) {
      const dx = e.clientX - dragStart.x;
      const pxPerPt = W / Math.max(1, visPts.length - 1);
      const ptDelta = -dx / pxPerPt;
      const newOffset = Math.max(0, Math.min(maxOffset, dragStart.offset + ptDelta));
      setZoom(z => ({ ...z, offsetX: newOffset }));
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left - PAD.left;
    const idx = Math.round((mx / W) * (visPts.length - 1));
    if (idx >= 0 && idx < visPts.length) {
      setTooltip({ x: toX(idx) + PAD.left, y: toY(visPts[idx]) + PAD.top, val: visPts[idx], label: visLabels[idx], idx: startIdx + idx });
    }
  };

  return (
    <div ref={containerRef} style={{ position: "relative", userSelect: "none", width: "100%", height: "100%" }}
      onMouseLeave={() => { setTooltip(null); setDragging(false); }}
      onMouseUp={() => setDragging(false)}
    >
      {tooltip && (
        <div style={{ position: "absolute", left: Math.min(tooltip.x, dims.w - 130), top: Math.max(0, tooltip.y - 48), background: "rgba(15,15,20,0.95)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, padding: "6px 10px", fontSize: 11, pointerEvents: "none", zIndex: 10, whiteSpace: "nowrap" }}>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginBottom: 2 }}>{tooltip.label} · Trade #{tooltip.idx}</div>
          <div style={{ color: tooltip.val >= 0 ? "#4ade80" : "#f87171", fontWeight: 800, fontFamily: "'DM Mono',monospace", fontSize: 13 }}>{tooltip.val >= 0 ? "+" : ""}${tooltip.val.toFixed(2)}</div>
        </div>
      )}
      <svg ref={svgRef} width="100%" height={dims.h} viewBox={`0 0 ${dims.w} ${dims.h}`}
        style={{ cursor: dragging ? "grabbing" : "crosshair", display: "block" }}
        onMouseMove={handleMouseMove}
        onMouseDown={e => { setDragging(true); setDragStart({ x: e.clientX, offset: zoom.offsetX }); }}
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {yTicks.map((t, i) => <line key={i} x1={0} y1={t.y} x2={W} y2={t.y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />)}
          <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="4,4" />
          <defs>
            <linearGradient id="ecGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
            <clipPath id="ecClip"><rect x="0" y="0" width={W} height={H} /></clipPath>
          </defs>
          <polygon fill="url(#ecGrad)" clipPath="url(#ecClip)" points={`0,${zeroY} ${points} ${W},${zeroY}`} />
          <polyline fill="none" stroke={color} strokeWidth="2" points={points} strokeLinecap="round" strokeLinejoin="round" clipPath="url(#ecClip)" />
          {tooltip && (() => {
            const localIdx = tooltip.idx - startIdx;
            if (localIdx < 0 || localIdx >= visPts.length) return null;
            return <circle cx={toX(localIdx)} cy={toY(visPts[localIdx])} r={4} fill={color} stroke="#0a0a0a" strokeWidth={2} />;
          })()}
          {yTicks.map((t, i) => <text key={i} x={-6} y={t.y + 4} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.3)" fontFamily="'DM Mono',monospace">{t.label}</text>)}
          {xTicks.map((t, i) => <text key={i} x={t.x} y={H + 20} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.3)" fontFamily="'DM Mono',monospace">{t.label}</text>)}
          <line x1={0} y1={0} x2={0} y2={H} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <line x1={0} y1={H} x2={W} y2={H} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        </g>
      </svg>
      {zoom.scale > 1.05 && (
        <div style={{ position: "absolute", bottom: 36, right: 8, fontSize: 9, color: "rgba(255,255,255,0.25)", background: "rgba(0,0,0,0.4)", borderRadius: 4, padding: "2px 6px" }}>scroll to zoom · drag to pan</div>
      )}
      {zoom.scale <= 1.05 && (
        <div style={{ position: "absolute", bottom: 36, right: 8, fontSize: 9, color: "rgba(255,255,255,0.2)" }}>scroll to zoom</div>
      )}
    </div>
  );
}

// ─── PNL CHART (legacy - kept for compatibility) ──────────────────────────────
function PnlChart({trades}){if(!trades.length)return null;const sorted=[...trades].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));const cum=[];let r=0;sorted.forEach(t=>{r+=t.pnl;cum.push(r);});const max=Math.max(...cum,0),min=Math.min(...cum,0),range=max-min||1,h=120,w=100;const pts=cum.map((v,i)=>`${(i/Math.max(cum.length-1,1))*w},${h-((v-min)/range)*h}`).join(" ");const zy=h-((0-min)/range)*h;return<svg viewBox={`0 0 ${w} ${h}`} style={{width:"100%",height:120}} preserveAspectRatio="none"><line x1="0" y1={zy} x2={w} y2={zy} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"/><polyline fill="none" stroke={r>=0?"#4ade80":"#f87171"} strokeWidth="1.5" points={pts} strokeLinecap="round" strokeLinejoin="round"/></svg>;}

// ─── ACCOUNT PROGRESS ─────────────────────────────────────────────────────────
function AccountProgress({account}){if(!account.profitTarget)return null;const pnl=account.currentBalance-account.size;const pct=Math.min(Math.max(pnl/account.profitTarget*100,0),100);const ddPct=account.maxLoss?Math.min(Math.max((-pnl)/account.maxLoss*100,0),100):0;return<div style={{marginTop:8}}><div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"rgba(255,255,255,0.35)",marginBottom:3}}><span>Profit: ${pnl.toFixed(0)} / ${account.profitTarget}</span><span>{pct.toFixed(0)}%</span></div><div style={{height:5,background:"rgba(255,255,255,0.05)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#4ade80,#22d3ee)",borderRadius:3,transition:"width 0.3s"}}/></div>{account.maxLoss>0&&pnl<0&&<div style={{marginTop:5}}><div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"rgba(239,68,68,0.5)",marginBottom:3}}><span>DD: ${Math.abs(pnl).toFixed(0)} / ${account.maxLoss}</span><span>{ddPct.toFixed(0)}%</span></div><div style={{height:5,background:"rgba(255,255,255,0.05)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${ddPct}%`,background:"linear-gradient(90deg,#fbbf24,#ef4444)",borderRadius:3,transition:"width 0.3s"}}/></div></div>}</div>;}

// ─── DAY/TIME WIDGETS ─────────────────────────────────────────────────────────
function DayOfWeekWidget({trades}){const stats=useMemo(()=>{const m={};["Mon","Tue","Wed","Thu","Fri"].forEach(d=>m[d]={w:0,t:0,pnl:0});trades.forEach(t=>{if(!t.date)return;const d=new Date(t.date+"T12:00:00");const day=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];if(!m[day])return;m[day].t++;m[day].pnl+=t.pnl;if(t.pnl>0)m[day].w++;});return m;},[trades]);return<div style={sbox}><div style={{...ulbl,marginBottom:10}}>Day of Week</div>{Object.entries(stats).map(([day,d])=><div key={day} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:12}}><span>{day}</span><div style={{display:"flex",gap:12}}><span style={{color:"rgba(255,255,255,0.35)",fontSize:10}}>{d.t?((d.w/d.t)*100).toFixed(0):0}% WR</span><span style={{color:d.pnl>=0?"#4ade80":"#f87171",fontWeight:600,minWidth:60,textAlign:"right"}}>${d.pnl.toFixed(0)}</span></div></div>)}</div>;}
function TimeOfDayWidget({trades}){const stats=useMemo(()=>{const b={"Pre-Market":{pnl:0,c:0},"Morning (9:30-12)":{pnl:0,c:0},"Lunch (12-14)":{pnl:0,c:0},"Afternoon (14-16)":{pnl:0,c:0},"After Hours":{pnl:0,c:0}};trades.forEach(t=>{if(!t.time)return;const[h,m]=(t.time||"").split(":").map(Number);const mins=h*60+(m||0);let k;if(mins<570)k="Pre-Market";else if(mins<720)k="Morning (9:30-12)";else if(mins<840)k="Lunch (12-14)";else if(mins<960)k="Afternoon (14-16)";else k="After Hours";b[k].pnl+=t.pnl;b[k].c++;});return b;},[trades]);return<div style={sbox}><div style={{...ulbl,marginBottom:10}}>Time of Day Edge</div>{Object.entries(stats).map(([l,d])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:12}}><span style={{fontSize:11}}>{l}</span><div style={{display:"flex",gap:8}}><span style={{color:"rgba(255,255,255,0.3)",fontSize:10}}>{d.c}t</span><span style={{color:d.pnl>=0?"#4ade80":"#f87171",fontWeight:600,minWidth:60,textAlign:"right"}}>${d.pnl.toFixed(0)}</span></div></div>)}</div>;}

// ─── S&P 500 COMPARISON ───────────────────────────────────────────────────────
function generateSPCurve(nPoints, totalReturnPct) {
  const drift = totalReturnPct / nPoints;
  const vol = 0.9;
  const pts = [0];
  let cum = 0;
  for (let i = 1; i < nPoints; i++) {
    const r = (Math.sin(i * 53.7 + Math.cos(i * 0.13) * 200) * 0.5 + 0.5);
    cum += drift + (r - 0.5) * vol;
    pts.push(cum);
  }
  const last = pts[pts.length - 1];
  if (Math.abs(last) > 0.001) {
    return pts.map(p => (p / last) * totalReturnPct);
  }
  return pts;
}

function SPComparison({ trades }) {
  const { isMobile } = useIsMobile();
  const [period, setPeriod] = useState("1Y");
  const [startBalStr, setStartBalStr] = useState("50000");
  const startBal = parseFloat(startBalStr) || 50000;

  const periodConfig = {
    "1M":  { days: 30,   spReturn: 0.82,  label: "1 Month",   pts: 22  },
    "6M":  { days: 182,  spReturn: 5.5,   label: "6 Months",  pts: 130 },
    "1Y":  { days: 365,  spReturn: 12.8,  label: "1 Year",    pts: 252 },
    "5Y":  { days: 1825, spReturn: 82.0,  label: "5 Years",   pts: 300 },
  };

  const cfg = periodConfig[period];

  const { traderPts, spPts, traderReturn, summary } = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - cfg.days * 86400000);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const periodTrades = trades
      .filter(t => t.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date));

    let cum = 0;
    const raw = [0];
    periodTrades.forEach(t => { cum += t.pnl; raw.push((cum / startBal) * 100); });

    const nPts = cfg.pts;
    let traderPts;
    if (raw.length < 2) {
      traderPts = Array(nPts).fill(0);
    } else {
      // Interpolate trader curve to nPts
      traderPts = Array.from({ length: nPts }, (_, i) => {
        const idx = (i / (nPts - 1)) * (raw.length - 1);
        const lo = Math.floor(idx), hi = Math.ceil(idx);
        return raw[lo] + (raw[hi] - raw[lo]) * (idx - lo);
      });
    }

    const spPts = generateSPCurve(nPts, cfg.spReturn);
    const traderReturn = parseFloat((cum / startBal * 100).toFixed(2));

    return {
      traderPts,
      spPts,
      traderReturn,
      summary: {
        you: traderReturn,
        sp: parseFloat(cfg.spReturn.toFixed(2)),
        alpha: parseFloat((traderReturn - cfg.spReturn).toFixed(2)),
        trades: periodTrades.length,
      }
    };
  }, [trades, period, startBal, cfg]);

  const allPts = [...traderPts, ...spPts];
  const mn = Math.min(...allPts, 0);
  const mx = Math.max(...allPts, 0);
  const range = mx - mn || 1;
  const h = 160, w = 400;

  const toSvg = (pts) =>
    pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - mn) / range) * h}`).join(" ");

  const zy = h - ((0 - mn) / range) * h;

  return (
    <div style={{ ...sbox, marginTop: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ ...ulbl }}>vs. S&P 500 Benchmark</div>
        <div style={{ display: "flex", gap: 4 }}>
          {["1M", "6M", "1Y", "5Y"].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: period === p ? "rgba(56,189,248,0.2)" : "rgba(255,255,255,0.04)", color: period === p ? "#38bdf8" : "rgba(255,255,255,0.35)" }}>{p}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ ...ulbl, marginBottom: 4 }}>Your Return</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: summary.you >= 0 ? "#4ade80" : "#f87171" }}>{summary.you >= 0 ? "+" : ""}{summary.you}%</div>
        </div>
        <div style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ ...ulbl, marginBottom: 4 }}>S&P 500</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: "#38bdf8" }}>+{summary.sp}%</div>
        </div>
        <div style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ ...ulbl, marginBottom: 4 }}>Alpha</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: summary.alpha >= 0 ? "#4ade80" : "#f87171" }}>{summary.alpha >= 0 ? "+" : ""}{summary.alpha}%</div>
        </div>
        <div style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ ...ulbl, marginBottom: 4 }}>Trades ({periodConfig[period].label})</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: "#e2e8f0" }}>{summary.trades}</div>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ ...ulbl, display: "block", marginBottom: 4 }}>Reference Balance ($)</label>
        <input type="text" inputMode="numeric" value={startBalStr} onChange={e => { const v = e.target.value.replace(/[^0-9]/g,""); setStartBalStr(v); }} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 12, fontFamily: "'DM Mono',monospace", outline: "none", width: 140 }} />
      </div>

      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: isMobile ? 120 : 160 }} preserveAspectRatio="none">
          <line x1="0" y1={zy} x2={w} y2={zy} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" strokeDasharray="4,4" />
          {/* S&P 500 line */}
          <polyline fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="6,3" points={toSvg(spPts)} strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
          {/* Trader line */}
          <polyline fill="none" stroke={summary.you >= 0 ? "#4ade80" : "#f87171"} strokeWidth="2" points={toSvg(traderPts)} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 16, height: 2, background: "#4ade80", display: "inline-block", borderRadius: 1 }} />You</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 16, height: 2, background: "#38bdf8", display: "inline-block", borderRadius: 1, opacity: 0.7 }} />S&P 500 (approx.)</span>
        </div>
        {summary.trades === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>No trades in this period</div>
        )}
      </div>
    </div>
  );
}

// ─── MONTE CARLO ──────────────────────────────────────────────────────────────
function MonteCarloSim({ trades }) {
  const { isMobile } = useIsMobile();
  const [simCount, setSC] = useState(1000);
  const [tradeCount, setTC] = useState(100);
  const [startBal, setSB] = useState(50000);
  const [maxDD, setMD] = useState(2500);
  const [results, setR] = useState(null);
  const [running, setRunning] = useState(false);

  const runSim = useCallback(() => {
    if (trades.length < 5) return;
    setRunning(true);
    setTimeout(() => {
      const pnls = trades.map(t => t.pnl);
      const sims = [];
      for (let s = 0; s < simCount; s++) {
        let bal = startBal, peak = bal, mdd = 0, blown = false;
        const curve = [bal];
        for (let i = 0; i < tradeCount; i++) {
          bal += pnls[Math.floor(Math.random() * pnls.length)];
          if (bal > peak) peak = bal;
          const dd = peak - bal;
          if (dd > mdd) mdd = dd;
          if (dd >= maxDD) { blown = true; break; }
          curve.push(bal);
        }
        sims.push({ final: bal, mdd, blown, curve });
      }
      const finals = sims.map(s => s.final).sort((a, b) => a - b);
      const pA = p => finals[Math.floor(finals.length * p)];
      const sc = [];
      for (let i = 0; i < Math.min(30, sims.length); i++) sc.push(sims[Math.floor(Math.random() * sims.length)].curve);

      // Compute median path (50th percentile at each step)
      const maxLen = Math.max(...sims.map(s => s.curve.length));
      const medianPath = Array.from({ length: maxLen }, (_, step) => {
        const vals = sims.map(s => s.curve[Math.min(step, s.curve.length - 1)]).sort((a, b) => a - b);
        return vals[Math.floor(vals.length / 2)];
      });

      setR({ finals, blownCount: sims.filter(s => s.blown).length, profitable: sims.filter(s => s.final > startBal).length, median: pA(0.5), p5: pA(0.05), p25: pA(0.25), p75: pA(0.75), p95: pA(0.95), avgMdd: sims.reduce((s, x) => s + x.mdd, 0) / sims.length, sc, total: simCount, medianPath, startBal });
      setRunning(false);
    }, 50);
  }, [trades, simCount, tradeCount, startBal, maxDD]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Monte Carlo Simulation</h2>
      {trades.length < 5 ? (
        <div style={{ ...sbox, textAlign: "center", padding: 40, color: "rgba(255,255,255,0.2)" }}>Need 5+ trades</div>
      ) : (
        <>
          <div style={sbox}>
            <div style={{ ...ulbl, marginBottom: 12 }}>Parameters</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 10 }}>
              <Input label="Simulations" type="number" value={simCount} onChange={e => { let v = +e.target.value; if (v > 10000) v = 10000; setSC(Math.max(100, v)); }} />
              <Input label="Trades/Sim" type="number" value={tradeCount} onChange={e => { let v = +e.target.value; if (v > 500) v = 500; setTC(Math.max(10, v)); }} />
              <Input label="Start Bal" type="number" value={startBal} onChange={e => setSB(+e.target.value)} />
              <Input label="Max DD" type="number" value={maxDD} onChange={e => setMD(+e.target.value)} />
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>Max: 10,000 simulations · 500 trades/sim</div>
            <div style={{ marginTop: 14 }}>
              <Btn variant="primary" onClick={runSim} style={{ opacity: running ? 0.5 : 1 }}>{running ? "Running..." : "Run Simulation"}</Btn>
            </div>
          </div>

          {results && (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <StatCard label="Prob. Profit" value={`${(results.profitable / results.total * 100).toFixed(1)}%`} accent={results.profitable / results.total > 0.5 ? "#4ade80" : "#f87171"} />
                <StatCard label="Prob. Ruin" value={`${(results.blownCount / results.total * 100).toFixed(1)}%`} accent={results.blownCount / results.total < 0.1 ? "#4ade80" : "#f87171"} />
                <StatCard label="Median" value={`$${results.median.toFixed(0)}`} accent={results.median > results.startBal ? "#4ade80" : "#f87171"} />
                <StatCard label="Avg Max DD" value={`$${results.avgMdd.toFixed(0)}`} accent="#fbbf24" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                <div style={sbox}>
                  <div style={{ ...ulbl, marginBottom: 10 }}>Equity Curves</div>
                  <svg viewBox="0 0 400 200" style={{ width: "100%", height: 200 }} preserveAspectRatio="none">
                    {(() => {
                      const all = results.sc.flat();
                      const mn = Math.min(...all), mx = Math.max(...all), rng = mx - mn || 1;
                      const zy = 200 - ((results.startBal - mn) / rng) * 200;
                      return (
                        <>
                          <line x1="0" y1={zy} x2="400" y2={zy} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" strokeDasharray="4,4" />
                          {results.sc.map((c, ci) => {
                            const pts = c.map((v, i) => `${(i / Math.max(c.length - 1, 1)) * 400},${200 - ((v - mn) / rng) * 200}`).join(" ");
                            return <polyline key={ci} fill="none" stroke={c[c.length - 1] >= results.startBal ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"} strokeWidth="1" points={pts} />;
                          })}
                          {/* Median path highlighted */}
                          {(() => {
                            const mp = results.medianPath;
                            const pts = mp.map((v, i) => `${(i / Math.max(mp.length - 1, 1)) * 400},${200 - ((v - mn) / rng) * 200}`).join(" ");
                            return <polyline fill="none" stroke="#38bdf8" strokeWidth="2" points={pts} strokeLinecap="round" strokeLinejoin="round" />;
                          })()}
                        </>
                      );
                    })()}
                  </svg>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>Blue line = median path</div>
                </div>
                <div style={sbox}>
                  <div style={{ ...ulbl, marginBottom: 10 }}>Distribution</div>
                  {[{ l: "5th", v: results.p5, c: "#f87171" }, { l: "25th", v: results.p25, c: "#fbbf24" }, { l: "Median", v: results.median, c: "#38bdf8" }, { l: "75th", v: results.p75, c: "#4ade80" }, { l: "95th", v: results.p95, c: "#4ade80" }].map(r => (
                    <div key={r.l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{r.l}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: r.c }}>${r.v.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* S&P 500 Comparison - always visible */}
          <div>
            <div style={{ ...ulbl, marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>Performance vs. S&P 500</div>
            <SPComparison trades={trades} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── TRADE FORM ───────────────────────────────────────────────────────────────
function TradeForm({trade,accounts,customModels,customConcepts,onSave,onCancel,onAddModel,onAddConcept,defaultSession,defaultInstrument}){const{isMobile}=useIsMobile();const[form,setForm]=useState(trade||{id:"",date:new Date().toISOString().slice(0,10),time:"",instrument:defaultInstrument||"NQ",session:defaultSession||"NY AM",direction:"Long",contracts:1,entry:"",stop:"",target:"",exit:"",pnl:0,ictConcepts:[],emotions:["Calm"],grade:"B",accountId:"",notes:"",rr:"",partials:"",preTradeNarrative:"",postTradeReview:"",htfBias:"",ltfEntry:"",confluenceScore:0,mistakes:[],rulesFollowed:[],drawOnLiquidity:"",entryModel:"",chartUrl:""});const[nc,setNC]=useState("");const set=(k,v)=>setForm(f=>({...f,[k]:v}));const allC=[...ICT_CONCEPTS,...(customConcepts||[])];const allM=[...DEFAULT_MODELS,...(customModels||[])];useEffect(()=>{if(form.emotion&&!form.emotions)setForm(f=>({...f,emotions:[f.emotion]}));},[]);

// Auto-detect session from trade time (updates whenever time changes)
const detectSession=(time)=>{if(!time)return null;const[h,m]=(time).split(":").map(Number);const mins=h*60+(m||0);if(mins>=1200||mins<60)return"Asia";if(mins>=120&&mins<=300)return"London";if(mins>=420&&mins<=660)return"NY AM";if(mins>=720&&mins<=780)return"NY Lunch";if(mins>=810&&mins<=960)return"NY PM";return null;};
useEffect(()=>{if(form.time){const detected=detectSession(form.time);if(detected)setForm(f=>({...f,session:detected}));}},[form.time]);

useEffect(()=>{const rr=calcRR(form.entry,form.stop,form.exit,form.direction);const pnl=calcPnl(form.entry,form.exit,form.contracts,form.instrument,form.direction);setForm(f=>({...f,rr:rr||f.rr,pnl:form.exit?pnl:f.pnl}));},[form.entry,form.stop,form.exit,form.contracts,form.instrument,form.direction]);const ems=form.emotions||[];useEffect(()=>{const rP=RULE_CHECKLIST.length>0?(form.rulesFollowed.length/RULE_CHECKLIST.length)*3.0:0;const iP=form.ictConcepts.length===0?0:Math.min(2.0,0.7*Math.sqrt(form.ictConcepts.length));let nP=0;if(form.htfBias)nP+=0.4;if(form.ltfEntry)nP+=0.3;if((form.drawOnLiquidity||"").length>3)nP+=0.3;if((form.entryModel||"").length>3)nP+=0.3;if((form.preTradeNarrative||"").length>20)nP+=0.4;const es=form.emotions||[];const pC=es.filter(e=>!NEGATIVE_EMOTIONS.includes(e)).length;const nC=es.filter(e=>NEGATIVE_EMOTIONS.includes(e)).length;const eB=Math.min(1.5,pC*0.5);const eP=nC*0.8;const mP=(pC>0&&nC>0)?0.3:0;const gM={"A+":1.5,"A":1.2,"B":0.8,"C":0.4,"D":0.1,"F":0};const sub=rP+iP+nP+eB+(gM[form.grade]||0);set("confluenceScore",Math.max(0,Math.min(10,Math.round((sub-form.mistakes.length*1.5-eP-mP)*10)/10)));},[form.ictConcepts,form.rulesFollowed,form.mistakes,form.htfBias,form.ltfEntry,form.drawOnLiquidity,form.entryModel,form.preTradeNarrative,form.emotions,form.grade]);const toggle=(k,v)=>setForm(f=>({...f,[k]:f[k].includes(v)?f[k].filter(x=>x!==v):[...f[k],v]}));const toggleEmo=e=>setForm(f=>{const c=f.emotions||[];return{...f,emotions:c.includes(e)?c.filter(x=>x!==e):[...c,e]};});const sec=t=><div style={{fontSize:11,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700,marginTop:8,marginBottom:4,borderTop:"1px solid rgba(255,255,255,0.05)",paddingTop:14}}>{t}</div>;const g=isMobile?"1fr 1fr":"1fr 1fr 1fr 1fr";return<div style={{display:"flex",flexDirection:"column",gap:12}}><div style={{display:"grid",gridTemplateColumns:g,gap:10}}><Input label="Date" type="date" value={form.date} onChange={e=>set("date",e.target.value)}/><Input label="Time" type="time" value={form.time} onChange={e=>set("time",e.target.value)}/><Select label="Instrument" value={form.instrument} onChange={e=>set("instrument",e.target.value)} options={INSTRUMENTS}/><Select label="Session (Auto)" value={form.session} onChange={e=>set("session",e.target.value)} options={SESSIONS} disabled={true} style={{opacity: 0.5, pointerEvents: "none", backgroundColor: "rgba(0,0,0,0.2)"}}/></div><div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr 1fr 1fr 1fr",gap:10}}><Select label="Direction" value={form.direction} onChange={e=>set("direction",e.target.value)} options={["Long","Short"]}/><Input label="Contracts" type="number" value={form.contracts} onChange={e=>set("contracts",+e.target.value)}/><Input label="Entry" type="number" step="any" value={form.entry} onChange={e=>set("entry",e.target.value)}/><Input label="Stop" type="number" step="any" value={form.stop} onChange={e=>set("stop",e.target.value)}/><Input label="Target" type="number" step="any" value={form.target} onChange={e=>set("target",e.target.value)}/></div><div style={{display:"grid",gridTemplateColumns:g,gap:10}}><Input label="Exit" type="number" step="any" value={form.exit} onChange={e=>set("exit",e.target.value)}/><Input label="P&L (auto)" type="number" step="any" value={form.pnl} onChange={e=>set("pnl",+e.target.value)}/><Input label="R:R (auto)" value={form.rr} onChange={e=>set("rr",e.target.value)}/><Select label="Grade" value={form.grade} onChange={e=>set("grade",e.target.value)} options={TRADE_GRADES}/></div><Select label="Account" value={form.accountId} onChange={e=>set("accountId",e.target.value)} options={[{value:"",label:"-- No Account --"},...accounts.map(a=>({value:a.id,label:`${a.name} (${a.firm} $${a.currentBalance.toLocaleString()})`}))]}/><Input label="Chart URL" value={form.chartUrl||""} onChange={e=>set("chartUrl",e.target.value)} placeholder="https://tradingview.com/x/..."/>{sec("Pre-Trade Rules")}<div style={{display:"flex",flexWrap:"wrap",gap:3,justifyContent:"center"}}>{RULE_CHECKLIST.map(r=><Pill key={r} label={r} active={form.rulesFollowed.includes(r)} onClick={()=>toggle("rulesFollowed",r)} color="rgba(34,197,94,0.18)"/>)}</div>{sec("Psychology")}<div><label style={{...ulbl,display:"block",marginBottom:4,textAlign:"center"}}>Emotions <span style={{fontWeight:400,textTransform:"none",color:"rgba(255,255,255,0.2)"}}>(multi)</span></label><div style={{display:"flex",flexWrap:"wrap",justifyContent:"center"}}>{EMOTIONS.map(e=><Pill key={e} label={e} active={ems.includes(e)} onClick={()=>toggleEmo(e)} color={NEGATIVE_EMOTIONS.includes(e)?"rgba(239,68,68,0.18)":"rgba(34,197,94,0.18)"}/>)}</div></div><div><label style={{...ulbl,display:"block",marginBottom:6,textAlign:"center"}}>Mistakes</label><div style={{display:"flex",flexWrap:"wrap",justifyContent:"center"}}>{MISTAKES.map(m=><Pill key={m} label={m} active={form.mistakes.includes(m)} onClick={()=>toggle("mistakes",m)} color="rgba(239,68,68,0.18)"/>)}</div></div>{sec("Bias & Model")}<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:10}}><Select label="HTF Bias" value={form.htfBias} onChange={e=>set("htfBias",e.target.value)} options={["","Bullish","Bearish","Neutral/Ranging"]}/><Select label="LTF TF" value={form.ltfEntry} onChange={e=>set("ltfEntry",e.target.value)} options={["",...TIMEFRAMES]}/><Input label="Draw on Liquidity" value={form.drawOnLiquidity} onChange={e=>set("drawOnLiquidity",e.target.value)} placeholder="BSL above PDH"/></div><div><label style={{...ulbl,display:"block",marginBottom:6,textAlign:"center"}}>Entry Model</label><div style={{display:"flex",flexWrap:"wrap",marginBottom:6,justifyContent:"center"}}>{allM.map(m=><Pill key={m} label={m} active={form.entryModel===m} onClick={()=>set("entryModel",m)} color="rgba(56,189,248,0.18)"/>)}</div><div style={{display:"flex",gap:6}}><input value={form.entryModel} onChange={e=>set("entryModel",e.target.value)} placeholder="Or type custom..." style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"8px 11px",color:"#e2e8f0",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none",boxSizing:"border-box"}}/>{form.entryModel&&!allM.includes(form.entryModel)&&<Btn variant="success" style={{padding:"7px 12px",fontSize:10}} onClick={()=>onAddModel(form.entryModel.trim())}>+ Save</Btn>}</div></div>{sec("ICT Concepts")}<div style={{display:"flex",flexDirection:"column",gap:14}}>{Object.entries(CATEGORIZED_ICT_CONCEPTS).map(([cat,concepts])=><div key={cat}><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",textAlign:"center",marginBottom:6,fontWeight:700}}>{cat}</div><div style={{display:"flex",flexWrap:"wrap",justifyContent:"center"}}>{concepts.map(c=><Pill key={c} label={c} active={form.ictConcepts.includes(c)} onClick={()=>toggle("ictConcepts",c)} color="rgba(168,85,247,0.18)"/>)}</div></div>)}{customConcepts&&customConcepts.length>0&&(<div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",textAlign:"center",marginBottom:6,fontWeight:700}}>CUSTOM</div><div style={{display:"flex",flexWrap:"wrap",justifyContent:"center"}}>{customConcepts.map(c=><Pill key={c} label={c} active={form.ictConcepts.includes(c)} onClick={()=>toggle("ictConcepts",c)} color="rgba(168,85,247,0.18)"/>)}</div></div>)}</div><div style={{display:"flex",gap:6}}><input value={nc} onChange={e=>setNC(e.target.value)} placeholder="Add custom concept..." onKeyDown={e=>{if(e.key==="Enter"&&nc.trim()&&!allC.includes(nc.trim())){onAddConcept(nc.trim());toggle("ictConcepts",nc.trim());setNC("");}}} style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"8px 11px",color:"#e2e8f0",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none",boxSizing:"border-box"}}/>{nc.trim()&&!allC.includes(nc.trim())&&<Btn variant="success" style={{padding:"7px 12px",fontSize:10}} onClick={()=>{onAddConcept(nc.trim());toggle("ictConcepts",nc.trim());setNC("");}}>+ Save</Btn>}</div><div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"rgba(255,255,255,0.025)",borderRadius:8,border:"1px solid rgba(255,255,255,0.05)"}}><span style={ulbl}>Confluence</span><div style={{display:"flex",gap:3}}>{Array.from({length:10}).map((_,i)=>{const fill=Math.min(1,Math.max(0,form.confluenceScore-i));const bc=form.confluenceScore>=7?"#4ade80":form.confluenceScore>=4?"#fbbf24":"#f87171";return<div key={i} style={{width:18,height:8,borderRadius:2,background:fill>=1?bc:fill>0?`linear-gradient(90deg,${bc} ${fill*100}%,rgba(255,255,255,0.06) ${fill*100}%)`:"rgba(255,255,255,0.06)"}}/>;})}</div><span style={{fontSize:14,fontWeight:800,fontFamily:"'DM Mono',monospace",color:form.confluenceScore>=7?"#4ade80":form.confluenceScore>=4?"#fbbf24":form.confluenceScore>0?"#f87171":"#e2e8f0"}}>{form.confluenceScore}/10</span></div>{sec("Narrative")}<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10}}><TextArea label="Pre-Trade" value={form.preTradeNarrative} onChange={e=>set("preTradeNarrative",e.target.value)} placeholder="HTF bias? DOL?"/><TextArea label="Post-Trade" value={form.postTradeReview} onChange={e=>set("postTradeReview",e.target.value)} placeholder="What happened?"/></div><TextArea label="Partials" value={form.partials} onChange={e=>set("partials",e.target.value)} placeholder="TP1 at 1:1..."/><TextArea label="Notes" value={form.notes} onChange={e=>set("notes",e.target.value)}/><div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}><Btn variant="ghost" onClick={onCancel}>Cancel</Btn><Btn variant="primary" onClick={()=>onSave(form)}>Save Trade</Btn></div></div>;}

// ─── ACCOUNT FORM ─────────────────────────────────────────────────────────────
function AccountForm({account,onSave,onCancel}){const{isMobile}=useIsMobile();const[form,setForm]=useState(account||{id:"",name:"",firm:"",size:0,maxLoss:0,dailyLoss:0,profitTarget:0,currentBalance:0,phase:"Evaluation",status:"Active",balanceHistory:[]});const set=(k,v)=>setForm(f=>({...f,[k]:v}));return<div style={{display:"flex",flexDirection:"column",gap:12}}><div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10}}><Input label="Account Name" value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Apex 50K #1"/><Select label="Firm" value={form.firm} onChange={e=>set("firm",e.target.value)} options={FIRMS}/><Select label="Phase" value={form.phase} onChange={e=>set("phase",e.target.value)} options={PHASES}/><Select label="Status" value={form.status} onChange={e=>set("status",e.target.value)} options={["Active","Breached","Passed","Payout"]}/><Input label="Account Size ($)" type="number" value={form.size} onChange={e=>set("size",+e.target.value)}/><Input label="Current Balance ($)" type="number" value={form.currentBalance} onChange={e=>set("currentBalance",+e.target.value)}/><Input label="Max DD ($)" type="number" value={form.maxLoss} onChange={e=>set("maxLoss",+e.target.value)}/><Input label="Daily Limit ($)" type="number" value={form.dailyLoss} onChange={e=>set("dailyLoss",+e.target.value)}/><Input label="Profit Target ($)" type="number" value={form.profitTarget} onChange={e=>set("profitTarget",+e.target.value)}/></div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={onCancel}>Cancel</Btn><Btn variant="primary" onClick={()=>onSave(form)}>Save</Btn></div></div>;}

// ─── SETTINGS MODAL ───────────────────────────────────────────────────────────
function SettingsModal({ onClose, user, username, avatarUrl, trades, accounts, customModels, customConcepts, onProfileSaved, customization, onCustomizationSaved }) {
  const [tab, setTab] = useState("profile");
  const [uname, setUname] = useState(username || "");
  const [avUrl, setAvUrl] = useState(avatarUrl || "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef();
  const csvRef = useRef();

  // Customization state
  const [accent, setAccent] = useState(customization?.accent || "#38bdf8");
  const [cardStyle, setCardStyle] = useState(customization?.cardStyle || "glass");
  const [compactMode, setCompactMode] = useState(customization?.compactMode || false);
  const [showWelcome, setShowWelcome] = useState(customization?.showWelcome !== false);
  const [defaultSession, setDefaultSession] = useState(customization?.defaultSession || "NY AM");
  const [defaultInstrument, setDefaultInstrument] = useState(customization?.defaultInstrument || "NQ");
  const [savingCustom, setSavingCustom] = useState(false);

  const saveProfile = async () => {
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ username: uname, avatar_url: avUrl }).eq("id", user.id);
    setSaving(false);
    if (!error) { setSaveMsg("Saved!"); onProfileSaved(uname, avUrl); setTimeout(() => setSaveMsg(""), 2000); }
    else setSaveMsg("Error saving.");
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    setSaving(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (!upErr) {
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvUrl(publicUrl);
    } else {
      setSaveMsg("Upload error — set avatar URL manually instead.");
    }
    setSaving(false);
  };

  const handleImportJSON = async (file) => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const tradesArr = Array.isArray(data) ? data : (data.trades || []);
      let count = 0;
      for (const t of tradesArr) {
        const row = tradeToDb(t, user.id);
        const { error } = await supabase.from("trades").insert(row);
        if (!error) count++;
      }
      setSaveMsg(`Imported ${count} trades.`);
    } catch (e) { setSaveMsg("Import failed: invalid JSON."); }
    setImporting(false);
    setTimeout(() => setSaveMsg(""), 3000);
  };

  const handleImportCSV = async (file) => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.trim().split("\n");
      let count = 0;
      for (const line of lines.slice(1)) {
        const [date,time,instrument,session,direction,contracts,entry,stop,target,exit_price,pnl,rr,grade,ictStr,emotStr,mistStr,entryModel,htfBias,chartUrl,notes] = line.split(",");
        if (!date) continue;
        const row = {
          user_id: user.id, date, time: time||"", instrument: instrument||"NQ", session: session||"NY AM",
          direction: direction||"Long", contracts: parseInt(contracts)||1, entry: parseFloat(entry)||null,
          stop: parseFloat(stop)||null, target: parseFloat(target)||null, exit_price: parseFloat(exit_price)||null,
          pnl: parseFloat(pnl)||0, rr: rr||"", grade: grade||"B",
          ict_concepts: ictStr ? ictStr.split(";").filter(Boolean) : [],
          emotions: emotStr ? emotStr.split(";").filter(Boolean) : ["Calm"],
          mistakes: mistStr ? mistStr.split(";").filter(Boolean) : [],
          entry_model: entryModel||"", htf_bias: htfBias||"", chart_url: chartUrl||"",
          notes: (notes||"").replace(/^"|"$/g,"").replace(/""/g,'"'),
          rules_followed: [], confluence_score: 0, pre_trade_narrative: "", post_trade_review: "", partials: "",
        };
        const { error } = await supabase.from("trades").insert(row);
        if (!error) count++;
      }
      setSaveMsg(`Imported ${count} trades. Refresh to see them.`);
    } catch (e) { setSaveMsg("Import failed."); }
    setImporting(false);
    setTimeout(() => setSaveMsg(""), 3000);
  };

  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "data", label: "Data" },
    { id: "customize", label: "Customize" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 16 }}>Settings</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, padding: "10px 22px", borderBottom: "1px solid rgba(255,255,255,0.06)", justifyContent: "center" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "'Space Grotesk',sans-serif", background: tab === t.id ? "rgba(56,189,248,0.15)" : "transparent", color: tab === t.id ? "#38bdf8" : "rgba(255,255,255,0.4)" }}>{t.label}</button>
          ))}
        </div>

        <div style={{ padding: "22px" }}>
          {/* ── PROFILE TAB ── */}
          {tab === "profile" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Avatar preview - centered, clickable for upload */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => uploadAvatar(e.target.files?.[0])} />
                <div onClick={() => fileRef.current?.click()} style={{ width: 96, height: 96, borderRadius: "50%", overflow: "hidden", background: "linear-gradient(135deg,#0ea5e9,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, fontWeight: 800, color: "#fff", flexShrink: 0, cursor: "pointer", position: "relative" }} title="Click to upload photo"
                  onMouseEnter={e => { e.currentTarget.querySelector('.av-overlay').style.opacity = 1; }}
                  onMouseLeave={e => { e.currentTarget.querySelector('.av-overlay').style.opacity = 0; }}
                >
                  {avUrl ? <img src={avUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setAvUrl("")} /> : (uname?.[0] || user?.email?.[0] || "?").toUpperCase()}
                  <div className="av-overlay" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.2s", borderRadius: "50%" }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span style={{ fontSize: 10, color: "#fff", fontWeight: 600, marginTop: 4 }}>Upload</span>
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{uname || user?.email}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{user?.email}</div>
                </div>
              </div>

              <Input label="Username" value={uname} onChange={e => setUname(e.target.value)} placeholder="your_username" />

              {saveMsg && <div style={{ fontSize: 12, color: saveMsg.includes("Error") || saveMsg.includes("error") ? "#f87171" : "#4ade80", background: saveMsg.includes("Error") || saveMsg.includes("error") ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)", padding: "8px 12px", borderRadius: 6 }}>{saveMsg}</div>}
              <Btn variant="primary" onClick={saveProfile} style={{ opacity: saving ? 0.6 : 1 }}>{saving ? "Saving..." : "Save Profile"}</Btn>
            </div>
          )}

          {/* ── DATA TAB ── */}
          {tab === "data" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {saveMsg && <div style={{ fontSize: 12, color: saveMsg.includes("fail") || saveMsg.includes("Error") ? "#f87171" : "#4ade80", background: saveMsg.includes("fail") || saveMsg.includes("Error") ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)", padding: "8px 12px", borderRadius: 6 }}>{saveMsg}</div>}

              {/* Import */}
              <div style={{ ...sbox }}>
                <div style={{ ...ulbl, marginBottom: 10 }}>Import</div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 12, margin: "0 0 12px" }}>Import your trades from a previously exported file. Existing trades are kept.</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={e => handleImportJSON(e.target.files?.[0])} />
                  <input ref={csvRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handleImportCSV(e.target.files?.[0])} />
                  <Btn variant="ghost" style={{ fontSize: 11, padding: "8px 14px", opacity: importing ? 0.5 : 1 }} onClick={() => fileRef.current?.click()}>📂 Import JSON</Btn>
                  <Btn variant="ghost" style={{ fontSize: 11, padding: "8px 14px", opacity: importing ? 0.5 : 1 }} onClick={() => csvRef.current?.click()}>📂 Import CSV</Btn>
                </div>
                {importing && <div style={{ fontSize: 11, color: "#38bdf8", marginTop: 8 }}>Importing...</div>}
              </div>

              {/* Export */}
              <div style={{ ...sbox }}>
                <div style={{ ...ulbl, marginBottom: 10 }}>Export</div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "0 0 12px" }}>Download a backup of all your journal data.</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <Btn variant="success" style={{ fontSize: 11, padding: "8px 14px" }} onClick={() => exportJSON(trades, accounts, customModels, customConcepts)}>⬇ Export JSON</Btn>
                  <Btn variant="success" style={{ fontSize: 11, padding: "8px 14px" }} onClick={() => exportCSV(trades)}>⬇ Export CSV</Btn>
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 8 }}>{trades.length} trades · {accounts.length} accounts</div>
              </div>
            </div>
          )}

          {/* ── CUSTOMIZE TAB ── */}
          {tab === "customize" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Accent Color */}
              <div style={sbox}>
                <div style={{ ...ulbl, marginBottom: 10 }}>Accent Color</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[["#38bdf8","Sky Blue"],["#6366f1","Indigo"],["#4ade80","Green"],["#f59e0b","Amber"],["#f87171","Red"],["#c084fc","Purple"],["#fb923c","Orange"],["#e2e8f0","White"]].map(([c, name]) => (
                    <button key={c} onClick={() => setAccent(c)} title={name} style={{ width: 28, height: 28, borderRadius: "50%", background: c, border: accent === c ? `3px solid #fff` : "3px solid transparent", cursor: "pointer", boxShadow: accent === c ? `0 0 0 2px ${c}` : "none", transition: "all 0.15s" }} />
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Custom:</span>
                    <input type="color" value={accent} onChange={e => setAccent(e.target.value)} style={{ width: 28, height: 28, borderRadius: "50%", border: "none", cursor: "pointer", background: "none", padding: 0 }} />
                  </div>
                </div>
              </div>

              {/* Card Style */}
              <div style={sbox}>
                <div style={{ ...ulbl, marginBottom: 10 }}>Card Style</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[["glass","Glass"],["solid","Solid"],["outline","Outline"]].map(([v, l]) => (
                    <button key={v} onClick={() => setCardStyle(v)} style={{ padding: "7px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: cardStyle === v ? "none" : "1px solid rgba(255,255,255,0.1)", background: cardStyle === v ? "rgba(56,189,248,0.15)" : "transparent", color: cardStyle === v ? "#38bdf8" : "rgba(255,255,255,0.4)", cursor: "pointer" }}>{l}</button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 6 }}>Controls background style of dashboard cards</div>
              </div>

              {/* Compact Mode */}
              <div style={sbox}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ ...ulbl, marginBottom: 2 }}>Compact Mode</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Reduce padding and spacing for more data density</div>
                  </div>
                  <button onClick={() => setCompactMode(p => !p)} style={{ width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer", background: compactMode ? "#38bdf8" : "rgba(255,255,255,0.1)", position: "relative", transition: "background 0.2s" }}>
                    <div style={{ position: "absolute", top: 3, left: compactMode ? 20 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                  </button>
                </div>
              </div>

              {/* Show Welcome */}
              <div style={sbox}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ ...ulbl, marginBottom: 2 }}>Show Greeting</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Show "Hello, username" on the dashboard</div>
                  </div>
                  <button onClick={() => setShowWelcome(p => !p)} style={{ width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer", background: showWelcome ? "#38bdf8" : "rgba(255,255,255,0.1)", position: "relative", transition: "background 0.2s" }}>
                    <div style={{ position: "absolute", top: 3, left: showWelcome ? 20 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                  </button>
                </div>
              </div>

              {/* Default Trade Defaults */}
              <div style={sbox}>
                <div style={{ ...ulbl, marginBottom: 10 }}>Trade Form Defaults</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ ...ulbl, display: "block", marginBottom: 4 }}>Default Session</label>
                    <select value={defaultSession} onChange={e => setDefaultSession(e.target.value)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "8px 10px", color: "#e2e8f0", fontSize: 12, fontFamily: "'DM Mono',monospace", outline: "none", width: "100%" }}>
                      {SESSIONS.map(s => <option key={s} value={s} style={{ background: "#111" }}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...ulbl, display: "block", marginBottom: 4 }}>Default Instrument</label>
                    <select value={defaultInstrument} onChange={e => setDefaultInstrument(e.target.value)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "8px 10px", color: "#e2e8f0", fontSize: 12, fontFamily: "'DM Mono',monospace", outline: "none", width: "100%" }}>
                      {INSTRUMENTS.map(i => <option key={i} value={i} style={{ background: "#111" }}>{i}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Custom Models */}
              <div style={sbox}>
                <div style={{ ...ulbl, marginBottom: 6 }}>Custom Entry Models ({customModels.length})</div>
                {customModels.length > 0
                  ? <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{customModels.map(m => <span key={m} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: "rgba(56,189,248,0.12)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.2)" }}>{m}</span>)}</div>
                  : <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>None yet — add them in the trade form</div>}
              </div>

              {/* Custom Concepts */}
              <div style={sbox}>
                <div style={{ ...ulbl, marginBottom: 6 }}>Custom ICT Concepts ({customConcepts.length})</div>
                {customConcepts.length > 0
                  ? <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{customConcepts.map(c => <span key={c} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: "rgba(168,85,247,0.12)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.2)" }}>{c}</span>)}</div>
                  : <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>None yet — add them in the trade form</div>}
              </div>

              {saveMsg && <div style={{ fontSize: 12, color: "#4ade80", background: "rgba(34,197,94,0.08)", padding: "8px 12px", borderRadius: 6 }}>{saveMsg}</div>}
              <Btn variant="primary" onClick={async () => {
                setSavingCustom(true);
                const cfg = { accent, cardStyle, compactMode, showWelcome, defaultSession, defaultInstrument };
                await supabase.from("profiles").update({ customization: cfg }).eq("id", user.id);
                onCustomizationSaved(cfg);
                setSaveMsg("Customization saved!");
                setSavingCustom(false);
                setTimeout(() => setSaveMsg(""), 2000);
              }} style={{ opacity: savingCustom ? 0.6 : 1 }}>{savingCustom ? "Saving..." : "Save Customization"}</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── USERNAME SETUP MODAL ─────────────────────────────────────────────────────
function UsernameSetupModal({ onSave }) {
  const [uname, setUname] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
      <div style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, width: "100%", maxWidth: 380, padding: 28 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>👋</div>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Welcome! Set your username</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>This is how you'll appear in the journal</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input label="Username" value={uname} onChange={e => setUname(e.target.value)} placeholder="your_username" onKeyDown={e => { if (e.key === "Enter" && uname.trim()) { setSaving(true); onSave(uname.trim()); } }} />
          <Btn variant="primary" onClick={() => { if (uname.trim()) { setSaving(true); onSave(uname.trim()); } }} style={{ opacity: saving ? 0.6 : 1 }}>{saving ? "Saving..." : "Continue"}</Btn>
          <button onClick={() => onSave("")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 11, cursor: "pointer" }}>Skip for now</button>
        </div>
      </div>
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const handleGoogle = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) { setErr(error.message); setLoading(false); }
  };

  const go = async () => {
    setLoading(true);
    setErr("");
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email, password: pass,
          options: { data: { username } }
        });
        if (error) throw error;
        // If auto-confirmed, update profile username immediately
        if (data?.user && username) {
          await supabase.from("profiles").update({ username }).eq("id", data.user.id);
        }
        if (!data?.session) {
          setErr("Check your email to confirm, then log in.");
          setMode("login");
          setLoading(false);
          return;
        }
      }
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, height: "100vh", width: "100vw", background: "#000000", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono',monospace", padding: 20, zIndex: 9999 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg,#0ea5e9,#6366f1)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, fontFamily: "'Space Grotesk',sans-serif", color: "#fff", marginBottom: 16 }}>J</div>
          <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 24, fontWeight: 700, color: "#e2e8f0", margin: "0 0 4px" }}>ICT Journal</h1>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, margin: 0 }}>Futures · Prop Firm Tracker</p>
        </div>

        <div style={{ padding: 28 }}>
          {/* Tab toggle */}
          <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
            {["login", "signup"].map(m => (
              <button key={m} onClick={() => { setMode(m); setErr(""); }} style={{ flex: 1, padding: 10, borderRadius: 7, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Space Grotesk',sans-serif", background: mode === m ? "rgba(255,255,255,0.07)" : "transparent", color: mode === m ? "#e2e8f0" : "rgba(255,255,255,0.3)" }}>
                {m === "login" ? "Log In" : "Sign Up"}
              </button>
            ))}
          </div>

          {/* Google sign in */}
          <button onClick={handleGoogle} disabled={loading} style={{ width: "100%", padding: "11px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16, fontFamily: "'Space Grotesk',sans-serif" }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continue with Google
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "signup" && (
              <Input label="Username" value={username} onChange={e => setUsername(e.target.value)} placeholder="your_username" />
            )}
            <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" />
            <Input label="Password" type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••" onKeyDown={e => { if (e.key === "Enter") go(); }} />
            {err && <div style={{ fontSize: 12, color: err.includes("Check") ? "#4ade80" : "#f87171", padding: "8px 12px", background: err.includes("Check") ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", borderRadius: 6 }}>{err}</div>}
            <Btn variant="primary" onClick={go} style={{ width: "100%", marginTop: 4, opacity: loading ? 0.6 : 1 }}>{loading ? "..." : (mode === "login" ? "Log In" : "Create Account")}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function TradingJournal() {
  const [user, setUser] = useState(null);
  const [authLoading, setAL] = useState(true);
  const [trades, setTrades] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [customModels, setCM] = useState([]);
  const [customConcepts, setCC] = useState([]);
  const [view, setView] = useState("dashboard");
  const [editItem, setEI] = useState(null);
  const [filter, setFilter] = useState({ instrument: "", session: "", emotion: "", concept: "" });
  const [selectedDay, setSD] = useState(null);
  const [mobileMenu, setMM] = useState(false);
  const [dbLoading, setDL] = useState(false);
  const { isMobile, isTablet } = useIsMobile();

  // New state
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [customization, setCustomization] = useState({ accent: "#38bdf8", cardStyle: "glass", compactMode: false, showWelcome: true, defaultSession: "NY AM", defaultInstrument: "NQ" });
  const userMenuRef = useRef();
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeout = useRef(null);
  const handleScroll = () => { setIsScrolling(true); if (scrollTimeout.current) clearTimeout(scrollTimeout.current); scrollTimeout.current = setTimeout(() => setIsScrolling(false), 800); };

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user || null); setAL(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user || null));
    return () => subscription.unsubscribe();
  }, []);

  // Load data
  useEffect(() => {
    if (!user) return;
    (async () => {
      setDL(true);
      const [{ data: tD }, { data: aD }, { data: pD }] = await Promise.all([
        supabase.from("trades").select("*").eq("user_id", user.id).order("date", { ascending: false }),
        supabase.from("accounts").select("*").eq("user_id", user.id),
        supabase.from("profiles").select("*").eq("id", user.id).single()
      ]);
      const loadedTrades = (tD || []).map(dbToTrade);
      const rawAccounts = (aD || []).map(dbToAccount);

      // Rebuild balance histories from actual trades (fixes sparkline accuracy)
      const rebuiltAccounts = rawAccounts.map(acc => {
        const { balanceHistory, currentBalance } = buildBalanceHistory(acc, loadedTrades);
        return { ...acc, balanceHistory, currentBalance };
      });

      setTrades(loadedTrades);
      setAccounts(rebuiltAccounts);
      setCM(pD?.custom_models || []);
      setCC(pD?.custom_concepts || []);
      const un = pD?.username || "";
      const av = pD?.avatar_url || "";
      setUsername(un);
      setAvatarUrl(av);
      if (pD?.customization) setCustomization(prev => ({ ...prev, ...pD.customization }));
      // Prompt for username if signed in with Google or missing
      if (!un) setNeedsUsername(true);
      setDL(false);
    })();
  }, [user]);

  // Close user menu on outside click
  useEffect(() => {
    const handler = (e) => { if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Helper: rebuild and sync account balance history after any trade change
  const syncAccountHistory = useCallback(async (accountId, updatedTrades, currentAccounts) => {
    const acc = currentAccounts.find(a => a.id === accountId);
    if (!acc) return currentAccounts;
    const { balanceHistory, currentBalance } = buildBalanceHistory(acc, updatedTrades);
    await supabase.from("accounts").update({ current_balance: currentBalance, balance_history: balanceHistory }).eq("id", accountId);
    return currentAccounts.map(a => a.id === accountId ? { ...a, balanceHistory, currentBalance } : a);
  }, []);

  // Trade CRUD
  const addTrade = async (f) => {
    const row = tradeToDb(f, user.id);
    const { data, error } = await supabase.from("trades").insert(row).select().single();
    if (error) { alert(error.message); return; }
    const newTrade = dbToTrade(data);
    const newTrades = [newTrade, ...trades];
    setTrades(newTrades);
    if (f.accountId) {
      const updated = await syncAccountHistory(f.accountId, newTrades, accounts);
      setAccounts(updated);
    }
  };

  const updateTrade = async (f) => {
    const row = tradeToDb(f, user.id);
    delete row.user_id;
    await supabase.from("trades").update(row).eq("id", f.id);
    const newTrades = trades.map(t => t.id === f.id ? { ...f } : t);
    setTrades(newTrades);
    // Sync all affected accounts (old and new)
    const old = trades.find(t => t.id === f.id);
    const affectedIds = [...new Set([old?.accountId, f.accountId].filter(Boolean))];
    let acc = accounts;
    for (const id of affectedIds) { acc = await syncAccountHistory(id, newTrades, acc); }
    setAccounts(acc);
  };

  const deleteTrade = async (id) => {
    const del = trades.find(t => t.id === id);
    await supabase.from("trades").delete().eq("id", id);
    const newTrades = trades.filter(t => t.id !== id);
    setTrades(newTrades);
    if (del?.accountId) {
      const updated = await syncAccountHistory(del.accountId, newTrades, accounts);
      setAccounts(updated);
    }
  };

  // Account CRUD
  const addAccount = async (f) => {
    const row = accountToDb({ ...f, balanceHistory: [f.currentBalance] }, user.id);
    const { data, error } = await supabase.from("accounts").insert(row).select().single();
    if (error) { alert(error.message); return; }
    setAccounts(p => [...p, dbToAccount(data)]);
  };

  const updateAccount = async (f) => {
    const row = accountToDb(f, user.id);
    delete row.user_id;
    await supabase.from("accounts").update(row).eq("id", f.id);
    setAccounts(p => p.map(a => a.id === f.id ? f : a));
  };

  const deleteAccount = async (id) => {
    await supabase.from("accounts").delete().eq("id", id);
    setAccounts(p => p.filter(a => a.id !== id));
  };

  const saveModel = async (m) => { const u = [...customModels, m]; setCM(u); await supabase.from("profiles").update({ custom_models: u }).eq("id", user.id); };
  const saveConcept = async (c) => { const u = [...customConcepts, c]; setCC(u); await supabase.from("profiles").update({ custom_concepts: u }).eq("id", user.id); };

  const handleSetUsername = async (un) => {
    if (un) {
      await supabase.from("profiles").update({ username: un }).eq("id", user.id);
      setUsername(un);
    }
    setNeedsUsername(false);
  };

  // Filtered trades
  const filtered = trades.filter(t => {
    if (filter.instrument && t.instrument !== filter.instrument) return false;
    if (filter.session && t.session !== filter.session) return false;
    if (filter.emotion && !(t.emotions || []).includes(filter.emotion)) return false;
    if (filter.concept && !(t.ictConcepts || []).includes(filter.concept)) return false;
    if (selectedDay && t.date !== selectedDay) return false;
    return true;
  });

  // Stats
  const totalPnl = filtered.reduce((s, t) => s + t.pnl, 0);
  const wins = filtered.filter(t => t.pnl > 0), losses = filtered.filter(t => t.pnl < 0);
  const winRate = filtered.length ? (wins.length / filtered.length * 100).toFixed(1) : "0";
  const avgWin = wins.length ? (wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(2) : "0";
  const avgLoss = losses.length ? (losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(2) : "0";
  const pf = losses.length && wins.length ? Math.abs(wins.reduce((s, t) => s + t.pnl, 0) / losses.reduce((s, t) => s + t.pnl, 0)).toFixed(2) : "--";
  const sortedAll = [...trades].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  let streak = 0;
  if (sortedAll.length) { const dir = sortedAll[0].pnl >= 0 ? 1 : -1; for (const t of sortedAll) { if ((t.pnl >= 0 ? 1 : -1) === dir) streak++; else break; } streak = dir === 1 ? streak : -streak; }
  const conceptStats = {}, sessionStats = {}, mistakeStats = {};
  filtered.forEach(t => {
    (t.ictConcepts || []).forEach(c => { if (!conceptStats[c]) conceptStats[c] = { count: 0, pnl: 0 }; conceptStats[c].count++; conceptStats[c].pnl += t.pnl; });
    if (!sessionStats[t.session]) sessionStats[t.session] = { count: 0, pnl: 0 }; sessionStats[t.session].count++; sessionStats[t.session].pnl += t.pnl;
    (t.mistakes || []).forEach(m => { mistakeStats[m] = (mistakeStats[m] || 0) + 1; });
  });

  const tCols = "85px 50px 60px 48px 42px 72px 72px 65px 45px 1fr 50px 64px";
  const navItems = [{ key: "dashboard", label: "Dashboard" }, { key: "trades", label: "Trades" }, { key: "accounts", label: "Accounts" }, { key: "montecarlo", label: "Monte Carlo" }, { key: "gallery", label: "Gallery" }];
  const isAct = k => view === k || (k === "trades" && (view === "addTrade" || view === "editTrade")) || (k === "accounts" && (view === "addAccount" || view === "editAccount"));

  // Avatar component
  const displayName = username || user?.email?.split("@")[0] || "?";
  const AvatarCircle = ({ size = 32 }) => (
    <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", background: "linear-gradient(135deg,#0ea5e9,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4, fontWeight: 800, color: "#fff", cursor: "pointer", flexShrink: 0 }}>
      {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setAvatarUrl("")} /> : displayName[0].toUpperCase()}
    </div>
  );

  if (authLoading) return <div style={{ position: "fixed", inset: 0, height: "100vh", width: "100vw", background: "#000000", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontFamily: "'DM Mono',monospace", zIndex: 9999 }}>Loading...</div>;
  if (!user) return <AuthScreen />;

  return (
    <div onScrollCapture={handleScroll} className={isScrolling ? "is-scrolling" : ""} style={{ fontFamily: "'DM Mono','JetBrains Mono',monospace", background: "#000000", color: "#e2e8f0", height: "100vh", width: "100vw", display: "flex", flexDirection: "column", overflow: "hidden", position: "fixed", inset: 0 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet" />
      <style>{`
        *{box-sizing:border-box}
        html,body,#root{height:100%;width:100%;margin:0;padding:0;overflow:hidden}
        input,select,textarea,button{font-family:inherit}
        @media(max-width:640px){.hide-mobile{display:none!important}}
        
        /* --- SLEEK MINIMAL ANIMATIONS --- */
        @keyframes smoothFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        /* Animate views smoothly on load/tab switch */
        .animated-view {
          animation: smoothFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        /* Tactile buttons & pills */
        button {
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), filter 0.2s ease, opacity 0.2s ease !important;
        }
        button:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.15);
        }
        button:active:not(:disabled) {
          transform: translateY(1px) scale(0.97);
          filter: brightness(0.9);
        }

        /* Popping inputs */
        input, select, textarea {
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        input:focus, select:focus, textarea:focus {
          border-color: var(--accent, #38bdf8) !important;
          box-shadow: 0 0 0 1px var(--accent, #38bdf8) !important;
          background: rgba(255,255,255,0.06) !important;
          transform: translateY(-1px);
        }

        :root{--accent:${customization.accent};--card-bg:${customization.cardStyle==="solid"?"rgba(20,20,28,0.98)":customization.cardStyle==="outline"?"transparent":"rgba(255,255,255,0.025)"};--card-border:${customization.cardStyle==="outline"?"1px solid rgba(255,255,255,0.12)":"1px solid rgba(255,255,255,0.06)"}}
        .accent-text{color:var(--accent)!important}
        .app-card{background:var(--card-bg)!important;border:var(--card-border)!important}
        ${customization.compactMode ? ".compact-pad{padding:10px 12px!important}.compact-gap{gap:8px!important}" : ""}
        
        /* Floating Scrollbar (Smooth fade & Hover effects) */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background-color: transparent; }
        ::-webkit-scrollbar-thumb { 
          background-color: transparent; 
          border-radius: 10px; 
          transition: background-color 0.4s ease-in-out; 
        }
        
        /* Shows up dimly when scrolling */
        .is-scrolling *::-webkit-scrollbar-thumb { 
          background-color: rgba(255,255,255,0.15); 
        }
        
        /* Gets brighter/lighter when you hover directly over the scrollbar */
        .is-scrolling *::-webkit-scrollbar-thumb:hover { 
          background-color: rgba(255,255,255,0.35); 
        }
      `}</style>

      {/* Username setup modal */}
      {needsUsername && <UsernameSetupModal onSave={handleSetUsername} />}

      {/* Settings modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          user={user}
          username={username}
          avatarUrl={avatarUrl}
          trades={trades}
          accounts={accounts}
          customModels={customModels}
          customConcepts={customConcepts}
          onProfileSaved={(un, av) => { setUsername(un); setAvatarUrl(av); }}
          customization={customization}
          onCustomizationSaved={(cfg) => setCustomization(cfg)}
        />
      )}

      {/* ── HEADER ── */}
      <div style={{ padding: isMobile ? "12px 16px" : "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.015)", flexWrap: "wrap", gap: 8 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#0ea5e9,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: isMobile ? 14 : 16, letterSpacing: "-0.02em" }}>ICT JOURNAL</div>
            {!isMobile && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Futures · Prop Firm Tracker</div>}
          </div>
        </div>

        {/* Desktop nav */}
        {isMobile ? (
          <button onClick={() => setMM(!mobileMenu)} style={{ background: "rgba(255,255,255,0.05)", border: "none", borderRadius: 6, color: "#e2e8f0", padding: "6px 10px", cursor: "pointer", fontSize: 16 }}>☰</button>
        ) : (
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {navItems.map(n => (
              <button key={n.key} onClick={() => { setView(n.key); setSD(null); }} style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "'Space Grotesk',sans-serif", background: isAct(n.key) ? "rgba(255,255,255,0.07)" : "transparent", color: isAct(n.key) ? "#e2e8f0" : "rgba(255,255,255,0.3)" }}>{n.label}</button>
            ))}
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.06)", margin: "0 6px" }} />
            {/* Settings button */}
            <button onClick={() => setShowSettings(true)} title="Settings" style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "rgba(255,255,255,0.45)", padding: "6px 10px", cursor: "pointer", fontSize: 15, lineHeight: 1 }}>⚙</button>
            {/* Avatar + dropdown */}
            <div ref={userMenuRef} style={{ position: "relative", marginLeft: 4 }}>
              <div onClick={() => setShowUserMenu(p => !p)}>
                <AvatarCircle size={34} />
              </div>
              {showUserMenu && (
                <div style={{ position: "absolute", right: 0, top: 40, background: "#151515", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, minWidth: 160, zIndex: 500, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{username || displayName}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{user.email}</div>
                  </div>
                  <button onClick={() => { setShowSettings(true); setShowUserMenu(false); }} style={{ width: "100%", padding: "10px 14px", textAlign: "left", background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>⚙ Settings</button>
                  <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", padding: "10px 14px", textAlign: "left", background: "none", border: "none", color: "#f87171", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>→ Log Out</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile menu */}
      {isMobile && mobileMenu && (
        <div style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "8px 16px", display: "flex", flexWrap: "wrap", gap: 4 }}>
          {navItems.map(n => <button key={n.key} onClick={() => { setView(n.key); setSD(null); setMM(false); }} style={{ flex: "1 1 auto", padding: "8px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "'Space Grotesk',sans-serif", textAlign: "center", background: isAct(n.key) ? "rgba(255,255,255,0.07)" : "transparent", color: isAct(n.key) ? "#e2e8f0" : "rgba(255,255,255,0.3)" }}>{n.label}</button>)}
          <button onClick={() => { setShowSettings(true); setMM(false); }} style={{ flex: "1 1 auto", padding: "8px", borderRadius: 7, fontSize: 11, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>⚙ Settings</button>
          <button onClick={() => supabase.auth.signOut()} style={{ flex: "1 1 auto", padding: "8px", borderRadius: 7, fontSize: 11, border: "1px solid rgba(239,68,68,0.2)", background: "transparent", color: "#f87171", cursor: "pointer" }}>Log Out</button>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      {dbLoading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.2)" }}>Loading data...</div>
      ) : (
        <div key={view} className="animated-view" style={{ padding: isMobile ? "16px" : "20px 24px", flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", minHeight: 0 }}>

          {/* DASHBOARD */}
          {view === "dashboard" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <div style={{ flex: 1, textAlign: "center" }}>
                  {customization.showWelcome !== false && username && <div style={{ fontSize: 26, fontWeight: 400, color: "rgba(255,255,255,0.4)", fontFamily: "'Space Grotesk',sans-serif", marginBottom: 4 }}>Hello, <span style={{ color: customization.accent || "#38bdf8", fontWeight: 700 }}>{username}</span></div>}
                  <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Dashboard</h2>
                  {selectedDay && <button onClick={() => setSD(null)} style={{ background: "none", border: "none", color: customization.accent || "#38bdf8", fontSize: 11, cursor: "pointer", padding: 0, marginTop: 4, display: "block", textAlign: "center", width: "100%" }}>Showing {selectedDay} — clear</button>}
                </div>
                <Btn variant="primary" onClick={() => setView("addTrade")}>+ New Trade</Btn>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Pill label="All" active={!filter.instrument} onClick={() => setFilter(f => ({ ...f, instrument: "" }))} />
                {INSTRUMENTS.map(i => <Pill key={i} label={i} active={filter.instrument === i} onClick={() => setFilter(f => ({ ...f, instrument: i }))} />)}
                <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.06)", margin: "0 4px" }} />
                <Pill label="All Sessions" active={!filter.session} onClick={() => setFilter(f => ({ ...f, session: "" }))} />
                {SESSIONS.map(s => <Pill key={s} label={s} active={filter.session === s} onClick={() => setFilter(f => ({ ...f, session: s }))} />)}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <StatCard label="Total P&L" value={`$${totalPnl.toFixed(2)}`} accent={totalPnl >= 0 ? "#4ade80" : "#f87171"} />
                <StatCard label="Win Rate" value={`${winRate}%`} sub={`${wins.length}W / ${losses.length}L`} accent="#38bdf8" />
                <StatCard label="Profit Factor" value={pf} accent="#c084fc" />
                <StatCard label="Avg W/L" value={`$${avgWin}`} sub={`L: $${avgLoss}`} accent="#fbbf24" />
                <StatCard label="Streak" value={streak > 0 ? `${streak}W` : streak < 0 ? `${Math.abs(streak)}L` : "--"} accent={streak > 0 ? "#4ade80" : streak < 0 ? "#f87171" : "#e2e8f0"} sub={`${trades.length} total`} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                <PnlCalendar trades={trades} onDayClick={d => setSD(d === selectedDay ? null : d)} />
                <div style={{...sbox, display: "flex", flexDirection: "column"}}>
                  <div style={{ ...ulbl, marginBottom: 10 }}>Equity Curve</div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <EquityCurve trades={filtered} />
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "1fr 1fr 1fr", gap: 14 }}>
                <div style={sbox}><div style={{ ...ulbl, marginBottom: 10 }}>By Session</div>{SESSIONS.map(s => { const d = sessionStats[s]; return d ? <div key={s} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12 }}><span>{s}</span><span style={{ color: d.pnl >= 0 ? "#4ade80" : "#f87171", fontWeight: 600 }}>${d.pnl.toFixed(0)} ({d.count})</span></div> : <div key={s} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12 }}><span style={{ color: "rgba(255,255,255,0.35)" }}>{s}</span><span style={{ color: "rgba(255,255,255,0.2)", fontWeight: 600 }}>$0 (0)</span></div>; })}</div>
                <div style={sbox}><div style={{ ...ulbl, marginBottom: 10 }}>Top ICT Concepts</div>{Object.entries(conceptStats).length ? Object.entries(conceptStats).sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 6).map(([c, d]) => <div key={c} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12 }}><span style={{ color: "#c084fc" }}>{c}</span><span style={{ color: d.pnl >= 0 ? "#4ade80" : "#f87171", fontWeight: 600 }}>${d.pnl.toFixed(0)} ({d.count})</span></div>) : <div style={{ color: "rgba(255,255,255,0.15)", fontSize: 11 }}>No data</div>}</div>
                <div style={sbox}><div style={{ ...ulbl, marginBottom: 10 }}>Top Mistakes</div>{Object.entries(mistakeStats).length ? Object.entries(mistakeStats).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m, c]) => <div key={m} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12 }}><span style={{ color: "#f87171" }}>{m}</span><span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>{c}x</span></div>) : <div style={{ color: "rgba(255,255,255,0.15)", fontSize: 11 }}>No data</div>}</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                <DayOfWeekWidget trades={filtered} />
                <TimeOfDayWidget trades={filtered} />
              </div>

              {/* Active Accounts */}
              {accounts.filter(a => a.status === "Active").length > 0 && (
                <div style={sbox}>
                  <div style={{ ...ulbl, marginBottom: 10 }}>Active Accounts</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 10 }}>
                    {accounts.filter(a => a.status === "Active").map(a => (
                      <div key={a.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "'Space Grotesk',sans-serif" }}>{a.name}</span>
                          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, fontWeight: 700, background: a.phase === "Funded" ? "rgba(34,197,94,0.12)" : "rgba(56,189,248,0.12)", color: a.phase === "Funded" ? "#4ade80" : "#38bdf8" }}>{a.phase}</span>
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>{a.firm} · ${a.size.toLocaleString()}</div>
                        <Sparkline data={a.balanceHistory} />
                        <AccountProgress account={a} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TRADES */}
          {view === "trades" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Trade Log</h2>
                <Btn variant="primary" onClick={() => setView("addTrade")}>+ New Trade</Btn>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <Pill label="All" active={!filter.instrument} onClick={() => setFilter(f => ({ ...f, instrument: "" }))} />
                {INSTRUMENTS.map(i => <Pill key={i} label={i} active={filter.instrument === i} onClick={() => setFilter(f => ({ ...f, instrument: i }))} />)}
                <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.06)", margin: "0 3px" }} />
                <Select value={filter.session} onChange={e => setFilter(f => ({ ...f, session: e.target.value }))} options={[{ value: "", label: "All Sessions" }, ...SESSIONS.map(s => ({ value: s, label: s }))]} style={{ padding: "5px 8px", fontSize: 11, maxWidth: 140 }} />
                <Select value={filter.emotion} onChange={e => setFilter(f => ({ ...f, emotion: e.target.value }))} options={[{ value: "", label: "Emotion" }, ...EMOTIONS.map(e => ({ value: e, label: e }))]} style={{ padding: "5px 8px", fontSize: 11, maxWidth: 130 }} />
                <Select value={filter.concept} onChange={e => setFilter(f => ({ ...f, concept: e.target.value }))} options={[{ value: "", label: "Concept" }, ...[...ICT_CONCEPTS, ...customConcepts].map(c => ({ value: c, label: c }))]} style={{ padding: "5px 8px", fontSize: 11, maxWidth: 140 }} />
              </div>
              <div style={{ ...sbox, padding: 0, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
                <div style={{ display: "grid", gridTemplateColumns: tCols, minWidth: 780, padding: "8px 14px", fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <span>Date</span><span>Instr</span><span>Sess</span><span>Dir</span><span>Ctrs</span><span>Entry</span><span>Exit</span><span>P&L</span><span>R:R</span><span>Model</span><span>Chart</span><span></span>
                </div>
                {filtered.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).map(t => (
                  <div key={t.id} style={{ display: "grid", gridTemplateColumns: tCols, minWidth: 780, padding: "8px 14px", fontSize: 12, borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center" }}>
                    <span style={{ fontSize: 11 }}>{t.date}</span>
                    <span style={{ fontWeight: 700, color: "#38bdf8" }}>{t.instrument}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{t.session}</span>
                    <span style={{ color: t.direction === "Long" ? "#4ade80" : "#f87171", fontWeight: 700, fontSize: 10 }}>{t.direction === "Long" ? "L" : "S"}</span>
                    <span>{t.contracts}</span>
                    <span style={{ fontSize: 11 }}>{t.entry}</span>
                    <span style={{ fontSize: 11 }}>{t.exit}</span>
                    <span style={{ fontWeight: 700, color: t.pnl >= 0 ? "#4ade80" : "#f87171" }}>${t.pnl}</span>
                    <span style={{ fontSize: 10, color: "#fbbf24" }}>{t.rr}</span>
                    <span style={{ fontSize: 9, color: "#38bdf8" }}>{t.entryModel ? (t.entryModel.length > 12 ? t.entryModel.slice(0, 10) + ".." : t.entryModel) : ""}</span>
                    <span>{t.chartUrl ? <a href={t.chartUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#c084fc", textDecoration: "none" }}>View</a> : ""}</span>
                    <div style={{ display: "flex", gap: 3 }}>
                      <button onClick={() => { setEI(t); setView("editTrade"); }} style={{ background: "rgba(255,255,255,0.05)", border: "none", borderRadius: 4, color: "rgba(255,255,255,0.4)", padding: "3px 7px", cursor: "pointer", fontSize: 10 }}>Edit</button>
                      <button onClick={() => { if (confirm("Delete?")) deleteTrade(t.id); }} style={{ background: "rgba(239,68,68,0.08)", border: "none", borderRadius: 4, color: "#f87171", padding: "3px 7px", cursor: "pointer", fontSize: 10 }}>×</button>
                    </div>
                  </div>
                ))}
                {!filtered.length && <div style={{ padding: 36, textAlign: "center", color: "rgba(255,255,255,0.15)", fontSize: 12 }}>No trades</div>}
              </div>
            </div>
          )}

          {/* ADD / EDIT TRADE */}
          {(view === "addTrade" || view === "editTrade") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>{view === "addTrade" ? "Log Trade" : "Edit Trade"}</h2>
              <div style={{ ...sbox, padding: 22 }}>
                <TradeForm trade={view === "editTrade" ? editItem : null} accounts={accounts} customModels={customModels} customConcepts={customConcepts}
                  defaultSession={customization.defaultSession} defaultInstrument={customization.defaultInstrument}
                  onSave={async f => { if (view === "editTrade") await updateTrade(f); else await addTrade(f); setView("trades"); }}
                  onCancel={() => setView("trades")} onAddModel={saveModel} onAddConcept={saveConcept} />
              </div>
            </div>
          )}

          {/* ACCOUNTS */}
          {view === "accounts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Prop Firm Accounts</h2>
                <Btn variant="primary" onClick={() => setView("addAccount")}>+ New Account</Btn>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
                {accounts.map(a => (
                  <div key={a.id} style={{ ...sbox, padding: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15 }}>{a.name || "Unnamed"}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{a.firm}</div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: a.status === "Active" ? "rgba(34,197,94,0.1)" : a.status === "Breached" ? "rgba(239,68,68,0.1)" : "rgba(251,191,36,0.1)", color: a.status === "Active" ? "#4ade80" : a.status === "Breached" ? "#f87171" : "#fbbf24" }}>{a.status}</span>
                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: "rgba(99,102,241,0.1)", color: "#a5b4fc" }}>{a.phase}</span>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 12 }}>
                      {[["Size", `$${a.size.toLocaleString()}`, null], ["Balance", `$${a.currentBalance.toLocaleString()}`, a.currentBalance >= a.size ? "#4ade80" : "#f87171"], ["Max DD", `$${a.maxLoss.toLocaleString()}`, "#f87171"], ["Daily", `$${a.dailyLoss.toLocaleString()}`, "#fbbf24"]].map(([l, v, c]) => (
                        <div key={l}><div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>{l}</div><div style={{ fontSize: l === "Size" || l === "Balance" ? 15 : 13, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: c || "#e2e8f0" }}>{v}</div></div>
                      ))}
                    </div>
                    <Sparkline data={a.balanceHistory} />
                    <AccountProgress account={a} />
                    <div style={{ display: "flex", gap: 5, marginTop: 12 }}>
                      <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 10 }} onClick={() => { setEI(a); setView("editAccount"); }}>Edit</Btn>
                      <Btn variant="danger" style={{ padding: "5px 10px", fontSize: 10 }} onClick={() => { if (confirm("Delete?")) deleteAccount(a.id); }}>Delete</Btn>
                    </div>
                  </div>
                ))}
              </div>
              {!accounts.length && <div style={{ padding: 50, textAlign: "center", color: "rgba(255,255,255,0.15)", fontSize: 12, ...sbox }}>No accounts yet.</div>}
            </div>
          )}

          {/* ADD / EDIT ACCOUNT */}
          {(view === "addAccount" || view === "editAccount") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>{view === "addAccount" ? "Add Account" : "Edit Account"}</h2>
              <div style={{ ...sbox, padding: 22 }}>
                <AccountForm account={view === "editAccount" ? editItem : null}
                  onSave={async f => { if (view === "editAccount") await updateAccount(f); else await addAccount(f); setView("accounts"); }}
                  onCancel={() => setView("accounts")} />
              </div>
            </div>
          )}

          {/* MONTE CARLO */}
          {view === "montecarlo" && <MonteCarloSim trades={trades} />}

          {/* GALLERY */}
          {view === "gallery" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Trade Gallery</h2>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
                {trades.filter(t => t.chartUrl).sort((a,b) => (b.date+b.time).localeCompare(a.date+a.time)).map(t => (
                  <div key={t.id} className="app-card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", borderRadius: 10, transition: "transform 0.2s" }} onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"} onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
                    <a href={t.chartUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", height: 160, background: "rgba(0,0,0,0.2)", position: "relative" }} title="Click to open link">
                      <img src={t.chartUrl} alt="Chart" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e)=>{e.target.src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'><rect width='100%25' height='100%25' fill='%230a0a0a'/><text x='50%25' y='50%25' fill='%23555' font-family='monospace' font-size='11' text-anchor='middle' dominant-baseline='middle'>Invalid Image (Click to open link)</text></svg>";}} />
                    </a>
                    <div style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <span style={{ fontWeight: 800, fontSize: 16, fontFamily: "'DM Mono',monospace", color: t.pnl >= 0 ? "#4ade80" : "#f87171" }}>{t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}</span>
                        <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700, background: "rgba(251,191,36,0.1)", padding: "2px 6px", borderRadius: 4 }}>{t.rr || "-- R"}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                        <div><div style={{ fontSize: 9, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>Entry</div><div style={{ color: "#e2e8f0", fontWeight: 600 }}>{t.entry || "--"}</div></div>
                        <div><div style={{ fontSize: 9, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>Stop</div><div style={{ color: "#e2e8f0", fontWeight: 600 }}>{t.stop || "--"}</div></div>
                        <div><div style={{ fontSize: 9, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>Exit</div><div style={{ color: "#e2e8f0", fontWeight: 600 }}>{t.exit || "--"}</div></div>
                      </div>
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 10, color: "rgba(255,255,255,0.3)", display: "flex", justifyContent: "space-between" }}>
                        <span>{t.date} · {t.session}</span>
                        <span style={{ color: "#38bdf8", fontWeight: 600 }}>{t.instrument} {t.direction==="Long"?"(L)":"(S)"}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {trades.filter(t => t.chartUrl).length === 0 && (
                  <div style={{ gridColumn: "1 / -1", padding: 40, textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 12, border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 10 }}>No screenshots found. Add Chart URLs to your trades to see them here!</div>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      <div style={{ padding: "10px 24px", borderTop: "1px solid rgba(255,255,255,0.03)", fontSize: 9, color: "rgba(255,255,255,0.15)", textAlign: "center", letterSpacing: "0.06em" }}>ICT JOURNAL · FUTURES · PROP FIRM TRACKER</div>
    </div>
  );
}
