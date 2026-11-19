// Cuentas de jugador con Neon Auth (correo y contraseña, o Google), o jugar como invitado.
// La sesión la lleva Neon Auth; el perfil del juego (nickname único, color e icono) lo guarda nuestro servidor.

import { useSyncExternalStore } from 'react';
import { createAuthClient } from '@neon/auth';
import { httpUrl, playerId } from './client';

/** Dirección de Neon Auth de la rama de producción (es pública). VITE_NEON_AUTH_URL la cambia. */
const AUTH_URL = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined) ?? 'https://ep-sweet-bread-babz5160.neonauth.c-8.eu-central-1.aws.neon.tech/neondb/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const auth = createAuthClient(AUTH_URL) as any;

export interface Profile { nickname: string; color: number; icon: string }
export interface Account {
  /** `loading`: comprobando la sesión. `out`: sin sesión ni invitado (pantalla de entrada). */
  status: 'loading' | 'out' | 'guest' | 'in';
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

/** Iniciar sesión con Google: va a Google y vuelve a esta misma página. */
export async function signInGoogle(): Promise<string | null> {
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
