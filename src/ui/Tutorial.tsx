// Tutorial guiado: la partida es normal, pero en cada paso aparece un mensaje (al estilo de una visita guiada)
// que señala una parte de la mesa y, si pide hacer algo, solo deja hacer eso.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Color, Kind } from '../game/cards';
import { Action, GameState } from '../game/engine';
import { ME } from './useGame';

/** Qué pueden hacer las máquinas en este paso: nada, todo, o solo lo de las ventanas (Aplastar, reacciones…). */
export type TutorBots = 'off' | 'on' | 'windows';
export interface TutorGate { bots: TutorBots; autoPass: boolean; slapFirst?: boolean; slow?: boolean; slowSlap?: boolean }

interface Step {
  /** `msg`: se lee y se pulsa «Siguiente». `do`: hay que hacer algo. `watch`: juegan los demás. */
  kind: 'msg' | 'do' | 'watch';
  text: string;
  /** Lo que se resalta: selectores CSS; con «|» se separan zonas resaltadas por separado (cada zona, el conjunto de lo que encuentra). */
  target?: string | ((s: GameState) => string);
  allow?: (a: Action, s: GameState) => boolean;
  done?: (s: GameState) => boolean;
  bots?: TutorBots;
  /** En este paso no se pasa solo en las ventanas de reacción (porque se espera que reacciones tú). */
  react?: boolean;
  /** Las máquinas pulsan la mano del Aplastar sin esperarme (para que me toque robar a mí). */
  slapFirst?: boolean;
  /** Las ventanas de reacción van despacio (para ver bien las flechas y lo que pasa). */
  slow?: boolean;
  /** Solo la ronda de Aplastar va despacio (las máquinas pulsan una tras otra, con calma). */
  slowSlap?: boolean;
  /** Retiene la animación grande de los triángulos de entorno hasta el paso siguiente (para explicar antes la carta). */
  holdEnv?: boolean;
  /** Margen extra (px) alrededor de lo resaltado (p. ej. cuando se ven dos cartas a la vez, más anchas que el círculo). */
  pad?: number;
  /** Espera (ms) antes de mostrar el paso: que termine antes la animación de lo que se señala. */
  wait?: number;
}

const has = (s: GameState, k: Kind, c: Color | null = null) => s.players[ME].hand.some((x) => x.kind === k && x.color === c);
const idOf = (s: GameState, k: Kind, c: Color | null = null) => s.players[ME].hand.find((x) => x.kind === k && x.color === c)?.id;
const plays = (k: Kind, c: Color | null = null) => (a: Action, s: GameState) => a.type === 'play' && a.cardId === idOf(s, k, c);
const myTurn = (s: GameState) => s.turn === ME && s.phase.t === 'turn';
const HAND = '.cards-row .hc';
const card = (k: Kind, c: Color | null = null) => (s: GameState) => { const id = idOf(s, k, c); return id ? `[data-card="${id}"]` : HAND; };
const CIRCLE = '.disc';
/** Las gemas de elegir color, con su rótulo «Elige color». */
const GEMS = '.gem-under, .gem-under .gem-hint';

