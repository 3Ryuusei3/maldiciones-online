// Ritmo de la partida: lo comparten el anfitrión local (useGame) y el servidor online (room.ts).

import { Level } from './bot';
import { GameState } from './engine';

/** Multiplicador de las pausas de las máquinas: ritmo único y pausado, para que dé tiempo a ver cada jugada. */
export const PACE = 1;

const BOT_NAMES = ['Lilith', 'Grimm', 'Morgana', 'Corvus', 'Nyx', 'Hécate', 'Salem', 'Circe', 'Merlín', 'Baba Yaga', 'Fausto', 'Medea', 'Belial', 'Ágata', 'Mordred', 'Sibila', 'Rasputín', 'Carmilla', 'Astaroth', 'Nimue', 'Erebo', 'Brujilda', 'Lázaro', 'Úrsula', 'Vlad', 'Pandora', 'Azrael', 'Melusina', 'Caronte', 'Lucero'];

/** Nombres de máquina al azar y sin repetir (ni coincidir con los nombres ya usados). */
export const pickNames = (n: number, taken: string[]) => {
  const low = taken.map((t) => t.toLowerCase());
  return BOT_NAMES.filter((x) => !low.includes(x.toLowerCase())).map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);
};

export const between = (a: number, b: number) => a + Math.random() * (b - a);

/** Duración (ms) de las ventanas cuando hay un humano implicado. */
export const WINDOW_MS = { react: 15000, aplastar: 4000, gemas: 15000 };
/** Tiempo máximo de un humano para cualquier decisión fuera de las ventanas (después juega la máquina por él). */
export const DECIDE_MS = 15000;
/** Ventana cuando solo deciden máquinas. */
export const BOT_WINDOW_MS = 6000;
/** Margen antes de que las máquinas empiecen a reaccionar en Aplastar, para que dé tiempo a verlo venir. */
export const SLAP_GRACE = 900;
const SLAP_MS: [number, number][] = [[900, 2400], [650, 1800], [450, 1300]];

export type Windowed = 'react' | 'aplastar' | 'gemas';
export const isWindowed = (t: GameState['phase']['t']): t is Windowed => t === 'react' || t === 'aplastar' || t === 'gemas';

/** Cuánto tarda una máquina en decidir en la fase actual. `humanCanDup`: da tiempo a un humano a duplicar. */
export function botDelay(s: GameState, level: Level, humanCanDup: boolean): number {
  const t = s.phase.t;
  const k = PACE;
  if (t === 'turn') return Math.max(between(3000, 3800) * k, humanCanDup ? 4800 : 0);
  if (t === 'aplastar') return SLAP_GRACE + between(...SLAP_MS[level]);
  if (t === 'react') return between(2200, 3000) * k;
  if (t === 'gemas') return between(1300, 2100) * k;
  if (t === 'choose' || t === 'tinte') return between(1400, 2000) * k;
  return between(1700, 2300) * k;
}

/** Cuánto tarda una máquina en duplicar la carta superior cuando quiere hacerlo. */
export const dupDelay = () => between(2000, 3400) * PACE;
