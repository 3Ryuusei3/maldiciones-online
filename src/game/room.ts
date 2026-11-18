// Sala online: sala de espera, partida, relojes y máquinas. Es lógica pura (recibe `now` y quién está
// conectado), para que el servidor (Cloudflare Durable Object) solo tenga que guardarla y despertarla.
// Funciona igual que el anfitrión local (useGame), pero aquí también juegan "en piloto automático"
// los humanos que se desconectan o tardan demasiado en su turno.

import { Level, botDecide, botDup } from './bot';
import { Action, GameState, apply, canDup, newGame, pendingPlayers, topCard } from './engine';
import { BOT_WINDOW_MS, WINDOW_MS, botDelay, dupDelay, pickNames } from './timing';
import { viewFor } from './view';

export interface RoomOpts {
  /** Jugadores en total (los huecos se rellenan con máquinas). */
  size: number;
  level: Level;
  extraCurses: boolean;
  condena: boolean;
  beta: boolean;
}

export interface Seat {
  name: string;
  /** Secreto del jugador (para reconectarse). Las máquinas no tienen. */
  token: string | null;
  /** Se ha ido de la partida: juega la máquina por él. */
  left?: boolean;
}

export interface RoomData {
  code: string;
  createdAt: number;
  /** Último momento con alguien conectado (para borrar salas abandonadas). */
  seenAt: number;
  host: string | null;
  opts: RoomOpts;
  /** En la sala de espera: los humanos. En partida: todos los asientos (índice = jugador). */
  seats: Seat[];
  game: GameState | null;
  /** Número de partida jugada en esta sala (para reiniciar la mesa en los clientes). */
  round: number;
  sched: Sched;
}

interface Sched {
  /** Hasta cuándo se espera a que los clientes acaben la animación del reparto. */
  startAt: number;
  ready: string[];
  key: string;
  /** Momento previsto para que juegue cada asiento pendiente (-1 = nunca: es un humano en una ventana). */
  at: Record<number, number>;
  /** Si el asiento tenía a su humano conectado cuando se planificó (si cambia, se replanifica). */
  who: Record<number, boolean>;
  dup: Record<string, number>;
  win: { key: number; until: number; total: number } | null;
}

/** Tiempo que tiene un humano conectado para decidir fuera de las ventanas antes de que juegue la máquina por él. */
export const HUMAN_MS = { turn: 60000, other: 40000 };
/** Espera máxima a la animación del reparto. */
const INTRO_MAX_MS = 15000;
/** Sala sin nadie conectado durante este tiempo: se borra. */
export const ABANDON_MS = 6 * 60 * 60 * 1000;

export const MAX_NAME = 14;
const freshSched = (): Sched => ({ startAt: 0, ready: [], key: '', at: {}, who: {}, dup: {}, win: null });

export function newRoom(code: string, now: number): RoomData {
  return {
    code,
    createdAt: now,
    seenAt: now,
    host: null,
    opts: { size: 4, level: 1, extraCurses: false, condena: true, beta: false },
    seats: [],
    game: null,
    round: 0,
    sched: freshSched(),
  };
}

export const seatOf = (r: RoomData, token: string) => r.seats.findIndex((x) => x.token === token);

// ───────────────────────── mensajes ─────────────────────────

export type ClientMsg =
  | { t: 'hello'; name: string; token: string }
  | { t: 'opts'; opts: Partial<RoomOpts> }
  | { t: 'start' }
  | { t: 'ready' }
  | { t: 'act'; a: Action }
  | { t: 'rematch' }
  | { t: 'lobby' }
  | { t: 'leave' };

export interface SeatInfo { name: string; bot: boolean; online: boolean; host: boolean }

export interface RoomView {
  t: 'room';
  code: string;
  /** Mi asiento (-1 si no estoy sentado). */
  you: number;
  host: boolean;
  opts: RoomOpts;
  seats: SeatInfo[];
  round: number;
  game: GameState | null;
  /** Reloj de la ventana en curso, en la hora del servidor. */
  timer: { key: number; until: number; total: number } | null;
  now: number;
}

