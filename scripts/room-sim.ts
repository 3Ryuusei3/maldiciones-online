// Partidas online simuladas con reloj virtual: humanos conectados que no juegan (les mueve el piloto
// automático), otros que se desconectan a mitad, y máquinas. Comprueba que todas las partidas terminan y
// que la vista de cada jugador no contiene cartas ajenas ocultas ni la semilla.
//   npx tsx scripts/room-sim.ts 200

import { hello, newRoom, nextWake, ready, roomView, setOpts, start, tick } from '../src/game/room';

const N = Number(process.argv[2] ?? 100);
let ended = 0, leaks = 0, stuck = 0, steps = 0;
const t0 = Date.now();

for (let g = 0; g < N; g++) {
  let now = 1_000_000;
  const r = newRoom('TEST', now);
  const tokens = ['a', 'b', 'c'].map((x) => x.repeat(20));
  const online = new Set(tokens.slice(0, 2 + (g % 2)));
  for (const [i, tk] of tokens.entries()) hello(r, tk, `Humano ${i}`);
  setOpts(r, tokens[0], { size: 3 + (g % 4), level: (g % 3) as 0 | 1 | 2, beta: g % 2 === 0, extraCurses: g % 5 === 0 });
  start(r, tokens[0], now);
  for (const tk of online) ready(r, tk, online, now);
  let guard = 0;
  while (r.game!.phase.t !== 'over' && guard++ < 20000) {
    tick(r, online, now);
    steps++;
    // A mitad de partida se desconecta uno y vuelve más tarde.
    if (guard === 300) online.delete(tokens[1]);
    if (guard === 900) online.add(tokens[1]);
    for (const tk of online) {
      const v = roomView(r, tk, online, now);
      const me = v.you;
      const full = r.game!;
      if (v.game!.seed !== 0 && full.phase.t !== 'over') leaks++;
      if (full.phase.t === 'over') continue;
      const realIds = new Set(full.players.flatMap((p, i) => (i === me ? [] : p.hand.map((c) => c.id))));
      full.deck.forEach((c) => realIds.add(c.id));
      for (const [i, p] of v.game!.players.entries()) {
        if (i === me) continue;
        for (const c of p.hand) if (realIds.has(c.id) && !isShown(full, c.id, me)) leaks++;
      }
      for (const c of v.game!.deck) if (realIds.has(c.id)) leaks++;
    }
    const w = nextWake(r, online, now);
    if (w === null) break;
    now = w;
  }
  if (r.game!.phase.t === 'over') ended++;
  else {
    stuck++;
    if (stuck <= 3) console.log('Atascada en', r.game!.phase.t, JSON.stringify(r.game!.phase).slice(0, 300));
  }
}

function isShown(full: import('../src/game/engine').GameState, id: string, me: number): boolean {
  const ph = full.phase;
  if (ph.t === 'react' && ph.eff.k === 'cristal' && (ph.eff.held ?? []).some((h) => h.ids.includes(id))) return true;
  if (ph.t === 'gemas' && Object.values(ph.chosen).some((ids) => ids.includes(id))) return true;
  if (ph.t === 'escarcha' && ph.player === me) return true;
  return false;
}

console.log(`${N} partidas: ${ended} terminadas, ${stuck} atascadas, ${leaks} fugas de información, ${steps} pasos, ${Date.now() - t0} ms`);
if (stuck || leaks) process.exit(1);
