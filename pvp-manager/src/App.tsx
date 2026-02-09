import React, { useEffect, useMemo, useState } from "react";

type Role = "TANK" | "HEALER" | "DPS";
type DpsType = "MELEE" | "RANGED";
type Level = "BAJO" | "MEDIO" | "ALTO";

const DPS_RANGED_WEAPONS = ["Sombrilla", "Abanico"] as const;
const DPS_MELEE_WEAPONS = [
  "Espada estratégica",
  "Lanza sin nombre",
  "Lanza rompe vientos",
  "Espada sin nombres",
  "Duales",
  "Dardo",
] as const;

type Weapon =
  | (typeof DPS_RANGED_WEAPONS)[number]
  | (typeof DPS_MELEE_WEAPONS)[number]
  | "—";

type Player = {
  id: string;
  nick: string;
  role: Role;
  dpsType: DpsType | null; // solo DPS
  weapon: Weapon;          // solo DPS
  level: Level;            // solo informativo

  active: boolean;

  wins: number;
  losses: number;

  lastOpponents: string[]; // ids de últimos rivales (para anti-repetición)
  lastPlayedAt: number | null;
};

type Match = {
  aId: string;
  bId: string;
  createdAt: number;
};

type MatchResult = {
  match: Match;
  winnerId: string;
  loserId: string;
  finishedAt: number;
};

type Mode = "RANDOM" | "SMART";

const LS_KEY = "pvp_manager_mix_v1";

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function clampHistory(arr: string[], max = 3) {
  return arr.slice(0, max);
}

function loadState(): { players: Player[]; results: MatchResult[]; queue: string[] } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { players: [], results: [], queue: [] };
    const parsed = JSON.parse(raw);
    return {
      players: Array.isArray(parsed.players) ? parsed.players : [],
      results: Array.isArray(parsed.results) ? parsed.results : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
    };
  } catch {
    return { players: [], results: [], queue: [] };
  }
}

function saveState(players: Player[], results: MatchResult[], queue: string[]) {
  localStorage.setItem(LS_KEY, JSON.stringify({ players, results, queue }));
}

function recentlyPlayed(p: Player, oppId: string, recentCount: number) {
  // revisa los N últimos rivales
  return p.lastOpponents.slice(0, recentCount).includes(oppId);
}

// ---- Scoring: SMART = MEZCLA TODO (NO BALANCE) ----
function roleMixScore(a: Player, b: Player) {
  // Prioriza roles distintos
  if (a.role !== b.role) return 6;
  return 2; // espejo
}

function dpsVarietyScore(a: Player, b: Player) {
  // Solo aplica si ambos son DPS
  if (a.role !== "DPS" || b.role !== "DPS") return 0;
  if (a.dpsType && b.dpsType && a.dpsType !== b.dpsType) return 3; // melee vs ranged
  return 1;
}

function weaponVarietyScore(a: Player, b: Player) {
  if (a.role !== "DPS" || b.role !== "DPS") return 0;
  if (!a.weapon || !b.weapon) return 0;
  if (a.weapon !== b.weapon) return 2;
  return 0;
}

