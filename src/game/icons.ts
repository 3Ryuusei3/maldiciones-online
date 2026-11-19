// Iconos de jugador (los de las cartas): se eligen en el perfil (cuenta o invitado); las máquinas llevan uno al azar.

export const ICONS = ['maldicion', 'antitodo', 'aplastar', 'codicia', 'condena', 'cristalizar', 'egida', 'reflejo', 'iman', 'adivinar', 'recuperar', 'predestinar', 'purga', 'mutis', 'inutilizar', 'tinieblas', 'travesura', 'gema1', 'gema2', 'gema3', 'gematri', 'escarcha', 'rafaga', 'trastada', 'ritual1'] as const;

export const isIcon = (x: unknown): x is string => typeof x === 'string' && (ICONS as readonly string[]).includes(x);
export const randomIcon = (r: () => number = Math.random) => ICONS[Math.floor(r() * ICONS.length)];
