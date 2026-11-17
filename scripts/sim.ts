// Simulador: juega partidas completas solo con máquinas para detectar
// bloqueos, errores o cartas perdidas. Uso: npm run sim [partidas]
import { botDecide, botDup, Level } from '../src/game/bot';
import { apply, GameState, newGame, pendingPlayers } from '../src/game/engine';

const games = Number(process.argv[2] ?? 300);
let seed = 12345;
const r = () => {
  seed = (seed * 1664525 + 1013904223) | 0;
  return (seed >>> 0) / 4294967296;
};

function count(s: GameState): number {
  let n = s.deck.length + s.pile.length;
  for (const p of s.players) n += p.hand.length + (p.egida ? 1 : 0);
  const ph = s.phase;
  if (ph.t === 'iman') n += ph.pool.length;
  if (ph.t === 'adivinar') n += ph.cards.length;
  if (s.rafaga) n += s.rafaga.pool.length;
  if (ph.t === 'give') n += ph.eff.given.length;
  if (ph.t === 'react' && ph.eff.k === 'trav') n += ph.eff.given.length;
  if (ph.t === 'react' && ph.eff.k === 'gift') n += 1;
  if (ph.t === 'choose' && ph.pp.companion && ['maldicion', 'condena'].includes(ph.pp.companion.kind)) n += 1;
  return n;
}

const stats = { wins: [0, 0, 0], turns: 0, stuck: 0, max: 0, phases: {} as Record<string, number> };
for (let g = 0; g < games; g++) {
  const n = 3 + (g % 4);
  const extra = g % 2 === 0;
  let s = newGame({ players: Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })), seed: g * 7919 + 1, extraCurses: extra, beta: g % 3 !== 0 });
  const levels = Array.from({ length: n }, (_, i) => ((i + g) % 3) as Level);
  const total = (extra ? 103 : 97 + n) + (g % 3 !== 0 ? 6 : 0);
  let steps = 0;
  while (s.phase.t !== 'over' && steps < 6000) {
    steps++;
    stats.phases[s.phase.t] = (stats.phases[s.phase.t] ?? 0) + 1;
    {
      const ids: string[] = [...s.deck, ...s.pile, ...s.players.flatMap((p) => [...p.hand, ...(p.egida ? [p.egida] : [])])].map((c) => c.id);
      const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
      if (dupe) throw new Error(`Partida ${g}: carta repetida ${dupe} (fase ${s.phase.t})\n${s.log.slice(-8).map((l) => l.text).join('\n')}`);
    }
    if (count(s) !== total) throw new Error(`Partida ${g}: ${count(s)} cartas, se esperaban ${total} (fase ${s.phase.t})\n${s.log.slice(-6).map((l) => l.text).join('\n')}`);
    let next = s;
    if (r() < 0.3) {
      for (const p of s.players) {
        const d = botDup(s, p.id, levels[p.id], r);
        if (d) { next = apply(s, d); break; }
      }
    }
    if (next === s) {
      const who = pendingPlayers(s);
      const p = who[Math.floor(r() * who.length)];
      const a = r() < 0.03 && ['react', 'aplastar', 'gemas'].includes(s.phase.t) ? ({ type: 'timeout' } as const) : botDecide(s, p, levels[p], r);
      if (!a) throw new Error(`Partida ${g}: sin acción para ${p} en fase ${s.phase.t}`);
      next = apply(s, a);
      if (next === s) throw new Error(`Partida ${g}: acción rechazada ${JSON.stringify(a)} en fase ${s.phase.t}\n${s.log.slice(-6).map((l) => l.text).join('\n')}`);
    }
    s = next;
  }
  if (s.phase.t !== 'over') stats.stuck++;
  else stats.wins[levels[s.winner!]]++;
  stats.turns += steps;
  stats.max = Math.max(stats.max, steps);
}
console.log(`${games} partidas. Sin terminar en 6000 pasos: ${stats.stuck}. Pasos medios: ${Math.round(stats.turns / games)}, máximo: ${stats.max}`);
console.log(`Victorias por nivel  fácil: ${stats.wins[0]}  normal: ${stats.wins[1]}  difícil: ${stats.wins[2]}`);
console.log('Fases visitadas:', stats.phases);