function pickMatchFromQueue(opts: {
  queue: string[];
  playersById: Map<string, Player>;
  mode: Mode;
  randomA: boolean;
  randomATopN: number;
  avoidRecent: boolean;
  recentOppCount: number;
}): Match | null {
  const { queue, playersById, mode, randomA, randomATopN, avoidRecent, recentOppCount } = opts;

  const activeQueue = queue
    .map(id => playersById.get(id))
    .filter((p): p is Player => !!p && p.active);

  if (activeQueue.length < 2) return null;

  // A: por cola (rotación) o random dentro de los primeros N
  const topN = Math.max(2, Math.min(activeQueue.length, randomATopN));
  const a = randomA
    ? activeQueue[Math.floor(Math.random() * topN)]
    : activeQueue[0];

  // candidatos excluyendo A
  const candidates = activeQueue.filter(p => p.id !== a.id);
  if (!candidates.length) return null;

  if (mode === "RANDOM") {
    // Random puro, pero si avoidRecent está on, intenta no repetir
    const pool = avoidRecent
      ? candidates.filter(c => !recentlyPlayed(a, c.id, recentOppCount))
      : candidates;

    const finalPool = pool.length ? pool : candidates;
    const b = finalPool[Math.floor(Math.random() * finalPool.length)];
    return { aId: a.id, bId: b.id, createdAt: Date.now() };
  }

  // SMART: mezcla roles/armas, evita rival reciente si está activado
  let best = candidates[0];
  let bestScore = -999999;
  const now = Date.now();

  for (const c of candidates) {
    const recentPenalty =
      avoidRecent && recentlyPlayed(a, c.id, recentOppCount) ? 35 : 0;

    // penaliza que alguien juegue demasiado seguido (para que rote un poco)
    const recencyPenalty =
      (a.lastPlayedAt && now - a.lastPlayedAt < 60 * 1000 ? 4 : 0) +
      (c.lastPlayedAt && now - c.lastPlayedAt < 60 * 1000 ? 4 : 0);

    // Score = VARIEDAD + random leve - penalizaciones
    const score =
      roleMixScore(a, c) * 14 +
      dpsVarietyScore(a, c) * 8 +
      weaponVarietyScore(a, c) * 6 +
      (Math.random() * 6) -
      recentPenalty -
      recencyPenalty;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return { aId: a.id, bId: best.id, createdAt: Date.now() };
}

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="badge">{children}</span>
);

