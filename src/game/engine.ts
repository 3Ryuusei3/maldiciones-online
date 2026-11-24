// Motor de reglas de Maldiciones (V7). Puro y determinista:
//   apply(estado, acción) -> estado nuevo
// No usa relojes ni Math.random: el azar sale de state.seed y los tiempos
// (ventanas de reacción, Aplastar) los marca quien aloja la partida con 'timeout'.
// Esto permite que más adelante un anfitrión lo ejecute y lo sincronice por Supabase.

import { Card, Color, COLORS, COLOR_NAME, DeckCounts, KINDS, handSize, RITUALS, buildDeck, cardName, isCursed, isGem, isPlainGem, rankOf } from './cards';

export interface Player {
  id: number;
  name: string;
  bot: boolean;
  hand: Card[];
  /** Égida boca arriba (le queda 1 uso). */
  egida: Card | null;
  /** Un Imán le dejó sin cartas: están retenidas y no gana por ello. */
  held: boolean;
  /** Fuera de la partida (online: se cayó y se le quitó). No juega, no se le puede elegir y no gana. */
  out?: boolean;
}

export type Effect =
  /** `queue`: lanzadores de los Aplastar duplicados que aún esperan su propia ronda de diana. */
  | { k: 'draw'; source: number; targets: number[]; amount: number; aplastar: boolean; queue?: number[] }
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
/** `bounce`: carta probada a ciegas que no servía: va hacia la Pila, se enseña y vuelve a la mano (sin quedarse). */
export interface Fx { from: Anchor; to: Anchor; n: number; card?: Card; bounce?: boolean }

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
  /** `dupd`: el jugador del turno ya ha duplicado; puede seguir jugando o terminar su turno sin robar. */
  | { t: 'turn'; drawn: string | null; dupd?: boolean }
  | { t: 'choose'; player: number; need: 'target' | 'card' | 'gem'; options: (string | number)[]; pp: PendingPlay }
  /** `aim`: quien ha acertado a ciegas (Tinieblas) un Reflejo y está eligiendo contra quién lo dirige. */
  | { t: 'react'; eff: Effect; waiting: number[]; exempt: number[]; win: number; aim?: number }
  /** `queue`: cada Aplastar duplicado es otra ronda completa, que se juega cuando acaba esta (lanzada por quien duplicó). */
  /** `fake`: Aplastar de color con Inutilizar activo: no tiene efecto, y quien pulse la mano (por despiste) roba 3. */
  | { t: 'aplastar'; launcher: number; amount: number; players: number[]; slapped: number[]; win: number; queue?: number[]; fake?: boolean }
  /** Carta de color con Inutilizar activo: su lanzador decide si «empieza el efecto» (no tiene: si lo hace, roba 3) o cancela. */
  /** `receive`: se le pregunta a quien la recibe (Travesura) si acepta el efecto, en vez de a quien la echa. */
  | { t: 'inutil'; player: number; card: Card; receive?: boolean }
  | { t: 'give'; eff: TravEff; waiting: number[]; need: Record<number, number>; target: number }
  | { t: 'escarcha'; player: number; targets: number[] }
  | { t: 'rafaga' }
  | { t: 'tinte'; player: number; resume: Phase | null }
  /** `eff`: el efecto en curso; mientras no se haya hecho el intercambio, aún se puede parar (Antitodo, Égida, Reflejo). */
  | { t: 'codicia'; launcher: number; target: number; options: string[]; give: string | null; best: string | null; waiting: number[]; eff?: Effect }
  | { t: 'imanPick'; source: number; targets: number[]; picks: Record<number, TieSplit>; chosen: Record<number, string[]>; waiting: number[]; eff?: Effect }
  /** `to`: a quién se pueden repartir las cartas (los que se las dieron; quien se defendió con Égida, no). */
  | { t: 'iman'; launcher: number; pool: Card[]; to?: number[] }
  | { t: 'adivinar'; player: number; cards: Card[] }
  | { t: 'recuperar'; player: number; options: string[] }
  | { t: 'gemas'; waiting: number[]; win: number; chosen: Record<number, string[]> }
  | { t: 'condena'; player: number; absolved: boolean }
  | { t: 'over' };

/** Reparto de las mejores cartas de una mano: las obligadas y, si hay empate, entre cuáles elige el dueño. */
export interface TieSplit { fixed: string[]; options: string[]; count: number }

export interface GameState {
  seed: number;
  /** Cuándo empezó la partida (ms; lo pone quien la crea, no el motor). Para el temporizador. */
  startedAt?: number;
  seq: number;
  /** Contador de ventanas temporizadas (para que el anfitrión lleve los relojes). */
  win: number;
  players: Player[];
  deck: Card[];
  /** Pila de juego; la última es la carta superior. */
  pile: Card[];
  color: Color;
  /** Color único (partida personalizada): siempre manda este color y no se elige color. */
  mono?: Color;
  /** Quién jugó la última carta incolora y elegirá color cuando acabe la acción en curso. */
  tinte: number | null;
  /** Movimientos de cartas producidos por la última acción (solo para animar). */
  fx: Fx[];
  /** Lo gastado al reaccionar a la acción en curso: un Antitodo lo anula todo y lo devuelve. */
  undo: null | { dir: 1 | -1; spent: { p: number; card: Card; from: 'hand' | 'up' | 'pile' }[] };
  dir: 1 | -1;
  turn: number;
  /** `tinieblas.at`: jugada en la que cayeron (para dejar unos segundos de memorizar la mano). */
  env: { mutis: boolean; inutilizar: boolean; tinieblas: null | { owner: number; count: number; fresh: boolean; at?: number; secrets?: string[]; known?: string[] } };
  phase: Phase;
  rafaga: Rafaga | null;
  /** Para el resumen final: cartas echadas y robadas por jugador, y turnos jugados. */
  stats: { played: number[]; drawn: number[]; turns: number; maxCurses: number[]; maxHand: number[]; minHand: number[] };
  after: { turnTo: number | null } | null;
  /** «Jugar juntas»: copias idénticas que se duplicarán en cuanto se pueda (cuando acabe la decisión de la primera). */
  joinQ?: { player: number; ids: string[] } | null;
  totalCurses: number;
  winner: number | null;
  log: { n: number; text: string }[];
  announce: { n: number; text: string; player: number } | null;
}

