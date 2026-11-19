// Registro de una partida para guardarla en la base de datos: el estado inicial y todas las acciones aplicadas,
// en orden. Como el motor es determinista, con eso se puede reproducir la partida jugada a jugada.

import { Action, GameState } from './engine';

/** Versión del formato del registro (por si cambia el motor y hay que reproducir partidas antiguas). */
export const RECORD_FORMAT = 1;
/** Máximo de acciones que se guardan (una partida normal tiene unas 150-300). */
const MAX_ACTIONS = 5000;

export interface RecAction { t: number; a: Action }

export interface Recording {
  id: string;
  startedAt: number;
  initial: GameState;
  actions: RecAction[];
  saved?: boolean;
}

export interface SeatMeta { playerId?: string | null; color?: number | null; botLevel?: number | null; left?: boolean }

export interface GameRecord {
  id: string;
  mode: 'local' | 'online';
  room: string | null;
  status: 'finished' | 'unfinished';
  format: number;
  startedAt: number;
  endedAt: number;
  options: Record<string, unknown>;
  winnerSeat: number | null;
  winReason: string | null;
  turns: number;
  initial: GameState;
  actions: RecAction[];
  players: {
    seat: number; playerId: string | null; name: string; isBot: boolean; botLevel: number | null; color: number | null;
    won: boolean; finalHand: number; played: number; drawn: number; maxCurses: number; maxHand: number; minHand: number; left: boolean;
  }[];
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function startRecording(id: string, s: GameState, now: number): Recording {
  return { id, startedAt: now, initial: clone({ ...s, fx: [] }), actions: [] };
}

/** Anota una acción ya aplicada con éxito. */
export function recordAction(rec: Recording | null | undefined, a: Action, now: number) {
  if (!rec || rec.actions.length >= MAX_ACTIONS) return;
  rec.actions.push({ t: now - rec.startedAt, a: clone(a) });
}

const winReason = (s: GameState): string | null => {
  if (s.winner === null) return null;
  const t = s.log.map((l) => l.text).join('\n');
  if (t.includes('3 Rituales')) return 'rituales';
  if (t.includes('único que queda')) return 'ultimo_en_pie';
  return 'ultima_carta';
};

export function buildRecord(rec: Recording, s: GameState, o: { mode: 'local' | 'online'; room?: string | null; now: number; options: Record<string, unknown>; seats: SeatMeta[] }): GameRecord {
  const finished = s.phase.t === 'over';
  return {
    id: rec.id,
    mode: o.mode,
    room: o.room ?? null,
    status: finished ? 'finished' : 'unfinished',
    format: RECORD_FORMAT,
    startedAt: rec.startedAt,
    endedAt: o.now,
    options: o.options,
    winnerSeat: s.winner,
    winReason: winReason(s),
    turns: s.stats.turns,
    initial: rec.initial,
    actions: rec.actions,
    players: s.players.map((p, i) => ({
      seat: i,
      playerId: o.seats[i]?.playerId ?? null,
      name: p.name,
      isBot: p.bot,
      botLevel: p.bot ? o.seats[i]?.botLevel ?? null : null,
      color: o.seats[i]?.color ?? null,
      won: s.winner === i,
      finalHand: p.hand.length,
      played: s.stats.played[i] ?? 0,
      drawn: s.stats.drawn[i] ?? 0,
      maxCurses: s.stats.maxCurses[i] ?? 0,
      maxHand: s.stats.maxHand[i] ?? 0,
      minHand: s.stats.minHand[i] ?? 0,
      left: !!o.seats[i]?.left || !!p.out,
    })),
  };
}

/** Reporte de un fallo. */
export interface BugReport {
  playerId: string | null;
  gameId: string | null;
  mode: 'local' | 'online' | null;
  room: string | null;
  description: string;
  userAgent?: string;
  build?: string;
  state?: unknown;
  recentActions?: RecAction[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);