export default function App() {
  const [{ players, results, queue }, setData] = useState(() => loadState());

  const [mode, setMode] = useState<Mode>("SMART");
  const [currentMatch, setCurrentMatch] = useState<Match | null>(null);

  // Toggles
  const [randomA, setRandomA] = useState(true);
  const [randomATopN, setRandomATopN] = useState(6);
  const [avoidRecent, setAvoidRecent] = useState(true);
  const [recentOppCount, setRecentOppCount] = useState(3);

  // Form
  const [nick, setNick] = useState("");
  const [role, setRole] = useState<Role>("DPS");
  const [dpsType, setDpsType] = useState<DpsType>("MELEE");
  const [weapon, setWeapon] = useState<Weapon>("Espada estratégica");
  const [level, setLevel] = useState<Level>("MEDIO");

  useEffect(() => {
    saveState(players, results, queue);
  }, [players, results, queue]);

  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    players.forEach(p => map.set(p.id, p));
    return map;
  }, [players]);

  const activeCount = useMemo(() => players.filter(p => p.active).length, [players]);

  const matchA = currentMatch ? playersById.get(currentMatch.aId) : null;
  const matchB = currentMatch ? playersById.get(currentMatch.bId) : null;

  // Ajustes automáticos de arma según rol/dpsType
  useEffect(() => {
    if (role === "DPS") {
      if (dpsType === "RANGED") {
        if (!DPS_RANGED_WEAPONS.includes(weapon as any)) setWeapon("Sombrilla");
      } else {
        if (!DPS_MELEE_WEAPONS.includes(weapon as any)) setWeapon("Espada estratégica");
      }
    } else {
      setWeapon("—");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    if (role !== "DPS") return;
    if (dpsType === "RANGED") {
      if (!DPS_RANGED_WEAPONS.includes(weapon as any)) setWeapon("Sombrilla");
    } else {
      if (!DPS_MELEE_WEAPONS.includes(weapon as any)) setWeapon("Espada estratégica");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpsType]);

  const weaponOptions: Weapon[] =
    role !== "DPS"
      ? ["—"]
      : dpsType === "RANGED"
      ? [...DPS_RANGED_WEAPONS]
      : [...DPS_MELEE_WEAPONS];

  function addPlayer() {
    const cleanNick = nick.trim();
    if (!cleanNick) return;

    const exists = players.some(p => p.nick.trim().toLowerCase() === cleanNick.toLowerCase());
    if (exists) {
      alert("Ese nick ya existe ❌");
      return;
    }

    const p: Player = {
      id: uid(),
      nick: cleanNick,
      role,
      dpsType: role === "DPS" ? dpsType : null,
      weapon: role === "DPS" ? weapon : "—",
      level,
      active: true,
      wins: 0,
      losses: 0,
      lastOpponents: [],
      lastPlayedAt: null,
    };

    setData(prev => ({
      ...prev,
      players: [p, ...prev.players],
      queue: [...prev.queue, p.id],
    }));

    setNick("");
    setRole("DPS");
    setDpsType("MELEE");
    setWeapon("Espada estratégica");
    setLevel("MEDIO");
  }

  function toggleActive(id: string) {
    if (currentMatch && (currentMatch.aId === id || currentMatch.bId === id)) setCurrentMatch(null);

    setData(prev => ({
      ...prev,
      players: prev.players.map(p => (p.id === id ? { ...p, active: !p.active } : p)),
    }));
  }

  function updatePlayerLevel(id: string, newLevel: Level) {
    setData(prev => ({
      ...prev,
      players: prev.players.map(p => (p.id === id ? { ...p, level: newLevel } : p)),
    }));
  }

  function removePlayer(id: string) {
    if (currentMatch && (currentMatch.aId === id || currentMatch.bId === id)) setCurrentMatch(null);

    setData(prev => ({
      ...prev,
      players: prev.players.filter(p => p.id !== id),
      queue: prev.queue.filter(qid => qid !== id),
    }));
  }

  function rebuildQueueFromPlayers() {
    const activeIds = players.filter(p => p.active).map(p => p.id);
    const inactiveIds = players.filter(p => !p.active).map(p => p.id);
    setData(prev => ({ ...prev, queue: [...activeIds, ...inactiveIds] }));
  }

  function nextMatch() {
    const m = pickMatchFromQueue({
      queue,
      playersById,
      mode,
      randomA,
      randomATopN,
      avoidRecent,
      recentOppCount,
    });
    setCurrentMatch(m);
  }

  function resetMatch() {
    setCurrentMatch(null);
  }

  function applyResult(winnerId: string, loserId: string) {
    if (!currentMatch) return;

    const res: MatchResult = {
      match: currentMatch,
      winnerId,
      loserId,
      finishedAt: Date.now(),
    };

    setData(prev => {
      const updatedPlayers = prev.players.map(p => {
        if (p.id !== winnerId && p.id !== loserId) return p;

        const opponentId = p.id === winnerId ? loserId : winnerId;
        const newLastOpp = clampHistory([opponentId, ...p.lastOpponents], 10); // guardamos más, el slider decide cuánto usar

        return {
          ...p,
          wins: p.id === winnerId ? p.wins + 1 : p.wins,
          losses: p.id === loserId ? p.losses + 1 : p.losses,
          lastOpponents: newLastOpp,
          lastPlayedAt: Date.now(),
        };
      });

      // Cola: sacamos a ambos y los mandamos al final:
      // ganador antes, perdedor último (tu regla)
      const filteredQueue = prev.queue.filter(id => id !== winnerId && id !== loserId);
      const newQueue = [...filteredQueue, winnerId, loserId];

      return {
        players: updatedPlayers,
        results: [res, ...prev.results],
        queue: newQueue,
      };
    });

    setCurrentMatch(null);
  }

  function copyMatchToClipboard() {
    if (!matchA || !matchB) return;

    const fmt = (p: Player) => {
      const dps = p.role === "DPS" ? ` (${p.dpsType === "RANGED" ? "DPS Distancia" : "DPS Melee"} - ${p.weapon})` : "";
      return `${p.nick} [${p.role}${dps}]`;
    };

    const text = `⚔️ PvP 1v1: ${fmt(matchA)} vs ${fmt(matchB)}`;
    navigator.clipboard.writeText(text).catch(() => {});
    alert("Match copiado ✅ (pégalo en Discord)");
  }

  function exportJSON() {
    const payload = JSON.stringify({ players, results, queue }, null, 2);
    navigator.clipboard.writeText(payload).catch(() => {});
    alert("Export copiado al portapapeles ✅");
  }

  function importJSON() {
    const raw = prompt("Pega aquí el JSON exportado:");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const newPlayers: Player[] = Array.isArray(parsed.players) ? parsed.players : [];
      const newResults: MatchResult[] = Array.isArray(parsed.results) ? parsed.results : [];
      const newQueue: string[] = Array.isArray(parsed.queue) ? parsed.queue : newPlayers.map(p => p.id);
      setCurrentMatch(null);
      setData({ players: newPlayers, results: newResults, queue: newQueue });
      alert("Importado ✅");
    } catch {
      alert("JSON inválido ❌");
    }
  }

  function resetAll() {
    if (!confirm("¿Reset total? Se borran jugadores, resultados y cola.")) return;
    setCurrentMatch(null);
    setData({ players: [], results: [], queue: [] });
  }

  return (
    <div className="shinigami-app">
      <style>{`
        :root {
          --bg: #0b0f14;
          --panel: rgba(16, 22, 30, 0.78);
          --panel2: rgba(12, 16, 22, 0.92);
          --text: #e9eef6;
          --muted: rgba(233, 238, 246, 0.7);
          --border: rgba(255, 255, 255, 0.10);
          --border2: rgba(255, 255, 255, 0.16);
          --shadow: 0 10px 30px rgba(0,0,0,0.45);

          /* Bleach / Shinigami vibe */
          --reiatsu: #6fb6ff;      /* blue glow */
          --bankai: #ff0033;       /* verisure red = blood/bankai */
          --spirit: #a78bfa;       /* purple */
          --healer: #22c55e;       /* green */
          --tank: #22d3ee;         /* cyan */
          --warn: #f59e0b;
          --danger: #ff6b6b;
          --radius: 16px;
        }

        .shinigami-app{
          max-width: 1150px;
          margin: 0 auto;
          padding: 18px;
          font-family: system-ui, -apple-system, Segoe UI, Roboto;
          color: var(--text);
        }

        /* App background layer */
        .shinigami-app::before{
          content: "";
          position: fixed;
          inset: 0;
          z-index: -2;
          background:
            radial-gradient(900px 500px at 12% 8%, rgba(111,182,255,0.18), transparent 60%),
            radial-gradient(900px 500px at 88% 14%, rgba(255,0,51,0.14), transparent 60%),
            radial-gradient(900px 500px at 70% 90%, rgba(167,139,250,0.14), transparent 60%),
            linear-gradient(180deg, #06080c 0%, #0b0f14 35%, #070a0f 100%);
        }

        .row{
          display:flex;
          justify-content:space-between;
          gap:12px;
          flex-wrap:wrap;
          align-items:center;
        }

        h1{
          letter-spacing: -0.02em;
          font-weight: 900;
          font-size: clamp(28px, 2.5vw, 40px);
          margin: 0;
          display:flex;
          gap:10px;
          align-items:center;
        }

        .title-icon{
          filter: drop-shadow(0 0 10px rgba(111,182,255,0.35));
        }

        .subline{
          margin-top: 8px;
          color: var(--muted);
          display:flex;
          gap:10px;
          align-items:center;
          flex-wrap:wrap;
        }

        .badge{
          display:inline-flex;
          gap:6px;
          align-items:center;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03);
          font-size: 12px;
        }

        .btn{
          appearance:none;
          border: 1px solid var(--border2);
          background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));
          color: var(--text);
          padding: 10px 14px;
          border-radius: 12px;
          cursor: pointer;
          transition: transform .08s ease, box-shadow .15s ease, border-color .15s ease, opacity .15s ease;
          box-shadow: var(--shadow);
        }
        .btn:hover{ border-color: rgba(111,182,255,0.35); box-shadow: 0 10px 35px rgba(0,0,0,0.55), 0 0 0 3px rgba(111,182,255,0.10); }
        .btn:active{ transform: translateY(1px); }
        .btn:disabled{ opacity: .45; cursor:not-allowed; box-shadow: none; }

        .btn.primary{
          border-color: rgba(255,0,51,0.45);
          background: linear-gradient(180deg, rgba(255,0,51,0.22), rgba(255,0,51,0.10));
        }
        .btn.primary:hover{ box-shadow: 0 10px 35px rgba(0,0,0,0.55), 0 0 0 3px rgba(255,0,51,0.14); }

        .btn.ghost{
          border-color: rgba(111,182,255,0.35);
          background: linear-gradient(180deg, rgba(111,182,255,0.16), rgba(111,182,255,0.06));
        }

        .btn.danger{
          border-color: rgba(255,107,107,0.45);
          background: linear-gradient(180deg, rgba(255,107,107,0.20), rgba(255,107,107,0.08));
        }

        select, input{
          width: 100%;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--border2);
          color: var(--text);
          background: rgba(8, 11, 16, 0.65);
          outline: none;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03);
        }
        input::placeholder{ color: rgba(233,238,246,0.45); }
        select:disabled, input:disabled{ opacity: .55; }

        hr{
          border: none;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(111,182,255,0.20), rgba(255,0,51,0.16), transparent);
          margin: 18px 0;
        }

        .card{
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: linear-gradient(180deg, var(--panel), var(--panel2));
          box-shadow: var(--shadow);
          padding: 14px;
          position: relative;
          overflow: hidden;
        }
        .card::before{
          content:"";
          position:absolute;
          inset:-2px;
          background: radial-gradient(600px 160px at 15% 0%, rgba(111,182,255,0.16), transparent 55%),
                      radial-gradient(600px 160px at 85% 0%, rgba(255,0,51,0.12), transparent 55%);
          z-index: 0;
          pointer-events: none;
        }
        .card > *{ position: relative; z-index: 1; }

        .match-grid{
          display:grid;
          grid-template-columns: 1fr 80px 1fr;
          gap: 12px;
          align-items: center;
        }

        .fighter{
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 14px;
          padding: 12px;
          background: rgba(0,0,0,0.25);
        }

        .fighter h3{ margin:0; font-size: 20px; font-weight: 900; }
        .meta{ margin-top: 8px; color: var(--muted); line-height: 1.5; }

        .pill{
          display:inline-flex;
          align-items:center;
          padding: 2px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.06);
          font-size: 12px;
          margin-right: 6px;
        }
        .role-tank{ border-color: rgba(34,211,238,0.45); box-shadow: 0 0 0 2px rgba(34,211,238,0.08) inset; }
        .role-healer{ border-color: rgba(34,197,94,0.45); box-shadow: 0 0 0 2px rgba(34,197,94,0.08) inset; }
        .role-dps{ border-color: rgba(255,0,51,0.45); box-shadow: 0 0 0 2px rgba(255,0,51,0.08) inset; }

        .queue-chip{
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.22);
        }

        table{ width: 100%; border-collapse: collapse; }
        thead th{
          color: rgba(233,238,246,0.82);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: .08em;
          padding: 10px 8px;
          border-bottom: 1px solid rgba(255,255,255,0.10);
        }
        tbody td{
          padding: 10px 8px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          color: rgba(233,238,246,0.9);
        }
        tbody tr:hover td{ background: rgba(111,182,255,0.04); }

        .toolbar{
          display:flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .small{
          font-size: 12px;
          color: var(--muted);
        }

        .vs{
          text-align:center;
          font-weight: 1000;
          font-size: 22px;
          color: rgba(233,238,246,0.92);
          text-shadow: 0 0 20px rgba(111,182,255,0.22);
        }

        .range-row{
          display:flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items:center;
        }

        input[type="range"]{ width: 140px; accent-color: var(--reiatsu); }

        .section-title{
          margin: 0 0 10px 0;
          font-size: 18px;
          font-weight: 900;
          display:flex;
          gap: 10px;
          align-items:center;
        }
      `}</style>
      <header className="row">
        <div>
          <h1><span className="title-icon">⚔️</span> PvP 1v1 Manager <span style={{ opacity: 0.75 }}>(Mix)</span></h1>
          <div className="subline">
            <span>Activos: <b>{activeCount}</b></span>
            <span>•</span>
            <span>Resultados: <b>{results.length}</b></span>
            <Badge>mezcla todo</Badge>
            <Badge>loser al final</Badge>
            <Badge>copiar match</Badge>
          </div>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={exportJSON}>Export JSON</button>
          <button className="btn ghost" onClick={importJSON}>Import JSON</button>
          <button className="btn danger" onClick={resetAll}>Reset</button>
        </div>
      </header>

      <hr />

      {/* Controls */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <div className="card row">
          <div className="range-row">
            <b>Modo:</b>
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="SMART">Smart (mezcla todo)</option>
              <option value="RANDOM">Random</option>
            </select>
            <button className="btn primary" onClick={nextMatch} disabled={activeCount < 2}>🎲 Siguiente match</button>
            <button className="btn" onClick={resetMatch} disabled={!currentMatch}>Reset match</button>
            <button className="btn ghost" onClick={rebuildQueueFromPlayers}>Rearmar cola</button>
            <button className="btn" onClick={copyMatchToClipboard} disabled={!currentMatch || !matchA || !matchB}>📋 Copiar match</button>
          </div>
          <div className="range-row" style={{ opacity: 0.9 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={randomA} onChange={() => setRandomA(v => !v)} />
              A random (top N)
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              N:
              <input
                type="range"
                min={2}
                max={12}
                value={randomATopN}
                onChange={(e) => setRandomATopN(Number(e.target.value))}
              />
              <b>{randomATopN}</b>
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={avoidRecent} onChange={() => setAvoidRecent(v => !v)} />
              Evitar rival reciente
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Últimos:
              <input
                type="range"
                min={1}
                max={8}
                value={recentOppCount}
                onChange={(e) => setRecentOppCount(Number(e.target.value))}
                disabled={!avoidRecent}
              />
              <b>{recentOppCount}</b>
            </label>
          </div>
        </div>

        {/* Current match */}
        <div className="card">
          <h2 className="section-title">🔥 Match actual</h2>
          {!currentMatch || !matchA || !matchB ? (
            <div style={{ opacity: 0.75 }}>No hay match aún. Dale a <b>Siguiente match</b>.</div>
          ) : (
            <div className="match-grid">
              <div className="fighter">
                <h3>{matchA.nick}</h3>
                <div className="meta">
                  <div>
                    <span className={`pill role-${matchA.role.toLowerCase()}`}>{matchA.role}</span>
                    {matchA.role === "DPS" && matchA.dpsType ? (
                      <>
                        <span className="pill">{matchA.dpsType === "RANGED" ? "Distancia" : "Melee"}</span>
                        <span className="pill">{matchA.weapon}</span>
                      </>
                    ) : null}
                    <span className="pill">Nivel: {matchA.level}</span>
                  </div>
                  Score: <b>{matchA.wins}-{matchA.losses}</b>
                </div>
                <button className="btn primary" style={{ marginTop: 10, width: "100%" }} onClick={() => applyResult(matchA.id, matchB.id)}>
                  🟩 Gana {matchA.nick}
                </button>
              </div>
              <div className="vs">VS</div>
              <div className="fighter">
                <h3>{matchB.nick}</h3>
                <div className="meta">
                  <div>
                    <span className={`pill role-${matchB.role.toLowerCase()}`}>{matchB.role}</span>
                    {matchB.role === "DPS" && matchB.dpsType ? (
                      <>
                        <span className="pill">{matchB.dpsType === "RANGED" ? "Distancia" : "Melee"}</span>
                        <span className="pill">{matchB.weapon}</span>
                      </>
                    ) : null}
                    <span className="pill">Nivel: {matchB.level}</span>
                  </div>
                  Score: <b>{matchB.wins}-{matchB.losses}</b>
                </div>
                <button className="btn primary" style={{ marginTop: 10, width: "100%" }} onClick={() => applyResult(matchB.id, matchA.id)}>
                  🟩 Gana {matchB.nick}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <hr />

      {/* Add player */}
      <section className="card">
        <h2 className="section-title">➕ Registrar jugador</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.7fr 0.9fr 1fr 0.8fr 0.6fr", gap: 10 }}>
          <input
            placeholder="Nick (único)"
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" ? addPlayer() : null)}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="TANK">Tank</option>
            <option value="HEALER">Healer</option>
            <option value="DPS">DPS</option>
          </select>
          <select value={dpsType} onChange={(e) => setDpsType(e.target.value as DpsType)} disabled={role !== "DPS"}>
            <option value="MELEE">DPS Melee</option>
            <option value="RANGED">DPS Distancia</option>
          </select>
          <select value={weapon} onChange={(e) => setWeapon(e.target.value as Weapon)} disabled={role !== "DPS"}>
            {weaponOptions.map(w => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            <option value="BAJO">Bajo</option>
            <option value="MEDIO">Medio</option>
            <option value="ALTO">Alto</option>
          </select>
          <button className="btn primary" onClick={addPlayer} disabled={!nick.trim()}>Agregar</button>
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          Se agrega al final de la cola. El nivel es solo informativo (no afecta emparejamiento).
        </div>
      </section>

      <hr />

      {/* Queue */}
      <section className="card">
        <h2 className="section-title">🧾 Cola (orden actual)</h2>
        {queue.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Aún no hay cola.</div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {queue.map((id, idx) => {
              const p = playersById.get(id);
              if (!p) return null;
              return (
                <span
                  key={id}
                  className="queue-chip"
                  style={{
                    opacity: p.active ? 1 : 0.4,
                  }}
                >
                  {idx + 1}. <b>{p.nick}</b>
                </span>
              );
            })}
          </div>
        )}
      </section>

      <hr />

      {/* Players */}
      <section className="card">
        <h2 className="section-title">👥 Jugadores</h2>
        {players.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Aún no agregas jugadores.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th>Activo</th>
                  <th>Nick</th>
                  <th>Nivel</th>
                  <th>Rol</th>
                  <th>Tipo DPS</th>
                  <th>Arma</th>
                  <th>W-L</th>
                  <th>Últimos rivales</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {players.map(p => (
                  <tr key={p.id}>
                    <td>
                      <input type="checkbox" checked={p.active} onChange={() => toggleActive(p.id)} />
                    </td>
                    <td style={{ fontWeight: 700 }}>{p.nick}</td>
                    <td>
                      <select value={p.level} onChange={(e) => updatePlayerLevel(p.id, e.target.value as Level)}>
                        <option value="BAJO">Bajo</option>
                        <option value="MEDIO">Medio</option>
                        <option value="ALTO">Alto</option>
                      </select>
                    </td>
                    <td>{p.role}</td>
                    <td>
                      {p.role === "DPS" ? (p.dpsType === "RANGED" ? "Distancia" : "Melee") : "—"}
                    </td>
                    <td>{p.role === "DPS" ? p.weapon : "—"}</td>
                    <td>{p.wins}-{p.losses}</td>
                    <td style={{ opacity: 0.85 }}>
                      {p.lastOpponents.length
                        ? p.lastOpponents
                            .slice(0, 5)
                            .map(id => playersById.get(id)?.nick)
                            .filter(Boolean)
                            .join(", ")
                        : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn danger" onClick={() => removePlayer(p.id)}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <hr />

      {/* History */}
      <section className="card">
        <h2 className="section-title">🧾 Historial (últimos 10)</h2>
        {results.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Sin resultados aún.</div>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {results.slice(0, 10).map((r, idx) => {
              const w = playersById.get(r.winnerId)?.nick ?? "??";
              const l = playersById.get(r.loserId)?.nick ?? "??";
              return (
                <li key={idx} style={{ padding: "6px 0" }}>
                  🟩 <b>{w}</b> ganó a 🟥 <b>{l}</b>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <footer style={{ marginTop: 18, opacity: 0.65, fontSize: 12 }}>
        Smart = mezcla roles/armas y evita repetición (si está activado). Cola rotativa: ganador al final, perdedor último.
      </footer>
    </div>
  );
}