export type ReactKind = 'pass' | 'egida' | 'antitodo' | 'reflejo' | 'chain' | 'gem' | 'gems' | 'blind';

export type Action =
  /** `with`: cartas que se echan a la vez (copias idénticas, o la Maldición junto al Antitodo). */
  | { type: 'play'; player: number; cardId: string; with?: string[] }
  | { type: 'draw'; player: number }
  | { type: 'keep'; player: number }
  | { type: 'choose'; player: number; value: string | number | null }
  | { type: 'dup'; player: number; cardId: string; with?: string[] }
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
  /** Solo el servidor: quita a un jugador de la partida (sus cartas van al fondo de la Pila). */
  | { type: 'kick'; target: number }
  /** Tinieblas: usar una carta boca abajo en cualquier momento, probando suerte (si no sirve, se roba 1). */
  | { type: 'guess'; player: number; cardId: string }
  /** Con Inutilizar: `use` = empezar el efecto de la carta de color (no tiene: roba 3); si no, se cancela. */
  | { type: 'inutil'; player: number; use: boolean }
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
  /** Color único: todas las cartas de color son de este color, manda siempre y nunca se elige color. */
  mono?: Color | null;
  /** Mazo personalizado: cuántas hay de cada carta (las que falten, como en el Mazo normal). */
  counts?: DeckCounts | null;
  /** Cartas iniciales de cada jugador, además de su Maldición (normal: 6). */
  hand?: number;
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
/** Siguiente jugador en el sentido de juego (los que están fuera de la partida se saltan). */
export function nextPlayer(s: GameState, p: number): number {
  const n = s.players.length;
  let q = p;
  for (let i = 0; i < n; i++) {
    q = (q + s.dir + n) % n;
    if (!s.players[q].out) return q;
  }
  return q;
}
/** Jugadores que siguen en la partida. */
const inGame = (s: GameState) => s.players.filter((p) => !p.out);
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
      fx(s, 'pile', 'deck', s.deck.length); // las cartas de la Pila vuelven al Mazo (boca abajo)
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
  paint(s, p, c);
}

