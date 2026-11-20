import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card, Color, COLORS, COLOR_NAME, HELP, KINDS, Kind, cardImage, cardName, isCursed, isPlainGem } from '../game/cards';
import { Action, Anchor, Effect, Fx, GameState, canDup, canFreeAntitodo, canPlay, isBlind, isCursedEnv, nextPlayer, pendingPlayers, predTargets, reactOptions, reactOptionsFor, topCard } from '../game/engine';
import { Level } from '../game/bot';
import { Compendium, CompendioButton, HelpDock } from './Compendium';
import { TutorGate, TutorOverlay, useTutor } from './Tutorial';
import { AccountChip, EntryScreen, GuestScreen, HexIcon, ProfileScreen } from './Account';
import { initAccount, myProfile, useAccount } from '../net/auth';
import { randomIcon } from '../game/icons';
import { GameConfig, ME, Timer, setMe, useGame } from './useGame';
import { BUILD, NetClient, playerId, sendLocalBug, useNet } from '../net/client';
import type { RoomView } from '../game/room';
import { Lobby, OnlineEntry, Shell } from './Online';
import { SetupFields } from './Setup';
import type { RoomOpts } from '../game/room';
import { COLOR_ORDER, CardView, Icon, PCOL, asset, ink, rich, toggleFullscreen } from './shared';
import { PEEK_VISIBLE_MS } from '../game/timing';

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
function GemPicker({ onPick, size = 68 }: { onPick: (c: Color) => void; size?: number }) {
  return (
    <div className="gem-pick" role="group" aria-label="Elige el color">
      {COLORS.map((c, i) => (
        <button key={c} className={`gem-btn g-${c}`} style={{ animationDelay: `${i * 0.25}s` }} onClick={() => onPick(c)} aria-label={COLOR_NAME[c]}>
          <Gem color={c} size={size} />
          <span>{COLOR_NAME[c]}</span>
        </button>
      ))}
    </div>
  );
}

const hash = (id: string) => { let h = 7; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
/** Giro con el que queda una carta arriba de la Pila (el vuelo termina ya con ese giro: sin saltos al posarse). */
const topRot = (id: string) => (hash(id) % 9) - 4;
/** Giro de una carta de mi mano en el abanico (para que la carta que llega vuele ya con ese giro). */
/** Giro total en pantalla de un elemento (el suyo y el de sus contenedores, p. ej. el abanico girado de un lateral). */
const screenRot = (el: Element | null) => {
  let r = 0;
  for (let e = el; e && !e.classList.contains('game'); e = e.parentElement) {
    const t = getComputedStyle(e).transform;
    const m = t && t !== 'none' ? t.match(/matrix\(([^,]+),\s*([^,]+)/) : null;
    if (m) r += (Math.atan2(+m[2], +m[1]) * 180) / Math.PI;
  }
  return r;
};
/** Hueco libre `k` (0 = el primero) del abanico de un rival: dónde, a qué tamaño y con qué giro llega allí una carta. */
const fanSlot = (p: number, k = 0, w = ghostW()) => {
  const imgs = [...document.querySelectorAll<HTMLImageElement>(`[data-anchor="p${p}"] img:not(.fan-egida)`)];
  const empty = imgs.filter((im) => im.style.opacity === '0');
  const el = empty[Math.min(k, empty.length - 1)] ?? imgs[imgs.length - 1];
  if (!el) return null;
  return { rect: el.getBoundingClientRect(), s: el.offsetWidth / w, rot: screenRot(el) };
};
const elRot = (el?: HTMLElement | null) => parseFloat(el?.style.transform.match(/rotate\((-?[\d.]+)deg/)?.[1] ?? '0') || 0;

/** Duración del vuelo de una carta y de su presentación en grande sobre la Pila. */
let FLY_MS = 1060;
let SHOW_MS = 940;
let SETTLE_MS = 520;
let CALLOUT_MS = 3600;
/**
 * Velocidad de las animaciones de cartas y carteles: 1 = la base. La partida normal va un 10 % más pausada y el
 * tutorial, más todavía (es para aprender).
 */
function setAnimSpeed(f: number) {
  FLY_MS = 1060 * f;
  SHOW_MS = 940 * f;
  SETTLE_MS = 520 * f;
  CALLOUT_MS = 3600 * f;
}
setAnimSpeed(1.1);
/** Lo que tarda una mano en abrir hueco antes de que salga la carta que va a ocuparlo. */
const ROOM_MS = 300;

/** `flipFrom`: la carta sale con esta cara y se da la vuelta a mitad de camino (cartas jugadas a ciegas). */
interface FlyOpt { /** Giro final (grados) con el que se posa. */ rotB?: number; flat?: boolean; src: string; A: DOMRect; B: DOMRect; sA: number; sB: number; delay?: number; ms?: number; show?: number; showDx?: number; showMs?: number; solid?: boolean; flipFrom?: string; onStart?: () => void; onLand?: () => void }

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
  img.src = o.flipFrom ?? o.src;
  img.className = 'ghost';
  if (o.flipFrom) {
    // A mitad de camino se estrecha, cambia de cara y se vuelve a abrir.
    window.setTimeout(() => {
      img.classList.add('gflip');
      window.setTimeout(() => { img.src = o.src; }, 160);
    }, delay + ms * 0.4);
  }
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
  img.style.transform = pose(o.show ?? o.sB, o.show ? 0 : o.rotB ?? 0);
  img.style.opacity = '1';
  if (o.onStart) window.setTimeout(o.onStart, delay);
  let total = delay + ms;
  if (o.show) {
    window.setTimeout(() => {
      // Se posa sin rebote, girando suavemente hasta su ángulo en la Pila.
      img.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.35, 0, 0.15, 1)`;
      img.style.transform = pose(o.sB, o.rotB ?? 0);
      if (o.showDx) {
        gx.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.35, 0, 0.15, 1)`;
        gx.style.transform = `translateX(${cx(o.B)}px)`;
      }
    }, total + (o.showMs ?? SHOW_MS));
    total += (o.showMs ?? SHOW_MS) + SETTLE_MS;
  }
  window.setTimeout(() => { gx.remove(); o.onLand?.(); }, total + 30);
  return total;
}

const anchorRect = (a: Anchor) => document.querySelector(`[data-anchor="${typeof a === 'number' ? `p${a}` : a}"]`)?.getBoundingClientRect();
/** Ancho del fantasma sin escalar: el de una carta de mesa, que es el de la Pila. */
const ghostW = () => anchorRect('pile')?.width || 140;
/** Escalas del fantasma (respecto al ancho de la carta de mesa) según de dónde sale o adónde llega. */
const scaleAt = (a: Anchor, r: DOMRect, w: number) => (a === 'pile' || a === 'deck' ? Math.min(r.width, w * 1.2) / w : a === ME ? 0.9 : 0.55);

/** Imán: lo que se quedan las cartas atraídas levantadas sobre cada jugador antes de volar (más pausado). */
const REVEAL_MS = 2600;
/** Muestra levantadas y marcadas las cartas que se van a llevar de cada jugador y después las hace volar a su destino. */
function reveal(host: HTMLElement, takes: Fx[], w: number, blind = false) {
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
      // Las mías se ven, salvo en Tinieblas (ahí todo va boca abajo).
      img.src = asset(p === ME && !blind ? cardImage(f.card!) : 'cards/back.webp');
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
        if (B) launch(host, { src: imgs[i].src, A: r, B, sA: r.width / w, sB: to === 'pile' ? 0.8 : scaleAt(to, B, w), delay: (k++ % 8) * 280, ms: 1500, solid: true });
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
  const fx = s.fx.filter((f) => f.card && f.to === 'pile' && f.from === star.from && !f.bounce);
  // La carta que acompaña a un Predestinar (queda encima): el cartel dice «Predestinar + carta».
  const below = s.pile[s.pile.length - 2];
  if (below?.kind === 'predestinar' && s.log.some((l) => l.n === s.seq && l.text.includes('acompaña Predestinar'))) return { from: star.from, fx, cards: [below, ...fx.map((f) => f.card!)] };
  return { from: star.from, fx, cards: fx.map((f) => f.card!) };
}

/** Lo que dura el cartel de la carta jugada. */

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
  /** Cartas que me llegan más tarde (tras otra animación): ni siquiera tienen hueco en la mano todavía. */
  const [deferred, setDeferred] = useState<string[]>([]);
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
    // La jugada que gana la partida va a cámara lenta.
    const slow = s.phase.t === 'over';
    const added: string[] = [];
    const hide: string[] = [];
    const defer: string[] = [];
    let k = 0;
    const blindNow = isBlind(s);
    const BACK = asset('cards/back.webp');
    /** Retraso extra para lo que viene después de una carta probada a ciegas que vuelve a la mano. */
    let extra = 0;
    /** Cartas que van ya volando a cada rival (cada una a su propio hueco del abanico). */
    const toCount: Record<number, number> = {};
    // Imán: antes de volar, las cartas atraídas se levantan y se marcan sobre cada jugador (las tuyas, boca arriba).
    const takes = s.phase.t === 'iman' ? s.fx.filter((f) => f.card && typeof f.from === 'number' && typeof f.to === 'number') : [];
    if (takes.length) reveal(host, takes, w, isBlind(s));
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
        // Mi carta probada a ciegas que no sirve: mientras va y vuelve, no se ve también en la mano.
        if (f.bounce && f.from === ME && f.card) hide.push(f.card.id);
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
        // Boca arriba: lo que va a la Pila, las cartas malditas que se entregan y, fuera de Tinieblas, lo mío.
        // En Tinieblas, lo que entra o sale de mi mano (sin ir a la Pila) viaja boca abajo.
        const faceUp = !!f.card && (f.to === 'pile' || isCursed(f.card) || (!blindNow && !(typeof f.to === 'number' && f.from !== ME)));
        const src = faceUp ? asset(cardImage(f.card!)) : BACK;
        // Jugada a ciegas (desde una mano boca abajo hacia la Pila): se da la vuelta por el camino.
        const flipFrom = blindNow && f.card && f.to === 'pile' && typeof f.from === 'number' ? BACK : undefined;
        const go = (B2: DOMRect, sB: number, delay: number, rot?: number) =>
          launch(host, {
            // Las cartas que pasan de una mano a otra van boca abajo (salvo las mías).
            src,
            A, B: under ? new DOMRect(B2.left + side, B2.top, B2.width, B2.height) : B2,
            sA: mine ? Math.min(A.width, w * 1.4) / w : scaleAt(f.from, A, w),
            sB,
            rotB: rot ?? (id && !under && f.card && s.pile[s.pile.length - 1]?.id === f.card.id ? topRot(f.card.id) : 0),
            delay,
            flipFrom,
            ms: slow ? FLY_MS * 2.6 : undefined,
            showMs: slow ? SHOW_MS * 2.6 : undefined,
            solid: !!mine,
            show: isStar ? (B.width * (stars.length > 1 ? 1.2 : slow ? 1.7 : 1.36)) / w : undefined,
            showDx: dx - side,
            onStart: from !== null ? () => bump(from, -1) : undefined,
            onLand: () => {
              if (f.bounce && typeof f.from === 'number') {
                // No servía: vuelve a la mano de quien la probó y se da la vuelta otra vez.
                const back = f.from === ME ? document.querySelector<HTMLElement>('.cards-row')?.getBoundingClientRect() : anchorRect(f.from);
                const mineBack = f.from === ME && f.card ? f.card.id : null;
                if (back) launch(host, { src: BACK, flipFrom: src, A: B, B: back, sA: scaleAt('pile', B, w), sB: scaleAt(f.from, back, w), ms: 700, solid: true, onLand: () => { if (id) setFlying((v) => v.filter((x) => x !== id)); if (mineBack) setHidden((v) => v.filter((x) => x !== mineBack)); } });
                else if (mineBack) setHidden((v) => v.filter((x) => x !== mineBack));
                return;
              }
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
              if (got && fromDeck && !blindNow) {
                // Llega boca abajo y se da la vuelta en la mano.
                setTurning((v) => ({ ...v, [got]: 'out' }));
                window.setTimeout(() => setTurning((v) => ({ ...v, [got]: 'in' })), 340);
                window.setTimeout(() => setTurning((v) => { const n = { ...v }; delete n[got]; return n; }), 820);
              }
            },
          });
        if (got) {
          // Mi mano ya ha hecho hueco a la carta (invisible): se espera a que termine de abrirse y la carta vuela a su sitio exacto.
          const fly = () => {
            const el = document.querySelector<HTMLElement>(`[data-card="${got}"]`);
            go(el?.getBoundingClientRect() ?? B, el ? el.offsetWidth / w : scaleAt(f.to, B, w), 0, elRot(el));
          };
          if (extra > 0) {
            // Llega después de otra animación (p. ej. la carta probada a ciegas que vuelve): hasta entonces no ocupa hueco.
            defer.push(got);
            window.setTimeout(() => {
              setDeferred((v) => v.filter((x) => x !== got));
              window.setTimeout(fly, ROOM_MS);
            }, k * gap + extra);
          } else window.setTimeout(fly, ROOM_MS + k * gap);
        } else if (to !== null && !under) {
          // A un rival: cuando su abanico ya ha abierto hueco, vuela a ese hueco con su tamaño y su giro.
          const nth = (toCount[to] = (toCount[to] ?? -1) + 1);
          window.setTimeout(() => {
            const fs = fanSlot(to, nth, w);
            go(fs?.rect ?? B, fs?.s ?? scaleAt(f.to, B, w), 0, fs?.rot);
          }, k * gap + extra + ROOM_MS);
        } else go(B, scaleAt(f.to, B, w), k * gap + extra + (to !== null ? ROOM_MS : 0));
        // Tras una carta que vuelve a la mano, lo siguiente (la carta que roba) espera a que termine.
        if (f.bounce) extra += FLY_MS + (isStar ? SHOW_MS + SETTLE_MS : 0) + 900;
      }
    }
    if (added.length) setFlying((v) => [...v, ...added]);
    if (hide.length) setHidden((v) => [...v, ...hide]);
    if (defer.length) setDeferred((v) => [...v, ...defer]);
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
  return { layer, flying, adj, hidden, room, turning, tucks, egidaAir, deferred };
}

// ───────────────────────── portada ─────────────────────────

/** Portada: elegir modo de juego (las opciones de cada partida van dentro de cada modo). */
function Home({ onLocal, onOnline, onTutorial, onAccount }: { onLocal: () => void; onOnline: () => void; onTutorial: () => void; onAccount: () => void }) {
  return (
    <>
      <AccountChip onAccount={onAccount} />
      <h1>Maldiciones</h1>
      <p className="tagline">El juego de cartas maldito</p>
      <div className="play-row">
        <button className="play" onClick={onLocal}>Jugar en local</button>
        <button className="play" onClick={onOnline}>Jugar online</button>
      </div>
      <div className="home-links">
        <CompendioButton />
        <button onClick={onTutorial}>Tutorial</button>
      </div>
    </>
  );
}

