// Acceso a la base de datos (Neon / Lakebase Postgres) desde el Worker y las salas, con el driver HTTP
// (una petición por consulta o transacción; no hace falta mantener conexiones abiertas).

import { neon } from '@neondatabase/serverless';
import { BugReport, GameRecord, isUuid } from '../../src/game/record';

const s = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : null);
const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);
const ts = (ms: number) => new Date(ms).toISOString();

/** Comprueba lo básico de un registro que llega del navegador (las partidas locales). */
export function validRecord(r: unknown): r is GameRecord {
  const g = r as GameRecord;
  return !!g && isUuid(g.id) && (g.mode === 'local' || g.mode === 'online') && (g.status === 'finished' || g.status === 'unfinished')
    && Array.isArray(g.players) && g.players.length >= 2 && g.players.length <= 8 && Array.isArray(g.actions) && !!g.initial
    && typeof g.startedAt === 'number' && typeof g.endedAt === 'number';
}

/** Guarda una partida (si ya existía, no hace nada: se puede reintentar sin duplicarla). */
export async function saveGame(url: string, g: GameRecord): Promise<void> {
  const sql = neon(url);
  const humans = g.players.filter((p) => !p.isBot && isUuid(p.playerId));
  await sql.transaction([
    ...humans.map((p) => sql`insert into players (id, name) values (${p.playerId}, ${s(p.name, 40) ?? 'Jugador'})
      on conflict (id) do update set name = excluded.name, last_seen = now()`),
    sql`insert into games (id, mode, room, status, format, started_at, ended_at, duration_ms, player_count, options, winner_seat, win_reason, turns, initial, actions)
      values (${g.id}, ${g.mode}, ${s(g.room, 8)}, ${g.status}, ${n(g.format)}, ${ts(g.startedAt)}, ${ts(g.endedAt)}, ${Math.max(0, n(g.endedAt - g.startedAt))},
        ${g.players.length}, ${JSON.stringify(g.options ?? {})}, ${g.winnerSeat ?? null}, ${s(g.winReason, 40)}, ${n(g.turns)},
        ${JSON.stringify(g.initial)}, ${JSON.stringify(g.actions)})
      on conflict (id) do nothing`,
    ...g.players.map((p) => sql`insert into game_players (game_id, seat, player_id, user_id, name, is_bot, bot_level, color, won, final_hand, played, drawn, max_curses, max_hand, min_hand, left_game)
      values (${g.id}, ${n(p.seat)}, ${!p.isBot && isUuid(p.playerId) ? p.playerId : null}, ${!p.isBot ? s(p.userId, 80) : null}, ${s(p.name, 40) ?? '?'}, ${!!p.isBot}, ${p.botLevel ?? null}, ${p.color ?? null},
        ${!!p.won}, ${n(p.finalHand)}, ${n(p.played)}, ${n(p.drawn)}, ${n(p.maxCurses)}, ${n(p.maxHand)}, ${n(p.minHand)}, ${!!p.left})
      on conflict (game_id, seat) do nothing`),
  ]);
}

export async function saveBug(url: string, b: BugReport): Promise<string> {
  const sql = neon(url);
  const rows = await sql`insert into bug_reports (player_id, game_id, mode, room, description, user_agent, build, state, recent_actions)
    values (${isUuid(b.playerId) ? b.playerId : null}, ${isUuid(b.gameId) ? b.gameId : null}, ${s(b.mode, 10)}, ${s(b.room, 8)},
      ${s(b.description, 4000) ?? ''}, ${s(b.userAgent, 400)}, ${s(b.build, 40)},
      ${b.state ? JSON.stringify(b.state) : null}, ${b.recentActions ? JSON.stringify(b.recentActions.slice(-60)) : null})
    returning id`;
  return (rows[0] as { id: string }).id;
}

// ───────────────────────── perfiles de cuenta ─────────────────────────

export interface Profile { nickname: string; color: number; icon: string }

export const NICK_RE = /^[\p{L}\p{N}_ .-]{3,14}$/u;
export const cleanNick = (x: unknown) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');

export async function getProfile(url: string, userId: string): Promise<Profile | null> {
  const rows = await neon(url)`select nickname, color, icon from profiles where user_id = ${userId}`;
  return (rows[0] as Profile | undefined) ?? null;
}

export async function nickFree(url: string, nick: string, userId?: string | null): Promise<boolean> {
  const rows = await neon(url)`select user_id from profiles where lower(nickname) = lower(${nick})`;
  return !rows.length || (rows[0] as { user_id: string }).user_id === userId;
}

/** Crea o actualiza el perfil. Devuelve 'taken' si el nickname ya es de otra cuenta. */
export async function saveProfile(url: string, userId: string, p: Profile, guestId?: string | null): Promise<'ok' | 'taken'> {
  const sql = neon(url);
  try {
    await sql`insert into profiles (user_id, nickname, color, icon, guest_id) values (${userId}, ${p.nickname}, ${p.color}, ${p.icon}, ${isUuid(guestId) ? guestId : null})
      on conflict (user_id) do update set nickname = excluded.nickname, color = excluded.color, icon = excluded.icon, updated_at = now()`;
    return 'ok';
  } catch (e) {
    if (String((e as { code?: string }).code) === '23505') return 'taken';
    throw e;
  }
}
