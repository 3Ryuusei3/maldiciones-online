// Partidas online: crear o unirse a una sala y sala de espera.

import { myProfile, useAccount } from '../net/auth';
import { AccountChip, AccountExit, HexIcon } from './Account';
import { useState } from 'react';
import { NetClient, createRoom, roomInfo, useNet } from '../net/client';
import { COLOR_ORDER, PCOL, asset, toggleFullscreen } from './shared';
import { LEVELS, SetupFields } from './Setup';
import type { Level } from '../game/bot';
import { CompendioButton } from './Compendium';


/**
 * Fondo de la portada con su panel lateral. Lo pinta App una sola vez para la portada, la entrada online
 * y la sala de espera: al pasar de una a otra solo cambia el contenido del panel (el fondo no se recarga).
 */
export function Shell({ children, onAccount }: { children: React.ReactNode; onAccount?: () => void }) {
  return (
    <div className="home">
      <div className="home-bg" style={{ backgroundImage: `url(${asset('ui/fondo.webp')})` }} />
      <div className="home-panel">
        {/* Cabecera del panel: la cuenta a la izquierda; compendio y pantalla completa a la derecha (en móvil, en su sitio, sin tapar nada). */}
        <div className="panel-top">
          {onAccount ? <AccountChip onAccount={onAccount} /> : <span />}
          <div className="panel-tools">
            <CompendioButton icon />
            <button className="tool-btn fs-btn2" onClick={toggleFullscreen} title="Pantalla completa" aria-label="Pantalla completa">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
            </button>
            {onAccount && <AccountExit />}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Pantalla de entrada: crear una sala nueva o unirse con un código. */
export function OnlineEntry({ initialCode, initialError, onJoin, onBack, onAccount }: { initialCode?: string; initialError?: string | null; onJoin: (code: string, name: string) => void; onBack: () => void; onAccount?: () => void }) {
  const acc = useAccount();
  const prof = myProfile(acc);
  const [name, setName] = useState(() => prof?.nickname ?? (() => { try { return localStorage.getItem('maldiciones:nombre') ?? ''; } catch { return ''; } })());
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const remember = () => { try { localStorage.setItem('maldiciones:nombre', name.trim()); } catch { /* sin almacenamiento */ } };
  const nm = name.trim() || 'Jugador';

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      remember();
      onJoin(await createRoom(), nm);
    } catch (e) {
      setError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'No se puede conectar con el servidor.');
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) return setError('El código tiene 4 letras.');
    setBusy(true);
    setError(null);
    try {
      const info = await roomInfo(c);
      if (!info.exists) setError('No existe ninguna sala con ese código.');
      else if (info.playing && !info.free) setError('La partida ya ha empezado y no quedan sitios libres.');
      else {
        remember();
        onJoin(c, nm);
      }
    } catch {
      setError('No se puede conectar con el servidor.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Online</h1>
      <p className="tagline">Juega con amigos</p>
      {prof ? null : (
      <label>
        Tu nombre
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jugador" maxLength={14} />
      </label>
      )}
      <div className="play-row">
        <button className="play" disabled={busy} onClick={create}>Crear sala</button>
      </div>
      <p className="or-sep">o únete a la de un amigo</p>
      <label>
        Código de sala
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} onKeyDown={(e) => e.key === 'Enter' && join()} placeholder="ABCD" className="code-input" />
      </label>
      <button className="play" disabled={busy || code.length !== 4} onClick={join}>Unirse a la sala</button>
      {error && <p className="net-error" role="alert">{error}</p>}
      <div className="home-links">
        <button onClick={onBack}>Volver</button>
      </div>
    </>
  );
}

