import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

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
  weapon1: Weapon; // solo DPS
  weapon2: Weapon; // solo DPS
  level: Level; // solo informativo

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
const BC_NAME = "pvp_manager_bc_v1";

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function clampHistory(arr: string[], max = 3) {
  return arr.slice(0, max);
}

function loadState(): {
  players: Player[];
  results: MatchResult[];
  queue: string[];
  currentMatch: Match | null;
  screenMatches: Match[];
} {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw)
      return {
        players: [],
        results: [],
        queue: [],
        currentMatch: null,
        screenMatches: [],
      };
    const parsed = JSON.parse(raw);

    const migratedPlayers: Player[] = Array.isArray(parsed.players)
      ? parsed.players.map((p: any) => {
          // Already migrated
          if (p && ("weapon1" in p || "weapon2" in p)) {
            return {
              ...p,
              weapon1: p.weapon1 ?? p.weapon ?? "—",
              weapon2: p.weapon2 ?? p.weapon ?? "—",
            } as Player;
          }

          // Legacy format: single weapon
          if (p && "weapon" in p) {
            const w = p.weapon ?? "—";
            return {
              ...p,
              weapon1: w,
              weapon2: w,
            } as Player;
          }

          // Fallback
          return {
            ...p,
            weapon1: p?.weapon1 ?? "—",
            weapon2: p?.weapon2 ?? "—",
          } as Player;
        })
      : [];

    return {
      players: migratedPlayers,
      results: Array.isArray(parsed.results) ? parsed.results : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      currentMatch: parsed.currentMatch ?? null,
      screenMatches: Array.isArray(parsed.screenMatches)
        ? parsed.screenMatches
        : [],
    };
  } catch {
    return {
      players: [],
      results: [],
      queue: [],
      currentMatch: null,
      screenMatches: [],
    };
  }
}

function saveState(
  players: Player[],
  results: MatchResult[],
  queue: string[],
  currentMatch: Match | null,
  screenMatches: Match[]
) {
  localStorage.setItem(
    LS_KEY,
    JSON.stringify({
      players,
      results,
      queue,
      currentMatch,
      screenMatches,
      savedAt: Date.now(),
    })
  );
}

