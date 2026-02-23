"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Weapon = {
  id: string;
  name: string;
  weapon_type: string | null;
  range_type: string | null;
  role_hint: string | null;
};

export default function Home() {
  const [weapons, setWeapons] = useState<Weapon[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("weapons")
        .select("id,name,weapon_type,range_type,role_hint")
        .order("name");

      if (error) setError(error.message);
      else setWeapons(data ?? []);
    })();
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
  };

  return (
    <div className="p-6 space-y-4">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold">WWM Fight Tracker</h1>
        </div>

        <nav className="flex flex-wrap gap-2">
          <a className="border rounded-lg px-3 py-2 text-sm" href="/settings/players">
            Jugadores
          </a>
          <a className="border rounded-lg px-3 py-2 text-sm" href="/fights/new">
            Registrar pelea
          </a>
          <a className="border rounded-lg px-3 py-2 text-sm" href="/fights">
            Historial
          </a>

          <a className="border rounded-lg px-3 py-2 text-sm" href="/tournament">
            Torneo
          </a>

          <button
            className="border rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            onClick={resetDay}
            disabled={resetting}
            title="Borra participantes, peleas y sesiones"
          >
            {resetting ? "Reseteando..." : "Reset del día"}
          </button>
        </nav>
      </header>

      {error && (
        <div className="border rounded-xl p-3 text-sm">
          Error: {error}
        </div>
      )}

      <div className="border rounded-xl p-4">
        <h2 className="font-semibold mb-2">Armas (Global)</h2>
        <ul className="space-y-1 text-sm">
          {weapons.map((w) => (
            <li key={w.id} className="flex gap-2">
              <span className="font-medium">{w.name}</span>
              <span className="opacity-60">
                — {w.role_hint}/{w.range_type} ({w.weapon_type})
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}