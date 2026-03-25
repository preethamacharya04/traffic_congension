import { useState, useEffect, useRef, useCallback } from "react";

// ─── DESIGN TOKENS ─────────────────────────────────────────────────────────────
const C = {
  bg: "#060d18", panel: "#0b1628", panelAlt: "#0e1c32",
  border: "#162035", borderBright: "#1e3050",
  accent: "#00d4ff", accent2: "#ff6b35", accent3: "#a78bfa",
  green: "#00ff88", red: "#ff3b5c", yellow: "#ffd600",
  text: "#ddeeff", muted: "#4a6080", dimmed: "#2a3f60",
  car: "#4fc3f7", bike: "#ffb300", ped: "#ce93d8", emergency: "#ff1744",
};

// ─── SYNTHETIC DATASET GENERATOR ───────────────────────────────────────────────
const TIME_PATTERNS = {
  "Rush Hour (8-10 AM)":   { car: 0.8, bike: 0.7, ped: 0.5, label: "rush",    multiplier: 2.2 },
  "Off-Peak (11 AM-4 PM)": { car: 0.4, bike: 0.3, ped: 0.3, label: "offpeak", multiplier: 1.0 },
  "Evening Rush (5-8 PM)": { car: 0.9, bike: 0.8, ped: 0.6, label: "evening", multiplier: 2.5 },
  "Night (9 PM-6 AM)":     { car: 0.2, bike: 0.1, ped: 0.05,label: "night",   multiplier: 0.4 },
};

function generateDataset(rows = 200) {
  const patternKeys = Object.keys(TIME_PATTERNS);
  const data = [];
  const baseTime = new Date("2024-03-15T06:00:00");

  for (let i = 0; i < rows; i++) {
    const t = new Date(baseTime.getTime() + i * 5 * 60000);
    const hour = t.getHours();
    let pattern;
    if (hour >= 8 && hour < 10)       pattern = TIME_PATTERNS["Rush Hour (8-10 AM)"];
    else if (hour >= 17 && hour < 20) pattern = TIME_PATTERNS["Evening Rush (5-8 PM)"];
    else if (hour >= 21 || hour < 6)  pattern = TIME_PATTERNS["Night (9 PM-6 AM)"];
    else                               pattern = TIME_PATTERNS["Off-Peak (11 AM-4 PM)"];

    const m = pattern.multiplier;
    for (const dir of ["North", "East", "South", "West"]) {
      const cars  = Math.round((Math.random() * 10 + 2) * m * pattern.car);
      const bikes = Math.round((Math.random() * 8  + 1) * m * pattern.bike);
      const peds  = Math.round((Math.random() * 6  + 0) * m * pattern.ped);
      const total = cars + bikes + peds;
      const density = (cars * 1.5 + bikes * 1.0 + peds * 0.5).toFixed(1);
      const wait = (Math.random() * 30 + 5 + total * 1.2).toFixed(0);
      data.push({
        timestamp: t.toISOString().slice(0, 16).replace("T", " "),
        lane: dir,
        pattern: pattern.label,
        cars, bikes, pedestrians: peds,
        total_vehicles: total,
        weighted_density: parseFloat(density),
        avg_wait_sec: parseInt(wait),
        hour: hour,
      });
    }
  }
  return data;
}

function datasetToCSV(data) {
  const headers = Object.keys(data[0]).join(",");
  const rows = data.map(r => Object.values(r).join(",")).join("\n");
  return `${headers}\n${rows}`;
}