/** Sala de espera: quién está, opciones (las cambia el anfitrión) y empezar. */
export function Lobby({ client, onExit }: { client: NetClient; onExit: () => void }) {
  const { view: v, status, error } = useNet(client);
  const [copied, setCopied] = useState(false);
  if (!v) return <><p className="tagline">{status === 'connecting' ? 'Conectando…' : 'Sin conexión'}</p><button onClick={onExit}>Volver</button></>;
  const o = v.opts;
  const link = `${location.origin}${location.pathname}?sala=${v.code}`;
  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Maldiciones', text: `Únete a mi partida de Maldiciones (sala ${v.code})`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
    } catch { /* cancelado o sin permiso */ }
  };
  const bots = Math.max(0, o.size - v.seats.length);
  return (
    <>
      {/* Título y, a su derecha, el código: pulsándolo se copia el enlace de invitación. */}
      <div className="room-head">
        <h1>Sala</h1>
        <button className="room-code-btn" onClick={copy} title="Copiar el enlace para invitar" aria-label={`Sala ${v.code}: copiar el enlace para invitar`}>{v.code}</button>
      </div>
      {copied && <div className="toast-copied" role="status">Enlace copiado</div>}
      <div className="field">
        Jugadores ({v.seats.length}/{o.size})
        <ul className="lobby-seats">
          {v.seats.map((x, i) => (
            <li key={i} className={x.online ? '' : 'off'}>
              <HexIcon icon={x.icon ?? 'maldicion'} color={PCOL[x.color] ?? PCOL[i % PCOL.length]} size={34} />
              {x.name}
              {i === v.you && <small>(tú)</small>}
              {x.host && <small>anfitrión</small>}
              {!x.online && <small>desconectado</small>}
            </li>
          ))}
          {Array.from({ length: bots }, (_, i) => {
            // Cada máquina con su nivel: el anfitrión lo cambia pulsándolo (Fácil → Normal → Difícil).
            const lv = o.botLevels?.[i] ?? o.level;
            const next = () => {
              const all = Array.from({ length: bots }, (_, j) => o.botLevels?.[j] ?? o.level);
              all[i] = ((lv + 1) % 3) as Level;
              client.opts({ botLevels: all });
            };
            return (
              <li key={`b${i}`} className="bot">
                <span className="hex-wrap"><span className="hex-icon bot-hex" style={{ width: 34 * 0.87, height: 34 }}><span className="hex-in" /></span></span>
                Máquina
                {v.host ? <button className={`lvl lvl-${lv}`} onClick={next} title="Cambiar el nivel de esta máquina">{LEVELS[lv]}</button> : <small className={`lvl lvl-${lv}`}>{LEVELS[lv]}</small>}
              </li>
            );
          })}
        </ul>
      </div>
      {v.you >= 0 && (
        <div className="field">
          Tu color
          <div className="color-pick" role="radiogroup" aria-label="Tu color">
            {COLOR_ORDER.map((i) => {
              const c = PCOL[i];
              const mine = v.seats[v.you]?.color === i;
              const taken = !mine && v.seats.some((x, j) => j !== v.you && !x.bot && x.color === i);
              return <button key={c} role="radio" aria-checked={mine} aria-label={`Color ${i + 1}${taken ? ' (ocupado)' : ''}`} className={mine ? 'on' : ''} disabled={taken} style={{ background: c }} onClick={() => client.send({ t: 'color', c: i })} />;
            })}
          </div>
        </div>
      )}
      {v.host ? (
        <>
          <SetupFields opts={o} set={(x) => client.opts(x)} min={v.seats.length} hideLevel />
          <button className="play" onClick={() => client.send({ t: 'start' })}>Empezar</button>
        </>
      ) : (
        <>
          <p className="lobby-note">Solo el anfitrión puede cambiar las opciones de la partida.</p>
          <div className="readonly"><SetupFields opts={o} set={() => {}} readOnly hideLevel /></div>
          <p className="lobby-wait">Esperando a que el anfitrión empiece la partida…</p>
        </>
      )}
      {(status !== 'open' || error) && <p className="net-error" role="alert">{status !== 'open' ? 'Reconectando…' : error}</p>}
      <div className="home-links">
        <button onClick={() => { client.leave(); onExit(); }}>Salir de la sala</button>
      </div>
    </>
  );
}