/** Partida local contra las máquinas: nombre y opciones antes de empezar. */
function LocalSetup({ onStart, onBack, onAccount }: { onStart: (c: GameConfig) => void; onBack: () => void; onAccount?: () => void }) {
  const acc = useAccount();
  const prof = myProfile(acc);
  const [name, setName] = useState(() => prof?.nickname ?? (() => { try { return localStorage.getItem('maldiciones:nombre') ?? ''; } catch { return ''; } })());
  // Ninguna casilla marcada por defecto.
  const [opts, setOpts] = useState<RoomOpts>({ size: 4, level: 1, extraCurses: false, condena: false, beta: false, timer: false });
  const [color, setColor] = useState(() => prof?.color ?? (() => { try { const c = Number(localStorage.getItem('maldiciones:color')); return c >= 0 && c < PCOL.length ? c : 0; } catch { return 0; } })());
  const start = () => {
    try { localStorage.setItem('maldiciones:nombre', name.trim()); localStorage.setItem('maldiciones:color', String(color)); } catch { /* sin almacenamiento: no se recuerda */ }
    onStart({ name: name.trim() || 'Tú', players: opts.size, level: opts.level, extraCurses: opts.extraCurses, condena: opts.condena, beta: opts.beta, timer: opts.timer !== false, color, icon: prof?.icon });
  };
  return (
    <>
      <h1>En local</h1>
      <p className="tagline">Contra las máquinas</p>
      {onAccount && <AccountChip onAccount={onAccount} />}
      {prof ? null : <>
      <label>
        Tu nombre
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tú" maxLength={14} />
      </label>
      <div className="field">
        Tu color
        <div className="color-pick" role="radiogroup" aria-label="Tu color">
          {COLOR_ORDER.map((i) => <button key={i} role="radio" aria-checked={color === i} aria-label={`Color ${i + 1}`} className={color === i ? 'on' : ''} style={{ background: PCOL[i] }} onClick={() => setColor(i)} />)}
        </div>
      </div>
      </>}
      <SetupFields opts={opts} set={(o) => setOpts((v) => ({ ...v, ...o }))} />
      <div className="play-row">
        <button className="play" onClick={start}>Empezar</button>
      </div>
      <div className="home-links">
        <CompendioButton />
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

/** Color que se elige con cada triángulo de la trifuerza. */
const TRI_COLOR: ['tinieblas' | 'mutis' | 'inutilizar', Color][] = [['tinieblas', 'a'], ['mutis', 'v'], ['inutilizar', 'm']];


/** Dónde se sienta cada rival: borde izquierdo, arriba (con su posición horizontal) o borde derecho, en sentido horario. */
const SEATS: Record<number, [string, number][]> = {
  2: [['left', 0], ['right', 0]],
  3: [['left', 0], ['top', 50], ['right', 0]],
  4: [['left', 0], ['top', 33], ['top', 67], ['right', 0]],
  5: [['left', 0], ['top', 25], ['top', 50], ['top', 75], ['right', 0]],
};

/** Fases de la entrada: reparto boca abajo, giro de las cartas (ocultar / mostrar) y primera carta de la Pila. */
/** Fases de la entrada: cuenta atrás, se coloca la mesa (Maldiciones, Mazo, trifuerza), reparto, giro y primera carta. */
type Intro = 'count' | 'setup' | 'deal' | 'out' | 'in' | 'pile' | null;
/** Fases en las que cada jugador tiene su Maldición aparte, boca arriba. */
// (Ya no se apartan: la Maldición inicial se queda en la mano, en su sitio del abanico.)
const curseApart = (_i: Intro) => false;

/** Estado de un asiento online: caído y esperándole, caído con una máquina jugando por él, o fuera de la partida. */
type SeatState = 'wait' | 'auto' | 'out' | undefined;
const STATE_TAG: Record<'wait' | 'auto' | 'out', [string, string]> = {
  wait: ['desconectado', 'Se ha caído: la partida espera a que vuelva'],
  auto: ['ausente', 'Desconectado: juega una máquina por él'],
  out: ['fuera', 'Ha quedado fuera de la partida'],
};

function Seat({ s, p, side, x, selectable, onPick, onFoul, slapped, shown, intro, say, room, reveal, state, onKick, egidaAir, color, next, glow, icon }: { s: GameState; p: number; side: string; x: number; selectable: boolean; onPick?: () => void; onFoul?: () => void; slapped: boolean; shown: number; intro: Intro; say: boolean; room: number; reveal: Card[]; state?: SeatState; onKick?: () => void; egidaAir: string[]; color: string; next: boolean; glow?: boolean; icon?: string }) {
  const pl = s.players[p];
  // Durante el reparto su Maldición está aparte, boca arriba, así que no cuenta en el abanico.
  const have = Math.max(0, Math.min(shown - (curseApart(intro) ? 1 : 0), 14));
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
        {/* Égida ya usada una vez: boca arriba, al final de su abanico. */}
        {pl.egida && <img className={`fan-egida ${egidaAir.includes(pl.egida.id) ? 'air' : ''}`} data-egida={p} src={asset('cards/egida.webp')} alt="Égida boca arriba (le queda 1 uso)" title="Égida boca arriba: le queda 1 uso" draggable={false} style={{ transform: `translateX(-50%) rotate(${(n - mid) * spread}deg)` }} />}
      </div>
      {reveal.length > 0 && (
        <div className="seat-reveal" aria-label={`${pl.name} enseña ${reveal.length} carta(s)`}>
          {reveal.map((c) => <img key={c.id} src={asset(cardImage(c))} alt={cardName(c)} />)}
        </div>
      )}
      <div className="plate">
        <span className={`pill ${glow ? 'spin-glow' : ''}`} style={{ background: color, color: ink(color), '--gc': color } as React.CSSProperties}>{icon && <HexIcon icon={icon} color={color} size={46} />}{pl.name}<i>{shown}</i></span>
        {glow && <span className="start-tag" style={{ background: color, color: ink(color) }}>¡Empieza!</span>}
        {s.turn === p && !intro && s.phase.t !== 'over' && <span className="turn-tag" style={{ background: color, color: ink(color), boxShadow: `0 0 18px ${color}` }}>Su turno</span>}
        {next && s.turn !== p && !intro && <span className="next-tag" style={{ borderColor: color }}>Después</span>}
        {!intro && pl.hand.length === 1 && s.phase.t !== 'over' && <span className="last-tag">¡Última carta!</span>}
        {curseApart(intro) && shown >= 1 && <img className={`curse0 ${intro === 'out' ? 'flip-out' : ''}`} src={asset('cards/maldicion.webp')} alt="Su Maldición, boca arriba" />}
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
const FATE_LABEL: Record<Fate, string> = { back: 'Al Mazo', keep: 'A la mano', discard: 'Descartar' };

function Game({ cfg, onExit, onRematch, net }: { cfg: GameConfig; onExit: () => void; onRematch?: () => void; net?: NetClient }) {
  // El tutorial va más despacio (es para aprender); la partida normal, un 10 % más pausada que la base.
  setAnimSpeed(cfg.tutorial ? 1.4 : 1.1);
  /** Entrada de la partida: cada jugador tiene su Maldición boca arriba y recibe 6 cartas boca abajo; luego se giran. */
  // Quien entra o vuelve a una partida online ya repartida no ve el reparto otra vez.
  const [intro, setIntro] = useState<Intro>(() => (net?.getSnap().view?.dealt ? null : 'deal'));
  const [dealt, setDealt] = useState<number[]>(() => Array(cfg.players).fill(0));
  /** Cuenta atrás de la entrada (3, 2, 1…) y qué piezas de la mesa ya se han colocado. */
  const [countText, setCountText] = useState<string | null>(null);
  const [stage, setStage] = useState({ deck: intro === null, tri: intro === null });
  /** El compendio abierto en mitad de la partida también la detiene. */
  const [comp, setComp] = useState(false);
  /** Pausa (y su menú, que también sirve para confirmar la salida). */
  const [pause, setPause] = useState<null | 'menu' | 'exit' | 'bug'>(null);
  // En local la partida la aloja este navegador; online, el servidor (aquí solo se muestra y se envían acciones).
  /** Tiempo máximo de 15 s: en local se puede cambiar desde la pausa; online lo cambia el anfitrión (opción de la sala). */
  const [localTimer, setLocalTimer] = useState(cfg.timer !== false);
  /** Tutorial: qué pueden hacer las máquinas en el paso actual (lo fija el tutorial, más abajo). */
  const [tgate, setTgate] = useState<TutorGate>({ bots: 'off', autoPass: true });
  /** Ruleta del principio (quién empieza y en qué sentido): `wait` hasta que acaba el reparto, `run` mientras gira. */
  const [spinPhase, setSpinPhase] = useState<'wait' | 'run' | 'off'>(() => (intro === null || cfg.tutorial ? 'off' : 'wait'));
  const [spin, setSpin] = useState<{ cur: number; done: boolean; reel: number[]; go: boolean } | null>(null);
  const spinStarted = useRef(false);
  const spinTimers = useRef<number[]>([]);
  const local = useGame(useMemo(() => ({ ...cfg, timer: localTimer }), [cfg, localTimer]), intro === null && spinPhase === 'off', pause !== null || comp, !net, cfg.tutorial ? tgate : undefined);
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
  /** Color de cada jugador: online, el que eligió en la sala; en local, el de su asiento. */
  /** Orden al azar de la paleta para las máquinas (se sortea una vez por partida). */
  const botColors = useRef(PCOL.map((_, i) => i).sort(() => Math.random() - 0.5));
  const colors = useMemo(() => {
    if (net) return s.players.map((_, p) => PCOL[rv?.seats[p]?.color ?? p % PCOL.length] ?? PCOL[p % PCOL.length]);
    // En local: el mío, el que elegí; las máquinas, al azar entre los que quedan (fijos durante la partida).
    const mine = cfg.color ?? 0;
    const rest = botColors.current.filter((i) => i !== mine).map((i) => PCOL[i]);
    return s.players.map((_, p) => (p === ME ? PCOL[mine] : rest[(p - 1 + rest.length) % rest.length]));
  }, [net, rv?.seats, s.players.length, cfg.color]);
  /** Icono de cada jugador: online, el que trae cada uno (las máquinas, al azar); en local, el mío y uno al azar por máquina. */
  const botIcons = useRef(Array.from({ length: 8 }, () => randomIcon()));
  const icons = useMemo(() => s.players.map((_, p) => (net ? rv?.seats[p]?.icon ?? 'maldicion' : p === ME ? cfg.icon ?? 'maldicion' : botIcons.current[p])), [net, rv?.seats, s.players.length, cfg.icon]);
  const timerOn = net ? rv?.opts.timer !== false : localTimer;
  const seatState = (p: number): SeatState => (net && rv ? rv.seats[p]?.state : s.players[p].out ? 'out' : undefined);
  // Online: se avisa al servidor cuando ya se ha visto el reparto, para que empiece a correr el juego.
  useEffect(() => { if (net && intro === null && spinPhase === 'off') net.send({ t: 'ready' }); }, [net, intro, spinPhase]);
  // Ruleta: va pasando por los jugadores, cada vez más despacio, hasta pararse en quien empieza; luego se ve el sentido.
  useEffect(() => {
    if (intro !== null || spinPhase !== 'wait' || spinStarted.current) return;
    spinStarted.current = true;
    setSpinPhase('run');
    // Tragaperras: una tira con los jugadores (varias vueltas, en el sentido de juego) que baja hasta pararse en quien empieza.
    const n = s.players.length, dir = s.dir, start = Math.floor(Math.random() * n);
    const total = n * 4 + ((((s.turn - start) * dir) % n) + n) % n;
    const seq = Array.from({ length: total + 1 }, (_, i) => (((start + i * dir) % n) + n) % n);
    const timers: number[] = [];
    setSpin({ cur: s.turn, done: false, reel: seq, go: false });
    timers.push(window.setTimeout(() => setSpin((v) => v && { ...v, go: true }), 120));
    timers.push(window.setTimeout(() => setSpin((v) => v && { ...v, done: true }), 120 + REEL_MS));
    timers.push(window.setTimeout(() => { setSpin(null); setSpinPhase('off'); }, 120 + REEL_MS + 2600));
    spinTimers.current = timers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intro, spinPhase]);
  useEffect(() => () => spinTimers.current.forEach(clearTimeout), []);
  const startedAt = useRef(Date.now());
  const origins = useRef<Record<string, DOMRect>>({});
  const tutor = useTutor(!!cfg.tutorial, s, intro);
  useEffect(() => {
    if (tutor.gate.bots !== tgate.bots || tutor.gate.autoPass !== tgate.autoPass || tutor.gate.slapFirst !== tgate.slapFirst || tutor.gate.slow !== tgate.slow || tutor.gate.slowSlap !== tgate.slowSlap) setTgate(tutor.gate);
  }, [tutor.gate.bots, tutor.gate.autoPass, tutor.gate.slapFirst, tutor.gate.slow, tutor.gate.slowSlap, tgate]);
  const send = (a: Action) => {
    // En el tutorial solo se puede hacer lo que pide el paso.
    if (!tutor.allow(a)) return;
    // Antes de cada acción mía se anota dónde está cada carta de mi mano, para animarla desde ahí.
    document.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => (origins.current[el.dataset.card!] = el.getBoundingClientRect()));
    dispatch(a);
  };
  const [helpKind, setHelpKind] = useState<Kind | null>(null);
  const [helpArt, setHelpArt] = useState<string | undefined>();
  /** Cada vez que se pulsa el «?» de una carta (abre la ayuda aunque estuviera cerrada). */
  const [helpPing, setHelpPing] = useState(0);
  const setHelp = (c: Card) => { setHelpKind(c.kind); setHelpArt(asset(cardImage(c))); setHelpPing((n) => n + 1); };
  /** Pasar el ratón por una carta boca arriba enseña su ayuda (y se queda hasta que se mira otra). */
  const hoverHelp = (c: Card) => { setHelpKind(c.kind); setHelpArt(asset(cardImage(c))); };
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
  /** A quién le toca después del turno en curso (si nadie cambia el sentido ni concede el turno). */
  const nextUp = ph.t === 'over' ? -1 : s.after?.turnTo ?? nextPlayer(s, s.turn);
  const { layer: flights, flying, adj, hidden, room, turning, tucks, egidaAir, deferred } = useFlights(s, origins);

  // Los rayos del fondo giran en el sentido de la partida (horario o antihorario). Se invierte la animación
  // en marcha (playbackRate), así el cambio no da saltos.
  const cursedNow = isCursedEnv(s);
  // (El sentido de giro de los rayos lo pone la clase `rev` de la mesa: horario o antihorario, como las flechas.)

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
  /** Maldiciones que quedan en el montón del centro al empezar. */
  const [curseStack, setCurseStack] = useState(0);
  useEffect(() => {
    const host = flights.current;
    if (!host || skipDeal.current) return;
    const n = s.players.length;
    const timers: number[] = [];
    let live = true;
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => live && fn(), ms));
    endDeal.current = () => { live = false; timers.forEach(clearTimeout); host.replaceChildren(); setCurseStack(0); setStage({ deck: true, tri: true }); setIntro(null); };
    setIntro('setup');
    setDealt(Array(n).fill(0));
    setStage({ deck: false, tri: false });
    const order = Array.from({ length: n }, (_, i) => (n - i) % n); // antihorario, empezando por mí
    // 1) Aparecen en el centro las Maldiciones que se van a repartir, una sobre otra.
    setCurseStack(n);
    const S0 = 700 + n * 90;
    // 2) Salen del montón hacia cada jugador, boca arriba, uno tras otro.
    order.forEach((p, j) => at(S0 + j * 420, () => {
      setCurseStack((c) => Math.max(0, c - 1));
      const slots = document.querySelectorAll<HTMLElement>('.cards-row .hc');
      const slot = p === ME ? slots[slots.length - 1] : null;
      const fs = p === ME ? null : fanSlot(p);
      const A = anchorRect('pile'), B = slot?.getBoundingClientRect() ?? fs?.rect ?? anchorRect(p), w = ghostW();
      if (!A || !B) return setDealt((d) => d.map((x, i) => (i === p ? 1 : x)));
      launch(host, { src: asset('cards/maldicion.webp'), A, B, sA: scaleAt('pile', A, w), sB: slot ? slot.offsetWidth / w : fs?.s ?? scaleAt(p, B, w), rotB: slot ? elRot(slot) : fs?.rot ?? 0, ms: 900, solid: true, onLand: () => live && setDealt((d) => d.map((x, i) => (i === p ? 1 : x))) });
    }));
    // 3) Se coloca el Mazo y después la trifuerza.
    const S1 = S0 + n * 420 + 500;
    at(S1, () => setStage((v) => ({ ...v, deck: true })));
    at(S1 + 550, () => setStage({ deck: true, tri: true }));
    at(S1 + 1100, () => setIntro('deal'));
    // 4) Reparto.
    const GAP = 110, MS = 640, START = S1 + 1300;
    let k = 0;
    for (let round = 1; round < 7; round++)
      for (const p of order) {
        if (round >= s.players[p].hand.length) continue;
        at(START + k++ * GAP, () => {
          const slot = p === ME ? document.querySelectorAll<HTMLElement>('.cards-row .hc')[round - 1] : null;
          const fs = p === ME ? null : fanSlot(p);
          const A = anchorRect('deck'), B = slot?.getBoundingClientRect() ?? fs?.rect ?? anchorRect(p), w = ghostW();
          if (!A || !B) return;
          launch(host, { flat: true, src: asset('cards/back.webp'), A, B, sA: scaleAt('deck', A, w), sB: slot ? slot.offsetWidth / w : fs?.s ?? scaleAt(p, B, w), rotB: slot ? elRot(slot) : fs?.rot ?? 0, ms: MS, onLand: () => live && setDealt((d) => d.map((x, i) => (i === p ? x + 1 : x))) });
        });
      }
    const done = START + k * GAP + MS + 350;
    at(done, () => setIntro('out'));
    at(done + 340, () => setIntro('in'));
    at(done + 800, () => {
      setIntro('pile');
      const A = anchorRect('deck'), B = anchorRect('pile'), w = ghostW();
      if (A && B) launch(host, { src: asset(cardImage(s.pile[s.pile.length - 1])), A, B, sA: scaleAt('deck', A, w), sB: scaleAt('pile', B, w), rotB: topRot(s.pile[s.pile.length - 1].id), ms: 900, show: (B.width * 1.36) / w });
    });
    at(done + 800 + 900 + SHOW_MS + SETTLE_MS, () => setIntro(null));
    return () => { live = false; timers.forEach(clearTimeout); host.replaceChildren(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dealing = intro !== null;
  const facedown = intro === 'count' || intro === 'setup' || intro === 'deal' || intro === 'out';
  const shown = (p: number) => (facedown ? Math.min(dealt[p], s.players[p].hand.length) : Math.max(0, s.players[p].hand.length + (adj[p] ?? 0) - (p === ME ? s.players[ME].hand.filter((c) => hidden.includes(c.id)).length : 0)));
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [s.log.length, showLog]);

  // ── qué se me pide ahora
  const myTurn = ph.t === 'turn' && s.turn === ME;
  /** Me toca hacer algo aunque no sea mi turno (reaccionar, descartar Gemas, aplastar, elegir color…). */
  const actionNeeded = !dealing && ph.t !== 'over' && s.turn !== ME && pendingPlayers(s).includes(ME);
  /** Texto del cartel cuando algo va contra mí: si es un efecto reflejado, se dice. */
  const attackText = (() => {
    if (ph.t !== 'react') return 'Contra ti';
    const k = ph.eff.k;
    if (k === 'rcodicia' || k === 'rpurga' || k === 'riman' || k === 'rescarcha') return 'Efecto reflejado contra todos';
    if ((k === 'draw' && !ph.eff.aplastar) || (k === 'trav' && ph.eff.noChain)) return 'Efecto reflejado contra ti';
    return 'Contra ti';
  })();
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
  /** Defensas que aún sirven mientras se resuelve un Imán o una Codicia (antes del intercambio). */
  const lateOpts = (ph.t === 'imanPick' || ph.t === 'codicia') && ph.eff ? reactOptionsFor(s, ME, ph.eff).filter((o) => o === 'antitodo' || o === 'egida' || o === 'reflejo') : [];
  /** Algo va contra mí y me toca responder (distinto de que sea mi turno). */
  const underAttack = !!(reacting && reacting.eff.targets.includes(ME)) || !!tie || (ph.t === 'aplastar' && ph.players.includes(ME) && !ph.slapped.includes(ME)) || (ph.t === 'inutil' && !!ph.receive && ph.player === ME);
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
  /**
   * Color que enseña la mesa: cambia cuando la carta se posa en la Pila (no mientras se presenta en grande),
   * y de forma gradual. Durante la entrada no hay color hasta que sale la primera carta.
   */
  const [shownColor, setShownColor] = useState<Color | null>(() => (intro === null ? s.color : null));
  /** Hasta cuándo siguen las cartas de la última jugada en el aire. */
  const busyUntil = useRef(0);
  const colorTimer = useRef(0);
  useEffect(() => {
    const g = playGroup(s);
    if (g) busyUntil.current = Date.now() + FLY_MS + SHOW_MS + SETTLE_MS;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.seq]);
  useEffect(() => {
    clearTimeout(colorTimer.current);
    if (intro !== null) return setShownColor(null);
    const wait = Math.max(0, busyUntil.current - Date.now());
    colorTimer.current = window.setTimeout(() => setShownColor(s.color), wait);
    return () => clearTimeout(colorTimer.current);
  }, [s.color, s.seq, intro]);
  /** Las gemas para elegir color salen cuando ya ha terminado la animación de la carta. */
  const [pickReady, setPickReady] = useState(false);
  const [callout, setCallout] = useState<Callout | null>(null);
  /** Final de la partida a cámara lenta: la última jugada y el anuncio del ganador, antes del resumen. */
  const [finale, setFinale] = useState(false);
  const wasOver = useRef(s.phase.t === 'over');
  useEffect(() => {
    const over = ph.t === 'over';
    if (over && !wasOver.current) {
      setFinale(true);
      const id = window.setTimeout(() => setFinale(false), FINALE_MS);
      wasOver.current = true;
      return () => clearTimeout(id);
    }
    wasOver.current = over;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ph.t]);
  const [shuffling, setShuffling] = useState(false);
  /** Hasta cuándo se ve el cartel de la carta jugada (los demás avisos esperan a que termine). */
  const calloutUntil = useRef(0);
  /** Hasta cuándo dura la animación de cambio de Entorno que está en camino. */
  const envBusyUntil = useRef(0);
  const [flash, setFlash] = useState<{ key: number; dir: 1 | -1 } | null>(null);
  const [muted, setMuted] = useState(-1);
  const prevDir = useRef(s.dir);
  /** Cambio de Entorno: la trifuerza crece en el centro y se dan la vuelta, uno tras otro, los Indicadores que cambian. */
  const envNow: EnvState = { mutis: s.env.mutis, inutilizar: s.env.inutilizar, tinieblas: !!s.env.tinieblas, centro: isCursedEnv(s) };
  const [envFx, setEnvFx] = useState<{ key: number; steps: EnvStep[]; before: EnvState } | null>(null);
  /** Tutorial: animación de los triángulos retenida hasta que el paso la suelte. */
  const envHold = useRef(false);
  envHold.current = !!tutor.view?.step?.holdEnv;
  const pendingEnv = useRef<{ key: number; steps: EnvStep[]; before: EnvState } | null>(null);
  useEffect(() => {
    if (!envHold.current && pendingEnv.current) {
      const p = pendingEnv.current;
      pendingEnv.current = null;
      setEnvFx(p);
    }
  }, [tutor.view?.step?.holdEnv]);
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
      calloutUntil.current = Date.now() + CALLOUT_MS;
      setMuted(s.announce?.n ?? -1); // el cartel ya lo anuncia: sobra el bocadillo
    }
    // La Pila se baraja para formar un Mazo nuevo: el Mazo se agita un momento.
    if (s.fx.some((f) => f.from === 'pile' && f.to === 'deck')) {
      setShuffling(true);
      window.setTimeout(() => setShuffling(false), 1800);
    }
    // Égida recién usada: también se anuncia en grande.
    s.players.forEach((pl, p) => {
      if (pl.egida && prevEgidas.current[p] !== pl.egida.id && !s.env.mutis) {
        setCallout({ key: s.seq, player: p, verb: p === ME ? 'te proteges con' : 'se protege con', cards: [pl.egida], text: HELP.egida.text, tone: 'n' });
        calloutUntil.current = Date.now() + CALLOUT_MS;
        setMuted(s.announce?.n ?? -1);
      }
    });
    prevEgidas.current = s.players.map((p) => p.egida?.id ?? null);
    const before = prevEnv.current;
    prevEnv.current = envNow;
    // Primero los Indicadores de los lados y, después, el central.
    const steps = (['tinieblas', 'mutis', 'inutilizar', 'centro'] as const).filter((k) => envNow[k] !== before[k]).map((k) => ({ k, on: envNow[k] }));
    // Si la partida acaba con esta jugada (Antitodo, un Entorno…), la trifuerza cambia sin animación grande.
    if (steps.length && s.phase.t === 'over') { setTriHold(null); setEnvFx(null); }
    else if (steps.length) {
      const key = s.seq;
      lastEnvKey.current = key;
      setTriHold((h) => h ?? before);
      // Los avisos van de uno en uno: el del Entorno espera a que termine el de la carta jugada.
      const wait = Math.max(f ? FLY_MS + SHOW_MS + SETTLE_MS : 200, calloutUntil.current - Date.now() + 150);
      envBusyUntil.current = Date.now() + wait + ENV_GROW + steps.length * ENV_STEP + ENV_HOLD + ENV_BACK;
      window.setTimeout(() => {
        // En el tutorial, a veces se explica antes la carta: la animación espera a que se pase al paso siguiente.
        if (envHold.current) pendingEnv.current = { key, steps, before };
        else setEnvFx({ key, steps, before });
      }, wait);
    }
    if (prevDir.current !== s.dir) {
      prevDir.current = s.dir;
      // El aviso de cambio de sentido espera a que termine la presentación de la carta (el Reflejo) para no pisarse.
      const key = s.seq, dir = s.dir;
      window.setTimeout(() => setFlash({ key, dir }), Math.max(f ? FLY_MS + SHOW_MS + SETTLE_MS + 150 : 0, calloutUntil.current - Date.now() + 150));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.seq]);
  useEffect(() => {
    if (!callout) return;
    const id = window.setTimeout(() => setCallout(null), CALLOUT_MS);
    return () => clearTimeout(id);
  }, [callout]);
  /** Al caer las Tinieblas: unos segundos con las cartas a la vista para memorizarlas antes de que se den la vuelta. */
  const [peekUntil, setPeekUntil] = useState(0);
  const [, peekTick] = useState(0);
  const wasBlind = useRef(blind);
  useEffect(() => {
    // El tiempo de memorizar empieza cuando acaba la animación del Entorno (y el cartel de la carta), no antes.
    if (blind && !wasBlind.current && !dealing) setPeekUntil(Math.max(Date.now(), envBusyUntil.current, calloutUntil.current) + PEEK_VISIBLE_MS);
    if (!blind) setPeekUntil(0);
    wasBlind.current = blind;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blind]);
  useEffect(() => {
    if (!peekUntil) return;
    // Se repinta mientras dura; al acabar se conserva la hora de fin (la usan las gemas para esperar a la vuelta de las cartas).
    const i = window.setInterval(() => { peekTick((n) => n + 1); if (Date.now() >= peekUntil + 1000) clearInterval(i); }, 250);
    return () => clearInterval(i);
  }, [peekUntil]);
  const peeking = blind && peekUntil > Date.now();
  const peekShown = peeking && Date.now() >= peekUntil - PEEK_VISIBLE_MS;
  const peekTimer = useMemo(() => (peekShown ? { until: peekUntil, total: PEEK_VISIBLE_MS } : null), [peekShown, peekUntil]);
  /** Cuando se acaba el tiempo de memorizar, las cartas se dan la vuelta (primero se cierran de cara, luego se abren de espaldas). */
  const [hideFlip, setHideFlip] = useState<'out' | 'in' | null>(null);
  const wasPeeking = useRef(false);
  useEffect(() => {
    if (wasPeeking.current && !peeking && blind) {
      setHideFlip('out');
      const a = window.setTimeout(() => setHideFlip('in'), 340);
      const b = window.setTimeout(() => setHideFlip(null), 820);
      wasPeeking.current = false;
      return () => { clearTimeout(a); clearTimeout(b); };
    }
    wasPeeking.current = peeking;
  }, [peeking, blind]);
  // Las gemas para elegir color, cuando ya han terminado (por orden) la animación de la carta, su cartel y, si la hay,
  // la del Entorno. Va después del efecto que programa esos avisos, para leer sus tiempos ya actualizados.
  useEffect(() => {
    if (!(ph.t === 'tinte' && ph.player === ME)) return setPickReady(false);
    const now = Date.now();
    // Con Tinieblas recién caídas, además, después de memorizar y de que las cartas se den la vuelta.
    const peekEnd = blind && peekUntil ? peekUntil - now + 900 : 0;
    const id = window.setTimeout(() => setPickReady(true), Math.max(250, busyUntil.current - now, calloutUntil.current - now, envBusyUntil.current - now + 100, peekEnd));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ph.t, s.seq, peekUntil]);
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

  // Aplastar: aparece una diana en un sitio al azar de la mesa (el mismo para todos, sale de la ventana de la jugada)
  // y hay que pulsarla antes que los demás.
  /** Última ronda de Aplastar (para dejar los brazos un momento cuando acaba). */
  const lastSlap = useRef<{ spot: { x: number; y: number }; slapped: number[]; players: number[]; win: number } | null>(null);
  // Se calcula durante el render (no en un efecto): así el componente de los brazos no llega a desmontarse
  // entre el final de la ronda y la despedida, y conserva dónde estaba cada mano.
  const lingerRef = useRef<(NonNullable<typeof lastSlap.current> & { until: number }) | null>(null);
  if (ph.t === 'aplastar') lingerRef.current = null;
  else if (lastSlap.current) {
    // Quien cerró la ronda no llegó a verse: ponen la mano todos menos el último (lo dice el registro).
    const last = s.log.slice(-6).map((l) => l.text).find((t) => t.includes('es el último en poner la mano'));
    const loser = last ? s.players.findIndex((p) => last.startsWith(p.name)) : -1;
    const ls = lastSlap.current;
    lingerRef.current = { ...(loser >= 0 ? { ...ls, slapped: [...ls.slapped, ...ls.players.filter((p) => p !== loser && !ls.slapped.includes(p))] } : ls), until: Date.now() + 1700 };
    lastSlap.current = null;
  }
  const slapLinger = lingerRef.current && Date.now() < lingerRef.current.until ? lingerRef.current : null;
  const [, bumpLinger] = useState(0);
  const lingerUntil = lingerRef.current?.until ?? 0;
  useEffect(() => {
    if (!lingerUntil) return;
    const id = window.setTimeout(() => bumpLinger((n) => n + 1), Math.max(0, lingerUntil - Date.now()) + 30);
    return () => clearTimeout(id);
  }, [lingerUntil]);
  const slapSpot = ph.t === 'aplastar' ? (() => {
    const h = hash(`aplastar:${ph.win}:${ph.launcher}`);
    return { x: 14 + (h % 7200) / 100, y: 16 + ((h >> 13) % 4400) / 100 };
  })() : null;
  if (ph.t === 'aplastar' && slapSpot) lastSlap.current = { spot: slapSpot, slapped: [...ph.slapped], players: ph.players, win: ph.win };

  // ── qué hace cada carta de mi mano al pulsarla
  function cardAction(c: Card): { run: () => void; label?: string; alt?: () => void } | null {
    if (dealing) return null;
    if (choosing && (choosing.need === 'card' || choosing.need === 'gem'))
      return choosing.options.includes(c.id) ? { run: () => send({ type: 'choose', player: ME, value: c.id }) } : null;
    if (givingTrav) return giveNeed > 1 ? { run: () => toggle(c.id, giveNeed) } : { run: () => send({ type: 'give', player: ME, cardId: c.id }) };
    if (givingCod) return { run: () => send({ type: 'give', player: ME, cardId: c.id }) };
    if (escarcha) return { run: () => setEscGive(escGive?.cardId === c.id ? null : { cardId: c.id, to: null }), label: escGive?.cardId === c.id ? (escGive.to === null ? 'Elige a quién' : `→ ${name(escGive.to)}`) : undefined };
    if (rafaga) return rafaga.own ? { run: () => setTrayPick(trayPick === c.id ? null : c.id), label: trayPick === c.id ? 'Elige a quién' : undefined } : null;
    // Imán o Codicia aún sin resolver: se pueden parar con una carta de defensa (o Antitodo).
    if (lateOpts.length && !blind) {
      if (c.kind === 'antitodo' && lateOpts.includes('antitodo')) return { run: () => react({ r: 'antitodo' }), label: 'Anular' };
      if (c.kind === 'egida' && lateOpts.includes('egida') && !me.egida) return { run: () => react({ r: 'egida' }), label: 'Defender' };
      if (c.kind === 'reflejo' && lateOpts.includes('reflejo')) return { run: () => react({ r: 'reflejo' }), label: 'Reflejar' };
    }
    if (tie) {
      if (!tie.options.includes(c.id)) return null;
      return tie.count === 1 ? { run: () => send({ type: 'pick', player: ME, ids: [c.id] }) } : { run: () => toggle(c.id, tie.count) };
    }
    if (gemas) return isPlainGem(c) ? { run: () => toggle(c.id) } : null;
    if (reacting && blind && opts.includes('blind')) return { run: () => react({ r: 'blind', cardId: c.id }), label: 'Usar en Tinieblas' };
    // Tinieblas: fuera de mi turno puedo intentar usar cualquier carta (duplicar, Antitodo…); si no sirve, robo 1.
    if (blind && !peeking && !myTurn && ph.t !== 'over') return { run: () => send({ type: 'guess', player: ME, cardId: c.id }), label: 'Usar en Tinieblas' };
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
    // En mi turno, una carta igual a la de la Pila se duplica (no gasta el turno: luego puedo echar otra o terminar).
    if (dup && myTurn) return { run: dup, label: 'Duplicar' };
    if (canPlay(s, ME, c)) return { run: () => send({ type: 'play', player: ME, cardId: c.id }), label: dup ? 'Duplicar' : 'Jugar', alt: dup };
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
  if (myTurn && !ph.drawn && !dealing) onDeck = () => send({ type: 'draw', player: ME });

  // ── mensaje y botones sobre mi mano
  let text = '';
  let alert = false;
  const btns: React.ReactNode[] = [];
  const B = (label: string, run: () => void, primary = false, disabled = false) =>
    btns.push(<button key={label} className={primary ? 'primary' : ''} disabled={disabled} onClick={run}>{label}</button>);
  if (ph.t === 'over') text = '';
  else if (dealing) {
    text = intro === 'count' ? '¡Empieza la partida!' : intro === 'setup' ? 'Cada jugador recibe su Maldición. Se coloca la mesa…' : 'Repartiendo 6 cartas más a cada jugador…';
    B('Saltar', () => endDeal.current());
  } else if (tinte) {
    alert = true;
    // El aviso de elegir color sale a la vez que las gemas, no antes.
    text = pickReady && !envFx ? 'Última carta incolora: elige color con las gemas de los triángulos.'
      : peeking && Date.now() >= peekUntil - PEEK_VISIBLE_MS ? 'Cuando tus cartas se pongan boca abajo, eliges color.'
      : blind ? 'Caen las Tinieblas…' : 'A continuación, elige el siguiente color.';

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
    if (lateOpts.includes('egida') && me.egida) B('Usar Égida (último uso)', () => react({ r: 'egida' }));
    if (lateOpts.length) text += ' Aún puedes pararlo con una carta resaltada.';
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
    text = '¡APLASTAR! Pulsa la mano antes que los demás.';
  } else if (ph.t === 'inutil' && ph.player === ME) {
    // Con Inutilizar activo la carta de color no tiene efecto: si se «empieza» igualmente, se roban 3.
    alert = true;
    text = ph.receive ? `Te llega ${cardName(ph.card)}: ¿recibir el efecto?` : `¿Empezar el efecto de ${cardName(ph.card)}?`;
    B(ph.receive ? 'Recibir el efecto' : 'Empezar el efecto', () => send({ type: 'inutil', player: ME, use: true }));
    B('Cancelar', () => send({ type: 'inutil', player: ME, use: false }));
  } else if (myTurn) {
    text = ph.drawn ? 'Puedes jugar la carta robada o quedártela.' : ph.dupd ? 'Has duplicado: encadena otra carta, roba o termina tu turno.' : blind ? 'Tinieblas: juega una carta a ciegas o roba 3.' : 'Encadena una carta o roba del Mazo.';
    if (ph.drawn) B('Quedármela', () => send({ type: 'keep', player: ME }), true);
    else if (ph.dupd) {
      B('Terminar turno', () => send({ type: 'keep', player: ME }), true);
      B(blind ? 'Robar 3' : 'Robar', () => send({ type: 'draw', player: ME }));
    } else B(blind ? 'Robar 3' : 'Robar', () => send({ type: 'draw', player: ME }), true);
  } else if (ph.t === 'turn') text = `Turno de ${name(s.turn)}${nextUp >= 0 && nextUp !== s.turn ? ` · después ${nextUp === ME ? 'tú' : name(nextUp)}` : ''}…`;
  // Me afecta pero no puedo hacer nada: solo se informa (la ventana sigue abierta por si otro lo intercepta).
  else if (ph.t === 'react') text = effText(s, ph.eff) + (ph.eff.targets.includes(ME) ? ' No tienes con qué responder.' : '');
  else if (ph.t === 'aplastar') text = '¡Aplastar! Todos a pulsar la mano…';
  else if (ph.t === 'gemas') text = `Gema Tricolor: ${ph.waiting.map(name).join(', ')} ${ph.waiting.length > 1 ? 'eligen' : 'elige'} qué Gemas descartar. Se echan todas a la vez.`;
  else if (ph.t === 'tinte') text = `${name(ph.player)} elige color…`;
  else if (ph.t === 'inutil') text = ph.receive ? `${name(ph.player)} decide si recibe el efecto de ${cardName(ph.card)}…` : `${name(ph.player)} decide si empieza el efecto de ${cardName(ph.card)}…`;
  else if (ph.t === 'give') text = `${ph.waiting.map(name).join(' y ')} ${ph.waiting.length > 1 ? 'eligen' : 'elige'} qué carta(s) da a ${name(ph.target)}…`;
  else if (ph.t === 'escarcha') text = `${name(ph.player)} congela el tiempo y mueve cartas entre las manos…`;
  else if (ph.t === 'rafaga') text = `Ráfaga de ${name(s.rafaga?.player ?? s.turn)}: está eligiendo qué cartas jugar…`;
  else {
    const who = pendingPlayers(s)[0] ?? s.turn;
    text = who === ME ? 'Estás resolviendo tu carta…' : ph.t === 'adivinar' ? `${name(who)} está adivinando el futuro…` : `${name(who)} está resolviendo su carta…`;
    if (lateOpts.length) { text += ' Aún puedes pararlo con una carta resaltada.'; alert = true; }
  }

  // ── cartas apartadas que se muestran sobre mi mano (Imán, Adivinar, Recuperar)
  let tray: React.ReactNode = null;
  if (iman) {
    tray = iman.pool.map((c) => {
      const d = assign[c.id] ?? 'discard';
      return (
        <div className="slot" key={c.id}>
          <CardView card={c} back={blind} className={`small ${trayPick === c.id ? 'selected' : ''}`} onClick={() => setTrayPick(trayPick === c.id ? null : c.id)} onInfo={setHelp} onHover={hoverHelp} />
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
          {/* Adivinar: las cartas se miran (también en Tinieblas); al pasar a la mano ya van boca abajo. */}
          <CardView card={c} className={`small ${f === 'back' ? '' : 'dim'}`} onInfo={setHelp} onHover={hoverHelp} />
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
      <CardView key={c.id} card={c} back={blind} className={`small ${trayPick === c.id ? 'selected' : trayPick ? 'dim' : ''}`} onInfo={setHelp} onHover={hoverHelp}
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
        <b style={{ borderColor: colors[x] }}>{name(x)}</b>
        <div>
          {(esc[x] ?? []).map((id) => {
            const moved = !s.players[x].hand.some((c) => c.id === id);
            return <CardView key={id} card={all[id]} back={blind} className={`small ${escPick === id ? 'selected' : ''} ${moved ? 'moved' : ''}`} onClick={() => swap(id)} onInfo={setHelp} onHover={hoverHelp} />;
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
    // Durante el reparto la Maldición va a la derecha del todo (donde quedará después, con las malditas).
    const handNow = me.hand.filter((c) => !deferred.includes(c.id));
    if (facedown) return [...handNow].sort((a, b) => Number(a.kind === 'maldicion') - Number(b.kind === 'maldicion'));
    const o = (c: Card) => (c.color ? COLORS.indexOf(c.color) : KINDS[c.kind].attr === 'maldita' ? 5 : KINDS[c.kind].attr === 'sagrada' ? 4 : 3);
    const sorted = [...handNow].sort((a, b) => o(a) - o(b) || a.kind.localeCompare(b.kind));
    if (!blind) {
      blindOrder.current = null;
      return sorted;
    }
    // Se fija el orden visible justo antes de darse la vuelta y se mantiene mientras duren.
    const prev = blindOrder.current ?? sorted.map((c) => c.id);
    const byId = new Map(handNow.map((c) => [c.id, c]));
    const kept = prev.filter((id) => byId.has(id));
    const order = [...kept, ...handNow.map((c) => c.id).filter((id) => !kept.includes(id))];
    blindOrder.current = order;
    return order.map((id) => byId.get(id)!);
  }, [me.hand, blind, facedown, deferred]);
  const n = sortedHand.length;
  /** Grupos de cartas que se pueden echar a la vez (con un botón «Jugar juntas» entre ellas). */
  const joinGroups: { ids: string[]; run: () => void }[] = [];
  // (En el tutorial solo sale al final, cuando toca echar juntos el Antitodo y la Maldición.)
  if (!blind && !dealing && !finale && (!cfg.tutorial || sortedHand.length === 2)) {
    for (let i = 0; i < sortedHand.length; ) {
      const c = sortedHand[i];
      let j = i + 1;
      // (Predestinar no: la carta que lo acompaña queda encima y la copia ya no se podría duplicar.)
      if (!isCursed(c) && c.kind !== 'predestinar') while (j < sortedHand.length && sortedHand[j].kind === c.kind && sortedHand[j].color === c.color) j++;
      const ids = sortedHand.slice(i, j).map((x) => x.id);
      if (ids.length > 1 && !ids.some((id) => hidden.includes(id))) {
        if (myTurn && canPlay(s, ME, c)) joinGroups.push({ ids, run: () => send({ type: 'play', player: ME, cardId: ids[0], with: ids.slice(1) }) });
        else if (canDup(s, ME, c)) joinGroups.push({ ids, run: () => send({ type: 'dup', player: ME, cardId: ids[0], with: ids.slice(1) }) });
      }
      const nx = sortedHand[j];
      if (c.kind === 'antitodo' && nx?.kind === 'maldicion' && myTurn && canPlay(s, ME, c)) joinGroups.push({ ids: [c.id, nx.id], run: () => send({ type: 'play', player: ME, cardId: c.id, with: [nx.id] }) });
      i = j;
    }
  }
  const step = Math.min(0.5, 4.6 / Math.max(n, 1)); // fracción del ancho de carta entre una carta y la siguiente
  const mid = (n - 1) / 2;

  const cursed = isCursedEnv(s);
  const deckEmpty = !dealing && s.deck.length === 0;

  const seats = SEATS[rivals.length];
  const trayCount = iman ? iman.pool.length : recuperar ? recuperar.options.length : rafaga ? rafaga.pool.length : 0;
  return (
    <div ref={root} data-finale={finale || undefined} style={{ '--pc': ph.t === 'over' ? '#888' : colors[s.turn], '--me': colors[ME], '--me-ink': ink(colors[ME]) } as React.CSSProperties} className={`game col-${shownColor ?? 'n'} ${cfg.tutorial ? 'tutorial' : ''} ${dealing ? 'dealing' : ''} ${spinPhase === 'run' ? 'spinning' : ''} ${spin?.done ? 'spin-dir-on' : ''} ${slapping ? 'slapping' : ''} ${s.dir === 1 ? '' : 'rev'} ${underAttack ? 'under-attack' : ''} ${cursed ? 'cursed' : ''} ${s.env.tinieblas ? 'dark' : ''} ${ph.t === 'aplastar' ? 'quake' : ''}`}>
      <div className="rays" />
      <div className="shade" />
      <div className="flights" ref={flights} />
      <div className="topbar">
        <div className="brand"><img src={asset('icons/maldicion.webp')} alt="" />Maldiciones</div>
        <span className="spacer" />
        <button className="round" title="Pausa" aria-label="Pausar la partida" onClick={() => setPause('menu')}>❚❚</button>
        <button className="round fs-only" title="Pantalla completa" aria-label="Pantalla completa" onClick={toggleFullscreen}>⛶</button>
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
            color={colors[p.id]}
            next={nextUp === p.id}
            slapped={ph.t === 'aplastar' && ph.slapped.includes(p.id)}
            shown={shown(p.id)}
            reveal={revealed[p.id] ?? []}
            intro={intro}
            say={s.announce?.n !== muted}
            room={facedown ? p.hand.length - shown(p.id) : room[p.id] ?? 0}
            glow={!!spin?.done && spin.cur === p.id}
            icon={icons[p.id]}
          />
        ))}

        <div className="center">
          <div className={`deck ${onDeck ? 'hot' : ''} ${deckEmpty ? 'empty' : ''} ${shuffling ? 'shuffling' : ''} ${stage.deck ? (dealing ? 'placed' : '') : 'unplaced'}`} data-anchor="deck" onClick={onDeck ?? undefined} title={deckEmpty ? 'Mazo vacío: se barajará la Pila al robar' : 'Mazo'}>
            <img className="d3" src={asset('cards/back.webp')} alt="" />
            <img className="d2" src={asset('cards/back.webp')} alt="" />
            <img src={asset('cards/back.webp')} alt="Mazo" draggable={false} />
            {deckEmpty && <span className="deck-empty">Mazo vacío</span>}
            {shuffling && <span className="deck-shuffle">¡Se baraja la Pila!</span>}
            <span className="count">{facedown ? s.deck.length + s.players.reduce((a, p) => a + p.hand.length - shown(p.id), 0) + 1 : s.deck.length}</span>
          </div>

          <div className={`disc ${flash ? 'flip' : ''}`}>
            <svg className={`flow ${s.dir === 1 ? '' : 'rev'}`} viewBox="0 0 200 200" aria-label={`Sentido de juego ${s.dir === 1 ? 'horario' : 'antihorario'}`}>
              <path className="arc" d="M 30 62 A 80 80 0 0 1 96 20" />
              <path className="tip" d="M 112 20 L 92 8 L 92 32 Z" />
              <path className="arc" d="M 170 138 A 80 80 0 0 1 104 180" />
              <path className="tip" d="M 88 180 L 108 168 L 108 192 Z" />
            </svg>
            <div className={`pile ${onPile ? 'hot' : ''} ${tucks.length ? 'tucking' : ''}`} data-anchor="pile" onClick={onPile ?? undefined}>
              {/* Cartas que entran por debajo: van antes en el DOM, así quedan por detrás de la carta superior. */}
              {dealing && curseStack > 0 && Array.from({ length: curseStack }, (_, i) => (
                <div key={`cs${i}`} className="pc curse-stack" style={{ '--i': i, transform: `rotate(${((i * 37) % 13) - 6}deg) translate(${((i * 53) % 9) - 4}px, ${-i * 2}px)` } as React.CSSProperties}>
                  <img src={asset('cards/maldicion.webp')} alt="" />
                </div>
              ))}
              {tucks.map((t) => <div key={`t${t.key}`} className="pc tuck" style={{ '--sx': `${t.side}px` } as React.CSSProperties}><img src={t.src} alt="" /></div>)}
              {!dealing && s.pile.slice(-5).map((c, i, a) => {
                const h = hash(c.id);
                const isTop = i === a.length - 1;
                return (
                  <div key={c.id} className={`pc ${isTop ? 'top' : ''} ${flying.includes(c.id) ? 'air' : ''}`} style={{ transform: isTop ? `rotate(${topRot(c.id)}deg)` : `rotate(${(h % 25) - 12}deg) translate(${((h >> 4) % 11) - 5}px, ${((h >> 8) % 9) - 4}px)` }}>
                    <CardView card={c} onInfo={isTop ? setHelp : undefined} onHover={isTop ? hoverHelp : undefined} />
                  </div>
                );
              })}
            </div>
            {!dealing && <span className="now"><span className={`dot c-${s.color}`} />{COLOR_NAME[s.color]} · {KINDS[top.kind].name}</span>}
            {ph.t === 'aplastar' && <div key={`slap${ph.win}`} className="slap-label">¡APLASTAR!<small>{slapping ? 'pulsa la mano' : 'todos a la mano'}</small></div>}
          </div>

          <div className={`tri ${cursed ? 'cursed' : ''} ${envFx ? 'fxing' : ''} ${stage.tri ? (dealing ? 'placed' : '') : 'unplaced'}`} title={tinte ? 'Elige color: pulsa un triángulo' : 'Indicadores de Entorno'}>
            {(['tinieblas', 'mutis', 'centro', 'inutilizar'] as const).map((k) => {
              const on = (triHold ?? envNow)[k];
              const label = k === 'centro' ? 'Entorno maldito' : KINDS[k].name;
              // El Indicador de Tinieblas gira un tercio de vuelta cada vez que termina un turno de su lanzador (I → II → III).
              const spin = k === 'tinieblas' && s.env.tinieblas ? { rotate: `${s.env.tinieblas.count * 120}deg` } : undefined;
              return <img key={k} style={spin} className={`t-${k} ${on ? 'on' : ''}`} src={asset(`ui/${k}-${on ? 'on' : 'off'}.webp`)} alt={`${label}: ${on ? 'activo' : 'inactivo'}`} title={`${label}: ${on ? 'activo' : 'inactivo'}`} />;
            })}
            {/* Elegir color: gemas pequeñas debajo de la trifuerza, cuando ya ha terminado la animación de la carta. */}
            {tinte && !envFx && pickReady && (
              <div className="gem-under">
                <GemPicker size={40} onPick={(c) => send({ type: 'color', player: ME, color: c })} />
                <span className="gem-hint">Elige color</span>
              </div>
            )}
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
          {s.log.map((l, i) => <p key={i}>{rich(l.text, names, colors)}</p>)}
        </div>
      </aside>

      {tray && <div className={`tray ${trayCount > 7 ? 'many' : ''} ${escarcha ? 'esc' : ''} ${iman ? 'late' : ''} ${adivinar ? 'adiv-tray' : ''}`}>{tray}</div>}

      {/* Zona de mensajes de alto fijo: lo que ocurre (arriba) y lo que se me pide (abajo). Nunca empuja la mesa ni la mano. */}
      <div className="msgzone">
        {/* Cartel de la carta jugada: justo encima de la zona de avisos (nunca la pisa) y del ancho del círculo central. */}
        {/* El cartel de la carta jugada no sale mientras haya una bandeja de decisión (ocuparían el mismo sitio). */}
        {callout && !finale && !tray && (
          <div key={`call${callout.key}`} className={`callout c-${callout.tone}`} style={{ '--cc': colors[callout.player] } as React.CSSProperties}>
            <small><i style={{ background: colors[callout.player] }} /><b className="cname">{names[callout.player]}</b> {callout.verb}</small>
            <strong>{callout.cards.map((c, i) => <span key={c.id}>{i > 0 && <em>+</em>}<Icon kind={c.kind} size={24} />{cardName(c)}</span>)}</strong>
            <span>{callout.text}</span>
          </div>
        )}
        <div className="line1">
          {!dealing && !callout && !tinte && <div className="ticker" key={s.log.length}>{rich(s.log[s.log.length - 1]?.text ?? '', names, colors)}</div>}
        </div>
        {/* El aviso sale cuando empiezan los segundos de memorizar (tras el cartel de la carta y la animación del Entorno). */}
        {peeking && !envFx && Date.now() >= peekUntil - PEEK_VISIBLE_MS && (
          <div className="peek-banner" role="status">
            <Icon kind="tinieblas" size={16} /> Tinieblas: memoriza tus cartas · se ponen boca abajo en <b>{Math.ceil((peekUntil - Date.now()) / 1000)}</b>
          </div>
        )}
        <div className={`banner ${alert ? 'alert' : ''} ${s.turn === ME && !dealing ? 'mine' : ''} ${underAttack ? 'attack' : myTurn && !dealing ? 'myturn' : ''}`}>
          {s.announce?.n !== muted && s.announce?.player === ME && <span key={s.announce.n} className="say">{s.announce.text}</span>}
          {/* El texto va en su propio span: dentro de la caja (flex) se perderían los espacios junto a los nombres. */}
          {text && <span className="msg"><span>{rich(text, names, colors, true)}</span></span>}
          {btns}
        </div>
        {/* Cartel de lo que me toca, debajo del aviso (sobre mis cartas): mi turno o algo contra mí. */}
        {underAttack ? <div className="turn-sign attack">⚠ {attackText}</div>
          : s.turn === ME && !dealing && ph.t !== 'over' && (myTurn || pendingPlayers(s).includes(ME)) ? <div className="turn-sign mine">Tu turno</div>
          : actionNeeded ? <div className="turn-sign act">Te toca decidir</div> : null}
      </div>


      {/* Mini historial: las últimas jugadas, encima de mi nombre. */}
      {!dealing && s.log.length > 1 && (
        <ol className="mini-log" aria-label="Últimas jugadas">
          {s.log.slice(-5).map((l, i, a) => <li key={s.log.length - a.length + i}>{rich(l.text, names, colors)}</li>)}
        </ol>
      )}
      <div className={`hand ${s.turn === ME && !dealing ? 'turn' : ''}`}>
        <div className="me-tag">
          <span className={`pill ${s.turn === ME && !dealing ? 'on' : ''} ${spin?.done && spin.cur === ME ? 'spin-glow' : ''}`} style={{ background: colors[ME], color: ink(colors[ME]), '--gc': colors[ME] } as React.CSSProperties}><HexIcon icon={icons[ME]} color={colors[ME]} size={46} />{me.name}<i>{shown(ME)}</i></span>
          {spin?.done && spin.cur === ME && <span className="start-tag" style={{ background: colors[ME], color: ink(colors[ME]) }}>¡Empiezas tú!</span>}
          {s.turn === ME && !dealing && ph.t !== 'over' && <span className="turn-tag" style={{ background: colors[ME], color: ink(colors[ME]), boxShadow: `0 0 18px ${colors[ME]}` }}>Tu turno</span>}
          {nextUp === ME && s.turn !== ME && !dealing && <span className="next-tag" style={{ borderColor: colors[ME] }}>Te toca después</span>}
          {!dealing && me.hand.length === 1 && ph.t !== 'over' && <span className="last-tag">¡Última carta!</span>}
          {isHost && <button className="foul" title="Anfitrión: señalarte una falta (robas 3)" onClick={() => send({ type: 'penalize', target: ME })}>+3</button>}
        </div>
        {me.egida && (
          <div className={`my-egida ${egidaAir.includes(me.egida.id) ? 'air' : ''}`} data-egida={ME} title="Tu Égida boca arriba: le queda 1 uso">
            <CardView card={me.egida} className="small" onHover={hoverHelp} />
            <small>Égida · 1 uso</small>
          </div>
        )}
        <div className="cards-row" data-anchor={`p${ME}`}>
          {sortedHand.map((c, i) => {
            // Carta que aún viene de camino: ya ocupa su hueco en la mano, pero no se ve hasta que aterriza.
            // En el reparto: la Maldición (a la derecha) llega primero; las demás, de izquierda a derecha.
            const coming = facedown ? (c.kind === 'maldicion' ? dealt[ME] < 1 : i >= dealt[ME] - 1) : hidden.includes(c.id);
            const act = coming ? null : cardAction(c);
            const drawn = ph.t === 'turn' && ph.drawn === c.id;
            return (
              <div
                key={c.id}
                data-card={c.id}
                className={`hc ${act ? 'playable' : ''} ${sel.includes(c.id) || myShown.includes(c.id) ? 'picked' : ''} ${myShown.includes(c.id) ? 'shown' : ''} ${(intro === 'out' || intro === 'in') && c.kind !== 'maldicion' ? `flip-${intro}` : intro === 'out' || intro === 'in' ? '' : hideFlip ? `flip-${hideFlip}` : turning[c.id] ? `flip-${turning[c.id]}` : ''} ${coming ? 'incoming' : ''} ${act?.label === 'Usar en Tinieblas' ? 'blind-use' : ''}`}
                style={{ marginLeft: i === 0 ? 0 : `calc(var(--card-w) * ${step - 1})`, transform: `rotate(${(i - mid) * Math.min(4, 30 / Math.max(n, 1))}deg) translateY(${Math.abs(i - mid) ** 1.7 * 1.6}px)`, zIndex: i }}
                onClick={act?.run}
              >
                <CardView card={c} back={(blind && !peeking && hideFlip !== 'out') || (facedown && c.kind !== 'maldicion') || turning[c.id] === 'out'} className={`${act ? '' : 'dim'} ${drawn ? 'drawn' : ''}`} badge={act?.label} onBadge={act?.alt} onInfo={setHelp} onHover={hoverHelp} />
              </div>
            );
          })}
          {/* Jugar juntas: copias idénticas seguidas, o Antitodo + Maldición en mi turno. */}
          {joinGroups.length > 0 && <JoinButtons groups={joinGroups} />}
          {/* Travesura: las cartas que ya he elegido dar siguen a la vista, levantadas y marcadas, hasta que se reparten. */}
          {ph.t === 'give' && ph.eff.given.filter((g) => g.from === ME).map((g, j) => (
            <div key={`give${g.card.id}`} className="hc given" style={{ marginLeft: n + j === 0 ? 0 : `calc(var(--card-w) * ${step - 1})`, zIndex: n + j }}>
              <CardView card={g.card} back={blind} badge={`Para ${name(ph.target)}`} onHover={hoverHelp} />
            </div>
          ))}
        </div>
      </div>

      {/* Anuncio de la carta jugada: quién, qué carta y qué hace, bajo la carta que se presenta en grande sobre la Pila. */}
      {/* Si me toca elegir color, el selector ocupa el sitio del cartel de la jugada (no se pisan). */}

      {/* Es el mismo componente durante la ronda y al acabar (misma clave): los brazos se quedan donde estaban
          (el que pierde, a medio camino) y se desvanecen juntos. */}
      {slapSpot && ph.t === 'aplastar'
        ? <SlapArms key={`slap${ph.win}`} live seed={ph.win} spot={slapSpot} slapping={slapping} slapped={ph.slapped} players={ph.players} colors={colors} />
        : slapLinger && <SlapArms key={`slap${slapLinger.win}`} live ending seed={slapLinger.win} spot={slapLinger.spot} slapping={false} slapped={slapLinger.slapped} players={slapLinger.players} colors={colors} />}
      {/* Al acabar la ronda, los brazos se quedan un momento sobre la ficha. */}
      {slapSpot && ph.t === 'aplastar' && (
        <button
          key={`diana${ph.win}`}
          className={`diana ${slapping ? 'hot' : 'done'}`}
          style={{ left: `${slapSpot.x}%`, top: `${slapSpot.y}%` }}
          disabled={!slapping}
          tabIndex={-1}
          // Solo con el ratón o el dedo: ni Espacio ni Intro sirven para librarse.
          onPointerDown={slapping ? (e) => { if (e.isTrusted && e.button === 0) send({ type: 'slap', player: ME }); } : undefined}
          onKeyDown={(e) => e.preventDefault()}
          onClick={(e) => e.preventDefault()}
          aria-label="Aplastar: púlsalo antes que nadie"
        >
          <img src={asset('icons/aplastar.webp')} alt="" draggable={false} />
        </button>
      )}
      {ph.t === 'adivinar' && ph.player !== ME && <AdivinarFx key={`adiv${ph.player}`} actor={ph.player} name={name(ph.player)} n={ph.cards.length} />}
      {countText && <div key={countText} className="count-big" aria-live="assertive">{countText}</div>}
      {/* Elegir color: flecha de los tres colores desde mi mano hasta las gemas, como un efecto dirigido. */}
      {tinte && !envFx && pickReady && <PickArrow />}
      {/* Quién actúa sobre quién: flechas desde que empieza el efecto hasta que acaba (una por cada lanzador). */}
      {!dealing && !finale && (() => {
        let pairs: [number, number][] = [];
        const to = (from: number, ts: number[]) => ts.forEach((t) => pairs.push([from, t]));
        if (ph.t === 'react' || ph.t === 'give') {
          const e = ph.eff;
          if (e.k === 'trav') {
            // Travesuras encadenadas o duplicadas: cada uno de los que dan carta, hacia quien la recibe.
            const t = ph.t === 'give' ? ph.target : e.targets[0];
            [...new Set(e.launchers)].forEach((l) => to(l, [t]));
          // Quien ya se ha protegido (Égida, Gema contra Cristalizar…) deja de estar en el punto de mira.
          } else to(e.source, ph.t === 'react' ? e.targets.filter((t) => !ph.exempt.includes(t)) : e.targets);
        } else if (ph.t === 'codicia') to(ph.launcher, [ph.target]);
        else if (ph.t === 'imanPick') to(ph.source, ph.targets);
        else if (ph.t === 'iman') to(ph.launcher, s.players.filter((x) => x.id !== ph.launcher && !x.out).map((x) => x.id));
        else if (ph.t === 'escarcha') to(ph.player, ph.targets);
        else if (ph.t === 'inutil' && ph.receive) to(s.turn, [ph.player]);
        pairs = pairs.filter(([f, t]) => f !== t && !s.players[t]?.out);
        if (!pairs.length) return null;
        return <ActionArrows pairs={pairs} colors={colors} />;
      })()}
      {/* Turno de otro jugador: se ilumina el borde de la pantalla por su lado. */}
      {!dealing && ph.t !== 'over' && s.turn !== ME && (() => {
        const i = rivals.findIndex((p) => p.id === s.turn);
        if (i < 0 || !seats[i]) return null;
        const [side, x] = seats[i];
        return <div key={`edge${s.turn}`} className={`turn-edge ${side}`} style={side === 'top' ? { left: `${x}%` } : undefined} />;
      })()}
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

      <HelpDock kind={helpKind} art={helpArt} ping={helpPing} setKind={setHelpKind} beta={!!cfg.beta} />
      {/* Barra del borde inferior: el tiempo para memorizar en Tinieblas o, si no, mi reloj de decisión. */}
      <div className={`edge ${peekTimer ? 'peek' : ''}`}><Countdown timer={peekTimer ?? timer} /></div>
      {blind && !peeking && !dealing && ph.t !== 'over' && (
        <div className="blind-hint" role="note"><Icon kind="tinieblas" size={16} /> Tinieblas: puedes usar una carta en cualquier momento; si fallas, robas 1.</div>
      )}

      {net && remote.status !== 'open' && <div className="net-banner" role="status">Reconectando…</div>}
      {net && rv && rv.waiting.length > 0 && ph.t !== 'over' && <WaitBox rv={rv} recvAt={remote.recvAt} isHost={isHost} decide={(p, how) => net.send({ t: 'drop', p, how })} />}
      {net && rv && rv.you >= 0 && rv.seats[rv.you]?.state === 'out' && ph.t !== 'over' && <div className="net-banner" role="status">Has quedado fuera de la partida: puedes seguir mirando.</div>}
      {spin && (
        <div className={`spin-box ${spin.done ? 'done' : ''}`} style={{ '--sc': colors[spin.cur], '--n': spin.reel.length } as React.CSSProperties} aria-live="polite">
          <small>{spin.done ? 'Empieza' : '¿Quién empieza?'}</small>
          {/* Ventana de la tragaperras (tamaño fijo): la tira baja y se para en quien empieza. */}
          <div className="reel-win" aria-label={spin.done ? `Empieza ${spin.cur === ME ? 'tú' : name(spin.cur)}` : undefined}>
            <div className="reel" style={{ transform: `translateY(${spin.go ? 0 : `calc(var(--rh) * ${-(spin.reel.length - 1)})`})`, transitionDuration: spin.go ? `${REEL_MS}ms` : '0ms' }}>
              {[...spin.reel].reverse().map((p, i) => (
                <b key={i} style={{ background: colors[p], color: ink(colors[p]) }}>{p === ME ? 'Tú' : name(p)}</b>
              ))}
            </div>
          </div>
          <span className="spin-dir" style={{ visibility: spin.done ? 'visible' : 'hidden' }}>{s.dir === 1 ? '↻' : '↺'} Sentido {s.dir === 1 ? 'horario' : 'antihorario'}</span>
        </div>
      )}
      {finale && s.winner !== null && <Finale name={s.winner === ME ? '¡Has ganado!' : `¡Gana ${name(s.winner)}!`} why={s.log.some((l) => l.text.includes('3 Rituales')) ? 'Reúne los 3 Rituales' : s.log.some((l) => l.text.includes('único que queda')) ? 'Es el único que queda' : 'Última carta'} color={colors[s.winner]} />}
      {ph.t === 'over' && !finale && !cfg.tutorial && <GameOver s={s} colors={colors} startedAt={startedAt.current} onExit={onExit} onRematch={net ? undefined : onRematch} onLobby={net ? () => net.send({ t: 'lobby' }) : undefined} />}
      {tutor.view && !finale && <TutorOverlay view={tutor.view} finished={ph.t === 'over'} onExit={onExit} />}
      {pause && ph.t !== 'over' && (
        <div className="pause" role="dialog" aria-label="Partida en pausa">
          <div className="pause-box">
            {pause === 'menu' ? (
              <>
                <h2>Pausa</h2>
                <p>{net ? 'Es una partida online: aunque tengas este menú abierto, la partida sigue.' : 'La partida está detenida: nadie juega y los tiempos no corren.'}</p>
                <button className="primary" onClick={() => setPause(null)}>Continuar</button>
                <button className="fs-only" onClick={toggleFullscreen}>Pantalla completa</button>
                <button onClick={() => { setPause(null); setComp(true); }}>Compendio</button>
                {(!net || isHost) && (
                  <label className="check pause-check">
                    <input type="checkbox" checked={timerOn} onChange={(e) => (net ? net.opts({ timer: e.target.checked }) : setLocalTimer(e.target.checked))} />
                    Tiempo máximo de 15 s para decidir{net ? ' (para todos)' : ''}
                  </label>
                )}
                {net && !isHost && <small className="pause-note">Tiempo máximo de 15 s: {timerOn ? 'activado' : 'desactivado'} (lo cambia el anfitrión).</small>}
                <button onClick={() => setPause('bug')}>Reportar un fallo</button>
                <button onClick={() => setPause('exit')}>Salir de la partida</button>
              </>
            ) : pause === 'bug' ? (
              <BugForm onDone={() => setPause(null)} onSend={async (text) => {
                if (net) { net.bug(text); return true; }
                const r = local.recording.current;
                return sendLocalBug({ playerId: playerId(), gameId: r?.id ?? null, mode: 'local', room: null, description: text, userAgent: navigator.userAgent, build: BUILD, state: s, recentActions: r?.actions.slice(-60) });
              }} />
            ) : (
              <>
                <h2>¿Salir de la partida?</h2>
                <p>{net ? 'Una máquina jugará por ti el resto de la partida.' : 'Se perderá la partida en curso.'}</p>
                <button className="danger" onClick={() => { if (!net) local.abandon(); onExit(); }}>Sí, salir</button>
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

/** Reportar un fallo: qué ha pasado, contado por el jugador. Se envía junto con el estado de la partida y sus últimas jugadas. */
function BugForm({ onSend, onDone }: { onSend: (text: string) => Promise<boolean>; onDone: () => void }) {
  const [text, setText] = useState('');
  const [st, setSt] = useState<'edit' | 'sending' | 'ok' | 'fail'>('edit');
  if (st === 'ok') return (
    <>
      <h2>¡Gracias!</h2>
      <p>Hemos recibido tu reporte junto con el estado de la partida y las últimas jugadas.</p>
      <button className="primary" onClick={onDone}>Volver a la partida</button>
    </>
  );
  return (
    <>
      <h2>Reportar un fallo</h2>
      <p>Cuéntanos qué ha pasado (qué esperabas y qué ha ocurrido). Se enviará también el estado de la partida y las últimas jugadas.</p>
      <textarea className="bug-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} rows={5} placeholder="Por ejemplo: he jugado un Reflejo contra una Codicia y…" autoFocus />
      {st === 'fail' && <small className="pause-note">No se ha podido enviar. Inténtalo de nuevo en un momento.</small>}
      <button className="primary" disabled={!text.trim() || st === 'sending'} onClick={async () => { setSt('sending'); setSt((await onSend(text.trim())) ? 'ok' : 'fail'); }}>{st === 'sending' ? 'Enviando…' : 'Enviar'}</button>
      <button onClick={onDone}>Cancelar</button>
    </>
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
    // Crece en su sitio (no viaja al centro), lo justo para que se vea bien y siga entera en la pantalla.
    const hw0 = tri.width / 2, hh0 = tri.height / 2;
    const tcx = tri.left + hw0, tcy = tri.top + hh0;
    const room = Math.min(tcx, window.innerWidth - tcx, tcy, window.innerHeight - tcy - 70);
    const s = Math.max(1.12, Math.min(1.45, (room - 12) / Math.max(hw0, hh0)));
    const cx = tcx, cy = tcy;
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

// ───────────────────────── flechas de acción ─────────────────────────

/**
 * Flechas curvas del color de quien actúa, desde su sitio hasta cada jugador al que afecta su carta (`pairs`: [de, a]).
 * Se curvan hacia el centro de la mesa; si van de un lado al otro, por arriba.
 */
function ActionArrows({ pairs, colors }: { pairs: [number, number][]; colors: string[] }) {
  const [paths, setPaths] = useState<{ d: string; color: string }[]>([]);
  const sig = pairs.map((p) => p.join('>')).join(',');
  useLayoutEffect(() => {
    const place = () => {
      const pile = anchorRect('pile');
      // Todo dentro de la pantalla (los abanicos de los lados se salen un poco por el borde).
      const W = window.innerWidth, H = window.innerHeight, M = 36;
      const fit = (x: number, y: number) => ({ x: Math.max(M, Math.min(W - M, x)), y: Math.max(M, Math.min(H - M, y)) });
      const pt = (p: number) => {
        const r = anchorRect(p);
        if (!r) return null;
        // Mi sitio es la fila de mi mano: la flecha sale o llega a su borde de arriba.
        return p === ME ? fit(r.left + r.width / 2, r.top + 10) : fit(r.left + r.width / 2, r.top + r.height / 2);
      };
      if (!pile) return setPaths([]);
      const cx = pile.left + pile.width / 2, cy = pile.top + pile.height / 2;
      const disc = document.querySelector('.disc')?.getBoundingClientRect();
      /** Zona que ocupan las cartas de cada jugador (con margen), para que la flecha no empiece ni acabe debajo. */
      const zone = (p: number) => {
        const r = p === ME ? document.querySelector('.cards-row')?.getBoundingClientRect() : anchorRect(p);
        return r ? { l: r.left - 14, t: r.top - 14, r: r.right + 14, b: r.bottom + 14 } : null;
      };
      const inside = (z: { l: number; t: number; r: number; b: number }, p: { x: number; y: number }) => p.x > z.l && p.x < z.r && p.y > z.t && p.y < z.b;
      setPaths(pairs.map(([f, t]) => {
        const a = pt(f), b = pt(t);
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        let qx: number, qy: number;
        if (Math.abs(dx) > Math.abs(dy) * 1.5) {
          // De un lado al otro: arco por encima de la mesa.
          qx = mx;
          qy = my - Math.max(140, dist * 0.42);
          // Que el punto más alto del arco quede dentro de la pantalla (a unos 40 px del borde de arriba).
          qy = Math.max(qy, 80 - (a.y + b.y) / 2);
        } else {
          // Hacia el centro de la mesa, con una curva mínima para que nunca vaya recta.
          qx = mx + (cx - mx) * 0.55;
          qy = my + (cy - my) * 0.55;
          const off = Math.hypot(qx - mx, qy - my);
          if (off < dist * 0.22) {
            const nx = -dy / dist, ny = dx / dist;
            qx = mx + nx * dist * 0.22;
            qy = my + ny * dist * 0.22;
          }
        }
        ({ x: qx, y: qy } = fit(qx, qy));
        // Si la curva pasaría por detrás del círculo central (p. ej. de mi mano al jugador de arriba), lo rodea:
        // tramo recto tangente, arco pegado al círculo por el lado con más hueco y tramo recto hasta el destino.
        if (disc) {
          const C = { x: disc.left + disc.width / 2, y: disc.top + disc.height / 2 }, R = disc.width / 2;
          const hits = Array.from({ length: 17 }, (_, i) => (i + 2) / 20).some((t) => {
            const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * qx + t * t * b.x;
            const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * qy + t * t * b.y;
            return Math.hypot(x - C.x, y - C.y) < R + 6;
          });
          const R2 = R + 30, da = Math.hypot(a.x - C.x, a.y - C.y);
          // El destino demasiado cerca del círculo (pantallas bajas): se aleja un poco hacia fuera.
          let db = Math.hypot(b.x - C.x, b.y - C.y);
          if (hits && db < R2 + 50) {
            const dirx = db ? (b.x - C.x) / db : 0, diry = db ? (b.y - C.y) / db : -1;
            const side0 = Math.abs(dirx) < 0.2 ? (window.innerWidth - C.x > C.x ? 1 : -1) : Math.sign(dirx);
            // Se lleva hacia el lado por el que va a rodear, a la altura del destino.
            b.x = C.x + side0 * Math.sqrt(Math.max(0, (R2 + 60) ** 2 - (b.y - C.y) ** 2));
            void diry;
            db = Math.hypot(b.x - C.x, b.y - C.y);
          }
          if (hits && da > R2 + 20 && db > R2 + 20) {
            const ta = Math.atan2(a.y - C.y, a.x - C.x), tb = Math.atan2(b.y - C.y, b.x - C.x);
            const fa = Math.acos(R2 / da), fb = Math.acos(R2 / db);
            // Por qué lado rodear: entre dos rivales (de un lado a otro), siempre por ARRIBA del círculo, para no cruzarse
            // con las flechas que bajan hacia mi mano; si interviene mi mano, por el lado del otro jugador.
            const TAU0 = Math.PI * 2;
            const midY = (sd: number) => {
              const u1 = sd > 0 ? ta - fa : ta + fa, u2 = sd > 0 ? tb + fb : tb - fb;
              const sp = (((sd > 0 ? u1 - u2 : u2 - u1) % TAU0) + TAU0) % TAU0;
              return Math.sin(sd > 0 ? u1 - sp / 2 : u1 + sp / 2);
            };
            const side = f !== ME && t !== ME ? (midY(1) <= midY(-1) ? 1 : -1)
              : b.x - C.x > 8 ? 1 : b.x - C.x < -8 ? -1 : (window.innerWidth - C.x) > C.x ? 1 : -1;
            // Por la derecha se recorre en sentido antihorario (ángulos decrecientes); por la izquierda, al revés.
            const t1 = side > 0 ? ta - fa : ta + fa, t2 = side > 0 ? tb + fb : tb - fb;
            const P = (t: number) => ({ x: C.x + R2 * Math.cos(t), y: C.y + R2 * Math.sin(t) });
            const T1 = P(t1), T2 = P(t2);
            const TAU = Math.PI * 2;
            const span = (((side > 0 ? t1 - t2 : t2 - t1) % TAU) + TAU) % TAU;
            const sx = a.x + (T1.x - a.x) * 0.12, sy = a.y + (T1.y - a.y) * 0.12;
            // El último tramo acaba donde entra en las cartas del destino (o, como poco, un poco antes de él).
            const rb = zone(t);
            let u = 1;
            const at = (k: number) => ({ x: T2.x + (b.x - T2.x) * k, y: T2.y + (b.y - T2.y) * k });
            while (u > 0.2 && rb && inside(rb, at(u))) u -= 0.02;
            u = Math.min(u, 0.85);
            const ex = at(u).x, ey = at(u).y;
            const f2 = (n: number) => n.toFixed(1);
            return { d: `M ${f2(sx)} ${f2(sy)} L ${f2(T1.x)} ${f2(T1.y)} A ${R2} ${R2} 0 ${span > Math.PI ? 1 : 0} ${side > 0 ? 0 : 1} ${f2(T2.x)} ${f2(T2.y)} L ${f2(ex)} ${f2(ey)}`, color: colors[f] };
          }
        }
        // Empieza y acaba FUERA de las cartas de cada jugador (las flechas van por debajo de todo: si la punta cayera
        // encima de su abanico, quedaría tapada). Se recorre la curva y se corta donde sale de una y entra en la otra.
        const Q = (t: number) => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * qx + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * qy + t * t * b.y });
        const ra = zone(f), rb = zone(t);
        let t0 = 0, t1 = 1;
        while (t0 < 0.45 && ra && inside(ra, Q(t0))) t0 += 0.01;
        while (t1 > 0.55 && rb && inside(rb, Q(t1))) t1 -= 0.01;
        t0 = Math.max(t0, 0.06); t1 = Math.min(t1, 0.97);
        const pts = Array.from({ length: 33 }, (_, i) => Q(t0 + ((t1 - t0) * i) / 32));
        return { d: `M ${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`, color: colors[f] };
      }).filter((x): x is { d: string; color: string } => !!x));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  if (!paths.length) return null;
  return (
    <svg className="action-arrows" aria-hidden="true">
      <defs>
        {paths.map((p, i) => (
          <marker key={i} id={`aa-head-${i}`} viewBox="-2 -2 14 14" refX="3" refY="5" markerWidth="5.6" markerHeight="5.6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={p.color} className="aa-head" />
          </marker>
        ))}
      </defs>
      {paths.map((p, i) => (
        <g key={i}>
          {/* Guía tenue del mismo color, por debajo de los trazos que avanzan (en vez de un fondo negro). */}
          <path d={p.d} className="aa-track" stroke={p.color} />
          <path d={p.d} className="aa-line" stroke={p.color} markerEnd={`url(#aa-head-${i})`} />
        </g>
      ))}
    </svg>
  );
}

/** Flecha curva (amarillo, morado y verde) desde mi mano hasta las gemas para elegir color. */
function PickArrow() {
  const [d, setD] = useState('');
  useLayoutEffect(() => {
    const place = () => {
      const hand = document.querySelector('.cards-row')?.getBoundingClientRect();
      const gems = document.querySelector('.gem-under')?.getBoundingClientRect();
      if (!hand || !gems) return setD('');
      const row = document.querySelector('.gem-under .gem-pick')?.getBoundingClientRect() ?? gems;
      const sx = hand.left + hand.width / 2, sy = hand.top + 6;
      // Llega al lado izquierdo de la fila de gemas, a media altura.
      const ex = row.left - 30, ey = row.top + row.height / 2 + 12;
      // Curva: sube primero y entra hacia las gemas por la izquierda.
      const qx = Math.min(sx, ex) + (Math.abs(ex - sx)) * 0.35, qy = ey + (sy - ey) * 0.15;
      setD(`M ${sx} ${sy} Q ${qx} ${qy} ${ex} ${ey}`);
    };
    // Las gemas entran con una animación: se mide cuando ha terminado.
    const id = window.setTimeout(place, 450);
    window.addEventListener('resize', place);
    return () => { clearTimeout(id); window.removeEventListener('resize', place); };
  }, []);
  if (!d) return null;
  return (
    <svg className="action-arrows pick-arrow" aria-hidden="true">
      <defs>
        <linearGradient id="pick-g" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#f5c767" /><stop offset="0.5" stopColor="#946cab" /><stop offset="1" stopColor="#72bf8c" />
        </linearGradient>
        <marker id="pick-head" viewBox="-2 -2 14 14" refX="3" refY="5" markerWidth="5.6" markerHeight="5.6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#72bf8c" className="aa-head" />
        </marker>
      </defs>
      <path d={d} className="aa-track" stroke="url(#pick-g)" />
      <path d={d} className="aa-line" stroke="url(#pick-g)" markerEnd="url(#pick-head)" />
    </svg>
  );
}

// ───────────────────────── jugar juntas ─────────────────────────

/**
 * Botones «Jugar juntas» en medio de cada grupo de cartas de mi mano que se puede echar a la vez. Al pasar el
 * ratón se levantan las cartas del grupo; si se pulsa una carta en vez del botón, se echa sola.
 */
function JoinButtons({ groups }: { groups: { ids: string[]; run: () => void }[] }) {
  const [pos, setPos] = useState<{ x: number; y: number }[]>([]);
  const sig = groups.map((g) => g.ids.join('+')).join(',');
  useLayoutEffect(() => {
    const place = () => {
      const row = document.querySelector('.cards-row')?.getBoundingClientRect();
      if (!row) return;
      setPos(groups.map((g) => {
        const rs = g.ids.map((id) => document.querySelector(`[data-card="${id}"]`)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r);
        if (!rs.length) return { x: -9999, y: 0 };
        const left = Math.min(...rs.map((r) => r.left)), right = Math.max(...rs.map((r) => r.right));
        const top = Math.min(...rs.map((r) => r.top)), bottom = Math.min(window.innerHeight, Math.max(...rs.map((r) => r.bottom)));
        return { x: (left + right) / 2 - row.left, y: (top + bottom) / 2 - row.top };
      }));
    };
    // El abanico se recoloca con una transición: se mide al empezar y cuando ha terminado.
    place();
    const id = window.setTimeout(place, 320);
    window.addEventListener('resize', place);
    return () => { clearTimeout(id); window.removeEventListener('resize', place); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const lift = (ids: string[], on: boolean) => ids.forEach((id) => document.querySelector(`[data-card="${id}"]`)?.classList.toggle('join-lift', on));
  return (
    <>
      {groups.map((g, i) => pos[i] && (
        <button key={g.ids.join('+')} className="join-btn" style={{ left: pos[i].x, top: pos[i].y }}
          onMouseEnter={() => lift(g.ids, true)} onMouseLeave={() => lift(g.ids, false)}
          onClick={(e) => { e.stopPropagation(); lift(g.ids, false); g.run(); }}>
          Jugar juntas
        </button>
      ))}
    </>
  );
}

// ───────────────────────── brazos de Aplastar ─────────────────────────

/** Mano vectorizada (zona de piel calcada del dibujo de Aplastar, 96×96); el borde negro lo pone el trazo, por fuera. */
const HAND_PATH = 'M40.5 4.9L42.3 4.4L44.3 5.8L50 36.1L51 36.2L51.2 35.8L59.7 9.8L60.8 8.6L63.2 8.6L64 9L64.5 10.3L58.6 39.8L58.9 40.4L60 40L75.8 24.6L77.8 24.2L78.9 25.1L79.1 26L64.7 48.3L63.4 59.3L60.5 67.8L60.6 69.8L70.2 94.9L69.8 95.3L68.3 95.4L48.9 95.3L47.8 93.2L46.9 89.8L43.5 74.8L42.3 72.9L37.1 66.7L22.6 60.1L14.9 50L14.9 49L15.9 47.5L16.9 46.7L18.3 46.6L19 46.9L23.8 51.5L29.3 54.6L30.3 54.1L33.6 48.8L33.4 47.3L22.2 18.3L22.4 16.8L23.8 15.5L26.2 15.9L39.7 39.1L40.5 39.1L40.4 30.3L38.9 6.9Z';
/** Medidas del dibujo: muñeca en (59.5, 95), ancho de muñeca ≈ 30 de 96 y el antebrazo entra inclinado ~18°. */
const WRIST = { x: 59.5, y: 96 }, WRIST_W = 29.5 / 96, HAND_ANG = (Math.atan2(-20, -6.5) * 180) / Math.PI;
const HAND_PX = 170;
/** Grosor del brazo a lo largo (0 = hombro, 1 = muñeca), en múltiplos del ancho de la muñeca. */
const ARM_PROFILE: [number, number][] = [[0, 2.3], [0.55, 1.9], [0.9, 1.22], [1, 1]];
const armWidth = (u: number) => {
  for (let i = 1; i < ARM_PROFILE.length; i++) {
    const [a, wa] = ARM_PROFILE[i - 1], [b, wb] = ARM_PROFILE[i];
    if (u <= b) return wa + ((wb - wa) * (u - a)) / (b - a);
  }
  return 1;
};
type Pt = { x: number; y: number };
/** Silueta del brazo: línea central redondeada en el codo y grosor variable; `tip` px finales entran en la muñeca. */
function armShape(o: Pt, e: Pt, w: Pt, W: number, tip: number) {
  const L = (p: Pt, q: Pt, k: number) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  const a = L(o, e, 0.86), b = L(e, w, 0.14);
  const pts: Pt[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) pts.push(L(o, a, i / N));
  for (let i = 1; i < N; i++) { const k = i / N; pts.push(L(L(a, e, k), L(e, b, k), k)); }
  for (let i = 0; i <= N; i++) pts.push(L(b, w, i / N));
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const tot = acc[acc.length - 1] || 1;
  const left: Pt[] = [], right: Pt[] = [];
  pts.forEach((p, i) => {
    const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(pts.length - 1, i + 1)];
    const dx = q1.x - q0.x, dy = q1.y - q0.y, l = Math.hypot(dx, dy) || 1;
    const toEnd = tot - acc[i];
    const k = toEnd < tip ? 0.8 + 0.2 * (toEnd / tip) : 1;
    const hw = (W * k * armWidth(Math.min(1, acc[i] / Math.max(1, tot - tip)))) / 2;
    left.push({ x: p.x - (dy / l) * hw, y: p.y + (dx / l) * hw });
    right.push({ x: p.x + (dy / l) * hw, y: p.y - (dx / l) * hw });
  });
  const f = (p: Pt) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  return { fill: `M ${left.map(f).join(' L ')} L ${[...right].reverse().map(f).join(' L ')} Z` };
}

/**
 * Un brazo con su mano, del color del jugador y con borde negro, desde `o` (su lado de la pantalla) hasta que la
 * palma cae en `t`, con un codo que gira un poco hacia un lado.
 */
function Arm({ o, t, color, slam, side = 1 }: { o: Pt; t: Pt; color: string; slam?: boolean; side?: 1 | -1 }) {
  const H = HAND_PX, B = (H * 2.5) / 96, W = WRIST_W * H - 2 * B;
  const dx = t.x - o.x, dy = t.y - o.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const bend = Math.min(90, len * 0.16) * side;
  const e = { x: o.x + dx * 0.55 + nx * bend, y: o.y + dy * 0.55 + ny * bend };
  const fl = Math.hypot(t.x - e.x, t.y - e.y) || 1, ux = (t.x - e.x) / fl, uy = (t.y - e.y) / fl;
  // La palma cae en t; la muñeca queda antes, en la línea del antebrazo.
  const w = { x: t.x - ux * 0.5 * H, y: t.y - uy * 0.5 * H };
  const ang = (Math.atan2(uy, ux) * 180) / Math.PI - HAND_ANG;
  // El brazo va ENCIMA de la mano y entra un poco en ella para tapar el borde de la muñeca (contorno solo en los lados).
  const tip = H * 0.16;
  const shape = armShape(o, e, { x: w.x + ux * tip, y: w.y + uy * tip }, W, tip);
  const hand = `translate(${w.x} ${w.y}) rotate(${ang}) scale(${H / 96}) translate(${-WRIST.x} ${-WRIST.y})`;
  // Mano y brazo como una sola pieza: primero los contornos de ambos y luego los rellenos encima (sin raya en la unión).
  return (
    <g className={`arm ${slam ? 'slam' : ''}`}>
      {/* Sombra: la misma silueta desplazada (mucho más barata que un filtro). */}
      <g className="arm-shadow" transform="translate(0 6)">
        <path d={HAND_PATH} transform={hand} fill="#000" stroke="#000" strokeWidth={5} />
        <path d={shape.fill} fill="#000" stroke="#000" strokeWidth={2 * B} />
      </g>
      <path d={HAND_PATH} transform={hand} fill="none" stroke="#0a0e10" strokeWidth={5} strokeLinejoin="miter" strokeMiterlimit={3} />
      <path d={shape.fill} fill="none" stroke="#0a0e10" strokeWidth={2 * B} strokeLinejoin="round" />
      <path d={HAND_PATH} transform={hand} fill={color} />
      <path d={shape.fill} fill={color} />
    </g>
  );
}

/**
 * Aplastar: mi mano sigue al cursor, unida por un brazo que sale del centro de mis cartas (borde de abajo);
 * cuando pulso, se queda plantada en la ficha. Los rivales que ponen la mano estiran el brazo desde su lado.
 */
function SlapArms({ spot, slapping, slapped, players, colors, live = false, ending = false, seed = 0 }: { spot: Pt; slapping: boolean; slapped: number[]; players: number[]; colors: string[]; live?: boolean; ending?: boolean; seed?: number }) {
  const [cur, setCur] = useState<Pt | null>(null);
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!slapping) return;
    const mv = (e: PointerEvent) => setCur({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', mv);
    return () => window.removeEventListener('pointermove', mv);
  }, [slapping]);
  useEffect(() => {
    const rs = () => redraw((n) => n + 1);
    window.addEventListener('resize', rs);
    return () => window.removeEventListener('resize', rs);
  }, []);
  // Mientras dura la ronda, los brazos de los rivales que aún no han pulsado se mueven solos (cada fotograma).
  const t0 = useRef(performance.now());
  const waiting = live ? players.filter((p) => p !== ME && !slapped.includes(p)) : [];
  useEffect(() => {
    if (!waiting.length && !ending) return;
    let id = 0;
    const step = () => { redraw((n) => n + 1); id = requestAnimationFrame(step); };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [waiting.length, ending]);
  /** Dónde estaba la mano de cada rival al pulsar, y cuándo: para que el golpe salga desde ahí. */
  const hits = useRef<Record<number, { from: Pt; at: number }>>({});
  const last = useRef<Record<number, Pt>>({});
  // Al acabar la ronda, los que no pulsaron se quedan quietos donde estaban.
  const frozen = useRef(0);
  const game = document.querySelector('.game')?.getBoundingClientRect();
  if (!game) return null;
  const W = window.innerWidth, H = window.innerHeight;
  if (ending && !frozen.current) frozen.current = performance.now();
  const now = performance.now();
  const hoverNow = ending ? frozen.current : now;
  /** Al acabar: un momento quietos y luego cada brazo se retira hacia su borde (0 → 1). */
  const back = ending ? (() => { const k = Math.min(1, Math.max(0, (now - frozen.current - 800) / 650)); return k * k; })() : 0;
  const retire = (o: Pt, t: Pt): Pt => (back ? { x: t.x + (o.x - t.x) * back, y: t.y + (o.y - t.y) * back } : t);
  const token = { x: game.left + (spot.x / 100) * game.width, y: game.top + (spot.y / 100) * game.height };
  // Origen de cada brazo: el centro de sus cartas, pegado al borde de la pantalla.
  const origin = (p: number): Pt | null => {
    if (p === ME) {
      const r = document.querySelector('.cards-row')?.getBoundingClientRect();
      return { x: r ? r.left + r.width / 2 : W / 2, y: H + 30 };
    }
    const r = anchorRect(p);
    if (!r) return null;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    // Se lleva al borde más cercano (fuera de la pantalla, para que el brazo «entre»).
    const dl = x, dr = W - x, dt = y;
    const m = Math.min(dl, dr, dt);
    return m === dl ? { x: -30, y } : m === dr ? { x: W + 30, y } : { x, y: -30 };
  };
  /** Dónde cae la mano de cada uno sobre la ficha (desplazadas para que no se tapen del todo). */
  const landing = (p: number, i: number): Pt => {
    if (p === ME) return token;
    const a = ((i * 137) % 360) * (Math.PI / 180);
    return { x: token.x + Math.cos(a) * 34, y: token.y + Math.sin(a) * 34 };
  };
  /**
   * Recorrido simulado de un rival que aún no ha pulsado: entra desde su borde y se va acercando a la ficha a
   * trompicones, con titubeos y vaivenes. Cada jugador tiene su ritmo, su amplitud y su forma de dudar.
   */
  const hover = (p: number, o: Pt): Pt => {
    const r = (k: number) => { const x = Math.sin((p + 1) * 12.9898 + (seed + k) * 78.233) * 43758.5453; return x - Math.floor(x); };
    const t = (hoverNow - t0.current) / 1000;
    const dx = token.x - o.x, dy = token.y - o.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
    // Avance: se acerca rápido al principio y luego se queda rondando entre el 55 % y el 85 % del camino.
    const reach = 0.55 + r(1) * 0.3;
    const speed = 0.7 + r(2) * 1.4;
    let f = 0.12 + (reach - 0.12) * (1 - Math.exp(-t * speed));
    // Titubeos: amagos hacia delante y retiradas.
    f += Math.sin(t * (1.6 + r(3) * 2.2) + r(4) * 6.3) * 0.06 + Math.sin(t * (4 + r(5) * 3) + r(6) * 6.3) * 0.025;
    // Vaivén lateral, más amplio cuanto más lejos está.
    const amp = (40 + r(7) * 70) * (1.1 - f);
    const lat = Math.sin(t * (0.9 + r(8) * 1.5) + r(9) * 6.3) * amp + Math.sin(t * (2.7 + r(10) * 2) + r(11) * 6.3) * amp * 0.3;
    return { x: o.x + ux * d * f + nx * lat, y: o.y + uy * d * f + ny * lat };
  };
  const arms: React.ReactNode[] = [];
  slapped.forEach((p, i) => {
    const o = origin(p);
    if (!o) return;
    const goal = landing(p, i);
    let t = goal;
    // El golpe sale de donde estaba su mano (si la estábamos moviendo) y llega en un instante.
    if (p !== ME && live) {
      if (!hits.current[p]) hits.current[p] = { from: last.current[p] ?? goal, at: now };
      const h = hits.current[p];
      const k = Math.min(1, (now - h.at) / 140);
      const e = 1 - (1 - k) * (1 - k);
      t = { x: h.from.x + (goal.x - h.from.x) * e, y: h.from.y + (goal.y - h.from.y) * e };
      if (k < 1) requestAnimationFrame(() => redraw((n) => n + 1));
    }
    arms.push(<Arm key={`a${p}`} o={o} t={retire(o, t)} color={colors[p]} slam={!live || p === ME} side={i % 2 ? -1 : 1} />);
  });
  waiting.forEach((p, i) => {
    const o = origin(p);
    if (!o) return;
    const t = hover(p, o);
    last.current[p] = t;
    arms.push(<Arm key={`a${p}`} o={o} t={retire(o, t)} color={colors[p]} side={(slapped.length + i) % 2 ? -1 : 1} />);
  });
  // Mi brazo sigue al cursor; si la ronda acaba sin que haya pulsado (pierdo), se retira desde donde estaba.
  if (cur && players.includes(ME) && !slapped.includes(ME) && (slapping || ending)) arms.push(<Arm key="me" o={origin(ME)!} t={retire(origin(ME)!, cur)} color={colors[ME]} side={cur.x < W / 2 ? 1 : -1} />);
  if (!arms.length) return null;
  return <svg className={`slap-arms ${ending ? 'ending' : ''}`} aria-hidden="true">{arms}</svg>;
}

// ───────────────────────── final ─────────────────────────

/** Lo que dura el final a cámara lenta antes de que salga el resumen de la partida. */
const FINALE_MS = 6200;
/** Lo que tarda en pararse la tragaperras del principio. */
const REEL_MS = 3800;

/** Final épico: bandas de cine, la mesa se oscurece y aparece el ganador. */
function Finale({ name, why, color }: { name: string; why: string; color: string }) {
  return (
    <div className="finale" style={{ '--wc': color } as React.CSSProperties} role="status" aria-live="assertive">
      <i className="finale-bar top" />
      <i className="finale-bar bottom" />
      <div className="finale-burst" />
      <div className="finale-text">
        <small>{why}</small>
        <b>{name}</b>
      </div>
    </div>
  );
}

// ───────────────────────── Adivinar ─────────────────────────

/** Lo que ven los demás cuando alguien adivina: 3 cartas salen del Mazo y flotan junto a él, con un halo mágico. */
function AdivinarFx({ actor, name, n }: { actor: number; name: string; n: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const deck = anchorRect('deck');
    const seat = anchorRect(actor);
    const pile = anchorRect('pile');
    if (!el || !deck || !seat || !pile) return;
    // Entre el jugador y el centro de la mesa (pegado a su asiento quedaría fuera de la pantalla).
    const sx = seat.left + seat.width / 2, sy = seat.top + seat.height / 2;
    const x = sx + (pile.left + pile.width / 2 - sx) * 0.42, y = sy + (pile.top + pile.height / 2 - sy) * 0.42;
    Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
    el.style.setProperty('--fx', `${deck.left + deck.width / 2 - x}px`);
    el.style.setProperty('--fy', `${deck.top + deck.height / 2 - y}px`);
  }, [actor]);
  return (
    <div ref={ref} className="adiv" aria-live="polite">
      <div className="adiv-aura" />
      <div className="adiv-cards">
        {Array.from({ length: n }, (_, i) => (
          <img key={i} src={asset('cards/back.webp')} alt="" style={{ '--i': i, '--r': `${(i - (n - 1) / 2) * 14}deg` } as React.CSSProperties} />
        ))}
      </div>
      <span className="adiv-label">🔮 {name} adivina el futuro…</span>
    </div>
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

function GameOver({ s, colors, startedAt, onExit, onRematch, onLobby }: { s: GameState; colors: string[]; startedAt: number; onExit: () => void; onRematch?: () => void; onLobby?: () => void }) {
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
    // Los acentos de la pantalla de fin, del color del ganador.
    <div className="over" role="dialog" aria-label="Fin de la partida" style={{ '--wc': colors[w] } as React.CSSProperties}>
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
                <div key={title} style={{ borderTopColor: colors[p] }}>
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
                    <span className="who" style={{ borderColor: colors[p] }}>
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
            {s.log.map((l, i) => <li key={i}><span>{i + 1}</span><p>{rich(l.text, names, colors)}</p></li>)}
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
  const cfg: GameConfig = { name: g.players[v.you].name, players: g.players.length, level: v.opts.level, extraCurses: v.opts.extraCurses, condena: v.opts.condena, beta: v.opts.beta, timer: v.opts.timer !== false };
  // Los avisos van en la misma posición en la sala y en la mesa, así no se pierden al cambiar de una a otra.
  return <><Game key={`${v.code}:${v.round}`} cfg={cfg} net={client} onExit={() => { client.leave(); onExit(); }} /><NetToasts client={client} /></>;
}

/** Partida del tutorial: 4 jugadores, sin tiempo máximo, con mi nombre y mi color guardados. */
const tutorialCfg = (): GameConfig => {
  let name = '', color = 0, icon: string | undefined;
  try { name = localStorage.getItem('maldiciones:nombre') ?? ''; color = Number(localStorage.getItem('maldiciones:color')) || 0; icon = localStorage.getItem('maldiciones:icono') ?? undefined; } catch { /* sin almacenamiento */ }
  return { name: name || 'Tú', players: 4, level: 1, extraCurses: false, condena: false, beta: false, timer: false, color, icon, tutorial: true };
};

type Screen = { k: 'account' } | { k: 'home' } | { k: 'setup' } | { k: 'local'; cfg: GameConfig; n: number } | { k: 'entry'; code?: string; error?: string | null } | { k: 'room'; client: NetClient };

export default function App() {
  const q = new URLSearchParams(location.search);
  const [screen, setScreen] = useState<Screen>(() => {
    // ?sala=ABCD abre directamente la entrada online con el código puesto (enlace de invitación).
    const sala = q.get('sala')?.toUpperCase();
    if (sala && /^[A-Z]{4}$/.test(sala)) return { k: 'entry', code: sala };
    // ?demo=5 arranca directamente una partida de 5 jugadores (útil para probar).
    const demo = Number(q.get('demo'));
    if (q.has('tutorial')) return { k: 'local', n: 0, cfg: tutorialCfg() };
    if (demo >= 3 && demo <= 6) return { k: 'local', n: 0, cfg: { name: 'Tú', players: demo, level: 1, extraCurses: false, condena: true, debugHand: q.get('mano')?.split(','), debugSolo: q.has('solo'), debugBot: q.get('bot')?.split(','), beta: q.has('beta'), debug: true } };
    return { k: 'home' };
  });
  const home = useCallback(() => {
    // Se quita ?sala= de la dirección para no volver a entrar al recargar.
    if (location.search) history.replaceState(null, '', location.pathname);
    setScreen({ k: 'home' });
  }, []);
  const leaveRoom = useCallback((error?: string) => setScreen({ k: 'entry', error }), []);
  const acc = useAccount();
  useEffect(() => { void initAccount(); }, []);
  // Antes de los menús: comprobar la sesión; sin sesión ni invitado, la pantalla de entrada; con cuenta nueva, el perfil.
  // (Las partidas abiertas por enlace de prueba —tutorial, ?demo— no pasan por aquí.)
  if (screen.k === 'home' || screen.k === 'setup' || screen.k === 'entry' || screen.k === 'account') {
    if (acc.status === 'loading') return <Shell><p className="tagline">Cargando…</p></Shell>;
    if (acc.status === 'out') return <Shell><EntryScreen /></Shell>;
    if (acc.status === 'in' && acc.profile === undefined) return <Shell><p className="tagline">Cargando tu cuenta…</p></Shell>;
    if (acc.status === 'in' && acc.profile === null) return <Shell><ProfileScreen first /></Shell>;
    if (acc.status === 'guest' && !acc.guest) return <Shell><GuestScreen /></Shell>;
  }
  switch (screen.k) {
    case 'account':
      return <Shell>{acc.status === 'guest' ? <GuestScreen onDone={home} /> : <ProfileScreen onDone={home} />}</Shell>;
    case 'home':
      return <Shell><Home onLocal={() => setScreen({ k: 'setup' })} onOnline={() => setScreen({ k: 'entry' })} onTutorial={() => setScreen({ k: 'local', n: 0, cfg: tutorialCfg() })} onAccount={() => setScreen({ k: 'account' })} /></Shell>;
    case 'setup':
      return <Shell><LocalSetup onBack={home} onStart={(cfg) => setScreen({ k: 'local', cfg, n: 0 })} onAccount={() => setScreen({ k: 'account' })} /></Shell>;
    case 'entry':
      return <Shell><OnlineEntry initialCode={screen.code} initialError={screen.error} onBack={home} onJoin={(code, name) => setScreen({ k: 'room', client: new NetClient(code, name) })} onAccount={() => setScreen({ k: 'account' })} /></Shell>;
    case 'room':
      return <OnlineRoom client={screen.client} onExit={leaveRoom} />;
    case 'local':
      setMe(0);
      return <Game key={screen.n} cfg={screen.cfg} onExit={home} onRematch={() => setScreen({ ...screen, n: screen.n + 1 })} />;
  }
}
