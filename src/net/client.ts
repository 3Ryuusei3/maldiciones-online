// Conexión con una sala online. Se reconecta sola y conserva el asiento con un token por pestaña
// (sessionStorage): recargar la página te devuelve a tu sitio; otra pestaña es otro jugador.

import { useSyncExternalStore } from 'react';
import type { Action } from '../game/engine';
import type { ClientMsg, RoomOpts, RoomView, ServerMsg } from '../game/room';

/** Dónde está el servidor. Vacío = el mismo sitio que la web (en desarrollo, Vite lo redirige al 8787). */
const API = (import.meta.env.VITE_API as string | undefined)?.replace(/\/$/, '') ?? '';
const httpUrl = (path: string) => `${API}${path}`;
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
  private retry = 0;
  private gone = false;
  private ping = 0;
  snap: NetSnap = { status: 'connecting', view: null, recvAt: 0, error: null, fatal: false };

  constructor(readonly code: string, readonly name: string) {
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
      ws.send(JSON.stringify({ t: 'hello', name: this.name, token: this.token } satisfies ClientMsg));
      clearInterval(this.ping);
      this.ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25000);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      let m: ServerMsg;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'room') this.set({ view: m, recvAt: Date.now(), error: null });
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
