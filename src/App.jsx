import { useState, useEffect, useReducer, useMemo, useCallback } from "react";

const INSTRUMENTS = ["NQ", "ES", "GC", "MNQ", "MES", "MGC"];
const SESSIONS = ["Asia", "London", "NY AM", "NY Lunch", "NY PM"];
const ICT_CONCEPTS = [
  "FVG", "OB", "BOS", "CHOCH", "Displacement", "Liquidity Sweep",
  "Silver Bullet", "ICT Killzone", "Judas Swing", "Turtle Soup",
  "Breaker Block", "Mitigation Block", "Propulsion Block",
  "NWOG/NDOG", "IFVG", "CE of Range", "PD Array", "SMT Divergence",
  "Optimal Trade Entry", "Market Maker Model", "Power of 3",
  "Asian Range", "London Sweep", "NYO Model", "STDV", "Volume Profile"
];
const EMOTIONS = ["Confident", "Patient", "Calm", "Disciplined", "Focused", "Fearful", "FOMO", "Revenge", "Anxious", "Greedy", "Frustrated", "Overconfident", "Hesitant"];
const NEGATIVE_EMOTIONS = ["Fearful", "FOMO", "Revenge", "Anxious", "Greedy", "Frustrated", "Overconfident", "Hesitant"];
const TRADE_GRADES = ["A+", "A", "B", "C", "D", "F"];
const MISTAKES = [
  "Moved Stop", "No Confirmation", "Oversized", "Revenge Trade",
  "Traded Outside Killzone", "Chased Entry", "Ignored HTF Bias",
  "Early Exit", "No Pre-Trade Plan", "Broke Daily Loss Rule",
  "Traded During News", "Widened Stop", "Averaged Down"
];
const FIRMS = ["Topstep", "Apex", "MyFundedFutures", "Take Profit Trader", "Lucid", "Alpha Futures", "Funded Next", "Other"];
const PHASES = ["Evaluation", "Combine", "Funded", "PA (Performance Account)"];
const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "Daily", "Weekly"];
const DEFAULT_MODELS = ["Silver Bullet", "ICT 2022 Model", "Turtle Soup Reversal", "AMD (Accumulation Manipulation Distribution)", "NYO Killzone Entry", "London Sweep + NY Continuation", "Power of 3"];

const RULE_CHECKLIST = [
  "Identified HTF draw on liquidity",
  "Waited for killzone",
  "Confirmed with LTF entry model",
  "Risk within 1-2% of account",
  "Set stop beyond PD array",
  "Defined target before entry",
  "Checked news calendar"
];

const DEFAULT_ACCOUNT = { id: "", name: "", firm: "", size: 0, maxLoss: 0, dailyLoss: 0, profitTarget: 0, currentBalance: 0, phase: "Evaluation", status: "Active" };
const DEFAULT_TRADE = {
  id: "", date: "", time: "", instrument: "NQ", session: "NY AM",
  direction: "Long", contracts: 1, entry: "", stop: "", target: "",
  exit: "", pnl: 0, ictConcepts: [], emotions: ["Calm"], grade: "B",
  accountId: "", notes: "", rr: "", partials: "",
  preTradeNarrative: "", postTradeReview: "",
  htfBias: "", ltfEntry: "", confluenceScore: 0,
  mistakes: [], rulesFollowed: [],
  drawOnLiquidity: "", entryModel: ""
};

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function calcRR(entry, stop, exit, direction) {
  const e = parseFloat(entry), s = parseFloat(stop), x = parseFloat(exit);
  if (isNaN(e) || isNaN(s) || isNaN(x) || e === s) return "";
  const risk = Math.abs(e - s);
  const reward = direction === "Long" ? x - e : e - x;
  return (reward / risk).toFixed(2) + "R";
}

function calcPnl(entry, exit, contracts, instrument, direction) {
  const e = parseFloat(entry), x = parseFloat(exit), c = parseInt(contracts);
  if (isNaN(e) || isNaN(x) || isNaN(c)) return 0;
  const pv = { NQ: 20, ES: 50, GC: 100, MNQ: 2, MES: 5, MGC: 10 }[instrument] || 1;
  const raw = direction === "Long" ? (x - e) : (e - x);
  return parseFloat((raw * c * pv).toFixed(2));
}

function reducer(state, action) {
  switch (action.type) {
    case "ADD_TRADE": {
      const trade = { ...action.payload, id: genId() };
      let accs = state.accounts;
      if (trade.accountId) accs = accs.map(a => a.id === trade.accountId ? { ...a, currentBalance: parseFloat((a.currentBalance + trade.pnl).toFixed(2)) } : a);
      return { ...state, trades: [...state.trades, trade], accounts: accs };
    }
    case "UPDATE_TRADE": {
      const old = state.trades.find(t => t.id === action.payload.id);
      let accs = state.accounts;
      if (old && old.accountId) accs = accs.map(a => a.id === old.accountId ? { ...a, currentBalance: parseFloat((a.currentBalance - old.pnl).toFixed(2)) } : a);
      if (action.payload.accountId) accs = accs.map(a => a.id === action.payload.accountId ? { ...a, currentBalance: parseFloat((a.currentBalance + action.payload.pnl).toFixed(2)) } : a);
      return { ...state, trades: state.trades.map(t => t.id === action.payload.id ? action.payload : t), accounts: accs };
    }
    case "DELETE_TRADE": {
      const del = state.trades.find(t => t.id === action.payload);
      let accs = state.accounts;
      if (del && del.accountId) accs = accs.map(a => a.id === del.accountId ? { ...a, currentBalance: parseFloat((a.currentBalance - del.pnl).toFixed(2)) } : a);
      return { ...state, trades: state.trades.filter(t => t.id !== action.payload), accounts: accs };
    }
    case "ADD_ACCOUNT": return { ...state, accounts: [...state.accounts, { ...action.payload, id: genId() }] };
    case "UPDATE_ACCOUNT": return { ...state, accounts: state.accounts.map(a => a.id === action.payload.id ? action.payload : a) };
    case "DELETE_ACCOUNT": return { ...state, accounts: state.accounts.filter(a => a.id !== action.payload) };
    case "ADD_MODEL": return { ...state, customModels: [...(state.customModels || []), action.payload] };
    case "DELETE_MODEL": return { ...state, customModels: (state.customModels || []).filter(m => m !== action.payload) };
    case "ADD_CONCEPT": return { ...state, customConcepts: [...(state.customConcepts || []), action.payload] };
    case "DELETE_CONCEPT": return { ...state, customConcepts: (state.customConcepts || []).filter(c => c !== action.payload) };
    case "IMPORT_DATA": return { ...action.payload };
    default: return state;
  }
}

