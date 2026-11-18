import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card, Color, COLORS, COLOR_NAME, HELP, KINDS, Kind, cardImage, cardName, isCursed, isPlainGem } from '../game/cards';
import { Action, Anchor, Effect, Fx, GameState, canDup, canFreeAntitodo, canPlay, isBlind, isCursedEnv, predTargets, reactOptions, topCard } from '../game/engine';
import { Level } from '../game/bot';
import { CompTab, Compendium, HelpDock } from './Compendium';
import { GameConfig, ME, Timer, setMe, useGame } from './useGame';
import { NetClient, useNet } from '../net/client';
import type { RoomView } from '../game/room';
import { Lobby, OnlineEntry, Shell } from './Online';
import { SetupFields } from './Setup';
import type { RoomOpts } from '../game/room';
import { CardView, Icon, PCOL, asset, rich, toggleFullscreen } from './shared';

// ───────────────────────── piezas básicas ─────────────────────────

function Countdown({ timer }: { timer: Timer | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!timer) return;
    const i = window.setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(i);
  }, [timer]);
  if (!timer) return null;
  const left = Math.max(0, timer.until - Date.now());
  return (
    <div className="countdown" aria-label={`Quedan ${Math.ceil(left / 1000)} segundos`}>
      <div style={{ width: `${(left / timer.total) * 100}%` }} />
    </div>
  );
}

/** Tonos de cada gema: [luz, base, sombra, filo]. */
const GEM_TONE: Record<Color, [string, string, string, string]> = {
  a: ['#fff1b8', '#f5bf2a', '#b77d06', '#6b4300'],
  m: ['#ead6ff', '#9b5fd6', '#5d2e95', '#2e1150'],
  v: ['#d4ffe6', '#3fc97f', '#1d7f4c', '#0b3d23'],
};

/** Una gema tallada de plástico, como las de la caja original: facetas con luz, brillo y sombra. */
export function Gem({ color, size = 72 }: { color: Color; size?: number }) {
  const [hi, base, lo, edge] = GEM_TONE[color];
  const g = `gem-${color}`;
  return (
    <svg width={size * 0.72} height={size} viewBox="0 0 72 100" aria-hidden="true">
      <defs>
        <linearGradient id={`${g}-l`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={base} /><stop offset="1" stopColor={lo} /></linearGradient>
        <linearGradient id={`${g}-c`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={hi} /><stop offset="0.55" stopColor={base} /><stop offset="1" stopColor={lo} /></linearGradient>
        <linearGradient id={`${g}-r`} x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor={base} /><stop offset="1" stopColor={edge} /></linearGradient>
      </defs>
      <ellipse cx="36" cy="97" rx="20" ry="3" fill="rgba(0,0,0,0.35)" />
      {/* facetas: punta, cuerpo izquierdo, central y derecho, y punta inferior */}
      <polygon points="36,3 10,24 24,30" fill={`url(#${g}-l)`} />
      <polygon points="36,3 24,30 48,30" fill={hi} opacity="0.9" />
      <polygon points="36,3 48,30 62,24" fill={`url(#${g}-r)`} />
      <polygon points="10,24 24,30 24,70 10,76" fill={`url(#${g}-l)`} />
      <polygon points="24,30 48,30 48,70 24,70" fill={`url(#${g}-c)`} />
      <polygon points="48,30 62,24 62,76 48,70" fill={`url(#${g}-r)`} />
      <polygon points="10,76 24,70 36,94" fill={lo} />
      <polygon points="24,70 48,70 36,94" fill={base} />
      <polygon points="48,70 62,76 36,94" fill={edge} />
      <polygon points="36,3 62,24 62,76 36,94 10,76 10,24" fill="none" stroke={edge} strokeWidth="2" strokeLinejoin="round" />
      {/* brillos */}
      <polygon points="27,34 33,34 30,62 26,60" fill="#fff" opacity="0.55" />
      <circle cx="31" cy="14" r="2.4" fill="#fff" opacity="0.85" />
    </svg>
  );
}

/** Elegir color: tres gemas que se pueden pulsar. */
function GemPicker({ onPick }: { onPick: (c: Color) => void }) {
  return (
    <div className="gem-pick" role="group" aria-label="Elige el color">
      {COLORS.map((c, i) => (
        <button key={c} className={`gem-btn g-${c}`} style={{ animationDelay: `${i * 0.25}s` }} onClick={() => onPick(c)} aria-label={COLOR_NAME[c]}>
          <Gem color={c} size={68} />
          <span>{COLOR_NAME[c]}</span>
        </button>
      ))}
    </div>
  );
}

/** Duración del vuelo de una carta y de su presentación en grande sobre la Pila. */
const FLY_MS = 1060;
const SHOW_MS = 940;
const SETTLE_MS = 360;
/** Lo que tarda una mano en abrir hueco antes de que salga la carta que va a ocuparlo. */
const ROOM_MS = 300;

interface FlyOpt { flat?: boolean; src: string; A: DOMRect; B: DOMRect; sA: number; sB: number; delay?: number; ms?: number; show?: number; showDx?: number; solid?: boolean; onStart?: () => void; onLand?: () => void }

/**
 * Lanza una carta "fantasma" de A a B. El desplazamiento horizontal y el vertical llevan curvas Bézier distintas,
 * así que la carta describe un arco en vez de una recta, y se eleva (crece un poco) a mitad de camino.
 * Con `show` se queda un momento en grande al llegar, antes de posarse. Devuelve cuánto dura todo.
 */
function launch(host: HTMLElement, o: FlyOpt): number {
  const ms = o.ms ?? FLY_MS;
  const delay = o.delay ?? 0;
  const mk = (cls: string) => { const d = document.createElement('div'); d.className = cls; return d; };
  const gx = mk('gx'), gy = mk('gy'), gl = mk('gl');
  const img = document.createElement('img');
  img.src = o.src;
  img.className = 'ghost';
  gl.appendChild(img); gy.appendChild(gl); gx.appendChild(gy);
  const cx = (r: DOMRect) => r.left + r.width / 2;
  const cy = (r: DOMRect) => r.top + r.height / 2;
  const pose = (s: number, rot: number) => `translate(-50%, -50%) scale(${s}) rotate(${rot}deg)`;
  gx.style.transform = `translateX(${cx(o.A)}px)`;
  gy.style.transform = `translateY(${cy(o.A)}px)`;
  img.style.transform = pose(o.sA, o.flat ? 0 : cx(o.B) > cx(o.A) ? -14 : 14);
  img.style.opacity = o.solid ? '1' : '0';
  host.appendChild(gx);
  gx.getBoundingClientRect(); // fija la posición de salida antes de animar
  gx.style.transition = `transform ${ms}ms cubic-bezier(0.55, 0, 0.2, 1) ${delay}ms`;
  gy.style.transition = `transform ${ms}ms cubic-bezier(0.25, 0.75, 0.3, 1) ${delay}ms`;
  if (!o.flat) gl.style.animation = `lift ${ms}ms cubic-bezier(0.4, 0, 0.6, 1) ${delay}ms both`;
  img.style.transition = `transform ${ms}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, opacity 160ms linear ${delay}ms`;
  gx.style.transform = `translateX(${cx(o.B) + (o.show ? o.showDx ?? 0 : 0)}px)`;
  gy.style.transform = `translateY(${cy(o.B)}px)`;
  img.style.transform = pose(o.show ?? o.sB, 0);
  img.style.opacity = '1';
  if (o.onStart) window.setTimeout(o.onStart, delay);
  let total = delay + ms;
  if (o.show) {
    window.setTimeout(() => {
      img.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.5, 0, 0.3, 1.3)`;
      img.style.transform = pose(o.sB, 0);
      if (o.showDx) {
        gx.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.5, 0, 0.3, 1)`;
        gx.style.transform = `translateX(${cx(o.B)}px)`;
      }
    }, total + SHOW_MS);
    total += SHOW_MS + SETTLE_MS;
  }
  window.setTimeout(() => { gx.remove(); o.onLand?.(); }, total + 30);
  return total;
}

const anchorRect = (a: Anchor) => document.querySelector(`[data-anchor="${typeof a === 'number' ? `p${a}` : a}"]`)?.getBoundingClientRect();
/** Ancho del fantasma sin escalar: el de una carta de mesa, que es el de la Pila. */
const ghostW = () => anchorRect('pile')?.width || 140;
/** Escalas del fantasma (respecto al ancho de la carta de mesa) según de dónde sale o adónde llega. */
const scaleAt = (a: Anchor, r: DOMRect, w: number) => (a === 'pile' || a === 'deck' ? Math.min(r.width, w * 1.2) / w : a === ME ? 0.9 : 0.55);

const REVEAL_MS = 1500;
/** Muestra levantadas y marcadas las cartas que se van a llevar de cada jugador y después las hace volar a su destino. */
function reveal(host: HTMLElement, takes: Fx[], w: number) {
  const bySrc = new Map<number, Fx[]>();
  for (const f of takes) bySrc.set(f.from as number, [...(bySrc.get(f.from as number) ?? []), f]);
  let k = 0;
  for (const [p, fs] of bySrc) {
    const A = anchorRect(p);
    if (!A) continue;
    const row = document.createElement('div');
    row.className = `reveal-row ${p === ME ? 'mine' : ''}`;
    row.style.left = `${A.left + A.width / 2}px`;
    row.style.top = `${p === ME ? A.top : A.top + A.height / 2}px`;
    const imgs = fs.map((f) => {
      const img = document.createElement('img');
      img.src = asset(p === ME ? cardImage(f.card!) : 'cards/back.webp');
      row.appendChild(img);
      return img;
    });
    host.appendChild(row);
    window.setTimeout(() => {
      fs.forEach((f, i) => {
        const r = imgs[i].getBoundingClientRect();
        // Si el Imán es mío, las cartas van al centro de la mesa, donde aparece la bandeja para repartirlas.
        const to: Anchor = f.to === ME ? 'pile' : f.to;
        const B = anchorRect(to);
        if (B) launch(host, { src: imgs[i].src, A: r, B, sA: r.width / w, sB: to === 'pile' ? 0.8 : scaleAt(to, B, w), delay: (k++ % 8) * 120, solid: true });
      });
      row.remove();
    }, REVEAL_MS);
  }
}

/**
 * La jugada que se acaba de hacer: la carta que ha quedado arriba en la Pila y las que la acompañan
 * (la Maldición que se va con un Antitodo, la Gema que se descarta debajo de un Apoyo, la carta de un Predestinar...).
 */
export function playGroup(s: GameState): { from: Anchor; fx: Fx[]; cards: Card[] } | null {
  const top = s.pile[s.pile.length - 1];
  const star = s.fx.find((f) => f.card && f.to === 'pile' && f.card.id === top?.id && f.from !== 'pile');
  if (!star) {
    // La carta que acompaña a un Predestinar queda debajo de él: se presenta igual, junto al Predestinar.
    const below = s.pile[s.pile.length - 2];
    const comp = top?.kind === 'predestinar' && below ? s.fx.find((f) => f.card?.id === below.id && f.to === 'pile' && typeof f.from === 'number') : undefined;
    return comp ? { from: comp.from, fx: [comp], cards: [top, below] } : null;
  }
  const fx = s.fx.filter((f) => f.card && f.to === 'pile' && f.from === star.from);
  return { from: star.from, fx, cards: fx.map((f) => f.card!) };
}

/** Lo que tarda una carta en deslizarse por debajo de la Pila. */
const TUCK_MS = 700;
let tuckSeq = 0;

/**
 * Cartas que vuelan entre mano, Mazo, Pila y jugadores según los movimientos de la última acción.
 * `origins` guarda dónde estaba cada carta de mi mano justo antes de jugarla, para que salga de su sitio exacto.
 * Devuelve también las cartas que aún van por el aire hacia la Pila (se ocultan allí hasta que aterrizan).
 */
