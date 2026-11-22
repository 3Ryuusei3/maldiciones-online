// Servidor online de Maldiciones: un Worker que sirve la web y una sala (Durable Object) por partida.
// La sala ejecuta el motor, lleva los relojes y mueve a las máquinas; cada jugador recibe solo su vista.
// Usa la API de WebSockets con hibernación: mientras nadie juega, la sala no consume tiempo.
//
//   POST /api/salas            -> crea una sala y devuelve { code }
//   GET  /api/salas/:code      -> { exists, playing, seats, size } (para comprobar un código)
//   GET  /api/salas/:code/ws   -> WebSocket de la sala
//   POST /api/partidas         -> guarda una partida local (las online las guarda la propia sala al acabar)
//   POST /api/fallos           -> guarda un reporte de fallo de una partida local

import { DurableObject } from 'cloudflare:workers';
import {
  ABANDON_MS, ClientMsg, Result, RoomData, ServerMsg,
  act, decideDrop, hello, setColor, leave, newRoom, nextWake, ready, roomBug, roomRecord, roomView, setOpts, start, tick, toLobby,
} from '../../src/game/room';
import { BugReport } from '../../src/game/record';
import { NICK_RE, cleanNick, getProfile, nickFree, saveBug, saveGame, saveProfile, validRecord } from './db';
import { bearer, verifyUser } from './auth';

import { isIcon } from '../../src/game/icons';
import { isEmote } from '../../src/game/emotes';

interface Env {
  SALAS: DurableObjectNamespace<Sala>;
  ASSETS: Fetcher;
  /** Conexión a Neon (secreto: `wrangler secret put DATABASE_URL`; en local, en server/.dev.vars). */
  DATABASE_URL?: string;
  /** Claves públicas de Neon Auth para comprobar los tokens de las cuentas (variable en wrangler.jsonc). */
  NEON_AUTH_JWKS_URL?: string;
}

/**
 * Neon Auth a través de nuestro propio dominio (/api/auth/*). Así la cookie de la sesión es «de este sitio» y
 * no de un dominio ajeno: el navegador no la bloquea (Safari, la app instalada en el móvil…) y la sesión se
 * mantiene al volver a entrar.
 */
