// Emoticonos de las máquinas: de vez en cuando reaccionan a lo que pasa en la mesa (no siempre).
// La elección sale de la propia jugada (número de jugada y jugador), así que en online todos ven lo mismo
// sin que el servidor tenga que enviar nada.
import type { Kind } from './cards';
import type { GameState } from './engine';

/** Qué puede «decir» una máquina al echar cada carta, y con qué probabilidad. */
const ON_PLAY: Partial<Record<Kind, { p: number; e: string[] }>> = {
  travesura: { p: 0.25, e: ['😈', '😂'] },
  trastada: { p: 0.5, e: ['😈', '😂', '🔥'] },
  aplastar: { p: 0.25, e: ['🔥', '😈'] },
  cristalizar: { p: 0.25, e: ['😈', '🤔'] },
  codicia: { p: 0.3, e: ['😈', '🤔'] },
  purga: { p: 0.3, e: ['💀', '😂'] },
  iman: { p: 0.35, e: ['😈', '🔥'] },
  escarcha: { p: 0.4, e: ['🤔', '😈'] },
  rafaga: { p: 0.4, e: ['🔥'] },
  reflejo: { p: 0.4, e: ['😂', '😈', '👏'] },
  egida: { p: 0.25, e: ['👍', '🫣'] },
  antitodo: { p: 0.45, e: ['🙏', '🔥', '😂'] },
  tinieblas: { p: 0.3, e: ['🫣', '💀'] },
  inutilizar: { p: 0.2, e: ['🤔'] },
  condena: { p: 0.4, e: ['💀', '😈'] },
};
const ON_DRAW = ['😭', '😡', '😱', '💀'];

/** Número pseudoaleatorio fijo para (jugada, jugador, uso). */
function roll(seq: number, p: number, salt: number): number {
  let h = (Math.imul(seq + 1, 0x9e3779b1) ^ Math.imul(p + 7, 0x85ebca6b) ^ Math.imul(salt + 3, 0xc2b2ae35)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return h / 4294967296;
}
const pick = (xs: string[], x: number) => xs[Math.floor(x * xs.length) % xs.length];

/** Emoticonos candidatos tras una jugada (`prev` → `next`), por orden de preferencia. */
export function botBanter(prev: GameState, next: GameState): { p: number; e: string }[] {
  if (next.seq === prev.seq) return [];
  const out: { p: number; e: string }[] = [];
  const bot = (p: unknown): p is number => typeof p === 'number' && !!next.players[p]?.bot && !next.players[p].out;
  // Fin de la partida: el ganador lo celebra; alguno de los demás aplaude o llora.
  if (next.phase.t === 'over' && prev.phase.t !== 'over') {
    const w = next.winner;
    if (bot(w) && roll(next.seq, w, 1) < 0.7) out.push({ p: w, e: pick(['😂', '🔥', '👏'], roll(next.seq, w, 2)) });
    for (const pl of next.players)
      if (pl.id !== w && bot(pl.id) && roll(next.seq, pl.id, 1) < 0.35) out.push({ p: pl.id, e: pick(['👏', '😭', '😡'], roll(next.seq, pl.id, 2)) });
    return out;
  }
  for (const f of next.fx) {
    // Quien roba de golpe 3 o más se queja.
    if (f.from === 'deck' && bot(f.to) && f.n >= 3 && roll(next.seq, f.to, 3) < 0.35) out.push({ p: f.to, e: pick(ON_DRAW, roll(next.seq, f.to, 4)) });
    // Prueba a ciegas fallida.
    if (f.bounce && bot(f.from) && roll(next.seq, f.from, 5) < 0.4) out.push({ p: f.from, e: '🫣' });
  }
  for (const f of next.fx) {
    if (f.to !== 'pile' || f.bounce || !bot(f.from) || !f.card) continue;
    const r = ON_PLAY[f.card.kind];
    if (r && roll(next.seq, f.from, 6) < r.p) out.push({ p: f.from, e: pick(r.e, roll(next.seq, f.from, 7)) });
  }
  return out;
}
