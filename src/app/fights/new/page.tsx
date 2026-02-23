"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Player = {
  id: string;
  nickname: string;
  active: boolean;
  default_role_id: string | null;
  weapon_1_id: string | null;
  weapon_2_id: string | null;
};

type Role = { id: string; name: string };
type Weapon = { id: string; name: string };

type MatchRow = {
  a: string;
  b: string;
  winner: "A" | "B" | "";
  canceled: boolean;
  notes: string;
};

export default function NewFightPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [weapons, setWeapons] = useState<Weapon[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([
    { a: "", b: "", winner: "", canceled: false, notes: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [recentPairKeys, setRecentPairKeys] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: p, error: pErr }, { data: r, error: rErr }, { data: w, error: wErr }] =
        await Promise.all([
          supabase
            .from("players")
            .select("id,nickname,active,default_role_id,weapon_1_id,weapon_2_id")
            .eq("active", true)
            .order("nickname"),
          supabase.from("roles").select("id,name").order("name"),
          supabase.from("weapons").select("id,name").order("name"),
        ]);

      if (pErr || rErr || wErr) {
        setMsg(pErr?.message || rErr?.message || wErr?.message || "Error cargando data");
      }

      setPlayers((p ?? []) as Player[]);
      setRoles((r ?? []) as Role[]);
      setWeapons((w ?? []) as Weapon[]);

      // Load today's pairings to avoid repeating the same matchups in Auto
      try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);

        const { data: fightsToday, error: ftErr } = await supabase
          .from("fights")
          .select("id,status")
          .gte("occurred_at", start.toISOString())
          .neq("status", "canceled")
          .order("occurred_at", { ascending: false })
          .limit(300);

        if (ftErr) throw ftErr;

        const ids = (fightsToday ?? []).map((f: any) => f.id).filter(Boolean);
        if (!ids.length) {
          setRecentPairKeys([]);
          return;
        }

        const { data: parts, error: ptErr } = await supabase
          .from("fight_participants")
          .select("fight_id,team,player_id")
          .in("fight_id", ids);

        if (ptErr) throw ptErr;

        const byFight = new Map<string, { A?: string; B?: string }>();
        (parts ?? []).forEach((p: any) => {
          if (!byFight.has(p.fight_id)) byFight.set(p.fight_id, {});
          const obj = byFight.get(p.fight_id)!;
          if (p.team === "A") obj.A = p.player_id;
          if (p.team === "B") obj.B = p.player_id;
        });

        const keys: string[] = [];
        byFight.forEach((v) => {
          if (v.A && v.B) keys.push(pairKey(v.A, v.B));
        });

        setRecentPairKeys(Array.from(new Set(keys)));
      } catch {
        // If this fails, we just don't block repeats.
        setRecentPairKeys([]);
      }
    })();
  }, []);

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);
  const weaponById = useMemo(() => new Map(weapons.map((w) => [w.id, w.name])), [weapons]);

  const pairKey = (a: string, b: string) => {
    const x = a < b ? a : b;
    const y = a < b ? b : a;
    return `${x}__${y}`;
  };

  const recentPairsSet = useMemo(() => new Set(recentPairKeys), [recentPairKeys]);

  const usedIds = useMemo(() => {
    const s = new Set<string>();
    matches.forEach((m) => {
      if (m.a) s.add(m.a);
      if (m.b) s.add(m.b);
    });
    return s;
  }, [matches]);

  const isUsedElsewhere = (playerId: string, idx: number, side: "a" | "b") => {
    const current = matches[idx]?.[side];
    if (current === playerId) return false;
    return usedIds.has(playerId);
  };

  const shuffle = <T,>(arr: T[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // Auto-fill: completes partially filled rows and creates up to 4 matches.
  const autoFill = () => {
    setMsg(null);

    if (players.length < 2) {
      setMsg("Aún no hay suficientes players cargados para autogenerar (mínimo 2).");
      return;
    }

    setMatches((prev) => {
      // Build a pool excluding currently used ids (based on latest prev)
      const used = new Set<string>();
      prev.forEach((m) => {
        if (m.a) used.add(m.a);
        if (m.b) used.add(m.b);
      });

      const available = players.map((p) => p.id).filter((id) => !used.has(id));

      if (available.length < 2) {
        // keep previous state, but show message
        setMsg("No hay suficientes jugadores disponibles para completar las peleas.");
        return prev;
      }

      const pool = shuffle(available);

      const next = [...prev];

      // Ensure 4 rows exist
      while (next.length < 4) next.push({ a: "", b: "", winner: "", canceled: false, notes: "" });
      next.splice(4);

      // Track picks made during this auto-fill to avoid repetition
      const usedNow = new Set<string>();
      const pairsNow = new Set<string>();

      const takeOne = () => {
        while (pool.length) {
          const id = pool.pop()!;
          if (!used.has(id) && !usedNow.has(id)) {
            usedNow.add(id);
            return id;
          }
        }
        return "";
      };

      const takeOpponentAvoidingRepeat = (fixedId: string) => {
        // Try to find an opponent in pool that does not repeat an existing matchup
        for (let i = pool.length - 1; i >= 0; i--) {
          const candidate = pool[i];
          const key = pairKey(fixedId, candidate);
          if (!recentPairsSet.has(key) && !pairsNow.has(key)) {
            // remove candidate from pool
            pool.splice(i, 1);
            usedNow.add(candidate);
            pairsNow.add(key);
            return candidate;
          }
        }
        // Fallback: any opponent
        return takeOne();
      };

      for (let i = 0; i < next.length; i++) {
        const row = next[i];
        const hasA = !!row.a;
        const hasB = !!row.b;

        if (hasA && hasB) continue;

        if (hasA && !hasB) {
          const b = takeOpponentAvoidingRepeat(row.a);
          if (!b) break;
          next[i] = { ...row, b, winner: "", canceled: false };
          pairsNow.add(pairKey(next[i].a, next[i].b));
          continue;
        }

        if (!hasA && hasB) {
          const a = takeOpponentAvoidingRepeat(row.b);
          if (!a) break;
          next[i] = { ...row, a, winner: "", canceled: false };
          pairsNow.add(pairKey(next[i].a, next[i].b));
          continue;
        }

        // neither A nor B
        const a = takeOne();
        if (!a) break;
        const b = takeOpponentAvoidingRepeat(a);
        if (!b) break;
        next[i] = { ...row, a, b, winner: "", canceled: false };
        pairsNow.add(pairKey(next[i].a, next[i].b));
      }

      return next;
    });
  };

  const setMatch = (idx: number, patch: Partial<MatchRow>) =>
    setMatches((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));

  const addMatch = () =>
    setMatches((prev) => (prev.length >= 4 ? prev : [...prev, { a: "", b: "", winner: "", canceled: false, notes: "" }]));

  const removeMatch = (idx: number) => setMatches((prev) => prev.filter((_, i) => i !== idx));

  const validate = () => {
    const rows = matches.filter((m) => m.a && m.b);
    if (!rows.length) return "Agrega al menos 1 pelea (elige Player A y Player B).";
    for (const [i, m] of matches.entries()) {
      if ((m.a && !m.b) || (!m.a && m.b)) return `En la pelea #${i + 1} falta seleccionar un jugador.`;
      if (m.a && m.b && m.a === m.b) return `En la pelea #${i + 1} Player A y Player B no pueden ser el mismo.`;
      if (m.canceled && m.winner) return `En la pelea #${i + 1}, si está cancelada no debe tener ganador.`;
      if (!m.canceled && m.a && m.b && !m.winner) return `En la pelea #${i + 1} debes seleccionar un ganador (A o B) o marcarla como cancelada.`;
    }
    return null;
  };

  const PlayerSummary = ({ id }: { id: string }) => {
    const p = playerById.get(id);
    if (!p) return null;
    const role = p.default_role_id ? roleById.get(p.default_role_id) : "—";
    const w1 = p.weapon_1_id ? weaponById.get(p.weapon_1_id) : "—";
    const w2 = p.weapon_2_id ? weaponById.get(p.weapon_2_id) : "—";
    return (
      <div className="text-xs opacity-70">
        Rol: {role} · Arma 1: {w1} · Arma 2: {w2}
      </div>
    );
  };

  const saveAll = async () => {
    setMsg(null);
    const err = validate();
    if (err) return setMsg(err);

    const rows = matches.filter((m) => m.a && m.b);
    setSaving(true);

    const fightsToInsert = rows.map((m) => ({
      status: m.canceled ? "canceled" : "completed",
      notes: (m.notes || "").trim() || null,
      winner_team: m.canceled ? null : m.winner || null,
    }));

    const { data: inserted, error: fErr } = await supabase.from("fights").insert(fightsToInsert).select("id");
    if (fErr || !inserted?.length) {
      setSaving(false);
      return setMsg(fErr?.message ?? "Error creando peleas");
    }

    const participants: any[] = [];
    rows.forEach((m, idx) => {
      const fight_id = inserted[idx].id as string;
      const aPlayer = playerById.get(m.a);
      const bPlayer = playerById.get(m.b);

      participants.push({
        fight_id,
        player_id: m.a,
        team: "A",
        role_id: aPlayer?.default_role_id ?? null,
        weapon_1_id: aPlayer?.weapon_1_id ?? null,
        weapon_2_id: aPlayer?.weapon_2_id ?? null,
        absent: false,
      });

      participants.push({
        fight_id,
        player_id: m.b,
        team: "B",
        role_id: bPlayer?.default_role_id ?? null,
        weapon_1_id: bPlayer?.weapon_1_id ?? null,
        weapon_2_id: bPlayer?.weapon_2_id ?? null,
        absent: false,
      });
    });

    const { error: pErr } = await supabase.from("fight_participants").insert(participants);
    setSaving(false);
    if (pErr) return setMsg(pErr.message);

    alert("Peleas registradas ✅");
    setMatches([{ a: "", b: "", winner: "", canceled: false, notes: "" }]);
  };

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Registrar peleas (1v1)</h1>
          <p className="text-sm opacity-70">Hasta 4 peleas de una. Armas/rol salen del perfil del jugador.</p>
        </div>
        <a className="text-sm underline opacity-80" href="/">
          Volver
        </a>
      </header>

      {msg && <div className="border rounded-xl p-3 text-sm">{msg}</div>}

      <section className="border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Peleas</h2>
            <div className="text-xs opacity-60">Players cargados: {players.length}</div>
            <div className="text-xs opacity-60">Emparejamientos bloqueados hoy: {recentPairKeys.length}</div>
          </div>
          <div className="flex gap-2">
            <button
              className="border rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              type="button"
              onClick={addMatch}
              disabled={matches.length >= 4}
            >
              + Agregar pelea
            </button>
            <button
              className="border rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              type="button"
              onClick={autoFill}
              disabled={players.length < 2}
              title={players.length < 2 ? "Carga players primero" : "Autogenera peleas aleatorias"}
            >
              Auto (aleatorio)
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {matches.map((m, idx) => (
            <div key={idx} className="border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">Pelea #{idx + 1}</div>
                {matches.length > 1 && (
                  <button className="border rounded-lg px-3 py-2 text-sm" type="button" onClick={() => removeMatch(idx)}>
                    Quitar
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm opacity-80">Player A</label>
                  <select className="w-full border rounded-lg p-2" value={m.a} onChange={(e) => setMatch(idx, { a: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id} disabled={isUsedElsewhere(p.id, idx, "a")}>
                        {p.nickname}
                      </option>
                    ))}
                  </select>
                  {m.a && <PlayerSummary id={m.a} />}
                </div>

                <div className="space-y-1">
                  <label className="text-sm opacity-80">Player B</label>
                  <select className="w-full border rounded-lg p-2" value={m.b} onChange={(e) => setMatch(idx, { b: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id} disabled={isUsedElsewhere(p.id, idx, "b")}>
                        {p.nickname}
                      </option>
                    ))}
                  </select>
                  {m.b && <PlayerSummary id={m.b} />}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <label className="border rounded-lg px-3 py-2 text-sm flex items-center gap-2 select-none">
                  <input
                    type="checkbox"
                    checked={m.canceled}
                    onChange={(e) => setMatch(idx, { canceled: e.target.checked, winner: e.target.checked ? "" : m.winner })}
                  />
                  Cancelada
                </label>

                <button
                  className={`border rounded-lg px-3 py-2 text-sm ${m.winner === "A" ? "bg-white/10" : ""}`}
                  type="button"
                  onClick={() => !m.canceled && setMatch(idx, { winner: "A" })}
                  disabled={m.canceled}
                >
                  Ganó A
                </button>
                <button
                  className={`border rounded-lg px-3 py-2 text-sm ${m.winner === "B" ? "bg-white/10" : ""}`}
                  type="button"
                  onClick={() => !m.canceled && setMatch(idx, { winner: "B" })}
                  disabled={m.canceled}
                >
                  Ganó B
                </button>
                <button
                  className={`border rounded-lg px-3 py-2 text-sm ${m.winner === "" ? "bg-white/10" : ""}`}
                  type="button"
                  onClick={() => !m.canceled && setMatch(idx, { winner: "" })}
                  disabled={m.canceled}
                >
                  Sin ganador
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-sm opacity-80">Notas (opcional)</label>
                <input
                  className="w-full border rounded-lg p-2"
                  value={m.notes}
                  onChange={(e) => setMatch(idx, { notes: e.target.value })}
                  placeholder="Ej: lag, DC, cancelada, etc."
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        <button className="border rounded-lg px-3 py-2 text-sm" type="button" onClick={() => setMatches([{ a: "", b: "", winner: "", canceled: false, notes: "" }])} disabled={saving}>
          Limpiar
        </button>

        <button className="border rounded-lg px-4 py-2 text-sm disabled:opacity-50" type="button" onClick={saveAll} disabled={saving}>
          {saving ? "Guardando..." : "Guardar peleas"}
        </button>
      </div>
    </div>
  );
}