function useFlights(s: GameState, origins: React.MutableRefObject<Record<string, DOMRect>>) {
  const layer = useRef<HTMLDivElement>(null);
  const last = useRef(s.seq);
  const [flying, setFlying] = useState<string[]>([]);
  /** Ajuste del nº de cartas que se ve en cada rival: las que aún no han salido de su mano (+) y las que aún no le han llegado (−). */
  const [adj, setAdj] = useState<Record<number, number>>({});
  /** Cartas que ya son mías pero todavía vienen volando: no se pintan en la mano hasta que aterrizan. */
  const [hidden, setHidden] = useState<string[]>([]);
  /** Huecos que se abren en el abanico de cada rival para las cartas que le están llegando. */
  const [room, setRoom] = useState<Record<number, number>>({});
  /** Cartas recién robadas que se están dando la vuelta en mi mano (como en el reparto). */
  const [turning, setTurning] = useState<Record<string, 'out' | 'in'>>({});
  /** Cartas que se están metiendo por debajo de la Pila (Gemas descartadas, la Maldición de un Antitodo...). */
  const [tucks, setTucks] = useState<{ key: number; src: string; side: number }[]>([]);
  /** Égidas que vuelan a su sitio (no se pintan junto al jugador hasta que llegan). */
  const [egidaAir, setEgidaAir] = useState<string[]>([]);
  const prevEgida = useRef<(string | null)[]>(s.players.map((p) => p.egida?.id ?? null));
  const prevHand = useRef<string[]>(s.players[ME].hand.map((c) => c.id));
  useLayoutEffect(() => {
    const host = layer.current;
    if (!host || last.current === s.seq) return;
    last.current = s.seq;
    const ids = s.players[ME].hand.map((c) => c.id);
    const fresh = ids.filter((id) => !prevHand.current.includes(id));
    prevHand.current = ids;
    const w = ghostW();
    const bump = (p: number, d: number) => setAdj((a) => ({ ...a, [p]: (a[p] ?? 0) + d }));
    const gapFor = (p: number, d: number) => setRoom((a) => ({ ...a, [p]: Math.max(0, (a[p] ?? 0) + d) }));
    // La jugada se presenta en grande sobre la Pila (salvo Aplastar, que no puede esperar); si son varias cartas, una al lado de otra.
    const group = s.phase.t === 'aplastar' ? null : playGroup(s);
    const stars = group?.fx ?? [];
    const CAP = 14;
    const total = s.fx.reduce((n, f) => n + Math.min(f.n, CAP), 0);
    const gap = total > 8 ? 120 : total > 3 ? 170 : 240; // las cartas salen de una en una
    const added: string[] = [];
    const hide: string[] = [];
    let k = 0;
    // Imán: antes de volar, las cartas atraídas se levantan y se marcan sobre cada jugador (las tuyas, boca arriba).
    const takes = s.phase.t === 'iman' ? s.fx.filter((f) => f.card && typeof f.from === 'number' && typeof f.to === 'number') : [];
    if (takes.length) reveal(host, takes, w);
    for (const f of s.fx) {
      if (takes.includes(f)) continue;
      const B = anchorRect(f.to);
      const mine = f.card && f.from === ME ? origins.current[f.card.id] : undefined;
      const A = mine || anchorRect(f.from);
      if (!A || !B) continue;
      for (let i = 0; i < Math.min(f.n, CAP); i++, k++) {
        const id = f.card && f.to === 'pile' ? f.card.id : null;
        if (id) added.push(id);
        const from = typeof f.from === 'number' && f.from !== ME ? f.from : null;
        const to = typeof f.to === 'number' && f.to !== ME ? f.to : null;
        const got = f.to === ME ? fresh.shift() : undefined;
        if (from !== null) bump(from, 1);
        if (to !== null) { bump(to, -1); gapFor(to, 1); }
        if (got) hide.push(got);
        const si = stars.indexOf(f);
        const isStar = si >= 0;
        // Varias cartas a la vez (Antitodo + Maldición, Apoyo + Gema...): se ven en fila, centradas sobre la Pila.
        const dx = isStar ? (si - (stars.length - 1) / 2) * B.width * 1.32 : 0;
        const fromDeck = f.from === 'deck';
        // Va debajo de la Pila (no queda arriba): llega a un lado y se desliza por debajo de la carta superior.
        const pileIdx = f.card ? s.pile.findIndex((c) => c.id === f.card!.id) : -1;
        const under = f.to === 'pile' && (!f.card || (pileIdx >= 0 && pileIdx < s.pile.length - 1));
        const side = under ? (k % 2 ? 1 : -1) * B.width * 0.95 : 0;
        const src = asset(f.card && !(typeof f.to === 'number' && f.from !== ME) ? cardImage(f.card) : 'cards/back.webp');
        const go = (B2: DOMRect, sB: number, delay: number) =>
          launch(host, {
            // Las cartas que pasan de una mano a otra van boca abajo (salvo las mías).
            src,
            A, B: under ? new DOMRect(B2.left + side, B2.top, B2.width, B2.height) : B2,
            sA: mine ? Math.min(A.width, w * 1.4) / w : scaleAt(f.from, A, w),
            sB,
            delay,
            solid: !!mine,
            show: isStar ? (B.width * (stars.length > 1 ? 1.2 : 1.36)) / w : undefined,
            showDx: dx - side,
            onStart: from !== null ? () => bump(from, -1) : undefined,
            onLand: () => {
              if (under) {
                const key = ++tuckSeq;
                setTucks((v) => [...v, { key, src, side }]);
                window.setTimeout(() => {
                  setTucks((v) => v.filter((x) => x.key !== key));
                  if (id) setFlying((v) => v.filter((x) => x !== id));
                }, TUCK_MS);
              } else if (id) setFlying((v) => v.filter((x) => x !== id));
              if (to !== null) { bump(to, 1); gapFor(to, -1); }
              if (got) setHidden((v) => v.filter((x) => x !== got));
              if (got && fromDeck) {
                // Llega boca abajo y se da la vuelta en la mano.
                setTurning((v) => ({ ...v, [got]: 'out' }));
                window.setTimeout(() => setTurning((v) => ({ ...v, [got]: 'in' })), 340);
                window.setTimeout(() => setTurning((v) => { const n = { ...v }; delete n[got]; return n; }), 820);
              }
            },
          });
        if (got) {
          // Mi mano ya ha hecho hueco a la carta (invisible): se espera a que termine de abrirse y la carta vuela a su sitio exacto.
          window.setTimeout(() => {
            const el = document.querySelector<HTMLElement>(`[data-card="${got}"]`);
            go(el?.getBoundingClientRect() ?? B, el ? el.offsetWidth / w : scaleAt(f.to, B, w), 0);
          }, ROOM_MS + k * gap);
        } else go(B, scaleAt(f.to, B, w), k * gap + (to !== null ? ROOM_MS : 0));
      }
    }
    if (added.length) setFlying((v) => [...v, ...added]);
    if (hide.length) setHidden((v) => [...v, ...hide]);
    origins.current = {};
    // Égida recién usada: se ve en grande sobre la Pila y después vuela, pequeña, junto a su dueño.
    s.players.forEach((pl, p) => {
      const id = pl.egida?.id ?? null;
      if (id && prevEgida.current[p] !== id) {
        const A = anchorRect(p), P = anchorRect('pile');
        const src = asset('cards/egida.webp');
        if (A && P) {
          setEgidaAir((v) => [...v, id]);
          const free = () => setEgidaAir((v) => v.filter((x) => x !== id));
          launch(host, {
            src, A, B: P, sA: scaleAt(p, A, w), sB: scaleAt('pile', P, w), show: (P.width * 1.5) / w,
            onLand: () => {
              const R = document.querySelector(`[data-egida="${p}"]`)?.getBoundingClientRect();
              if (!R) return free();
              launch(host, { src, A: P, B: R, sA: scaleAt('pile', P, w), sB: R.width / w, ms: 650, solid: true, onLand: free });
            },
          });
        }
      }
      prevEgida.current[p] = id;
    });
  }, [s.seq, s.fx, s.phase.t, s.players, origins]);
  return { layer, flying, adj, hidden, room, turning, tucks, egidaAir };
}

// ───────────────────────── portada ─────────────────────────

/** Portada: elegir modo de juego (las opciones de cada partida van dentro de cada modo). */
function Home({ onLocal, onOnline }: { onLocal: () => void; onOnline: () => void }) {
  const [page, setPage] = useState<CompTab | null>(null);
  return (
    <>
      {/* Por encima de todo (el panel tiene backdrop-filter y no dejaría salir un position: fixed). */}
      {page && createPortal(<div className="home-page home-overlay"><Compendium tab={page} onClose={() => setPage(null)} /></div>, document.body)}
      <h1>Maldiciones</h1>
      <p className="tagline">El juego de cartas maldito</p>
      <div className="play-row">
        <button className="play" onClick={onLocal}>Jugar en local</button>
        <button className="play" onClick={onOnline}>Jugar online</button>
      </div>
      <div className="home-links">
        <button onClick={() => setPage('jugar')}>Compendio</button>
      </div>
    </>
  );
}

/** Partida local contra las máquinas: nombre y opciones antes de empezar. */
function LocalSetup({ onStart, onBack }: { onStart: (c: GameConfig) => void; onBack: () => void }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem('maldiciones:nombre') ?? ''; } catch { return ''; } });
  const [opts, setOpts] = useState<RoomOpts>({ size: 4, level: 1, extraCurses: false, condena: true, beta: false });
  const start = () => {
    try { localStorage.setItem('maldiciones:nombre', name.trim()); } catch { /* sin almacenamiento: no se recuerda */ }
    onStart({ name: name.trim() || 'Tú', players: opts.size, level: opts.level, extraCurses: opts.extraCurses, condena: opts.condena, beta: opts.beta });
  };
  return (
    <>
      <h1>En local</h1>
      <p className="tagline">Contra las máquinas</p>
      <label>
        Tu nombre
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tú" maxLength={14} />
      </label>
      <SetupFields opts={opts} set={(o) => setOpts((v) => ({ ...v, ...o }))} />
      <div className="play-row">
        <button className="play" onClick={start}>Empezar</button>
      </div>
      <div className="home-links">
        <button onClick={onBack}>Volver</button>
      </div>
    </>
  );
}

// ───────────────────────── textos ─────────────────────────

function effText(s: GameState, e: Effect): string {
  const n = (p: number) => (p === ME ? 'ti' : s.players[p].name);
  const N = (p: number) => (p === ME ? 'Tú' : s.players[p].name);
  switch (e.k) {
    case 'draw': return `${e.aplastar ? 'Aplastar' : 'Reflejo'}: ${e.targets[0] === ME ? 'debes' : `${N(e.targets[0])} debe`} robar ${e.amount} cartas.`;
    case 'trav': return `${e.last === 'trastada' ? 'Trastada' : 'Travesura'} contra ${n(e.targets[0])}: recibirá ${e.launchers.length} carta(s) y robará ${e.amount}.`;
    case 'cristal': return `Cristalizar ${COLOR_NAME[e.tone]} de ${N(e.source)}: los oponentes roban 3 salvo Gema ${COLOR_NAME[e.tone]}, Gema Tricolor o Égida.`;
    case 'codicia': return `Codicia de ${N(e.source)} sobre ${n(e.targets[0])}: intercambio de la mejor carta.`;
    case 'purga': return `Purga de ${N(e.source)} sobre ${n(e.targets[0])}: descarta la mano y roba las mismas.`;
    case 'iman': return `Imán de ${N(e.source)}: atrae la mejor carta y las Gemas de cada oponente.`;
    case 'rcodicia': return `Codicia reflejada por ${N(e.source)}: todos pasan su mano al siguiente jugador.`;
    case 'rpurga': return `Purga reflejada por ${N(e.source)}: todos descartan su mano y roban las mismas.`;
    case 'riman': return `Imán reflejado por ${N(e.source)}: atrae las 3 mejores cartas y las Gemas de cada jugador.`;
    case 'escarcha': return e.source === ME ? 'Tu Escarcha: congelas el tiempo y moverás las cartas de los oponentes.' : `Escarcha de ${N(e.source)}: congela el tiempo y moverá las cartas de los oponentes.`;
    case 'rescarcha': return e.source === ME ? 'Escarcha reflejada: tú moverás las cartas de los demás.' : `Escarcha reflejada: ${N(e.source)} moverá las cartas de los demás.`;
    case 'rafaga': return e.source === ME ? 'Tu Ráfaga: jugarás 5 cartas del Mazo y 1 tuya contra quien quieras.' : `Ráfaga de ${N(e.source)}: jugará 5 cartas del Mazo y 1 suya contra quien quiera.`;
    case 'gift': return `${N(e.source)} entrega ${isCursed(e.card) ? cardName(e.card) : 'una carta'} a ${n(e.targets[0])}.`;
  }
}