/** La carta que cae en la Pila fija el color; si es incolora, quien la echa lo elegirá (salvo con color único). */
function paint(s: GameState, p: number, c: Card) {
  if (c.color || s.mono) {
    s.color = c.color ?? s.mono!;
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
  revealSecrets(s);
  s.env = { mutis: false, inutilizar: false, tinieblas: null };
}

/**
 * Con Tinieblas, lo que no se ve (qué carta se entrega) se anota como «una carta (???)» y se cuenta cuando
 * se disipan. Sin Tinieblas, se anota tal cual.
 */
function logSecret(s: GameState, hidden: string, real: string) {
  const tin = s.env.tinieblas;
  if (!tin) return log(s, real);
  log(s, hidden);
  (tin.secrets ??= []).push(real);
}

/** Al disiparse las Tinieblas, se cuenta lo que había quedado oculto. */
function revealSecrets(s: GameState) {
  const sec = s.env.tinieblas?.secrets ?? [];
  for (const t of sec) log(s, `Tras las Tinieblas: ${t}`);
  if (s.env.tinieblas) s.env.tinieblas.secrets = [];
}

/** Se disipan las Tinieblas (y se cuenta lo que había quedado oculto). */
function endTinieblas(s: GameState) {
  log(s, 'Se disipan las Tinieblas.');
  revealSecrets(s);
  s.env.tinieblas = null;
}

function dropFaceUpEgidas(s: GameState) {
  for (const p of s.players)
    if (p.egida) {
      s.pile.unshift(p.egida);
      fx(s, p.id, 'pile', 1, p.egida);
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
  s.rafaga = null;
  log(s, `🏆 ${nm(s, p)} se queda sin cartas y gana la partida.`);
  return true;
}

/**
 * Quien echa su última carta gana en ese mismo momento, sin que se aplique su efecto
 * (salvo en Entorno maldito, donde roba 1 y la jugada sigue).
 */
function lastCard(s: GameState, p: number): boolean {
  const pl = s.players[p];
  return pl.hand.length === 0 && !pl.held && !pl.out && tryWin(s, p);
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
  if (s.phase.drawn && s.phase.drawn !== c.id && !predWithDrawn(s, p, c)) return false;
  if (isBlind(s)) return true;
  return isLegal(s, p, c);
}

/** Tras robar, se puede jugar Predestinar si lo acompaña precisamente la carta robada. */
function predWithDrawn(s: GameState, p: number, c: Card): boolean {
  const ph = s.phase;
  return ph.t === 'turn' && !!ph.drawn && c.kind === 'predestinar' && companions(s, p, c.id).some((x) => x.id === ph.drawn);
}

/** `blindOk`: en Tinieblas solo se puede duplicar probando suerte a ciegas (acción `guess`). */
export function canDup(s: GameState, p: number, c: Card, blindOk = false): boolean {
  if (isBlind(s) && !blindOk) return false;
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
  // Un Ataque solo se duplica mientras su efecto sigue en marcha (multiplicándolo). Una vez resuelto, ya no:
  // otro igual que se eche después es una jugada nueva, no una duplicación.
  if (attr === 'ataque') {
    const ph = s.phase;
    // Aplastar: solo cuando el anterior ha acabado del todo (y entonces es otra ronda completa).
    if (c.kind === 'aplastar') { if (ph.t !== 'turn') return false; }
    // Travesura: mientras su efecto sigue en marcha (se acumula).
    else if (!(ph.t === 'react' && ph.eff.k === 'trav' && !ph.eff.noChain && c.kind === 'travesura')) return false;
  }
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
    case 'inutil': return [ph.player];
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
  const mono = o.mono && COLORS.includes(o.mono) ? o.mono : null;
  const hand = handSize(o.hand);
  const { deck, curses } = buildDeck({ beta: !!o.beta, mono, counts: o.counts, hand });
  const s: GameState = {
    seed: o.seed | 0,
    seq: 0,
    win: 0,
    players: o.players.map((p, i) => ({ id: i, name: p.name, bot: p.bot, hand: [], egida: null, held: false })),
    deck: [],
    pile: [],
    color: mono ?? 'a',
    ...(mono ? { mono } : {}),
    tinte: null,
    fx: [],
    undo: null,
    dir: 1,
    turn: 0,
    env: { mutis: false, inutilizar: false, tinieblas: null },
    phase: { t: 'turn', drawn: null },
    rafaga: null,
    stats: { played: o.players.map(() => 0), drawn: o.players.map(() => 0), turns: 0, maxCurses: o.players.map(() => 1), maxHand: o.players.map(() => hand + 1), minHand: o.players.map(() => hand + 1) },
    after: null,
    totalCurses: o.extraCurses ? 6 : o.players.length,
    winner: null,
    log: [],
    announce: null,
  };
  for (const p of s.players) p.hand.push(curses.pop()!);
  if (o.extraCurses) deck.push(...curses);
  s.deck = shuffle(s, o.condena === false ? deck.filter((c) => c.kind !== 'condena') : deck);
  for (let i = 0; i < hand; i++) for (const p of s.players) p.hand.push(s.deck.pop()!);
  // Primera carta de la Pila: una carta de color (no tiene efecto).
  const idx = [...s.deck.keys()].reverse().find((i) => s.deck[i].color !== null)!;
  const first = s.deck.splice(idx, 1)[0];
  s.pile.push(first);
  s.color = first.color!;
  log(s, `Comienza la partida. Carta inicial: ${cardName(first)}.`);
  // Se sortea quién empieza y en qué sentido se juega.
  s.dir = rnd(s) < 0.5 ? 1 : -1;
  beginTurn(s, Math.floor(rnd(s) * s.players.length));
  return s;
}

// ───────────────────────── flujo de turnos ─────────────────────────

function beginTurn(s: GameState, p: number) {
  s.turn = p;
  s.stats.turns++;
  s.after = null;
  const pl = s.players[p];
  const tin = s.env.tinieblas;
  if (pl.hand.some((c) => c.kind === 'condena' && (!tin || !tin.known || tin.known.includes(c.id)))) {
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
  // Imán: mientras su lanzador reparte, a quien se lo han quitado todo le quedan las cartas retenidas y no gana.
  // Cuando acaba el reparto (aquí), si no le han devuelto ninguna, se ha quedado sin cartas y gana.
  for (const pl of s.players) pl.held = false;
  for (let i = 0; i < s.players.length; i++) {
    const p = (s.turn + i) % s.players.length;
    if (s.players[p].hand.length === 0 && !s.players[p].held && !s.players[p].out && tryWin(s, p)) return;
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
      endTinieblas(s);
    }
  }
  beginTurn(s, after?.turnTo ?? nextPlayer(s, prev));
}

// ───────────────────────── jugar una carta ─────────────────────────

function startPlay(s: GameState, p: number, card: Card, withIds: string[] = []) {
  takeFromHand(s, p, card.id);
  putOnPile(s, p, card);
  const pp: PendingPlay = { player: p, card, companion: null, target: null, noTarget: false, gemAsked: false };
  if (card.kind === 'antitodo') {
    // La Maldición solo se va con el Antitodo si se echan juntas (las máquinas siempre lo hacen).
    const curse = s.players[p].hand.find((c) => c.kind === 'maldicion' && (withIds.includes(c.id) || s.players[p].bot));
    if (curse) {
      takeFromHand(s, p, curse.id);
      s.pile.unshift(curse);
      fx(s, p, 'pile', 1, curse);
      log(s, `${nm(s, p)} juega Antitodo junto a una Maldición y la elimina.`);
    } else log(s, `${nm(s, p)} juega Antitodo.`);
    announce(s, p, '¡Antitodo!');
    // Si con esto se queda sin cartas (y gana), no se tocan las Égidas ni los Entornos: no estropea el final.
    if (s.players[p].hand.length > 0 || isCursedEnv(s)) {
      resetEnv(s);
      dropFaceUpEgidas(s);
    }
  } else {
    log(s, `${nm(s, p)} juega ${cardName(card)}.`);
    announce(s, p, `¡${KINDS[card.kind].name}!`, card.kind === 'mutis');
  }
  if (lastCard(s, p)) return;
  continuePlay(s, pp);
}

export function predTargets(s: GameState, L: number, e: Card): number[] {
  const all = inGame(s).map((p) => p.id);
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
    else if (e.kind === 'codicia' && !inutil) opts = inGame(s).filter((p) => p.id !== L && p.hand.length > 0).map((p) => p.id);
    else if (e.kind === 'purga') opts = inGame(s).map((p) => p.id);
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
    if (s.env.tinieblas) endTinieblas(s);
    else {
      // Las Condenas que ya se tenían (y se sabía): solo esas surten efecto mientras dure; una que te llegue a
      // ciegas no empieza hasta que la veas (al disiparse las Tinieblas).
      const known = s.players.flatMap((pl) => pl.hand.filter((c) => c.kind === 'condena').map((c) => c.id));
      s.env.tinieblas = { owner: by, count: 0, fresh: true, at: s.seq, known };
      log(s, 'Tinieblas: todos juegan con las cartas boca abajo.');
    }
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
  if (predestined && T !== null) {
    if (isCursed(e)) logSecret(s, `${nm(s, L)} predestina una carta (???) a ${nm(s, T)}, que recibe el turno.`, `${nm(s, L)} predestinó ${cardName(e)} a ${nm(s, T)}.`);
    else log(s, `${nm(s, L)} predestina ${cardName(e)} a ${nm(s, T)}, que recibe el turno.`);
  }
  const inutil = s.env.inutilizar && e.color !== null;
  const others = inGame(s).filter((p) => p.id !== L).map((p) => p.id);

  if (isCursed(e)) {
    // Solo llega aquí como acompañante de Predestinar.
    return openReact(s, { k: 'gift', source: L, targets: [T!], card: e });
  }
  if (inutil && !isGem(e)) {
    // Inutilizar: la carta de color no tiene efecto… pero se pone a prueba si los jugadores se acuerdan.
    if (e.kind === 'aplastar') {
      // Sale la mano de Aplastar como siempre: quien la pulse roba 3.
      s.phase = { t: 'aplastar', launcher: L, amount: 3, players: others, slapped: [], win: ++s.win, fake: true };
      return;
    }
    if (e.kind === 'travesura') {
      // Travesura: se le pregunta a quien la recibiría si acepta el efecto (no tiene: si lo acepta, roba 3).
      s.phase = { t: 'inutil', player: pred && T !== null ? T : nextPlayer(s, L), card: e, receive: true };
      return;
    }
    if (e.kind === 'codicia' || e.kind === 'adivinar' || e.kind === 'mutis') {
      s.phase = { t: 'inutil', player: L, card: e };
      return;
    }
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
    case 'aplastar':
      return startAplastar(s, L);
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
      // Quedan Aplastar duplicados: empieza la siguiente ronda de diana.
      if (eff.k === 'draw' && eff.queue?.length) return startAplastar(s, eff.queue[0], eff.queue.slice(1));
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
      s.phase = { t: 'codicia', launcher: L, target: t, options: sp.options, give: null, best: sp.fixed[0] ?? null, waiting, eff: { ...eff, targets: [t] } };
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
      s.phase = { t: 'imanPick', source: eff.source, targets, picks, chosen, waiting, eff: { ...eff, targets } };
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
        // Bloqueada con Antitodo: la carta vuelve a quien la entregaba.
        s.players[eff.source].hand.push(eff.card);
        fx(s, eff.targets[0] ?? 'pile', eff.source, 1, eff.card);
        log(s, `El Antitodo bloquea la entrega: ${cardName(eff.card)} vuelve a ${nm(s, eff.source)}.`);
      } else {
        s.players[t].hand.push(eff.card);
        // Una carta maldita entregada se ve boca arriba (todos saben qué ha recibido)… salvo con Tinieblas.
        const seen = isCursed(eff.card) && !s.env.tinieblas;
        fx(s, eff.source, t, 1, seen ? eff.card : undefined);
        if (isCursed(eff.card)) logSecret(s, `${nm(s, t)} recibe una carta (???) de ${nm(s, eff.source)}.`, `${nm(s, t)} recibió ${cardName(eff.card)} de ${nm(s, eff.source)}.`);
        else log(s, `${nm(s, t)} recibe una carta de ${nm(s, eff.source)}.`);
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
  s.phase = { t: 'iman', launcher: ph.source, pool: shuffle(s, pool), to: ph.targets.filter((t) => t !== ph.source) };
}

/** Contra quién va un Reflejo a ciegas si no se elige: quien lanzó el efecto (o otro al azar si fue uno mismo). */
function blindReflTarget(s: GameState, p: number, eff: Effect): number {
  const src = eff.k === 'trav' ? eff.launchers[eff.launchers.length - 1] : eff.source;
  const others = inGame(s).filter((x) => x.id !== p).map((x) => x.id);
  return src !== p ? src : others[Math.floor(rnd(s) * others.length)];
}

function handleReact(s: GameState, a: Extract<Action, { type: 'react' }>, guessed = false): boolean {
  const ph = s.phase;
  if (ph.t !== 'react' || !ph.waiting.includes(a.player)) return false;
  const p = a.player;
  const pl = s.players[p];
  const eff = ph.eff;
  if (ph.aim === p) {
    // Ha acertado un Reflejo a ciegas: solo falta elegir contra quién (si pasa o se acaba el tiempo, va al lanzador).
    if (a.r !== 'reflejo' && a.r !== 'pass') return false;
    ph.aim = undefined;
    const target = a.r === 'reflejo' && a.target !== undefined ? a.target : blindReflTarget(s, p, eff);
    if (handleReact(s, { type: 'react', player: p, r: 'reflejo', target }, true)) return true;
    ph.aim = p;
    return false;
  }
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
      s.fx.push({ from: p, to: 'pile', n: 1, card: c, bounce: true });
      drawCards(s, p, 1);
      ph.waiting = ph.waiting.filter((x) => x !== p);
      if (!ph.waiting.length) resolve(s, eff, ph.exempt);
      return true;
    }
    log(s, `${nm(s, p)} acierta a ciegas con ${cardName(c)}.`);
    if (as === 'reflejo' && (eff.k === 'draw' || eff.k === 'trav') && a.target === undefined) {
      // Un Reflejo de Ataque se dirige a quien quiera: se queda eligiendo.
      ph.aim = p;
      return true;
    }
    const target = a.target ?? blindReflTarget(s, p, eff);
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
  /**
   * Tras protegerse: si ya se han librado todos a los que iba dirigido, el efecto se acaba ahí
   * (nadie puede reflejarlo ni anularlo). Con Cristalizar, su lanzador aún decide qué Gemas deja.
   */
  const protectedDone = () => {
    if (!eff.targets.every((t) => ph.exempt.includes(t))) return done();
    ph.waiting = ph.waiting.filter((x) => x !== p && eff.k === 'cristal' && x === eff.source);
    if (!ph.waiting.length) resolve(s, eff, ph.exempt);
  };
  switch (a.r) {
    case 'pass':
      done();
      return true;
    case 'egida': {
      if (pl.egida) {
        // Segundo uso: la Égida se gasta y queda encima de la Pila (a la vista). Es incolora: su dueño elige color.
        s.undo?.spent.push({ p, card: pl.egida, from: 'up' });
        putOnPile(s, p, pl.egida);
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
      if (!s.mono) s.tinte = p;
      ph.exempt.push(p);
      protectedDone();
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
      if (eff.k === 'draw') eff.queue = []; // Antitodo anula también las rondas de Aplastar pendientes
      log(s, `${nm(s, p)} usa Antitodo: el efecto queda anulado para todos.`);
      announce(s, p, '¡Antitodo!');
      if (lastCard(s, p)) return true;
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
      protectedDone();
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
      if (lastCard(s, p)) return true;
      s.after = { turnTo: target };
      openReact(s, { k: 'trav', launchers: [...eff.launchers, ...(big ? [p, p] : [p])], targets: [target], amount: eff.amount + (big ? 3 : 2), noChain: false, given: [], last: c.kind as 'travesura' | 'trastada' });
      return true;
    }
    case 'reflejo': {
      const needsTarget = eff.k === 'draw' || eff.k === 'trav';
      if (needsTarget && (a.target === undefined || a.target === p || !s.players[a.target] || s.players[a.target].out)) return false;
      const c = pl.hand.find((x) => x.kind === 'reflejo')!;
      if (eff.k === 'trav') {
        // Travesura reflejada: si vuelve a quien echó la última, el turno es suyo; si va a otro, el turno pasa al
        // siguiente de quien la refleja (en el sentido de antes del Reflejo).
        const last = eff.launchers[eff.launchers.length - 1];
        s.after = { turnTo: a.target === last ? last : nextPlayer(s, p) };
      }
      takeFromHand(s, p, c.id);
      putOnPile(s, p, c);
      s.undo?.spent.push({ p, card: c, from: 'pile' });
      s.dir = s.dir === 1 ? -1 : 1;
      announce(s, p, '¡Reflejo!');
      if (lastCard(s, p)) return true;
      const everyone = inGame(s).filter((x) => x.id !== p).map((x) => x.id);
      let ne: Effect;
      if (eff.k === 'draw') ne = { k: 'draw', source: p, targets: [a.target!], amount: eff.amount, aplastar: false, queue: eff.queue };
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

function handleDup(s: GameState, p: number, cardId: string, blindOk = false): boolean {
  const c = s.players[p].hand.find((x) => x.id === cardId);
  if (!c || !canDup(s, p, c, blindOk)) return false;
  takeFromHand(s, p, c.id);
  putOnPile(s, p, c);
  log(s, `${nm(s, p)} duplica ${cardName(c)}.`);
  announce(s, p, '¡Duplicar!');
  if (lastCard(s, p)) return true;
  const ph = s.phase;
  // Duplicar en mi propio turno no lo termina: puedo echar otra carta o acabar el turno.
  if (ph.t === 'turn' && s.turn === p) ph.dupd = true;
  const attr = KINDS[c.kind].attr;
  const inutil = s.env.inutilizar && c.color !== null;
  if (attr === 'entorno') toggleEnv(s, c, p);
  else if (attr === 'ataque' && !inutil) {
    if (ph.t === 'turn' && c.kind === 'aplastar') {
      // Aplastar duplicado (el anterior ya había acabado): otra ronda completa, lanzada por quien duplica.
      // Después, el turno sigue siendo de quien lo tenía.
      s.after = { turnTo: s.turn };
      log(s, `Nueva ronda de Aplastar, de ${nm(s, p)}.`);
      startAplastar(s, p);
      return true;
    } else if (ph.t === 'react' && ph.eff.k === 'trav' && !ph.eff.noChain && c.kind === 'travesura') {
      // Quien duplica también dará una carta suya al final.
      ph.eff.launchers.push(p);
      ph.eff.amount += 2;
      ph.eff.last = 'travesura';
      log(s, `Travesura se multiplica: ${nm(s, ph.eff.targets[0])} recibirá ${ph.eff.launchers.length} carta(s) y robará ${ph.eff.amount}.`);
    }
  }
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
  if (s.joinQ) drainJoin(s);
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

/**
 * Copias idénticas que se echan junto a la primera («Jugar juntas»): van todas a la Pila a la vez y el efecto se
 * hace una sola vez; si son Ataques, se multiplica (como al Duplicar). Las que no se pueden duplicar no cuentan.
 */
function joinable(s: GameState, p: number, first: Card, ids?: string[]): Card[] {
  const attr = KINDS[first.kind].attr;
  if (attr === 'defensa' || attr === 'sagrada' || attr === 'maldita' || KINDS[first.kind].rank >= 4) return [];
  if (first.kind === 'predestinar' || first.kind === 'cristalizar') return [];
  const out: Card[] = [];
  for (const id of new Set(ids ?? [])) {
    const c = s.players[p].hand.find((x) => x.id === id);
    if (c && c.id !== first.id && c.kind === first.kind && c.color === first.color) out.push(c);
  }
  return out;
}

/** Ataques echados juntos: Travesura acumula (otra carta tuya y +2 por copia) y Aplastar suma rondas completas. */
function multiplyJoined(s: GameState, p: number, c: Card, n: number) {
  if (s.env.inutilizar && c.color !== null) return;
  const ph = s.phase;
  if (c.kind === 'travesura' && ph.t === 'react' && ph.eff.k === 'trav') {
    for (let i = 0; i < n; i++) { ph.eff.launchers.push(p); ph.eff.amount += 2; }
    log(s, `Travesura se multiplica: ${nm(s, ph.eff.targets[0])} recibirá ${ph.eff.launchers.length} carta(s) y robará ${ph.eff.amount}.`);
  } else if (c.kind === 'aplastar' && ph.t === 'aplastar') {
    ph.queue = [...(ph.queue ?? []), ...Array(n).fill(p)];
    log(s, `Aplastar se multiplica: ${n + 1} rondas seguidas.`);
  }
}

/**
 * Duplica las copias pendientes de «Jugar juntas» en cuanto se puede (si la primera abrió una decisión —elegir
 * objetivo, recuperar…—, al terminarla). Si la carta de arriba de la Pila ya no es idéntica, se desiste.
 */
function drainJoin(s: GameState) {
  for (let guard = 0; guard < 10 && s.joinQ && s.phase.t !== 'over'; guard++) {
    const q = s.joinQ;
    const c = s.players[q.player].hand.find((x) => x.id === q.ids[0]);
    const top = topCard(s);
    if (!c || top.kind !== c.kind || top.color !== c.color) { s.joinQ = null; return; }
    if (!canDup(s, q.player, c)) return;
    q.ids.shift();
    if (!q.ids.length) s.joinQ = null;
    handleDup(s, q.player, c.id);
  }
}

function step(s: GameState, a: Action): boolean {
  const ph = s.phase;
  switch (a.type) {
    case 'play': {
      if (ph.t !== 'turn' || s.turn !== a.player) return false;
      const c = s.players[a.player].hand.find((x) => x.id === a.cardId);
      const drawnId = ph.drawn;
      if (!c || (drawnId && drawnId !== c.id && !predWithDrawn(s, a.player, c))) return false;
      if (!isLegal(s, a.player, c)) {
        if (!isBlind(s)) return false;
        log(s, `${nm(s, a.player)} juega a ciegas ${cardName(c)}: no se puede encadenar. Roba 1 y pierde el turno.`);
        s.fx.push({ from: a.player, to: 'pile', n: 1, card: c, bounce: true });
        drawCards(s, a.player, 1);
        finish(s);
        return true;
      }
      // «Jugar juntas»: las copias idénticas van a la Pila a la vez que la primera.
      const extra = joinable(s, a.player, c, a.with);
      for (const x of extra) { takeFromHand(s, a.player, x.id); putOnPile(s, a.player, x); }
      if (extra.length) log(s, `${nm(s, a.player)} echa ${extra.length + 1} ${KINDS[c.kind].name} juntas${KINDS[c.kind].attr === 'ataque' ? ': el efecto se multiplica' : ''}.`);
      startPlay(s, a.player, c, a.with ?? []);
      // Predestinar tras robar: la carta que lo acompaña es la robada.
      if (drawnId && drawnId !== c.id && s.phase.t === 'choose' && s.phase.need === 'card') s.phase.options = s.phase.options.filter((o) => o === drawnId);
      if (extra.length) multiplyJoined(s, a.player, c, extra.length);
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
      // Se puede jugar la robada si encadena, o si un Predestinar de la mano puede ir acompañado de ella.
      const pd = c ? s.players[a.player].hand.find((x) => x.kind === 'predestinar' && x.id !== c.id) : undefined;
      const viaPred = !!c && !!pd && isLegal(s, a.player, pd) && companions(s, a.player, pd.id).some((x) => x.id === c.id);
      if (c && (isLegal(s, a.player, c) || viaPred)) ph.drawn = c.id;
      else finish(s);
      return true;
    }
    case 'keep':
      // Quedarse la carta robada, o terminar el turno tras haber duplicado.
      if (ph.t !== 'turn' || s.turn !== a.player || !(ph.drawn || ph.dupd)) return false;
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
        if (!isCursed(c)) {
          // La carta acompañante queda encima del Predestinar: si es de color, manda su color; si es incolora, se elige.
          putOnPile(s, a.player, c);
          log(s, `${nm(s, a.player)} acompaña Predestinar con ${cardName(c)}.`);
        }
        // Era su última carta: gana ya, sin que se aplique el efecto.
        if (lastCard(s, a.player)) return true;
      } else {
        const c = takeFromHand(s, a.player, a.value as string)!;
        s.pile.unshift(c);
        fx(s, a.player, 'pile', 1, c);
        log(s, `${nm(s, a.player)} descarta ${cardName(c)} debajo de su carta de Apoyo.`);
        if (lastCard(s, a.player)) return true;
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
    case 'dup': {
      const c = s.players[a.player].hand.find((x) => x.id === a.cardId);
      // La Tinieblas se puede duplicar a la vista mientras se memoriza la mano (otra igual la desactiva).
      const tin = !!c && c.kind === 'tinieblas' && isBlind(s);
      if (!c || !canDup(s, a.player, c, tin)) return false;
      // Varias copias a la vez: todas a la Pila juntas; el efecto, una vez (multiplicado si es un Ataque).
      const extra = joinable(s, a.player, c, a.with);
      for (const x of extra) { takeFromHand(s, a.player, x.id); putOnPile(s, a.player, x); }
      if (!handleDup(s, a.player, a.cardId, tin)) return false;
      if (extra.length) multiplyJoined(s, a.player, c, extra.length);
      return true;
    }
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
    case 'react': {
      // Imán o Codicia aún sin resolver (eligiendo cartas): todavía se pueden parar con Antitodo, Égida o Reflejo.
      if ((ph.t === 'imanPick' || ph.t === 'codicia') && ph.eff && (a.r === 'antitodo' || a.r === 'egida' || a.r === 'reflejo')) {
        const eff = ph.eff;
        if (!reactOptionsFor(s, a.player, eff).includes(a.r)) return false;
        if (!s.undo) s.undo = { dir: s.dir, spent: [] };
        s.phase = { t: 'react', eff, waiting: [a.player], exempt: [], win: ++s.win };
        return handleReact(s, a);
      }
      return handleReact(s, a);
    }
    case 'inutil': {
      if (ph.t !== 'inutil' || ph.player !== a.player) return false;
      if (a.use) {
        drawCards(s, a.player, 3);
        log(s, ph.receive
          ? `${nm(s, a.player)} acepta el efecto de ${cardName(ph.card)} con Inutilizar activo: no tiene efecto y roba 3.`
          : `${nm(s, a.player)} intenta usar ${cardName(ph.card)} con Inutilizar activo: no tiene efecto y roba 3.`);
      } else log(s, `${nm(s, a.player)} recuerda que Inutilizar está activo: ${cardName(ph.card)} no tiene efecto.`);
      finish(s);
      return true;
    }
    case 'guess': {
      // Tinieblas: nadie ve su mano, pero cualquiera puede intentar usar una carta en cualquier momento.
      if (!isBlind(s)) return false;
      const p = a.player;
      const pl = s.players[p];
      const c = pl?.hand.find((x) => x.id === a.cardId);
      if (!c || pl.out) return false;
      // En mi turno: es la jugada a ciegas de siempre (si no se puede encadenar, roba 1 y pierde el turno).
      if (ph.t === 'turn' && s.turn === p) return step(s, { type: 'play', player: p, cardId: c.id });
      // En una ventana de reacción en la que me toca: defensa a ciegas (Égida, Reflejo, Antitodo, encadenar…).
      if (ph.t === 'react' && ph.waiting.includes(p)) return handleReact(s, { type: 'react', player: p, r: 'blind', cardId: c.id });
      // Igual que la de arriba de la Pila: se duplica.
      if (canDup(s, p, c, true)) {
        log(s, `${nm(s, p)} acierta a ciegas: duplica ${cardName(c)}.`);
        return handleDup(s, p, c.id, true);
      }
      // Un Antitodo sirve siempre: fuera de turno reinicia los Entornos; en una ventana, la anula.
      if (c.kind === 'antitodo') {
        if (ph.t === 'react') {
          ph.waiting.push(p);
          return handleReact(s, { type: 'react', player: p, r: 'antitodo' }, true);
        }
        if (ph.t === 'turn') {
          takeFromHand(s, p, c.id);
          putOnPile(s, p, c);
          resetEnv(s);
          dropFaceUpEgidas(s);
          log(s, `${nm(s, p)} acierta a ciegas con Antitodo: se reinician los Entornos.`);
          announce(s, p, '¡Antitodo!');
          if (!tryWin(s, p)) settleTinte(s);
          return true;
        }
      }
      // No sirve ahora: roba 1 aunque no sea su turno.
      log(s, `${nm(s, p)} prueba suerte a ciegas con ${cardName(c)}: no se puede usar ahora. Roba 1.`);
      s.fx.push({ from: p, to: 'pile', n: 1, card: c, bounce: true });
      drawCards(s, p, 1);
      return true;
    }
    case 'slap': {
      if (ph.t !== 'aplastar' || !ph.players.includes(a.player) || ph.slapped.includes(a.player)) return false;
      ph.slapped.push(a.player);
      if (ph.fake) {
        // Era de color con Inutilizar: no tenía efecto. Quien pone la mano por despiste roba 3.
        drawCards(s, a.player, 3);
        log(s, `${nm(s, a.player)} pone la mano en un Aplastar inutilizado: roba 3.`);
        if (ph.slapped.length >= ph.players.length) finish(s);
        return true;
      }
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
          if (typeof d === 'number' && (d === a.player || !s.players[d] || s.players[d].out || (ph.to && !ph.to.includes(d)))) return false;
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
        if (s.players[L].hand.length === 0) {
          s.pile.push(c);
          fx(s, L, 'pile', 1, c);
          log(s, `Ráfaga: ${nm(s, L)} echa su última carta, ${cardName(c)}.`);
          if (lastCard(s, L)) return true;
          s.pile.pop();
          s.fx.pop();
        }
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
      paint(s, L, c);
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
      fx(s, 'deck', 'pile', a.discard.length); // boca abajo, por debajo de la Pila
      for (const id of [...a.back].reverse()) s.deck.push(by(id));
      log(s, `${nm(s, a.player)} adivina: se queda ${a.keep.length}, descarta ${a.discard.length} y devuelve ${a.back.length} al Mazo.`);
      finish(s);
      return true;
    }
    case 'recuperar': {
      if (ph.t !== 'recuperar' || ph.player !== a.player || !ph.options.includes(a.cardId) || !s.players[a.to] || s.players[a.to].out) return false;
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
      fx(s, a.where, a.player, 1, found); // la Maldición encontrada se ve boca arriba
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
      if (a.to === null || a.to === a.player || !s.players[a.to] || s.players[a.to].out) {
        s.pile.unshift(c);
        log(s, `${nm(s, a.player)} queda absuelto y descarta Condena.`);
        finish(s);
      } else {
        logSecret(s, `${nm(s, a.player)} queda absuelto y entrega una carta (???) a ${nm(s, a.to)}.`, `${nm(s, a.player)} quedó absuelto y entregó Condena a ${nm(s, a.to)}.`);
        openReact(s, { k: 'gift', source: a.player, targets: [a.to], card: c });
      }
      return true;
    }
    case 'kick': {
      const p = a.target;
      const pl = s.players[p];
      // Solo entre jugadas, para no dejar a medias ninguna acción en la que participe.
      if (!pl || pl.out || ph.t !== 'turn') return false;
      pl.out = true;
      const n = pl.hand.length;
      if (n) {
        s.pile.unshift(...pl.hand);
        fx(s, p, 'pile', n);
        pl.hand = [];
      }
      if (pl.egida) {
        s.pile.unshift(pl.egida);
        fx(s, p, 'pile', 1, pl.egida);
        pl.egida = null;
      }
      pl.held = false;
      log(s, `${nm(s, p)} queda fuera de la partida: ${n ? `sus ${n} cartas van al fondo de la Pila` : 'no tenía cartas'}.`);
      if (s.env.tinieblas?.owner === p) {
        endTinieblas(s);
      }
      const left = inGame(s);
      if (left.length === 1) {
        s.winner = left[0].id;
        s.phase = { t: 'over' };
        s.after = null;
        log(s, `🏆 ${nm(s, left[0].id)} es el único que queda y gana la partida.`);
        return true;
      }
      if (s.turn === p) beginTurn(s, nextPlayer(s, p));
      return true;
    }
    case 'penalize': {
      if (!s.players[a.target] || s.players[a.target].out) return false;
      drawCards(s, a.target, 3);
      log(s, `El anfitrión señala una falta: ${nm(s, a.target)} roba 3.`);
      return true;
    }
    case 'timeout': {
      if (ph.t === 'react') {
        // Quien estaba eligiendo contra quién va su Reflejo a ciegas: se dirige al lanzador.
        if (ph.aim !== undefined) return handleReact(s, { type: 'react', player: ph.aim, r: 'pass' });
        resolve(s, ph.eff, ph.exempt);
        return true;
      }
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
  if (ph.fake) {
    log(s, ph.slapped.length ? 'Se acaba el Aplastar inutilizado.' : 'Nadie cae en el Aplastar inutilizado.');
    return finish(s);
  }
  const slow = ph.players.filter((p) => !ph.slapped.includes(p));
  const loser = slow.length ? slow[Math.floor(rnd(s) * slow.length)] : ph.slapped[ph.slapped.length - 1];
  log(s, `${nm(s, loser)} es el último en poner la mano.`);
  openReact(s, { k: 'draw', source: ph.launcher, targets: [loser], amount: ph.amount, aplastar: true, queue: ph.queue });
}

/** Una ronda de Aplastar: todos menos su lanzador ponen la mano; el último roba 3. Descarta las Égidas boca arriba. */
function startAplastar(s: GameState, L: number, queue: number[] = []) {
  dropFaceUpEgidas(s);
  s.phase = { t: 'aplastar', launcher: L, amount: 3, players: inGame(s).filter((p) => p.id !== L).map((p) => p.id), slapped: [], win: ++s.win, queue };
}
