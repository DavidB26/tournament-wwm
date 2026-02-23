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
  return `hace ${s} seg`;
}

export default function FightsPage() {
  const [fights, setFights] = useState<Fight[]>([]);
  const [parts, setParts] = useState<Participant[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [weapons, setWeapons] = useState<Weapon[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const cancelFight = async (fight: Fight) => {
    if (!confirm("¿Marcar esta pelea como cancelada?")) return;
    const { error } = await supabase
      .from("fights")
      .update({ status: "canceled", winner_team: null })
      .eq("id", fight.id);

    if (error) setMsg(error.message);
    else load();
  };

  const restoreFight = async (fight: Fight) => {
    if (!confirm("¿Restaurar esta pelea a completed?")) return;
    const { error } = await supabase.from("fights").update({ status: "completed" }).eq("id", fight.id);
    if (error) setMsg(error.message);
    else load();
  };

  const deleteFight = async (fight: Fight) => {
    if (!confirm("¿Eliminar esta pelea? (se borra del historial)")) return;
    const { error } = await supabase.from("fights").delete().eq("id", fight.id);
    if (error) setMsg(error.message);
    else load();
  };

  const exportCSV = () => {
    const rows: string[][] = [
      ["fight_id", "occurred_at", "status", "winner_team", "playerA", "roleA", "weaponA1", "weaponA2", "playerB", "roleB", "weaponB1", "weaponB2", "notes"],
    ];

    for (const f of fights) {
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
      .map((r) =>
        r
          .map((cell) => `"${String(cell).replaceAll(`"`, `""`)}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wwm_fights_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
          <span className="border rounded-md px-2 py-1 text-xs opacity-70">{label}</span>
          <span className="font-semibold">{name}</span>
        </div>
        <div className="text-xs opacity-70">
          {role ? `Rol: ${role}` : "Rol: —"} · {w1 ? `Arma 1: ${w1}` : "Arma 1: —"} · {w2 ? `Arma 2: ${w2}` : "Arma 2: —"}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Historial</h1>
          <p className="text-sm opacity-70">Últimas 200 peleas (1v1). Para cambiar rol/armas: Players.</p>
        </div>

        <div className="flex gap-2">
          <button className="border rounded-lg px-3 py-2 text-sm" onClick={exportCSV} disabled={!fights.length}>
            Export CSV
          </button>
          <a className="text-sm underline opacity-80 pt-2" href="/">
            Volver
          </a>
        </div>
      </header>

      {msg && <div className="border rounded-xl p-3 text-sm">Error: {msg}</div>}
      {loading && <div className="border rounded-xl p-3 text-sm opacity-70">Cargando...</div>}

      <div className="space-y-3">
        {!loading && fights.length === 0 && <p className="opacity-70">Aún no hay peleas registradas.</p>}

        {fights.map((f) => {
          const p = partsByFight.get(f.id);
          const A = p?.A;
          const B = p?.B;

          const winnerName =
            f.status === "canceled"
              ? null
              : f.winner_team === "A"
              ? A
                ? playersById.get(A.player_id) ?? "Team A"
                : "Team A"
              : f.winner_team === "B"
              ? B
                ? playersById.get(B.player_id) ?? "Team B"
                : "Team B"
              : null;

          return (
            <div key={f.id} className="border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm opacity-70">{formatRelative(f.occurred_at)}</div>

                <div className="flex gap-2">
                  {f.status !== "canceled" ? (
                    <button className="border rounded-lg px-3 py-2 text-sm" onClick={() => cancelFight(f)}>
                      Cancelar
                    </button>
                  ) : (
                    <button className="border rounded-lg px-3 py-2 text-sm" onClick={() => restoreFight(f)}>
                      Restaurar
                    </button>
                  )}
                  <button className="border rounded-lg px-3 py-2 text-sm" onClick={() => deleteFight(f)}>
                    Eliminar
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                <div>{renderSide("A", A)}</div>
                <div className="text-center opacity-70 font-semibold">VS</div>
                <div>{renderSide("B", B)}</div>
              </div>

              <div className="text-sm">
                {f.status === "canceled" ? (
                  <span className="opacity-80">⚠️ Cancelada</span>
                ) : winnerName ? (
                  <span className="opacity-80">🏆 Ganador: <b>{winnerName}</b></span>
                ) : (
                  <span className="opacity-80">Sin ganador</span>
                )}
              </div>

              {f.notes && <div className="text-sm opacity-70">Notas: {f.notes}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}