const STEPS: Step[] = [
  { kind: 'msg', target: HAND, text: 'Estas son tus cartas: 7 en total. **Gana quien se quede antes sin ninguna.**' },
  { kind: 'msg', target: card('maldicion'), text: 'Esta es tu **Maldición**. No se puede jugar sola: tendrás que librarte de ella. Más adelante verás cómo.' },
  { kind: 'msg', target: `${HAND} | .dock`, text: 'Si pasas el ratón por cualquier carta, en el **panel de la derecha** verás qué hace. Pruébalo cuando quieras.' },
  { kind: 'msg', target: '.pile', text: 'Esta es la **Pila**: la última carta jugada. Ahora hay una **Gema III verde**.' },
  { kind: 'msg', target: '.deck', text: 'Este es el **Mazo**. De aquí se roba cuando no puedes (o no quieres) jugar.' },
  { kind: 'msg', target: '.tri', text: 'Los **triángulos de entorno** muestran las reglas especiales activas para toda la mesa. Ahora están todos apagados.' },
  { kind: 'do', target: card('gema1', 'v'), text: 'Es tu turno. Para **encadenar** una carta tiene que coincidir con la Pila en **color** o en **símbolo**. Juega tu **Gema I verde**: mismo color.', allow: plays('gema1', 'v'), done: (s) => !has(s, 'gema1', 'v') },
  { kind: 'watch', text: 'Ahora juegan los demás, por turnos.', done: myTurn, bots: 'on' },
  { kind: 'do', target: card('gema2', 'v'), text: 'Arriba hay una **Gema II morada**. Tu **Gema II verde** no es del mismo color, pero sí del **mismo símbolo**: ¡juégala!', allow: plays('gema2', 'v'), done: (s) => !has(s, 'gema2', 'v') },
  { kind: 'watch', text: 'Atento a lo que juega Brujilda…', done: (s) => s.phase.t === 'aplastar', bots: 'on' },
  { kind: 'do', target: '.diana', text: '**¡Aplastar!** Todos tienen que pulsar la mano que aparece en la mesa. **El último roba 3.** ¡Púlsala rápido!', allow: (a) => a.type === 'slap', done: (s) => s.phase.t === 'turn' && s.turn === 2 },
  { kind: 'do', target: card('aplastar', 'v'), wait: 600, text: 'Úrsula ha sido la última: roba 3. Tú tienes otro **Aplastar verde**, idéntico al de la Pila. Una carta idéntica se puede **duplicar aunque no sea tu turno**, y si es un **Ataque**, **su efecto se repite**. ¡Duplícalo!', allow: (a, s) => a.type === 'dup' && a.cardId === idOf(s, 'aplastar', 'v'), done: (s) => !has(s, 'aplastar', 'v') },
  { kind: 'watch', text: 'Otra ronda de Aplastar, **lanzada por ti**: esta vez no tienes que pulsar. Mira quién es el último…', done: (s) => s.phase.t === 'turn' && s.turn === 2, bots: 'windows', slowSlap: true },
  { kind: 'watch', text: 'Fíjate en lo que hace Merlín…', done: (s) => s.log.some((l) => l.text.includes('Merlín juega Antitodo junto')), bots: 'on' },
  { kind: 'msg', target: CIRCLE, wait: 2600, pad: 70, text: 'Merlín ha jugado un **Antitodo junto a su Maldición**: ¡así se libra de ella! Tú también tienes un Antitodo. **Guárdalo para el final.**' },
  { kind: 'watch', text: 'Sigue la partida…', done: (s) => s.phase.t === 'react' && s.phase.eff.targets.includes(ME), bots: 'on', react: true },
  { kind: 'do', target: card('egida'), text: '¡Úrsula te ataca con una **Travesura**! Tendrías que recibir una carta suya y robar 2. Pero puedes **defenderte**: pulsa tu **Égida**.', allow: (a) => a.type === 'react' && a.r === 'egida', done: (s) => s.phase.t === 'tinte', react: true },
  { kind: 'msg', target: '.my-egida', wait: 1200, text: 'La Égida tiene **2 usos**: tras el primero se queda **boca arriba** aquí, junto a tus cartas. Aún podrás usarla una vez más.' },
  { kind: 'do', target: GEMS, text: 'La Égida es **incolora**, y quien juega la última carta incolora **elige el siguiente color**. Elige el **amarillo**.', allow: (a) => a.type === 'color' && a.color === 'a', done: myTurn },
  { kind: 'do', target: '.deck', text: 'Es tu turno, pero no tienes nada que encadenar. **Roba del Mazo.**', allow: (a) => a.type === 'draw', done: (s) => has(s, 'adivinar', 'a') },
  { kind: 'do', target: card('adivinar', 'a'), wait: 1900, text: 'Has robado un **Adivinar amarillo**, una carta de **Apoyo**. Si la carta robada sirve, puedes jugarla en el momento. ¡Juégala!', allow: plays('adivinar', 'a'), done: (s) => s.phase.t !== 'turn' },
  { kind: 'do', target: card('gema3', 'm'), wait: 400, text: 'Al jugar una carta de **Apoyo** puedes **descartar 1 Gema** debajo de ella: una carta menos. Descarta tu **Gema III morada**.', allow: (a, s) => a.type === 'choose' && a.value === idOf(s, 'gema3', 'm'), done: (s) => s.phase.t === 'adivinar' },
  { kind: 'do', target: '.tray | .banner button.primary', wait: 900, text: 'Con **Adivinar** ves las 3 siguientes cartas del Mazo. **Quédate la Codicia y la Gema III verde** («A la mano»), deja la otra «Al Mazo» y confirma.', allow: (a, s) => a.type === 'adivinar' && s.phase.t === 'adivinar' && s.phase.cards.filter((c) => c.kind === 'codicia' || (c.kind === 'gema3' && c.color === 'v')).every((c) => a.keep.includes(c.id)), done: (s) => s.phase.t !== 'adivinar' },
  { kind: 'watch', text: 'Juegan los demás…', done: (s) => s.env.mutis, bots: 'on' },
  { kind: 'msg', target: CIRCLE, wait: 2400, holdEnv: true, text: 'Brujilda ha jugado **Mutis**, una carta de **Entorno**: cambia las reglas para toda la mesa. Con Mutis, **no se puede hablar**.' },
  { kind: 'msg', target: '.tri', wait: 3600, text: 'Por eso se ha encendido su **triángulo de entorno**. Si llega a haber **2 activos**, hay **Entorno maldito**: quien eche su última carta no gana y roba 1.' },
  { kind: 'watch', text: 'Juegan los demás…', done: myTurn, bots: 'on' },
  { kind: 'do', target: card('codicia', 'a'), text: 'Juega tu **Codicia amarilla**.', allow: plays('codicia', 'a'), done: (s) => s.phase.t === 'choose' },
  { kind: 'do', target: '.seat:has([data-anchor="p2"])', text: 'La Codicia es una **Magia**: eliges contra quién. **Elige a Merlín.**', allow: (a) => a.type === 'choose' && a.value === 2, done: (s) => s.phase.t === 'codicia' },
  { kind: 'do', target: card('gema3', 'v'), text: 'Merlín te dará su carta de **mayor Jerarquía**, y tú le das la que quieras. Dale tu **Gema III verde**.', allow: (a, s) => a.type === 'give' && a.cardId === idOf(s, 'gema3', 'v'), done: (s) => s.phase.t !== 'codicia' },
  { kind: 'msg', target: card('reflejo'), wait: 1500, text: 'Te ha dado un **Reflejo** (Jerarquía III). Ojo: la carta de mayor Jerarquía es la **Maldición**; por eso es arriesgado usar Codicia contra quien aún tiene la suya.' },
  { kind: 'watch', text: 'Juegan los demás…', done: (s) => s.phase.t === 'react' && s.phase.eff.targets.includes(ME), bots: 'on', react: true },
  { kind: 'do', target: (s) => `${card('reflejo')(s)} | .callout`, react: true, text: '¡Merlín te lanza una **Purga**: tendrías que descartar toda tu mano y robar otras tantas! Pulsa tu **Reflejo**: una **Magia reflejada** no vuelve a uno solo, sino que afecta a **todos los demás**.', allow: (a) => a.type === 'react' && a.r === 'reflejo', done: (s) => s.log.some((l) => l.text.includes('usa Reflejo')) },
  { kind: 'msg', target: CIRCLE, wait: 700, text: 'Además, el Reflejo **cambia el sentido del juego**: fíjate en las flechas del centro, ahora giran al revés. A partir de ahora el turno va en la otra dirección.' },
  { kind: 'do', target: GEMS, wait: 900, slow: true, text: 'La Purga reflejada afecta a **todos menos a ti**: descartan su mano y roban una nueva. Y el Reflejo es incolora: **elige el color que quieras**.', allow: (a) => a.type === 'color', done: (s) => s.phase.t === 'turn' },
  { kind: 'watch', text: 'Ya solo te quedan tu **Antitodo** y tu **Maldición**.', done: myTurn, bots: 'on' },
  { kind: 'do', target: (s) => [card('antitodo')(s), card('maldicion')(s), '.join-btn'].join(', '), wait: 600, text: 'Un **Antitodo junto a una Maldición** las elimina a las dos. ¡Y son tus últimas cartas! Pulsa **Jugar juntas**.', allow: (a, s) => a.type === 'play' && a.cardId === idOf(s, 'antitodo') && !!a.with?.includes(idOf(s, 'maldicion') ?? '-'), done: (s) => s.phase.t === 'over' },
];

