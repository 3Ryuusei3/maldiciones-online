// Anfitrión local: guarda el estado, mueve a las máquinas y lleva los relojes.
// El motor no sabe nada de tiempo; para el online bastará con que el anfitrión
// reciba las acciones de los demás por Supabase y les envíe el estado resultante.

import { useCallback, useEffect, useRef, useState } from 'react';
import { botDecide, botDup, Level } from '../game/bot';
import { Action, GameState, apply, canDup, newGame, pendingPlayers, topCard } from '../game/engine';

export interface GameConfig {
  name: string;
  players: number;
  level: Level;
  extraCurses: boolean;
  condena: boolean;
  /** Cartas beta de V7 (Escarcha, Ráfaga, Trastada y Rituales). */
  beta?: boolean;
  /** Solo para pruebas (?mano=tinieblas,reflejo): cartas que empiezan en mi mano, y empiezo yo. */
  debugHand?: string[];
}

export const ME = 0;
/** Multiplicador de las pausas de las máquinas: ritmo único y pausado, para que dé tiempo a ver cada jugada. */
const PACE = 1;
const BOT_NAMES = ['Lilith', 'Grimm', 'Morgana', 'Corvus', 'Nyx', 'Hécate', 'Salem', 'Circe', 'Merlín', 'Baba Yaga', 'Fausto', 'Medea', 'Belial', 'Ágata', 'Mordred', 'Sibila', 'Rasputín', 'Carmilla', 'Astaroth', 'Nimue', 'Erebo', 'Brujilda', 'Lázaro', 'Úrsula', 'Vlad', 'Pandora', 'Azrael', 'Melusina', 'Caronte', 'Lucero'];
/** Rivales al azar y sin repetir (ni coincidir con el nombre del jugador). */
const pickNames = (n: number, mine: string) => BOT_NAMES.filter((x) => x.toLowerCase() !== mine.toLowerCase()).map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);
const between = (a: number, b: number) => a + Math.random() * (b - a);

/** Duración (ms) de las ventanas cuando hay un humano implicado. */
const WINDOW_MS = { react: 15000, aplastar: 4000, gemas: 15000 };
/** Margen antes de que las máquinas empiecen a reaccionar en Aplastar, para que dé tiempo a verlo venir. */
export const SLAP_GRACE = 900;
const SLAP_MS: [number, number][] = [[900, 2400], [650, 1800], [450, 1300]];

export interface Timer { until: number; total: number }