async function proxyAuth(req: Request, url: URL, env: Env): Promise<Response> {
  const base = (env.NEON_AUTH_JWKS_URL ?? '').replace(/\/\.well-known\/jwks\.json$/, '');
  if (!base) return json({ error: 'Sin Neon Auth.' }, 503);
  const target = base + url.pathname.slice('/api/auth'.length) + url.search;
  const headers = new Headers(req.headers);
  headers.delete('host');
  const res = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
  });
  const out = new Headers(res.headers);
  out.delete('set-cookie');
  for (const c of (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie()) {
    // La cookie pasa a ser de este dominio y de la ruta del proxy.
    const parts = c.split(';').map((x: string) => x.trim()).filter((x: string) => !/^(domain|path|samesite)=/i.test(x));
    out.append('set-cookie', [...parts, 'Path=/api/auth', 'SameSite=Lax'].join('; '));
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

/** Cuerpo JSON de una petición, con un tamaño máximo. */
async function body(req: Request, max: number): Promise<unknown> {
  const t = await req.text();
  if (t.length > max) throw new Error('too big');
  return JSON.parse(t);
}

interface Att { token: string | null }

/** Letras sin ambigüedad (ni I/1 ni O/0). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_RE = /^[A-Z]{4}$/;
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHABET[b % ALPHABET.length]).join('');

/** La web puede estar en otro dominio (Vercel): la API admite peticiones de cualquier origen (no hay cookies ni datos privados). */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'access-control-allow-headers': 'content-type, authorization' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (url.pathname.startsWith('/api/auth/')) return proxyAuth(req, url, env);
    // Traspaso del inicio de sesión con Google (app instalada en iPhone): Safari deja el código y la app lo recoge.
    const ho = url.pathname.match(/^\/api\/handoff\/([a-f0-9]{32})$/);
    if (ho && req.method === 'POST') {
      let b: { v?: unknown };
      try { b = (await body(req, 4000)) as { v?: unknown }; } catch { return json({ error: 'No válido.' }, 400); }
      if (typeof b?.v !== 'string' || !b.v || b.v.length > 2000) return json({ error: 'No válido.' }, 400);
      await env.SALAS.getByName(`handoff:${ho[1]}`).handoffPut(b.v);
      return json({ ok: true });
    }
    if (ho && req.method === 'GET') return json({ v: await env.SALAS.getByName(`handoff:${ho[1]}`).handoffTake() });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });

    if (url.pathname === '/api/salas' && req.method === 'POST') {
      for (let i = 0; i < 8; i++) {
        const code = newCode();
        if (await env.SALAS.getByName(code).init(code)) return json({ code });
      }
      return json({ error: 'No se ha podido crear la sala.' }, 503);
    }

    if (url.pathname === '/api/partidas' && req.method === 'POST') {
      if (!env.DATABASE_URL) return json({ error: 'Sin base de datos.' }, 503);
      let g: unknown;
      try { g = await body(req, 3_000_000); } catch { return json({ error: 'Partida no válida.' }, 400); }
      if (!validRecord(g) || g.mode !== 'local') return json({ error: 'Partida no válida.' }, 400);
      // Con sesión iniciada, la partida queda enlazada con la cuenta (el asiento del jugador es el 0 en local).
      const uid = await verifyUser(bearer(req), env.NEON_AUTH_JWKS_URL);
      g.players = g.players.map((p) => ({ ...p, userId: p.seat === 0 && uid ? uid : null }));
      await saveGame(env.DATABASE_URL, g);
      return json({ ok: true });
    }
    if (url.pathname === '/api/fallos' && req.method === 'POST') {
      if (!env.DATABASE_URL) return json({ error: 'Sin base de datos.' }, 503);
      let b: BugReport;
      try { b = (await body(req, 2_000_000)) as BugReport; } catch { return json({ error: 'Reporte no válido.' }, 400); }
      if (!b || typeof b.description !== 'string' || !b.description.trim()) return json({ error: 'Cuenta qué ha pasado.' }, 400);
      return json({ ok: true, id: await saveBug(env.DATABASE_URL, { ...b, mode: 'local' }) });
    }

    // Perfil de la cuenta (nickname único, color e icono).
    if (url.pathname === '/api/nick' && req.method === 'GET') {
      if (!env.DATABASE_URL) return json({ error: 'Sin base de datos.' }, 503);
      const nick = cleanNick(url.searchParams.get('n'));
      if (!NICK_RE.test(nick)) return json({ free: false, valid: false });
      return json({ free: await nickFree(env.DATABASE_URL, nick, await verifyUser(bearer(req), env.NEON_AUTH_JWKS_URL)), valid: true });
    }
    if (url.pathname === '/api/perfil') {
      if (!env.DATABASE_URL) return json({ error: 'Sin base de datos.' }, 503);
      const uid = await verifyUser(bearer(req), env.NEON_AUTH_JWKS_URL);
      if (!uid) return json({ error: 'Inicia sesión.' }, 401);
      if (req.method === 'GET') return json({ profile: await getProfile(env.DATABASE_URL, uid) });
      if (req.method === 'PUT') {
        let b: { nickname?: unknown; color?: unknown; icon?: unknown; guestId?: unknown };
        try { b = (await body(req, 4000)) as typeof b; } catch { return json({ error: 'Datos no válidos.' }, 400); }
        const nickname = cleanNick(b.nickname);
        if (!NICK_RE.test(nickname)) return json({ error: 'El nickname debe tener de 3 a 14 letras, números, espacios o _ . -' }, 400);
        const color = Number(b.color);
        if (!Number.isInteger(color) || color < 0 || color > 11) return json({ error: 'Color no válido.' }, 400);
        const icon = isIcon(b.icon) ? b.icon : 'maldicion';
        const r = await saveProfile(env.DATABASE_URL, uid, { nickname, color, icon }, typeof b.guestId === 'string' ? b.guestId : null);
        if (r === 'taken') return json({ error: 'Ese nickname ya lo tiene otro jugador.' }, 409);
        return json({ profile: { nickname, color, icon } });
      }
    }

    const m = url.pathname.match(/^\/api\/salas\/([A-Za-z]{4})(\/ws)?$/);
    if (!m) return json({ error: 'No encontrado.' }, 404);
    const code = m[1].toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: 'Código no válido.' }, 400);
    const stub = env.SALAS.getByName(code);
    if (m[2]) {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'Se esperaba un WebSocket.' }, 426);
      return stub.fetch(req);
    }
    return json(await stub.info());
  },
} satisfies ExportedHandler<Env>;