function downloadCSV(data) {
  const csv = datasetToCSV(data);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "bengaluru_traffic_synthetic.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ─── VEHICLE TYPES ─────────────────────────────────────────────────────────────
const VTYPES = [
  { type: "car",  weight: 1.5, emoji: "🚗", color: C.car  },
  { type: "bike", weight: 1.0, emoji: "🏍️", color: C.bike },
  { type: "ped",  weight: 0.5, emoji: "🚶", color: C.ped  },
];
const DIRS = ["North", "East", "South", "West"];
const ARROWS = { North: "↑", East: "→", South: "↓", West: "←" };

function wDensity(vehicles) {
  return vehicles.reduce((s, v) => s + v.weight, 0);
}

// ─── TRAFFIC ENGINE ─────────────────────────────────────────────────────────────
function useEngine(aiEnabled, dataset, dataMode) {
  const [lanes, setLanes] = useState(() =>
    DIRS.map(dir => ({ dir, vehicles: [], cleared: 0, congestion: 0 }))
  );
  const [activeGreen, setActiveGreen] = useState(0);
  const [phase, setPhase] = useState("green");
  const [phaseTimer, setPhaseTimer] = useState(10);
  const [emergency, setEmergency] = useState(null);
  const [stats, setStats] = useState({ totalCleared: 0, avgWait: 0, throughput: [], waitHistory: [] });
  const [dataIdx, setDataIdx] = useState(0);
  const phaseRef = useRef({ active: 0, phase: "green" });

  // Vehicle spawning — dataset or random
  useEffect(() => {
    const interval = setInterval(() => {
      if (dataMode && dataset.length > 0) {
        // Feed from dataset rows (4 rows = one timestamp block)
        const blockStart = (dataIdx * 4) % dataset.length;
        const block = dataset.slice(blockStart, blockStart + 4);
        setLanes(prev => prev.map((lane, i) => {
          const row = block.find(r => r.lane === lane.dir);
          if (!row) return lane;
          const newVehicles = [];
          const spawnCount = Math.min(Math.round(row.total_vehicles / 4), 5);
          for (let k = 0; k < spawnCount; k++) {
            const r = Math.random();
            let vt;
            if (r < row.cars / (row.total_vehicles || 1)) vt = VTYPES[0];
            else if (r < (row.cars + row.bikes) / (row.total_vehicles || 1)) vt = VTYPES[1];
            else vt = VTYPES[2];
            newVehicles.push({ ...vt, id: Math.random().toString(36).slice(2), wait: 0 });
          }
          return { ...lane, vehicles: [...lane.vehicles, ...newVehicles].slice(-20) };
        }));
        setDataIdx(d => d + 1);
      } else {
        setLanes(prev => prev.map(lane => {
          if (Math.random() < 0.5) {
            const vt = VTYPES[Math.floor(Math.random() * VTYPES.length)];
            return { ...lane, vehicles: [...lane.vehicles, { ...vt, id: Math.random().toString(36).slice(2), wait: 0 }].slice(-20) };
          }
          return lane;
        }));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [dataMode, dataset, dataIdx]);

  // Main tick
  useEffect(() => {
    const interval = setInterval(() => {
      setLanes(prev => {
        return prev.map((lane, i) => {
          const isGreen = phaseRef.current.active === i && phaseRef.current.phase === "green";
          let vehicles = lane.vehicles.map(v => ({ ...v, wait: isGreen ? v.wait : v.wait + 1 }));
          let cleared = lane.cleared;
          if (isGreen && vehicles.length > 0) {
            const n = Math.min(2, vehicles.length);
            vehicles = vehicles.slice(n);
            cleared += n;
          }
          return { ...lane, vehicles, cleared, congestion: Math.min(100, Math.round((vehicles.length / 20) * 100)) };
        });
      });

      setPhaseTimer(t => {
        if (t <= 1) {
          if (phaseRef.current.phase === "green") {
            phaseRef.current.phase = "yellow";
            setPhase("yellow");
            return 3;
          } else {
            let next;
            if (emergency !== null) {
              next = emergency;
              setEmergency(null);
            } else if (aiEnabled) {
              setLanes(prev => {
                const w = prev.map(l => wDensity(l.vehicles));
                next = w.indexOf(Math.max(...w));
                phaseRef.current.active = next;
                setActiveGreen(next);
                return prev;
              });
              next = phaseRef.current.active;
            } else {
              next = (phaseRef.current.active + 1) % 4;
              phaseRef.current.active = next;
              setActiveGreen(next);
            }
            phaseRef.current.phase = "green";
            setPhase("green");
            return aiEnabled ? Math.max(6, Math.min(20, 8)) : 10;
          }
        }
        return t - 1;
      });

      setStats(prev => {
        setLanes(lanes => {
          const totalCleared = lanes.reduce((s, l) => s + l.cleared, 0);
          const allWaits = lanes.flatMap(l => l.vehicles.map(v => v.wait));
          const avgWait = allWaits.length ? (allWaits.reduce((a, b) => a + b, 0) / allWaits.length).toFixed(1) : 0;
          const throughput = [...(prev.throughput || []), totalCleared].slice(-30);
          const waitHistory = [...(prev.waitHistory || []), parseFloat(avgWait)].slice(-30);
          setTimeout(() => setStats({ totalCleared, avgWait, throughput, waitHistory }), 0);
          return lanes;
        });
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [aiEnabled, emergency]);

  const spike = (i) => setLanes(prev => prev.map((l, idx) => {
    if (idx !== i) return l;
    const extras = Array.from({ length: 8 }, () => {
      const vt = VTYPES[Math.floor(Math.random() * VTYPES.length)];
      return { ...vt, id: Math.random().toString(36).slice(2), wait: 0 };
    });
    return { ...l, vehicles: [...l.vehicles, ...extras].slice(-20) };
  }));

  const triggerEmergency = (i) => { setEmergency(i); setPhase("yellow"); setPhaseTimer(2); };

  return { lanes, activeGreen, phase, phaseTimer, stats, spike, triggerEmergency };
}

// ─── MINI CHART ────────────────────────────────────────────────────────────────
function MiniChart({ data, color, height = 50, width = "100%" }) {
  const pts = data.length < 2 ? [] : data;
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const range = max - min || 1;
  const W = 280; const H = height;
  const points = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - min) / range) * H}`).join(" ");
  const area = pts.length > 1 ? `${points} ${W},${H} 0,${H}` : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width, height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`g${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {area && <polygon points={area} fill={`url(#g${color.replace("#","")})`}/>}
      {pts.length > 1 && <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}
    </svg>
  );
}

// ─── SIGNAL BULB ───────────────────────────────────────────────────────────────
function Signal({ state }) {
  const bulbs = [
    { c: C.red,    on: state === "red"    },
    { c: C.yellow, on: state === "yellow" },
    { c: C.green,  on: state === "green"  },
  ];
  return (
    <div style={{ background: "#080f1a", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 3px", display: "flex", flexDirection: "column", gap: 3 }}>
      {bulbs.map((b, i) => (
        <div key={i} style={{
          width: 13, height: 13, borderRadius: "50%",
          background: b.on ? b.c : C.dimmed,
          boxShadow: b.on ? `0 0 8px 2px ${b.c}99` : "none",
          transition: "all 0.3s",
        }}/>
      ))}
    </div>
  );
}

// ─── JUNCTION SVG ──────────────────────────────────────────────────────────────
function Junction({ lanes, activeGreen, phase }) {
  const S = 200; const R = 36; const C2 = S / 2;
  const sigState = (i) => i === activeGreen ? (phase === "yellow" ? "yellow" : "green") : "red";
  const sigColor = (i) => sigState(i) === "green" ? C.green : sigState(i) === "yellow" ? C.yellow : C.red;
  const corners = [
    { cx: C2, cy: 18 }, { cx: S - 18, cy: C2 },
    { cx: C2, cy: S - 18 }, { cx: 18, cy: C2 },
  ];
  const queueDir = [
    { dx: 0, dy: 6 }, { dx: -6, dy: 0 },
    { dx: 0, dy: -6 }, { dx: 6, dy: 0 },
  ];
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ borderRadius: 10, overflow: "visible" }}>
      <rect width={S} height={S} rx={10} fill="#0b1628"/>
      <rect x={0} y={C2 - R / 2} width={S} height={R} fill="#141f35"/>
      <rect x={C2 - R / 2} y={0} width={R} height={S} fill="#141f35"/>
      <rect x={C2 - R / 2} y={C2 - R / 2} width={R} height={R} fill="#1a2a45"/>
      {[1,2,3].map(i=><rect key={`h${i}`} x={i*(S/4)-10} y={C2-1} width={20} height={2} rx={1} fill={C.dimmed}/>)}
      {[1,2,3].map(i=><rect key={`v${i}`} x={C2-1} y={i*(S/4)-10} width={2} height={20} rx={1} fill={C.dimmed}/>)}
      {corners.map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy={p.cy} r={9} fill={sigColor(i)} opacity={0.9}/>
          {i === activeGreen && <circle cx={p.cx} cy={p.cy} r={14} fill="none" stroke={sigColor(i)} strokeWidth={1.5} opacity={0.4}>
            <animate attributeName="r" values="9;16;9" dur="1.5s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.4;0;0.4" dur="1.5s" repeatCount="indefinite"/>
          </circle>}
        </g>
      ))}
      {lanes.map((lane, i) => {
        const o = queueDir[i]; const p = corners[i];
        return lane.vehicles.slice(-6).map((v, j) => (
          <circle key={v.id} cx={p.cx + o.dx * (j + 2.2)} cy={p.cy + o.dy * (j + 2.2)} r={3}
            fill={v.color} opacity={0.85}/>
        ));
      })}
      <text x={C2} y={C2 + 4} textAnchor="middle" fill={C.accent} fontSize={10}
        fontFamily="'Orbitron',monospace" fontWeight="900" opacity={0.7}>AI</text>
    </svg>
  );
}

// ─── LANE CARD ─────────────────────────────────────────────────────────────────
function LaneCard({ lane, isActive, phase, onSpike, onEmergency }) {
  const sig = isActive ? (phase === "yellow" ? "yellow" : "green") : "red";
  const cong = lane.congestion;
  const congC = cong > 70 ? C.red : cong > 40 ? C.yellow : C.green;
  const avgWait = lane.vehicles.length
    ? (lane.vehicles.reduce((s, v) => s + v.wait, 0) / lane.vehicles.length).toFixed(0)
    : 0;
  const typeCount = VTYPES.map(vt => ({
    ...vt, count: lane.vehicles.filter(v => v.type === vt.type).length
  }));

  return (
    <div style={{
      background: isActive ? "linear-gradient(135deg,#0d2030,#0d2a1e)" : C.panel,
      border: `1.5px solid ${isActive ? C.green + "70" : C.border}`,
      borderRadius: 12, padding: "13px 14px",
      display: "flex", flexDirection: "column", gap: 9,
      boxShadow: isActive ? `0 0 22px ${C.green}18` : "none",
      transition: "all 0.4s", position: "relative", overflow: "hidden",
    }}>
      {isActive && <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg,transparent,${C.green},transparent)`,
        animation: "scanline 2s ease-in-out infinite",
      }}/>}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: C.text, fontFamily: "'Orbitron',monospace", letterSpacing: 1 }}>
            {ARROWS[lane.dir]} {lane.dir.toUpperCase()}
          </span>
          {isActive && (
            <span style={{
              fontSize: 9, background: (sig === "green" ? C.green : C.yellow) + "22",
              color: sig === "green" ? C.green : C.yellow,
              border: `1px solid ${sig === "green" ? C.green : C.yellow}`,
              borderRadius: 20, padding: "1px 7px", fontFamily: "monospace",
              fontWeight: 700, letterSpacing: 1,
            }}>{sig.toUpperCase()}</span>
          )}
        </div>
        <Signal state={sig}/>
      </div>

      {/* Congestion bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", letterSpacing: 1 }}>CONGESTION</span>
          <span style={{ fontSize: 9, color: congC, fontFamily: "monospace", fontWeight: 700 }}>{cong}%</span>
        </div>
        <div style={{ background: C.dimmed, borderRadius: 3, height: 5, overflow: "hidden" }}>
          <div style={{
            width: `${cong}%`, height: "100%",
            background: `linear-gradient(90deg,${C.green},${congC})`,
            borderRadius: 3, transition: "width 0.5s",
            boxShadow: `0 0 5px ${congC}66`,
          }}/>
        </div>
      </div>

      {/* Vehicle type breakdown */}
      <div style={{ display: "flex", gap: 6 }}>
        {typeCount.map(vt => (
          <div key={vt.type} style={{
            flex: 1, background: C.bg, borderRadius: 7,
            padding: "4px 6px", textAlign: "center",
            border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: 13 }}>{vt.emoji}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: vt.color, fontFamily: "'Orbitron',monospace" }}>
              {vt.count}
            </div>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: "QUEUED",  val: lane.vehicles.length, color: C.accent  },
          { label: "CLEARED", val: lane.cleared,          color: C.green   },
          { label: "WAIT",    val: `${avgWait}s`,         color: C.accent2 },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: s.color, fontFamily: "'Orbitron',monospace" }}>{s.val}</div>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: 5 }}>
        {[
          { label: "🚦 SPIKE", color: C.accent2, onClick: () => onSpike(DIRS.indexOf(lane.dir)) },
          { label: "🚨 EMRG",  color: C.emergency, onClick: () => onEmergency(DIRS.indexOf(lane.dir)) },
        ].map(b => (
          <button key={b.label} onClick={b.onClick} style={{
            flex: 1, background: "transparent",
            border: `1px solid ${b.color}55`, borderRadius: 6,
            color: b.color, fontSize: 10, padding: "5px 0", cursor: "pointer",
            fontFamily: "monospace", letterSpacing: 0.5, transition: "all 0.2s",
          }}
            onMouseEnter={e => e.target.style.background = b.color + "22"}
            onMouseLeave={e => e.target.style.background = "transparent"}
          >{b.label}</button>
        ))}
      </div>
    </div>
  );
}

// ─── DATASET PANEL ─────────────────────────────────────────────────────────────
function DatasetPanel({ dataset, dataMode, setDataMode, onGenerate, onDownload, dataIdx }) {
  const [showTable, setShowTable] = useState(false);
  const patternCounts = {};
  dataset.forEach(r => { patternCounts[r.pattern] = (patternCounts[r.pattern] || 0) + 1; });
  const recentRows = dataset.slice(Math.max(0, (dataIdx - 1) * 4), dataIdx * 4);

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: "'Orbitron',monospace", color: C.accent3, letterSpacing: 2, fontWeight: 700 }}>
            📊 DATASET ENGINE
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Synthetic · Kaggle-compatible CSV</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onGenerate} style={{
            background: C.accent3 + "22", border: `1px solid ${C.accent3}66`,
            borderRadius: 7, color: C.accent3, fontSize: 10, padding: "6px 12px",
            cursor: "pointer", fontFamily: "monospace", letterSpacing: 0.5,
          }}>⚙ REGENERATE</button>
          <button onClick={onDownload} style={{
            background: C.green + "22", border: `1px solid ${C.green}66`,
            borderRadius: 7, color: C.green, fontSize: 10, padding: "6px 12px",
            cursor: "pointer", fontFamily: "monospace", letterSpacing: 0.5,
          }}>⬇ DOWNLOAD CSV</button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
        {[
          { label: "TOTAL ROWS",   val: dataset.length, color: C.accent  },
          { label: "UNIQUE TIMES", val: dataset.length / 4, color: C.green },
          { label: "PATTERNS",     val: Object.keys(patternCounts).length, color: C.accent3 },
          { label: "FEEDING ROW",  val: dataIdx * 4 % dataset.length, color: C.accent2 },
        ].map(s => (
          <div key={s.label} style={{
            background: C.bg, borderRadius: 8, padding: "8px 10px",
            border: `1px solid ${C.border}`, textAlign: "center",
          }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: s.color, fontFamily: "'Orbitron',monospace" }}>{s.val}</div>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: 1.5 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Data mode toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: "10px 12px", background: C.bg, borderRadius: 9, border: `1px solid ${C.border}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>Auto-Feed Dataset → Simulation</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
            {dataMode ? `Feeding row block ${dataIdx} • ${recentRows[0]?.pattern || "—"} pattern` : "Using random vehicle spawning"}
          </div>
        </div>
        <div onClick={() => setDataMode(v => !v)} style={{
          width: 50, height: 26, borderRadius: 13, cursor: "pointer",
          background: dataMode ? C.green + "88" : C.dimmed,
          border: `1.5px solid ${dataMode ? C.green : C.border}`,
          position: "relative", transition: "all 0.3s",
          boxShadow: dataMode ? `0 0 10px ${C.green}44` : "none",
        }}>
          <div style={{
            position: "absolute", top: 3, left: dataMode ? 27 : 3,
            width: 18, height: 18, borderRadius: "50%",
            background: dataMode ? C.green : C.muted, transition: "all 0.3s",
          }}/>
        </div>
        <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: dataMode ? C.green : C.muted, width: 24 }}>
          {dataMode ? "ON" : "OFF"}
        </span>
      </div>

      {/* Pattern breakdown */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>Traffic Pattern Distribution</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {Object.entries(patternCounts).map(([pat, cnt]) => {
            const pct = Math.round((cnt / dataset.length) * 100);
            const patColor = pat === "rush" ? C.red : pat === "evening" ? C.accent2 : pat === "offpeak" ? C.green : C.muted;
            const patLabel = pat === "rush" ? "Rush Hour 8–10AM" : pat === "evening" ? "Evening Rush 5–8PM" : pat === "offpeak" ? "Off-Peak 11AM–4PM" : "Night 9PM–6AM";
            return (
              <div key={pat}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: patColor }}>{patLabel}</span>
                  <span style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>{cnt} rows ({pct}%)</span>
                </div>
                <div style={{ background: C.dimmed, borderRadius: 3, height: 4 }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: patColor, borderRadius: 3, transition: "width 0.5s" }}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live feed preview */}
      {dataMode && recentRows.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 6, textTransform: "uppercase" }}>
            ⚡ Currently Feeding
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
              <thead>
                <tr>{["Lane","🚗","🏍️","🚶","Density","Wait"].map(h => (
                  <th key={h} style={{ color: C.muted, padding: "3px 6px", textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {recentRows.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? C.bg : "transparent" }}>
                    <td style={{ padding: "3px 6px", color: C.accent }}>{r.lane}</td>
                    <td style={{ padding: "3px 6px", color: C.car }}>{r.cars}</td>
                    <td style={{ padding: "3px 6px", color: C.bike }}>{r.bikes}</td>
                    <td style={{ padding: "3px 6px", color: C.ped }}>{r.pedestrians}</td>
                    <td style={{ padding: "3px 6px", color: C.green }}>{r.weighted_density}</td>
                    <td style={{ padding: "3px 6px", color: C.accent2 }}>{r.avg_wait_sec}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AI EXPLAINER ──────────────────────────────────────────────────────────────
function AIExplainer({ aiEnabled }) {
  const cards = [
    {
      title: "🔴 Manual Round Robin",
      points: ["Fixed 10s green per lane", "Ignores vehicle count", "Empty lanes waste time", "Uniform wait times"],
      color: C.red,
    },
    {
      title: "🟢 AI Adaptive (Ours)",
      points: ["Scans density every second", "Highest weighted density → green", "Car×1.5 / Bike×1.0 / Ped×0.5", "Emergency override 🚨"],
      color: C.green,
    },
    {
      title: "📦 Dataset Integration",
      points: ["Synthetic Bengaluru data", "4 traffic patterns baked in", "Auto-feeds vehicle types", "Kaggle-compatible CSV export"],
      color: C.accent3,
    },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
      {cards.map((card, i) => (
        <div key={i} style={{
          background: C.bg, border: `1px solid ${card.color}44`,
          borderRadius: 10, padding: "12px 14px",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: card.color, marginBottom: 8, fontFamily: "monospace" }}>
            {card.title}
          </div>
          {card.points.map((p, j) => (
            <div key={j} style={{
              fontSize: 11, color: C.muted, marginBottom: 4,
              paddingLeft: 8, borderLeft: `2px solid ${card.color}44`,
            }}>{p}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [aiEnabled, setAiEnabled] = useState(true);
  const [dataset, setDataset] = useState(() => generateDataset(200));
  const [dataMode, setDataMode] = useState(false);
  const [dataIdx, setDataIdx] = useState(0);
  const [activeTab, setActiveTab] = useState("simulation"); // simulation | dataset | about

  const { lanes, activeGreen, phase, phaseTimer, stats, spike, triggerEmergency } =
    useEngine(aiEnabled, dataset, dataMode);

  const totalQ = lanes.reduce((s, l) => s + l.vehicles.length, 0);

  const handleGenerate = () => {
    setDataset(generateDataset(200));
    setDataIdx(0);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Rajdhani','Segoe UI',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;500;600;700&display=swap');
        @keyframes scanline { 0%,100%{opacity:0.3} 50%{opacity:1} }
        @keyframes pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:#060d18; }
        ::-webkit-scrollbar-thumb { background:#162035; border-radius:2px; }
        button:hover { opacity:0.9; }
      `}</style>

      {/* HEADER */}
      <div style={{
        background: "linear-gradient(135deg,#0b1628,#060d18)",
        borderBottom: `1px solid ${C.border}`,
        padding: "14px 22px",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <div style={{
            fontSize: 20, fontWeight: 900, fontFamily: "'Orbitron',monospace",
            background: `linear-gradient(90deg,${C.accent},${C.green})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: 2,
          }}>NEXUS TRAFFIC AI</div>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginTop: 1 }}>
            AI JUNCTION OPTIMIZER · MIXED TRAFFIC · BENGALURU
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, background: C.panel, borderRadius: 9, padding: 4, border: `1px solid ${C.border}` }}>
          {[["simulation","🚦 Simulation"],["dataset","📊 Dataset"],["about","ℹ About"]].map(([tab, label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              background: activeTab === tab ? C.accent + "22" : "transparent",
              border: activeTab === tab ? `1px solid ${C.accent}55` : "1px solid transparent",
              borderRadius: 6, color: activeTab === tab ? C.accent : C.muted,
              fontSize: 11, padding: "6px 14px", cursor: "pointer",
              fontFamily: "monospace", letterSpacing: 0.5, transition: "all 0.2s",
            }}>{label}</button>
          ))}
        </div>

        {/* AI Toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, color: C.muted, fontFamily: "monospace", letterSpacing: 1 }}>AI ENGINE</span>
          <div onClick={() => setAiEnabled(v => !v)} style={{
            width: 50, height: 26, borderRadius: 13, cursor: "pointer",
            background: aiEnabled ? C.green + "88" : C.dimmed,
            border: `1.5px solid ${aiEnabled ? C.green : C.border}`,
            position: "relative", transition: "all 0.3s",
            boxShadow: aiEnabled ? `0 0 12px ${C.green}44` : "none",
          }}>
            <div style={{
              position: "absolute", top: 3, left: aiEnabled ? 27 : 3,
              width: 18, height: 18, borderRadius: "50%",
              background: aiEnabled ? C.green : C.muted, transition: "all 0.3s",
            }}/>
          </div>
          <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: aiEnabled ? C.green : C.red, letterSpacing: 1 }}>
            {aiEnabled ? "ON" : "OFF"}
          </span>
        </div>
      </div>

      <div style={{ padding: "18px 18px", maxWidth: 1200, margin: "0 auto" }}>

        {/* KPI BAR — always visible */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 18 }}>
          {[
            { label: "ACTIVE SIGNAL", val: DIRS[activeGreen].toUpperCase(), color: phase === "green" ? C.green : C.yellow, sub: `${phaseTimer}s ${phase}` },
            { label: "QUEUED",        val: totalQ,                           color: C.accent,  sub: "all lanes" },
            { label: "CLEARED",       val: stats.totalCleared,               color: C.green,   sub: "vehicles" },
            { label: "AVG WAIT",      val: `${stats.avgWait}s`,              color: C.accent2, sub: aiEnabled ? "AI mode" : "manual" },
            { label: "DATA SOURCE",   val: dataMode ? "DATASET" : "RANDOM",  color: dataMode ? C.accent3 : C.muted, sub: dataMode ? "CSV feed" : "synthetic random" },
          ].map((s, i) => (
            <div key={i} style={{
              background: C.panel, border: `1px solid ${C.border}`,
              borderRadius: 9, padding: "10px 14px", textAlign: "center",
            }}>
              <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Orbitron',monospace", color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 8, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 2 }}>{s.label}</div>
              <div style={{ fontSize: 9, color: s.color + "99", marginTop: 1 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* SIMULATION TAB */}
        {activeTab === "simulation" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,240px) 1fr", gap: 14, marginBottom: 16, alignItems: "start" }}>
              {/* Junction panel */}
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>Live View</div>
                <Junction lanes={lanes} activeGreen={activeGreen} phase={phase}/>
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {VTYPES.map(vt => (
                    <div key={vt.type} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 11 }}>{vt.emoji}</span>
                      <span style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>×{vt.weight}</span>
                    </div>
                  ))}
                </div>
                {/* Phase bar */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>PHASE</span>
                    <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, color: phase === "green" ? C.green : C.yellow }}>{phaseTimer}s</span>
                  </div>
                  <div style={{ background: C.dimmed, borderRadius: 3, height: 4 }}>
                    <div style={{ width: `${(phaseTimer / 20) * 100}%`, height: "100%", background: phase === "green" ? C.green : C.yellow, borderRadius: 3, transition: "width 0.5s" }}/>
                  </div>
                </div>
                {/* Throughput */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 4, textTransform: "uppercase" }}>Throughput</div>
                  <MiniChart data={stats.throughput} color={C.accent} height={45} width="100%"/>
                </div>
                {/* Wait time */}
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 4, textTransform: "uppercase" }}>Avg Wait Time</div>
                  <MiniChart data={stats.waitHistory} color={C.accent2} height={45} width="100%"/>
                </div>
              </div>

              {/* Lane cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
                {lanes.map((lane, i) => (
                  <LaneCard key={lane.dir} lane={lane} isActive={activeGreen === i}
                    phase={phase} onSpike={spike} onEmergency={triggerEmergency}/>
                ))}
              </div>
            </div>

            {/* AI Explainer */}
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>How the AI Works</div>
              <AIExplainer aiEnabled={aiEnabled}/>
            </div>
          </>
        )}

        {/* DATASET TAB */}
        {activeTab === "dataset" && (
          <DatasetPanel
            dataset={dataset} dataMode={dataMode} setDataMode={setDataMode}
            onGenerate={handleGenerate} onDownload={() => downloadCSV(dataset)} dataIdx={dataIdx}
          />
        )}

        {/* ABOUT TAB */}
        {activeTab === "about" && (
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontFamily: "'Orbitron',monospace", color: C.accent, letterSpacing: 2, marginBottom: 16 }}>
              PROJECT OVERVIEW
            </div>
            {[
              { title: "🎯 Problem Statement", body: "Design an AI-based adaptive traffic signal system that optimizes junction flow for mixed traffic (vehicles, two-wheelers, pedestrians) in real-time, reducing average wait times and congestion using dynamic signal scheduling." },
              { title: "📦 Dataset", body: "Since the Bangalore South Traffic Police (DC Dr. Gopal) could not share real data due to sensitivity of vehicle number plates and personal information, we generated a synthetic dataset matching Bengaluru's real traffic patterns — rush hour, off-peak, evening rush, and night. The dataset is Kaggle-compatible and downloadable as CSV." },
              { title: "🧠 AI Algorithm", body: "Each lane is assigned a weighted density score: Cars × 1.5, Bikes × 1.0, Pedestrians × 0.5. Every second, the AI scans all 4 lanes and assigns the green signal to the highest-density lane. Emergency vehicles instantly override all signals." },
              { title: "🆚 AI vs Manual", body: "Toggle AI OFF to see round-robin mode: every lane gets equal green time regardless of vehicle count. Toggle AI ON and use SPIKE to dump traffic — watch the AI instantly prioritize the busiest lane." },
              { title: "🛠 Tech Stack", body: "React (no backend), in-browser AI logic, synthetic dataset generator, CSV export — fully runs on one laptop. No hardware required." },
            ].map((s, i) => (
              <div key={i} style={{ marginBottom: 16, padding: "12px 14px", background: C.bg, borderRadius: 9, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6, fontFamily: "monospace" }}>{s.title}</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>{s.body}</div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: "center", fontSize: 9, color: C.dimmed, letterSpacing: 2, padding: "16px 0 6px", fontFamily: "monospace" }}>
          NEXUS TRAFFIC AI · HACKATHON · AI-BASED JUNCTION OPTIMIZATION FOR MIXED TRAFFIC · BENGALURU
        </div>
      </div>
    </div>
  );
}
