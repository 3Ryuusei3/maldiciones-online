// Anfitrión local: guarda el estado, mueve a las máquinas y lleva los relojes.
// El motor no sabe nada de tiempo; para el online bastará con que el anfitrión
// reciba las acciones de los demás por Supabase y les envíe el estado resultante.

import { useCallback, useEffect, useRef, useState } from 'react';
import { botDecide, botDup, Level } from '../game/bot';
import { Action, GameState, apply, canDup, newGame, pendingPlayers, topCard } from '../game/engine';
import { BOT_WINDOW_MS, DECIDE_MS, WINDOW_MS, botDelay, dupDelay, pickNames } from '../game/timing';

export interface GameConfig {
  name: string;
  players: number;
  level: Level;
  extraCurses: boolean;
  condena: boolean;
  /** Cartas beta de V7 (Escarcha, Ráfaga, Trastada y Rituales). */
  beta?: boolean;
  /** Tiempo máximo de 15 s para cada decisión (por defecto, sí). */
  timer?: boolean;
  /** Solo para pruebas (?mano=tinieblas,reflejo): cartas que empiezan en mi mano, y empiezo yo. */
  debugHand?: string[];
}

/** Asiento del jugador de este navegador. En local es siempre 0; online lo fija la sala (setMe). */
export let ME = 0;
export const setMe = (p: number) => { ME = p; };

export interface Timer { until: number; total: number }

/** `enabled = false`: no aloja nada (la partida online la lleva el servidor). */
export function useGame(cfg: GameConfig, ready = true, paused = false, enabled = true) {
  const [state, setState] = useState<GameState>(() => {
    const g = newGame({
      players: [{ name: cfg.name || 'Tú', bot: false }, ...pickNames(cfg.players - 1, [cfg.name || 'Tú']).map((name) => ({ name, bot: true }))],
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
  /** Reloj visible: el de una ventana (`w<n>`) o el de mi decisión pendiente (`s<seq>`). */
  const [timer, setTimer] = useState<(Timer & { key: string }) | null>(null);
  /** Momentos ya planificados para cada máquina dentro de una ventana. */
  const plan = useRef<{ key: string; at: Record<number, number> }>({ key: '', at: {} });
  const dupPlan = useRef<Record<string, number>>({});
  /** Fin de la ventana en curso aunque yo no esté en ella (no se reinicia con cada acción de otro). */
  const winUntil = useRef(0);

  // Pausa: al reanudar, los relojes y las decisiones planificadas se retrasan lo que duró la pausa.
  const pausedAt = useRef(0);
  useEffect(() => {
    if (paused) { pausedAt.current = Date.now(); return; }
    if (!pausedAt.current) return;
    const d = Date.now() - pausedAt.current;
    pausedAt.current = 0;
    if (timer) timer.until += d;
    if (winUntil.current) winUntil.current += d;
    for (const k of Object.keys(plan.current.at)) plan.current.at[+k] += d;
    for (const k of Object.keys(dupPlan.current)) if (dupPlan.current[k] > 0) dupPlan.current[k] += d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const dispatch = useCallback((a: Action) => setState((prev) => apply(prev, a)), []);

  useEffect(() => {
    const s = state;
    const ph = s.phase;
    if (!enabled || ph.t === 'over' || !ready || paused) return;
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, ms)));
    const now = Date.now();
    const pend = pendingPlayers(s);
    const windowed = ph.t === 'react' || ph.t === 'aplastar' || ph.t === 'gemas';

    // Reloj de la ventana (solo visible si el humano tiene algo que decidir).
    let until = 0;
    if (windowed) {
      const wk = `w${ph.win}`;
      // El reloj de la ventana se fija al abrirse (la clave de plan cambia con la ventana).
      const fresh = plan.current.key !== `${ph.t}:${ph.win}`;
      const humanIn = pend.includes(ME) || timer?.key === wk;
      const total = humanIn ? WINDOW_MS[ph.t] : Math.min(BOT_WINDOW_MS, WINDOW_MS[ph.t]);
      if (timer?.key !== wk) {
        until = fresh || !winUntil.current ? now + total : winUntil.current;
        winUntil.current = until;
        if (pend.includes(ME)) setTimer({ key: wk, until, total });
      } else until = timer.until;
      later(until - now, () => dispatch({ type: 'timeout' }));
    } else if (pend.includes(ME) && !s.players[ME].bot && cfg.timer !== false) {
      // Cualquier otra decisión mía tiene un tiempo máximo: al agotarse, juega la máquina por mí.
      const sk = `s${s.seq}`;
      // Reloj nuevo para cada decisión (y si se acaba de volver a activar el tiempo máximo con uno ya vencido).
      if (timer?.key !== sk || timer.until <= now) {
        until = now + DECIDE_MS;
        setTimer({ key: sk, until, total: DECIDE_MS });
      } else until = timer.until;
      later(until - now, () => {
        const cur = ref.current;
        if (cur.seq !== s.seq) return;
        const a = botDecide(cur, ME, 1);
        if (a) dispatch(a);
      });
    }

    // Máquinas con algo que decidir.
    const key = windowed ? `${ph.t}:${ph.win}` : `${s.seq}`;
    if (plan.current.key !== key) plan.current = { key, at: {} };
    const humanCanDup = s.players[ME].hand.some((c) => canDup(s, ME, c));
    for (const p of pend) {
      if (!s.players[p].bot) continue;
      let at = plan.current.at[p];
      if (at === undefined) at = plan.current.at[p] = now + botDelay(s, cfg.level, humanCanDup);
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
        dupPlan.current[k] = a ? now + dupDelay() : 0;
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
  }, [state, timer, ready, paused, cfg.timer]);

  const ph = state.phase;
  const windowed = ph.t === 'react' || ph.t === 'aplastar' || ph.t === 'gemas';
  const activeTimer = timer && (windowed ? 'win' in ph && timer.key === `w${ph.win}` : timer.key === `s${state.seq}` && pendingPlayers(state).includes(ME) && cfg.timer !== false) ? timer : null;
  return { state, dispatch, timer: activeTimer as Timer | null };
}
