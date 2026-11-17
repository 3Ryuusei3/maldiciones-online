// Motor de reglas de Maldiciones (V7). Puro y determinista:
//   apply(estado, acción) -> estado nuevo
// No usa relojes ni Math.random: el azar sale de state.seed y los tiempos
// (ventanas de reacción, Aplastar) los marca quien aloja la partida con 'timeout'.
// Esto permite que más adelante un anfitrión lo ejecute y lo sincronice por Supabase.

import { Card, Color, COLORS, COLOR_NAME, KINDS, RITUALS, buildDeck, cardName, isCursed, isGem, isPlainGem, rankOf } from './cards';

export interface Player {
  id: number;
  name: string;
  bot: boolean;
  hand: Card[];
  /** Égida boca arriba (le queda 1 uso). */
  egida: Card | null;
  /** Un Imán le dejó sin cartas: están retenidas y no gana por ello. */
  held: boolean;
}

export type Effect =
  | { k: 'draw'; source: number; targets: number[]; amount: number; aplastar: boolean }
  /**
   * Travesura / Trastada (encadenadas o duplicadas). `launchers` tiene una entrada por cada carta que hay que dar
   * (una Trastada aporta dos). Las cartas no se apartan al lanzar: se eligen al final, cuando ya se sabe quién la recibe.
   * `last` es la última carta de la cadena: es lo único que se refleja.
   */
  | { k: 'trav'; launchers: number[]; targets: number[]; amount: number; noChain: boolean; given: { from: number; card: Card }[]; last: 'travesura' | 'trastada' }
  /** `held`: Gemas ya enseñadas para librarse (o que deja el lanzador); se echan todas a la vez al resolverse. */
  | { k: 'cristal'; source: number; targets: number[]; tone: Color; held?: { p: number; ids: string[] }[] }
  | { k: 'codicia' | 'purga' | 'iman' | 'escarcha' | 'rafaga'; source: number; targets: number[] }
  | { k: 'rcodicia' | 'rpurga' | 'riman' | 'rescarcha'; source: number; targets: number[] }
  | { k: 'gift'; source: number; targets: number[]; card: Card };

type TravEff = Extract<Effect, { k: 'trav' }>;

/** Lugares entre los que se mueven cartas (para animar): un jugador, el Mazo o la Pila. */
export type Anchor = number | 'deck' | 'pile';
export interface Fx { from: Anchor; to: Anchor; n: number; card?: Card }

export interface PendingPlay {
  player: number;
  card: Card;
  companion: Card | null;
  target: number | null;
  noTarget: boolean;
  gemAsked: boolean;
  /** Jugada por una Ráfaga: su efecto va contra `target` pero no concede el turno. */
  directed?: boolean;
}

/** Ráfaga en curso: cartas reveladas que el lanzador va jugando una a una (o descarta). */
export interface Rafaga {
  player: number;
  /** De quién era el turno: se recupera tras cada carta. */
  turn: number;
  pool: Card[];
  /** Aún puede jugar 1 carta de su mano. */
  own: boolean;
  /** A quién puede dirigir las cartas (los que se protegieron quedan fuera). */
  allowed: number[];
}

export type Phase =
  | { t: 'turn'; drawn: string | null }
  | { t: 'choose'; player: number; need: 'target' | 'card' | 'gem'; options: (string | number)[]; pp: PendingPlay }
  | { t: 'react'; eff: Effect; waiting: number[]; exempt: number[]; win: number }
  | { t: 'aplastar'; launcher: number; amount: number; players: number[]; slapped: number[]; win: number }
  | { t: 'give'; eff: TravEff; waiting: number[]; need: Record<number, number>; target: number }
  | { t: 'escarcha'; player: number; targets: number[] }
  | { t: 'rafaga' }
  | { t: 'tinte'; player: number; resume: Phase | null }
  | { t: 'codicia'; launcher: number; target: number; options: string[]; give: string | null; best: string | null; waiting: number[] }
  | { t: 'imanPick'; source: number; targets: number[]; picks: Record<number, TieSplit>; chosen: Record<number, string[]>; waiting: number[] }
  | { t: 'iman'; launcher: number; pool: Card[] }
  | { t: 'adivinar'; player: number; cards: Card[] }
  | { t: 'recuperar'; player: number; options: string[] }
  | { t: 'gemas'; waiting: number[]; win: number; chosen: Record<number, string[]> }
  | { t: 'condena'; player: number; absolved: boolean }
  | { t: 'over' };

/** Reparto de las mejores cartas de una mano: las obligadas y, si hay empate, entre cuáles elige el dueño. */
export interface TieSplit { fixed: string[]; options: string[]; count: number }

export interface GameState {
  seed: number;
  seq: number;
  /** Contador de ventanas temporizadas (para que el anfitrión lleve los relojes). */
  win: number;
  players: Player[];
  deck: Card[];
  /** Pila de juego; la última es la carta superior. */
  pile: Card[];
  color: Color;
  /** Quién jugó la última carta incolora y elegirá color cuando acabe la acción en curso. */
  tinte: number | null;
  /** Movimientos de cartas producidos por la última acción (solo para animar). */
  fx: Fx[];
  /** Lo gastado al reaccionar a la acción en curso: un Antitodo lo anula todo y lo devuelve. */
  undo: null | { dir: 1 | -1; spent: { p: number; card: Card; from: 'hand' | 'up' | 'pile' }[] };
  dir: 1 | -1;
  turn: number;
  env: { mutis: boolean; inutilizar: boolean; tinieblas: null | { owner: number; count: number; fresh: boolean } };
  phase: Phase;
  rafaga: Rafaga | null;
  /** Para el resumen final: cartas echadas y robadas por jugador, y turnos jugados. */
  stats: { played: number[]; drawn: number[]; turns: number; maxCurses: number[]; maxHand: number[]; minHand: number[] };
  after: { turnTo: number | null } | null;
  totalCurses: number;
  winner: number | null;
  log: { n: number; text: string }[];
  announce: { n: number; text: string; player: number } | null;
}

export type ReactKind = 'pass' | 'egida' | 'antitodo' | 'reflejo' | 'chain' | 'gem' | 'gems' | 'blind';

export type Action =
  | { type: 'play'; player: number; cardId: string }
  | { type: 'draw'; player: number }
  | { type: 'keep'; player: number }
  | { type: 'choose'; player: number; value: string | number | null }
  | { type: 'dup'; player: number; cardId: string }
  | { type: 'antitodo'; player: number }
  | { type: 'color'; player: number; color: Color }
  | { type: 'react'; player: number; r: ReactKind; cardId?: string; ids?: string[]; color?: Color; target?: number }
  | { type: 'slap'; player: number }
  | { type: 'give'; player: number; cardId: string; ids?: string[] }
  | { type: 'escarcha'; player: number; hands: Record<number, string[]>; give: { cardId: string; to: number } | null }
  | { type: 'rafaga'; player: number; cardId: string | null; target?: number }
  | { type: 'pick'; player: number; ids: string[] }
  | { type: 'iman'; player: number; assign: Record<string, 'keep' | 'discard' | number> }
  | { type: 'adivinar'; player: number; keep: string[]; discard: string[]; back: string[] }
  | { type: 'recuperar'; player: number; cardId: string; to: number }
  | { type: 'gemas'; player: number; ids: string[] }
  | { type: 'search'; player: number; where: 'deck' | 'pile' | number }
  | { type: 'absolve'; player: number; to: number | null }
  | { type: 'penalize'; target: number }
  | { type: 'timeout' };

export interface GameOptions {
  players: { name: string; bot: boolean }[];
  seed: number;
  /** Añadir al mazo las Maldiciones sobrantes (más difícil). */
  extraCurses: boolean;
  /** Incluir la carta Condena en el Mazo. */
  condena?: boolean;
  /** Añadir las cartas beta de V7 (Escarcha, Ráfaga, Trastada y los 3 Rituales). */
  beta?: boolean;
}

// ───────────────────────── utilidades ─────────────────────────

