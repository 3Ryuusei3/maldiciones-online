// Ritmo de la partida: lo comparten el anfitrión local (useGame) y el servidor online (room.ts).

import { Level } from './bot';
import { GameState } from './engine';

/** Multiplicador de las pausas de las máquinas: ritmo único y pausado, para que dé tiempo a ver cada jugada. */
export const PACE = 1.1;

const BOT_NAMES = ['Lilith', 'Grimm', 'Morgana', 'Corvus', 'Nyx', 'Hécate', 'Salem', 'Circe', 'Merlín', 'Baba Yaga', 'Fausto', 'Medea', 'Belial', 'Ágata', 'Mordred', 'Sibila', 'Rasputín', 'Carmilla', 'Astaroth', 'Nimue', 'Erebo', 'Brujilda', 'Lázaro', 'Úrsula', 'Vlad', 'Pandora', 'Azrael', 'Melusina', 'Caronte', 'Lucero'];

/** Nombres de máquina al azar y sin repetir (ni coincidir con los nombres ya usados). */
export const pickNames = (n: number, taken: string[]) => {
  const low = taken.map((t) => t.toLowerCase());
  return BOT_NAMES.filter((x) => !low.includes(x.toLowerCase())).map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);
};

export const between = (a: number, b: number) => a + Math.random() * (b - a);

/** Duración (ms) de las ventanas cuando hay un humano implicado. */
// Reaccionar pide a veces dos pasos (pulsar Reflejo y elegir a quién) y la ventana empieza mientras la carta aún vuela:
// 20 s para reaccionar.
export const WINDOW_MS = { react: 20000, aplastar: 4000, gemas: 15000 };
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
  if (tinieblasJustFell(s) && t === 'turn') return TINIEBLAS_PEEK_MS + between(600, 1400);
  if (t === 'turn') return Math.max(between(3000, 3800) * k, humanCanDup ? 4800 : 0);
  if (t === 'aplastar') return SLAP_GRACE + between(...SLAP_MS[level]);
  // Reacciones algo más pausadas: que dé tiempo a ver la carta (un Reflejo, por ejemplo) antes de que nadie responda.
  if (t === 'react') return between(2900, 3700) * k;
  if (t === 'gemas') return between(900, 1500) * k;
  if (t === 'choose' || t === 'tinte') return between(1000, 1600) * k;
  return between(1700, 2300) * k;
}

/** Cuánto tarda una máquina en duplicar la carta superior cuando quiere hacerlo. */
export const dupDelay = () => between(1400, 2400) * PACE;

/**
 * Al caer las Tinieblas, todos tienen unos segundos para memorizar su mano antes de que se den la vuelta
 * (cuenta desde que caen: incluye la animación del Entorno). Las máquinas no juegan hasta que pasa.
 */
export const TINIEBLAS_PEEK_MS = 12500;
/** Lo que se ven las cartas para memorizarlas, contado desde que termina la animación del Entorno. */
export const PEEK_VISIBLE_MS = 5000;
/** ¿Acaban de caer las Tinieblas? (las máquinas esperan a que pase el tiempo de memorizar). */
export const tinieblasJustFell = (s: GameState) => !!s.env.tinieblas && s.seq - (s.env.tinieblas.at ?? -99) <= 2;