function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/plain;charset=utf-8"
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(v: unknown) {
  const s = String(v ?? "");
  // Quote if it contains comma, quote or newline
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  // ISO-ish but Excel friendly
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

  const aSet = new Set([a.weapon1, a.weapon2].filter(Boolean));
  const bSet = new Set([b.weapon1, b.weapon2].filter(Boolean));

  let diff = 0;
  for (const w of aSet) if (!bSet.has(w)) diff++;
  for (const w of bSet) if (!aSet.has(w)) diff++;

  if (diff >= 3) return 3;
  if (diff === 2) return 2;
  if (diff === 1) return 1;
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
  const {
    queue,
    playersById,
    mode,
    randomA,
    randomATopN,
    avoidRecent,
    recentOppCount,
  } = opts;

  const activeQueue = queue
    .map((id) => playersById.get(id))
    .filter((p): p is Player => !!p && p.active);

  if (activeQueue.length < 2) return null;

  // A: por cola (rotación) o random dentro de los primeros N
  const topN = Math.max(2, Math.min(activeQueue.length, randomATopN));
  const a = randomA
    ? activeQueue[Math.floor(Math.random() * topN)]
    : activeQueue[0];

  // candidatos excluyendo A
  const candidates = activeQueue.filter((p) => p.id !== a.id);
  if (!candidates.length) return null;

  if (mode === "RANDOM") {
    // Random puro, pero si avoidRecent está on, intenta no repetir
    const pool = avoidRecent
      ? candidates.filter((c) => !recentlyPlayed(a, c.id, recentOppCount))
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
      Math.random() * 6 -
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
  const [
    { players, results, queue, currentMatch: persistedMatch, screenMatches },
    setData,
  ] = useState(() => loadState());

  const [mode, setMode] = useState<Mode>("SMART");
  const [currentMatch, setCurrentMatch] = useState<Match | null>(
    persistedMatch ?? null
  );
  const [resolvingMatchAt, setResolvingMatchAt] = useState<number | null>(null);

  const isView = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("view") === "1";
    } catch {
      return false;
    }
  }, []);

  // Toggles
  const [randomA, setRandomA] = useState(true);
  const [randomATopN, setRandomATopN] = useState(6);
  const [avoidRecent, setAvoidRecent] = useState(true);
  const [recentOppCount, setRecentOppCount] = useState(3);

  // Form
  const [nick, setNick] = useState("");
  const [role, setRole] = useState<Role>("DPS");
  const [dpsType, setDpsType] = useState<DpsType>("MELEE");
  const [weapon1, setWeapon1] = useState<Weapon>("Espada estratégica");
  const [weapon2, setWeapon2] = useState<Weapon>("Espada estratégica");
  const [level, setLevel] = useState<Level>("MEDIO");

  useEffect(() => {
    saveState(players, results, queue, currentMatch, screenMatches);
    emitSync();
  }, [players, results, queue, currentMatch, screenMatches]);

  const bc = useMemo(() => {
    try {
      return new BroadcastChannel(BC_NAME);
    } catch {
      return null;
    }
  }, []);

  // Listen updates from other tabs
  useEffect(() => {
    if (!bc) return;
    const handler = (ev: MessageEvent) => {
      if (ev?.data?.type === "SYNC") {
        const s = loadState();
        setData({
          players: s.players,
          results: s.results,
          queue: s.queue,
          currentMatch: s.currentMatch,
          screenMatches: s.screenMatches,
        });
        setCurrentMatch(s.currentMatch ?? null);
      }
    };
    bc.addEventListener("message", handler);
    return () => {
      bc.removeEventListener("message", handler);
      bc.close();
    };
  }, [bc]);

  // Fallback: storage event (works between tabs)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_KEY) return;
      const s = loadState();
      setData({
        players: s.players,
        results: s.results,
        queue: s.queue,
        currentMatch: s.currentMatch,
        screenMatches: s.screenMatches,
      });
      setCurrentMatch(s.currentMatch ?? null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function emitSync() {
    try {
      bc?.postMessage({ type: "SYNC", at: Date.now() });
    } catch {}
  }

  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    players.forEach((p) => map.set(p.id, p));
    return map;
  }, [players]);

  const resultByCreatedAt = useMemo(() => {
    const m = new Map<number, MatchResult>();
    results.forEach((r) => m.set(r.match.createdAt, r));
    return m;
  }, [results]);

  useEffect(() => {
    if (resolvingMatchAt == null) return;
    const already = results.some((r) => r.match.createdAt === resolvingMatchAt);
    if (already) setResolvingMatchAt(null);
  }, [results, resolvingMatchAt]);

  const viewMatches = useMemo(() => {
    if (!isView) return currentMatch ? [currentMatch] : [];
    return (screenMatches ?? []).slice(-4);
  }, [isView, currentMatch, screenMatches]);

  const activeCount = useMemo(
    () => players.filter((p) => p.active).length,
    [players]
  );
  const stats = useMemo(() => {
    const active = players.filter((p) => p.active);
    const tank = active.filter((p) => p.role === "TANK").length;
    const healer = active.filter((p) => p.role === "HEALER").length;
    const dps = active.filter((p) => p.role === "DPS").length;
    const melee = active.filter(
      (p) => p.role === "DPS" && p.dpsType === "MELEE"
    ).length;
    const ranged = active.filter(
      (p) => p.role === "DPS" && p.dpsType === "RANGED"
    ).length;
    return { tank, healer, dps, melee, ranged };
  }, [players]);

  

  // Ajustes automáticos de arma según rol/dpsType
  useEffect(() => {
    if (role === "DPS") {
      if (dpsType === "RANGED") {
        if (!DPS_RANGED_WEAPONS.includes(weapon1 as any))
          setWeapon1("Sombrilla");
        if (!DPS_RANGED_WEAPONS.includes(weapon2 as any))
          setWeapon2("Sombrilla");
      } else {
        if (!DPS_MELEE_WEAPONS.includes(weapon1 as any))
          setWeapon1("Espada estratégica");
        if (!DPS_MELEE_WEAPONS.includes(weapon2 as any))
          setWeapon2("Espada estratégica");
      }
    } else {
      setWeapon1("—");
      setWeapon2("—");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    if (role !== "DPS") return;
    if (dpsType === "RANGED") {
      if (!DPS_RANGED_WEAPONS.includes(weapon1 as any)) setWeapon1("Sombrilla");
      if (!DPS_RANGED_WEAPONS.includes(weapon2 as any)) setWeapon2("Sombrilla");
    } else {
      if (!DPS_MELEE_WEAPONS.includes(weapon1 as any))
        setWeapon1("Espada estratégica");
      if (!DPS_MELEE_WEAPONS.includes(weapon2 as any))
        setWeapon2("Espada estratégica");
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

    const exists = players.some(
      (p) => p.nick.trim().toLowerCase() === cleanNick.toLowerCase()
    );
    if (exists) {
      alert("Ese nick ya existe ❌");
      return;
    }

    const p: Player = {
      id: uid(),
      nick: cleanNick,
      role,
      dpsType: role === "DPS" ? dpsType : null,
      weapon1: role === "DPS" ? weapon1 : "—",
      weapon2: role === "DPS" ? weapon2 : "—",
      level,
      active: true,
      wins: 0,
      losses: 0,
      lastOpponents: [],
      lastPlayedAt: null,
    };

    setData((prev) => ({
      ...prev,
      players: [p, ...prev.players],
      queue: [...prev.queue, p.id],
    }));

    setNick("");
    setRole("DPS");
    setDpsType("MELEE");
    setWeapon1("Espada estratégica");
    setWeapon2("Espada estratégica");
    setLevel("MEDIO");
  }

  function toggleActive(id: string) {
    if (currentMatch && (currentMatch.aId === id || currentMatch.bId === id))
      setCurrentMatch(null);

    setData((prev) => ({
      ...prev,
      players: prev.players.map((p) =>
        p.id === id ? { ...p, active: !p.active } : p
      ),
    }));
  }

  function updatePlayerLevel(id: string, newLevel: Level) {
    setData((prev) => ({
      ...prev,
      players: prev.players.map((p) =>
        p.id === id ? { ...p, level: newLevel } : p
      ),
    }));
  }

  function removePlayer(id: string) {
    if (currentMatch && (currentMatch.aId === id || currentMatch.bId === id))
      setCurrentMatch(null);

    setData((prev) => ({
      ...prev,
      players: prev.players.filter((p) => p.id !== id),
      queue: prev.queue.filter((qid) => qid !== id),
    }));
  }

  function rebuildQueueFromPlayers() {
    const activeIds = players.filter((p) => p.active).map((p) => p.id);
    const inactiveIds = players.filter((p) => !p.active).map((p) => p.id);
    setData((prev) => ({ ...prev, queue: [...activeIds, ...inactiveIds] }));
  }

  function nextMatch() {
    // Players that are currently fighting (matches without a result yet)
    const resolvedCreatedAt = new Set(results.map((r) => r.match.createdAt));
    const busy = new Set<string>();

    (screenMatches ?? []).forEach((m) => {
      if (!resolvedCreatedAt.has(m.createdAt)) {
        busy.add(m.aId);
        busy.add(m.bId);
      }
    });

    // Filter the queue so in-progress players cannot be picked again
    const availableQueue = queue.filter((id) => !busy.has(id));

    const m = pickMatchFromQueue({
      queue: availableQueue,
      playersById,
      mode,
      randomA,
      randomATopN,
      avoidRecent,
      recentOppCount,
    });

    setCurrentMatch(m);

    if (m) {
      setData((prev) => ({
        ...prev,
        screenMatches: [...(prev.screenMatches ?? []), m].slice(-4),
      }));
    }
  }

  function resetMatch() {
    setCurrentMatch(null);
  }

  function applyResultForMatch(match: Match, winnerId: string, loserId: string) {
    // Prevent double clicks / repeated resolves
    if (resolvingMatchAt === match.createdAt) return;

    setResolvingMatchAt(match.createdAt);

    const res: MatchResult = {
      match,
      winnerId,
      loserId,
      finishedAt: Date.now(),
    };

    setData((prev) => {
      // If this match was already resolved (e.g., double click / multi-tab sync), do nothing
      const alreadyResolved = prev.results.some(
        (r) => r.match.createdAt === match.createdAt
      );
      if (alreadyResolved) return prev;

      const updatedPlayers = prev.players.map((p) => {
        if (p.id !== winnerId && p.id !== loserId) return p;

        const opponentId = p.id === winnerId ? loserId : winnerId;
        const newLastOpp = clampHistory([opponentId, ...p.lastOpponents], 10);

        return {
          ...p,
          wins: p.id === winnerId ? p.wins + 1 : p.wins,
          losses: p.id === loserId ? p.losses + 1 : p.losses,
          lastOpponents: newLastOpp,
          lastPlayedAt: Date.now(),
        };
      });

      const filteredQueue = prev.queue.filter(
        (id) => id !== winnerId && id !== loserId
      );
      const newQueue = [...filteredQueue, winnerId, loserId];

      // ✅ cuando ya hay ganador, se borra del stack (solo queda en historial)
      const newScreenMatches = (prev.screenMatches ?? []).filter(
        (m) => m.createdAt !== match.createdAt
      );

      return {
        ...prev,
        players: updatedPlayers,
        results: [res, ...prev.results],
        queue: newQueue,
        screenMatches: newScreenMatches,
      };
    });

    // Close current match immediately (UI responsiveness)
    if (currentMatch?.createdAt === match.createdAt) setCurrentMatch(null);
  }
  


  function exportPlayersCSV() {
    const header = [
      "nick",
      "active",
      "role",
      "dps_type",
      "weapon1",
      "weapon2",
      "level",
      "wins",
      "losses",
      "last_played_at",
    ];

    const rows = players.map((p) => {
      return [
        p.nick,
        p.active ? "1" : "0",
        p.role,
        p.role === "DPS" ? p.dpsType ?? "" : "",
        p.role === "DPS" ? p.weapon1 : "",
        p.role === "DPS" ? p.weapon2 : "",
        p.level,
        p.wins,
        p.losses,
        p.lastPlayedAt ? formatDateTime(p.lastPlayedAt) : "",
      ]
        .map(csvEscape)
        .join(",");
    });

    const csv = [header.join(","), ...rows].join("\r\n");
    const filename = `pvp_jugadores_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    downloadTextFile(filename, csv, "text/csv;charset=utf-8");
  }

  function resetAll() {
    if (!confirm("¿Reset total? Se borran jugadores, resultados y cola."))
      return;
    setCurrentMatch(null);
    setData({
      players: [],
      results: [],
      queue: [],
      currentMatch: null,
      screenMatches: [],
    });
  }

  return (
    <div className="shinigami-app">
      <header className="row">
        <div>
          <h1>
            <span className="title-icon">⚔️</span> PvP 1v1 Manager{" "}
          </h1>
          <div className="subline">
            <span>
              Activos: <b>{activeCount}</b>
            </span>
            <span>•</span>
            <span>
              Resultados: <b>{results.length}</b>
            </span>
            <Badge>🟥 DPS: {stats.dps}</Badge>
            <Badge>🟦 Tank: {stats.tank}</Badge>
            <Badge>🟩 Healer: {stats.healer}</Badge>
            <Badge>⚔️ Melee: {stats.melee}</Badge>
            <Badge>🎯 Ranged: {stats.ranged}</Badge>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            {isView ? (
              <b>🖥️ Modo pantalla</b>
            ) : (
              <a href="?view=1" target="_blank" rel="noreferrer">
                Abrir modo pantalla
              </a>
            )}
          </div>
        </div>
        {!isView ? (
          <div className="toolbar">
            <button
              className="btn reiatsu"
              onClick={exportPlayersCSV}
              disabled={players.length === 0}
            >
              Export Jugadores
            </button>
            <button className="btn danger" onClick={resetAll}>
              Reset
            </button>
          </div>
        ) : null}
      </header>

      <hr />

      {/* Controls */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        {!isView ? (
          <div className="card row">
            <div className="range-row">
              <b>Modo:</b>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
              >
                <option value="SMART">Smart (mezcla todo)</option>
                <option value="RANDOM">Random</option>
              </select>
              <button
                className="btn action"
                onClick={nextMatch}
                disabled={activeCount < 2}
              >
                🎲 Siguiente match
              </button>
              <button
                className="btn"
                onClick={resetMatch}
                disabled={!currentMatch}
              >
                Reset match
              </button>
              <button className="btn " onClick={rebuildQueueFromPlayers}>
                Rearmar cola
              </button>
            </div>
            <div className="range-row" style={{ opacity: 0.9 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={randomA}
                  onChange={() => setRandomA((v) => !v)}
                />
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
                <input
                  type="checkbox"
                  checked={avoidRecent}
                  onChange={() => setAvoidRecent((v) => !v)}
                />
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
        ) : null}

        {/* Current match */}
        <div className="card">
          <h2 className="section-title">🔥 Match actual</h2>
          {viewMatches.length === 0 ? (
            <div style={{ opacity: 0.75 }}>
              No hay match aún. Dale a <b>Siguiente match</b>.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {viewMatches.map((m, idx) => {
                const a = playersById.get(m.aId);
                const b = playersById.get(m.bId);
                if (!a || !b) return null;

                const isLatest = idx === viewMatches.length - 1;
                const r = resultByCreatedAt.get(m.createdAt);
                const winnerNick = r ? playersById.get(r.winnerId)?.nick : null;

                return (
                  <div
                    key={m.createdAt}
                    className="match-stack-item"
                    style={{ opacity: isLatest ? 1 : 0.95 }}
                  >
                    {isView && !isLatest ? (
                      <div className="small" style={{ marginBottom: 8 }}>
                        {winnerNick ? (
                          <>
                            ✅ Resultado: <b>{winnerNick}</b>
                          </>
                        ) : (
                          <>⏳ En juego...</>
                        )}
                      </div>
                    ) : null}

                    <div className="match-grid">
                      <div className="fighter">
                        <h3>{a.nick}</h3>
                        <div className="meta">
                          <div>
                            <span className={`pill role-${a.role.toLowerCase()}`}>
                              {a.role}
                            </span>
                            {a.role === "DPS" && a.dpsType ? (
                              <>
                                <span className="pill">
                                  {a.dpsType === "RANGED" ? "Distancia" : "Melee"}
                                </span>
                                <span className="pill">{a.weapon1}</span>
                                <span className="pill">{a.weapon2}</span>
                              </>
                            ) : null}
                            <span className="pill">Nivel: {a.level}</span>
                          </div>
                          Score: <b>{a.wins}-{a.losses}</b>
                        </div>
                        {((!isView && isLatest) || (isView && !r)) ? (
                          <button
                            className="btn primary"
                            style={{ marginTop: 10, width: "100%" }}
                            disabled={!!r || resolvingMatchAt === m.createdAt}
                            onClick={() => applyResultForMatch(m, a.id, b.id)}
                          >
                            🟩 Gana {a.nick}
                          </button>
                        ) : null}
                      </div>

                      <div className="vs">VS</div>

                      <div className="fighter">
                        <h3>{b.nick}</h3>
                        <div className="meta">
                          <div>
                            <span className={`pill role-${b.role.toLowerCase()}`}>
                              {b.role}
                            </span>
                            {b.role === "DPS" && b.dpsType ? (
                              <>
                                <span className="pill">
                                  {b.dpsType === "RANGED" ? "Distancia" : "Melee"}
                                </span>
                                <span className="pill">{b.weapon1}</span>
                                <span className="pill">{b.weapon2}</span>
                              </>
                            ) : null}
                            <span className="pill">Nivel: {b.level}</span>
                          </div>
                          Score: <b>{b.wins}-{b.losses}</b>
                        </div>
                        {((!isView && isLatest) || (isView && !r)) ? (
                          <button
                            className="btn primary"
                            style={{ marginTop: 10, width: "100%" }}
                            disabled={!!r || resolvingMatchAt === m.createdAt}
                            onClick={() => applyResultForMatch(m, b.id, a.id)}
                          >
                            🟩 Gana {b.nick}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <hr />

      {/* Add player */}
      {!isView ? (
        <section className="card">
          <h2 className="section-title">➕ Registrar jugador</h2>
          <div className="register-grid">
            <input
              placeholder="Nick (único)"
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => (e.key === "Enter" ? addPlayer() : null)}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="TANK">Tank</option>
              <option value="HEALER">Healer</option>
              <option value="DPS">DPS</option>
            </select>
            <select
              value={dpsType}
              onChange={(e) => setDpsType(e.target.value as DpsType)}
              disabled={role !== "DPS"}
            >
              <option value="MELEE">DPS Melee</option>
              <option value="RANGED">DPS Distancia</option>
            </select>
            <select
              value={weapon1}
              onChange={(e) => setWeapon1(e.target.value as Weapon)}
              disabled={role !== "DPS"}
            >
              {weaponOptions.map((w) => (
                <option key={`w1-${w}`} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <select
              value={weapon2}
              onChange={(e) => setWeapon2(e.target.value as Weapon)}
              disabled={role !== "DPS"}
            >
              {weaponOptions.map((w) => (
                <option key={`w2-${w}`} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as Level)}
            >
              <option value="BAJO">Bajo</option>
              <option value="MEDIO">Medio</option>
              <option value="ALTO">Alto</option>
            </select>
            <button
              className="btn primary"
              onClick={addPlayer}
              disabled={!nick.trim()}
            >
              Agregar
            </button>
          </div>
          <div className="small" style={{ marginTop: 8 }}>
            Se agrega al final de la cola. El nivel es solo informativo (no
            afecta emparejamiento).
          </div>
        </section>
      ) : null}

      <hr />

      {/* Queue */}
      {!isView ? (
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
                    className={`queue-chip ${
                      idx === 0 && p.active ? "queue-chip--next" : ""
                    }`}
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
      ) : null}

      <hr />

      {/* Players */}
      {!isView ? (
        <section className="card">
          <h2 className="section-title">👥 Jugadores</h2>
          {players.length === 0 ? (
            <div style={{ opacity: 0.75 }}>Aún no agregas jugadores.</div>
          ) : (
            <div className="table-compact" style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th>Activo</th>
                    <th>Nick</th>
                    <th>Nivel</th>
                    <th>Rol</th>
                    <th>Tipo DPS</th>
                    <th>Armas</th>
                    <th>W-L</th>
                    <th>Últimos rivales</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={p.active}
                          onChange={() => toggleActive(p.id)}
                        />
                      </td>
                      <td style={{ fontWeight: 700 }}>{p.nick}</td>
                      <td>
                        <select
                          value={p.level}
                          onChange={(e) =>
                            updatePlayerLevel(p.id, e.target.value as Level)
                          }
                        >
                          <option value="BAJO">Bajo</option>
                          <option value="MEDIO">Medio</option>
                          <option value="ALTO">Alto</option>
                        </select>
                      </td>
                      <td>{p.role}</td>
                      <td>
                        {p.role === "DPS"
                          ? p.dpsType === "RANGED"
                            ? "Distancia"
                            : "Melee"
                          : "—"}
                      </td>
                      <td className="cell-weapons">
                        {p.role === "DPS" ? `${p.weapon1} + ${p.weapon2}` : "—"}
                      </td>
                      <td>
                        {p.wins}-{p.losses}
                      </td>
                      <td className="cell-opponents" style={{ opacity: 0.85 }}>
                        {p.lastOpponents.length
                          ? p.lastOpponents
                              .slice(0, 5)
                              .map((id) => playersById.get(id)?.nick)
                              .filter(Boolean)
                              .join(", ")
                          : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn danger btn-xs"
                          title="Eliminar"
                          onClick={() => removePlayer(p.id)}
                        >
                          X
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

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
        Smart = mezcla roles/armas y evita repetición (si está activado). Cola
        rotativa: ganador al final, perdedor último.
      </footer>
    </div>
  );
}
