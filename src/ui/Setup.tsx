// Opciones de la partida: las mismas en local (antes de empezar) y en la sala online (las cambia el anfitrión).

import type { Level } from '../game/bot';
import type { RoomOpts } from '../game/room';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ATTR_NAME, CURSE_OUT, COLORS, COLOR_NAME, DECK_BASE, DECK_MAX, HAND, HAND_MAX, HAND_MIN, KINDS, cardImage, cleanCounts, deckCount, deckMin, handSize, randomCounts, type Attr, type Color, type DeckEntry } from '../game/cards';
import { AttrIcon, asset } from './shared';

/** Color de cada color de carta (botones de «Color único»). */
const TONE: Record<Color, string> = { a: '#f5bf2a', m: '#9b5fd6', v: '#3fc97f' };

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
      <MoreOptions count={[opts.extraCurses, opts.condena, opts.beta, opts.timer !== false, !!opts.mono, !!opts.counts || handSize(opts.hand) !== HAND].filter(Boolean).length} readOnly={readOnly}>
      <label className="check" title="Se añaden al Mazo las Maldiciones que no se han repartido (más difícil)"><input type="checkbox" disabled={readOnly} checked={opts.extraCurses} onChange={(e) => set({ extraCurses: e.target.checked })} />Maldiciones extra en el Mazo</label>
      <label className="check" title="Incluye la carta Condena en el Mazo"><input type="checkbox" disabled={readOnly} checked={opts.condena} onChange={(e) => set({ condena: e.target.checked })} />Carta Condena</label>
      <label className="check" title="Escarcha, Ráfaga, Trastada y los Rituales"><input type="checkbox" disabled={readOnly} checked={opts.beta} onChange={(e) => set({ beta: e.target.checked })} />Cartas beta</label>
      <label className="check" title="Si se agota el tiempo, juega la máquina por ti"><input type="checkbox" disabled={readOnly} checked={opts.timer !== false} onChange={(e) => set({ timer: e.target.checked })} />Máximo 15 s por decisión</label>
      <label className="check" title="Flechas de quién lanza un efecto contra quién (se puede cambiar durante la partida)"><input type="checkbox" disabled={readOnly} checked={opts.arrows !== false} onChange={(e) => set({ arrows: e.target.checked })} />Flechas de los efectos</label>
      <CustomDeck opts={opts} set={set} readOnly={readOnly} />
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

