// IA de las máquinas. Devuelve la acción que el jugador `p` haría ahora, o null.
// Niveles: 0 fácil, 1 normal, 2 difícil.

import { Card, Color, COLORS, KINDS, RITUALS, isCursed, isGem, isPlainGem, rankOf } from './cards';
import { Action, GameState, ReactKind, canDup, companions, isBlind, isCursedEnv, isLegal, predTargets, reactOptions, topCard } from './engine';

export type Level = 0 | 1 | 2;
type Rnd = () => number;

const pick = <T,>(a: T[], r: Rnd): T => a[Math.floor(r() * a.length)];

function bestColor(s: GameState, p: number, r: Rnd): Color {
  const n: Record<Color, number> = { a: 0, m: 0, v: 0 };
  for (const c of s.players[p].hand) if (c.color) n[c.color]++;
  const max = Math.max(n.a, n.m, n.v);
  return pick(COLORS.filter((c) => n[c] === max), r);
}

/**
 * A quién atacar: tiende a ir contra quien va ganando (menos cartas), pero con azar,
 * para que las máquinas también se peleen entre ellas y no vayan siempre a por el mismo.
 */
function leader(s: GameState, p: number, among?: number[], r: Rnd = Math.random): number {
  const pool = (among ?? s.players.map((x) => x.id)).filter((x) => x !== p);
  // Si alguien está a punto de ganar (1-2 cartas), casi siempre va a por él.
  const len = (x: number) => s.players[x].hand.length;
  const min = Math.min(...pool.map(len));
  if (pool.length && min <= 2 && r() < (min <= 1 ? 0.95 : 0.75)) return pick(pool.filter((x) => len(x) === min), r);
  const w = pool.map((x) => 1 / (s.players[x].hand.length + 1) ** 1.6);
  let roll = r() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((roll -= w[i]) <= 0) return pool[i];
  return pool[pool.length - 1];
}

/** Carta de la que más conviene deshacerse dándosela a otro. */
function worstToGive(hand: Card[]): Card {
  return (
    hand.find((c) => c.kind === 'condena') ??
    hand.find((c) => c.kind === 'maldicion') ??
    [...hand].sort((a, b) => rankOf(a) - rankOf(b))[0]
  );
}

/** Las `n` cartas de las que más conviene deshacerse. */
function worstN(hand: Card[], n: number): string[] {
  const bad = (c: Card) => (c.kind === 'condena' ? -2 : c.kind === 'maldicion' ? -1 : RITUALS.includes(c.kind) ? 9 : rankOf(c));
  return [...hand].sort((a, b) => bad(a) - bad(b)).slice(0, n).map((c) => c.id);
}

/** Valor de una carta para quien la tiene (para repartir con Escarcha). */
const worth = (c: Card) => (isCursed(c) ? -10 : RITUALS.includes(c.kind) ? 8 : isGem(c) ? 0 : rankOf(c) * 3 + (c.kind === 'antitodo' ? 5 : 0));

/** Cartas que hacen daño o molestan al jugarlas contra otro (Ráfaga). */
const HARMFUL = ['aplastar', 'cristalizar', 'travesura', 'trastada', 'codicia', 'iman', 'maldicion', 'condena', 'escarcha'];

/** En un empate de Jerarquía, suelta antes las malditas. */
function pickTied(hand: Card[], options: string[], n: number, lvl: Level, r: Rnd): string[] {
  const cards = options.map((id) => hand.find((c) => c.id === id)!).map((c) => ({ c, k: (lvl > 0 && isCursed(c) ? 0 : 1) + r() }));
  return cards.sort((a, b) => a.k - b.k).slice(0, n).map((x) => x.c.id);
}

/** Menor nº de cartas entre los oponentes (para saber si alguien está a punto de ganar). */
const rivalMin = (s: GameState, p: number) => Math.min(...s.players.filter((x) => x.id !== p).map((x) => x.hand.length));

/** ¿Quedaría el Entorno maldito (2 o más) si esta carta de Entorno cambia su estado? */
function envAfter(s: GameState, c: Card): number {
  const e = { mutis: s.env.mutis, inutilizar: s.env.inutilizar, tinieblas: !!s.env.tinieblas };
  if (c.kind === 'mutis' && !e.inutilizar) e.mutis = !e.mutis;
  if (c.kind === 'inutilizar') e.inutilizar = !e.inutilizar;
  if (c.kind === 'tinieblas') e.tinieblas = !e.tinieblas;
  return Number(e.mutis) + Number(e.inutilizar) + Number(e.tinieblas);
}