function rnd(s: GameState): number {
  s.seed = (s.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(s.seed ^ (s.seed >>> 15), 1 | s.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle<T>(s: GameState, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function log(s: GameState, text: string) {
  s.log.push({ n: s.seq, text });
  if (s.log.length > 3000) s.log.splice(0, s.log.length - 3000); // se guarda todo para el historial final
}

const nm = (s: GameState, p: number) => s.players[p].name;
export const topCard = (s: GameState): Card => s.pile[s.pile.length - 1];
export const nextPlayer = (s: GameState, p: number): number => (p + s.dir + s.players.length) % s.players.length;
export const envCount = (s: GameState) => (s.env.mutis ? 1 : 0) + (s.env.inutilizar ? 1 : 0) + (s.env.tinieblas ? 1 : 0);
export const isCursedEnv = (s: GameState) => envCount(s) >= 2;
export const isBlind = (s: GameState) => !!s.env.tinieblas;

function takeFromHand(s: GameState, p: number, id: string): Card | null {
  const h = s.players[p].hand;
  const i = h.findIndex((c) => c.id === id);
  return i < 0 ? null : h.splice(i, 1)[0];
}

/** Saca cartas del Mazo (rehaciéndolo con la Pila si se agota). */
function takeDeck(s: GameState, n: number): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < n; i++) {
    if (s.deck.length === 0) {
      if (s.pile.length <= 1) break;
      const top = s.pile.pop()!;
      s.deck = shuffle(s, s.pile);
      s.pile = [top];
      log(s, 'Se baraja la Pila para formar un nuevo Mazo.');
    }
    out.push(s.deck.pop()!);
  }
  return out;
}

function drawCards(s: GameState, p: number, n: number): Card[] {
  const out = takeDeck(s, n);
  s.players[p].hand.push(...out);
  if (s.stats) s.stats.drawn[p] += out.length;
  fx(s, 'deck', p, out.length);
  return out;
}

function fx(s: GameState, from: Anchor, to: Anchor, n = 1, card?: Card) {
  if (n > 0 && from !== to) s.fx.push({ from, to, n, ...(card ? { card } : {}) });
}

/** Pone una carta boca arriba en la Pila. Si es incolora, quien la echa elegirá color al final. */
function putOnPile(s: GameState, p: number, c: Card) {
  s.pile.push(c);
  s.stats.played[p]++;
  fx(s, p, 'pile', 1, c);
  if (c.color) {
    s.color = c.color;
    s.tinte = null;
  } else s.tinte = p;
}

/** Si toca elegir color y no hay ninguna acción a medias, se pregunta ya. */
function settleTinte(s: GameState) {
  if (s.tinte === null) return;
  if (s.phase.t === 'turn') s.phase = { t: 'tinte', player: s.tinte, resume: s.phase };
  else if (s.phase.t === 'tinte') s.phase.player = s.tinte;
}

function announce(s: GameState, player: number, text: string, silent = false) {
  if (s.env.mutis || silent) return;
  s.announce = { n: s.seq, text, player };
}

function resetEnv(s: GameState) {
  s.env = { mutis: false, inutilizar: false, tinieblas: null };
}

function dropFaceUpEgidas(s: GameState) {
  for (const p of s.players)
    if (p.egida) {
      s.pile.unshift(p.egida);
      p.egida = null;
    }
}

/** El jugador se ha quedado sin cartas: gana, o roba 1 si hay Entorno maldito. */
function tryWin(s: GameState, p: number): boolean {
  if (s.players[p].hand.length > 0) return false;
  if (isCursedEnv(s)) {
    drawCards(s, p, 1);
    log(s, `${nm(s, p)} se queda sin cartas en Entorno maldito: no gana y roba 1.`);
    return false;
  }
  s.winner = p;
  s.phase = { t: 'over' };
  s.after = null;
  log(s, `🏆 ${nm(s, p)} se queda sin cartas y gana la partida.`);
  return true;
}

// ───────────────────────── consultas para UI y bots ─────────────────────────

export function companions(s: GameState, p: number, predestinarId: string): Card[] {
  return s.players[p].hand.filter(
    (c) => c.id !== predestinarId && KINDS[c.kind].attr !== 'defensa' && c.kind !== 'predestinar' && c.kind !== 'antitodo',
  );
}

export function isLegal(s: GameState, p: number, c: Card): boolean {
  const attr = KINDS[c.kind].attr;
  if (attr === 'maldita' || attr === 'defensa') return false;
  if (c.kind === 'antitodo') return true;
  if (c.kind === 'predestinar') return companions(s, p, c.id).length > 0;
  if (c.color === null) return true;
  return c.color === s.color || c.kind === topCard(s).kind;
}

/** ¿Puede este jugador jugar esta carta ahora mismo como jugada de turno? */
export function canPlay(s: GameState, p: number, c: Card): boolean {
  if (s.phase.t !== 'turn' || s.turn !== p) return false;
  if (s.phase.drawn && s.phase.drawn !== c.id) return false;
  if (isBlind(s)) return true;
  return isLegal(s, p, c);
}

export function canDup(s: GameState, p: number, c: Card): boolean {
  if (isBlind(s)) return false;
  const t = s.phase.t;
  if (t === 'over') return false;
  // Quien tiene una decisión a medias (elegir objetivo, entregar carta...) la termina antes de duplicar.
  if (t !== 'turn' && t !== 'react' && t !== 'aplastar' && pendingPlayers(s).includes(p)) return false;
  if (s.phase.t === 'turn' && s.phase.drawn === c.id) return false;
  const top = topCard(s);
  if (c.kind !== top.kind || c.color !== top.color) return false;
  const attr = KINDS[c.kind].attr;
  if (attr === 'defensa' || attr === 'sagrada' || attr === 'maldita' || KINDS[c.kind].rank >= 4) return false;
  if (c.kind === 'predestinar' || c.kind === 'cristalizar') return false;
  if (s.phase.t === 'react' && s.phase.eff.k === 'trav' && s.phase.eff.targets.includes(p)) return false;
  return true;
}

export function canFreeAntitodo(s: GameState, p: number): boolean {
  return s.phase.t === 'turn' && s.turn !== p && s.players[p].hand.some((c) => c.kind === 'antitodo');
}

const isTrav = (c: Card) => c.kind === 'travesura' || c.kind === 'trastada';

const hasKind = (s: GameState, p: number, k: Card['kind']) => s.players[p].hand.some((c) => c.kind === k);

export function reactOptionsFor(s: GameState, p: number, eff: Effect): ReactKind[] {
  const out: ReactKind[] = [];
  const pl = s.players[p];
  const isTarget = eff.targets.includes(p);
  if (isBlind(s)) {
    // En Tinieblas nadie ve su mano: el atacado puede probar suerte con una carta boca abajo.
    if (isTarget && pl.hand.length > 0) out.push('blind');
    if (isTarget && eff.k !== 'gift' && pl.egida) out.push('egida');
    return out;
  }
  const reflectable = eff.k !== 'cristal' && eff.k !== 'gift';
  if (isTarget) {
    if (eff.k === 'trav' && !eff.noChain && pl.hand.some((c) => isTrav(c) && !(s.env.inutilizar && c.color))) out.push('chain');
    if (eff.k === 'cristal' && pl.hand.some((c) => (isPlainGem(c) && c.color === eff.tone) || c.kind === 'gematri')) out.push('gem');
    if (eff.k !== 'gift' && (pl.egida || hasKind(s, p, 'egida'))) out.push('egida');
  }
  // El Antitodo funciona como una carta de defensa: cualquiera puede anular con él la acción en curso.
  if (hasKind(s, p, 'antitodo')) out.push('antitodo');
  if (eff.k === 'cristal' && eff.source === p && pl.hand.some((c) => (isPlainGem(c) && c.color === eff.tone) || c.kind === 'gematri')) out.push('gems');
  if (reflectable && hasKind(s, p, 'reflejo')) out.push('reflejo');
  return out;
}

export function reactOptions(s: GameState, p: number): ReactKind[] {
  if (s.phase.t !== 'react' || !s.phase.waiting.includes(p)) return [];
  return reactOptionsFor(s, p, s.phase.eff);
}

/** Jugadores de los que se espera una decisión en la fase actual. */
export function pendingPlayers(s: GameState): number[] {
  const ph = s.phase;
  switch (ph.t) {
    case 'turn': return [s.turn];
    case 'choose': return [ph.player];
    case 'tinte': return [ph.player];
    case 'react': return ph.waiting;
    case 'aplastar': return ph.players.filter((p) => !ph.slapped.includes(p));
    case 'give': return ph.waiting;
    case 'escarcha': return [ph.player];
    case 'rafaga': return s.rafaga ? [s.rafaga.player] : [];
    case 'codicia': return ph.waiting;
    case 'imanPick': return ph.waiting;
    case 'iman': return [ph.launcher];
    case 'adivinar': return [ph.player];
    case 'recuperar': return [ph.player];
    case 'gemas': return ph.waiting;
    case 'condena': return [ph.player];
    case 'over': return [];
  }
}

/**
 * Las `n` mejores cartas de una mano según Jerarquía. Si hay empate en el corte,
 * el dueño elige (`options`, `count`). Las Gemas no cuentan salvo que no haya otra cosa.
 */
export function tieSplit(hand: Card[], n: number, gemsIfEmpty: boolean): TieSplit {
  let cand = hand.filter((c) => !isGem(c));
  if (!cand.length && gemsIfEmpty) cand = [...hand];
  const sorted = [...cand].sort((a, b) => rankOf(b) - rankOf(a));
  if (sorted.length <= n) return { fixed: sorted.map((c) => c.id), options: [], count: 0 };
  const edge = rankOf(sorted[n - 1]);
  const fixed = sorted.filter((c) => rankOf(c) > edge).map((c) => c.id);
  const options = sorted.filter((c) => rankOf(c) === edge).map((c) => c.id);
  const count = n - fixed.length;
  if (options.length <= count) return { fixed: [...fixed, ...options], options: [], count: 0 };
  return { fixed, options, count };
}

function randomIds(s: GameState, ids: string[], n: number): string[] {
  return shuffle(s, [...ids]).slice(0, n);
}

// ───────────────────────── creación de partida ─────────────────────────

export function newGame(o: GameOptions): GameState {
  const { deck, curses } = buildDeck(!!o.beta);
  const s: GameState = {
    seed: o.seed | 0,
    seq: 0,
    win: 0,
    players: o.players.map((p, i) => ({ id: i, name: p.name, bot: p.bot, hand: [], egida: null, held: false })),
    deck: [],
    pile: [],
    color: 'a',
    tinte: null,
    fx: [],
    undo: null,
    dir: 1,
    turn: 0,
    env: { mutis: false, inutilizar: false, tinieblas: null },
    phase: { t: 'turn', drawn: null },
    rafaga: null,
    stats: { played: o.players.map(() => 0), drawn: o.players.map(() => 0), turns: 0, maxCurses: o.players.map(() => 1), maxHand: o.players.map(() => 7), minHand: o.players.map(() => 7) },
    after: null,
    totalCurses: o.extraCurses ? 6 : o.players.length,
    winner: null,
    log: [],
    announce: null,
  };
  for (const p of s.players) p.hand.push(curses.pop()!);
  if (o.extraCurses) deck.push(...curses);
  s.deck = shuffle(s, o.condena === false ? deck.filter((c) => c.kind !== 'condena') : deck);
  for (let i = 0; i < 6; i++) for (const p of s.players) p.hand.push(s.deck.pop()!);
  // Primera carta de la Pila: una carta de color (no tiene efecto).
  const idx = [...s.deck.keys()].reverse().find((i) => s.deck[i].color !== null)!;
  const first = s.deck.splice(idx, 1)[0];
  s.pile.push(first);
  s.color = first.color!;
  log(s, `Comienza la partida. Carta inicial: ${cardName(first)}.`);
  beginTurn(s, Math.floor(rnd(s) * s.players.length));
  return s;
}

// ───────────────────────── flujo de turnos ─────────────────────────

function beginTurn(s: GameState, p: number) {
  s.turn = p;
  s.stats.turns++;
  s.after = null;
  const pl = s.players[p];
  if (pl.hand.some((c) => c.kind === 'condena')) {
    const absolved = pl.hand.filter((c) => c.kind === 'maldicion').length >= s.totalCurses;
    s.phase = { t: 'condena', player: p, absolved };
  } else {
    s.phase = { t: 'turn', drawn: null };
  }
}

/** Termina el efecto/turno en curso y da paso al siguiente jugador. */
function finish(s: GameState) {
  s.undo = null;
  // Comprobación estable: alguien se ha quedado sin cartas.
  for (const pl of s.players) if (pl.held && pl.hand.length > 0) pl.held = false;
  for (let i = 0; i < s.players.length; i++) {
    const p = (s.turn + i) % s.players.length;
    if (s.players[p].hand.length === 0 && !s.players[p].held && tryWin(s, p)) return;
  }
  // Dentro de una Ráfaga, tras cada carta se vuelve a elegir la siguiente.
  if (s.rafaga && resumeRafaga(s)) return;
  // Ya no se van a echar más cartas: quien jugó la última incolora elige color.
  if (s.tinte !== null) {
    s.phase = { t: 'tinte', player: s.tinte, resume: null };
    return;
  }
  const after = s.after;
  s.after = null;
  const prev = s.turn;
  const tin = s.env.tinieblas;
  if (tin && tin.owner === prev) {
    if (tin.fresh) tin.fresh = false;
    else if (++tin.count >= 3) {
      s.env.tinieblas = null;
      log(s, 'Se disipan las Tinieblas.');
    }
  }
  beginTurn(s, after?.turnTo ?? nextPlayer(s, prev));
}

// ───────────────────────── jugar una carta ─────────────────────────

function startPlay(s: GameState, p: number, card: Card) {
  takeFromHand(s, p, card.id);
  putOnPile(s, p, card);
  const pp: PendingPlay = { player: p, card, companion: null, target: null, noTarget: false, gemAsked: false };
  if (card.kind === 'antitodo') {
    const curse = s.players[p].hand.find((c) => c.kind === 'maldicion');
    if (curse) {
      takeFromHand(s, p, curse.id);
      s.pile.unshift(curse);
      fx(s, p, 'pile', 1, curse);
      log(s, `${nm(s, p)} juega Antitodo junto a una Maldición y la elimina.`);
    } else log(s, `${nm(s, p)} juega Antitodo.`);
    announce(s, p, '¡Antitodo!');
    resetEnv(s);
    dropFaceUpEgidas(s);
  } else {
    log(s, `${nm(s, p)} juega ${cardName(card)}.`);
    announce(s, p, `¡${KINDS[card.kind].name}!`, card.kind === 'mutis');
  }
  continuePlay(s, pp);
}

export function predTargets(s: GameState, L: number, e: Card): number[] {
  const all = s.players.map((p) => p.id);
  const others = all.filter((p) => p !== L);
  const attr = KINDS[e.kind].attr;
  if (attr === 'maldita' || attr === 'ataque' || e.kind === 'codicia' || e.kind === 'iman' || e.kind === 'escarcha') return others;
  return all;
}

function continuePlay(s: GameState, pp: PendingPlay) {
  const L = pp.player;
  const pl = s.players[L];
  const ask = (need: 'target' | 'card' | 'gem', options: (string | number)[]) => {
    s.phase = { t: 'choose', player: L, need, options, pp };
  };
  const pred = pp.card.kind === 'predestinar';
  if (pred && !pp.companion) return ask('card', companions(s, L, pp.card.id).map((c) => c.id));
  const e = pp.companion ?? pp.card;
  const inutil = s.env.inutilizar && e.color !== null;

  if (pp.target === null && !pp.noTarget) {
    let opts: number[] | null = null;
    if (pred) opts = predTargets(s, L, e);
    else if (e.kind === 'codicia' && !inutil) opts = s.players.filter((p) => p.id !== L && p.hand.length > 0).map((p) => p.id);
    else if (e.kind === 'purga') opts = s.players.map((p) => p.id);
    if (opts && opts.length > 0) return ask('target', opts);
    pp.noTarget = true;
  }

  if (!pp.gemAsked) {
    pp.gemAsked = true;
    const apoyo = (c: Card | null) => !!c && KINDS[c.kind].attr === 'apoyo';
    const gems = pl.hand.filter(isGem);
    if ((apoyo(pp.card) || apoyo(pp.companion)) && gems.length > 0) return ask('gem', gems.map((c) => c.id));
  }

  // Quien se queda sin cartas no gana hasta que su jugada se resuelve del todo (puede que le reflejen o le devuelvan cartas).
  runEffect(s, pp);
}

function toggleEnv(s: GameState, card: Card, by: number) {
  if (card.kind === 'mutis') {
    if (s.env.inutilizar) return log(s, 'Mutis no tiene efecto: Inutilizar está activo.');
    s.env.mutis = !s.env.mutis;
    log(s, s.env.mutis ? 'Mutis: silencio en la mesa.' : 'Mutis termina.');
  } else if (card.kind === 'inutilizar') {
    s.env.inutilizar = !s.env.inutilizar;
    log(s, s.env.inutilizar ? 'Inutilizar: las cartas de color pierden su efecto.' : 'Inutilizar termina.');
  } else if (card.kind === 'tinieblas') {
    s.env.tinieblas = s.env.tinieblas ? null : { owner: by, count: 0, fresh: true };
    log(s, s.env.tinieblas ? 'Tinieblas: todos juegan con las cartas boca abajo.' : 'Se disipan las Tinieblas.');
  }
  if (isCursedEnv(s)) log(s, '☠ Entorno maldito: nadie puede ganar mientras haya 2 o más Entornos activos.');
}

function runEffect(s: GameState, pp: PendingPlay) {
  const L = pp.player;
  const e = pp.companion ?? pp.card;
  const predestined = pp.card.kind === 'predestinar' && !pp.directed;
  const pred = predestined || !!pp.directed;
  const T = pp.target; // objetivo elegido (Predestinar, Codicia, Purga, Ráfaga)
  s.after = { turnTo: predestined ? T : null };
  if (predestined && T !== null) log(s, `${nm(s, L)} predestina ${cardName(e)} a ${nm(s, T)}, que recibe el turno.`);
  const inutil = s.env.inutilizar && e.color !== null;
  const others = s.players.filter((p) => p.id !== L).map((p) => p.id);

  if (isCursed(e)) {
    // Solo llega aquí como acompañante de Predestinar.
    return openReact(s, { k: 'gift', source: L, targets: [T!], card: e });
  }
  if (inutil && !isGem(e)) {
    log(s, `${cardName(e)} no tiene efecto por Inutilizar.`);
    return finish(s);
  }
  switch (e.kind) {
    case 'gematri': {
      const waiting = s.players.filter((p) => p.hand.some(isPlainGem)).map((p) => p.id);
      if (waiting.length === 0) return finish(s);
      s.phase = { t: 'gemas', waiting, win: ++s.win, chosen: {} };
      return;
    }
    case 'aplastar': {
      dropFaceUpEgidas(s);
      s.phase = { t: 'aplastar', launcher: L, amount: 3, players: others, slapped: [], win: ++s.win };
      return;
    }
    case 'cristalizar':
      return openReact(s, { k: 'cristal', source: L, targets: pred ? [T!] : others, tone: e.tone! });
    case 'travesura':
    case 'trastada': {
      const target = pred ? T! : nextPlayer(s, L);
      s.after = { turnTo: target };
      const big = e.kind === 'trastada';
      return openReact(s, { k: 'trav', launchers: big ? [L, L] : [L], targets: [target], amount: big ? 3 : 2, noChain: false, given: [], last: e.kind });
    }
    case 'escarcha':
      return openReact(s, { k: 'escarcha', source: L, targets: others });
    case 'rafaga':
      if (s.rafaga) return finish(s); // una Ráfaga dentro de otra no tiene efecto
      // Es de Apoyo: no se puede defender ni reflejar, se resuelve directamente.
      return resolve(s, { k: 'rafaga', source: L, targets: others }, []);
    case 'codicia':
      if (T === null) return finish(s);
      return openReact(s, { k: 'codicia', source: L, targets: [T] });
    case 'purga':
      if (T === null) return finish(s);
      return openReact(s, { k: 'purga', source: L, targets: [T] });
    case 'iman':
      return openReact(s, { k: 'iman', source: L, targets: pred ? [T!] : others });
    case 'adivinar': {
      const actor = pred ? T! : L;
      const cards: Card[] = [];
      const fxBefore = s.fx.length;
      for (let i = 0; i < 3; i++) {
        const got = drawCards(s, actor, 1);
        if (!got.length) break;
        cards.push(s.players[actor].hand.pop()!);
      }
      s.fx.length = fxBefore; // solo se miran: no viajan a la mano
      if (!cards.length) return finish(s);
      s.phase = { t: 'adivinar', player: actor, cards };
      return;
    }
    case 'recuperar': {
      const actor = pred ? T! : L;
      const top = topCard(s);
      const options = s.pile.filter((c) => c.id !== top.id && c.id !== pp.card.id && c.kind !== 'recuperar').map((c) => c.id);
      if (!options.length) return finish(s);
      s.phase = { t: 'recuperar', player: actor, options };
      return;
    }
    case 'mutis':
    case 'inutilizar':
    case 'tinieblas':
      toggleEnv(s, e, L);
      return finish(s);
    default:
      return finish(s); // gemas, antitodo
  }
}

// ───────────────────────── reacciones ─────────────────────────

function openReact(s: GameState, eff: Effect) {
  if (!s.undo) s.undo = { dir: s.dir, spent: [] };
  const waiting = s.players.filter((p) => reactOptionsFor(s, p.id, eff).length > 0).map((p) => p.id);
  if (waiting.length === 0) return resolve(s, eff, []);
  s.phase = { t: 'react', eff, waiting, exempt: [], win: ++s.win };
}

function purge(s: GameState, p: number) {
  const pl = s.players[p];
  const n = pl.hand.length;
  s.pile.unshift(...pl.hand);
  fx(s, p, 'pile', n);
  pl.hand = [];
  drawCards(s, p, n);
  log(s, `${nm(s, p)} descarta su mano y roba ${n}.`);
}

function resolve(s: GameState, eff: Effect, exempt: number[]) {
  const targets = eff.targets.filter((t) => !exempt.includes(t));
  switch (eff.k) {
    case 'draw':
    case 'cristal': {
      if (eff.k === 'cristal') {
        // Las Gemas enseñadas se echan todas a la vez.
        for (const h of eff.held ?? []) {
          let n = 0;
          for (const id of h.ids) {
            const c = takeFromHand(s, h.p, id);
            if (!c) continue;
            s.pile.unshift(c);
            fx(s, h.p, 'pile', 1, c);
            n++;
          }
          if (n) log(s, `${nm(s, h.p)} echa ${n} Gema(s) ${h.p === eff.source ? 'con su Cristalizar' : 'y se libra de Cristalizar'}.`);
        }
        eff.held = [];
      }
      const n = eff.k === 'draw' ? eff.amount : 3;
      for (const t of targets) {
        drawCards(s, t, n);
        log(s, `${nm(s, t)} roba ${n}.`);
      }
      return finish(s);
    }
    case 'trav': {
      const t = targets[0];
      if (t === undefined) return finish(s);
      // Ahora que ya se sabe quién la recibe, cada lanzador elige las cartas que da.
      const need: Record<number, number> = {};
      for (const g of eff.launchers) if (g !== t) need[g] = (need[g] ?? 0) + 1;
      const waiting: number[] = [];
      for (const g of Object.keys(need).map(Number)) {
        need[g] = Math.min(need[g], s.players[g].hand.length);
        if (!need[g]) continue;
        if (isBlind(s)) {
          for (const id of randomIds(s, s.players[g].hand.map((c) => c.id), need[g])) eff.given.push({ from: g, card: takeFromHand(s, g, id)! });
        } else waiting.push(g);
      }
      if (!waiting.length) return deliverTrav(s, eff, t);
      s.phase = { t: 'give', eff, waiting, need, target: t };
      return;
    }
    case 'escarcha':
    case 'rescarcha': {
      const tg = targets.filter((x) => x !== eff.source);
      if (!tg.length) return finish(s);
      log(s, `${nm(s, eff.source)} congela el tiempo: puede mover las cartas de ${tg.length > 1 ? 'los oponentes' : nm(s, tg[0])}.`);
      s.phase = { t: 'escarcha', player: eff.source, targets: tg };
      return;
    }
    case 'rafaga': {
      const allowed = [eff.source, ...targets.filter((x) => x !== eff.source)];
      s.rafaga = { player: eff.source, turn: s.turn, pool: takeDeck(s, 5), own: true, allowed };
      log(s, `Ráfaga: ${nm(s, eff.source)} revela ${s.rafaga.pool.length} cartas del Mazo para jugarlas.`);
      if (!resumeRafaga(s)) finish(s);
      return;
    }
    case 'codicia': {
      const t = targets[0];
      if (t === undefined) return finish(s);
      const L = eff.source;
      const sp = tieSplit(s.players[t].hand, 1, true);
      const lh = s.players[L].hand;
      if (isBlind(s)) {
        const best = sp.fixed[0] ?? randomIds(s, sp.options, 1)[0] ?? null;
        return doCodicia(s, L, t, lh.length ? lh[Math.floor(rnd(s) * lh.length)].id : null, best);
      }
      const waiting: number[] = [];
      if (sp.count > 0) waiting.push(t);
      if (lh.length > 0) waiting.push(L);
      if (!waiting.length) return doCodicia(s, L, t, null, sp.fixed[0] ?? null);
      s.phase = { t: 'codicia', launcher: L, target: t, options: sp.options, give: null, best: sp.fixed[0] ?? null, waiting };
      return;
    }
    case 'purga':
    case 'rpurga':
      for (const t of targets) purge(s, t);
      return finish(s);
    case 'iman':
    case 'riman': {
      const picks: Record<number, TieSplit> = {};
      const chosen: Record<number, string[]> = {};
      const waiting: number[] = [];
      for (const t of targets) {
        const sp = tieSplit(s.players[t].hand, eff.k === 'riman' ? 3 : 1, false);
        if (sp.count > 0 && !isBlind(s)) {
          picks[t] = sp;
          waiting.push(t);
        } else chosen[t] = [...sp.fixed, ...randomIds(s, sp.options, sp.count)];
      }
      s.phase = { t: 'imanPick', source: eff.source, targets, picks, chosen, waiting };
      if (!waiting.length) buildImanPool(s);
      return;
    }
    case 'rcodicia': {
      // Todos (menos quien reflejó) pasan su mano al siguiente según el sentido.
      const ring: number[] = [];
      for (let p = nextPlayer(s, eff.source); p !== eff.source; p = nextPlayer(s, p)) if (targets.includes(p)) ring.push(p);
      if (ring.length > 1) {
        const hands = ring.map((p) => s.players[p].hand);
        ring.forEach((p, i) => {
          const from = (i - 1 + ring.length) % ring.length;
          s.players[p].hand = hands[from];
          fx(s, ring[from], p, hands[from].length);
        });
        log(s, 'Codicia reflejada: todos pasan su mano al siguiente jugador.');
      }
      return finish(s);
    }
    case 'gift': {
      const t = targets[0];
      if (t === undefined) {
        s.pile.unshift(eff.card);
        log(s, `${cardName(eff.card)} queda descartada.`);
      } else {
        s.players[t].hand.push(eff.card);
        fx(s, eff.source, t);
        log(s, `${nm(s, t)} recibe ${isCursed(eff.card) ? cardName(eff.card) : 'una carta'} de ${nm(s, eff.source)}.`);
      }
      return finish(s);
    }
  }
}

/** Entrega las cartas elegidas por los lanzadores y el robo acumulado. */
function deliverTrav(s: GameState, eff: TravEff, t: number) {
  for (const g of eff.given) {
    s.players[t].hand.push(g.card);
    fx(s, g.from, t);
  }
  drawCards(s, t, eff.amount);
  log(s, `${nm(s, t)} recibe ${eff.given.length} carta(s) y roba ${eff.amount}.`);
  eff.given = [];
  finish(s);
}

/** Vuelve a la Ráfaga en curso (siguiente lote si hace falta). Devuelve false si ya ha terminado. */
function resumeRafaga(s: GameState): boolean {
  const r = s.rafaga;
  if (!r || s.phase.t === 'over') return false;
  s.turn = r.turn;
  s.after = null;
  s.undo = null;
  if (!r.pool.length && !(r.own && s.players[r.player].hand.length > 0)) {
    s.rafaga = null;
    return false;
  }
  s.phase = { t: 'rafaga' };
  return true;
}

function doCodicia(s: GameState, L: number, t: number, giveId: string | null, bestId: string | null) {
  // Si alguna de las cartas elegidas ya no está en la mano (se duplicó entretanto), se toma otra.
  const lh = s.players[L].hand;
  const th = s.players[t].hand;
  if (giveId && !lh.some((c) => c.id === giveId)) giveId = lh.length ? lh[Math.floor(rnd(s) * lh.length)].id : null;
  if (!bestId || !th.some((c) => c.id === bestId)) {
    const sp = tieSplit(th, 1, true);
    bestId = sp.fixed[0] ?? randomIds(s, sp.options, 1)[0] ?? null;
  }
  const mine = giveId ? takeFromHand(s, L, giveId) : null;
  const best = bestId ? takeFromHand(s, t, bestId) : null;
  if (best) s.players[L].hand.push(best);
  if (mine) s.players[t].hand.push(mine);
  fx(s, t, L, best ? 1 : 0);
  fx(s, L, t, mine ? 1 : 0);
  log(s, `Codicia: ${nm(s, t)} entrega su mejor carta a ${nm(s, L)} y recibe otra a cambio.`);
  finish(s);
}

function buildImanPool(s: GameState) {
  const ph = s.phase;
  if (ph.t !== 'imanPick') return;
  const pool: Card[] = [];
  for (const t of ph.targets) {
    const gems = s.players[t].hand.filter(isGem).map((c) => c.id);
    const top = ph.chosen[t] ?? [];
    let g = 0, b = 0;
    for (const id of [...gems, ...top]) {
      const c = takeFromHand(s, t, id);
      if (c) {
        pool.push(c);
        fx(s, t, ph.source, 1, c);
        if (gems.includes(id)) g++; else b++;
      }
    }
    if (g + b) log(s, `Imán: ${nm(s, t)} entrega ${b ? (b > 1 ? `sus ${b} mejores cartas` : 'su mejor carta') : ''}${b && g ? ' y ' : ''}${g ? `${g} Gema(s)` : ''}.`);
  }
  for (const t of ph.targets)
    if (s.players[t].hand.length === 0) {
      s.players[t].held = true;
      log(s, `${nm(s, t)} se queda sin cartas por el Imán: están retenidas y no gana.`);
    }
  if (!pool.length) return finish(s);
  log(s, `El Imán de ${nm(s, ph.source)} atrae ${pool.length} carta(s).`);
  s.phase = { t: 'iman', launcher: ph.source, pool: shuffle(s, pool) };
}

function handleReact(s: GameState, a: Extract<Action, { type: 'react' }>, guessed = false): boolean {
  const ph = s.phase;
  if (ph.t !== 'react' || !ph.waiting.includes(a.player)) return false;
  const p = a.player;
  const pl = s.players[p];
  const eff = ph.eff;
  if (!guessed && a.r !== 'pass' && !reactOptionsFor(s, p, eff).includes(a.r)) return false;
  if (a.r === 'blind') {
    const c = pl.hand.find((x) => x.id === a.cardId);
    if (!c) return false;
    let as: ReactKind | null = null;
    if (c.kind === 'egida' && eff.k !== 'gift') as = 'egida';
    else if (c.kind === 'antitodo') as = 'antitodo';
    else if (c.kind === 'reflejo' && eff.k !== 'cristal' && eff.k !== 'gift') as = 'reflejo';
    else if (isTrav(c) && eff.k === 'trav' && !eff.noChain && !(s.env.inutilizar && c.color)) as = 'chain';
    else if (eff.k === 'cristal' && ((isPlainGem(c) && c.color === eff.tone) || c.kind === 'gematri')) as = 'gem';
    if (!as) {
      log(s, `${nm(s, p)} prueba suerte a ciegas con ${cardName(c)}: no le sirve. Roba 1.`);
      drawCards(s, p, 1);
      ph.waiting = ph.waiting.filter((x) => x !== p);
      if (!ph.waiting.length) resolve(s, eff, ph.exempt);
      return true;
    }
    log(s, `${nm(s, p)} acierta a ciegas con ${cardName(c)}.`);
    // A ciegas el Reflejo vuelve contra quien lanzó el efecto (o contra otro al azar si fue uno mismo).
    const src = eff.k === 'trav' ? eff.launchers[eff.launchers.length - 1] : eff.source;
    const others = s.players.filter((x) => x.id !== p).map((x) => x.id);
    const target = a.target ?? (src !== p ? src : others[Math.floor(rnd(s) * others.length)]);
    if (as === 'egida' && !pl.egida) {
      // Se usa exactamente la carta elegida.
      takeFromHand(s, p, c.id);
      pl.hand.unshift(c);
    }
    return handleReact(s, { ...a, r: as, cardId: c.id, target }, true);
  }
  const done = () => {
    ph.waiting = ph.waiting.filter((x) => x !== p);
    if (!ph.waiting.length) resolve(s, eff, ph.exempt);
  };
  switch (a.r) {
    case 'pass':
      done();
      return true;
    case 'egida': {
      if (pl.egida) {
        s.undo?.spent.push({ p, card: pl.egida, from: 'up' });
        s.pile.unshift(pl.egida);
        pl.egida = null;
        log(s, `${nm(s, p)} se protege con su Égida (último uso).`);
      } else {
        const c = pl.hand.find((x) => x.kind === 'egida')!;
        takeFromHand(s, p, c.id);
        pl.egida = c;
        s.undo?.spent.push({ p, card: c, from: 'hand' });
        log(s, `${nm(s, p)} se protege con Égida.`);
      }
      announce(s, p, '¡Égida!');
      s.tinte = p;
      ph.exempt.push(p);
      done();
      return true;
    }
    case 'antitodo': {
      const c = pl.hand.find((x) => x.kind === 'antitodo')!;
      takeFromHand(s, p, c.id);
      putOnPile(s, p, c);
      // Antitodo lo anula todo: el efecto no alcanza a nadie y lo gastado en defenderse vuelve a su dueño.
      const u = s.undo;
      if (u) {
        // Se deshace en orden inverso al que se gastó.
        for (const sp of [...u.spent].reverse()) {
          const owner = s.players[sp.p];
          if (sp.from === 'hand') {
            if (owner.egida?.id === sp.card.id) {
              owner.egida = null;
              owner.hand.push(sp.card);
            }
            continue;
          }
          const i = s.pile.findIndex((x) => x.id === sp.card.id);
          if (i < 0) continue;
          s.pile.splice(i, 1);
          if (sp.from === 'up') owner.egida = sp.card;
          else {
            owner.hand.push(sp.card);
            fx(s, 'pile', sp.p);
          }
        }
        if (u.spent.length) log(s, 'Antitodo lo anula todo: las cartas usadas para defenderse vuelven a sus dueños.');
        u.spent = [];
        s.dir = u.dir;
      }
      resetEnv(s);
      dropFaceUpEgidas(s);
      if (eff.k === 'cristal') eff.held = []; // las Gemas enseñadas se quedan en su mano
      log(s, `${nm(s, p)} usa Antitodo: el efecto queda anulado para todos.`);
      announce(s, p, '¡Antitodo!');
      ph.waiting = [];
      resolve(s, eff, [...eff.targets]);
      return true;
    }
    case 'gem': {
      if (eff.k !== 'cristal') return false;
      const c = pl.hand.find((x) => x.id === a.cardId);
      if (!c || !((isPlainGem(c) && c.color === eff.tone) || c.kind === 'gematri')) return false;
      (eff.held ??= []).push({ p, ids: [c.id] });
      log(s, `${nm(s, p)} enseña ${cardName(c)} para librarse de Cristalizar.`);
      ph.exempt.push(p);
      done();
      return true;
    }
    case 'gems': {
      if (eff.k !== 'cristal') return false;
      const ids = [...new Set(a.ids ?? [])].filter((id) => {
        const c = pl.hand.find((x) => x.id === id);
        return c && ((isPlainGem(c) && c.color === eff.tone) || c.kind === 'gematri');
      });
      if (ids.length) {
        (eff.held ??= []).push({ p, ids });
        log(s, `${nm(s, p)} enseña ${ids.length} Gema(s) para dejarlas con su Cristalizar.`);
      }
      done();
      return true;
    }
    case 'chain': {
      if (eff.k !== 'trav') return false;
      const c = pl.hand.find((x) => x.id === a.cardId);
      if (!c || !isTrav(c) || (s.env.inutilizar && c.color)) return false;
      takeFromHand(s, p, c.id);
      putOnPile(s, p, c);
      s.turn = p;
      const target = nextPlayer(s, p);
      const big = c.kind === 'trastada';
      log(s, `${nm(s, p)} encadena ${cardName(c)}: el efecto se acumula sobre ${nm(s, target)}.`);
      announce(s, p, `¡${KINDS[c.kind].name}!`);
      s.after = { turnTo: target };
      openReact(s, { k: 'trav', launchers: [...eff.launchers, ...(big ? [p, p] : [p])], targets: [target], amount: eff.amount + (big ? 3 : 2), noChain: false, given: [], last: c.kind as 'travesura' | 'trastada' });
      return true;
    }
    case 'reflejo': {
      const needsTarget = eff.k === 'draw' || eff.k === 'trav';
      if (needsTarget && (a.target === undefined || a.target === p || !s.players[a.target])) return false;
      const c = pl.hand.find((x) => x.kind === 'reflejo')!;
      takeFromHand(s, p, c.id);
      putOnPile(s, p, c);
      s.undo?.spent.push({ p, card: c, from: 'pile' });
      s.dir = s.dir === 1 ? -1 : 1;
      announce(s, p, '¡Reflejo!');
      const everyone = s.players.filter((x) => x.id !== p).map((x) => x.id);
      let ne: Effect;
      if (eff.k === 'draw') ne = { k: 'draw', source: p, targets: [a.target!], amount: eff.amount, aplastar: false };
      else if (eff.k === 'trav') {
        // Solo se refleja la última carta de la cadena; lo acumulado antes se pierde.
        const big = eff.last === 'trastada';
        ne = { k: 'trav', launchers: big ? [p, p] : [p], targets: [a.target!], amount: big ? 3 : 2, noChain: true, given: [], last: eff.last };
      }
      else if (eff.k === 'escarcha' || eff.k === 'rescarcha') ne = { k: 'rescarcha', source: p, targets: everyone };
      else if (eff.k === 'codicia' || eff.k === 'rcodicia') ne = { k: 'rcodicia', source: p, targets: everyone };
      else if (eff.k === 'purga' || eff.k === 'rpurga') ne = { k: 'rpurga', source: p, targets: everyone };
      else if (eff.k === 'iman' || eff.k === 'riman') ne = { k: 'riman', source: p, targets: everyone };
      else return false;
      log(s, `${nm(s, p)} usa Reflejo${needsTarget ? ` contra ${nm(s, a.target!)}` : ': la Magia se refleja a todos'}. Cambia el sentido.`);
      openReact(s, ne);
      return true;
    }
  }
}

// ───────────────────────── duplicar ─────────────────────────

function handleDup(s: GameState, p: number, cardId: string): boolean {
  const c = s.players[p].hand.find((x) => x.id === cardId);
  if (!c || !canDup(s, p, c)) return false;
  takeFromHand(s, p, c.id);
  putOnPile(s, p, c);
  log(s, `${nm(s, p)} duplica ${cardName(c)}.`);
  announce(s, p, '¡Duplicar!');
  const ph = s.phase;
  const attr = KINDS[c.kind].attr;
  const inutil = s.env.inutilizar && c.color !== null;
  if (attr === 'entorno') toggleEnv(s, c, p);
  else if (attr === 'ataque' && !inutil) {
    if (ph.t === 'aplastar' && c.kind === 'aplastar') {
      ph.amount += 3;
      log(s, `Aplastar se multiplica: el último robará ${ph.amount}.`);
    } else if (ph.t === 'react' && ph.eff.k === 'draw' && ph.eff.aplastar && c.kind === 'aplastar') {
      ph.eff.amount += 3;
    } else if (ph.t === 'react' && ph.eff.k === 'trav' && !ph.eff.noChain && c.kind === 'travesura') {
      // Quien duplica también dará una carta suya al final.
      ph.eff.launchers.push(p);
      ph.eff.amount += 2;
      ph.eff.last = 'travesura';
      log(s, `Travesura se multiplica: ${nm(s, ph.eff.targets[0])} recibirá ${ph.eff.launchers.length} carta(s) y robará ${ph.eff.amount}.`);
    }
  }
  // Duplicando en mitad de una acción no se gana al instante: se comprueba cuando la acción termina.
  if (ph.t === 'turn' && tryWin(s, p)) return true;
  settleTinte(s);
  return true;
}

// ───────────────────────── reductor principal ─────────────────────────

export function apply(prev: GameState, a: Action): GameState {
  if (prev.phase.t === 'over') return prev;
  const s: GameState = structuredClone(prev);
  s.seq++;
  s.fx = [];
  if (!step(s, a)) return prev;
  // Récords para el resumen final.
  s.players.forEach((pl, i) => {
    const n = pl.hand.length;
    s.stats.maxHand[i] = Math.max(s.stats.maxHand[i], n);
    if (!pl.held) s.stats.minHand[i] = Math.min(s.stats.minHand[i], n);
    s.stats.maxCurses[i] = Math.max(s.stats.maxCurses[i], pl.hand.filter((c) => c.kind === 'maldicion').length);
  });
  // Quien reúne los 3 Rituales en la mano gana al instante.
  if (s.phase.t !== 'over')
    for (const pl of s.players)
      if (RITUALS.every((k) => pl.hand.some((c) => c.kind === k))) {
        s.winner = pl.id;
        s.phase = { t: 'over' };
        s.after = null;
        s.rafaga = null;
        log(s, `🏆 ${nm(s, pl.id)} reúne los 3 Rituales y gana la partida.`);
        break;
      }
  return s;
}

function step(s: GameState, a: Action): boolean {
  const ph = s.phase;
  switch (a.type) {
    case 'play': {
      if (ph.t !== 'turn' || s.turn !== a.player) return false;
      const c = s.players[a.player].hand.find((x) => x.id === a.cardId);
      if (!c || (ph.drawn && ph.drawn !== c.id)) return false;
      if (!isLegal(s, a.player, c)) {
        if (!isBlind(s)) return false;
        log(s, `${nm(s, a.player)} juega a ciegas ${cardName(c)}: no se puede encadenar. Roba 1 y pierde el turno.`);
        drawCards(s, a.player, 1);
        finish(s);
        return true;
      }
      startPlay(s, a.player, c);
      return true;
    }
    case 'draw': {
      if (ph.t !== 'turn' || s.turn !== a.player || ph.drawn) return false;
      if (isBlind(s)) {
        const got = drawCards(s, a.player, 3);
        log(s, `${nm(s, a.player)} roba ${got.length} (Tinieblas).`);
        finish(s);
        return true;
      }
      const [c] = drawCards(s, a.player, 1);
      log(s, `${nm(s, a.player)} roba una carta.`);
      if (c && isLegal(s, a.player, c)) ph.drawn = c.id;
      else finish(s);
      return true;
    }
    case 'keep':
      if (ph.t !== 'turn' || s.turn !== a.player || !ph.drawn) return false;
      finish(s);
      return true;
    case 'choose': {
      if (ph.t !== 'choose' || ph.player !== a.player) return false;
      const pp = ph.pp;
      if (ph.need === 'gem' && a.value === null) {
        continuePlay(s, pp);
        return true;
      }
      if (a.value === null || !ph.options.includes(a.value)) return false;
      if (ph.need === 'target') {
        pp.target = a.value as number;
      } else if (ph.need === 'card') {
        const c = takeFromHand(s, a.player, a.value as string)!;
        pp.companion = c;
        if (!isCursed(c)) putOnPile(s, a.player, c);
      } else {
        const c = takeFromHand(s, a.player, a.value as string)!;
        s.pile.unshift(c);
        fx(s, a.player, 'pile', 1, c);
        log(s, `${nm(s, a.player)} descarta ${cardName(c)} debajo de su carta de Apoyo.`);
      }
      continuePlay(s, pp);
      return true;
    }
    case 'color': {
      if (ph.t !== 'tinte' || ph.player !== a.player || !COLORS.includes(a.color)) return false;
      s.color = a.color;
      s.tinte = null;
      log(s, `${nm(s, a.player)} elige color ${COLOR_NAME[s.color]}.`);
      if (ph.resume) s.phase = ph.resume;
      else finish(s);
      return true;
    }
    case 'dup':
      return handleDup(s, a.player, a.cardId);
    case 'antitodo': {
      if (!canFreeAntitodo(s, a.player)) return false;
      const c = s.players[a.player].hand.find((x) => x.kind === 'antitodo')!;
      takeFromHand(s, a.player, c.id);
      putOnPile(s, a.player, c);
      resetEnv(s);
      dropFaceUpEgidas(s);
      log(s, `${nm(s, a.player)} juega Antitodo fuera de turno: se reinician los Entornos.`);
      announce(s, a.player, '¡Antitodo!');
      if (!tryWin(s, a.player)) settleTinte(s);
      return true;
    }
    case 'react':
      return handleReact(s, a);
    case 'slap': {
      if (ph.t !== 'aplastar' || !ph.players.includes(a.player) || ph.slapped.includes(a.player)) return false;
      ph.slapped.push(a.player);
      if (ph.slapped.length >= ph.players.length - 1) endAplastar(s);
      return true;
    }
    case 'give': {
      if (ph.t === 'give') {
        if (!ph.waiting.includes(a.player)) return false;
        const ids = [...new Set(a.ids ?? [a.cardId])];
        const hand = s.players[a.player].hand;
        if (ids.length !== ph.need[a.player] || !ids.every((id) => hand.some((c) => c.id === id))) return false;
        for (const id of ids) ph.eff.given.push({ from: a.player, card: takeFromHand(s, a.player, id)! });
        ph.waiting = ph.waiting.filter((x) => x !== a.player);
        if (!ph.waiting.length) deliverTrav(s, ph.eff, ph.target);
        return true;
      }
      if (ph.t === 'codicia' && ph.launcher === a.player && ph.waiting.includes(a.player)) {
        if (!s.players[a.player].hand.some((c) => c.id === a.cardId)) return false;
        ph.give = a.cardId;
        ph.waiting = ph.waiting.filter((x) => x !== a.player);
        if (!ph.waiting.length) doCodicia(s, ph.launcher, ph.target, ph.give, ph.best);
        return true;
      }
      return false;
    }
    case 'pick': {
      const ids = [...new Set(a.ids)];
      if (ph.t === 'codicia' && ph.target === a.player && ph.waiting.includes(a.player)) {
        if (ids.length !== 1 || !ph.options.includes(ids[0])) return false;
        ph.best = ids[0];
        ph.waiting = ph.waiting.filter((x) => x !== a.player);
        if (!ph.waiting.length) doCodicia(s, ph.launcher, ph.target, ph.give, ph.best);
        return true;
      }
      if (ph.t === 'imanPick' && ph.waiting.includes(a.player)) {
        const sp = ph.picks[a.player];
        if (ids.length !== sp.count || !ids.every((id) => sp.options.includes(id))) return false;
        ph.chosen[a.player] = [...sp.fixed, ...ids];
        ph.waiting = ph.waiting.filter((x) => x !== a.player);
        if (!ph.waiting.length) buildImanPool(s);
        return true;
      }
      return false;
    }
    case 'iman': {
      if (ph.t !== 'iman' || ph.launcher !== a.player) return false;
      const count: Record<string, number> = {};
      for (const c of ph.pool) {
        const d = a.assign[c.id] ?? 'discard';
        if (d !== 'discard') {
          if (typeof d === 'number' && (d === a.player || !s.players[d])) return false;
          count[d] = (count[d] ?? 0) + 1;
          if (count[d] > 3) return false;
        }
      }
      let kept = 0, back = 0, gone = 0;
      for (const c of ph.pool) {
        const d = a.assign[c.id] ?? 'discard';
        if (d === 'keep') { s.players[a.player].hand.push(c); kept++; }
        else if (d === 'discard') { s.pile.unshift(c); gone++; fx(s, a.player, 'pile'); }
        else { s.players[d].hand.push(c); back++; fx(s, a.player, d); }
      }
      log(s, `${nm(s, a.player)} se queda ${kept}, devuelve ${back} y elimina ${gone} carta(s) imantadas.`);
      finish(s);
      return true;
    }
    case 'escarcha': {
      if (ph.t !== 'escarcha' || ph.player !== a.player) return false;
      const owner: Record<string, number> = {};
      for (const t of ph.targets) for (const c of s.players[t].hand) owner[c.id] = t;
      const after = ph.targets.flatMap((t) => a.hands[t] ?? []);
      if (after.length !== Object.keys(owner).length || new Set(after).size !== after.length || !after.every((id) => id in owner)) return false;
      if (ph.targets.some((t) => (a.hands[t] ?? []).length !== s.players[t].hand.length)) return false;
      const me = s.players[a.player];
      if (a.give && (!me.hand.some((c) => c.id === a.give!.cardId) || !ph.targets.includes(a.give.to))) return false;
      const byId: Record<string, Card> = {};
      for (const t of ph.targets) for (const c of s.players[t].hand) byId[c.id] = c;
      let moved = 0;
      for (const t of ph.targets) {
        s.players[t].hand = a.hands[t].map((id) => byId[id]);
        for (const id of a.hands[t])
          if (owner[id] !== t) {
            fx(s, owner[id], t);
            moved++;
          }
      }
      log(s, `Escarcha: ${nm(s, a.player)} cambia de mano ${moved} carta(s).`);
      if (a.give) {
        const c = takeFromHand(s, a.player, a.give.cardId)!;
        s.players[a.give.to].hand.push(c);
        fx(s, a.player, a.give.to);
        log(s, `${nm(s, a.player)} da ${isCursed(c) ? cardName(c) : 'una carta'} a ${nm(s, a.give.to)}.`);
      }
      finish(s);
      return true;
    }
    case 'rafaga': {
      const r = s.rafaga;
      if (ph.t !== 'rafaga' || !r || r.player !== a.player) return false;
      const L = r.player;
      if (a.cardId === null) {
        for (const c of r.pool) {
          s.pile.unshift(c);
          fx(s, 'deck', 'pile', 1, c);
        }
        if (r.pool.length) log(s, `Ráfaga: ${nm(s, L)} descarta ${r.pool.length} carta(s).`);
        r.pool = [];
        r.own = false;
        finish(s);
        return true;
      }
      let c = r.pool.find((x) => x.id === a.cardId);
      const fromHand = !c && r.own;
      if (fromHand) c = s.players[L].hand.find((x) => x.id === a.cardId);
      if (!c) return false;
      const T = a.target;
      if (T === undefined || !s.players[T]) return false;
      if (!r.allowed.includes(T) || !predTargets(s, L, c).includes(T)) return false;
      if (fromHand) {
        takeFromHand(s, L, c.id);
        r.own = false;
      } else r.pool = r.pool.filter((x) => x.id !== c!.id);
      log(s, `Ráfaga: ${nm(s, L)} juega ${cardName(c)} contra ${T === L ? 'sí mismo' : nm(s, T)}.`);
      if (isCursed(c)) {
        // Una carta maldita jugada contra alguien se le entrega.
        openReact(s, { k: 'gift', source: L, targets: [T], card: c });
        return true;
      }
      s.pile.push(c);
      s.stats.played[L]++;
      fx(s, fromHand ? L : 'deck', 'pile', 1, c);
      if (c.color) {
        s.color = c.color;
        s.tinte = null;
      } else s.tinte = L;
      announce(s, L, `¡${KINDS[c.kind].name}!`, c.kind === 'mutis');
      if (c.kind === 'antitodo') {
        resetEnv(s);
        dropFaceUpEgidas(s);
      }
      runEffect(s, { player: L, card: c, companion: null, target: T, noTarget: true, gemAsked: true, directed: true });
      return true;
    }
    case 'adivinar': {
      if (ph.t !== 'adivinar' || ph.player !== a.player) return false;
      const all = [...a.keep, ...a.discard, ...a.back];
      if (all.length !== ph.cards.length || new Set(all).size !== all.length || !ph.cards.every((c) => all.includes(c.id))) return false;
      const by = (id: string) => ph.cards.find((c) => c.id === id)!;
      for (const id of a.keep) s.players[a.player].hand.push(by(id));
      fx(s, 'deck', a.player, a.keep.length);
      for (const id of a.discard) s.pile.unshift(by(id));
      for (const id of [...a.back].reverse()) s.deck.push(by(id));
      log(s, `${nm(s, a.player)} adivina: se queda ${a.keep.length}, descarta ${a.discard.length} y devuelve ${a.back.length} al Mazo.`);
      finish(s);
      return true;
    }
    case 'recuperar': {
      if (ph.t !== 'recuperar' || ph.player !== a.player || !ph.options.includes(a.cardId) || !s.players[a.to]) return false;
      const i = s.pile.findIndex((c) => c.id === a.cardId);
      const [c] = s.pile.splice(i, 1);
      if (a.to === a.player) {
        s.players[a.player].hand.push(c);
        fx(s, 'pile', a.player, 1, c);
        log(s, `${nm(s, a.player)} recupera ${cardName(c)} de la Pila.`);
        finish(s);
      } else {
        log(s, `${nm(s, a.player)} recupera ${cardName(c)} de la Pila para ${nm(s, a.to)}.`);
        openReact(s, { k: 'gift', source: a.player, targets: [a.to], card: c });
      }
      return true;
    }
    case 'gemas': {
      if (ph.t !== 'gemas' || !ph.waiting.includes(a.player)) return false;
      // Cada uno enseña las Gemas que va a descartar; se echan todas a la vez cuando han elegido todos.
      ph.chosen[a.player] = [...new Set(a.ids)].filter((id) => s.players[a.player].hand.some((c) => c.id === id && isPlainGem(c)));
      ph.waiting = ph.waiting.filter((x) => x !== a.player);
      if (!ph.waiting.length) applyGemas(s);
      return true;
    }
    case 'search': {
      if (ph.t !== 'condena' || ph.player !== a.player || ph.absolved) return false;
      let src: Card[];
      let where: string;
      if (a.where === 'deck') { src = s.deck; where = 'el Mazo'; }
      else if (a.where === 'pile') { src = s.pile.slice(0, -1); where = 'la Pila'; }
      else if (s.players[a.where] && a.where !== a.player) { src = s.players[a.where].hand; where = `la mano de ${nm(s, a.where)}`; }
      else return false;
      const found = src.find((c) => c.kind === 'maldicion');
      if (!found) {
        log(s, `Condena: ${nm(s, a.player)} busca una Maldición en ${where} y no la encuentra. Pierde el turno.`);
        finish(s);
        return true;
      }
      if (a.where === 'deck') {
        s.deck.splice(s.deck.indexOf(found), 1);
        shuffle(s, s.deck);
      } else if (a.where === 'pile') s.pile.splice(s.pile.indexOf(found), 1);
      else takeFromHand(s, a.where, found.id);
      s.players[a.player].hand.push(found);
      fx(s, a.where, a.player);
      log(s, `Condena: ${nm(s, a.player)} encuentra una Maldición en ${where} y se la queda.`);
      const absolved = s.players[a.player].hand.filter((c) => c.kind === 'maldicion').length >= s.totalCurses;
      s.phase = absolved ? { t: 'condena', player: a.player, absolved: true } : { t: 'turn', drawn: null };
      return true;
    }
    case 'absolve': {
      if (ph.t !== 'condena' || ph.player !== a.player || !ph.absolved) return false;
      const c = s.players[a.player].hand.find((x) => x.kind === 'condena')!;
      takeFromHand(s, a.player, c.id);
      s.after = { turnTo: a.player };
      if (a.to === null || a.to === a.player || !s.players[a.to]) {
        s.pile.unshift(c);
        log(s, `${nm(s, a.player)} queda absuelto y descarta Condena.`);
        finish(s);
      } else {
        log(s, `${nm(s, a.player)} queda absuelto y entrega Condena a ${nm(s, a.to)}.`);
        openReact(s, { k: 'gift', source: a.player, targets: [a.to], card: c });
      }
      return true;
    }
    case 'penalize': {
      if (!s.players[a.target]) return false;
      drawCards(s, a.target, 3);
      log(s, `El anfitrión señala una falta: ${nm(s, a.target)} roba 3.`);
      return true;
    }
    case 'timeout': {
      if (ph.t === 'react') { resolve(s, ph.eff, ph.exempt); return true; }
      if (ph.t === 'aplastar') { endAplastar(s); return true; }
      if (ph.t === 'gemas') { applyGemas(s); return true; }
      return false;
    }
  }
}

function applyGemas(s: GameState) {
  const ph = s.phase;
  if (ph.t !== 'gemas') return;
  for (const [p, ids] of Object.entries(ph.chosen)) {
    let n = 0;
    for (const id of ids) {
      const c = takeFromHand(s, +p, id);
      if (!c) continue;
      s.pile.unshift(c);
      fx(s, +p, 'pile', 1, c);
      n++;
    }
    if (n) log(s, `${nm(s, +p)} descarta ${n} Gema(s).`);
  }
  finish(s);
}

function endAplastar(s: GameState) {
  const ph = s.phase;
  if (ph.t !== 'aplastar') return;
  const slow = ph.players.filter((p) => !ph.slapped.includes(p));
  const loser = slow.length ? slow[Math.floor(rnd(s) * slow.length)] : ph.slapped[ph.slapped.length - 1];
  log(s, `${nm(s, loser)} es el último en poner la mano.`);
  openReact(s, { k: 'draw', source: ph.launcher, targets: [loser], amount: ph.amount, aplastar: true });
}