/** Mensajes durante el reparto inicial (no paran nada). */
const INTRO: Record<string, string> = {
  setup: 'Al empezar, **cada jugador recibe una Maldición**, boca arriba.',
  deal: 'Después se reparten **6 cartas más** a cada uno, hasta tener **7**.',
};

export function useTutor(enabled: boolean, s: GameState, intro: string | null) {
  const [idx, setIdx] = useState(0);
  const [shake, setShake] = useState(0);
  const step = enabled && intro === null ? STEPS[idx] : undefined;
  // Avanza solo cuando se cumple lo que pide el paso.
  useEffect(() => {
    if (step?.done && step.kind !== 'msg' && step.done(s)) setIdx((i) => i + 1);
  }, [s, step]);
  // Por defecto, mientras se espera algo de mí las máquinas sí responden en las ventanas (no juegan su turno).
  const gate: TutorGate = { bots: !enabled ? 'on' : step ? step.bots ?? (step.kind === 'do' ? 'windows' : 'off') : 'off', autoPass: !step?.react, slapFirst: !!step?.slapFirst, slow: !!step?.slow, slowSlap: !!step?.slowSlap };
  const allow = (a: Action) => {
    if (!enabled) return true;
    if (step?.kind === 'do' && step.allow?.(a, s)) return true;
    setShake((n) => n + 1);
    return false;
  };
  const target = step ? (typeof step.target === 'function' ? step.target(s) : step.target) : undefined;
  /** El paso se enseña pasado su `wait` (mientras, ni caja ni resaltado). */
  const [readyIdx, setReadyIdx] = useState(-1);
  useEffect(() => {
    if (!step) return;
    const id = window.setTimeout(() => setReadyIdx(idx), step.wait ?? 0);
    return () => clearTimeout(id);
  }, [idx, !!step]);
  return {
    gate, allow,
    view: enabled ? { step, idx, total: STEPS.length, target, shake, ready: readyIdx === idx || !step, introText: intro ? INTRO[intro] : undefined, next: () => setIdx((i) => i + 1) } : null,
  };
}

