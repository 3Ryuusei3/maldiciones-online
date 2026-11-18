// Partidas online: crear o unirse a una sala y sala de espera.

import { useState } from 'react';
import type { Level } from '../game/bot';
import { NetClient, createRoom, roomInfo, useNet } from '../net/client';
import { PCOL, asset, toggleFullscreen } from './shared';

const LEVELS = ['Fácil', 'Normal', 'Difícil'] as const;

/**
 * Fondo de la portada con su panel lateral. Lo pinta App una sola vez para la portada, la entrada online
 * y la sala de espera: al pasar de una a otra solo cambia el contenido del panel (el fondo no se recarga).
 */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="home">
      <div className="home-bg" style={{ backgroundImage: `url(${asset('ui/fondo.webp')})` }} />
      <button className="fs-btn" onClick={toggleFullscreen} title="Pantalla completa" aria-label="Pantalla completa">⛶</button>
      <div className="home-panel">{children}</div>
    </div>
  );
}

/** Pantalla de entrada: crear una sala nueva o unirse con un código. */
export function OnlineEntry({ initialCode, initialError, onJoin, onBack }: { initialCode?: string; initialError?: string | null; onJoin: (code: string, name: string) => void; onBack: () => void }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem('maldiciones:nombre') ?? ''; } catch { return ''; } });
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
      <label>
        Tu nombre
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jugador" maxLength={14} />
      </label>
      <button className="play" disabled={busy} onClick={create}>Crear sala</button>
      <div className="join-row">
        <label>
          Código de sala
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} onKeyDown={(e) => e.key === 'Enter' && join()} placeholder="ABCD" className="code-input" />
        </label>
        <button disabled={busy || code.length !== 4} onClick={join}>Unirse</button>
      </div>
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
        setTimeout(() => setCopied(false), 1800);
      }
    } catch { /* cancelado o sin permiso */ }
  };
  const bots = Math.max(0, o.size - v.seats.length);
  return (
    <>
      <h1>Sala</h1>
      <div className="room-code">
        <span>{v.code}</span>
        <button onClick={copy}>{copied ? 'Enlace copiado' : 'Invitar'}</button>
      </div>
      <div className="field">
        Jugadores ({v.seats.length}/{o.size})
        <ul className="lobby-seats">
          {v.seats.map((x, i) => (
            <li key={i} className={x.online ? '' : 'off'}>
              <i style={{ background: PCOL[i % PCOL.length] }} />
              {x.name}
              {i === v.you && <small>(tú)</small>}
              {x.host && <small>anfitrión</small>}
              {!x.online && <small>desconectado</small>}
            </li>
          ))}
          {Array.from({ length: bots }, (_, i) => <li key={`b${i}`} className="bot"><i />Máquina ({LEVELS[o.level].toLowerCase()})</li>)}
        </ul>
      </div>
      {v.host ? (
        <>
          <div className="field">
            Total en la mesa
            <div className="seg">
              {[3, 4, 5, 6].map((n) => <button key={n} className={o.size === n ? 'on' : ''} disabled={n < v.seats.length} onClick={() => client.opts({ size: n })}>{n}</button>)}
            </div>
          </div>
          <div className="field">
            Nivel de las máquinas
            <div className="seg">
              {LEVELS.map((t, i) => <button key={t} className={o.level === i ? 'on' : ''} onClick={() => client.opts({ level: i as Level })}>{t}</button>)}
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={o.extraCurses} onChange={(e) => client.opts({ extraCurses: e.target.checked })} />Añadir las Maldiciones restantes al Mazo</label>
          <label className="check"><input type="checkbox" checked={o.condena} onChange={(e) => client.opts({ condena: e.target.checked })} />Jugar con la carta Condena</label>
          <label className="check"><input type="checkbox" checked={o.beta} onChange={(e) => client.opts({ beta: e.target.checked })} />Añadir las cartas beta</label>
          <button className="play" onClick={() => client.send({ t: 'start' })}>Empezar</button>
        </>
      ) : (
        <p className="lobby-wait">Esperando a que el anfitrión empiece la partida…</p>
      )}
      {(status !== 'open' || error) && <p className="net-error" role="alert">{status !== 'open' ? 'Reconectando…' : error}</p>}
      <div className="home-links">
        <button onClick={() => { client.leave(); onExit(); }}>Salir de la sala</button>
      </div>
    </>
  );
}
