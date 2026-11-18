// Servidor online de Maldiciones: un Worker que sirve la web y una sala (Durable Object) por partida.
// La sala ejecuta el motor, lleva los relojes y mueve a las máquinas; cada jugador recibe solo su vista.
// Usa la API de WebSockets con hibernación: mientras nadie juega, la sala no consume tiempo.
//
//   POST /api/salas            -> crea una sala y devuelve { code }
//   GET  /api/salas/:code      -> { exists, playing, seats, size } (para comprobar un código)
//   GET  /api/salas/:code/ws   -> WebSocket de la sala

import { DurableObject } from 'cloudflare:workers';
import {
  ABANDON_MS, ClientMsg, Result, RoomData, ServerMsg,
  act, hello, leave, newRoom, nextWake, ready, roomView, setOpts, start, tick, toLobby,
} from '../../src/game/room';

interface Env {
  SALAS: DurableObjectNamespace<Sala>;
  ASSETS: Fetcher;
}

interface Att { token: string | null }

/** Letras sin ambigüedad (ni I/1 ni O/0). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_RE = /^[A-Z]{4}$/;
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHABET[b % ALPHABET.length]).join('');

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);

    if (url.pathname === '/api/salas' && req.method === 'POST') {
      for (let i = 0; i < 8; i++) {
        const code = newCode();
        if (await env.SALAS.getByName(code).init(code)) return json({ code });
      }
      return json({ error: 'No se ha podido crear la sala.' }, 503);
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
      res = hello(r, m.token, m.name);
      if (res.ok) {
        token = m.token;
        ws.serializeAttachment({ token } satisfies Att);
      }
    } else if (!token) {
      res = { ok: false, msg: 'Primero hay que entrar en la sala.' };
    } else {
      const online = this.online();
      switch (m.t) {
        case 'opts': res = setOpts(r, token, m.opts ?? {}); break;
        case 'start': case 'rematch': res = start(r, token, now); break;
        case 'lobby': res = toLobby(r, token); break;
        case 'ready': ready(r, token, online, now); res = { ok: true }; break;
        case 'act': res = act(r, token, m.a, online, now); break;
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
      // Sala abandonada: se borra entera.
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
