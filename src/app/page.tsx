"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Weapon = {
  id: string;
  name: string;
  weapon_type: string | null;
  range_type: string | null;
  role_hint: string | null;
};

type Stats = {
  activePlayers: number;
  fightsToday: number;
  fightsTotal: number;
};

function startOfDayLocalISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function Home() {
  const [weapons, setWeapons] = useState<Weapon[]>([]);
  const [stats, setStats] = useState<Stats>({ activePlayers: 0, fightsToday: 0, fightsTotal: 0 });
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [loading, setLoading] = useState(false);

  const todayISO = useMemo(() => startOfDayLocalISO(), []);

  const load = async () => {
    setLoading(true);
    setError(null);

    const [{ data: w, error: wErr }, pRes, ftRes, fAllRes] = await Promise.all([
      supabase.from("weapons").select("id,name,weapon_type,range_type,role_hint").order("name"),
      supabase.from("players").select("id", { count: "exact", head: true }).eq("active", true),
      supabase
        .from("fights")
        .select("id", { count: "exact", head: true })
        .gte("occurred_at", todayISO),
      supabase.from("fights").select("id", { count: "exact", head: true }),
    ]);

    if (wErr || pRes.error || ftRes.error || fAllRes.error) {
      setError(wErr?.message || pRes.error?.message || ftRes.error?.message || fAllRes.error?.message || "Error cargando Home");
    }

    setWeapons((w ?? []) as Weapon[]);
    setStats({
      activePlayers: pRes.count ?? 0,
      fightsToday: ftRes.count ?? 0,
      fightsTotal: fAllRes.count ?? 0,
    });

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetDay = async () => {
    if (!confirm("¿Resetear todo el día? (Borra peleas/sesiones/participantes)")) return;
    setResetting(true);
    setError(null);

    const { error } = await supabase.rpc("reset_day");

    setResetting(false);

    if (error) {
      setError(error.message);
      return;
    }

    alert("Reset listo ✅");
    load();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        {/* HERO */}
        <header className="space-y-4">
          <div className="border-white/10 rounded-2xl p-5 bg-white/5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 text-xs opacity-70">
                  <span className="border-white/10 rounded-full px-2 py-1">Where Winds Meet</span>
                  <span className="border-white/10 rounded-full px-2 py-1">1v1 Tracker</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">WWM Fight Tracker</h1>
                <p className="text-sm md:text-base opacity-70">
                  Registra peleas 1v1, genera emparejamientos aleatorios y organiza mini torneos entre panas.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  className="border-white/10 rounded-xl px-4 py-2 text-sm disabled:opacity-50 bg-white/5 hover:bg-white/10"
                  onClick={load}
                  disabled={loading}
                  title="Recargar stats y armas"
                >
                  {loading ? "Cargando..." : "Refrescar"}
                </button>
                <button
                  className="border-white/10 rounded-xl px-4 py-2 text-sm disabled:opacity-50 bg-white/5 hover:bg-white/10"
                  onClick={resetDay}
                  disabled={resetting}
                  title="Borra participantes, peleas y sesiones"
                >
                  {resetting ? "Reseteando..." : "Reset"}
                </button>
              </div>
            </div>

            {/* STATS */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <div className="border-white/10 rounded-xl p-4 bg-white/5">
                <div className="text-xs opacity-60">Players activos</div>
                <div className="text-2xl font-semibold">{stats.activePlayers}</div>
              </div>
              <div className="border-white/10 rounded-xl p-4 bg-white/5">
                <div className="text-xs opacity-60">Peleas hoy</div>
                <div className="text-2xl font-semibold">{stats.fightsToday}</div>
              </div>
              <div className="border-white/10 rounded-xl p-4 bg-white/5">
                <div className="text-xs opacity-60">Total peleas</div>
                <div className="text-2xl font-semibold">{stats.fightsTotal}</div>
              </div>
            </div>
          </div>

          {/* NAV */}
          <nav className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <a className="border-white/10 rounded-2xl p-4 bg-white/5 hover:bg-white/10" href="/settings/players">
              <div className="text-sm font-semibold">Jugadores</div>
              <div className="text-xs opacity-70">Roles + 2 armas por player</div>
            </a>
            <a className="border-white/10 rounded-2xl p-4 bg-white/5 hover:bg-white/10" href="/fights/new">
              <div className="text-sm font-semibold">Registrar pelea</div>
              <div className="text-xs opacity-70">Manual o Auto (aleatorio)</div>
            </a>
            <a className="border-white/10 rounded-2xl p-4 bg-white/5 hover:bg-white/10" href="/fights">
              <div className="text-sm font-semibold">Historial</div>
              <div className="text-xs opacity-70">Filtros + export CSV</div>
            </a>
            <a className="border-white/10 rounded-2xl p-4 bg-white/5 hover:bg-white/10" href="/tournament">
              <div className="text-sm font-semibold">Torneo</div>
              <div className="text-xs opacity-70">Brackets + rondas</div>
            </a>
          </nav>
        </header>

        {error && <div className="border-white/10 rounded-xl p-3 text-sm bg-white/5">Error: {error}</div>}

        {/* WEAPONS */}
        <section className="border-white/10 rounded-2xl p-5 bg-white/5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Armas (Global)</h2>
              <p className="text-xs opacity-70">Referencia rápida — no se editan acá.</p>
            </div>
            <div className="text-xs opacity-60">Total: {weapons.length}</div>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm opacity-80">Ver listado</summary>
            <ul className="space-y-1 text-sm mt-3">
              {weapons.map((w) => (
                <li key={w.id} className="flex flex-wrap gap-2 border-white/10 rounded-xl p-3 bg-white/5">
                  <span className="font-medium">{w.name}</span>
                  <span className="opacity-60">
                    — {w.role_hint}/{w.range_type} ({w.weapon_type})
                  </span>
                </li>
              ))}
            </ul>
            {!weapons.length && <p className="text-sm opacity-70 mt-3">No hay armas cargadas.</p>}
          </details>
        </section>

        <footer className="text-xs opacity-50 pb-6">
          Tip: primero configura <b>Jugadores</b>, luego usa <b>Auto</b> para emparejar sin repetir matchups del día.
        </footer>
      </div>
    </div>
  );
}