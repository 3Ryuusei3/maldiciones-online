// Anfitrión local: guarda el estado, mueve a las máquinas y lleva los relojes.
// El motor no sabe nada de tiempo; para el online bastará con que el anfitrión
// reciba las acciones de los demás por Supabase y les envíe el estado resultante.

import { useCallback, useEffect, useRef, useState } from 'react';
import { botDecide, botDup, Level } from '../game/bot';
import { Action, GameState, apply, canDup, newGame, pendingPlayers, topCard } from '../game/engine';
import { newTutorial, tutorBot } from '../game/tutorial';
import { Recording, buildRecord, recordAction, startRecording } from '../game/record';
import { playerId, saveLocalGame } from '../net/client';
import type { TutorGate } from './Tutorial';
import { BOT_WINDOW_MS, DECIDE_MS, TINIEBLAS_PEEK_MS, WINDOW_MS, botDelay, dupDelay, pickNames, tinieblasJustFell } from '../game/timing';

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
  /** Mi color en local (índice de la paleta de jugadores); las máquinas usan los que quedan. */
  color?: number;
  /** Mi icono (los de las cartas); las máquinas llevan uno al azar. */
  icon?: string;
  /** Solo para pruebas (?mano=tinieblas,reflejo): cartas que empiezan en mi mano, y empiezo yo. */
  debugHand?: string[];
  /** Solo para pruebas (?solo): mi mano queda solo con las cartas de `debugHand`. */
  debugSolo?: boolean;
  /** Tutorial: partida preparada y máquinas con jugadas fijas. */
  tutorial?: boolean;
  /** Partidas de prueba (?demo): no se guardan. */
  debug?: boolean;
  /** Solo para pruebas (?bot=aplastar): cartas que empiezan en la mano de la primera máquina, y empieza ella. */
  debugBot?: string[];
}

/** Asiento del jugador de este navegador. En local es siempre 0; online lo fija la sala (setMe). */
export let ME = 0;
export const setMe = (p: number) => { ME = p; };

export interface Timer { until: number; total: number }

/** `enabled = false`: no aloja nada (la partida online la lleva el servidor). */
export function useGame(cfg: GameConfig, ready = true, paused = false, enabled = true, gate?: TutorGate) {
  const [state, setState] = useState<GameState>(() => {
    if (cfg.tutorial) return newTutorial(cfg.name);
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
    if (cfg.debugSolo && cfg.debugHand) {
      const keep = g.players[ME].hand.filter((c) => cfg.debugHand!.includes(c.kind));
      g.deck.push(...g.players[ME].hand.filter((c) => !keep.includes(c)));
      g.players[ME].hand = keep;
    }
    if (cfg.debugHand) g.turn = ME;
    if (cfg.debugBot) {
      // La máquina solo tiene esas cartas (todas las que haya en el mazo) para que las juegue seguro.
      const bh = g.players[1].hand;
      g.deck.push(...bh.splice(0));
      for (let i = g.deck.length - 1; i >= 0; i--) if (cfg.debugBot.includes(g.deck[i].kind)) bh.push(...g.deck.splice(i, 1));
    }
    if (cfg.debugBot) g.turn = 1;
    return g;
  });
  const ref = useRef(state);
  ref.current = state;
  /** Registro de la partida (estado inicial y acciones) para guardarla al acabar. El tutorial y las pruebas no se guardan. */
  const rec = useRef<Recording | null>(null);
  if (rec.current === null && enabled && !cfg.tutorial && !cfg.debug && !cfg.debugHand && !cfg.debugBot) rec.current = startRecording(crypto.randomUUID(), state, Date.now());
  const save = useCallback((s: GameState) => {
    const r = rec.current;
    if (!r || r.saved || !r.actions.length) return;
    r.saved = true;
    saveLocalGame(buildRecord(r, s, {
      mode: 'local', now: Date.now(),
      options: { size: cfg.players, level: cfg.level, extraCurses: cfg.extraCurses, condena: cfg.condena, beta: !!cfg.beta, timer: cfg.timer !== false },
      seats: s.players.map((p, i) => ({ playerId: i === ME ? playerId() : null, color: i === ME ? cfg.color ?? 0 : null, botLevel: p.bot ? cfg.level : null })),
    }));
  }, [cfg]);
  // Al acabar la partida se guarda (una sola vez).
  useEffect(() => { if (state.phase.t === 'over') save(state); }, [state, save]);
  /** El jugador sale a mitad de partida: se guarda como «sin terminar». */
  const abandon = useCallback(() => { if (ref.current.phase.t !== 'over') save(ref.current); }, [save]);
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

  // La acción se aplica fuera del actualizador de React (que en desarrollo se ejecuta dos veces) para anotarla una sola vez.
  const dispatch = useCallback((a: Action) => {
    const prev = ref.current;
    const next = apply(prev, a);
    if (next === prev) return;
    recordAction(rec.current, a, Date.now());
    ref.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const s = state;
    const ph = s.phase;
    if (!enabled || ph.t === 'over' || !ready || paused) return;
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, ms)));
    const now = Date.now();
    const pend = pendingPlayers(s);
    const windowed = ph.t === 'react' || ph.t === 'aplastar' || ph.t === 'gemas';
    if (cfg.tutorial) {
      // Tutorial: sin relojes; las máquinas juegan su plan solo cuando el paso lo permite, y en las ventanas
      // en las que no se espera nada de mí, paso solo.
      if (gate?.autoPass && pend.includes(ME) && (ph.t === 'react' || ph.t === 'gemas'))
        later(gate.slow ? 3200 : 700, () => dispatch(ph.t === 'react' ? { type: 'react', player: ME, r: 'pass' } : { type: 'gemas', player: ME, ids: [] }));
      // «windows»: solo lo que no es jugar un turno (ventanas, elegir en una Codicia…).
      const can = gate?.bots === 'on' || (gate?.bots === 'windows' && ph.t !== 'turn');
      const meToSlap = !gate?.slapFirst && ph.t === 'aplastar' && ph.players.includes(ME) && !ph.slapped.includes(ME);
      if (can && !meToSlap) {
        const key = `${s.seq}:${gate?.slow ? 's' : ''}`;
        if (plan.current.key !== key) plan.current = { key, at: {} };
        pend.filter((p) => s.players[p].bot).forEach((p, i) => {
          let at = plan.current.at[p];
          if (at === undefined) at = plan.current.at[p] = now + (ph.t === 'aplastar' ? (gate?.slow ? 1300 + i * 1000 : 500 + i * 450) : windowed ? (gate?.slow ? 2600 + i * 500 : 900) : 1700);
          later(at - now, () => {
            const a = tutorBot(ref.current, p);
            if (a) dispatch(a);
          });
        });
      }
      return () => timers.forEach(clearTimeout);
    }

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
        const total = DECIDE_MS + (tinieblasJustFell(s) ? TINIEBLAS_PEEK_MS : 0);
        until = now + total;
        setTimer({ key: sk, until, total });
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
  }, [state, timer, ready, paused, cfg.timer, gate?.bots, gate?.autoPass, gate?.slapFirst, gate?.slow]);

  const ph = state.phase;
  const windowed = ph.t === 'react' || ph.t === 'aplastar' || ph.t === 'gemas';
  const activeTimer = timer && (windowed ? 'win' in ph && timer.key === `w${ph.win}` : timer.key === `s${state.seq}` && pendingPlayers(state).includes(ME) && cfg.timer !== false) ? timer : null;
  return { state, dispatch, timer: activeTimer as Timer | null, abandon, recording: rec };
}