export type ServerMsg = RoomView | { t: 'error'; msg: string; fatal?: boolean };

// ───────────────────────── sala de espera ─────────────────────────

export type Result = { ok: true } | { ok: false; msg: string; fatal?: boolean };
const ok: Result = { ok: true };
const fail = (msg: string, fatal = false): Result => ({ ok: false, msg, fatal });

const cleanName = (n: unknown) => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '') || 'Jugador';

/** Un jugador entra (o vuelve) a la sala. */
export function hello(r: RoomData, token: string, name: string): Result {
  if (typeof token !== 'string' || token.length < 16) return fail('Identificador no válido.', true);
  const i = seatOf(r, token);
  if (i >= 0) {
    // Vuelve: recupera su asiento (y deja de jugar la máquina por él).
    r.seats[i].left = false;
    if (!r.game) r.seats[i].name = cleanName(name);
    return ok;
  }
  if (r.game) return fail('La partida ya ha empezado.', true);
  if (r.seats.length >= r.opts.size) return fail('La sala está llena.', true);
  let nm = cleanName(name);
  // Nombres repetidos: se numeran.
  const taken = r.seats.map((x) => x.name.toLowerCase());
  for (let k = 2; taken.includes(nm.toLowerCase()); k++) nm = `${cleanName(name).slice(0, MAX_NAME - 2)} ${k}`;
  r.seats.push({ name: nm, token });
  if (!r.host) r.host = token;
  return ok;
}

export function setOpts(r: RoomData, token: string, o: Partial<RoomOpts>): Result {
  if (token !== r.host) return fail('Solo el anfitrión puede cambiar las opciones.');
  if (r.game) return fail('La partida ya ha empezado.');
  const n = r.opts;
  if (typeof o.size === 'number' && o.size >= 3 && o.size <= 6) n.size = Math.max(o.size, r.seats.length);
  if (o.level === 0 || o.level === 1 || o.level === 2) n.level = o.level;
  if (typeof o.extraCurses === 'boolean') n.extraCurses = o.extraCurses;
  if (typeof o.condena === 'boolean') n.condena = o.condena;
  if (typeof o.beta === 'boolean') n.beta = o.beta;
  return ok;
}

/** Empieza la partida: los huecos libres se rellenan con máquinas. */
export function start(r: RoomData, token: string, now: number): Result {
  if (token !== r.host) return fail('Solo el anfitrión puede empezar.');
  if (r.game && r.game.phase.t !== 'over') return fail('La partida ya ha empezado.');
  const humans = r.seats.filter((x) => x.token && !x.left);
  if (!humans.length) return fail('No hay nadie en la sala.');
  const bots = pickNames(Math.max(0, r.opts.size - humans.length), humans.map((x) => x.name)).map((name): Seat => ({ name, token: null }));
  // Los asientos se sortean para que el anfitrión no sea siempre el primero.
  r.seats = [...humans, ...bots].map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  r.game = newGame({
    players: r.seats.map((x) => ({ name: x.name, bot: !x.token })),
    seed: (Math.random() * 2 ** 31) | 0,
    extraCurses: r.opts.extraCurses,
    condena: r.opts.condena,
    beta: r.opts.beta,
  });
  r.round++;
  r.sched = { ...freshSched(), startAt: now + INTRO_MAX_MS };
  return ok;
}

/** Vuelve a la sala de espera (tras una partida). Las máquinas se van; los humanos que se fueron, también. */
export function toLobby(r: RoomData, token: string): Result {
  if (token !== r.host) return fail('Solo el anfitrión puede hacerlo.');
  if (r.game && r.game.phase.t !== 'over') return fail('La partida sigue en curso.');
  r.game = null;
  r.seats = r.seats.filter((x) => x.token && !x.left);
  r.sched = freshSched();
  return ok;
}