function loadState() {
  try { 
    const saved = localStorage.getItem("ict_journal_data");
    if (saved) return JSON.parse(saved); 
  } catch (e) {
    console.error("Failed to load journal", e);
  }
  return { trades: [], accounts: [], customModels: [], customConcepts: [] };
}

// ── Responsive Hook ──
function useIsMobile() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return { isMobile: w < 640, isTablet: w < 1024, width: w };
}

// ── UI Components ──
function Pill({ label, active, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 11px", borderRadius: 6, fontSize: 11, fontWeight: 600,
      border: active ? "none" : "1px solid rgba(255,255,255,0.1)",
      background: active ? (color || "rgba(56,189,248,0.18)") : "transparent",
      color: active ? "#e2e8f0" : "rgba(255,255,255,0.35)",
      cursor: "pointer", transition: "all 0.15s", marginRight: 3, marginBottom: 3, letterSpacing: "0.02em", lineHeight: 1.4
    }}>{label}</button>
  );
}
function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "16px 18px", minWidth: 140, flex: 1 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent || "#e2e8f0", fontFamily: "'DM Mono', monospace", letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
function Input({ label, ...props }) {
  const displayValue = props.type === "number" && (props.value === 0 || props.value === "0") ? "" : props.value;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {label && <label style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{label}</label>}
      <input {...props} value={displayValue} placeholder={props.placeholder || (props.type === "number" ? "0" : "")} style={{
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 7, padding: "9px 11px", color: "#e2e8f0", fontSize: 13,
        fontFamily: "'DM Mono', monospace", outline: "none", ...(props.style || {})
      }} />
    </div>
  );
}
function Select({ label, options, ...props }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {label && <label style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{label}</label>}
      <select {...props} style={{
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 7, padding: "9px 11px", color: "#e2e8f0", fontSize: 13,
        fontFamily: "'DM Mono', monospace", outline: "none", ...(props.style || {})
      }}>
        {options.map(o => typeof o === "object"
          ? <option key={o.value} value={o.value} style={{ background: "#111" }}>{o.label}</option>
          : <option key={o} value={o} style={{ background: "#111" }}>{o}</option>
        )}
      </select>
    </div>
  );
}
function TextArea({ label, ...props }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {label && <label style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{label}</label>}
      <textarea {...props} style={{
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 7, padding: "9px 11px", color: "#e2e8f0", fontSize: 13,
        fontFamily: "'DM Mono', monospace", outline: "none", minHeight: 64, resize: "vertical", ...(props.style || {})
      }} />
    </div>
  );
}
function Btn({ children, variant, ...props }) {
  const s = { primary: { background: "linear-gradient(135deg, #0ea5e9, #6366f1)", color: "#fff", border: "none" }, danger: { background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }, ghost: { background: "transparent", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)" }, success: { background: "rgba(34,197,94,0.12)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.2)" } };
  return <button {...props} style={{ padding: "9px 18px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all 0.15s", letterSpacing: "0.02em", ...s[variant || "primary"], ...(props.style || {}) }}>{children}</button>;
}

// ── Calendar ──
function PnlCalendar({ trades, onDayClick }) {
  const [month, setMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const dailyPnl = useMemo(() => { const m = {}; trades.forEach(t => { m[t.date] = (m[t.date] || 0) + t.pnl; }); return m; }, [trades]);
  const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
  const firstDow = new Date(month.year, month.month, 1).getDay();
  const monthName = new Date(month.year, month.month).toLocaleString("default", { month: "long", year: "numeric" });
  const cells = []; for (let i = 0; i < firstDow; i++) cells.push(null); for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return (
    <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button onClick={() => setMonth(m => m.month === 0 ? { year: m.year - 1, month: 11 } : { ...m, month: m.month - 1 })} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, padding: "4px 8px" }}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", color: "#e2e8f0" }}>{monthName}</span>
        <button onClick={() => setMonth(m => m.month === 11 ? { year: m.year + 1, month: 0 } : { ...m, month: m.month + 1 })} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, padding: "4px 8px" }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {["S","M","T","W","T","F","S"].map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 700, padding: 4 }}>{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const ds = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const pnl = dailyPnl[ds]; const has = pnl !== undefined;
          const bg = !has ? "transparent" : pnl > 0 ? "rgba(34,197,94,0.15)" : pnl < 0 ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.04)";
          const col = !has ? "rgba(255,255,255,0.25)" : pnl > 0 ? "#4ade80" : pnl < 0 ? "#f87171" : "rgba(255,255,255,0.4)";
          return <div key={ds} onClick={() => has && onDayClick && onDayClick(ds)} style={{ textAlign: "center", borderRadius: 6, padding: "6px 2px", background: bg, cursor: has ? "pointer" : "default", transition: "all 0.15s" }}>
            <div style={{ fontSize: 11, color: col, fontWeight: has ? 700 : 400 }}>{day}</div>
            {has && <div style={{ fontSize: 9, color: col, fontWeight: 700, marginTop: 1 }}>${pnl > 0 ? "+" : ""}{pnl.toFixed(0)}</div>}
          </div>;
        })}
      </div>
    </div>
  );
}

