// Prueba de humo contra el servidor (local por defecto): crea una sala, entran dos jugadores,
// empieza la partida y juegan en piloto automático hasta el final.
//   node smoke.mjs [http://localhost:8787]
import WebSocket from 'ws';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const { code } = await (await fetch(`${BASE}/api/salas`, { method: 'POST' })).json();
console.log('Sala', code, await (await fetch(`${BASE}/api/salas/${code}`)).json());

const tok = (c) => c.repeat(24);
const msgs = { A: 0, B: 0 };
let bytes = 0, last = null, errors = [];
const lastOf = {};

function connect(name) {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/salas/${code}/ws`);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, token: tok(name) })));
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 'error') errors.push(`${name}: ${m.msg}`);
    if (m.t !== 'room') return;
    msgs[name]++;
    bytes += d.length;
    if (name === 'A') last = m;
    lastOf[name] = [ws, m];
    // Al empezar, ambos dicen que ya han visto el reparto.
    if (m.game && !ws.readyDone) { ws.readyDone = true; ws.send(JSON.stringify({ t: 'ready' })); }
  });
  return new Promise((res) => ws.on('open', () => res(ws)));
}

const A = await connect('A');
await new Promise((r) => setTimeout(r, 300));
const B = await connect('B');
await new Promise((r) => setTimeout(r, 300));
console.log('Asientos:', last.seats);
A.send(JSON.stringify({ t: 'opts', opts: { size: 3, level: 2 } }));
// B no es anfitrión: no puede empezar.
B.send(JSON.stringify({ t: 'start' }));
await new Promise((r) => setTimeout(r, 300));
A.send(JSON.stringify({ t: 'start' }));
await new Promise((r) => setTimeout(r, 1500));
const g = last.game;
console.log('Partida: soy', last.you, '| mano', g.players[last.you].hand.length, '| rivales', g.players.map((p) => p.hand.map((c) => c.id).slice(0, 2).join(',')).join(' / '), '| seed', g.seed, '| mazo', g.deck.slice(0, 2).map((c) => c.id));
// Acción ilegal (jugar por otro): el servidor la reescribe a mi asiento y la rechaza si no toca.
A.send(JSON.stringify({ t: 'act', a: { type: 'timeout' } }));

// Reconexión: B se va y vuelve con el mismo token.
B.close();
await new Promise((r) => setTimeout(r, 2000));
console.log('B desconectado ->', last.seats.map((s) => `${s.name}:${s.online ? 'on' : 'off'}`).join(' '));
const B2 = await connect('B');
await new Promise((r) => setTimeout(r, 1000));
console.log('B vuelve      ->', last.seats.map((s) => `${s.name}:${s.online ? 'on' : 'off'}`).join(' '));

// Esperamos a que acabe (los humanos juegan en piloto automático: 60 s por turno, así que A lo acelera
// jugando como una máquina mínima: robar en su turno y pasar en las ventanas).
const deadline = Date.now() + 9 * 60 * 1000;
const iv = setInterval(() => {
  for (const [ws, m] of Object.values(lastOf)) {
    const s = m?.game; if (!s || ws.readyState !== 1) continue;
    const me = m.you, ph = s.phase;
    const send = (a) => ws.send(JSON.stringify({ t: 'act', a: { player: me, ...a } }));
    if (ph.t === 'turn' && s.turn === me) send({ type: ph.drawn ? 'keep' : 'draw' });
    else if (ph.t === 'react' && ph.waiting.includes(me)) send({ type: 'react', r: 'pass' });
    else if (ph.t === 'aplastar' && ph.players.includes(me)) send({ type: 'slap' });
    else if (ph.t === 'gemas' && ph.waiting.includes(me)) send({ type: 'gemas', ids: [] });
    else if (ph.t === 'tinte' && ph.player === me) send({ type: 'color', color: 'm' });
    else if (ph.t === 'choose' && ph.player === me) send({ type: 'choose', value: ph.need === 'gem' ? null : ph.options[0] });
  }
}, 700);
while (last.game?.phase.t !== 'over' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
clearInterval(iv);
console.log('Fin:', last.game?.phase.t, '| ganador', last.game?.winner, '| turnos', last.game?.stats.turns, '| mensajes', msgs, '| KB recibidos', Math.round(bytes / 1024), '| errores', errors);
A.close(); B2.close();
process.exit(last.game?.phase.t === 'over' ? 0 : 1);