function scorePlay(s: GameState, p: number, c: Card): number {
  const hand = s.players[p].hand;
  const cursed = hand.some(isCursed);
  const inutil = s.env.inutilizar && c.color !== null;
  const few = hand.length <= 2;
  // Un oponente a punto de ganar: conviene atacar, robarle o bloquear la victoria.
  const danger = rivalMin(s, p) <= 2;
  let v: number;
  switch (c.kind) {
    case 'antitodo': {
      // Sin Maldición, el Antitodo vale más guardado (para defenderse). Solo se juega si sirve de algo:
      // ganar con la última carta, deshacer un Entorno maldito que me impide ganar o quitar Égidas cuando hay peligro.
      if (hand.some((x) => x.kind === 'maldicion')) { v = 12; break; }
      if (hand.length === 1) { v = isCursedEnv(s) ? -8 : 11; break; }
      if (isCursedEnv(s) && hand.length <= 3 && !danger) { v = 6; break; }
      v = -10;
      break;
    }
    case 'gema1': case 'gema2': case 'gema3': v = 5; break;
    case 'gematri': v = 5 + hand.filter(isPlainGem).length; break;
    case 'travesura': v = inutil ? 3 : cursed ? 9 : 6; break;
    case 'codicia': v = inutil ? 3 : cursed ? 8 : 4; break;
    case 'purga': v = cursed ? 9 : 4; break;
    case 'predestinar': v = cursed ? 10 : 5; break;
    case 'recuperar': v = s.pile.slice(0, -1).some((x) => x.kind === 'maldicion') ? 7 : 2; break;
    case 'iman': v = 6; break;
    case 'trastada': v = cursed ? 10 : 7; break;
    case 'escarcha': v = 5; break;
    case 'rafaga': v = 6; break;
    case 'ritual1': case 'ritual2': case 'ritual3': v = hand.filter((x) => RITUALS.includes(x.kind)).length >= 2 ? -6 : 3; break;
    case 'aplastar': v = inutil ? 3 : 6; break;
    case 'cristalizar': v = 7; break;
    case 'adivinar': v = 4; break;
    case 'mutis': case 'inutilizar': case 'tinieblas': {
      v = c.kind === 'tinieblas' ? 2 : 3;
      const after = envAfter(s, c);
      // Crear un Entorno maldito bloquea a quien va a ganar; deshacerlo me abre la victoria.
      if (after >= 2 && danger && !few) v += 8;
      if (after >= 2 && few) v -= 7;
      if (after < 2 && isCursedEnv(s) && few && !danger) v += 6;
      break;
    }
    default: v = 0;
  }
  if (danger) {
    const attr = KINDS[c.kind].attr;
    if (attr === 'ataque' && !inutil) v += 4;
    if ((c.kind === 'codicia' || c.kind === 'predestinar') && !inutil) v += 3;
  }
  if (few && c.kind !== 'antitodo') v += 3;
  return v;
}

function chooseValue(s: GameState, p: number, lvl: Level, r: Rnd): string | number | null {
  const ph = s.phase;
  if (ph.t !== 'choose') return null;
  const hand = s.players[p].hand;
  const e = ph.pp.companion ?? ph.pp.card;
  const opts = ph.options;
  if (lvl === 0 && ph.need !== 'gem') return pick(opts, r);
  switch (ph.need) {
    case 'gem': return opts[0];
    case 'card': {
      const cs = companions(s, p, ph.pp.card.id);
      const c = cs.find(isCursed) ?? cs.find((x) => x.kind === 'travesura') ?? cs.find(isGem) ?? cs.sort((a, b) => rankOf(a) - rankOf(b))[0];
      return c.id;
    }
    case 'target': {
      const players = opts as number[];
      const others = players.filter((x) => x !== p);
      const self = players.includes(p);
      if (ph.pp.card.kind === 'predestinar') {
        const attr = KINDS[e.kind].attr;
        if (attr === 'maldita' || attr === 'ataque' || attr === 'magia') {
          if (e.kind === 'purga' && self && hand.some(isCursed)) return p;
          return leader(s, p, others);
        }
        return self ? p : pick(players, r);
      }
      if (e.kind === 'purga') {
        if (self && hand.some(isCursed)) return p;
        // Purgar a quien tiene 1 carta no sirve (roba otra): mejor a quien tenga pocas pero más de una.
        const useful = others.filter((x) => s.players[x].hand.length > 1);
        return leader(s, p, useful.length ? useful : others);
      }
      if (e.kind === 'codicia') {
        // Con una maldita que colocar, al líder; si no, a quien más cartas (mejores) tenga.
        if (hand.some(isCursed)) return leader(s, p, others);
        const most = Math.max(...others.map((x) => s.players[x].hand.length));
        return pick(others.filter((x) => s.players[x].hand.length >= most - 1), r);
      }
      return pick(players, r);
    }
  }
}

