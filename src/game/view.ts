// Lo que ve cada jugador de la partida online. El servidor nunca envía el estado completo:
// las manos ajenas, el Mazo y la semilla (que permitiría calcular el Mazo) se sustituyen por cartas
// boca abajo. Los ids también se cambian, porque `c0`, `c1`… siguen el orden fijo del mazo y delatan la carta.

import { Card, isCursed } from './cards';
import { GameState, Phase } from './engine';

/** Carta boca abajo. La interfaz solo cuenta las cartas ajenas y pinta su dorso. */
const back = (id: string): Card => ({ id, kind: 'maldicion', color: null });

export function viewFor(full: GameState, me: number): GameState {
  // Al terminar se enseña todo (resumen final con las manos de todos).
  if (full.phase.t === 'over') return { ...full, seed: 0, deck: full.deck.map((_, i) => back(`d${i}`)) };

  const s: GameState = structuredClone(full);
  const ph = s.phase;
  s.seed = 0;
  s.deck = s.deck.map((_, i) => back(`d${i}`));
  // El historial completo puede ser muy largo: durante la partida basta con lo último.
  s.log = s.log.slice(-200);

  /** Cartas ajenas que este jugador sí puede ver ahora mismo. */
  const visible = new Set<string>();
  if (ph.t === 'react' && ph.eff.k === 'cristal') for (const h of ph.eff.held ?? []) h.ids.forEach((id) => visible.add(id));
  if (ph.t === 'gemas') for (const ids of Object.values(ph.chosen)) ids.forEach((id) => visible.add(id));
  // Escarcha: quien la lanza ve y reordena las manos de los oponentes.
  if (ph.t === 'escarcha' && ph.player === me) for (const t of ph.targets) s.players[t].hand.forEach((c) => visible.add(c.id));

  s.players.forEach((pl, p) => {
    if (p === me) return;
    pl.hand = pl.hand.map((c, i) => (visible.has(c.id) ? c : back(`h${p}.${i}`)));
  });

  const hideCards = (cards: Card[], tag: string) => cards.map((c, i) => back(`${tag}${i}`));
  s.phase = hidePhase(ph, me, hideCards);
  // Tinieblas: lo que quedó oculto (qué carta se entregó) no se envía hasta que se disipan, y la carta que se
  // está entregando ahora solo la ve quien la da.
  if (s.env.tinieblas) {
    s.env.tinieblas.secrets = [];
    s.env.tinieblas.known = [];
    const p2 = s.phase;
    if (p2.t === 'react' && p2.eff.k === 'gift' && p2.eff.source !== me) s.phase = { ...p2, eff: { ...p2.eff, card: back('gift') } };
  }

  // Animaciones: una carta concreta solo viaja a la vista si sale o llega a la Pila, o si es mía.
  // Las cartas malditas (Maldición, Condena) que pasan de un jugador a otro se ven boca arriba para todos.
  s.fx = s.fx.map((f) => (f.card && f.from !== 'pile' && f.to !== 'pile' && f.from !== me && f.to !== me && !isCursed(f.card) ? { ...f, card: undefined } : f));
  return s;
}

function hidePhase(ph: Phase, me: number, hide: (c: Card[], tag: string) => Card[]): Phase {
  switch (ph.t) {
    case 'adivinar':
      return ph.player === me ? ph : { ...ph, cards: hide(ph.cards, 'a') };
    case 'iman':
      return ph.launcher === me ? ph : { ...ph, pool: hide(ph.pool, 'i') };
    case 'codicia':
      return {
        ...ph,
        options: ph.target === me ? ph.options : [],
        best: ph.target === me ? ph.best : null,
        give: ph.launcher === me ? ph.give : null,
      };
    case 'imanPick': {
      const picks = ph.picks[me] ? { [me]: ph.picks[me] } : {};
      const chosen = ph.chosen[me] ? { [me]: ph.chosen[me] } : {};
      return { ...ph, picks, chosen };
    }
    case 'give':
      return { ...ph, eff: { ...ph.eff, given: ph.eff.given.map((g, i) => (g.from === me ? g : { from: g.from, card: hide([g.card], `g${i}.`)[0] })) } };
    case 'react':
      if (ph.eff.k === 'trav') return { ...ph, eff: { ...ph.eff, given: ph.eff.given.map((g, i) => (g.from === me ? g : { from: g.from, card: hide([g.card], `g${i}.`)[0] })) } };
      return ph;
    default:
      return ph;
  }
}