export class Sala extends DurableObject<Env> {
  /** Copia en memoria (se pierde al hibernar y se vuelve a leer del almacenamiento). */
  private room: RoomData | null | undefined;
  /** Último emoticono de cada jugador (para no saturar la mesa). */
  private emoted = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Los "ping" de los clientes se contestan sin despertar la sala.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private async load(): Promise<RoomData | null> {
    if (this.room === undefined) this.room = (await this.ctx.storage.get<RoomData>('room')) ?? null;
    return this.room;
  }

  /** Tokens de los jugadores conectados ahora mismo. */
  private online(except?: WebSocket): Set<string> {
    const out = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const t = (ws.deserializeAttachment() as Att | null)?.token;
      if (t) out.add(t);
    }
    return out;
  }

  // ── Entrar con Google desde la app instalada en iPhone: Google se abre en Safari (otra «caja» de cookies) y
  //    desde ahí se le pasa a la app el código de un solo uso para terminar de entrar. Se guarda aquí un momento.
  async handoffPut(v: string) {
    await this.ctx.storage.put('handoff', { v, at: Date.now() });
  }
  async handoffTake(): Promise<string | null> {
    const h = await this.ctx.storage.get<{ v: string; at: number }>('handoff');
    if (!h) return null;
    await this.ctx.storage.deleteAll();
    return Date.now() - h.at < 10 * 60 * 1000 ? h.v : null;
  }

  async init(code: string): Promise<boolean> {
    if (await this.load()) return false;
    this.room = newRoom(code, Date.now());
    await this.commit(this.room, new Set(), Date.now());
    return true;
  }

  async info() {
    const r = await this.load();
    if (!r) return { exists: false };
    const humans = r.seats.filter((x) => x.token && !x.left).length;
    // Sitio libre: en la sala de espera, un hueco; en partida, una máquina o alguien que se fue.
    const free = r.game ? humans < r.seats.length : r.seats.length < r.opts.size;
    return { exists: true, playing: !!r.game && r.game.phase.t !== 'over', seats: humans, size: r.opts.size, free };
  }

  async fetch(req: Request): Promise<Response> {
    if (!(await this.load())) return json({ error: 'La sala no existe.' }, 404);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ token: null } satisfies Att);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || data.length > 20000) return;
    let m: ClientMsg;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    const r = await this.load();
    if (!r) return ws.close(4004, 'La sala no existe.');
    const now = Date.now();
    let token = (ws.deserializeAttachment() as Att | null)?.token ?? null;
    let res: Result;
    if (m.t === 'hello') {
      // Con sesión iniciada, el asiento queda enlazado con la cuenta (comprobando su token).
      const uid = await verifyUser(m.jwt, this.env.NEON_AUTH_JWKS_URL);
      res = hello(r, m.token, m.name, this.online(ws), m.pid, uid, m.color, m.icon);
      if (res.ok) {
        token = m.token;
        ws.serializeAttachment({ token } satisfies Att);
      }
    } else if (!token) {
      res = { ok: false, msg: 'Primero hay que entrar en la sala.' };
    } else {
      const online = this.online();
      switch (m.t) {
        case 'opts': res = setOpts(r, token, m.opts ?? {}, online); break;
        case 'start': case 'rematch': res = start(r, token, now, online); break;
        case 'drop': res = decideDrop(r, token, Number(m.p), m.how, online, now); break;
        case 'color': res = setColor(r, token, Number(m.c)); break;
        case 'lobby': res = toLobby(r, token); break;
        case 'ready': ready(r, token, online, now); res = { ok: true }; break;
        case 'act': res = act(r, token, m.a, online, now); break;
        case 'emote': {
          // Emoticono: se reenvía a todos (no cambia la partida). Como mucho uno cada segundo por jugador.
          const p = r.seats.findIndex((x) => x.token === token);
          const last = this.emoted.get(token) ?? 0;
          if (p < 0 || !isEmote(m.e) || now - last < 1000) return;
          this.emoted.set(token, now);
          const msg = JSON.stringify({ t: 'emote', p, e: m.e } satisfies ServerMsg);
          for (const w of this.ctx.getWebSockets()) { try { w.send(msg); } catch { /* cerrado */ } }
          return;
        }
        case 'bug': {
          const b = roomBug(r, token, m.text, m.ua, m.build);
          if (b && this.env.DATABASE_URL) this.ctx.waitUntil(saveBug(this.env.DATABASE_URL, b).then(() => {}, () => {}));
          return;
        }
        case 'leave':
          res = leave(r, token);
          ws.serializeAttachment({ token: null } satisfies Att);
          ws.close(1000, 'Has salido de la sala.');
          break;
        default: return;
      }
    }
    if (!res.ok) {
      this.send(ws, { t: 'error', msg: res.msg, fatal: res.fatal });
      if (res.fatal) ws.close(4000, res.msg);
      // Un intento fallido no cambia nada para los demás.
      if (m.t !== 'hello') return;
    }
    const online = this.online();
    tick(r, online, now);
    await this.commit(r, online, now);
    this.broadcast(r, online, now);
  }

  async webSocketClose(ws: WebSocket) {
    await this.disconnected(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.disconnected(ws);
  }

  private async disconnected(ws: WebSocket) {
    const r = await this.load();
    if (!r) return;
    const now = Date.now();
    const online = this.online(ws);
    // Si era un humano en mitad de la partida, ahora juega la máquina por él.
    tick(r, online, now);
    await this.commit(r, online, now);
    this.broadcast(r, online, now, ws);
  }

  async alarm() {
    const r = await this.load();
    if (!r) return;
    const now = Date.now();
    const online = this.online();
    if (!online.size && now - r.seenAt >= ABANDON_MS) {
      // Sala abandonada: si había una partida a medias, se guarda como sin terminar; después se borra entera.
      const g = r.rec && !r.rec.saved ? roomRecord(r, now) : null;
      if (g && this.env.DATABASE_URL) await saveGame(this.env.DATABASE_URL, g).catch(() => {});
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    const changed = tick(r, online, now);
    await this.commit(r, online, now);
    if (changed) this.broadcast(r, online, now);
  }

  /** Guarda la sala y programa el siguiente despertar (relojes, máquinas o limpieza). */
  private async commit(r: RoomData, online: Set<string>, now: number) {
    if (online.size) r.seenAt = now;
    // Partida terminada: la sala la guarda una sola vez (es quien tiene la partida completa; nadie puede falsearla).
    if (r.game?.phase.t === 'over' && r.rec && !r.rec.saved) {
      const g = roomRecord(r, now);
      r.rec.saved = true;
      if (g && this.env.DATABASE_URL) {
        const url = this.env.DATABASE_URL;
        this.ctx.waitUntil(saveGame(url, g).catch(() => { /* sin base de datos: la partida no se guarda */ }));
      }
    }
    await this.ctx.storage.put('room', r);
    const wake = nextWake(r, online, now);
    if (wake !== null) await this.ctx.storage.setAlarm(wake);
    else if (!online.size) await this.ctx.storage.setAlarm(r.seenAt + ABANDON_MS);
    else await this.ctx.storage.deleteAlarm();
  }

  private broadcast(r: RoomData, online: Set<string>, now: number, except?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const token = (ws.deserializeAttachment() as Att | null)?.token;
      if (token) this.send(ws, roomView(r, token, online, now));
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* el socket ya se ha cerrado */
    }
  }
}
