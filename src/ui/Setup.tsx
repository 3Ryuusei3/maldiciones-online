// Opciones de la partida: las mismas en local (antes de empezar) y en la sala online (las cambia el anfitrión).

import type { Level } from '../game/bot';
import type { RoomOpts } from '../game/room';

export const LEVELS = ['Fácil', 'Normal', 'Difícil'] as const;

/** `min`: no se puede bajar el total de la mesa por debajo de los jugadores que ya hay. `readOnly`: solo se muestran. */
export function SetupFields({ opts, set, min = 3, readOnly = false, hideLevel = false }: { opts: RoomOpts; set: (o: Partial<RoomOpts>) => void; min?: number; readOnly?: boolean; hideLevel?: boolean }) {
  return (
    <>
      <div className="field">
        Total en la mesa
        <div className="seg">
          {[3, 4, 5, 6].map((n) => <button key={n} className={opts.size === n ? 'on' : ''} disabled={readOnly || n < min} onClick={() => set({ size: n })}>{n}</button>)}
        </div>
      </div>
      {!hideLevel && <div className="field">
        Nivel de las máquinas
        <div className="seg">
          {LEVELS.map((t, i) => <button key={t} className={opts.level === i ? 'on' : ''} disabled={readOnly} onClick={() => set({ level: i as Level })}>{t}</button>)}
        </div>
      </div>}
      <label className="check" title="Se añaden al Mazo las Maldiciones que no se han repartido (más difícil)"><input type="checkbox" disabled={readOnly} checked={opts.extraCurses} onChange={(e) => set({ extraCurses: e.target.checked })} />Maldiciones extra en el Mazo</label>
      <label className="check" title="Incluye la carta Condena en el Mazo"><input type="checkbox" disabled={readOnly} checked={opts.condena} onChange={(e) => set({ condena: e.target.checked })} />Carta Condena</label>
      <label className="check" title="Escarcha, Ráfaga, Trastada y los Rituales"><input type="checkbox" disabled={readOnly} checked={opts.beta} onChange={(e) => set({ beta: e.target.checked })} />Cartas beta</label>
      <label className="check" title="Si se agota el tiempo, juega la máquina por ti"><input type="checkbox" disabled={readOnly} checked={opts.timer !== false} onChange={(e) => set({ timer: e.target.checked })} />Máximo 15 s por decisión</label>
    </>
  );
}