function reactChoice(s: GameState, p: number, lvl: Level, r: Rnd): Action {
  const ph = s.phase;
  const pass: Action = { type: 'react', player: p, r: 'pass' };
  if (ph.t !== 'react') return pass;
  const opts = reactOptions(s, p);
  const eff = ph.eff;
  const hand = s.players[p].hand;
  const isTarget = eff.targets.includes(p);
  const has = (k: ReactKind) => opts.includes(k);
  if (isBlind(s)) {
    // A ciegas: usa la Égida boca arriba si la tiene; si no, a veces "recuerda" dónde tiene una defensa.
    if (!isTarget || eff.k === 'purga' || eff.k === 'rpurga' || eff.k === 'rcodicia') return pass;
    if (has('egida')) return { type: 'react', player: p, r: 'egida' };
    const good = hand.find((c) => c.kind === 'egida' || c.kind === 'reflejo' || (eff.k === 'trav' && !eff.noChain && c.kind === 'travesura' && !(s.env.inutilizar && c.color)));
    if (has('blind') && good && r() < [0.1, 0.35, 0.6][lvl]) return { type: 'react', player: p, r: 'blind', cardId: good.id };
    return pass;
  }
  if (has('gems')) {
    const tone = eff.k === 'cristal' ? eff.tone : null;
    return { type: 'react', player: p, r: 'gems', ids: hand.filter((c) => isPlainGem(c) && c.color === tone).map((c) => c.id) };
  }
  if (!isTarget) return pass; // no se mete en líos ajenos
  if (lvl === 0 && r() < 0.45) return pass;
  if (eff.k === 'purga' || eff.k === 'rpurga') return hand.some(isCursed) || lvl < 2 ? pass : has('egida') ? { type: 'react', player: p, r: 'egida' } : pass;
  if (eff.k === 'rcodicia') return pass;
  if (has('chain')) {
    const c = hand.find((x) => (x.kind === 'travesura' || x.kind === 'trastada') && !(s.env.inutilizar && x.color))!;
    return { type: 'react', player: p, r: 'chain', cardId: c.id };
  }
  if (has('gem') && eff.k === 'cristal') {
    const c = hand.find((x) => isPlainGem(x) && x.color === eff.tone) ?? hand.find((x) => x.kind === 'gematri')!;
    return { type: 'react', player: p, r: 'gem', cardId: c.id };
  }
  // Solo bloquea (y devuelve) lo que perjudica: una Maldición o la Condena.
  if (eff.k === 'gift') return has('antitodo') && lvl >= 1 && isCursed(eff.card) ? { type: 'react', player: p, r: 'antitodo' } : pass;
  if (has('egida')) return { type: 'react', player: p, r: 'egida' };
  if (has('reflejo')) {
    const src = eff.k === 'trav' ? eff.launchers[eff.launchers.length - 1] : eff.source;
    // Se lo devuelve a quien lo lanzó, salvo que otro esté a punto de ganar.
    const target = lvl === 2 || src === p || rivalMin(s, p) <= 2 ? leader(s, p) : src;
    return { type: 'react', player: p, r: 'reflejo', target };
  }
  if (has('antitodo') && lvl === 2) {
    const heavy = (eff.k === 'draw' && eff.amount >= 6) || (eff.k === 'trav' && eff.amount >= 4) || eff.k === 'riman' || hand.length <= 2;
    if (heavy && !hand.some((c) => c.kind === 'maldicion')) return { type: 'react', player: p, r: 'antitodo' };
  }
  return pass;
}

