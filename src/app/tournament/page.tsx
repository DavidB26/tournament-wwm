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

type BracketMatch = {
  id: string; // local id
  round: number;
  a: string; // player_id
  b: string; // player_id (puede ser "" si BYE)
  winner: "" | "A" | "B";
  canceled: boolean;
};

const shuffle = <T,>(arr: T[]) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export default function TournamentPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bracket, setBracket] = useState<BracketMatch[]>([]);
  const [round, setRound] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [allowBye, setAllowBye] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("players")
        .select("id,nickname,active,default_role_id,weapon_1_id,weapon_2_id")
        .eq("active", true)
        .order("nickname");

      if (error) setMsg(error.message);
      setPlayers((data ?? []) as Player[]);
    })();
  }, []);

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const generateRound1 = () => {
    setMsg(null);
    const ids = Array.from(selected);
    if (ids.length < 2) return setMsg("Selecciona mínimo 2 players.");

    const pool = shuffle(ids);
    const matches: BracketMatch[] = [];
    let idx = 0;

    while (pool.length >= 2) {
      const a = pool.pop()!;
      const b = pool.pop()!;
      matches.push({ id: `r1-${idx++}`, round: 1, a, b, winner: "", canceled: false });
    }

    if (pool.length === 1) {
      const a = pool.pop()!;
      if (allowBye) {
        // BYE: gana A automáticamente
        matches.push({ id: `r1-${idx++}`, round: 1, a, b: "", winner: "A", canceled: false });
      } else {
        setMsg("Cantidad impar: activa BYE o selecciona un player más.");
        return;
      }
    }

    setRound(1);
    setBracket(matches);
  };

  const winnersOfRound = (r: number) => {
    return bracket
      .filter((m) => m.round === r)
      .map((m) => {
        if (m.canceled) return null;
        if (m.winner === "A") return m.a;
        if (m.winner === "B") return m.b;
        return null;
      })
      .filter(Boolean) as string[];
  };

  const canAdvance = () => {
    const current = bracket.filter((m) => m.round === round);
    if (!current.length) return false;
    // todos deben tener winner o estar cancelados
    return current.every((m) => m.canceled || m.winner);
  };

  const buildNextRound = () => {
    setMsg(null);
    if (!canAdvance()) return setMsg("Completa todos los resultados de la ronda actual.");

    const winners = shuffle(winnersOfRound(round));
    if (winners.length <= 1) {
      setMsg("Torneo terminado ✅");
      return;
    }

    const nextRound = round + 1;
    const next: BracketMatch[] = [];
    let idx = 0;

    while (winners.length >= 2) {
      const a = winners.pop()!;
      const b = winners.pop()!;
      next.push({ id: `r${nextRound}-${idx++}`, round: nextRound, a, b, winner: "", canceled: false });
    }

    if (winners.length === 1) {
      const a = winners.pop()!;
      if (allowBye) next.push({ id: `r${nextRound}-${idx++}`, round: nextRound, a, b: "", winner: "A", canceled: false });
      else return setMsg("Impar en siguiente ronda: activa BYE.");
    }

    setRound(nextRound);
    setBracket((prev) => [...prev, ...next]);
  };

  const saveFightToDB = async (m: BracketMatch) => {
    // BYE no se guarda como fight (opcional). Si quieres, lo guardamos como fight con B vacío.
    if (!m.a || !m.b) return;

    // Si cancelada, winner_team null
    const winner_team = m.canceled ? null : m.winner || null;
    const status = m.canceled ? "canceled" : "completed";

    const { data: fight, error: fErr } = await supabase
      .from("fights")
      .insert({ status, winner_team, notes: `Tournament R${m.round}` })
      .select("id")
      .single();

    if (fErr || !fight) throw new Error(fErr?.message ?? "Error creando fight");

    const aP = playerById.get(m.a);
    const bP = playerById.get(m.b);

    const participants = [
      {
        fight_id: fight.id,
        player_id: m.a,
        team: "A",
        role_id: aP?.default_role_id ?? null,
        weapon_1_id: aP?.weapon_1_id ?? null,
        weapon_2_id: aP?.weapon_2_id ?? null,
        absent: false,
      },
      {
        fight_id: fight.id,
        player_id: m.b,
        team: "B",
        role_id: bP?.default_role_id ?? null,
        weapon_1_id: bP?.weapon_1_id ?? null,
        weapon_2_id: bP?.weapon_2_id ?? null,
        absent: false,
      },
    ];

    const { error: pErr } = await supabase.from("fight_participants").insert(participants);
    if (pErr) throw new Error(pErr.message);
  };

  const setResult = async (matchId: string, winner: "" | "A" | "B", canceled = false) => {
    setMsg(null);
    setSaving(true);
    try {
      const m = bracket.find((x) => x.id === matchId);
      if (!m) return;

      const updated = bracket.map((x) =>
        x.id === matchId ? { ...x, winner: canceled ? "" : winner, canceled } : x
      );
      setBracket(updated);

      const newMatch = updated.find((x) => x.id === matchId)!;

      // Guarda al toque si es un match normal (sin BYE)
      if (newMatch.a && newMatch.b) {
        await saveFightToDB(newMatch);
      }
    } catch (e: any) {
      setMsg(e.message ?? "Error guardando");
    } finally {
      setSaving(false);
    }
  };

  const currentRoundMatches = bracket.filter((m) => m.round === round);

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Modo Torneo (1v1)</h1>
          <p className="text-sm opacity-70">Selecciona participantes, genera emparejamientos aleatorios y avanza rondas.</p>
        </div>
        <a className="text-sm underline opacity-80" href="/">Volver</a>
      </header>

      {msg && <div className="border rounded-xl p-3 text-sm">{msg}</div>}

      <section className="border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Participantes</h2>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={allowBye} onChange={(e) => setAllowBye(e.target.checked)} />
            Permitir BYE
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {players.map((p) => (
            <label key={p.id} className="border rounded-lg p-2 text-sm flex items-center gap-2">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              {p.nickname}
            </label>
          ))}
        </div>

        <button className="border rounded-lg px-3 py-2 text-sm" onClick={generateRound1}>
          Generar torneo (aleatorio)
        </button>
      </section>

      {!!bracket.length && (
        <section className="border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Ronda {round}</h2>
            <button className="border rounded-lg px-3 py-2 text-sm disabled:opacity-50" onClick={buildNextRound} disabled={!canAdvance()}>
              Siguiente ronda
            </button>
          </div>

          <div className="space-y-3">
            {currentRoundMatches.map((m) => {
              const aName = playerById.get(m.a)?.nickname ?? "—";
              const bName = m.b ? playerById.get(m.b)?.nickname ?? "—" : "BYE";

              return (
                <div key={m.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{aName} vs {bName}</div>
                    <div className="text-xs opacity-60">R{m.round}</div>
                  </div>

                  {!m.b ? (
                    <div className="text-sm opacity-70">BYE: gana automáticamente {aName} ✅</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button className="border rounded-lg px-3 py-2 text-sm" disabled={saving} onClick={() => setResult(m.id, "A")}>
                        Ganó {aName}
                      </button>
                      <button className="border rounded-lg px-3 py-2 text-sm" disabled={saving} onClick={() => setResult(m.id, "B")}>
                        Ganó {bName}
                      </button>
                      <button className="border rounded-lg px-3 py-2 text-sm" disabled={saving} onClick={() => setResult(m.id, "", true)}>
                        Cancelada
                      </button>
                    </div>
                  )}

                  {(m.winner || m.canceled) && (
                    <div className="text-sm opacity-70">
                      {m.canceled ? "⚠️ Cancelada" : `🏆 Ganó ${m.winner === "A" ? aName : bName}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}