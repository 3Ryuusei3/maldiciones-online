import { Attr, Card, Color, KINDS, Kind, cardImage, cardName } from '../game/cards';

export const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;

/** Activa o quita la pantalla completa. */
export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

/** Color de cada jugador (asiento): se usa en su placa y en el registro. */
export const PCOL = ['#ffd23f', '#ff8fb1', '#6fd3ff', '#ffa34d', '#b5ff7d', '#d7a6ff'];

export const CATS: Attr[] = ['gema', 'ataque', 'defensa', 'magia', 'apoyo', 'entorno', 'sagrada', 'maldita'];
export const kindsOf = (a: Attr) => (Object.keys(KINDS) as Kind[]).filter((k) => KINDS[k].attr === a);

const COLORED: Kind[] = ['aplastar', 'travesura', 'codicia', 'adivinar', 'mutis', 'gema1', 'gema2', 'gema3'];
export function sample(kind: Kind, color: Color = 'm'): Card {
  return { id: `s-${kind}`, kind, color: COLORED.includes(kind) ? color : null, ...(kind === 'cristalizar' ? { tone: color } : {}) };
}

/** Símbolo de Atributo (espada, escudo, báculo...), sacado de las chuletas. */
export function AttrIcon({ attr, size = 20 }: { attr: Attr; size?: number }) {
  return <img className="icon" src={asset(`attr/${attr}.webp`)} alt="" width={size} height={size} draggable={false} />;
}

const RANK_FILL = ['', '#7d4f9e', '#2f9d5f', '#eaa436'];
const RANK_SOFT = ['', '#9a7bb0', '#78c097', '#ecc688'];
/** Símbolo de Jerarquía: hexágono I (morado), II (verde), III (amarillo) o Diamante (blanco; negro en las Malditas). */
export function RankIcon({ rank, dark, size = 20 }: { rank: number; dark?: boolean; size?: number }) {
  if (rank <= 0) return null;
  if (rank >= 4) {
    const a = dark ? '#0a0a0a' : '#fff', b = dark ? '#fff' : '#0a0a0a';
    return (
      <svg width={size * 1.1} height={size} viewBox="0 0 44 40" role="img" aria-label="Jerarquía Diamante">
        <path d="M10 3H34L42 14L22 38L2 14Z" fill={a} stroke="#0a0a0a" strokeWidth="3" strokeLinejoin="round" />
        <path d="M2 14H42M10 3L16 14L22 3L28 14L34 3M16 14L22 38L28 14" fill="none" stroke={b} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={size * 0.9} height={size} viewBox="0 0 40 44" role="img" aria-label={`Jerarquía ${'I'.repeat(rank)}`}>
      <path d="M20 2L37 12V32L20 42L3 32V12Z" fill={RANK_FILL[rank]} stroke="#0a0a0a" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M20 9L31 15.5V28.5L20 35L9 28.5V15.5Z" fill={RANK_SOFT[rank]} stroke="#0a0a0a" strokeWidth="1.6" strokeLinejoin="round" />
      {Array.from({ length: rank }, (_, i) => { const x = 20 + (i - (rank - 1) / 2) * 4.4; return <path key={i} d={`M${x} 16V28`} stroke="#0a0a0a" strokeWidth="1.7" />; })}
    </svg>
  );
}

export function Icon({ kind, size = 20 }: { kind: Kind; size?: number }) {
  return <img className="icon" src={asset(`icons/${kind}.webp`)} alt="" width={size} height={size} draggable={false} />;
}

/** Indicadores de Entorno en trifuerza: Tinieblas arriba; debajo Mutis · central invertido · Inutilizar. */
export function Triforce({ on = [], className = '' }: { on?: string[]; className?: string }) {
  const cursed = on.length >= 2;
  return (
    <div className={`tri ${className}`}>
      {(['tinieblas', 'mutis', 'centro', 'inutilizar'] as const).map((k) => {
        const lit = k === 'centro' ? cursed : on.includes(k);
        return <img key={k} className={`t-${k} ${lit ? 'on' : ''}`} src={asset(`ui/${k}-${lit ? 'on' : 'off'}.webp`)} alt="" />;
      })}
    </div>
  );
}

/** `onHover`: al pasar el ratón por la carta (solo si está boca arriba), para enseñar su ayuda. */
export function CardView({ card, back, className = '', onClick, badge, onBadge, onInfo, onHover }: { card?: Card; back?: boolean; className?: string; onClick?: () => void; badge?: string; onBadge?: () => void; onInfo?: (c: Card) => void; onHover?: (c: Card) => void }) {
  const hidden = back || !card;
  return (
    <div className={`card ${className} ${onClick ? 'clickable' : ''}`} onClick={onClick} onMouseEnter={onHover && !hidden ? () => onHover(card!) : undefined}>
      <img src={asset(hidden ? 'cards/back.webp' : cardImage(card!))} alt={hidden ? 'Carta' : cardName(card!)} draggable={false} />
      {badge && (onBadge
        ? <button className="badge" onClick={(e) => { e.stopPropagation(); onBadge(); }}>{badge}</button>
        : <span className="badge">{badge}</span>)}
      {onInfo && !hidden && <button className="info" aria-label={`Ayuda: ${cardName(card!)}`} onClick={(e) => { e.stopPropagation(); onInfo(card!); }}>?</button>}
    </div>
  );
}

export function Modal({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="overlay">
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Nombres de carta de más largo a más corto, para reconocerlos dentro de un texto del registro.
const NAMES = (Object.keys(KINDS) as Kind[]).map((k) => [KINDS[k].name, k] as const).sort((a, b) => b[0].length - a[0].length);
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Convierte una línea del registro en texto enriquecido: jugadores en su color y cartas en MAYÚSCULAS con su icono. */
export function rich(text: string, players: string[]): React.ReactNode[] {
  const re = new RegExp(`(${[...players].sort((a, b) => b.length - a.length).map(esc).join('|')})|(${NAMES.map((n) => esc(n[0])).join('|')})( Amarill[oa]| Morad[oa]| Verde| Incolora)?`, 'g');
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Solo palabras completas: "Tú" dentro de otra palabra no cuenta.
    const before = text[m.index - 1];
    const after = text[m.index + m[0].length];
    if ((before && /[\p{L}]/u.test(before)) || (after && /[\p{L}]/u.test(after))) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<b key={m.index} className="lp" style={{ color: PCOL[players.indexOf(m[1]) % PCOL.length] }}>{m[1]}</b>);
    else {
      const kind = NAMES.find((n) => n[0] === m![2])![1];
      out.push(<span key={m.index} className="lc"><Icon kind={kind} size={15} />{(m[2] + (m[3] ?? '')).toUpperCase()}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