function PnlChart({ trades }) {
  if (!trades.length) return null;
  const sorted = [...trades].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const cum = []; let r = 0; sorted.forEach(t => { r += t.pnl; cum.push(r); });
  const max = Math.max(...cum, 0), min = Math.min(...cum, 0), range = max - min || 1, h = 120, w = 100;
  const pts = cum.map((v, i) => `${(i / Math.max(cum.length - 1, 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  const zy = h - ((0 - min) / range) * h;
  return <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 120 }} preserveAspectRatio="none">
    <line x1="0" y1={zy} x2={w} y2={zy} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
    <polyline fill="none" stroke={r >= 0 ? "#4ade80" : "#f87171"} strokeWidth="1.5" points={pts} strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function AccountProgress({ account }) {
  if (!account.profitTarget) return null;
  const pnl = account.currentBalance - account.size;
  const pct = Math.min(Math.max(pnl / account.profitTarget * 100, 0), 100);
  const ddPct = account.maxLoss ? Math.min(Math.max((-pnl) / account.maxLoss * 100, 0), 100) : 0;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 3 }}>
        <span>Profit: ${pnl.toFixed(0)} / ${account.profitTarget}</span><span>{pct.toFixed(0)}%</span>
      </div>
      <div style={{ height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #4ade80, #22d3ee)", borderRadius: 3, transition: "width 0.3s" }} />
      </div>
      {account.maxLoss > 0 && pnl < 0 && (
        <div style={{ marginTop: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(239,68,68,0.5)", marginBottom: 3 }}>
            <span>DD: ${Math.abs(pnl).toFixed(0)} / ${account.maxLoss}</span><span>{ddPct.toFixed(0)}%</span>
          </div>
          <div style={{ height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${ddPct}%`, background: "linear-gradient(90deg, #fbbf24, #ef4444)", borderRadius: 3, transition: "width 0.3s" }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Monte Carlo ──
function MonteCarloSim({ trades }) {
  const { isMobile } = useIsMobile();
  const [simCount, setSimCount] = useState(1000);
  const [tradeCount, setTradeCount] = useState(100);
  const [startBal, setStartBal] = useState(50000);
  const [maxDD, setMaxDD] = useState(2500);
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);

  const runSim = useCallback(() => {
    if (trades.length < 5) return;
    setRunning(true);
    setTimeout(() => {
      const pnls = trades.map(t => t.pnl);
      const sims = [];
      for (let s = 0; s < simCount; s++) {
        let bal = startBal;
        let peak = bal;
        let maxDd = 0;
        let blown = false;
        const curve = [bal];
        for (let i = 0; i < tradeCount; i++) {
          const pick = pnls[Math.floor(Math.random() * pnls.length)];
          bal += pick;
          if (bal > peak) peak = bal;
          const dd = peak - bal;
          if (dd > maxDd) maxDd = dd;
          if (dd >= maxDD) { blown = true; break; }
          curve.push(bal);
        }
        sims.push({ final: bal, maxDd, blown, curve });
      }

      const finals = sims.map(s => s.final).sort((a, b) => a - b);
      const blownCount = sims.filter(s => s.blown).length;
      const profitable = sims.filter(s => s.final > startBal).length;
      const median = finals[Math.floor(finals.length / 2)];
      const p5 = finals[Math.floor(finals.length * 0.05)];
      const p25 = finals[Math.floor(finals.length * 0.25)];
      const p75 = finals[Math.floor(finals.length * 0.75)];
      const p95 = finals[Math.floor(finals.length * 0.95)];
      const avgMaxDd = sims.reduce((s, x) => s + x.maxDd, 0) / sims.length;

      // Sample 20 curves for chart
      const sampleCurves = [];
      for (let i = 0; i < Math.min(30, sims.length); i++) {
        sampleCurves.push(sims[Math.floor(Math.random() * sims.length)].curve);
      }

      setResults({ finals, blownCount, profitable, median, p5, p25, p75, p95, avgMaxDd, sampleCurves, total: simCount });
      setRunning(false);
    }, 50);
  }, [trades, simCount, tradeCount, startBal, maxDD]);

  const sectionBox = { background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 18 };
  const lbl = { fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Monte Carlo Simulation</h2>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
        Randomly resamples your actual trade results to simulate thousands of possible futures. Shows you the probability of profit, ruin, and expected drawdowns based on your real edge.
      </div>

      {trades.length < 5 ? (
        <div style={{ ...sectionBox, textAlign: "center", padding: 40, color: "rgba(255,255,255,0.2)" }}>
          You need at least 5 trades logged to run a simulation. Keep journaling!
        </div>
      ) : (
        <>
          <div style={{ ...sectionBox }}>
            <div style={{ ...lbl, marginBottom: 12 }}>Simulation Parameters</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 10 }}>
              <Input label="Simulations" type="number" value={simCount} onChange={e => setSimCount(Math.max(100, +e.target.value))} />
              <Input label="Trades per Sim" type="number" value={tradeCount} onChange={e => setTradeCount(Math.max(10, +e.target.value))} />
              <Input label="Starting Balance ($)" type="number" value={startBal} onChange={e => setStartBal(+e.target.value)} />
              <Input label="Max Drawdown Limit ($)" type="number" value={maxDD} onChange={e => setMaxDD(+e.target.value)} />
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <Btn variant="primary" onClick={runSim} style={{ opacity: running ? 0.5 : 1 }}>{running ? "Running..." : "Run Simulation"}</Btn>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Using {trades.length} logged trades as sample data</span>
            </div>
          </div>

          {results && (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <StatCard label="Probability of Profit" value={`${(results.profitable / results.total * 100).toFixed(1)}%`} accent={results.profitable / results.total > 0.5 ? "#4ade80" : "#f87171"} />
                <StatCard label="Probability of Ruin" value={`${(results.blownCount / results.total * 100).toFixed(1)}%`} accent={results.blownCount / results.total < 0.1 ? "#4ade80" : "#f87171"} sub={`Hit $${maxDD} DD limit`} />
                <StatCard label="Median Final" value={`$${results.median.toFixed(0)}`} accent={results.median > startBal ? "#4ade80" : "#f87171"} />
                <StatCard label="Avg Max Drawdown" value={`$${results.avgMaxDd.toFixed(0)}`} accent="#fbbf24" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                {/* Equity paths chart */}
                <div style={{ ...sectionBox }}>
                  <div style={{ ...lbl, marginBottom: 10 }}>Sample Equity Curves ({results.sampleCurves.length} paths)</div>
                  <svg viewBox="0 0 400 200" style={{ width: "100%", height: 200 }} preserveAspectRatio="none">
                    {(() => {
                      const all = results.sampleCurves.flat();
                      const mn = Math.min(...all), mx = Math.max(...all), rng = mx - mn || 1;
                      const zy = 200 - ((startBal - mn) / rng) * 200;
                      return <>
                        <line x1="0" y1={zy} x2="400" y2={zy} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" strokeDasharray="4,4" />
                        {results.sampleCurves.map((curve, ci) => {
                          const maxI = curve.length - 1;
                          const pts = curve.map((v, i) => `${(i / Math.max(maxI, 1)) * 400},${200 - ((v - mn) / rng) * 200}`).join(" ");
                          const fin = curve[curve.length - 1];
                          const col = fin >= startBal ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)";
                          return <polyline key={ci} fill="none" stroke={col} strokeWidth="1" points={pts} />;
                        })}
                      </>;
                    })()}
                  </svg>
                </div>

                {/* Distribution */}
                <div style={{ ...sectionBox }}>
                  <div style={{ ...lbl, marginBottom: 10 }}>Outcome Distribution</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "5th Percentile (Worst Case)", value: results.p5, color: "#f87171" },
                      { label: "25th Percentile", value: results.p25, color: "#fbbf24" },
                      { label: "Median (50th)", value: results.median, color: "#38bdf8" },
                      { label: "75th Percentile", value: results.p75, color: "#4ade80" },
                      { label: "95th Percentile (Best Case)", value: results.p95, color: "#4ade80" }
                    ].map(row => (
                      <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{row.label}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: row.color }}>${row.value.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 14, padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 6 }}>Expected Range (25th - 75th)</div>
                    <div style={{ height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
                      {(() => {
                        const allF = results.finals;
                        const lo = allF[0], hi = allF[allF.length - 1], rng = hi - lo || 1;
                        const l = ((results.p25 - lo) / rng) * 100;
                        const w = ((results.p75 - results.p25) / rng) * 100;
                        const medPos = ((results.median - lo) / rng) * 100;
                        return <>
                          <div style={{ position: "absolute", left: `${l}%`, width: `${w}%`, height: "100%", background: "linear-gradient(90deg, #fbbf24, #4ade80)", borderRadius: 4, opacity: 0.5 }} />
                          <div style={{ position: "absolute", left: `${medPos}%`, width: 2, height: "100%", background: "#38bdf8" }} />
                        </>;
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Trade Form ──
function TradeForm({ trade, accounts, customModels, customConcepts, onSave, onCancel, onAddModel, onAddConcept }) {
  const { isMobile } = useIsMobile();
  const [form, setForm] = useState(trade || { ...DEFAULT_TRADE, date: new Date().toISOString().slice(0, 10) });
  const [newModel, setNewModel] = useState("");
  const [newConcept, setNewConcept] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const allConcepts = [...ICT_CONCEPTS, ...(customConcepts || [])];

  // Migrate old single emotion to array
  useEffect(() => {
    if (form.emotion && !form.emotions) {
      setForm(f => ({ ...f, emotions: [f.emotion] }));
    }
  }, []);

  useEffect(() => {
    const rr = calcRR(form.entry, form.stop, form.exit, form.direction);
    const pnl = calcPnl(form.entry, form.exit, form.contracts, form.instrument, form.direction);
    setForm(f => ({ ...f, rr: rr || f.rr, pnl: form.exit ? pnl : f.pnl }));
  }, [form.entry, form.stop, form.exit, form.contracts, form.instrument, form.direction]);

  const emotions = form.emotions || [];

  useEffect(() => {
    const rulesMax = RULE_CHECKLIST.length;
    const rulesPts = rulesMax > 0 ? (form.rulesFollowed.length / rulesMax) * 3.0 : 0;
    const ictCount = form.ictConcepts.length;
    const ictPts = ictCount === 0 ? 0 : Math.min(2.0, 0.7 * Math.sqrt(ictCount));
    let narrativePts = 0;
    if (form.htfBias) narrativePts += 0.4;
    if (form.ltfEntry) narrativePts += 0.3;
    if (form.drawOnLiquidity.length > 3) narrativePts += 0.3;
    if (form.entryModel.length > 3) narrativePts += 0.3;
    if (form.preTradeNarrative.length > 20) narrativePts += 0.4;
    // Emotion scoring: multi-select aware
    const ems = form.emotions || [];
    const posCount = ems.filter(e => !NEGATIVE_EMOTIONS.includes(e)).length;
    const negCount = ems.filter(e => NEGATIVE_EMOTIONS.includes(e)).length;
    // Positive emotions: diminishing returns, up to 1.5
    const emotionBonus = Math.min(1.5, posCount * 0.5);
    // Negative emotions: each one penalizes 0.8
    const emotionPenalty = negCount * 0.8;
    // Mixed state penalty: if you have both positive AND negative, extra -0.3
    const mixedPenalty = (posCount > 0 && negCount > 0) ? 0.3 : 0;

    const gradeMap = { "A+": 1.5, "A": 1.2, "B": 0.8, "C": 0.4, "D": 0.1, "F": 0 };
    const gradePts = gradeMap[form.grade] || 0;
    const subtotal = rulesPts + ictPts + narrativePts + emotionBonus + gradePts;
    const mistakePenalty = form.mistakes.length * 1.5;
    const final = Math.max(0, Math.min(10, Math.round((subtotal - mistakePenalty - emotionPenalty - mixedPenalty) * 10) / 10));
    set("confluenceScore", final);
  }, [form.ictConcepts, form.rulesFollowed, form.mistakes, form.htfBias, form.ltfEntry, form.drawOnLiquidity, form.entryModel, form.preTradeNarrative, form.emotions, form.grade]);

  const toggle = (key, val) => setForm(f => ({ ...f, [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val] }));
  const toggleEmotion = (e) => {
    setForm(f => {
      const cur = f.emotions || [];
      return { ...f, emotions: cur.includes(e) ? cur.filter(x => x !== e) : [...cur, e] };
    });
  };

  const allModels = [...DEFAULT_MODELS, ...(customModels || [])];
  const sectionTitle = (text) => <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginTop: 8, marginBottom: 4, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 14 }}>{text}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 10 }}>
        <Input label="Date" type="date" value={form.date} onChange={e => set("date", e.target.value)} />
        <Input label="Time" type="time" value={form.time} onChange={e => set("time", e.target.value)} />
        <Select label="Instrument" value={form.instrument} onChange={e => set("instrument", e.target.value)} options={INSTRUMENTS} />
        <Select label="Session" value={form.session} onChange={e => set("session", e.target.value)} options={SESSIONS} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr 1fr", gap: 10 }}>
        <Select label="Direction" value={form.direction} onChange={e => set("direction", e.target.value)} options={["Long", "Short"]} />
        <Input label="Contracts" type="number" value={form.contracts} onChange={e => set("contracts", +e.target.value)} />
        <Input label="Entry" type="number" step="any" value={form.entry} onChange={e => set("entry", e.target.value)} />
        <Input label="Stop Loss" type="number" step="any" value={form.stop} onChange={e => set("stop", e.target.value)} />
        <Input label="Target" type="number" step="any" value={form.target} onChange={e => set("target", e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 10 }}>
        <Input label="Exit" type="number" step="any" value={form.exit} onChange={e => set("exit", e.target.value)} />
        <Input label="P&L $ (auto)" type="number" step="any" value={form.pnl} onChange={e => set("pnl", +e.target.value)} />
        <Input label="R:R (auto)" value={form.rr} onChange={e => set("rr", e.target.value)} />
        <Select label="Grade" value={form.grade} onChange={e => set("grade", e.target.value)} options={TRADE_GRADES} />
      </div>

      <Select label="Account" value={form.accountId} onChange={e => set("accountId", e.target.value)}
        options={[{ value: "", label: "-- No Account --" }, ...accounts.map(a => ({ value: a.id, label: `${a.name} (${a.firm} - $${a.currentBalance.toLocaleString()})` }))]} />

      {sectionTitle("Bias & Model")}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 10 }}>
        <Select label="HTF Bias" value={form.htfBias} onChange={e => set("htfBias", e.target.value)} options={["", "Bullish", "Bearish", "Neutral/Ranging"]} />
        <Select label="LTF Entry TF" value={form.ltfEntry} onChange={e => set("ltfEntry", e.target.value)} options={["", ...TIMEFRAMES]} />
        <Input label="Draw on Liquidity" value={form.drawOnLiquidity} onChange={e => set("drawOnLiquidity", e.target.value)} placeholder="e.g. BSL above PDH" />
      </div>
      <div>
        <label style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, display: "block", marginBottom: 6 }}>Entry Model</label>
        <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 6 }}>
          {allModels.map(m => (
            <Pill key={m} label={m} active={form.entryModel === m} onClick={() => set("entryModel", m)} color="rgba(56,189,248,0.18)" />
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input value={form.entryModel} onChange={e => set("entryModel", e.target.value)} placeholder="Or type a custom model..."
            style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "8px 11px", color: "#e2e8f0", fontSize: 12, fontFamily: "'DM Mono', monospace", outline: "none" }} />
          {form.entryModel && !allModels.includes(form.entryModel) && (
            <Btn variant="success" style={{ padding: "7px 12px", fontSize: 10 }} onClick={() => { if (form.entryModel.trim()) onAddModel(form.entryModel.trim()); }}>+ Save Model</Btn>
          )}
        </div>
      </div>

      {sectionTitle("Pre-Trade Rules Checklist")}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {RULE_CHECKLIST.map(r => <Pill key={r} label={r} active={form.rulesFollowed.includes(r)} onClick={() => toggle("rulesFollowed", r)} color="rgba(34,197,94,0.18)" />)}
      </div>

      {sectionTitle("Psychology")}
      <div>
        <label style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, display: "block", marginBottom: 4 }}>Emotional State <span style={{ color: "rgba(255,255,255,0.2)", fontWeight: 400, textTransform: "none" }}>(select all that apply)</span></label>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {EMOTIONS.map(e => (
            <Pill key={e} label={e} active={emotions.includes(e)} onClick={() => toggleEmotion(e)}
              color={NEGATIVE_EMOTIONS.includes(e) ? "rgba(239,68,68,0.18)" : "rgba(34,197,94,0.18)"} />
          ))}
        </div>
        {emotions.length > 1 && (
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
            Selected: {emotions.join(", ")}
          </div>
        )}
      </div>
      <div>
        <label style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, display: "block", marginBottom: 6 }}>Mistakes / Violations</label>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {MISTAKES.map(m => <Pill key={m} label={m} active={form.mistakes.includes(m)} onClick={() => toggle("mistakes", m)} color="rgba(239,68,68,0.18)" />)}
        </div>
      </div>

      {sectionTitle("ICT Concepts")}
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {allConcepts.map(c => <Pill key={c} label={c} active={form.ictConcepts.includes(c)} onClick={() => toggle("ictConcepts", c)} color="rgba(168,85,247,0.18)" />)}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input value={newConcept} onChange={e => setNewConcept(e.target.value)} placeholder="Add custom concept..."
          onKeyDown={e => { if (e.key === "Enter" && newConcept.trim() && !allConcepts.includes(newConcept.trim())) { onAddConcept(newConcept.trim()); toggle("ictConcepts", newConcept.trim()); setNewConcept(""); } }}
          style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "8px 11px", color: "#e2e8f0", fontSize: 12, fontFamily: "'DM Mono', monospace", outline: "none" }} />
        {newConcept.trim() && !allConcepts.includes(newConcept.trim()) && (
          <Btn variant="success" style={{ padding: "7px 12px", fontSize: 10 }} onClick={() => { onAddConcept(newConcept.trim()); toggle("ictConcepts", newConcept.trim()); setNewConcept(""); }}>+ Save</Btn>
        )}
      </div>

      {/* Confluence Score */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "rgba(255,255,255,0.025)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)" }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Confluence Score</span>
        <div style={{ display: "flex", gap: 3 }}>
          {Array.from({ length: 10 }).map((_, i) => {
            const fill = Math.min(1, Math.max(0, form.confluenceScore - i));
            const barColor = form.confluenceScore >= 7 ? "#4ade80" : form.confluenceScore >= 4 ? "#fbbf24" : "#f87171";
            return <div key={i} style={{ width: 18, height: 8, borderRadius: 2, background: fill >= 1 ? barColor : fill > 0 ? `linear-gradient(90deg, ${barColor} ${fill * 100}%, rgba(255,255,255,0.06) ${fill * 100}%)` : "rgba(255,255,255,0.06)" }} />;
          })}
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: form.confluenceScore >= 7 ? "#4ade80" : form.confluenceScore >= 4 ? "#fbbf24" : form.confluenceScore > 0 ? "#f87171" : "#e2e8f0" }}>{form.confluenceScore}/10</span>
      </div>

      {sectionTitle("Trade Narrative")}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
        <TextArea label="Pre-Trade (Bias, DOL, Setup)" value={form.preTradeNarrative} onChange={e => set("preTradeNarrative", e.target.value)} placeholder="HTF bias? Where's the draw on liquidity? What PD array are you trading into?" />
        <TextArea label="Post-Trade Review" value={form.postTradeReview} onChange={e => set("postTradeReview", e.target.value)} placeholder="Did price respect your PD array? What would you do differently?" />
      </div>
      <TextArea label="Partials / Trade Management" value={form.partials} onChange={e => set("partials", e.target.value)} placeholder="e.g. TP1 at 1:1, moved SL to BE, runner to 2:1..." />
      <TextArea label="Notes" value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Anything else..." />

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" onClick={() => onSave(form)}>Save Trade</Btn>
      </div>
    </div>
  );
}

