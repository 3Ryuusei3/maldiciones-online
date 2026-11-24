// Conexión con una sala online. Se reconecta sola y conserva el asiento con un token por pestaña
// (sessionStorage): recargar la página te devuelve a tu sitio; otra pestaña es otro jugador.

import { useSyncExternalStore } from 'react';
import type { Action } from '../game/engine';
import type { ClientMsg, RoomOpts, RoomView, ServerMsg } from '../game/room';
import { authToken } from './auth';

/**
 * Dónde está el servidor. En desarrollo, el mismo sitio (Vite lo redirige al 8787). En producción, el Worker
 * de Cloudflare: la web puede estar alojada en otro sitio (p. ej. Vercel, que no sirve /api ni WebSockets).
 * VITE_API lo cambia.
 */
const SERVER = 'https://maldiciones.ryuusei3.workers.dev';
/** Abierta en local (p. ej. `wrangler dev`), habla con el servidor local aunque sea la versión compilada. */
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const API = ((import.meta.env.VITE_API as string | undefined) ?? (import.meta.env.PROD && !isLocal ? SERVER : '')).replace(/\/$/, '');
export const httpUrl = (path: string) => `${API}${path}`;
const wsUrl = (path: string) => {
  const u = new URL(httpUrl(path), location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
};

function token(): string {
  const KEY = 'maldiciones:token';
  try {
    const t = sessionStorage.getItem(KEY);
    if (t) return t;
  } catch { /* sin almacenamiento: token nuevo en cada carga */ }
  const t = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem(KEY, t); } catch { /* idem */ }
  return t;
}

/**
 * Identificador público de este jugador (invitado): se genera una vez y se guarda en el navegador. Sirve para
 * su histórico de partidas; cuando haya registro, se enlazará con la cuenta.
 */
export function playerId(): string {
  const KEY = 'maldiciones:pid';
  try {
    const t = localStorage.getItem(KEY);
    if (t && /^[0-9a-f-]{36}$/i.test(t)) return t;
  } catch { /* sin almacenamiento */ }
  const id = crypto.randomUUID();
  try { localStorage.setItem(KEY, id); } catch { /* idem */ }
  return id;
}

/** Momento de compilación de esta versión de la web (para los reportes de fallos). */
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

/** Guarda una partida local (sin esperar respuesta; si no hay servidor, se pierde sin más). */
export function saveLocalGame(record: unknown) {
  // Con sesión iniciada, con el token de la cuenta: la partida queda enlazada con ella.
  void authToken().then((t) => fetch(httpUrl('/api/partidas'), {
    method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(record), keepalive: true,
  })).catch(() => {});
}

/** Envía un reporte de fallo de una partida local. */
export async function sendLocalBug(report: unknown): Promise<boolean> {
  try {
    const r = await fetch(httpUrl('/api/fallos'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function createRoom(): Promise<string> {
  const r = await fetch(httpUrl('/api/salas'), { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.code) throw new Error(j.error ?? 'No se ha podido crear la sala.');
  return j.code;
}

export async function roomInfo(code: string): Promise<{ exists: boolean; playing?: boolean; seats?: number; size?: number; free?: boolean }> {
  const r = await fetch(httpUrl(`/api/salas/${encodeURIComponent(code)}`));
  if (!r.ok) return { exists: false };
  return r.json();
}

export interface NetSnap {
  status: 'connecting' | 'open' | 'closed';
  view: RoomView | null;
  /** Date.now() local cuando llegó `view` (para convertir la hora del servidor). */
  recvAt: number;
  error: string | null;
  /** Error definitivo (sala llena, ya empezada, no existe): no se reintenta. */
  fatal: boolean;
}

export class NetClient {
  readonly token = token();
  private ws: WebSocket | null = null;
  private subs = new Set<() => void>();
  private emoteSubs = new Set<(p: number, e: string) => void>();
  /** Emoticonos que llegan de la mesa (asiento y emoticono). Devuelve la función para dejar de escuchar. */
  onEmote(f: (p: number, e: string) => void) { this.emoteSubs.add(f); return () => { this.emoteSubs.delete(f); }; }
  emote(e: string) { this.send({ t: 'emote', e }); }
  private retry = 0;
  private gone = false;
  private ping = 0;
  snap: NetSnap = { status: 'connecting', view: null, recvAt: 0, error: null, fatal: false };

  /** `screen`: pantalla de mesa (modo «en el sofá»): enseña la partida sin manos y no ocupa asiento. */
  constructor(readonly code: string, readonly name: string, readonly screen = false) {
    this.connect();
  }

  private set(p: Partial<NetSnap>) {
    this.snap = { ...this.snap, ...p };
    this.subs.forEach((f) => f());
  }

  private connect() {
    if (this.gone) return;
    const ws = new WebSocket(wsUrl(`/api/salas/${this.code}/ws`));
    this.ws = ws;
    this.set({ status: 'connecting' });
    ws.onopen = () => {
      this.retry = 0;
      this.set({ status: 'open' });
      if (this.screen) {
        ws.send(JSON.stringify({ t: 'screen', token: this.token } satisfies ClientMsg));
      } else
      // Con sesión iniciada se manda el token de la cuenta (la sala lo comprueba) y el color preferido.
      void authToken().then((jwt) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        let color: number | undefined, icon: string | undefined;
        try { const c = localStorage.getItem('maldiciones:color'); if (c !== null) color = Number(c); icon = localStorage.getItem('maldiciones:icono') ?? undefined; } catch { /* nada */ }
        ws.send(JSON.stringify({ t: 'hello', name: this.name, token: this.token, pid: playerId(), jwt, color, icon } satisfies ClientMsg));
      });
      clearInterval(this.ping);
      this.ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25000);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      let m: ServerMsg;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'room') this.set({ view: m, recvAt: Date.now(), error: null });
      else if (m.t === 'emote') this.emoteSubs.forEach((f) => f(m.p, m.e));
      else if (m.t === 'error') this.set({ error: m.msg, fatal: !!m.fatal });
    };
    ws.onclose = (e) => {
      clearInterval(this.ping);
      if (this.ws !== ws) return;
      if (e.code === 4004) this.set({ error: 'La sala no existe.', fatal: true });
      if (this.gone || this.snap.fatal) return this.set({ status: 'closed' });
      this.set({ status: 'connecting' });
      // Reintento con espera creciente (máx. 5 s).
      window.setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.retry++));
    };
  }

  /** Reporta un fallo: la sala añade el estado de la partida y las últimas jugadas. */
  bug(text: string) {
    this.send({ t: 'bug', text, ua: navigator.userAgent, build: BUILD });
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  act(a: Action) { this.send({ t: 'act', a }); }
  opts(o: Partial<RoomOpts>) { this.send({ t: 'opts', opts: o }); }

  /** Salir de la sala (en partida, una máquina juega por ti). */
  leave() {
    this.send({ t: 'leave' });
    this.close();
  }

  close() {
    this.gone = true;
    clearInterval(this.ping);
    this.ws?.close();
  }

  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => { this.subs.delete(f); };
  };
  getSnap = () => this.snap;
}

const EMPTY: NetSnap = { status: 'closed', view: null, recvAt: 0, error: null, fatal: false };
const noop = () => () => {};

export function useNet(c: NetClient | null): NetSnap {
  return useSyncExternalStore(c ? c.subscribe : noop, c ? c.getSnap : () => EMPTY);
}