// ───────────────────────── partida ─────────────────────────

interface Callout { key: number; player: number; verb: string; cards: Card[]; text: string; tone: string }

/** Cómo se anuncia una jugada: quién, qué verbo, qué cartas (con sus acompañantes) y qué hacen juntas. */
function describePlay(s: GameState, from: Anchor, cards: Card[]): Callout {
  const last = s.log[s.log.length - 1]?.text ?? '';
  const viaRafaga = from === 'deck' || last.startsWith('Ráfaga:');
  const player = typeof from === 'number' ? from : s.rafaga?.player ?? s.turn;
  const you = player === ME;
  const top = cards.find((c) => c.id === s.pile[s.pile.length - 1]?.id) ?? cards[0];
  const verb = viaRafaga ? (you ? 'juegas con tu Ráfaga' : 'juega con su Ráfaga')
    : / duplica /.test(last) ? (you ? 'duplicas' : 'duplica')
    : / encadena /.test(last) ? (you ? 'encadenas' : 'encadena')
    : top.kind === 'reflejo' ? (you ? 'reflejas con' : 'refleja con')
    : top.kind === 'egida' ? (you ? 'te proteges con' : 'se protege con')
    : you ? 'juegas' : 'juega';
  const kinds = cards.map((c) => c.kind);
  const other = cards.find((c) => c.id !== top.id);
  let text = HELP[top.kind].text;
  if (kinds.includes('antitodo') && kinds.includes('maldicion')) text = 'El Antitodo elimina la Maldición: las dos cartas salen de la mano.';
  else if (kinds.includes('predestinar') && other) {
    const main = cards.find((c) => c.kind !== 'predestinar')!;
    text = `Predestina ${cardName(main)}: dirige su efecto a un jugador y le concede el turno. ${HELP[main.kind].text}`;
  } else if (other && KINDS[other.kind].attr === 'gema' && KINDS[top.kind].attr === 'apoyo') text = `${HELP[top.kind].text} Además descarta ${cardName(other)} debajo.`;
  const tone = top.kind === 'reflejo' ? 'refl' : top.color ?? (top.kind === 'cristalizar' ? 'n' : top.kind === 'antitodo' ? 'w' : KINDS[top.kind].rank >= 4 || KINDS[top.kind].attr === 'maldita' ? 'k' : 'n');
  // Primero la carta principal y luego sus acompañantes.
  return { key: s.seq, player, verb, cards: [top, ...cards.filter((c) => c.id !== top.id)], text, tone };
}

const hash = (id: string) => { let h = 7; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };

/** Dónde se sienta cada rival: borde izquierdo, arriba (con su posición horizontal) o borde derecho, en sentido horario. */
const SEATS: Record<number, [string, number][]> = {
  2: [['left', 0], ['right', 0]],
  3: [['left', 0], ['top', 50], ['right', 0]],
  4: [['left', 0], ['top', 33], ['top', 67], ['right', 0]],
  5: [['left', 0], ['top', 25], ['top', 50], ['top', 75], ['right', 0]],
};

/** Fases de la entrada: reparto boca abajo, giro de las cartas (ocultar / mostrar) y primera carta de la Pila. */
type Intro = 'deal' | 'out' | 'in' | 'pile' | null;

/** Estado de un asiento online: caído y esperándole, caído con una máquina jugando por él, o fuera de la partida. */
type SeatState = 'wait' | 'auto' | 'out' | undefined;
const STATE_TAG: Record<'wait' | 'auto' | 'out', [string, string]> = {
  wait: ['desconectado', 'Se ha caído: la partida espera a que vuelva'],
  auto: ['ausente', 'Desconectado: juega una máquina por él'],
  out: ['fuera', 'Ha quedado fuera de la partida'],
};

function Seat({ s, p, side, x, selectable, onPick, onFoul, slapped, shown, intro, say, room, reveal, state, onKick, egidaAir }: { s: GameState; p: number; side: string; x: number; selectable: boolean; onPick?: () => void; onFoul?: () => void; slapped: boolean; shown: number; intro: Intro; say: boolean; room: number; reveal: Card[]; state?: SeatState; onKick?: () => void; egidaAir: string[] }) {
  const pl = s.players[p];
  // Durante el reparto su Maldición está aparte, boca arriba, así que no cuenta en el abanico.
  const have = Math.min(shown - (intro === 'deal' || intro === 'out' ? 1 : 0), 14);
  // Las cartas que le están llegando ya tienen su hueco en el abanico, aún vacío.
  const n = Math.min(have + room, 14);
  const mid = (n - 1) / 2;
  const spread = Math.min(11, 70 / Math.max(n, 1));
  return (
    <div className={`seat ${side} ${s.turn === p && !intro ? 'turn' : ''} ${selectable ? 'selectable' : ''} ${state ? `away ${state}` : ''}`} style={side === 'top' ? { left: `${x}%` } : undefined} onClick={selectable ? onPick : undefined}>
      <div className="fanbox" data-anchor={`p${p}`}>
        {Array.from({ length: n }, (_, i) => (
          <img key={i} src={asset('cards/back.webp')} alt="" draggable={false} style={{ transform: `translateX(-50%) rotate(${(i - mid) * spread}deg)`, opacity: i < have ? 1 : 0 }} />
        ))}
      </div>
      {reveal.length > 0 && (
        <div className="seat-reveal" aria-label={`${pl.name} enseña ${reveal.length} carta(s)`}>
          {reveal.map((c) => <img key={c.id} src={asset(cardImage(c))} alt={cardName(c)} />)}
        </div>
      )}
      <div className="plate">
        <span className="pill" style={{ borderColor: PCOL[p % PCOL.length] }}>{pl.name}<i>{shown}</i></span>
        {(intro === 'deal' || intro === 'out') && <img className={`curse0 ${intro === 'out' ? 'flip-out' : ''}`} src={asset('cards/maldicion.webp')} alt="Su Maldición, boca arriba" />}
        {pl.egida && <img className={`egida ${egidaAir.includes(pl.egida.id) ? 'air' : ''}`} data-egida={p} src={asset('cards/egida.webp')} alt="Égida boca arriba" title="Égida boca arriba: le queda 1 uso" />}
        {slapped && <span className="slapped">✋</span>}
        {state && <span className={`away-tag ${state}`} title={STATE_TAG[state][1]}>{STATE_TAG[state][0]}</span>}
        {onKick && <button className="foul" title="Anfitrión: quitarle de la partida (sus cartas van al fondo de la Pila)" onClick={(e) => { e.stopPropagation(); onKick(); }}>Quitar</button>}
        {onFoul && <button className="foul" title="Anfitrión: señalar falta (roba 3)" onClick={(e) => { e.stopPropagation(); onFoul(); }}>+3</button>}
        {selectable && <span className="pickme">Elegir</span>}
        {say && s.announce?.player === p && <span key={s.announce.n} className="say">{s.announce.text}</span>}
      </div>
    </div>
  );
}

type Assign = Record<string, 'keep' | 'discard' | number>;
type Fate = 'back' | 'keep' | 'discard';
const FATE_LABEL: Record<Fate, string> = { back: 'Al Mazo', keep: 'Me la quedo', discard: 'Descartar' };