function AccountForm({ account, onSave, onCancel }) {
  const { isMobile } = useIsMobile();
  const [form, setForm] = useState(account || DEFAULT_ACCOUNT);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
        <Input label="Account Name" value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Apex 50K #1" />
        <Select label="Firm" value={form.firm} onChange={e => set("firm", e.target.value)} options={FIRMS} />
        <Select label="Phase" value={form.phase} onChange={e => set("phase", e.target.value)} options={PHASES} />
        <Select label="Status" value={form.status} onChange={e => set("status", e.target.value)} options={["Active", "Breached", "Passed", "Payout"]} />
        <Input label="Account Size ($)" type="number" value={form.size} onChange={e => set("size", +e.target.value)} />
        <Input label="Current Balance ($)" type="number" value={form.currentBalance} onChange={e => set("currentBalance", +e.target.value)} />
        <Input label="Max Drawdown ($)" type="number" value={form.maxLoss} onChange={e => set("maxLoss", +e.target.value)} />
        <Input label="Daily Loss Limit ($)" type="number" value={form.dailyLoss} onChange={e => set("dailyLoss", +e.target.value)} />
        <Input label="Profit Target ($)" type="number" value={form.profitTarget} onChange={e => set("profitTarget", +e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" onClick={() => onSave(form)}>Save Account</Btn>
      </div>
    </div>
  );
}

// ═══════ MAIN ═══════
export default function TradingJournal() {
  const [state, dispatch] = useReducer(reducer, null, loadState);
  const [view, setView] = useState("dashboard");
  const [editItem, setEditItem] = useState(null);
  const [filter, setFilter] = useState({ instrument: "", session: "" });
  const [selectedDay, setSelectedDay] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const { isMobile, isTablet } = useIsMobile();

  useEffect(() => { localStorage.setItem("ict_journal_data", JSON.stringify(state)); }, [state]);

  const { trades, accounts, customModels, customConcepts } = state;

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ict-journal-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const importData = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.trades && data.accounts) {
            if (confirm(`Import ${data.trades.length} trades and ${data.accounts.length} accounts? This will replace ALL current data.`)) {
              dispatch({ type: "IMPORT_DATA", payload: { trades: data.trades || [], accounts: data.accounts || [], customModels: data.customModels || [], customConcepts: data.customConcepts || [] } });
            }
          } else { alert("Invalid file format."); }
        } catch { alert("Could not parse file."); }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const filtered = trades.filter(t => {
    if (filter.instrument && t.instrument !== filter.instrument) return false;
    if (filter.session && t.session !== filter.session) return false;
    if (selectedDay && t.date !== selectedDay) return false;
    return true;
  });

  const totalPnl = filtered.reduce((s, t) => s + t.pnl, 0);
  const wins = filtered.filter(t => t.pnl > 0);
  const losses = filtered.filter(t => t.pnl < 0);
  const winRate = filtered.length ? (wins.length / filtered.length * 100).toFixed(1) : "0";
  const avgWin = wins.length ? (wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(2) : "0";
  const avgLoss = losses.length ? (losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(2) : "0";
  const profitFactor = losses.length && wins.length ? Math.abs(wins.reduce((s, t) => s + t.pnl, 0) / losses.reduce((s, t) => s + t.pnl, 0)).toFixed(2) : "--";

  const sortedAll = [...trades].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  let streak = 0;
  if (sortedAll.length) { const dir = sortedAll[0].pnl >= 0 ? 1 : -1; for (const t of sortedAll) { if ((t.pnl >= 0 ? 1 : -1) === dir) streak++; else break; } streak = dir === 1 ? streak : -streak; }

  const conceptStats = {}, sessionStats = {}, mistakeStats = {};
  filtered.forEach(t => {
    (t.ictConcepts || []).forEach(c => { if (!conceptStats[c]) conceptStats[c] = { count: 0, pnl: 0 }; conceptStats[c].count++; conceptStats[c].pnl += t.pnl; });
    if (!sessionStats[t.session]) sessionStats[t.session] = { count: 0, pnl: 0 }; sessionStats[t.session].count++; sessionStats[t.session].pnl += t.pnl;
    (t.mistakes || []).forEach(m => { mistakeStats[m] = (mistakeStats[m] || 0) + 1; });
  });

  const navItems = [
    { key: "dashboard", label: "Dashboard" },
    { key: "trades", label: "Trades" },
    { key: "accounts", label: "Accounts" },
    { key: "montecarlo", label: "Monte Carlo" },
  ];

  const isActive = (k) => view === k || (k === "trades" && (view === "addTrade" || view === "editTrade")) || (k === "accounts" && (view === "addAccount" || view === "editAccount"));

  return (
    <div style={{ fontFamily: "'DM Mono', 'JetBrains Mono', monospace", background: "#0a0a0a", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; }
        input, select, textarea, button { font-family: inherit; }
        @media (max-width: 639px) {
          .trade-table-row { font-size: 10px !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{ padding: isMobile ? "12px 16px" : "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.015)", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #0ea5e9, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, fontFamily: "'Space Grotesk', sans-serif" }}>J</div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: isMobile ? 14 : 16, letterSpacing: "-0.02em" }}>ICT JOURNAL</div>
            {!isMobile && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Futures · Prop Firm Tracker</div>}
          </div>
        </div>
        {isMobile ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={exportData} style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "rgba(255,255,255,0.4)", padding: "5px 8px", cursor: "pointer", fontSize: 10 }}>↓</button>
            <button onClick={importData} style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "rgba(255,255,255,0.4)", padding: "5px 8px", cursor: "pointer", fontSize: 10 }}>↑</button>
            <button onClick={() => setMobileMenu(!mobileMenu)} style={{ background: "rgba(255,255,255,0.05)", border: "none", borderRadius: 6, color: "#e2e8f0", padding: "6px 10px", cursor: "pointer", fontSize: 16 }}>☰</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {navItems.map(n => (
              <button key={n.key} onClick={() => { setView(n.key); setSelectedDay(null); setMobileMenu(false); }} style={{
                padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", transition: "all 0.15s",
                fontFamily: "'Space Grotesk', sans-serif",
                background: isActive(n.key) ? "rgba(255,255,255,0.07)" : "transparent",
                color: isActive(n.key) ? "#e2e8f0" : "rgba(255,255,255,0.3)"
              }}>{n.label}</button>
            ))}
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.06)", margin: "0 6px" }} />
            <button onClick={exportData} style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "rgba(255,255,255,0.4)", padding: "6px 12px", cursor: "pointer", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif" }}>Export</button>
            <button onClick={importData} style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "rgba(255,255,255,0.4)", padding: "6px 12px", cursor: "pointer", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif" }}>Import</button>
          </div>
        )}
      </div>

      {/* Mobile Nav Dropdown */}
      {isMobile && mobileMenu && (
        <div style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "8px 16px", display: "flex", flexWrap: "wrap", gap: 4 }}>
          {navItems.map(n => (
            <button key={n.key} onClick={() => { setView(n.key); setSelectedDay(null); setMobileMenu(false); }} style={{
              padding: "8px 16px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
              fontFamily: "'Space Grotesk', sans-serif", flex: "1 1 auto", textAlign: "center",
              background: isActive(n.key) ? "rgba(255,255,255,0.07)" : "transparent",
              color: isActive(n.key) ? "#e2e8f0" : "rgba(255,255,255,0.3)"
            }}>{n.label}</button>
          ))}
        </div>
      )}

      <div style={{ padding: isMobile ? "16px" : "20px 24px", flex: 1, overflowY: "auto" }}>

        {/* ══ DASHBOARD ══ */}
        {view === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Dashboard</h2>
                {selectedDay && <button onClick={() => setSelectedDay(null)} style={{ background: "none", border: "none", color: "#38bdf8", fontSize: 11, cursor: "pointer", padding: 0, marginTop: 4, fontFamily: "'DM Mono', monospace" }}>Showing {selectedDay} — click to clear</button>}
              </div>
              <Btn variant="primary" onClick={() => setView("addTrade")}>+ New Trade</Btn>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <Pill label="All" active={!filter.instrument} onClick={() => setFilter(f => ({ ...f, instrument: "" }))} />
              {INSTRUMENTS.map(i => <Pill key={i} label={i} active={filter.instrument === i} onClick={() => setFilter(f => ({ ...f, instrument: i }))} />)}
              <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.06)", margin: "0 6px" }} />
              <Pill label="All Sessions" active={!filter.session} onClick={() => setFilter(f => ({ ...f, session: "" }))} />
              {SESSIONS.map(s => <Pill key={s} label={s} active={filter.session === s} onClick={() => setFilter(f => ({ ...f, session: s }))} />)}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <StatCard label="Total P&L" value={`$${totalPnl.toFixed(2)}`} accent={totalPnl >= 0 ? "#4ade80" : "#f87171"} />
              <StatCard label="Win Rate" value={`${winRate}%`} sub={`${wins.length}W / ${losses.length}L`} accent="#38bdf8" />
              <StatCard label="Profit Factor" value={profitFactor} accent="#c084fc" />
              <StatCard label="Avg W / L" value={`$${avgWin}`} sub={`Avg Loss: $${avgLoss}`} accent="#fbbf24" />
              <StatCard label="Streak" value={streak > 0 ? `${streak}W` : streak < 0 ? `${Math.abs(streak)}L` : "--"} accent={streak > 0 ? "#4ade80" : streak < 0 ? "#f87171" : "#e2e8f0"} sub={`${trades.length} total`} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
              <PnlCalendar trades={trades} onDayClick={(d) => setSelectedDay(d === selectedDay ? null : d)} />
              <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 10 }}>Equity Curve</div>
                {filtered.length > 0 ? <PnlChart trades={filtered} /> : <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)", fontSize: 12 }}>No trades yet</div>}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "1fr 1fr 1fr", gap: 14 }}>
              {[
                { title: "By Session", data: Object.entries(sessionStats), render: ([s, d]) => <div key={s} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12 }}><span>{s}</span><span style={{ color: d.pnl >= 0 ? "#4ade80" : "#f87171", fontWeight: 600 }}>${d.pnl.toFixed(0)} <span style={{ color: "rgba(255,255,255,0.25)" }}>({d.count})</span></span></div> },
                { title: "Top ICT Concepts", data: Object.entries(conceptStats).sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 6), render: ([c, d]) => <div key={c} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12 }}><span style={{ color: "#c084fc" }}>{c}</span><span style={{ color: d.pnl >= 0 ? "#4ade80" : "#f87171", fontWeight: 600 }}>${d.pnl.toFixed(0)} <span style={{ color: "rgba(255,255,255,0.25)" }}>({d.count})</span></span></div> },
                { title: "Top Mistakes", data: Object.entries(mistakeStats).sort((a, b) => b[1] - a[1]).slice(0, 6), render: ([m, c]) => <div key={m} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12 }}><span style={{ color: "#f87171" }}>{m}</span><span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>{c}x</span></div> }
              ].map(({ title, data, render }) => (
                <div key={title} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 10 }}>{title}</div>
                  {data.length ? data.map(render) : <div style={{ color: "rgba(255,255,255,0.15)", fontSize: 11 }}>No data</div>}
                </div>
              ))}
            </div>
            {accounts.filter(a => a.status === "Active").length > 0 && (
              <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 10 }}>Active Accounts</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
                  {accounts.filter(a => a.status === "Active").map(a => (
                    <div key={a.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "'Space Grotesk', sans-serif" }}>{a.name}</span>
                        <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, fontWeight: 700, background: a.phase === "Funded" ? "rgba(34,197,94,0.12)" : "rgba(56,189,248,0.12)", color: a.phase === "Funded" ? "#4ade80" : "#38bdf8" }}>{a.phase}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>{a.firm} · ${a.size.toLocaleString()}</div>
                      <AccountProgress account={a} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ TRADES ══ */}
        {view === "trades" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Trade Log</h2>
              <Btn variant="primary" onClick={() => setView("addTrade")}>+ New Trade</Btn>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Pill label="All" active={!filter.instrument} onClick={() => setFilter(f => ({ ...f, instrument: "" }))} />
              {INSTRUMENTS.map(i => <Pill key={i} label={i} active={filter.instrument === i} onClick={() => setFilter(f => ({ ...f, instrument: i }))} />)}
            </div>
            <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
              <div style={{ display: "grid", gridTemplateColumns: "85px 50px 60px 48px 42px 72px 72px 65px 45px 1fr 64px", minWidth: 700, padding: "8px 14px", fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <span>Date</span><span>Instr</span><span>Session</span><span>Dir</span><span>Ctrs</span><span>Entry</span><span>Exit</span><span>P&L</span><span>R:R</span><span>Model / Err</span><span></span>
              </div>
              {filtered.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).map(t => (
                <div key={t.id} style={{ display: "grid", gridTemplateColumns: "85px 50px 60px 48px 42px 72px 72px 65px 45px 1fr 64px", minWidth: 700, padding: "8px 14px", fontSize: 12, borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center" }}>
                  <span style={{ fontSize: 11 }}>{t.date}</span>
                  <span style={{ fontWeight: 700, color: "#38bdf8" }}>{t.instrument}</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{t.session}</span>
                  <span style={{ color: t.direction === "Long" ? "#4ade80" : "#f87171", fontWeight: 700, fontSize: 10 }}>{t.direction === "Long" ? "L" : "S"}</span>
                  <span>{t.contracts}</span>
                  <span style={{ fontSize: 11 }}>{t.entry}</span>
                  <span style={{ fontSize: 11 }}>{t.exit}</span>
                  <span style={{ fontWeight: 700, color: t.pnl >= 0 ? "#4ade80" : "#f87171" }}>${t.pnl}</span>
                  <span style={{ fontSize: 10, color: "#fbbf24" }}>{t.rr}</span>
                  <div>
                    {t.entryModel && <span style={{ fontSize: 9, color: "#38bdf8" }}>{t.entryModel.length > 16 ? t.entryModel.slice(0, 14) + ".." : t.entryModel}</span>}
                    {t.mistakes && t.mistakes.length > 0 && <span style={{ fontSize: 9, color: "#f87171", marginLeft: 4 }}>{t.mistakes.length}err</span>}
                  </div>
                  <div style={{ display: "flex", gap: 3 }}>
                    <button onClick={() => { setEditItem(t); setView("editTrade"); }} style={{ background: "rgba(255,255,255,0.05)", border: "none", borderRadius: 4, color: "rgba(255,255,255,0.4)", padding: "3px 7px", cursor: "pointer", fontSize: 10 }}>Edit</button>
                    <button onClick={() => { if (confirm("Delete?")) dispatch({ type: "DELETE_TRADE", payload: t.id }); }} style={{ background: "rgba(239,68,68,0.08)", border: "none", borderRadius: 4, color: "#f87171", padding: "3px 7px", cursor: "pointer", fontSize: 10 }}>x</button>
                  </div>
                </div>
              ))}
              {!filtered.length && <div style={{ padding: 36, textAlign: "center", color: "rgba(255,255,255,0.15)", fontSize: 12 }}>No trades yet</div>}
            </div>
          </div>
        )}

        {/* ══ ADD/EDIT TRADE ══ */}
        {(view === "addTrade" || view === "editTrade") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>{view === "addTrade" ? "Log Trade" : "Edit Trade"}</h2>
            <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 22 }}>
              <TradeForm
                trade={view === "editTrade" ? editItem : null}
                accounts={accounts}
                customModels={customModels || []}
                customConcepts={customConcepts || []}
                onSave={(form) => { dispatch({ type: view === "editTrade" ? "UPDATE_TRADE" : "ADD_TRADE", payload: form }); setView("trades"); }}
                onCancel={() => setView("trades")}
                onAddModel={(m) => dispatch({ type: "ADD_MODEL", payload: m })}
                onAddConcept={(c) => dispatch({ type: "ADD_CONCEPT", payload: c })}
              />
            </div>
          </div>
        )}

        {/* ══ ACCOUNTS ══ */}
        {view === "accounts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Prop Firm Accounts</h2>
              <Btn variant="primary" onClick={() => setView("addAccount")}>+ New Account</Btn>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
              {accounts.map(a => (
                <div key={a.id} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15 }}>{a.name || "Unnamed"}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{a.firm}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: a.status === "Active" ? "rgba(34,197,94,0.1)" : a.status === "Breached" ? "rgba(239,68,68,0.1)" : "rgba(251,191,36,0.1)", color: a.status === "Active" ? "#4ade80" : a.status === "Breached" ? "#f87171" : "#fbbf24" }}>{a.status}</span>
                      <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: "rgba(99,102,241,0.1)", color: "#a5b4fc" }}>{a.phase}</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 12 }}>
                    {[["Size", `$${a.size.toLocaleString()}`, null], ["Balance", `$${a.currentBalance.toLocaleString()}`, a.currentBalance >= a.size ? "#4ade80" : "#f87171"], ["Max DD", `$${a.maxLoss.toLocaleString()}`, "#f87171"], ["Daily Limit", `$${a.dailyLoss.toLocaleString()}`, "#fbbf24"]].map(([l, v, c]) => (
                      <div key={l}><div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>{l}</div><div style={{ fontSize: l === "Size" || l === "Balance" ? 15 : 13, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: c || "#e2e8f0" }}>{v}</div></div>
                    ))}
                  </div>
                  <AccountProgress account={a} />
                  <div style={{ display: "flex", gap: 5, marginTop: 12 }}>
                    <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 10 }} onClick={() => { setEditItem(a); setView("editAccount"); }}>Edit</Btn>
                    <Btn variant="danger" style={{ padding: "5px 10px", fontSize: 10 }} onClick={() => { if (confirm("Delete?")) dispatch({ type: "DELETE_ACCOUNT", payload: a.id }); }}>Delete</Btn>
                  </div>
                </div>
              ))}
            </div>
            {!accounts.length && <div style={{ padding: 50, textAlign: "center", color: "rgba(255,255,255,0.15)", fontSize: 12, background: "rgba(255,255,255,0.015)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)" }}>No accounts yet. Add your prop firm accounts to start tracking.</div>}
          </div>
        )}

        {(view === "addAccount" || view === "editAccount") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>{view === "addAccount" ? "Add Account" : "Edit Account"}</h2>
            <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 22 }}>
              <AccountForm account={view === "editAccount" ? editItem : null} onSave={(form) => { dispatch({ type: view === "editAccount" ? "UPDATE_ACCOUNT" : "ADD_ACCOUNT", payload: form }); setView("accounts"); }} onCancel={() => setView("accounts")} />
            </div>
          </div>
        )}

        {/* ══ MONTE CARLO ══ */}
        {view === "montecarlo" && <MonteCarloSim trades={trades} />}

      </div>

      <div style={{ padding: "10px 24px", borderTop: "1px solid rgba(255,255,255,0.03)", fontSize: 9, color: "rgba(255,255,255,0.15)", textAlign: "center", letterSpacing: "0.06em" }}>
        ICT JOURNAL · FUTURES · PROP FIRM TRACKER
      </div>
    </div>
  );
}