/** El jugador se va: en la sala de espera pierde su asiento; en partida juega la máquina por él. */
export function leave(r: RoomData, token: string): Result {
  const i = seatOf(r, token);
  if (i < 0) return ok;
  if (r.game) r.seats[i].left = true;
  else r.seats.splice(i, 1);
  if (r.host === token) r.host = r.seats.find((x) => x.token && !x.left)?.token ?? null;
  return ok;
}

/** Un cliente ha terminado la animación del reparto. */
export function ready(r: RoomData, token: string, online: Set<string>, now: number) {
  if (!r.game || r.sched.ready.includes(token)) return;
  r.sched.ready.push(token);
  const waiting = r.seats.some((x) => x.token && !x.left && online.has(x.token) && !r.sched.ready.includes(x.token));
  if (!waiting) r.sched.startAt = Math.min(r.sched.startAt, now);
}

// ───────────────────────── partida ─────────────────────────

/** Acción de un humano. El servidor manda: el jugador es siempre el del asiento que la envía. */
export function act(r: RoomData, token: string, a: Action, online: Set<string>, now: number): Result {
  const s = r.game;
  const p = seatOf(r, token);
  if (!s || p < 0) return fail('No estás en la partida.');
  if (!a || typeof a !== 'object' || typeof a.type !== 'string') return fail('Acción no válida.');
  if (a.type === 'timeout') return fail('Acción no válida.');
  if (a.type === 'penalize') {
    if (token !== r.host) return fail('Solo el anfitrión puede señalar faltas.');
  } else (a as { player: number }).player = p;
  let next: GameState;
  try {
    next = apply(s, a);
  } catch {
    return fail('Acción no válida.');
  }
  if (next === s) return fail('Ahora no se puede.');
  r.game = next;
  tick(r, online, now);
  return ok;
}

/** ¿Hay un humano conectado sentado en este asiento? */
const live = (r: RoomData, p: number, online: Set<string>) => {
  const x = r.seats[p];
  return !!x?.token && !x.left && online.has(x.token);
};

function plan(r: RoomData, online: Set<string>, now: number) {
  const s = r.game!;
  const ph = s.phase;
  const sc = r.sched;
  const pend = pendingPlayers(s);
  const windowed = ph.t === 'react' || ph.t === 'aplastar' || ph.t === 'gemas';
  if (windowed && sc.win?.key !== ph.win) {
    const humanIn = pend.some((p) => live(r, p, online));
    const total = humanIn ? WINDOW_MS[ph.t] : Math.min(BOT_WINDOW_MS, WINDOW_MS[ph.t]);
    sc.win = { key: ph.win, until: now + total, total };
  }
  const key = windowed ? `${ph.t}:${ph.win}` : `${s.seq}`;
  if (sc.key !== key) {
    sc.key = key;
    sc.at = {};
    sc.who = {};
  }
  const humans = s.players.map((x) => x.id).filter((p) => live(r, p, online));
  const humanCanDup = humans.some((p) => s.players[p].hand.some((c) => canDup(s, p, c)));
  for (const p of pend) {
    const isLive = live(r, p, online);
    // Un humano que vuelve a conectarse recupera el control: se descarta el plan de la máquina.
    if (sc.at[p] !== undefined && sc.who[p] !== isLive) delete sc.at[p];
    if (sc.at[p] !== undefined) continue;
    sc.who[p] = isLive;
    if (!isLive) sc.at[p] = now + botDelay(s, r.opts.level, humanCanDup);
    else if (windowed) sc.at[p] = -1; // en las ventanas manda el reloj de la ventana
    else sc.at[p] = now + (ph.t === 'turn' ? HUMAN_MS.turn : HUMAN_MS.other);
  }
  // Máquinas (y ausentes) que quieren duplicar la carta superior.
  const top = topCard(s).id;
  for (const pl of s.players) {
    if (live(r, pl.id, online)) continue;
    const k = `${top}:${pl.id}`;
    if (sc.dup[k] === undefined) sc.dup[k] = botDup(s, pl.id, r.opts.level) ? now + dupDelay() : 0;
  }
  // Las de cartas que ya no están arriba no sirven.
  for (const k of Object.keys(sc.dup)) if (!k.startsWith(`${top}:`)) delete sc.dup[k];
}

