// Cuentas de jugador con Neon Auth (correo y contraseña, o Google), o jugar como invitado.
// La sesión la lleva Neon Auth; el perfil del juego (nickname único, color e icono) lo guarda nuestro servidor.

import { useSyncExternalStore } from 'react';
import { createAuthClient } from '@neon/auth';
import { httpUrl, playerId } from './client';

/** Dirección de Neon Auth de la rama de producción (es pública). VITE_NEON_AUTH_URL la cambia. */
const NEON_AUTH_URL = 'https://ep-sweet-bread-babz5160.neonauth.c-8.eu-central-1.aws.neon.tech/neondb/auth';
/**
 * Si la web y el servidor están en el mismo sitio, Neon Auth va a través de él (/api/auth): la cookie de la sesión
 * es de este dominio y no se pierde (Safari y la app instalada bloquean las cookies de otros dominios).
 */
// (Misma regla que en client.ts para saber dónde está el servidor; aquí sin importarlo para no depender del orden de carga.)
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const apiBase = ((import.meta.env.VITE_API as string | undefined) ?? (import.meta.env.PROD && !isLocal ? 'https://maldiciones.ryuusei3.workers.dev' : '')).replace(/\/$/, '');
const viaServer = new URL(`${apiBase}/api/auth`, location.href);
const AUTH_URL = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined) ?? (viaServer.origin === location.origin ? viaServer.href : NEON_AUTH_URL);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const auth = createAuthClient(AUTH_URL) as any;

export interface Profile { nickname: string; color: number; icon: string }
export interface Account {
  /** `loading`: comprobando la sesión. `out`: sin sesión ni invitado (pantalla de entrada). */
  status: 'loading' | 'out' | 'guest' | 'in' | 'handoff';
  email?: string;
  /** Nombre que da Google (para proponerlo como nickname). */
  suggested?: string;
  /** null: tiene sesión pero aún no ha creado su perfil (nickname). */
  profile?: Profile | null;
  /** Invitado: su nombre, color e icono (guardados en este navegador); null si aún no los ha elegido. */
  guest?: Profile | null;
}

/** Perfil con el que se juega: el de la cuenta o el de invitado. */
export const myProfile = (a: Account): Profile | null => (a.status === 'in' ? a.profile ?? null : a.status === 'guest' ? a.guest ?? null : null);

/** Perfil de invitado guardado en el navegador (hace falta nombre e icono). */
function storedGuest(): Profile | null {
  try {
    const nickname = localStorage.getItem('maldiciones:nombre')?.trim();
    const icon = localStorage.getItem('maldiciones:icono');
    const color = Number(localStorage.getItem('maldiciones:color'));
    if (!nickname || !icon) return null;
    return { nickname, icon, color: color >= 0 && color < 12 ? color : 0 };
  } catch {
    return null;
  }
}

/** Guarda el perfil de invitado (nombre, color e icono) en el navegador. */
export function saveGuest(p: Profile) {
  try {
    localStorage.setItem('maldiciones:nombre', p.nickname);
    localStorage.setItem('maldiciones:color', String(p.color));
    localStorage.setItem('maldiciones:icono', p.icon);
  } catch { /* sin almacenamiento: solo para esta visita */ }
  set({ ...state, guest: p });
}

const GUEST_KEY = 'maldiciones:modo';
let state: Account = { status: 'loading' };
const subs = new Set<() => void>();
const set = (s: Account) => { state = s; subs.forEach((f) => f()); };

export const useAccount = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
export const account = () => state;

let jwt: { token: string; at: number } | null = null;
/** Token de la sesión (para nuestro servidor). Se renueva antes de que caduque (duran 15 min). */
export async function authToken(): Promise<string | null> {
  if (state.status !== 'in') return null;
  if (jwt && Date.now() - jwt.at < 10 * 60 * 1000) return jwt.token;
  let t: string | undefined;
  try {
    const r = await auth.token();
    t = r?.data?.token as string | undefined;
  } catch { /* se prueba directamente */ }
  // Respaldo: pedírselo directamente a Neon Auth con la cookie de la sesión (tras recargar la página, el cliente
  // aún no lo tiene en memoria).
  if (!t) {
    try {
      const r = await fetch(`${AUTH_URL}/token`, { credentials: 'include' });
      t = r.ok ? ((await r.json()) as { token?: string }).token : undefined;
    } catch { /* sin conexión */ }
  }
  jwt = t ? { token: t, at: Date.now() } : null;
  return t ?? null;
}

