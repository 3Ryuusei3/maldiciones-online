// Pantallas de cuenta: entrada (iniciar sesión, crear cuenta, Google o invitado), perfil (nickname, color e icono)
// y la pastilla de la cuenta en la portada.

import { useState } from 'react';
import { ICONS, Profile, playAsGuest, saveProfile, signIn, signInGoogle, signOut, signUp, toEntry, useAccount } from '../net/auth';
import { PCOL, asset, ink } from './shared';

/** Selector de color (los 9 de los jugadores). */
function ColorPick({ value, onChange }: { value: number; onChange: (c: number) => void }) {
  return (
    <div className="color-pick" role="radiogroup" aria-label="Tu color">
      {PCOL.map((c, i) => <button key={c} type="button" role="radio" aria-checked={value === i} aria-label={`Color ${i + 1}`} className={value === i ? 'on' : ''} style={{ background: c }} onClick={() => onChange(i)} />)}
    </div>
  );
}

/** Selector de icono (iconos de las cartas), sobre el color elegido. */
function IconPick({ value, color, onChange }: { value: string; color: number; onChange: (k: string) => void }) {
  return (
    <div className="icon-pick" role="radiogroup" aria-label="Tu icono">
      {ICONS.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} style={value === k ? { background: PCOL[color] } : undefined} onClick={() => onChange(k)} title={k}>
          <img src={asset(`icons/${k}.webp`)} alt="" />
        </button>
      ))}
    </div>
  );
}

/** Avatar de la cuenta: su icono sobre su color. */
export function Avatar({ p, size = 34 }: { p: Profile; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: PCOL[p.color] ?? PCOL[0] }}>
      <img src={asset(`icons/${p.icon}.webp`)} alt="" />
    </span>
  );
}

const savedColor = () => { try { const c = Number(localStorage.getItem('maldiciones:color')); return c >= 0 && c < PCOL.length ? c : 0; } catch { return 0; } };

/** Pantalla de entrada: lo primero que se ve sin sesión. */
export function EntryScreen() {
  const [mode, setMode] = useState<'menu' | 'login' | 'signup'>('menu');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nick, setNick] = useState(() => { try { return localStorage.getItem('maldiciones:nombre') ?? ''; } catch { return ''; } });
  const [color, setColor] = useState(savedColor);
  const [icon, setIcon] = useState<string>('maldicion');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const e = await f();
    setBusy(false);
    if (e) setError(e);
  };
  const google = (
    <button type="button" className="google" disabled={busy} onClick={() => run(signInGoogle)}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.4-.4-3.5z" /></svg>
      Continuar con Google
    </button>
  );
  if (mode === 'menu') return (
    <>
      <h1>Maldiciones</h1>
      <p className="tagline">El juego de cartas maldito</p>
      <div className="entry-menu">
        <button className="play" onClick={() => setMode('login')}>Iniciar sesión</button>
        <button className="play outline" onClick={() => setMode('signup')}>Crear cuenta</button>
        {google}
        <div className="entry-or"><span>o</span></div>
        <button className="entry-guest" onClick={playAsGuest}>Jugar como invitado</button>
        {error && <p className="error">{error}</p>}
      </div>
    </>
  );
  return (
    <>
      <h1>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h1>
      <form className="entry-form" onSubmit={(e) => { e.preventDefault(); void run(() => (mode === 'login' ? signIn(email.trim(), password) : signUp(email.trim(), password, nick.trim(), color, icon))); }}>
        <label>Correo<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Contraseña<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {mode === 'signup' && (
          <>
            <label>Nickname<input value={nick} onChange={(e) => setNick(e.target.value)} minLength={3} maxLength={14} required placeholder="Único: nadie más puede tenerlo" /></label>
            <div className="field">Tu color<ColorPick value={color} onChange={setColor} /></div>
            <div className="field">Tu icono<IconPick value={icon} color={color} onChange={setIcon} /></div>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="play-row"><button className="play" type="submit" disabled={busy}>{busy ? '…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button></div>
        {google}
      </form>
      <div className="home-links">
        <button onClick={() => { setError(null); setMode(mode === 'login' ? 'signup' : 'login'); }}>{mode === 'login' ? 'No tengo cuenta: crear una' : 'Ya tengo cuenta: iniciar sesión'}</button>
        <button onClick={() => { setError(null); setMode('menu'); }}>Volver</button>
      </div>
    </>
  );
}

/** Perfil: al entrar por primera vez (sobre todo con Google) y desde «Mi cuenta». */
export function ProfileScreen({ first, onDone }: { first?: boolean; onDone?: () => void }) {
  const acc = useAccount();
  const cur = acc.profile;
  const [nick, setNick] = useState(cur?.nickname ?? acc.suggested?.replace(/[^\p{L}\p{N}_ .-]/gu, '').slice(0, 14) ?? '');
  const [color, setColor] = useState(cur?.color ?? savedColor());
  const [icon, setIcon] = useState(cur?.icon ?? 'maldicion');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const preview: Profile = { nickname: nick || '…', color, icon };
  return (
    <>
      <h1>{first ? 'Tu perfil' : 'Mi cuenta'}</h1>
      <p className="tagline">{acc.email}</p>
      <div className="profile-preview"><Avatar p={preview} size={56} /><span className="pill" style={{ background: PCOL[color], color: ink(PCOL[color]) }}>{preview.nickname}</span></div>
      <form className="entry-form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null); setSaved(false);
        const er = await saveProfile({ nickname: nick.trim(), color, icon });
        setBusy(false);
        if (er) setError(er); else { setSaved(true); onDone?.(); }
      }}>
        <label>Nickname<input value={nick} onChange={(e) => setNick(e.target.value)} minLength={3} maxLength={14} required placeholder="Único: nadie más puede tenerlo" /></label>
        <div className="field">Tu color<ColorPick value={color} onChange={setColor} /></div>
        <div className="field">Tu icono<IconPick value={icon} color={color} onChange={setIcon} /></div>
        {error && <p className="error">{error}</p>}
        {saved && !first && <p className="ok">Guardado.</p>}
        <div className="play-row"><button className="play" type="submit" disabled={busy}>{busy ? '…' : first ? 'Empezar a jugar' : 'Guardar'}</button></div>
      </form>
      <div className="home-links">
        {!first && onDone && <button onClick={onDone}>Volver</button>}
        <button onClick={signOut}>Cerrar sesión</button>
      </div>
    </>
  );
}

/** Icono de salir (puerta con flecha). */
const ExitIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
  </svg>
);

/** En la portada, arriba: quién eres (pulsando, «Mi cuenta») a la izquierda y salir a la derecha; o, como invitado, entrar. */
export function AccountChip({ onAccount }: { onAccount: () => void }) {
  const acc = useAccount();
  if (acc.status === 'in' && acc.profile) return (
    <div className="account-bar">
      <button className="account-me" onClick={onAccount} title="Mi cuenta: nickname, color e icono">
        <Avatar p={acc.profile} size={30} />
        <b>{acc.profile.nickname}</b>
      </button>
      <button className="account-exit" onClick={signOut} title="Cerrar sesión" aria-label="Cerrar sesión"><ExitIcon /></button>
    </div>
  );
  if (acc.status === 'guest') return (
    <div className="account-bar">
      <button className="account-me guest" onClick={toEntry} title="Iniciar sesión o crear cuenta">
        <span className="avatar guest-av">?</span>
        <span>Invitado · <u>Entrar</u></span>
      </button>
    </div>
  );
  return null;
}