/** **negrita** → <b>. */
const md = (t: string) => t.split('**').map((x, i) => (i % 2 ? <b key={i}>{x}</b> : x));

/** El mensaje del paso, junto a lo que señala, con la mesa oscurecida alrededor (si hay algo que señalar). */
export function TutorOverlay({ view, onExit, finished }: { view: NonNullable<ReturnType<typeof useTutor>['view']>; onExit: () => void; finished: boolean }) {
  const [rects, setRects] = useState<DOMRect[]>([]);
  const rect = rects[0] ?? null;
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const text = finished ? '¡Enhorabuena, has ganado! **Ya sabes jugar.** En el **Compendio** tienes todas las cartas: Reflejo, Imán, Tinieblas…' : view.introText ?? view.step?.text;
  const target = finished || view.introText ? undefined : view.target;
  useLayoutEffect(() => {
    const place = () => {
      const out: DOMRect[] = [];
      for (const group of (target ?? '').split('|').map((g) => g.trim()).filter(Boolean)) {
        const els = [...document.querySelectorAll(group)];
        if (!els.length) continue;
        const rs = els.map((e) => e.getBoundingClientRect());
        const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top));
        const r = Math.max(...rs.map((r) => r.right)), b = Math.min(window.innerHeight, Math.max(...rs.map((r) => r.bottom)));
        // Cartas de mi mano: hueco de sobra por arriba, para que al pasar el ratón (se levantan) no se salgan.
        const lift = els.some((e) => e.closest('.cards-row')) ? 52 : 0;
        out.push(new DOMRect(l, t - lift, r - l, b - t + lift));
      }
      setRects((prev) => (prev.length === out.length && prev.every((p, i) => Math.abs(p.left - out[i].left) < 1 && Math.abs(p.top - out[i].top) < 1 && Math.abs(p.width - out[i].width) < 1 && Math.abs(p.height - out[i].height) < 1) ? prev : out));
    };
    place();
    const id = window.setInterval(place, 200);
    window.addEventListener('resize', place);
    return () => { clearInterval(id); window.removeEventListener('resize', place); };
  }, [target, view.idx]);
  // Se coloca en un sitio fijo (abajo a la izquierda); solo si lo señalado cae ahí, junto a ello. Solo se mueve si lo
  // señalado cambia de verdad (no por pequeños reajustes de la mesa).
  const lastRect = useRef<DOMRect | null>(null);
  const lastIdx = useRef(-1);
  useLayoutEffect(() => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    const W = window.innerWidth, H = window.innerHeight, M = 16;
    if (lastIdx.current !== view.idx) { lastIdx.current = view.idx; lastRect.current = null; }
    const lr = lastRect.current;
    if (pos && rect && lr && Math.abs(lr.left - rect.left) < 40 && Math.abs(lr.top - rect.top) < 40 && Math.abs(lr.width - rect.width) < 60) return;
    lastRect.current = rect;
    // Sitio fijo: abajo a la izquierda (donde va el historial, que en el tutorial no se muestra), encima de mi nombre.
    // Así no tapa la mesa. Solo si lo señalado cae justo ahí, la caja se coloca junto a ello.
    // Pasos 1 a 7 (presentación de la mesa): siempre en el centro, encima de mis cartas, como en el paso 1.
    // (Los avisos del reparto, antes del paso 1, van abajo a la izquierda.)
    if (view.idx <= 6 && !view.introText && !finished) {
      const hand = document.querySelector('.cards-row')?.getBoundingClientRect();
      if (hand) return setPos({ left: (W - b.width) / 2, top: Math.max(M, hand.top - 52 - b.height - 18) });
    }
    const dock = { left: M, top: H - b.height - 86 };
    const overlaps = !!rect && rect.left < dock.left + b.width + 12 && rect.right > dock.left - 12 && rect.top < dock.top + b.height + 12 && rect.bottom > dock.top - 12;
    if (!overlaps || !rect) return setPos(dock);
    let top = rect.top - b.height - 18;
    if (top < M) top = rect.bottom + 18;
    if (top + b.height > H - M) top = Math.max(M, (H - b.height) / 2);
    const left = Math.max(M, Math.min(W - b.width - M, rect.left + rect.width / 2 - b.width / 2));
    setPos({ left, top });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect, text, view.idx, view.ready]);
  // Con algo que señalar, la caja no sale hasta encontrarlo (y hasta que el paso está listo).
  const hidden = !view.ready || (!!target && !rect);
  if (!text || hidden) return null;
  const step = view.step;
  const pad = 8 + (step?.pad ?? 0);
  return (
    <div className="tutor" aria-live="polite">
      {rects.length > 0 && (
        <svg className="tutor-mask" aria-hidden="true">
          <defs>
            <mask id="tutor-holes">
              <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
              {rects.map((r, i) => <rect key={i} x={r.left - pad} y={r.top - pad} width={r.width + pad * 2} height={r.height + pad * 2} rx="10" fill="#000" />)}
            </mask>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="rgba(8, 6, 16, 0.62)" mask="url(#tutor-holes)" />
          {rects.map((r, i) => <rect key={i} className="tutor-ring" x={r.left - pad} y={r.top - pad} width={r.width + pad * 2} height={r.height + pad * 2} rx="10" />)}
        </svg>
      )}
      <div ref={box} key={`${view.idx}:${view.shake}`} className={`tutor-box ${view.shake ? 'shake' : ''} ${step?.kind === 'watch' ? 'quiet' : ''}`} style={pos ?? { visibility: 'hidden' }}>
        <p>{md(text)}</p>
        <div className="tutor-foot">
          {!view.introText && !finished && <span className="tutor-n">{view.idx + 1} / {view.total}</span>}
          <span className="tutor-sp" />
          {!finished && <button className="tutor-skip" onClick={onExit}>Salir del tutorial</button>}
          {finished ? <button className="tutor-next" onClick={onExit}>Terminar</button>
            : step?.kind === 'msg' && !view.introText && <button className="tutor-next" onClick={view.next}>Siguiente</button>}
        </div>
      </div>
    </div>
  );
}