export function useGame(cfg: GameConfig, ready = true, paused = false) {
  const [state, setState] = useState<GameState>(() => {
    const g = newGame({
      players: [{ name: cfg.name || 'Tú', bot: false }, ...pickNames(cfg.players - 1, cfg.name || 'Tú').map((name) => ({ name, bot: true }))],
      seed: (Math.random() * 2 ** 31) | 0,
      extraCurses: cfg.extraCurses,
      condena: cfg.condena,
      beta: cfg.beta,
    });
    for (const kind of cfg.debugHand ?? []) {
      const j = g.players[ME].hand.findIndex((c) => c.kind !== 'maldicion' && !cfg.debugHand!.includes(c.kind));
      if (j < 0) continue;
      for (const src of [g.deck, ...g.players.slice(1).map((p) => p.hand)]) {
        const i = src.findIndex((c) => c.kind === kind);
        if (i >= 0) { [src[i], g.players[ME].hand[j]] = [g.players[ME].hand[j], src[i]]; break; }
      }
    }
    if (cfg.debugHand) g.turn = ME;
    return g;
  });
  const ref = useRef(state);
  ref.current = state;
  const [timer, setTimer] = useState<(Timer & { key: number }) | null>(null);
  /** Momentos ya planificados para cada máquina dentro de una ventana. */
  const plan = useRef<{ key: string; at: Record<number, number> }>({ key: '', at: {} });
  const dupPlan = useRef<Record<string, number>>({});

  // Pausa: al reanudar, los relojes y las decisiones planificadas se retrasan lo que duró la pausa.
  const pausedAt = useRef(0);
  useEffect(() => {
    if (paused) { pausedAt.current = Date.now(); return; }
    if (!pausedAt.current) return;
    const d = Date.now() - pausedAt.current;
    pausedAt.current = 0;
    if (timer) timer.until += d;
    for (const k of Object.keys(plan.current.at)) plan.current.at[+k] += d;
    for (const k of Object.keys(dupPlan.current)) if (dupPlan.current[k] > 0) dupPlan.current[k] += d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const dispatch = useCallback((a: Action) => setState((prev) => apply(prev, a)), []);

  useEffect(() => {
    const s = state;
    const ph = s.phase;
    if (ph.t === 'over' || !ready || paused) return;
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, ms)));
    const now = Date.now();
    const pend = pendingPlayers(s);
    const windowed = ph.t === 'react' || ph.t === 'aplastar' || ph.t === 'gemas';

    // Reloj de la ventana (solo visible si el humano tiene algo que decidir).
    let until = 0;
    if (windowed) {
      const humanIn = pend.includes(ME) || timer?.key === ph.win;
      const total = humanIn ? WINDOW_MS[ph.t] : Math.min(6000, WINDOW_MS[ph.t]);
      if (timer?.key !== ph.win) {
        until = now + total;
        if (pend.includes(ME)) setTimer({ key: ph.win, until, total });
      } else until = timer.until;
      later(until - now, () => dispatch({ type: 'timeout' }));
    }

    // Máquinas con algo que decidir.
    const key = windowed ? `${ph.t}:${ph.win}` : `${s.seq}`;
    if (plan.current.key !== key) plan.current = { key, at: {} };
    const humanCanDup = s.players[ME].hand.some((c) => canDup(s, ME, c));
    for (const p of pend) {
      if (!s.players[p].bot) continue;
      let at = plan.current.at[p];
      if (at === undefined) {
        let d: number;
        const k = PACE;
        if (ph.t === 'turn') d = Math.max(between(3000, 3800) * k, humanCanDup ? 4800 : 0);
        else if (ph.t === 'aplastar') d = SLAP_GRACE + between(...SLAP_MS[cfg.level]);
        else if (ph.t === 'react') d = between(2200, 3000) * k;
        else if (ph.t === 'gemas') d = between(1300, 2100) * k;
        else if (ph.t === 'choose' || ph.t === 'tinte') d = between(1400, 2000) * k;
        else d = between(1700, 2300) * k;
        at = plan.current.at[p] = now + d;
      }
      later(at - now, () => {
        const cur = ref.current;
        const a = botDecide(cur, p, cfg.level);
        if (a) dispatch(a);
      });
    }

    // Máquinas que quieren duplicar la carta superior (se lo piensan una vez por carta).
    const top = topCard(s).id;
    for (const pl of s.players) {
      if (!pl.bot) continue;
      const k = `${top}:${pl.id}`;
      if (dupPlan.current[k] === undefined) {
        const a = botDup(s, pl.id, cfg.level);
        dupPlan.current[k] = a ? now + between(2000, 3400) * PACE : 0;
      }
      const at = dupPlan.current[k];
      if (at > 0)
        later(at - now, () => {
          const cur = ref.current;
          const c = cur.players[pl.id].hand.find((x) => canDup(cur, pl.id, x));
          dupPlan.current[k] = 0;
          if (c && topCard(cur).id === top) dispatch({ type: 'dup', player: pl.id, cardId: c.id });
        });
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, timer, ready, paused]);

  const ph = state.phase;
  const activeTimer = (ph.t === 'react' || ph.t === 'aplastar' || ph.t === 'gemas') && timer?.key === ph.win ? timer : null;
  return { state, dispatch, timer: activeTimer as Timer | null };
}