async function api(path: string, init: RequestInit = {}) {
  const t = await authToken();
  const r = await fetch(httpUrl(path), { ...init, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j };
}

const errText = (e: unknown, fallback: string) => {
  const m = (e as { message?: string; code?: string })?.message ?? '';
  const code = (e as { code?: string })?.code ?? '';
  if (/INVALID_EMAIL_OR_PASSWORD|invalid email or password/i.test(code + m)) return 'Correo o contraseña incorrectos.';
  if (/USER_ALREADY_EXISTS|already exists/i.test(code + m)) return 'Ya hay una cuenta con ese correo. Inicia sesión.';
  if (/PASSWORD_TOO_SHORT|too short/i.test(code + m)) return 'La contraseña es demasiado corta (mínimo 8 caracteres).';
  if (/INVALID_EMAIL|invalid email/i.test(code + m)) return 'Ese correo no es válido.';
  return m || fallback;
};

/** Comprueba la sesión al cargar la página (también al volver de iniciar sesión con Google). */
export async function initAccount() {
  if (await handoffFromSafari()) return;
  try {
    const r = await auth.getSession();
    const user = r?.data?.user;
    if (user) {
      set({ status: 'in', email: user.email, suggested: user.name, profile: undefined });
      const p = await api('/api/perfil');
      set({ status: 'in', email: user.email, suggested: user.name, profile: p.ok ? (p.data.profile as Profile | null) : null });
      return;
    }
  } catch { /* sin conexión con Neon Auth: se sigue como invitado o sin sesión */ }
  let guest = false;
  try { guest = localStorage.getItem(GUEST_KEY) === 'invitado'; } catch { /* nada */ }
  set(guest ? { status: 'guest', guest: storedGuest() } : { status: 'out' });
}

export function playAsGuest() {
  try { localStorage.setItem(GUEST_KEY, 'invitado'); } catch { /* nada */ }
  set({ status: 'guest', guest: storedGuest() });
}

/** Vuelve a la pantalla de entrada (para que un invitado inicie sesión o cree su cuenta). */
export function toEntry() {
  try { localStorage.removeItem(GUEST_KEY); } catch { /* nada */ }
  set({ status: 'out' });
}

export async function nickAvailable(nick: string): Promise<{ free: boolean; valid: boolean }> {
  const r = await api(`/api/nick?n=${encodeURIComponent(nick)}`);
  return { free: !!r.data.free, valid: !!r.data.valid };
}

/** Crear cuenta: el nickname se comprueba antes (único) y se guarda en el perfil nada más crearla. */
export async function signUp(email: string, password: string, nickname: string, color: number, icon: string): Promise<string | null> {
  const n = await nickAvailable(nickname);
  if (!n.valid) return 'El nickname debe tener de 3 a 14 letras, números, espacios o _ . -';
  if (!n.free) return 'Ese nickname ya lo tiene otro jugador.';
  try {
    const r = await auth.signUp.email({ email, password, name: nickname });
    if (r?.error) return errText(r.error, 'No se ha podido crear la cuenta.');
  } catch (e) {
    return errText(e, 'No se ha podido crear la cuenta.');
  }
  jwt = null;
  set({ status: 'in', email, profile: null });
  return saveProfile({ nickname, color, icon });
}

export async function signIn(email: string, password: string): Promise<string | null> {
  try {
    const r = await auth.signIn.email({ email, password });
    if (r?.error) return errText(r.error, 'No se ha podido iniciar sesión.');
  } catch (e) {
    return errText(e, 'No se ha podido iniciar sesión.');
  }
  jwt = null;
  await initAccount();
  return null;
}

/** App instalada en iPhone: ahí Google se abre en Safari, que no comparte la sesión con la app. */
const iosApp = () => {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && standalone;
};
const HANDOFF = 'handoff';
const VERIFIER = 'neon_auth_session_verifier';

/**
 * Si esta página la ha abierto Safari al volver de Google para la app instalada (lleva `handoff`), no entra aquí:
 * deja el código para que la app termine de entrar y dice que se vuelva a la app. Devuelve true si era el caso.
 */
async function handoffFromSafari(): Promise<boolean> {
  const q = new URLSearchParams(location.search);
  const id = q.get(HANDOFF), v = q.get(VERIFIER);
  if (!id || !/^[a-f0-9]{32}$/.test(id)) return false;
  if (v) {
    try { await fetch(httpUrl(`/api/handoff/${id}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v }) }); } catch { /* sin conexión */ }
  }
  history.replaceState(history.state, '', location.pathname);
  handoffId = id;
  set({ status: 'handoff' });
  // Esta ventana la abrió la app: se cierra sola para volver a ella (si iOS no deja, queda el botón).
  setTimeout(() => { try { window.close(); } catch { /* nada */ } }, 700);
  return true;
}
let handoffId: string | null = null;

/**
 * Botón «Ir al inicio» de la página de traspaso: si la app no ha recogido aún el código, se termina de entrar aquí
 * mismo; si ya lo recogió, se va al inicio sin más.
 */
export async function finishHandoffHere() {
  const id = handoffId;
  handoffId = null;
  if (id) {
    try {
      const r = await fetch(httpUrl(`/api/handoff/${id}`));
      const j = (await r.json()) as { v?: string | null };
      if (j.v) {
        const u = new URL(location.href);
        u.searchParams.set(VERIFIER, j.v);
        history.replaceState(history.state, '', u.href);
      }
    } catch { /* sin conexión */ }
  }
  jwt = null;
  set({ status: 'loading' });
  await initAccount();
}

/** En la app: espera a que Safari deje el código del inicio de sesión con Google y termina de entrar. */
async function waitHandoff(id: string): Promise<string | null> {
  const until = Date.now() + 5 * 60 * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const r = await fetch(httpUrl(`/api/handoff/${id}`));
      const j = (await r.json()) as { v?: string | null };
      if (j.v) {
        // El cliente de Neon Auth recoge el código de la dirección de la página al pedir la sesión.
        const u = new URL(location.href);
        u.searchParams.set(VERIFIER, j.v);
        history.replaceState(history.state, '', u.href);
        jwt = null;
        await initAccount();
        return state.status === 'in' ? null : 'No se ha podido terminar de entrar con Google. Prueba otra vez.';
      }
    } catch { /* se reintenta */ }
  }
  return 'Se ha agotado el tiempo para entrar con Google.';
}

/** Iniciar sesión con Google: va a Google y vuelve a esta misma página. */
export async function signInGoogle(): Promise<string | null> {
  if (iosApp()) {
    // Google se abre en Safari; al volver, Safari deja el código y la app (que lo espera aquí) termina de entrar.
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    // La ventana se abre ya, con la pulsación (si se abriera tras esperar al servidor, iOS la bloquearía).
    const win = window.open('about:blank', '_blank');
    try {
      const r = await auth.signIn.social({ provider: 'google', callbackURL: `${location.origin}${location.pathname}?${HANDOFF}=${id}`, disableRedirect: true });
      const url = r?.data?.url as string | undefined;
      if (r?.error || !url) { win?.close(); return errText(r?.error, 'No se ha podido iniciar sesión con Google.'); }
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      win?.close();
      return errText(e, 'No se ha podido iniciar sesión con Google.');
    }
    return waitHandoff(id);
  }
  try {
    const r = await auth.signIn.social({ provider: 'google', callbackURL: location.origin + location.pathname });
    if (r?.error) return errText(r.error, 'No se ha podido iniciar sesión con Google.');
    // Con ventana emergente, la sesión ya está lista al volver.
    jwt = null;
    await initAccount();
    return null;
  } catch (e) {
    return errText(e, 'No se ha podido iniciar sesión con Google.');
  }
}

export async function signOut() {
  try { await auth.signOut(); } catch { /* nada */ }
  jwt = null;
  try { localStorage.removeItem(GUEST_KEY); } catch { /* nada */ }
  set({ status: 'out' });
}

/** Crea o cambia el perfil (nickname único, color e icono). Devuelve el error, o null si ha ido bien. */
export async function saveProfile(p: Profile): Promise<string | null> {
  const r = await api('/api/perfil', { method: 'PUT', body: JSON.stringify({ ...p, guestId: playerId() }) });
  if (!r.ok) return (r.data.error as string) ?? 'No se ha podido guardar.';
  set({ ...state, profile: r.data.profile as Profile });
  try { localStorage.setItem('maldiciones:nombre', p.nickname); localStorage.setItem('maldiciones:color', String(p.color)); localStorage.setItem('maldiciones:icono', p.icon); } catch { /* nada */ }
  return null;
}

export { ICONS } from '../game/icons';
