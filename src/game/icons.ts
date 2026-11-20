// Iconos de jugador (los de las cartas): se eligen en el perfil (cuenta o invitado); las máquinas llevan uno al azar.

export const ICONS = ['maldicion', 'antitodo', 'aplastar', 'codicia', 'condena', 'cristalizar', 'egida', 'reflejo', 'iman', 'adivinar', 'recuperar', 'predestinar', 'purga', 'mutis', 'inutilizar', 'tinieblas', 'travesura', 'gema1', 'gema2', 'gema3', 'gematri', 'escarcha', 'rafaga', 'trastada', 'ritual1',
  // Atributos (el de Gema es la Gema Tricolor, que ya está) y Jerarquías.
  'attr-ataque', 'attr-defensa', 'attr-magia', 'attr-apoyo', 'attr-entorno', 'attr-sagrada', 'attr-maldita',
  'rank-1', 'rank-2', 'rank-3', 'rank-d', 'rank-d-oscuro', 'rank-d-arcana'] as const;

/** Icono teñido con los tonos de uno de los 12 colores: «maldicion:t3» (el número es el color). */
const TINT_RE = /:t(\d{1,2})$/;
/** Color con el que va teñido un icono (índice de la paleta), o null si va con sus colores. */
export const iconTint = (x: string): number | null => { const m = TINT_RE.exec(x); return m && Number(m[1]) < 12 ? Number(m[1]) : null; };
/** Icono sin el sufijo de teñido. */
export const iconBase = (x: string) => x.replace(TINT_RE, '');
/** El mismo icono con otro teñido (null: sin teñir). */
export const withTint = (x: string, c: number | null) => (c === null ? iconBase(x) : `${iconBase(x)}:t${c}`);
export const isIcon = (x: unknown): x is string => typeof x === 'string' && (ICONS as readonly string[]).includes(iconBase(x));
/** Las máquinas llevan un icono de carta al azar (no de atributo ni de Jerarquía). */
const CARD_ICONS = ICONS.filter((k) => !k.startsWith('attr-') && !k.startsWith('rank-'));
export const randomIcon = (r: () => number = Math.random) => CARD_ICONS[Math.floor(r() * CARD_ICONS.length)];