/**
 * Ejecuta todo lo que ya toca (relojes vencidos, máquinas). Devuelve si ha cambiado algo.
 * Sin nadie conectado la partida se queda quieta hasta que alguien vuelva.
 */
export function tick(r: RoomData, online: Set<string>, now: number): boolean {
  let changed = false;
  for (let guard = 0; guard < 200; guard++) {
    const s = r.game;
    if (!s || s.phase.t === 'over' || now < r.sched.startAt) break;
    if (!r.seats.some((x) => x.token && !x.left && online.has(x.token))) break;
    plan(r, online, now);
    const ph = s.phase;
    const sc = r.sched;
    let a: Action | null = null;
    const windowed = ph.t === 'react' || ph.t === 'aplastar' || ph.t === 'gemas';
    if (windowed && sc.win && sc.win.key === ph.win && sc.win.until <= now) a = { type: 'timeout' };
    if (!a)
      for (const p of pendingPlayers(s)) {
        const at = sc.at[p];
        if (at === undefined || at < 0 || at > now) continue;
        sc.at[p] = -1;
        a = botDecide(s, p, live(r, p, online) ? 1 : r.opts.level);
        if (a) break;
      }
    if (!a)
      for (const [k, at] of Object.entries(sc.dup)) {
        if (at <= 0 || at > now) continue;
        sc.dup[k] = 0;
        const p = Number(k.split(':')[1]);
        const c = s.players[p].hand.find((x) => canDup(s, p, x));
        if (c && topCard(s).id === k.split(':')[0]) {
          a = { type: 'dup', player: p, cardId: c.id };
          break;
        }
      }
    if (!a) break;
    const next = apply(s, a);
    if (next !== s) {
      r.game = next;
      changed = true;
    }
  }
  return changed;
}

/** Próximo momento en que hay que despertar la sala (o null si no hay nada pendiente). */
export function nextWake(r: RoomData, online: Set<string>, now: number): number | null {
  const s = r.game;
  if (!s || s.phase.t === 'over') return null;
  if (!r.seats.some((x) => x.token && !x.left && online.has(x.token))) return null;
  if (now < r.sched.startAt) return r.sched.startAt;
  plan(r, online, now);
  const sc = r.sched;
  const times = [
    ...(sc.win && 'win' in s.phase && sc.win.key === s.phase.win ? [sc.win.until] : []),
    ...pendingPlayers(s).map((p) => sc.at[p]).filter((x) => x !== undefined && x >= 0),
    ...Object.values(sc.dup).filter((x) => x > 0),
  ];
  return times.length ? Math.max(now + 1, Math.min(...times)) : null;
}

// ───────────────────────── lo que se envía ─────────────────────────

export function roomView(r: RoomData, token: string | null, online: Set<string>, now: number): RoomView {
  const you = token ? seatOf(r, token) : -1;
  const s = r.game;
  const ph = s?.phase;
  const timer = r.sched.win && ph && 'win' in ph && ph.win === r.sched.win.key && (ph.t === 'react' || ph.t === 'aplastar' || ph.t === 'gemas') ? r.sched.win : null;
  return {
    t: 'room',
    code: r.code,
    you,
    host: !!token && token === r.host,
    opts: r.opts,
    seats: r.seats.map((x) => ({ name: x.name, bot: !x.token || !!x.left, online: !!x.token && !x.left && online.has(x.token), host: !!x.token && x.token === r.host })),
    round: r.round,
    game: s ? viewFor(s, you < 0 ? -1 : you) : null,
    timer,
    now,
  };
}
