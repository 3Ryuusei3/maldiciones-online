// Opciones de la partida: las mismas en local (antes de empezar) y en la sala online (las cambia el anfitrión).

import type { Level } from '../game/bot';
import type { RoomOpts } from '../game/room';

export const LEVELS = ['Fácil', 'Normal', 'Difícil'] as const;

/** `min`: no se puede bajar el total de la mesa por debajo de los jugadores que ya hay. `readOnly`: solo se muestran. */
export function SetupFields({ opts, set, min = 3, readOnly = false }: { opts: RoomOpts; set: (o: Partial<RoomOpts>) => void; min?: number; readOnly?: boolean }) {
  return (
    <>
      <div className="field">
        Total en la mesa
        <div className="seg">
          {[3, 4, 5, 6].map((n) => <button key={n} className={opts.size === n ? 'on' : ''} disabled={readOnly || n < min} onClick={() => set({ size: n })}>{n}</button>)}
        </div>
      </div>
      <div className="field">
        Nivel de las máquinas
        <div className="seg">
          {LEVELS.map((t, i) => <button key={t} className={opts.level === i ? 'on' : ''} disabled={readOnly} onClick={() => set({ level: i as Level })}>{t}</button>)}
        </div>
      </div>
      <label className="check"><input type="checkbox" disabled={readOnly} checked={opts.extraCurses} onChange={(e) => set({ extraCurses: e.target.checked })} />Añadir las Maldiciones restantes al Mazo</label>
      <label className="check"><input type="checkbox" disabled={readOnly} checked={opts.condena} onChange={(e) => set({ condena: e.target.checked })} />Jugar con la carta Condena</label>
      <label className="check"><input type="checkbox" disabled={readOnly} checked={opts.beta} onChange={(e) => set({ beta: e.target.checked })} />Añadir las cartas beta (Escarcha, Ráfaga, Trastada y Rituales)</label>
      <label className="check"><input type="checkbox" disabled={readOnly} checked={opts.timer !== false} onChange={(e) => set({ timer: e.target.checked })} />Tiempo máximo de 15 s para decidir (si se agota, juega la máquina)</label>
    </>
  );
}
