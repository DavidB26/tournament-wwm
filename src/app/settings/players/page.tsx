"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Role = { id: string; name: string };
type Weapon = { id: string; name: string; role_hint: string | null };

type Player = {
  id: string;
  nickname: string;
  active: boolean;
  created_at: string;
  default_role_id: string | null;
  weapon_1_id: string | null;
  weapon_2_id: string | null;
};

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [weapons, setWeapons] = useState<Weapon[]>([]);
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("players")
      .select("id,nickname,active,created_at,default_role_id,weapon_1_id,weapon_2_id")
      .order("created_at", { ascending: false });

    if (error) setMsg(error.message);
    else setPlayers((data ?? []) as Player[]);
  };

  useEffect(() => {
    load();
    (async () => {
      const [{ data: r }, { data: w }] = await Promise.all([
        supabase.from("roles").select("id,name").order("name"),
        supabase.from("weapons").select("id,name,role_hint").order("name"),
      ]);
      setRoles((r ?? []) as Role[]);
      setWeapons((w ?? []) as Weapon[]);
    })();
  }, []);

  const roleNameById = useMemo(() => {
    const map = new Map<string, string>();
    roles.forEach((r) => map.set(r.id, r.name.toLowerCase()));
    return map;
  }, [roles]);

  const weaponsForRole = (role_id: string | null) => {
    if (!role_id) return weapons;
    const roleName = roleNameById.get(role_id); // dps/tank/healer
    if (!roleName) return weapons;
    return weapons.filter((w) => (w.role_hint ?? "").toLowerCase() === roleName);
  };

  const addPlayer = async () => {
    const name = nickname.trim();
    if (!name) return;

    setLoading(true);
    setMsg(null);

    const { error } = await supabase.from("players").insert({ nickname: name, active: true });

    setLoading(false);

    if (error) setMsg(error.message);
    else {
      setNickname("");
      await load();
    }
  };

  const updatePlayer = async (id: string, patch: Partial<Player>) => {
    setMsg(null);
    const { error } = await supabase.from("players").update(patch).eq("id", id);
    if (error) setMsg(error.message);
    else await load();
  };

  const toggleActive = async (p: Player) => updatePlayer(p.id, { active: !p.active });

  const removePlayer = async (p: Player) => {
    if (!confirm(`¿Eliminar a ${p.nickname}?`)) return;
    const { error } = await supabase.from("players").delete().eq("id", p.id);
    if (error) setMsg(error.message);
    else await load();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Players</h1>
        <a className="text-sm underline opacity-80" href="/">
          Volver
        </a>
      </div>

      <div className="border rounded-xl p-4 space-y-3">
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded-lg p-2"
            placeholder="Nick del jugador"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPlayer()}
          />
          <button className="border rounded-lg px-3 py-2 disabled:opacity-50" onClick={addPlayer} disabled={loading || !nickname.trim()}>
            {loading ? "Agregando..." : "Agregar"}
          </button>
        </div>

        {msg && <p className="text-sm text-red-400">{msg}</p>}
      </div>

      <div className="border rounded-xl p-4">
        <h2 className="font-semibold mb-3">Lista</h2>

        <div className="space-y-3">
          {players.map((p) => (
            <div key={p.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{p.nickname}</div>
                  <div className="text-xs opacity-60">{p.active ? "Activo" : "Inactivo"}</div>
                </div>

                <div className="flex gap-2">
                  <button className="border rounded-lg px-3 py-2" onClick={() => toggleActive(p)}>
                    {p.active ? "Desactivar" : "Activar"}
                  </button>
                  <button className="border rounded-lg px-3 py-2" onClick={() => removePlayer(p)}>
                    Eliminar
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                <select
                  className="border rounded-lg p-2 text-sm"
                  value={p.default_role_id ?? ""}
                  onChange={(e) =>
                    updatePlayer(p.id, {
                      default_role_id: e.target.value || null,
                      weapon_1_id: null,
                      weapon_2_id: null,
                    })
                  }
                >
                  <option value="">Rol (opcional)</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>

                <select
                  className="border rounded-lg p-2 text-sm"
                  value={p.weapon_1_id ?? ""}
                  onChange={(e) => updatePlayer(p.id, { weapon_1_id: e.target.value || null })}
                >
                  <option value="">Arma 1 (opcional)</option>
                  {weaponsForRole(p.default_role_id).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>

                <select
                  className="border rounded-lg p-2 text-sm"
                  value={p.weapon_2_id ?? ""}
                  onChange={(e) => updatePlayer(p.id, { weapon_2_id: e.target.value || null })}
                >
                  <option value="">Arma 2 (opcional)</option>
                  {weaponsForRole(p.default_role_id).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}

          {!players.length && <p className="text-sm opacity-70">Aún no hay jugadores.</p>}
        </div>
      </div>
    </div>
  );
}