/** Partida personalizada: color único, cartas iniciales y cuántas hay de cada carta del Mazo. */
function CustomDeck({ opts, set, readOnly }: { opts: RoomOpts; set: (o: Partial<RoomOpts>) => void; readOnly: boolean }) {
  const [edit, setEdit] = useState(false);
  const used = DECK_BASE.filter((e) => !e.beta || opts.beta);
  const total = used.reduce((t, e) => t + deckCount(e, opts.counts), 0) + (opts.condena ? 1 : 0);
  const hand = handSize(opts.hand);
  const min = deckMin(hand);
  const setCount = (e: DeckEntry, n: number) => set({ counts: cleanCounts({ ...opts.counts, [e.key]: Math.max(0, Math.min(DECK_MAX, n)) }) });
  // Por atributo, en el orden de la chuleta.
  const groups = (Object.keys(ATTR_NAME) as Attr[]).map((a) => ({ a, list: used.filter((e) => KINDS[e.kind].attr === a) })).filter((g) => g.list.length);
  const col = opts.mono ?? 'a';
  return (
    <div className="custom-deck">
      <div className="field">
        Color único
        <div className="seg mono-pick" role="radiogroup" aria-label="Color único">
          <button role="radio" aria-checked={!opts.mono} className={!opts.mono ? 'on' : ''} disabled={readOnly} onClick={() => set({ mono: null })}>No</button>
          {COLORS.map((c) => (
            <button key={c} role="radio" aria-checked={opts.mono === c} aria-label={COLOR_NAME[c]} title={COLOR_NAME[c]} className={opts.mono === c ? 'on' : ''} disabled={readOnly} style={{ '--tone': TONE[c] } as React.CSSProperties} onClick={() => set({ mono: c })}>
              <i />{COLOR_NAME[c]}
            </button>
          ))}
        </div>
        {opts.mono && <small className="opts-hint">Todas las cartas de color son {COLOR_NAME[opts.mono].toLowerCase()}s, manda siempre ese color y nunca se elige color.</small>}
      </div>
      <button type="button" className={`deck-btn ${opts.counts || hand !== HAND ? 'on' : ''}`} onClick={() => setEdit(true)}>
        Mazo y cartas iniciales
        <span className="deck-sum"><b>{total}</b> cartas · <b>{hand}</b> + Maldición</span>
      </button>
      {edit && createPortal(
        <div className="opts-modal" role="dialog" aria-label="Mazo y cartas iniciales" onClick={() => setEdit(false)}>
          <div className="opts-box deck-box" onClick={(e) => e.stopPropagation()}>
            <div className="deck-head">
              <h2>Mazo</h2>
              <div className="deck-hand">
                <span>Cartas iniciales<small>además de la Maldición</small></span>
                <span className="stepper">
                  <button type="button" disabled={readOnly || hand <= HAND_MIN} onClick={() => set({ hand: hand - 1 })} aria-label="Una carta inicial menos">−</button>
                  <b>{hand}</b>
                  <button type="button" disabled={readOnly || hand >= HAND_MAX} onClick={() => set({ hand: hand + 1 })} aria-label="Una carta inicial más">+</button>
                </span>
              </div>
            </div>
            <p className="opts-note">
              <b className={total < min ? 'warn' : ''}>{total} cartas</b>{opts.condena ? ' (con la Condena)' : ''}, sin contar las Maldiciones.
              {total < min && ` Con menos de ${min}, se completa con Gemas I.`}
              {!used.some((e) => CURSE_OUT.includes(e.kind) && deckCount(e, opts.counts) > 0) && ' Sin cartas para deshacerse de la Maldición, entran 3 Antitodos.'}
              {readOnly && ' Solo el anfitrión puede cambiarlas.'}
            </p>
            <div className="deck-groups">
              {groups.map((g) => (
                <section key={g.a} className="deck-group">
                  <h3><AttrIcon attr={g.a} size={18} />{ATTR_NAME[g.a]}</h3>
                  <ul className="deck-list">
                    {g.list.map((e) => {
                      const n = deckCount(e, opts.counts);
                      const img = cardImage(e.kind === 'cristalizar' ? { id: '', kind: e.kind, color: null, tone: col } : { id: '', kind: e.kind, color: e.colored ? col : null });
                      const name = `${KINDS[e.kind].name}${e.key === 'travesuraN' ? ' incolora' : ''}`;
                      return (
                        <li key={e.key} className={`${n !== e.count ? 'changed' : ''} ${n === 0 ? 'none' : ''}`}>
                          <img src={asset(img)} alt="" loading="lazy" />
                          <span className="dk-name">
                            {name}
                            <small>{e.colored ? (opts.mono ? COLOR_NAME[opts.mono] : 'De color') : 'Incolora'}{n !== e.count ? ` · normal: ${e.count}` : ''}</small>
                          </span>
                          <span className="stepper">
                            <button type="button" disabled={readOnly || n <= 0} onClick={() => setCount(e, n - 1)} aria-label={`Quitar: ${name}`}>−</button>
                            <b>{n}</b>
                            <button type="button" disabled={readOnly || n >= DECK_MAX} onClick={() => setCount(e, n + 1)} aria-label={`Añadir: ${name}`}>+</button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
            <div className="deck-btns">
              {!readOnly && <button type="button" className="opts-cancel" onClick={() => set({ counts: cleanCounts(randomCounts()) })}>Aleatorio</button>}
              {!readOnly && <button type="button" className="opts-cancel" disabled={!opts.counts && hand === HAND} onClick={() => set({ counts: null, hand: HAND })}>Mazo normal</button>}
              <button type="button" className="play" onClick={() => setEdit(false)}>Hecho</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
