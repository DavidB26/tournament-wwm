"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Fight = {
  id: string;
  occurred_at: string;
  status: "draft" | "completed" | "canceled";
  winner_team: "A" | "B" | null;
  notes: string | null;
};

type Participant = {
  fight_id: string;
  team: "A" | "B";
  player_id: string;
  role_id: string | null;
  weapon_1_id: string | null;
  weapon_2_id: string | null;
};

type Player = { id: string; nickname: string };
type Role = { id: string; name: string };
type Weapon = { id: string; name: string };

function formatRelative(dateStr: string) {
  const d = new Date(dateStr).getTime();
  const diff = Date.now() - d;
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const day = Math.floor(h / 24);
  if (day > 0) return `hace ${day} día(s)`;
  if (h > 0) return `hace ${h} hora(s)`;
  if (m > 0) return `hace ${m} min`;
  return `hace ${Math.max(0, s)} seg`;
}

function startOfDayLocalISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function FightsPage() {
  const [fights, setFights] = useState<Fight[]>([]);
  const [parts, setParts] = useState<Participant[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [weapons, setWeapons] = useState<Weapon[]>([]);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "canceled">("all");
  const [onlyToday, setOnlyToday] = useState(false);

  // UI
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p.nickname])), [players]);
  const rolesById = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);
  const weaponsById = useMemo(() => new Map(weapons.map((w) => [w.id, w.name])), [weapons]);

  const partsByFight = useMemo(() => {
    const map = new Map<string, { A?: Participant; B?: Participant }>();
    for (const p of parts) {
      if (!map.has(p.fight_id)) map.set(p.fight_id, {});
      const obj = map.get(p.fight_id)!;
      obj[p.team] = p;
    }
    return map;
  }, [parts]);

  const load = async () => {
    setLoading(true);
    setMsg(null);

    const { data: f, error: fErr } = await supabase
      .from("fights")
      .select("id,occurred_at,status,winner_team,notes")
      .order("occurred_at", { ascending: false })
      .limit(200);

    if (fErr) {
      setLoading(false);
      setMsg(fErr.message);
      return;
    }

    const fightRows = (f ?? []) as Fight[];
    setFights(fightRows);

    const ids = fightRows.map((x) => x.id);
    if (!ids.length) {
      setParts([]);
      setLoading(false);
      return;
    }

    const [{ data: fp, error: pErr }, { data: pl, error: plErr }, { data: r, error: rErr }, { data: w, error: wErr }] =
      await Promise.all([
        supabase
          .from("fight_participants")
          .select("fight_id,team,player_id,role_id,weapon_1_id,weapon_2_id")
          .in("fight_id", ids),
        supabase.from("players").select("id,nickname"),
        supabase.from("roles").select("id,name"),
        supabase.from("weapons").select("id,name"),
      ]);

    if (pErr || plErr || rErr || wErr) {
      setMsg(pErr?.message || plErr?.message || rErr?.message || wErr?.message || "Error cargando data");
    }

    setParts((fp ?? []) as Participant[]);
    setPlayers((pl ?? []) as Player[]);
    setRoles((r ?? []) as Role[]);
    setWeapons((w ?? []) as Weapon[]);

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const toggleDetails = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cancelFight = async (fight: Fight) => {
    if (!confirm("¿Marcar esta pelea como cancelada?")) return;
    setActingId(fight.id);
    setMsg(null);

    const { error } = await supabase
      .from("fights")
      .update({ status: "canceled", winner_team: null })
      .eq("id", fight.id);

    setActingId(null);

    if (error) setMsg(error.message);
    else load();
  };

  const restoreFight = async (fight: Fight) => {
    if (!confirm("¿Restaurar esta pelea a completed?")) return;
    setActingId(fight.id);
    setMsg(null);

    const { error } = await supabase
      .from("fights")
      .update({ status: "completed", winner_team: null })
      .eq("id", fight.id);

    setActingId(null);

    if (error) setMsg(error.message);
    else load();
  };

  const deleteFight = async (fight: Fight) => {
    if (!confirm("¿Eliminar esta pelea? (se borra del historial)")) return;
    setActingId(fight.id);
    setMsg(null);

    const { error } = await supabase.from("fights").delete().eq("id", fight.id);

    setActingId(null);

    if (error) setMsg(error.message);
    else load();
  };

  const setWinner = async (fight: Fight, winner: "A" | "B" | null) => {
    if (fight.status === "canceled") return;
    setActingId(fight.id);
    setMsg(null);

    const { error } = await supabase
      .from("fights")
      .update({ winner_team: winner, status: "completed" })
      .eq("id", fight.id);

    setActingId(null);

    if (error) setMsg(error.message);
    else load();
  };

  const renderSide = (label: "A" | "B", p?: Participant) => {
    if (!p) return <div className="opacity-60 text-sm">—</div>;

    const name = playersById.get(p.player_id) ?? "???";
    const role = p.role_id ? rolesById.get(p.role_id) : null;
    const w1 = p.weapon_1_id ? weaponsById.get(p.weapon_1_id) : null;
    const w2 = p.weapon_2_id ? weaponsById.get(p.weapon_2_id) : null;

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="border-white/10 rounded-full px-2 py-1 text-xs opacity-70 bg-white/5">{label}</span>
          <span className="font-semibold">{name}</span>
        </div>
        <div className="text-xs opacity-70">
          {role ? `Rol: ${role}` : "Rol: —"} · {w1 ? `Arma 1: ${w1}` : "Arma 1: —"} · {w2 ? `Arma 2: ${w2}` : "Arma 2: —"}
        </div>
      </div>
    );
  };

  const filteredFights = useMemo(() => {
    const qNorm = q.trim().toLowerCase();
    const todayISO = startOfDayLocalISO();

    return fights.filter((f) => {
      if (statusFilter !== "all" && f.status !== statusFilter) return false;
      if (onlyToday && f.occurred_at < todayISO) return false;

      if (!qNorm) return true;

      const p = partsByFight.get(f.id);
      const A = p?.A;
      const B = p?.B;
      const aName = A ? (playersById.get(A.player_id) ?? "") : "";
      const bName = B ? (playersById.get(B.player_id) ?? "") : "";

      return aName.toLowerCase().includes(qNorm) || bName.toLowerCase().includes(qNorm);
    });
  }, [fights, q, statusFilter, onlyToday, partsByFight, playersById]);

  const exportCSV = () => {
    const rows: string[][] = [
      [
        "fight_id",
        "occurred_at",
        "status",
        "winner_team",
        "playerA",
        "roleA",
        "weaponA1",
        "weaponA2",
        "playerB",
        "roleB",
        "weaponB1",
        "weaponB2",
        "notes",
      ],
    ];

    for (const f of filteredFights) {
      const p = partsByFight.get(f.id);
      const A = p?.A;
      const B = p?.B;

      const aName = A ? playersById.get(A.player_id) ?? "" : "";
      const bName = B ? playersById.get(B.player_id) ?? "" : "";

      const aRole = A?.role_id ? rolesById.get(A.role_id) ?? "" : "";
      const bRole = B?.role_id ? rolesById.get(B.role_id) ?? "" : "";

      const aW1 = A?.weapon_1_id ? weaponsById.get(A.weapon_1_id) ?? "" : "";
      const aW2 = A?.weapon_2_id ? weaponsById.get(A.weapon_2_id) ?? "" : "";

      const bW1 = B?.weapon_1_id ? weaponsById.get(B.weapon_1_id) ?? "" : "";
      const bW2 = B?.weapon_2_id ? weaponsById.get(B.weapon_2_id) ?? "" : "";

      rows.push([
        f.id,
        f.occurred_at,
        f.status,
        f.winner_team ?? "",
        aName,
        aRole,
        aW1,
        aW2,
        bName,
        bRole,
        bW1,
        bW2,
        f.notes ?? "",
      ]);
    }

    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wwm_fights_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="border-white/10 rounded-2xl p-5 bg-white/5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight">Historial</h1>
              <p className="text-sm opacity-70">Filtra, edita ganador/cancelación y exporta lo que ves.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                className="border-white/10 rounded-xl px-4 py-2 text-sm disabled:opacity-50 bg-white/5 hover:bg-white/10"
                onClick={load}
                disabled={loading}
              >
                {loading ? "Cargando..." : "Refrescar"}
              </button>
              <button
                className="border-white/10 rounded-xl px-4 py-2 text-sm disabled:opacity-50 bg-white/5 hover:bg-white/10"
                onClick={exportCSV}
                disabled={!filteredFights.length}
              >
                Export CSV
              </button>
              <a className="border-white/10 rounded-xl px-4 py-2 text-sm bg-white/5 hover:bg-white/10" href="/">
                Volver
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border-white/10 rounded-xl p-4 bg-white/5">
              <div className="text-xs opacity-60">Total peleas</div>
              <div className="text-2xl font-semibold">{fights.length}</div>
            </div>
            <div className="border-white/10 rounded-xl p-4 bg-white/5">
              <div className="text-xs opacity-60">Mostrando</div>
              <div className="text-2xl font-semibold">{filteredFights.length}</div>
            </div>
            <div className="border-white/10 rounded-xl p-4 bg-white/5">
              <div className="text-xs opacity-60">Solo hoy</div>
              <div className="text-2xl font-semibold">{onlyToday ? "Sí" : "No"}</div>
            </div>
          </div>
        </header>

        <section className="border-white/10 rounded-2xl p-5 bg-white/5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              className="border-white/10 rounded-xl p-3 bg-white/5"
              placeholder="Buscar por nick (A o B)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <select
              className="border-white/10 rounded-xl p-3 bg-white/5"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="all">Todos los estados</option>
              <option value="completed">Completed</option>
              <option value="canceled">Canceled</option>
            </select>

            <label className="border-white/10 rounded-xl p-3 bg-white/5 text-sm flex items-center gap-2 select-none">
              <input type="checkbox" checked={onlyToday} onChange={(e) => setOnlyToday(e.target.checked)} />
              Solo hoy
            </label>
          </div>

          <div className="text-xs opacity-60">Mostrando {filteredFights.length} de {fights.length}</div>
        </section>

        {msg && <div className="border-white/10 rounded-2xl p-4 text-sm bg-white/5">Error: {msg}</div>}

        <div className="space-y-4">
          {!loading && filteredFights.length === 0 && <p className="opacity-70">No hay resultados con esos filtros.</p>}

          {filteredFights.map((f) => {
            const p = partsByFight.get(f.id);
            const A = p?.A;
            const B = p?.B;

            const aName = A ? playersById.get(A.player_id) ?? "Team A" : "Team A";
            const bName = B ? playersById.get(B.player_id) ?? "Team B" : "Team B";

            const winnerName =
              f.status === "canceled"
                ? null
                : f.winner_team === "A"
                ? aName
                : f.winner_team === "B"
                ? bName
                : null;

            const isOpen = openIds.has(f.id);
            const isActing = actingId === f.id;

            return (
              <div key={f.id} className="border-white/10 rounded-2xl p-5 bg-white/5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {aName} <span className="opacity-60">vs</span> {bName}
                    </div>
                    <div className="text-xs opacity-60">{formatRelative(f.occurred_at)} · {f.status}</div>
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    <button
                      className="border-white/10 rounded-xl px-4 py-2 text-sm bg-white/5 hover:bg-white/10"
                      onClick={() => toggleDetails(f.id)}
                    >
                      {isOpen ? "Ocultar" : "Detalles"}
                    </button>

                    {f.status !== "canceled" ? (
                      <button
                        className="border-white/10 rounded-xl px-4 py-2 text-sm bg-white/5 hover:bg-white/10"
                        onClick={() => cancelFight(f)}
                        disabled={isActing}
                      >
                        Cancelar
                      </button>
                    ) : (
                      <button
                        className="border-white/10 rounded-xl px-4 py-2 text-sm bg-white/5 hover:bg-white/10"
                        onClick={() => restoreFight(f)}
                        disabled={isActing}
                      >
                        Restaurar
                      </button>
                    )}

                    <button
                      className="border-white/10 rounded-xl px-4 py-2 text-sm bg-white/5 hover:bg-white/10"
                      onClick={() => deleteFight(f)}
                      disabled={isActing}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>

                <div className="text-sm">
                  {f.status === "canceled" ? (
                    <span className="opacity-80">⚠️ Cancelada</span>
                  ) : winnerName ? (
                    <span className="opacity-80">
                      🏆 Ganó: <b>{winnerName}</b>
                    </span>
                  ) : (
                    <span className="opacity-80">Sin ganador</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="border-white/10 rounded-xl px-4 py-2 text-sm disabled:opacity-50 bg-white/5 hover:bg-white/10"
                    onClick={() => setWinner(f, "A")}
                    disabled={f.status === "canceled" || isActing}
                    title={f.status === "canceled" ? "Restaurar primero" : ""}
                  >
                    Ganó A
                  </button>
                  <button
                    className="border-white/10 rounded-xl px-4 py-2 text-sm disabled:opacity-50 bg-white/5 hover:bg-white/10"
                    onClick={() => setWinner(f, "B")}
                    disabled={f.status === "canceled" || isActing}
                    title={f.status === "canceled" ? "Restaurar primero" : ""}
                  >
                    Ganó B
                  </button>
                  <button
                    className="border-white/10 rounded-xl px-4 py-2 text-sm disabled:opacity-50 bg-white/5 hover:bg-white/10"
                    onClick={() => setWinner(f, null)}
                    disabled={f.status === "canceled" || isActing}
                    title={f.status === "canceled" ? "Restaurar primero" : ""}
                  >
                    Sin ganador
                  </button>
                </div>

                {isOpen && (
                  <div className="border-white/10 rounded-2xl p-4 bg-white/5 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                      <div>{renderSide("A", A)}</div>
                      <div className="text-center opacity-70 font-semibold">VS</div>
                      <div>{renderSide("B", B)}</div>
                    </div>

                    {f.notes && <div className="text-sm opacity-70">Notas: {f.notes}</div>}
                    {!f.notes && <div className="text-sm opacity-60">Sin notas</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}