export function botDecide(s: GameState, p: number, lvl: Level, r: Rnd = Math.random): Action | null {
  const ph = s.phase;
  const me = s.players[p];
  const hand = me.hand;
  switch (ph.t) {
    case 'turn': {
      if (s.turn !== p) return null;
      if (ph.drawn) {
        const c = hand.find((x) => x.id === ph.drawn)!;
        if (!c || (!isBlind(s) && !isLegal(s, p, c))) return { type: 'keep', player: p };
        return scorePlay(s, p, c) >= 0 || lvl === 0 ? { type: 'play', player: p, cardId: c.id } : { type: 'keep', player: p };
      }
      if (!hand.length) return { type: 'draw', player: p };
      if (isBlind(s)) {
        // A ciegas: los niveles altos "recuerdan" mejor qué carta es cuál.
        const legal = hand.filter((c) => isLegal(s, p, c) && scorePlay(s, p, c) >= 0);
        const memory = [0.15, 0.45, 0.75][lvl];
        if (legal.length && r() < memory) return { type: 'play', player: p, cardId: pick(legal, r).id };
        if (r() < 0.25) return { type: 'draw', player: p };
        return { type: 'play', player: p, cardId: pick(hand, r).id };
      }
      const legal = hand.filter((c) => isLegal(s, p, c));
      if (!legal.length) return { type: 'draw', player: p };
      if (lvl === 0) return r() < 0.85 ? { type: 'play', player: p, cardId: pick(legal, r).id } : { type: 'draw', player: p };
      const scored = legal.map((c) => ({ c, v: scorePlay(s, p, c) + (lvl === 1 ? r() * 3 : r()) })).sort((a, b) => b.v - a.v);
      if (scored[0].v < 0) return { type: 'draw', player: p };
      return { type: 'play', player: p, cardId: scored[0].c.id };
    }
    case 'choose':
      return ph.player === p ? { type: 'choose', player: p, value: chooseValue(s, p, lvl, r) } : null;
    case 'tinte':
      return ph.player === p ? { type: 'color', player: p, color: lvl === 0 ? pick(COLORS, r) : bestColor(s, p, r) } : null;
    case 'react':
      return ph.waiting.includes(p) ? reactChoice(s, p, lvl, r) : null;
    case 'aplastar':
      return ph.players.includes(p) && !ph.slapped.includes(p) ? { type: 'slap', player: p } : null;
    case 'give': {
      if (!ph.waiting.includes(p)) return null;
      const n = ph.need[p];
      const ids = lvl === 0 ? [...hand].sort(() => r() - 0.5).slice(0, n).map((c) => c.id) : worstN(hand, n);
      return { type: 'give', player: p, cardId: ids[0], ids };
    }
    case 'escarcha': {
      if (ph.player !== p) return null;
      const hands: Record<number, string[]> = {};
      for (const t of ph.targets) hands[t] = s.players[t].hand.map((c) => c.id);
      let give: { cardId: string; to: number } | null = null;
      if (lvl > 0 && ph.targets.length > 1) {
        // Al que va ganando, lo peor de todos; el resto se reparte como estaba.
        const lead = leader(s, p, ph.targets, r);
        const all = ph.targets.flatMap((t) => s.players[t].hand).sort((a, b) => worth(a) - worth(b));
        const n = s.players[lead].hand.length;
        hands[lead] = all.slice(0, n).map((c) => c.id);
        let rest = all.slice(n);
        for (const t of ph.targets) if (t !== lead) { hands[t] = rest.slice(0, s.players[t].hand.length).map((c) => c.id); rest = rest.slice(s.players[t].hand.length); }
      }
      const curse = hand.find(isCursed);
      if (curse && lvl > 0) give = { cardId: curse.id, to: leader(s, p, ph.targets, r) };
      return { type: 'escarcha', player: p, hands, give };
    }
    case 'rafaga': {
      const rf = s.rafaga;
      if (!rf || rf.player !== p) return null;
      const rivals = rf.allowed.filter((x) => x !== p);
      for (const c of rf.pool) {
        const ok = predTargets(s, p, c).filter((x) => rf.allowed.includes(x));
        if (!ok.length) continue;
        if (HARMFUL.includes(c.kind)) {
          const among = ok.filter((x) => x !== p);
          if (among.length) return { type: 'rafaga', player: p, cardId: c.id, target: leader(s, p, among, r) };
        }
        if ((c.kind === 'adivinar' || c.kind === 'recuperar') && ok.includes(p)) return { type: 'rafaga', player: p, cardId: c.id, target: p };
      }
      if (rf.pool.length) return { type: 'rafaga', player: p, cardId: null };
      const curse = rf.own && lvl > 0 ? hand.find(isCursed) : undefined;
      if (curse && rivals.length) return { type: 'rafaga', player: p, cardId: curse.id, target: leader(s, p, rivals, r) };
      return { type: 'rafaga', player: p, cardId: null };
    }
    case 'codicia': {
      if (!ph.waiting.includes(p)) return null;
      if (ph.launcher === p) return { type: 'give', player: p, cardId: (lvl === 0 ? pick(hand, r) : worstToGive(hand)).id };
      return { type: 'pick', player: p, ids: pickTied(hand, ph.options, 1, lvl, r) };
    }
    case 'imanPick':
      return ph.waiting.includes(p) ? { type: 'pick', player: p, ids: pickTied(hand, ph.picks[p].options, ph.picks[p].count, lvl, r) } : null;
    case 'iman': {
      if (ph.launcher !== p) return null;
      const assign: Record<string, 'keep' | 'discard' | number> = {};
      const load: Record<number, number> = {};
      let kept = 0;
      const rivals = s.players.filter((x) => x.id !== p).map((x) => ({ id: x.id, k: x.hand.length + (x.hand.length <= 2 ? 0 : r() * 2) })).sort((a, b) => a.k - b.k).map((x) => x.id);
      for (const c of ph.pool) {
        if (isCursed(c) && lvl > 0) {
          // Una a cada rival antes de repetir: no se las lleva todas el mismo.
          const min = Math.min(...rivals.map((x) => load[x] ?? 0));
          const to = min < 3 ? rivals.find((x) => (load[x] ?? 0) === min) : undefined;
          if (to !== undefined) { assign[c.id] = to; load[to] = (load[to] ?? 0) + 1; continue; }
        }
        if (c.kind === 'antitodo' && kept < 3 && hand.some((x) => x.kind === 'maldicion')) { assign[c.id] = 'keep'; kept++; continue; }
        assign[c.id] = 'discard';
      }
      return { type: 'iman', player: p, assign };
    }
    case 'adivinar': {
      if (ph.player !== p) return null;
      const keep: string[] = [], discard: string[] = [], back: string[] = [];
      for (const c of ph.cards) {
        if (isCursed(c)) discard.push(c.id);
        else if (c.kind === 'antitodo' && lvl > 0) keep.push(c.id);
        else back.push(c.id);
      }
      return { type: 'adivinar', player: p, keep, discard, back };
    }
    case 'recuperar': {
      if (ph.player !== p) return null;
      const cards = ph.options.map((id) => s.pile.find((c) => c.id === id)!);
      const curse = cards.find((c) => c.kind === 'maldicion');
      if (curse && lvl > 0) return { type: 'recuperar', player: p, cardId: curse.id, to: leader(s, p) };
      const good = cards.find((c) => c.kind === 'antitodo') ?? cards.find((c) => c.kind === 'reflejo') ?? cards.find((c) => c.color === s.color && !isCursed(c)) ?? cards.find((c) => !isCursed(c)) ?? cards[0];
      return { type: 'recuperar', player: p, cardId: good.id, to: isCursed(good) ? leader(s, p) : p };
    }
    case 'gemas':
      return ph.waiting.includes(p) ? { type: 'gemas', player: p, ids: hand.filter(isPlainGem).map((c) => c.id) } : null;
    case 'condena': {
      if (ph.player !== p) return null;
      if (ph.absolved) return { type: 'absolve', player: p, to: leader(s, p) };
      const rivals = s.players.filter((x) => x.id !== p && x.hand.length > 0).map((x) => x.id);
      if (lvl > 0 && s.pile.slice(0, -1).some((c) => c.kind === 'maldicion')) return { type: 'search', player: p, where: 'pile' };
      if (lvl === 2) {
        const holder = rivals.find((x) => s.players[x].hand.some((c) => c.kind === 'maldicion'));
        if (holder !== undefined && r() < 0.6) return { type: 'search', player: p, where: holder };
      }
      return { type: 'search', player: p, where: rivals.length ? pick(rivals, r) : 'deck' };
    }
    case 'over':
      return null;
  }
}

/** ¿Quiere esta máquina duplicar la carta superior de la Pila? */
export function botDup(s: GameState, p: number, lvl: Level, r: Rnd = Math.random): Action | null {
  const c = s.players[p].hand.find((x) => canDup(s, p, x));
  if (!c) return null;
  if (r() > [0.5, 0.8, 0.95][lvl]) return null;
  // No deshace un Entorno maldito si no va ganando ni lo crea si está a punto de ganar.
  if (KINDS[c.kind].attr === 'entorno' && lvl === 2 && s.players[p].hand.length <= 2 && !isCursedEnv(s) && topCard(s).kind === c.kind) {
    const active = c.kind === 'mutis' ? s.env.mutis : c.kind === 'inutilizar' ? s.env.inutilizar : !!s.env.tinieblas;
    if (!active) return null;
  }
  return { type: 'dup', player: p, cardId: c.id };
}
