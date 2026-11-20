// Opciones de la partida: las mismas en local (antes de empezar) y en la sala online (las cambia el anfitrión).

import type { Level } from '../game/bot';
import type { RoomOpts } from '../game/room';
import { useState } from 'react';
import { createPortal } from 'react-dom';

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
      {/* Opciones de reglas en un modal: el botón se resalta (con cuántas hay) si alguna está activada. */}
      <MoreOptions count={[opts.extraCurses, opts.condena, opts.beta, opts.timer !== false].filter(Boolean).length} readOnly={readOnly}>
      <label className="check" title="Se añaden al Mazo las Maldiciones que no se han repartido (más difícil)"><input type="checkbox" disabled={readOnly} checked={opts.extraCurses} onChange={(e) => set({ extraCurses: e.target.checked })} />Maldiciones extra en el Mazo</label>
      <label className="check" title="Incluye la carta Condena en el Mazo"><input type="checkbox" disabled={readOnly} checked={opts.condena} onChange={(e) => set({ condena: e.target.checked })} />Carta Condena</label>
      <label className="check" title="Escarcha, Ráfaga, Trastada y los Rituales"><input type="checkbox" disabled={readOnly} checked={opts.beta} onChange={(e) => set({ beta: e.target.checked })} />Cartas beta</label>
      <label className="check" title="Si se agota el tiempo, juega la máquina por ti"><input type="checkbox" disabled={readOnly} checked={opts.timer !== false} onChange={(e) => set({ timer: e.target.checked })} />Máximo 15 s por decisión</label>
      <label className="check" title="Flechas de quién lanza un efecto contra quién (se puede cambiar durante la partida)"><input type="checkbox" disabled={readOnly} checked={opts.arrows !== false} onChange={(e) => set({ arrows: e.target.checked })} />Flechas de los efectos</label>
      </MoreOptions>
    </>
  );
}

/** Botón «Más opciones» que abre un modal con las casillas. */
function MoreOptions({ count, readOnly, children }: { count: number; readOnly: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`more-opts ${count ? 'on' : ''}`} onClick={() => setOpen(true)}>
        Más opciones{count > 0 && <b>{count}</b>}
      </button>
      {open && createPortal(
        <div className="opts-modal" role="dialog" aria-label="Más opciones" onClick={() => setOpen(false)}>
          <div className="opts-box" onClick={(e) => e.stopPropagation()}>
            <h2>Más opciones</h2>
            {readOnly && <p className="opts-note">Solo el anfitrión puede cambiarlas.</p>}
            <div className="opts-list">{children}</div>
            <button type="button" className="play" onClick={() => setOpen(false)}>Hecho</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
