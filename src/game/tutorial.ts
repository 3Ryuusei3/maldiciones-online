// Tutorial: una partida preparada carta a carta (manos, Pila y orden del Mazo) contra 3 máquinas que juegan
// según un plan fijo. Siempre acaba igual: gana el jugador, echando juntos su Antitodo y su Maldición.

import { botDecide } from './bot';
import { Card, Color, Kind, cardName, isCursed, isPlainGem } from './cards';
import { Action, GameState, canPlay, newGame, topCard } from './engine';

export const TUTOR_BOTS = ['Brujilda', 'Merlín', 'Úrsula'];

type Spec = [Kind, Color | null];

/** Manos de cada jugador (además de su Maldición), en el orden en que las máquinas prefieren jugarlas. */
const HANDS: Spec[][] = [
  // Tú: Gema I verde (color), Gema II verde (símbolo), Aplastar verde (duplicar), Égida, Antitodo y una Gema III morada
  // (la que descartarás debajo de la carta de Apoyo).
  [['gema1', 'v'], ['gema2', 'v'], ['aplastar', 'v'], ['egida', null], ['antitodo', null], ['gema3', 'm']],
  // Brujilda: Gema I amarilla → Aplastar verde → Mutis amarillo → gemas.
  [['gema1', 'a'], ['aplastar', 'v'], ['mutis', 'a'], ['gema1', 'm'], ['gema2', 'm'], ['gema3', 'a']],
  // Merlín: Gema II amarilla → Antitodo (con su Maldición) → Gema I amarilla → Purga (contra ti). Su Reflejo es
  // su carta de mayor Jerarquía: te la dará con la Codicia.
  [['gema2', 'a'], ['antitodo', null], ['gema1', 'a'], ['reflejo', null], ['purga', null], ['gema1', 'v']],
  // Úrsula: Gema II morada → Travesura amarilla (contra ti) → Gema II amarilla → gemas.
  [['gema2', 'm'], ['travesura', 'a'], ['gema1', 'm'], ['gema2', 'a'], ['gema1', 'v'], ['gema1', 'a']],
];
/** Lo que roba Úrsula al perder las dos rondas de Aplastar (6 cartas); después, el Adivinar que robas tú y las 3
 *  cartas que verás con él (te quedarás la Codicia y la Gema III verde). */
const DECK_TOP: (Spec | null)[] = [null, null, null, null, null, null, ['adivinar', 'a'], ['codicia', 'a'], ['gema3', 'v'], null];

export function newTutorial(name: string): GameState {
  const s = newGame({ players: [{ name: name || 'Tú', bot: false }, ...TUTOR_BOTS.map((n) => ({ name: n, bot: true }))], seed: 1, extraCurses: false, condena: false });
  const curses = s.players.map((p) => p.hand.find((c) => c.kind === 'maldicion')!);
  const pool: Card[] = [...s.deck, ...s.pile, ...s.players.flatMap((p) => p.hand.filter((c) => c.kind !== 'maldicion'))];
  const take = ([k, c]: Spec) => {
    const i = pool.findIndex((x) => x.kind === k && x.color === c);
    if (i < 0) throw new Error(`Tutorial: falta ${k} ${c}`);
    return pool.splice(i, 1)[0];
  };
  s.players.forEach((p, i) => { p.hand = [curses[i], ...HANDS[i].map(take)]; });
  const first = take(['gema3', 'v']);
  // null: una Gema cualquiera (de relleno).
  const top = DECK_TOP.map((sp) => (sp ? take(sp) : pool.splice(pool.findIndex((x) => x.kind === 'gema1' || x.kind === 'gema2'), 1)[0]));
  // El Mazo se roba por el final: lo de DECK_TOP sale en orden y lo demás (sin cartas raras) queda debajo.
  s.deck = [...pool.filter((c) => !isCursed(c)), ...top.reverse()];
  s.pile = [first];
  s.color = 'v';
  s.turn = 0;
  s.dir = 1;
  s.phase = { t: 'turn', drawn: null };
  s.log = [{ n: 1, text: `Comienza la partida. Carta inicial: ${cardName(first)}.` }];
  return s;
}

/** Plan de juego de cada máquina: la primera carta de su lista que se pueda encadenar. */
const PLAN: Record<number, Spec[]> = { 1: [['gema1', 'a'], ['aplastar', 'v'], ['mutis', 'a']], 2: [['gema2', 'a'], ['antitodo', null], ['gema1', 'a'], ['purga', null]], 3: [['gema2', 'm'], ['travesura', 'a'], ['gema2', 'a']] };

/** Decisión de una máquina del tutorial (null: nada que hacer). Las reacciones siempre pasan. */
export function tutorBot(s: GameState, p: number): Action | null {
  const ph = s.phase;
  const pl = s.players[p];
  if (ph.t === 'turn' && s.turn === p) {
    if (ph.drawn) {
      const d = pl.hand.find((c) => c.id === ph.drawn);
      // Fuera de su plan solo juegan Gemas normales (nada que cambie el guion).
      return d && canPlay(s, p, d) && isPlainGem(d) ? { type: 'play', player: p, cardId: d.id } : { type: 'keep', player: p };
    }
    const legal = pl.hand.filter((c) => !isCursed(c) && canPlay(s, p, c));
    const planned = PLAN[p]?.map(([k, col]) => legal.find((c) => c.kind === k && c.color === col)).find((c) => !!c);
    const gem = legal.find((c) => isPlainGem(c));
    const pick = planned ?? gem;
    return pick ? { type: 'play', player: p, cardId: pick.id } : { type: 'draw', player: p };
  }
  if (ph.t === 'react' && ph.waiting.includes(p)) return { type: 'react', player: p, r: 'pass' };
  if (ph.t === 'aplastar' && ph.players.includes(p) && !ph.slapped.includes(p)) return { type: 'slap', player: p };
  if (ph.t === 'gemas' && ph.waiting.includes(p)) return { type: 'gemas', player: p, ids: [] };
  if (ph.t === 'tinte' && ph.player === p) return { type: 'color', player: p, color: 'a' };
  if (ph.t === 'codicia' && ph.target === p && ph.waiting.includes(p)) {
    const refl = ph.options.find((id) => pl.hand.find((c) => c.id === id)?.kind === 'reflejo');
    return { type: 'pick', player: p, ids: [refl ?? ph.options[0]] };
  }
  // La Purga de Merlín va contra ti.
  if (ph.t === 'choose' && ph.player === p && ph.need === 'target' && ph.options.includes(0)) {
    return { type: 'choose', player: p, value: 0 };
  }
  return botDecide(s, p, 1, () => 0.5);
}

export const tutorTop = (s: GameState) => topCard(s);