function Game({ cfg, onExit, onRematch, net }: { cfg: GameConfig; onExit: () => void; onRematch?: () => void; net?: NetClient }) {
  /** Entrada de la partida: cada jugador tiene su Maldición boca arriba y recibe 6 cartas boca abajo; luego se giran. */
  // Quien entra o vuelve a una partida online ya repartida no ve el reparto otra vez.
  const [intro, setIntro] = useState<Intro>(() => (net?.getSnap().view?.dealt ? null : 'deal'));
  const [dealt, setDealt] = useState<number[]>(() => Array(cfg.players).fill(1));
  /** El compendio abierto en mitad de la partida también la detiene. */
  const [comp, setComp] = useState(false);
  /** Pausa (y su menú, que también sirve para confirmar la salida). */
  const [pause, setPause] = useState<null | 'menu' | 'exit'>(null);
  // En local la partida la aloja este navegador; online, el servidor (aquí solo se muestra y se envían acciones).
  const local = useGame(cfg, intro === null, pause !== null || comp, !net);
  const remote = useNet(net ?? null);
  const rv = remote.view;
  const s = net && rv?.game ? rv.game : local.state;
  const dispatch = net ? (a: Action) => net.act(a) : local.dispatch;
  const timer = useMemo<Timer | null>(() => {
    if (!net) return local.timer;
    const t = rv?.timer;
    if (!t) return null;
    // La hora del servidor se pasa a la de este navegador.
    return { until: t.until - rv!.now + remote.recvAt, total: t.total };
  }, [net, local.timer, rv, remote.recvAt]);
  const isHost = !net || !!rv?.host;
  const seatState = (p: number): SeatState => (net && rv ? rv.seats[p]?.state : s.players[p].out ? 'out' : undefined);
  // Online: se avisa al servidor cuando ya se ha visto el reparto, para que empiece a correr el juego.
  useEffect(() => { if (net && intro === null) net.send({ t: 'ready' }); }, [net, intro]);
  const startedAt = useRef(Date.now());
  const origins = useRef<Record<string, DOMRect>>({});
  const send = (a: Action) => {
    // Antes de cada acción mía se anota dónde está cada carta de mi mano, para animarla desde ahí.
    document.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => (origins.current[el.dataset.card!] = el.getBoundingClientRect()));
    dispatch(a);
  };
  const [helpKind, setHelpKind] = useState<Kind | null>(null);
  const setHelp = (c: Card) => setHelpKind(c.kind);
  const root = useRef<HTMLDivElement>(null);
  const ph = s.phase;
  const me = s.players[ME];
  const blind = isBlind(s);
  const top = topCard(s);
  // Los rivales, en orden de juego a partir de mí (en local yo soy siempre el 0).
  const rivals = s.players.map((_, i) => s.players[(ME + 1 + i) % s.players.length]).slice(0, -1);
  /** Rivales a los que se puede elegir (los que están fuera de la partida, no). */
  const rivalIds = rivals.filter((p) => !p.out).map((p) => p.id);
  const name = (p: number) => s.players[p].name;
  const { layer: flights, flying, adj, hidden, room, turning, tucks, egidaAir } = useFlights(s, origins);

  // El fondo radial y los rayos nacen del centro exacto de la Pila.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const place = () => {
      const r = anchorRect('pile');
      const g = el.getBoundingClientRect();
      if (!r) return;
      el.style.setProperty('--cx', `${r.left + r.width / 2 - g.left}px`);
      el.style.setProperty('--cy', `${r.top + r.height / 2 - g.top}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [s.players.length]);

  // Reparto inicial: todos tienen ya su Maldición boca arriba; llegan 6 cartas boca abajo en sentido antihorario,
  // se giran las manos y por último se descubre la primera carta de la Pila.
  const endDeal = useRef<() => void>(() => {});
  const skipDeal = useRef(intro === null);
  useEffect(() => {
    const host = flights.current;
    if (!host || skipDeal.current) return;
    const n = s.players.length;
    const timers: number[] = [];
    let live = true;
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => live && fn(), ms));
    endDeal.current = () => { live = false; timers.forEach(clearTimeout); host.replaceChildren(); setIntro(null); };
    setIntro('deal');
    setDealt(Array(n).fill(1));
    const order = Array.from({ length: n }, (_, i) => (n - i) % n); // antihorario, empezando por mí
    const GAP = 110, MS = 640, START = 900;
    let k = 0;
    for (let round = 1; round < 7; round++)
      for (const p of order) {
        if (round >= s.players[p].hand.length) continue;
        at(START + k++ * GAP, () => {
          const slot = p === ME ? document.querySelectorAll<HTMLElement>('.cards-row .hc')[round] : null;
          const A = anchorRect('deck'), B = slot?.getBoundingClientRect() ?? anchorRect(p), w = ghostW();
          if (!A || !B) return;
          launch(host, { flat: true, src: asset('cards/back.webp'), A, B, sA: scaleAt('deck', A, w), sB: slot ? slot.offsetWidth / w : scaleAt(p, B, w), ms: MS, onLand: () => live && setDealt((d) => d.map((x, i) => (i === p ? x + 1 : x))) });
        });
      }
    const done = START + k * GAP + MS + 350;
    at(done, () => setIntro('out'));
    at(done + 340, () => setIntro('in'));
    at(done + 800, () => {
      setIntro('pile');
      const A = anchorRect('deck'), B = anchorRect('pile'), w = ghostW();
      if (A && B) launch(host, { src: asset(cardImage(s.pile[s.pile.length - 1])), A, B, sA: scaleAt('deck', A, w), sB: scaleAt('pile', B, w), ms: 900, show: (B.width * 1.36) / w });
    });
    at(done + 800 + 900 + SHOW_MS + SETTLE_MS, () => setIntro(null));
    return () => { live = false; timers.forEach(clearTimeout); host.replaceChildren(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dealing = intro !== null;
  const facedown = intro === 'deal' || intro === 'out';
  const shown = (p: number) => (facedown ? Math.min(dealt[p], s.players[p].hand.length) : Math.max(0, s.players[p].hand.length + (adj[p] ?? 0) - (p === ME ? s.players[ME].hand.filter((c) => hidden.includes(c.id)).length : 0)));
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [s.log.length, showLog]);

  // ── qué se me pide ahora
  const myTurn = ph.t === 'turn' && s.turn === ME;
  const choosing = ph.t === 'choose' && ph.player === ME ? ph : null;
  const reacting = ph.t === 'react' && ph.waiting.includes(ME) ? ph : null;
  const opts = reacting ? reactOptions(s, ME) : [];
  const slapping = ph.t === 'aplastar' && ph.players.includes(ME) && !ph.slapped.includes(ME);
  const givingTrav = ph.t === 'give' && ph.waiting.includes(ME);
  const givingCod = ph.t === 'codicia' && ph.launcher === ME && ph.waiting.includes(ME);
  const tie =
    ph.t === 'codicia' && ph.target === ME && ph.waiting.includes(ME) ? { options: ph.options, count: 1, from: ph.launcher, what: 'Codicia' }
    : ph.t === 'imanPick' && ph.waiting.includes(ME) ? { options: ph.picks[ME].options, count: ph.picks[ME].count, from: ph.source, what: 'Imán' }
    : null;
  const gemas = ph.t === 'gemas' && ph.waiting.includes(ME);
  const condena = ph.t === 'condena' && ph.player === ME ? ph : null;
  const iman = ph.t === 'iman' && ph.launcher === ME ? ph : null;
  const adivinar = ph.t === 'adivinar' && ph.player === ME ? ph : null;
  const recuperar = ph.t === 'recuperar' && ph.player === ME ? ph : null;
  const tinte = ph.t === 'tinte' && ph.player === ME;
  // Cartas que cada jugador ya ha enseñado y se echarán todas a la vez (Cristalizar, Gema Tricolor).
  const revealed: Record<number, Card[]> = {};
  const showIds = (p: number, ids: string[]) => { revealed[p] = [...(revealed[p] ?? []), ...s.players[p].hand.filter((c) => ids.includes(c.id))]; };
  if (ph.t === 'react' && ph.eff.k === 'cristal') for (const h of ph.eff.held ?? []) showIds(h.p, h.ids);
  if (ph.t === 'gemas') for (const [p, ids] of Object.entries(ph.chosen)) showIds(+p, ids);
  const myShown = (revealed[ME] ?? []).map((c) => c.id);
  const giveNeed = givingTrav && ph.t === 'give' ? ph.need[ME] : 0;
  const escarcha = ph.t === 'escarcha' && ph.player === ME ? ph : null;
  const rafaga = ph.t === 'rafaga' && s.rafaga?.player === ME ? s.rafaga : null;

  // ── selección local (se reinicia al cambiar de situación)
  const [sel, setSel] = useState<string[]>([]);
  const [reflecting, setReflecting] = useState(false);
  const [assign, setAssign] = useState<Assign>({});
  const [trayPick, setTrayPick] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [fate, setFate] = useState<Record<string, Fate>>({});
  /** Escarcha: cómo van quedando las manos de los oponentes, la carta marcada para cambiar y la que doy yo. */
  const [esc, setEsc] = useState<Record<number, string[]>>({});
  const [escPick, setEscPick] = useState<string | null>(null);
  const [escGive, setEscGive] = useState<{ cardId: string; to: number | null } | null>(null);
  const modeKey = `${ph.t}:${'win' in ph ? ph.win : ''}:${s.turn}:${ph.t === 'rafaga' ? s.seq : ''}`;
  const tone = reacting?.eff.k === 'cristal' ? reacting.eff.tone : null;
  const cristalGem = (c: Card) => (isPlainGem(c) && c.color === tone) || c.kind === 'gematri';
  useEffect(() => {
    setReflecting(false);
    setAssign({});
    setTrayPick(null);
    setFate({});
    setOrder(adivinar ? adivinar.cards.map((c) => c.id) : []);
    setEsc(escarcha ? Object.fromEntries(escarcha.targets.map((x) => [x, s.players[x].hand.map((c) => c.id)])) : {});
    setEscPick(null);
    setEscGive(null);
    if (gemas) setSel(me.hand.filter(isPlainGem).map((c) => c.id));
    else if (opts.includes('gems')) setSel(me.hand.filter((c) => isPlainGem(c) && c.color === tone).map((c) => c.id));
    else setSel([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey]);
  const toggle = (id: string, max = 99) => setSel((v) => (v.includes(id) ? v.filter((x) => x !== id) : v.length < max ? [...v, id] : v));
  const react = (a: Omit<Extract<Action, { type: 'react' }>, 'type' | 'player'>) => send({ type: 'react', player: ME, ...a });

  // Avisos grandes: qué carta se acaba de jugar y cambios de sentido.
  const names = s.players.map((p) => p.name);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [flash, setFlash] = useState<{ key: number; dir: 1 | -1 } | null>(null);
  const [muted, setMuted] = useState(-1);
  const prevDir = useRef(s.dir);
  /** Cambio de Entorno: la trifuerza crece en el centro y se dan la vuelta, uno tras otro, los Indicadores que cambian. */
  const envNow: EnvState = { mutis: s.env.mutis, inutilizar: s.env.inutilizar, tinieblas: !!s.env.tinieblas, centro: isCursedEnv(s) };
  const [envFx, setEnvFx] = useState<{ key: number; steps: EnvStep[]; before: EnvState } | null>(null);
  /** Lo que enseña la trifuerza pequeña mientras se espera (o se ve) la animación: el estado de antes. */
  const [triHold, setTriHold] = useState<EnvState | null>(null);
  const lastEnvKey = useRef(0);
  const prevEnv = useRef<EnvState>(envNow);
  const prevEgidas = useRef(s.players.map((p) => p.egida?.id ?? null));
  useEffect(() => {
    const g = playGroup(s);
    const f = g ? g.fx : null;
    if (g && !s.env.mutis) {
      setCallout(describePlay(s, g.from, g.cards));
      setMuted(s.announce?.n ?? -1); // el cartel ya lo anuncia: sobra el bocadillo
    }
    // Égida recién usada: también se anuncia en grande.
    s.players.forEach((pl, p) => {
      if (pl.egida && prevEgidas.current[p] !== pl.egida.id && !s.env.mutis) {
        setCallout({ key: s.seq, player: p, verb: p === ME ? 'te proteges con' : 'se protege con', cards: [pl.egida], text: HELP.egida.text, tone: 'n' });
        setMuted(s.announce?.n ?? -1);
      }
    });
    prevEgidas.current = s.players.map((p) => p.egida?.id ?? null);
    const before = prevEnv.current;
    prevEnv.current = envNow;
    // Primero los Indicadores de los lados y, después, el central.
    const steps = (['tinieblas', 'mutis', 'inutilizar', 'centro'] as const).filter((k) => envNow[k] !== before[k]).map((k) => ({ k, on: envNow[k] }));
    if (steps.length) {
      const key = s.seq;
      lastEnvKey.current = key;
      setTriHold((h) => h ?? before);
      window.setTimeout(() => setEnvFx({ key, steps, before }), f ? FLY_MS + SHOW_MS + SETTLE_MS : 200);
    }
    if (prevDir.current !== s.dir) {
      prevDir.current = s.dir;
      // El aviso de cambio de sentido espera a que termine la presentación de la carta (el Reflejo) para no pisarse.
      const key = s.seq, dir = s.dir;
      window.setTimeout(() => setFlash({ key, dir }), f ? FLY_MS + SHOW_MS + SETTLE_MS + 150 : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.seq]);
  useEffect(() => {
    if (!callout) return;
    const id = window.setTimeout(() => setCallout(null), 3600);
    return () => clearTimeout(id);
  }, [callout]);
  const envDone = useCallback((key: number) => {
    // Si ya hay otro cambio en camino, la trifuerza sigue esperando a esa animación.
    if (key !== lastEnvKey.current) return;
    setEnvFx(null);
    setTriHold(null);
  }, []);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(id);
  }, [flash]);
  const aplastarWin = ph.t === 'aplastar' ? ph.win : 0;
  useEffect(() => { if (aplastarWin) navigator.vibrate?.([120, 60, 120]); }, [aplastarWin]);

  // Aplastar con la barra espaciadora.
  useEffect(() => {
    if (!slapping) return;
    const h = (e: KeyboardEvent) => { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); send({ type: 'slap', player: ME }); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ── qué hace cada carta de mi mano al pulsarla
  function cardAction(c: Card): { run: () => void; label?: string; alt?: () => void } | null {
    if (dealing) return null;
    if (choosing && (choosing.need === 'card' || choosing.need === 'gem'))
      return choosing.options.includes(c.id) ? { run: () => send({ type: 'choose', player: ME, value: c.id }) } : null;
    if (givingTrav) return giveNeed > 1 ? { run: () => toggle(c.id, giveNeed) } : { run: () => send({ type: 'give', player: ME, cardId: c.id }) };
    if (givingCod) return { run: () => send({ type: 'give', player: ME, cardId: c.id }) };
    if (escarcha) return { run: () => setEscGive(escGive?.cardId === c.id ? null : { cardId: c.id, to: null }), label: escGive?.cardId === c.id ? (escGive.to === null ? 'Elige a quién' : `→ ${name(escGive.to)}`) : undefined };
    if (rafaga) return rafaga.own ? { run: () => setTrayPick(trayPick === c.id ? null : c.id), label: trayPick === c.id ? 'Elige a quién' : undefined } : null;
    if (tie) {
      if (!tie.options.includes(c.id)) return null;
      return tie.count === 1 ? { run: () => send({ type: 'pick', player: ME, ids: [c.id] }) } : { run: () => toggle(c.id, tie.count) };
    }
    if (gemas) return isPlainGem(c) ? { run: () => toggle(c.id) } : null;
    if (reacting && blind) return opts.includes('blind') ? { run: () => react({ r: 'blind', cardId: c.id }) } : null;
    if (reacting && !blind) {
      const needsTarget = reacting.eff.k === 'draw' || reacting.eff.k === 'trav';
      if (c.kind === 'egida' && opts.includes('egida') && !me.egida) return { run: () => react({ r: 'egida' }), label: 'Defender' };
      if (c.kind === 'reflejo' && opts.includes('reflejo')) return { run: () => (needsTarget ? setReflecting(true) : react({ r: 'reflejo' })), label: 'Reflejar' };
      if (c.kind === 'antitodo' && opts.includes('antitodo')) return { run: () => react({ r: 'antitodo' }), label: 'Anular' };
      if ((c.kind === 'travesura' || c.kind === 'trastada') && opts.includes('chain') && !(s.env.inutilizar && c.color)) return { run: () => react({ r: 'chain', cardId: c.id }), label: 'Encadenar' };
      if (opts.includes('gem') && cristalGem(c)) return { run: () => react({ r: 'gem', cardId: c.id }), label: 'Evitar' };
      if (opts.includes('gems') && cristalGem(c)) return { run: () => toggle(c.id) };
    }
    const dup = canDup(s, ME, c) ? () => send({ type: 'dup', player: ME, cardId: c.id }) : undefined;
    if (canPlay(s, ME, c)) return { run: () => send({ type: 'play', player: ME, cardId: c.id }), label: dup && 'Duplicar', alt: dup };
    if (dup) return { run: dup, label: 'Duplicar' };
    if (c.kind === 'antitodo' && !blind && canFreeAntitodo(s, ME)) return { run: () => send({ type: 'antitodo', player: ME }), label: 'Usar' };
    return null;
  }

  // ── qué se puede pulsar en la mesa (jugadores, Mazo, Pila)
  let pickPlayers: number[] = [];
  let onPlayer: (p: number) => void = () => {};
  let onDeck: (() => void) | null = null;
  let onPile: (() => void) | null = null;
  const count = (v: 'keep' | number) => (iman ? iman.pool.filter((c) => assign[c.id] === v).length : 0);
  if (choosing?.need === 'target') {
    pickPlayers = (choosing.options as number[]).filter((p) => p !== ME);
    onPlayer = (p) => send({ type: 'choose', player: ME, value: p });
  } else if (reacting && reflecting) {
    pickPlayers = rivalIds;
    onPlayer = (p) => react({ r: 'reflejo', target: p });
  } else if (condena) {
    pickPlayers = rivalIds;
    if (condena.absolved) onPlayer = (p) => send({ type: 'absolve', player: ME, to: p });
    else {
      onPlayer = (p) => send({ type: 'search', player: ME, where: p });
      onDeck = () => send({ type: 'search', player: ME, where: 'deck' });
      onPile = () => send({ type: 'search', player: ME, where: 'pile' });
    }
  } else if (iman && trayPick) {
    const id = trayPick;
    const put = (d: 'keep' | 'discard' | number) => { setAssign((a) => ({ ...a, [id]: d })); setTrayPick(null); };
    pickPlayers = rivalIds.filter((p) => assign[id] === p || count(p) < 3);
    onPlayer = (p) => put(p);
    onPile = () => put('discard');
  } else if (recuperar && trayPick) {
    const id = trayPick;
    pickPlayers = rivalIds;
    onPlayer = (p) => send({ type: 'recuperar', player: ME, cardId: id, to: p });
  } else if (escarcha && escGive) {
    pickPlayers = escarcha.targets;
    onPlayer = (p) => setEscGive({ ...escGive, to: p });
  } else if (rafaga && trayPick) {
    const card = [...rafaga.pool, ...me.hand].find((c) => c.id === trayPick);
    const id = trayPick;
    if (card) pickPlayers = predTargets(s, ME, card).filter((p) => p !== ME && rafaga.allowed.includes(p));
    onPlayer = (p) => send({ type: 'rafaga', player: ME, cardId: id, target: p });
  }
  if (slapping) onPile = () => send({ type: 'slap', player: ME });
  if (myTurn && !ph.drawn && !dealing) onDeck = () => send({ type: 'draw', player: ME });

  // ── mensaje y botones sobre mi mano
  let text = '';
  let alert = false;
  const btns: React.ReactNode[] = [];
  const B = (label: string, run: () => void, primary = false, disabled = false) =>
    btns.push(<button key={label} className={primary ? 'primary' : ''} disabled={disabled} onClick={run}>{label}</button>);
  if (ph.t === 'over') text = '';
  else if (dealing) {
    text = 'Cada jugador tiene su Maldición. Repartiendo 6 cartas más…';
    B('Saltar', () => endDeal.current());
  } else if (tinte) {
    alert = true;
    text = 'Has jugado la última carta incolora: elige el color con el que sigue la partida.';

  } else if (choosing) {
    const e = choosing.pp.companion ?? choosing.pp.card;
    if (choosing.need === 'target') {
      text = `${cardName(e)}: pulsa al jugador al que la diriges.`;
      if ((choosing.options as number[]).includes(ME)) B('A mí mismo', () => send({ type: 'choose', player: ME, value: ME }), true);
    } else if (choosing.need === 'card') text = 'Predestinar: elige de tu mano la carta que la acompaña.';
    else {
      text = 'Carta de Apoyo: puedes descartar una Gema de tu mano.';
      B('No descartar', () => send({ type: 'choose', player: ME, value: null }));
    }
  } else if (givingTrav && ph.t === 'give') {
    alert = true;
    const what = ph.eff.last === 'trastada' ? 'Trastada' : 'Travesura';
    text = giveNeed > 1 ? `${what}: elige ${giveNeed} cartas de tu mano para dárselas a ${name(ph.target)}.` : `${what}: elige de tu mano la carta que le das a ${name(ph.target)}.`;
    if (giveNeed > 1) B(`Dar ${sel.length}/${giveNeed}`, () => send({ type: 'give', player: ME, cardId: sel[0], ids: sel }), true, sel.length !== giveNeed);
  } else if (escarcha) {
    alert = true;
    text = escGive && escGive.to === null ? 'Pulsa al jugador al que le das esa carta.' : 'Escarcha: pulsa una carta y luego otra de otro jugador para cambiarlas de mano. Si quieres, pulsa una tuya para darla.';
    if (escGive) B('No dar carta', () => setEscGive(null));
    B('Deshacer', () => { setEsc(Object.fromEntries(escarcha.targets.map((x) => [x, s.players[x].hand.map((c) => c.id)]))); setEscPick(null); });
    B('Confirmar', () => send({ type: 'escarcha', player: ME, hands: esc, give: escGive && escGive.to !== null ? { cardId: escGive.cardId, to: escGive.to } : null }), true);
  } else if (rafaga) {
    alert = true;
    const card = trayPick ? [...rafaga.pool, ...me.hand].find((c) => c.id === trayPick) : null;
    if (card) {
      text = `${cardName(card)}: pulsa al jugador contra el que la juegas.`;
      if (predTargets(s, ME, card).includes(ME) && rafaga.allowed.includes(ME)) B('Contra mí', () => send({ type: 'rafaga', player: ME, cardId: card.id, target: ME }), true);
      B('Elegir otra', () => setTrayPick(null));
    } else text = rafaga.pool.length ? `Ráfaga: elige una carta y luego contra quién la juegas${rafaga.own ? ' (también puedes jugar 1 de tu mano)' : ''}.` : 'Ráfaga: aún puedes jugar 1 carta de tu mano.';
    if (!card) B(rafaga.pool.length ? 'Descartar las demás' : 'Terminar', () => send({ type: 'rafaga', player: ME, cardId: null }));
  } else if (givingCod && ph.t === 'codicia') {
    alert = true;
    text = `Codicia: elige de tu mano la carta que le das a ${name(ph.target)}.`;
  } else if (tie) {
    alert = true;
    text = `${tie.what} de ${name(tie.from)}: tienes varias cartas de la misma Jerarquía. Elige ${tie.count === 1 ? 'cuál entregas' : `${tie.count} para entregar`}.`;
    if (tie.count > 1) B(`Entregar ${sel.length}/${tie.count}`, () => send({ type: 'pick', player: ME, ids: sel }), true, sel.length !== tie.count);
  } else if (gemas) {
    alert = true;
    text = 'Gema Tricolor: marca en tu mano las Gemas que quieres descartar.';
    B(`Descartar ${sel.length}`, () => send({ type: 'gemas', player: ME, ids: sel }), true);
    B('Ninguna', () => send({ type: 'gemas', player: ME, ids: [] }));
  } else if (reacting) {
    alert = true;
    if (reflecting) {
      text = 'Reflejo: pulsa al jugador al que se lo devuelves.';
      B('Atrás', () => setReflecting(false));
    } else {
      const mine = reacting.eff.targets.includes(ME);
      if (blind) {
        // En Tinieblas no ves tu mano: te defiendes probando suerte con una carta boca abajo.
        text = effText(s, reacting.eff) + (opts.includes('blind') ? ' Tinieblas: prueba suerte con una carta boca abajo (si no sirve, robas 1) o acepta.' : '');
        if (opts.includes('egida')) B('Usar Égida boca arriba (último uso)', () => react({ r: 'egida' }), true);
      } else {
        text = effText(s, reacting.eff) + (opts.some((o) => o !== 'gems') ? ' Usa una carta resaltada o acepta.' : '');
        if (opts.includes('egida') && me.egida) B('Usar Égida (último uso)', () => react({ r: 'egida' }), true);
        if (opts.includes('gems')) B(`Dejar ${sel.length} Gema(s)`, () => react({ r: 'gems', ids: sel }), true);
      }
      B(opts.includes('gems') && !mine ? 'No dejar Gemas' : mine ? 'Aceptar el efecto' : 'No hacer nada', () => react({ r: 'pass' }));
    }
  } else if (condena) {
    alert = true;
    if (condena.absolved) {
      text = 'Absolución: tienes todas las Maldiciones. Descarta Condena o pulsa a un jugador para dársela.';
      B('Descartar Condena', () => send({ type: 'absolve', player: ME, to: null }), true);
    } else text = 'Condena: busca una Maldición. Pulsa el Mazo, la Pila o un jugador. Si no hay ninguna ahí, pierdes el turno.';
  } else if (iman) {
    alert = true;
    if (trayPick) {
      text = 'Pulsa a un jugador para devolvérsela, quédatela o elimínala.';
      B('Eliminar (bajo la Pila)', () => { setAssign((a) => ({ ...a, [trayPick]: 'discard' })); setTrayPick(null); });
      B('Me la quedo', () => { setAssign((a) => ({ ...a, [trayPick]: 'keep' })); setTrayPick(null); }, true, assign[trayPick] !== 'keep' && count('keep') >= 3);
    } else {
      text = 'Imán: has atraído estas cartas. Pulsa cada una para decidir su destino (hasta 3 para ti y 3 por jugador). Las que no marques van bajo la Pila.';
      B('Confirmar reparto', () => send({ type: 'iman', player: ME, assign }), true);
    }
  } else if (adivinar) {
    alert = true;
    text = 'Adivinar: estas son las 3 siguientes cartas del Mazo (la de la izquierda se roba primero). Ordénalas y decide qué haces con cada una.';
    const f = (id: string) => fate[id] ?? 'back';
    B('Confirmar', () => send({ type: 'adivinar', player: ME, keep: order.filter((id) => f(id) === 'keep'), discard: order.filter((id) => f(id) === 'discard'), back: order.filter((id) => f(id) === 'back') }), true);
  } else if (recuperar) {
    alert = true;
    if (trayPick) {
      text = 'Quédatela o pulsa a un jugador para dársela.';
      B('Me la quedo', () => send({ type: 'recuperar', player: ME, cardId: trayPick, to: ME }), true);
      B('Elegir otra', () => setTrayPick(null));
    } else text = 'Recuperar: elige una carta de la Pila.';
  } else if (slapping) {
    alert = true;
    text = '¡APLASTAR! Pulsa la Pila, Espacio o Intro antes que los demás.';
  } else if (myTurn) {
    text = ph.drawn ? 'Puedes jugar la carta robada o quedártela.' : blind ? 'Tinieblas: juega una carta a ciegas o roba 3.' : 'Tu turno: encadena una carta o roba del Mazo.';
    if (ph.drawn) B('Quedármela', () => send({ type: 'keep', player: ME }), true);
    else B(blind ? 'Robar 3' : 'Robar', () => send({ type: 'draw', player: ME }), true);
  } else if (ph.t === 'turn') text = `Turno de ${name(s.turn)}…`;
  else if (ph.t === 'react') text = effText(s, ph.eff);
  else if (ph.t === 'aplastar') text = '¡Aplastar! Todos ponen la mano en la Pila…';
  else if (ph.t === 'gemas') text = `Gema Tricolor: ${ph.waiting.map(name).join(', ')} ${ph.waiting.length > 1 ? 'eligen' : 'elige'} qué Gemas descartar. Se echan todas a la vez.`;
  else if (ph.t === 'tinte') text = `${name(ph.player)} elige color…`;
  else if (ph.t === 'give') text = `${ph.waiting.map(name).join(' y ')} ${ph.waiting.length > 1 ? 'eligen' : 'elige'} qué carta(s) da a ${name(ph.target)}…`;
  else if (ph.t === 'escarcha') text = `${name(ph.player)} congela el tiempo y mueve cartas entre las manos…`;
  else if (ph.t === 'rafaga') text = `Ráfaga de ${name(s.rafaga?.player ?? s.turn)}: está eligiendo qué cartas jugar…`;
  else text = `${name(s.turn)} está resolviendo su carta…`;

  // ── cartas apartadas que se muestran sobre mi mano (Imán, Adivinar, Recuperar)
  let tray: React.ReactNode = null;
  if (iman) {
    tray = iman.pool.map((c) => {
      const d = assign[c.id] ?? 'discard';
      return (
        <div className="slot" key={c.id}>
          <CardView card={c} className={`small ${trayPick === c.id ? 'selected' : ''}`} onClick={() => setTrayPick(trayPick === c.id ? null : c.id)} onInfo={setHelp} />
          <span className={`dest ${d === 'discard' ? '' : 'on'}`}>{d === 'keep' ? 'Para mí' : d === 'discard' ? 'Bajo la Pila' : `→ ${name(d)}`}</span>
        </div>
      );
    });
  } else if (adivinar) {
    const move = (i: number, d: number) => setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });
    tray = order.map((id, i) => {
      const c = adivinar.cards.find((x) => x.id === id);
      if (!c) return null;
      const f = fate[id] ?? 'back';
      return (
        <div className="slot" key={id}>
          <CardView card={c} className={`small ${f === 'back' ? '' : 'dim'}`} onInfo={setHelp} />
          <div className="arrows">
            <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Mover a la izquierda">◀</button>
            <button className={f === 'back' ? '' : 'on'} onClick={() => setFate((x) => ({ ...x, [id]: f === 'back' ? 'keep' : f === 'keep' ? 'discard' : 'back' }))}>{FATE_LABEL[f]}</button>
            <button onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Mover a la derecha">▶</button>
          </div>
        </div>
      );
    });
  } else if (rafaga) {
    tray = rafaga.pool.map((c) => (
      <CardView key={c.id} card={c} className={`small ${trayPick === c.id ? 'selected' : trayPick ? 'dim' : ''}`} onInfo={setHelp}
        onClick={() => setTrayPick(trayPick === c.id ? null : c.id)} />
    ));
  } else if (escarcha) {
    const swap = (id: string) => {
      if (!escPick || escPick === id) return setEscPick(escPick === id ? null : id);
      const where = (x: string) => Number(Object.keys(esc).find((k) => esc[+k].includes(x)));
      const a = where(escPick), b = where(id);
      if (a === b) return setEscPick(id);
      setEsc((h) => {
        const n = { ...h, [a]: [...h[a]], [b]: [...h[b]] };
        n[a][n[a].indexOf(escPick)] = id;
        n[b][n[b].indexOf(id)] = escPick;
        return n;
      });
      setEscPick(null);
    };
    const all = Object.fromEntries(escarcha.targets.flatMap((x) => s.players[x].hand).map((c) => [c.id, c]));
    tray = escarcha.targets.map((x) => (
      <div key={x} className="esc-row">
        <b style={{ borderColor: PCOL[x % PCOL.length] }}>{name(x)}</b>
        <div>
          {(esc[x] ?? []).map((id) => {
            const moved = !s.players[x].hand.some((c) => c.id === id);
            return <CardView key={id} card={all[id]} className={`small ${escPick === id ? 'selected' : ''} ${moved ? 'moved' : ''}`} onClick={() => swap(id)} onInfo={setHelp} />;
          })}
        </div>
      </div>
    ));
  } else if (recuperar) {
    tray = s.pile.filter((c) => recuperar.options.includes(c.id)).reverse().map((c) => (
      <CardView key={c.id} card={c} className={`small ${trayPick === c.id ? 'selected' : trayPick ? 'dim' : ''}`} onClick={() => setTrayPick(c.id)} />
    ));
  }

  /** Orden de mi mano al caer las Tinieblas: boca abajo cada carta sigue en su sitio (las nuevas, al final). */
  const blindOrder = useRef<string[] | null>(null);
  const sortedHand = useMemo(() => {
    // Durante el reparto las cartas van llegando de una en una, con la Maldición primero.
    if (facedown) return [...me.hand].sort((a, b) => Number(b.kind === 'maldicion') - Number(a.kind === 'maldicion'));
    const o = (c: Card) => (c.color ? COLORS.indexOf(c.color) : KINDS[c.kind].attr === 'maldita' ? 5 : KINDS[c.kind].attr === 'sagrada' ? 4 : 3);
    const sorted = [...me.hand].sort((a, b) => o(a) - o(b) || a.kind.localeCompare(b.kind));
    if (!blind) {
      blindOrder.current = null;
      return sorted;
    }
    // Se fija el orden visible justo antes de darse la vuelta y se mantiene mientras duren.
    const prev = blindOrder.current ?? sorted.map((c) => c.id);
    const byId = new Map(me.hand.map((c) => [c.id, c]));
    const kept = prev.filter((id) => byId.has(id));
    const order = [...kept, ...me.hand.map((c) => c.id).filter((id) => !kept.includes(id))];
    blindOrder.current = order;
    return order.map((id) => byId.get(id)!);
  }, [me.hand, blind, facedown]);
  const n = sortedHand.length;
  const step = Math.min(0.5, 4.6 / Math.max(n, 1)); // fracción del ancho de carta entre una carta y la siguiente
  const mid = (n - 1) / 2;

  const cursed = isCursedEnv(s);

  const seats = SEATS[rivals.length];
  const trayCount = iman ? iman.pool.length : recuperar ? recuperar.options.length : rafaga ? rafaga.pool.length : 0;
  return (
    <div ref={root} className={`game col-${s.color} ${cursed ? 'cursed' : ''} ${s.env.tinieblas ? 'dark' : ''} ${ph.t === 'aplastar' ? 'quake' : ''}`}>
      <div className="rays" />
      <div className="shade" />
      <div className="flights" ref={flights} />
      <div className="topbar">
        <div className="brand"><img src={asset('icons/maldicion.webp')} alt="" />Maldiciones</div>
        <span className="spacer" />
        <button className="round" title="Pausa" aria-label="Pausar la partida" onClick={() => setPause('menu')}>❚❚</button>
        <button className="round" title="Pantalla completa" aria-label="Pantalla completa" onClick={toggleFullscreen}>⛶</button>
        <button className="round" title="Compendio de cartas" onClick={() => setComp(true)}>?</button>
        <button className="round" title="Registro de la partida" onClick={() => setShowLog((v) => !v)}>≡</button>
        <button className="round" title="Salir" onClick={() => (ph.t === 'over' ? onExit() : setPause('exit'))}>×</button>
      </div>

      <div className={`table k${rivals.length}`}>
        {rivals.map((p, i) => (
          <Seat
            key={p.id}
            s={s}
            p={p.id}
            side={seats[i][0]}
            x={seats[i][1]}
            selectable={pickPlayers.includes(p.id)}
            onPick={() => onPlayer(p.id)}
            onFoul={isHost ? () => send({ type: 'penalize', target: p.id }) : undefined}
            state={seatState(p.id)}
            onKick={net && isHost && seatState(p.id) === 'auto' ? () => net.send({ t: 'drop', p: p.id, how: 'kick' }) : undefined}
            egidaAir={egidaAir}
            slapped={ph.t === 'aplastar' && ph.slapped.includes(p.id)}
            shown={shown(p.id)}
            reveal={revealed[p.id] ?? []}
            intro={intro}
            say={s.announce?.n !== muted}
            room={facedown ? p.hand.length - shown(p.id) : room[p.id] ?? 0}
          />
        ))}

        <div className="center">
          <div className={`deck ${onDeck ? 'hot' : ''}`} data-anchor="deck" onClick={onDeck ?? undefined} title="Mazo">
            <img className="d3" src={asset('cards/back.webp')} alt="" />
            <img className="d2" src={asset('cards/back.webp')} alt="" />
            <img src={asset('cards/back.webp')} alt="Mazo" draggable={false} />
            <span className="count">{facedown ? s.deck.length + s.players.reduce((a, p) => a + p.hand.length - shown(p.id), 0) + 1 : s.deck.length}</span>
          </div>

          <div className={`disc ${flash ? 'flip' : ''}`}>
            <svg className={`flow ${s.dir === 1 ? '' : 'rev'}`} viewBox="0 0 200 200" aria-label={`Sentido de juego ${s.dir === 1 ? 'horario' : 'antihorario'}`}>
              <path className="arc" d="M 30 62 A 80 80 0 0 1 96 20" />
              <path className="tip" d="M 112 20 L 92 8 L 92 32 Z" />
              <path className="arc" d="M 170 138 A 80 80 0 0 1 104 180" />
              <path className="tip" d="M 88 180 L 108 168 L 108 192 Z" />
            </svg>
            <div className={`pile ${slapping ? 'slap' : ''} ${onPile && !slapping ? 'hot' : ''} ${tucks.length ? 'tucking' : ''}`} data-anchor="pile" onClick={onPile ?? undefined}>
              {/* Cartas que entran por debajo: van antes en el DOM, así quedan por detrás de la carta superior. */}
              {tucks.map((t) => <div key={`t${t.key}`} className="pc tuck" style={{ '--sx': `${t.side}px` } as React.CSSProperties}><img src={t.src} alt="" /></div>)}
              {!dealing && s.pile.slice(-5).map((c, i, a) => {
                const h = hash(c.id);
                const isTop = i === a.length - 1;
                return (
                  <div key={c.id} className={`pc ${isTop ? 'top' : ''} ${flying.includes(c.id) ? 'air' : ''}`} style={{ transform: isTop ? `rotate(${(h % 9) - 4}deg)` : `rotate(${(h % 25) - 12}deg) translate(${((h >> 4) % 11) - 5}px, ${((h >> 8) % 9) - 4}px)` }}>
                    <CardView card={c} onInfo={isTop ? setHelp : undefined} />
                  </div>
                );
              })}
            </div>
            {!dealing && <span className="now"><span className={`dot c-${s.color}`} />{COLOR_NAME[s.color]} · {KINDS[top.kind].name}</span>}
            {ph.t === 'aplastar' && <div key={`slap${ph.win}`} className="slap-label">¡APLASTAR!<small>{slapping ? 'pulsa la Pila, Espacio o Intro' : 'todos a la Pila'}</small></div>}
          </div>

          <div className={`tri ${cursed ? 'cursed' : ''} ${envFx ? 'fxing' : ''}`} title="Indicadores de Entorno">
            {(['tinieblas', 'mutis', 'centro', 'inutilizar'] as const).map((k) => {
              const on = (triHold ?? envNow)[k];
              const label = k === 'centro' ? 'Entorno maldito' : KINDS[k].name;
              // El Indicador de Tinieblas gira un tercio de vuelta cada vez que termina un turno de su lanzador (I → II → III).
              const spin = k === 'tinieblas' && s.env.tinieblas ? { rotate: `${s.env.tinieblas.count * 120}deg` } : undefined;
              return <img key={k} style={spin} className={`t-${k} ${on ? 'on' : ''}`} src={asset(`ui/${k}-${on ? 'on' : 'off'}.webp`)} alt={`${label}: ${on ? 'activo' : 'inactivo'}`} title={`${label}: ${on ? 'activo' : 'inactivo'}`} />;
            })}
            {s.env.tinieblas && <span className="tin">{s.env.tinieblas.count + 1}/3</span>}
            {cursed && <span className="curse">Entorno maldito: nadie puede ganar</span>}
          </div>
        </div>
      </div>

      <aside className={`log ${showLog ? 'show' : ''}`}>
        <div className="log-bar">
          <b>Registro</b>
          <button onClick={() => setShowLog(false)} aria-label="Cerrar registro">×</button>
        </div>
        <div className="log-body" ref={logRef}>
          {s.log.map((l, i) => <p key={i}>{rich(l.text, names)}</p>)}
        </div>
      </aside>

      {tinte && !envFx && <div className="tinte-panel"><GemPicker onPick={(c) => send({ type: 'color', player: ME, color: c })} /></div>}
      {tray && <div className={`tray ${trayCount > 7 ? 'many' : ''} ${escarcha ? 'esc' : ''} ${iman ? 'late' : ''}`}>{tray}</div>}

      {/* Zona de mensajes de alto fijo: lo que ocurre (arriba) y lo que se me pide (abajo). Nunca empuja la mesa ni la mano. */}
      <div className="msgzone">
        <div className="line1">
          {!dealing && !callout && !tinte && <div className="ticker" key={s.log.length}>{rich(s.log[s.log.length - 1]?.text ?? '', names)}</div>}
        </div>
        <div className={`banner ${alert ? 'alert' : ''} ${s.turn === ME && !dealing ? 'mine' : ''}`}>
          {s.announce?.n !== muted && s.announce?.player === ME && <span key={s.announce.n} className="say">{s.announce.text}</span>}
          <span className="msg">{text}</span>
          {btns}
        </div>
      </div>

      <div className={`hand ${s.turn === ME && !dealing ? 'turn' : ''}`}>
        <div className="me-tag">
          <span className={`pill ${s.turn === ME && !dealing ? 'on' : ''}`} style={{ borderColor: PCOL[ME] }}>{me.name}<i>{shown(ME)}</i></span>
          {isHost && <button className="foul" title="Anfitrión: señalarte una falta (robas 3)" onClick={() => send({ type: 'penalize', target: ME })}>+3</button>}
        </div>
        {me.egida && (
          <div className={`my-egida ${egidaAir.includes(me.egida.id) ? 'air' : ''}`} data-egida={ME} title="Tu Égida boca arriba: le queda 1 uso">
            <CardView card={me.egida} className="small" />
            <small>Égida · 1 uso</small>
          </div>
        )}
        <div className="cards-row" data-anchor={`p${ME}`}>
          {sortedHand.map((c, i) => {
            // Carta que aún viene de camino: ya ocupa su hueco en la mano, pero no se ve hasta que aterriza.
            const coming = facedown ? i >= dealt[ME] : hidden.includes(c.id);
            const act = coming ? null : cardAction(c);
            const drawn = ph.t === 'turn' && ph.drawn === c.id;
            return (
              <div
                key={c.id}
                data-card={c.id}
                className={`hc ${act ? 'playable' : ''} ${sel.includes(c.id) || myShown.includes(c.id) ? 'picked' : ''} ${myShown.includes(c.id) ? 'shown' : ''} ${intro === 'out' || intro === 'in' ? `flip-${intro}` : turning[c.id] ? `flip-${turning[c.id]}` : ''} ${coming ? 'incoming' : ''}`}
                style={{ marginLeft: i === 0 ? 0 : `calc(var(--card-w) * ${step - 1})`, transform: `rotate(${(i - mid) * Math.min(4, 30 / Math.max(n, 1))}deg) translateY(${Math.abs(i - mid) ** 1.7 * 1.6}px)`, zIndex: i }}
                onClick={act?.run}
              >
                <CardView card={c} back={blind || (facedown && c.kind !== 'maldicion') || turning[c.id] === 'out'} className={`${act ? '' : 'dim'} ${drawn ? 'drawn' : ''}`} badge={act?.label} onBadge={act?.alt} onInfo={setHelp} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Anuncio de la carta jugada: quién, qué carta y qué hace, bajo la carta que se presenta en grande sobre la Pila. */}
      {/* Si me toca elegir color, el selector ocupa el sitio del cartel de la jugada (no se pisan). */}
      {callout && !tinte && (
        <div key={`call${callout.key}`} className={`callout c-${callout.tone}`}>
          <small><i style={{ background: PCOL[callout.player % PCOL.length] }} />{names[callout.player]} {callout.verb}</small>
          <strong>{callout.cards.map((c, i) => <span key={c.id}>{i > 0 && <em>+</em>}<Icon kind={c.kind} size={24} />{cardName(c)}</span>)}</strong>
          <span>{callout.text}</span>
        </div>
      )}
      {envFx && <EnvFx key={envFx.key} steps={envFx.steps} before={envFx.before} onDone={() => envDone(envFx.key)} />}
      {flash && (
        <div key={`flash${flash.key}`} className="dirfx" style={{ '--d': flash.dir } as React.CSSProperties}>
          <i className="ring" />
          {(['old', 'new'] as const).map((c) => (
            <svg key={c} className={c} viewBox="0 0 200 200">
              <path className="arc" d="M 30 62 A 80 80 0 0 1 96 20" /><path className="tip" d="M 112 20 L 92 8 L 92 32 Z" />
              <path className="arc" d="M 170 138 A 80 80 0 0 1 104 180" /><path className="tip" d="M 88 180 L 108 168 L 108 192 Z" />
            </svg>
          ))}
          <div className="label">¡Cambio de sentido!<small>Ahora se juega en sentido {flash.dir === 1 ? 'horario ↻' : 'antihorario ↺'}</small></div>
        </div>
      )}

      <HelpDock kind={helpKind} setKind={setHelpKind} beta={!!cfg.beta} />
      <div className="edge"><Countdown timer={timer} /></div>

      {net && remote.status !== 'open' && <div className="net-banner" role="status">Reconectando…</div>}
      {net && rv && rv.waiting.length > 0 && ph.t !== 'over' && <WaitBox rv={rv} recvAt={remote.recvAt} isHost={isHost} decide={(p, how) => net.send({ t: 'drop', p, how })} />}
      {net && rv && rv.you >= 0 && rv.seats[rv.you]?.state === 'out' && ph.t !== 'over' && <div className="net-banner" role="status">Has quedado fuera de la partida: puedes seguir mirando.</div>}
      {ph.t === 'over' && <GameOver s={s} startedAt={startedAt.current} onExit={onExit} onRematch={net ? undefined : onRematch} onLobby={net ? () => net.send({ t: 'lobby' }) : undefined} />}
      {pause && ph.t !== 'over' && (
        <div className="pause" role="dialog" aria-label="Partida en pausa">
          <div className="pause-box">
            {pause === 'menu' ? (
              <>
                <h2>Pausa</h2>
                <p>{net ? 'Es una partida online: aunque tengas este menú abierto, la partida sigue.' : 'La partida está detenida: nadie juega y los tiempos no corren.'}</p>
                <button className="primary" onClick={() => setPause(null)}>Continuar</button>
                <button onClick={toggleFullscreen}>Pantalla completa</button>
                <button onClick={() => { setPause(null); setComp(true); }}>Compendio</button>
                <button onClick={() => setPause('exit')}>Salir de la partida</button>
              </>
            ) : (
              <>
                <h2>¿Salir de la partida?</h2>
                <p>{net ? 'Una máquina jugará por ti el resto de la partida.' : 'Se perderá la partida en curso.'}</p>
                <button className="danger" onClick={onExit}>Sí, salir</button>
                <button onClick={() => setPause(null)}>Seguir jugando</button>
              </>
            )}
          </div>
        </div>
      )}
      {comp && <div className="over-page"><Compendium tab="jugar" onClose={() => setComp(false)} /></div>}
    </div>
  );
}

type EnvK = 'mutis' | 'inutilizar' | 'tinieblas' | 'centro';
type EnvState = Record<EnvK, boolean>;
interface EnvStep { k: EnvK; on: boolean }

const ENV_TEXT: Record<EnvK, [string, string]> = {
  mutis: ['¡Mutis!', 'Silencio: las cartas dejan de anunciarse.'],
  inutilizar: ['¡Inutilizar!', 'Las cartas de color pierden su efecto.'],
  tinieblas: ['¡Tinieblas!', 'Todos juegan con las cartas boca abajo durante 3 turnos.'],
  centro: ['¡Entorno maldito!', 'Con 2 o más Entornos activos nadie puede ganar.'],
};
const ENV_OFF: Record<EnvK, [string, string]> = {
  mutis: ['Fin de Mutis', 'Las cartas vuelven a anunciarse.'],
  inutilizar: ['Fin de Inutilizar', 'Las cartas de color recuperan su efecto.'],
  tinieblas: ['Se disipan las Tinieblas', 'Las cartas vuelven a verse.'],
  centro: ['Fin del Entorno maldito', 'Ya se puede ganar otra vez.'],
};

/** Ritmo del cambio de Entorno: crecer, cada vuelta, pausa final y vuelta a su sitio. */
const ENV_GROW = 550, ENV_STEP = 900, ENV_HOLD = 900, ENV_BACK = 500;

/**
 * La trifuerza entera crece hasta el centro de la mesa y se dan la vuelta, de uno en uno, los Indicadores que cambian;
 * después vuelve a su sitio. La trifuerza pequeña se oculta mientras tanto (es la misma que se ve crecer).
 */
function EnvFx({ steps, before, onDone }: { steps: EnvStep[]; before: EnvState; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const [flipped, setFlipped] = useState(0);
  const [label, setLabel] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const tri = document.querySelector('.tri')?.getBoundingClientRect();
    const pile = anchorRect('pile');
    if (!el || !tri || !pile) { done.current(); return; }
    const s = Math.max(1.4, Math.min(2.8, (window.innerHeight * 0.4) / tri.height, (window.innerWidth * 0.8) / tri.width));
    // Centrada sobre la Pila, pero siempre entera dentro de la pantalla (con sitio para el texto debajo).
    const hw = (tri.width * s) / 2, hh = (tri.height * s) / 2;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const cx = clamp(pile.left + pile.width / 2, hw + 12, window.innerWidth - hw - 12);
    const cy = clamp(pile.top + pile.height / 2, hh + 12, window.innerHeight - hh - 80);
    Object.assign(el.style, { left: `${tri.left}px`, top: `${tri.top}px`, width: `${tri.width}px`, height: `${tri.height}px` });
    el.style.setProperty('--dx', `${cx - (tri.left + tri.width / 2)}px`);
    el.style.setProperty('--dy', `${cy - (tri.top + tri.height / 2)}px`);
    el.style.setProperty('--s', `${s}`);
    setLabel({ x: cx, y: cy + (tri.height * s) / 2 + 14 });
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    at(20, () => el.classList.add('big'));
    steps.forEach((_, i) => at(ENV_GROW + i * ENV_STEP, () => setFlipped(i + 1)));
    const end = ENV_GROW + steps.length * ENV_STEP + ENV_HOLD;
    at(end, () => { el.classList.remove('big'); setLabel(null); });
    at(end + ENV_BACK, () => done.current());
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // El texto es el del último Indicador que se ha dado la vuelta (o el primero que va a hacerlo).
  const cur = steps[Math.max(0, flipped - 1)];
  const [title, desc] = (cur.on ? ENV_TEXT : ENV_OFF)[cur.k];
  return (
    <>
      <div ref={ref} className="envfx" aria-hidden="true">
        {(['tinieblas', 'mutis', 'centro', 'inutilizar'] as const).map((k) => {
          const i = steps.findIndex((x) => x.k === k);
          const to = i >= 0 ? steps[i].on : before[k];
          return (
            <div key={k} className={`ef t-${k} ${i >= 0 && flipped > i ? 'flip' : ''} ${i >= 0 ? 'moving' : ''}`}>
              <img className="face a" src={asset(`ui/${k}-${before[k] ? 'on' : 'off'}.webp`)} alt="" />
              <img className="face b" src={asset(`ui/${k}-${to ? 'on' : 'off'}.webp`)} alt="" />
            </div>
          );
        })}
      </div>
      {label && (
        <div key={`${cur.k}${cur.on}`} className="envfx-label" style={{ left: label.x, top: label.y }} aria-live="polite">
          <b>{title}</b><span>{desc}</span>
        </div>
      )}
    </>
  );
}

// ───────────────────────── online: jugadores caídos ─────────────────────────

/** Partida detenida esperando a uno o varios jugadores que se han caído. El anfitrión decide qué hacer. */
function WaitBox({ rv, recvAt, isHost, decide }: { rv: RoomView; recvAt: number; isHost: boolean; decide: (p: number, how: 'wait' | 'auto' | 'kick') => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const i = window.setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(i);
  }, []);
  const left = (until: number) => {
    const ms = Math.max(0, until - rv.now + recvAt - Date.now());
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };
  return (
    <div className="pause wait" role="dialog" aria-label="Partida detenida">
      <div className="pause-box">
        <h2>Partida detenida</h2>
        {rv.waiting.map((w) => {
          const who = rv.seats[w.p]?.name ?? 'Un jugador';
          return (
            <div key={w.p} className="wait-row">
              <p><b>{who}</b> se ha desconectado. Le esperamos <b>{left(w.until)}</b>; si no vuelve, jugará una máquina por él.</p>
              {isHost ? (
                <>
                  <button className="primary" onClick={() => decide(w.p, 'wait')}>Esperar más</button>
                  <button onClick={() => decide(w.p, 'auto')}>Seguir: que juegue una máquina</button>
                  <button className="danger" onClick={() => decide(w.p, 'kick')}>Seguir sin {who} (sus cartas al fondo de la Pila)</button>
                </>
              ) : (
                <small>El anfitrión decide si se le sigue esperando.</small>
              )}
            </div>
          );
        })}
        <small>Si se ha cerrado la pestaña, puede volver con el mismo código y el mismo nombre.</small>
      </div>
    </div>
  );
}

/** Avisos breves cuando alguien se cae, vuelve, entra o se va de la sala. */
function NetToasts({ client }: { client: NetClient }) {
  const { view: v } = useNet(client);
  const prev = useRef<{ name: string; online: boolean; bot: boolean }[] | null>(null);
  const [toasts, setToasts] = useState<{ key: number; text: string; bad: boolean }[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!v) return;
    const now = v.seats.map((x) => ({ name: x.name, online: x.online, bot: x.bot }));
    const old = prev.current;
    prev.current = now;
    if (!old) return;
    const add = (text: string, bad: boolean) => {
      const key = ++seq.current;
      setToasts((t) => [...t, { key, text, bad }]);
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 4500);
    };
    now.forEach((x, i) => {
      if (i === v.you) return;
      const o = old.find((y) => y.name === x.name);
      if (!o) { if (!x.bot) add(`${x.name} ha entrado en la sala`, false); return; }
      if (x.bot && !o.bot) add(`${x.name} se ha ido`, true);
      else if (!x.bot && o.online && !x.online) add(`${x.name} se ha desconectado`, true);
      else if (!x.bot && !o.online && x.online) add(`${x.name} ha vuelto`, false);
    });
    old.forEach((o) => { if (!o.bot && !now.some((x) => x.name === o.name)) add(`${o.name} ha salido de la sala`, true); });
  }, [v]);
  if (!toasts.length) return null;
  return createPortal(
    <div className="toasts" role="status">
      {toasts.map((t) => <div key={t.key} className={t.bad ? 'bad' : ''}>{t.text}</div>)}
    </div>,
    document.body,
  );
}

// ───────────────────────── fin de partida ─────────────────────────

function GameOver({ s, startedAt, onExit, onRematch, onLobby }: { s: GameState; startedAt: number; onExit: () => void; onRematch?: () => void; onLobby?: () => void }) {
  const [tab, setTab] = useState<'res' | 'log'>('res');
  const w = s.winner!;
  const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  const ritual = s.log.some((l) => l.text.includes('reúne los 3 Rituales'));
  const names = s.players.map((p) => p.name);
  const ids = s.players.map((p) => p.id);
  // Clasificación: el ganador primero y después de menos a más cartas en la mano.
  const order = [...ids].sort((a, b) => (a === w ? -1 : b === w ? 1 : s.players[a].hand.length - s.players[b].hand.length));
  /** Quién tiene el valor más alto (o más bajo) de un récord; en empate, el mejor clasificado. */
  const best = (vals: number[], among: number[], low = false) => among.reduce((x, y) => ((low ? vals[y] < vals[x] : vals[y] > vals[x]) ? y : x), among[0]);
  const curses = best(s.stats.maxCurses, order);
  const most = best(s.stats.maxHand, order);
  const rest = order.filter((p) => p !== w);
  const close = rest.length ? best(s.stats.minHand, rest, true) : null;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const awards: [string, number, string][] = [
    ['Más Maldiciones a la vez', curses, n(s.stats.maxCurses[curses], 'Maldición', 'Maldiciones')],
    ['Más cartas en la mano', most, n(s.stats.maxHand[most], 'carta', 'cartas')],
    ...(close !== null ? [['Más cerca de ganar', close, s.stats.minHand[close] === 0 ? 'se quedó sin cartas' : `bajó a ${n(s.stats.minHand[close], 'carta', 'cartas')}`] as [string, number, string]] : []),
  ];
  return (
    <div className="over" role="dialog" aria-label="Fin de la partida">
      <div className="over-box">
        <header className={w === ME ? 'win' : ''}>
          <small>Fin de la partida</small>
          <h2>{w === ME ? '¡Has ganado!' : `Gana ${s.players[w].name}`}</h2>
          {ritual ? <p>{w === ME ? 'Has reunido los 3 Rituales.' : 'Ha reunido los 3 Rituales.'}</p> : w === ME && <p>Te has librado de tu Maldición y de todas tus cartas.</p>}
        </header>
        <div className="over-tabs">
          <button className={tab === 'res' ? 'on' : ''} onClick={() => setTab('res')}>Resumen</button>
          <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Historial ({s.log.length})</button>
        </div>
        {tab === 'res' ? (
          <>
            <div className="over-stats">
              <div><b>{mins}</b><span>{mins === 1 ? 'minuto' : 'minutos'}</span></div>
              <div><b>{s.stats.turns}</b><span>turnos</span></div>
              <div><b>{s.stats.played.reduce((a, b) => a + b, 0)}</b><span>cartas echadas</span></div>
              <div><b>{s.stats.drawn.reduce((a, b) => a + b, 0)}</b><span>cartas robadas</span></div>
            </div>
            <div className="over-awards">
              {awards.map(([title, p, value]) => (
                <div key={title} style={{ borderTopColor: PCOL[p % PCOL.length] }}>
                  <small>{title}</small>
                  <b>{s.players[p].name}</b>
                  <span>{value}</span>
                </div>
              ))}
            </div>
            <ol className="over-list">
              {order.map((p, i) => {
                const pl = s.players[p];
                return (
                  <li key={p} className={p === w ? 'first' : ''}>
                    <span className="pos">{i + 1}</span>
                    <span className="who" style={{ borderColor: PCOL[p % PCOL.length] }}>
                      <b>{pl.name}{p === ME && pl.name !== 'Tú' && ' (tú)'}</b>
                      <small>Echó {s.stats.played[p]} · robó {s.stats.drawn[p]} · le quedan {pl.hand.length}</small>
                    </span>
                    <span className="left">
                      {pl.hand.length === 0 ? <em>Sin cartas</em> : pl.hand.map((c) => <img key={c.id} src={asset(cardImage(c))} alt={cardName(c)} title={cardName(c)} />)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <ol className="over-log">
            {s.log.map((l, i) => <li key={i}><span>{i + 1}</span><p>{rich(l.text, names)}</p></li>)}
          </ol>
        )}
        <div className="over-btns">
          {onRematch && <button className="primary" onClick={onRematch}>Jugar otra vez</button>}
          {/* Online: se vuelve a la sala de espera (todos juntos) o se sale de la sala. */}
          {onLobby && <button className="primary" onClick={onLobby}>Volver a la sala</button>}
          <button onClick={onExit}>{onLobby ? 'Salir de la sala' : 'Volver al inicio'}</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── raíz ─────────────────────────

/** Sala online: sala de espera o, si hay partida, la mesa (con mi asiento como ME). */
function OnlineRoom({ client, onExit }: { client: NetClient; onExit: (error?: string) => void }) {
  const { view: v, fatal, error } = useNet(client);
  useEffect(() => { if (fatal) onExit(error ?? undefined); }, [fatal, error, onExit]);
  if (!v?.game || v.you < 0) return <><Shell><Lobby client={client} onExit={() => onExit()} /></Shell><NetToasts client={client} /></>;
  setMe(v.you);
  const g = v.game;
  const cfg: GameConfig = { name: g.players[v.you].name, players: g.players.length, level: v.opts.level, extraCurses: v.opts.extraCurses, condena: v.opts.condena, beta: v.opts.beta };
  // Los avisos van en la misma posición en la sala y en la mesa, así no se pierden al cambiar de una a otra.
  return <><Game key={`${v.code}:${v.round}`} cfg={cfg} net={client} onExit={() => { client.leave(); onExit(); }} /><NetToasts client={client} /></>;
}

type Screen = { k: 'home' } | { k: 'setup' } | { k: 'local'; cfg: GameConfig; n: number } | { k: 'entry'; code?: string; error?: string | null } | { k: 'room'; client: NetClient };

export default function App() {
  const q = new URLSearchParams(location.search);
  const [screen, setScreen] = useState<Screen>(() => {
    // ?sala=ABCD abre directamente la entrada online con el código puesto (enlace de invitación).
    const sala = q.get('sala')?.toUpperCase();
    if (sala && /^[A-Z]{4}$/.test(sala)) return { k: 'entry', code: sala };
    // ?demo=5 arranca directamente una partida de 5 jugadores (útil para probar).
    const demo = Number(q.get('demo'));
    if (demo >= 3 && demo <= 6) return { k: 'local', n: 0, cfg: { name: 'Tú', players: demo, level: 1, extraCurses: false, condena: true, debugHand: q.get('mano')?.split(','), beta: q.has('beta') } };
    return { k: 'home' };
  });
  const home = useCallback(() => {
    // Se quita ?sala= de la dirección para no volver a entrar al recargar.
    if (location.search) history.replaceState(null, '', location.pathname);
    setScreen({ k: 'home' });
  }, []);
  const leaveRoom = useCallback((error?: string) => setScreen({ k: 'entry', error }), []);
  switch (screen.k) {
    case 'home':
      return <Shell><Home onLocal={() => setScreen({ k: 'setup' })} onOnline={() => setScreen({ k: 'entry' })} /></Shell>;
    case 'setup':
      return <Shell><LocalSetup onBack={home} onStart={(cfg) => setScreen({ k: 'local', cfg, n: 0 })} /></Shell>;
    case 'entry':
      return <Shell><OnlineEntry initialCode={screen.code} initialError={screen.error} onBack={home} onJoin={(code, name) => setScreen({ k: 'room', client: new NetClient(code, name) })} /></Shell>;
    case 'room':
      return <OnlineRoom client={screen.client} onExit={leaveRoom} />;
    case 'local':
      setMe(0);
      return <Game key={screen.n} cfg={screen.cfg} onExit={home} onRematch={() => setScreen({ ...screen, n: screen.n + 1 })} />;
  }
}
