// Compendio (Cómo jugar · Mecánicas · Cartas), mini partidas de ejemplo y panel de ayuda rápida.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ATTR_HELP, ATTR_NAME, Attr, BETA, Color, HELP, KINDS, Kind, RANK_NAME, cardImage } from '../game/cards';
import { AttrIcon, CATS, Icon, RankIcon, Triforce, asset, kindsOf, sample } from './shared';

/** Color con el que se enseña cada carta de color en el compendio, para que no salgan todas iguales. */
const HUE: Partial<Record<Kind, Color>> = { gema1: 'a', gema2: 'v', gema3: 'm', aplastar: 'a', cristalizar: 'm', travesura: 'v', codicia: 'a', adivinar: 'm', mutis: 'v' };
/** Imagen de una carta en el compendio (`null`: la incolora, p. ej. la Travesura incolora). */
const pic = (k: Kind, c?: Color | null) => asset(cardImage(c === null ? { id: 'x', kind: k, color: null } : sample(k, c ?? HUE[k] ?? 'm')));
/** En las mini partidas todo va en morado, para que las cartas encadenen entre sí. */
const dpic = (k: Kind) => pic(k, 'm');
const BACK = 'cards/back.webp';

/** Cuántas hay de cada carta en el Mazo. */
const COUNT: Record<Kind, number> = {
  gema1: 12, gema2: 9, gema3: 6, gematri: 3, aplastar: 6, cristalizar: 3, travesura: 9, egida: 3, reflejo: 6, codicia: 6, purga: 3, iman: 3,
  adivinar: 6, recuperar: 3, predestinar: 3, mutis: 6, inutilizar: 3, tinieblas: 3, antitodo: 3, maldicion: 6, condena: 1,
  escarcha: 1, rafaga: 1, trastada: 1, ritual1: 1, ritual2: 1, ritual3: 1,
};

/** Cartas que en el compendio y la ayuda van juntas en una sola entrada (cambia solo el número): su carta va rotando. */
/** Cartas de color: se enseñan empezando por su color del compendio y pasando por los otros dos. */
const colors = (k: Kind): { kind: Kind; c: Color }[] => { const f = HUE[k] ?? 'm'; return [f, ...(['v', 'a', 'm'] as Color[]).filter((c) => c !== f)].map((c) => ({ kind: k, c })); };
/** Cartas con varias versiones de dibujo (I, II, III): la I es la del juego; las otras, imágenes aparte. */
const versions = (k: Kind) => [{ kind: k, label: 'I' }, { kind: k, label: 'II', src: `cards/${k}-2.webp` }, { kind: k, label: 'III', src: `cards/${k}-3.webp` }];
const VARIANTS: Partial<Record<Kind, { kind: Kind; c?: Color | null; label?: string; src?: string }[]>> = {
  cristalizar: colors('cristalizar'), aplastar: colors('aplastar'), codicia: colors('codicia'), adivinar: colors('adivinar'), mutis: colors('mutis'),
  inutilizar: versions('inutilizar'), tinieblas: versions('tinieblas'),
  gema1: [{ kind: 'gema1', c: 'a' }, { kind: 'gema2', c: 'v' }, { kind: 'gema3', c: 'm' }],
  // Travesura: verde, amarilla, morada e incolora (se pasa de una a otra como las Gemas).
  travesura: [{ kind: 'travesura', c: 'v' }, { kind: 'travesura', c: 'a' }, { kind: 'travesura', c: 'm' }, { kind: 'travesura', c: null }],
  ritual1: [{ kind: 'ritual1' }, { kind: 'ritual2' }, { kind: 'ritual3' }],
};
const GROUP_NAME: Partial<Record<Kind, string>> = { gema1: 'Gema I · II · III', ritual1: 'Ritual I · II · III' };
/** Entrada del compendio a la que pertenece una carta. */
export const repOf = (k: Kind): Kind => (k === 'gema2' || k === 'gema3' ? 'gema1' : k === 'ritual2' || k === 'ritual3' ? 'ritual1' : k);
const nameOf = (k: Kind) => GROUP_NAME[k] ?? KINDS[k].name;
const entries = (a: Attr) => kindsOf(a).filter((k) => repOf(k) === k);
const countText = (k: Kind) => {
  const v = VARIANTS[k];
  if (!v || v.every((x) => x.kind === k)) return `${COUNT[k]} ${COUNT[k] === 1 ? 'carta' : 'cartas'}`;
  return `${v.map((x) => COUNT[x.kind]).join(' + ')} cartas`;
};

/** La carta de una entrada; si agrupa varias, van rotando solas y con flechas para pasarlas. */
function RotCard({ kind, className = '' }: { kind: Kind; className?: string }) {
  const v = VARIANTS[kind];
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => { setI(0); setAuto(true); }, [kind]);
  useEffect(() => {
    if (!v || !auto) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % v.length), 2400);
    return () => clearInterval(id);
  }, [v, auto, kind]);
  if (!v) return <img className={className} key={kind} src={pic(kind)} alt={KINDS[kind].name} />;
  const cur = v[i % v.length];
  const go = (d: number) => { setAuto(false); setI((x) => (x + d + v.length) % v.length); };
  return (
    <div className={`rot ${className}`}>
      <img key={i} src={cur.src ? asset(cur.src) : pic(cur.kind, cur.c)} alt={KINDS[cur.kind].name} />
      <div className="rot-ctl">
        <button onClick={() => go(-1)} aria-label="Carta anterior">‹</button>
        <span>{KINDS[cur.kind].name}{cur.label ? ` ${cur.label}` : v.every((x) => x.kind === kind) ? (cur.c ? ` ${colorWord(cur.c, kind)}` : ' incolora') : ''}</span>
        <button onClick={() => go(1)} aria-label="Carta siguiente">›</button>
      </div>
    </div>
  );
}

/** Nombre del color concordando con la carta (Cristalizar y Aplastar en masculino). */
const colorWord = (c: Color, k: Kind) => { const masc = k === 'cristalizar' || k === 'aplastar'; return { a: masc ? 'amarillo' : 'amarilla', m: masc ? 'morado' : 'morada', v: 'verde' }[c]; };

/** Detalles de las reglas de cada carta (del reglamento V7). */
const NOTES: Record<Kind, string[]> = {
  gema1: [], gema2: [], gema3: [],
  gematri: ['Las Gemas descartadas así van debajo de la Pila.'],
  aplastar: ['El lanzador no tiene que poner su mano.', 'El robo de cartas se puede defender o reflejar.', 'Rompeescudos: se descartan todas las Égidas boca arriba, así que no sirven contra este Aplastar.', 'Solo se puede duplicar cuando el anterior ha acabado del todo: entonces hay otra ronda completa, lanzada por quien duplica.', 'Con Inutilizar activo, el Aplastar de color no tiene efecto, pero la mano aparece igual: quien la pulse roba 3.'],
  cristalizar: ['Pese a ser un Ataque, NO puede reflejarse.', 'Si alguien usa Antitodo, todos los jugadores quedan exentos del efecto.', 'El propio lanzador también puede dejar sus Gemas del color o una Gema Tricolor.'],
  travesura: ['Se encadena con otras Travesuras acumulando el efecto: el siguiente recibe 1 carta por cada Travesura y roba 2 por cada una.', 'Duplicarla mientras su efecto está en juego también lo acumula.', 'Las cartas se eligen y se dan al final, cuando ya se sabe quién las recibe.', 'Con Reflejo solo se refleja la última Travesura de la cadena (1 carta y robar 2); lo acumulado antes se pierde. No se puede encadenar una Travesura a un Reflejo.', 'Si es tu última carta, ganas al echarla, aunque otros pudieran encadenarla o defenderse.', 'Con Inutilizar activo, la de color no tiene efecto: quien la recibiría decide si acepta el efecto; si lo acepta, roba 3.', 'Tiene una versión incolora para encadenar sin color.'],
  egida: ['Tras el primer uso permanece boca arriba junto a ti; puedes usarla de nuevo cuando quieras.', 'En el segundo uso se descarta encima de la Pila y su dueño elige color.', 'Si todos a los que iba dirigido un efecto se protegen, el efecto se acaba ahí: nadie puede reflejarlo ni anularlo.', 'Defenderse no quita el turno.', 'Antitodo y Aplastar eliminan las Égidas boca arriba.', 'No se puede reflejar y no tiene efecto contra Antitodo.'],
  reflejo: ['Se pueden reflejar acciones propias o dirigidas a otros jugadores.', 'Un efecto reflejado se puede volver a parar o reflejar, pero NO un Antitodo.', 'Al reflejar una Magia, su efecto cambia y afecta a todos.'],
  codicia: ['Es de Jerarquía I: el oponente te da su carta de mayor Jerarquía y tú le das la que quieras.', 'Si el oponente tiene varias cartas del mismo valor, elige él cuál entrega.', 'Hasta que se hace el intercambio, aún se puede parar con Antitodo, Égida o Reflejo.', 'Con Inutilizar activo, la de color no tiene efecto: quien la juega decide si empieza el efecto; si lo hace, roba 3.'],
  purga: ['Puedes dirigirla a ti mismo.', 'Las cartas descartadas van al fondo de la Pila.'],
  iman: ['Sin reflejar: la mejor carta y todas las Gemas de cada oponente.', 'Se atraen a la vez y se barajan para no saber de quién es cada una.', 'Puedes quedarte hasta 3, devolver hasta 3 a cada jugador y eliminar las que quieras.', 'Aunque un oponente solo dé 1 carta, se le pueden devolver 3.', 'Mientras el lanzador reparte, quien se ha quedado sin cartas las tiene retenidas y no gana. Si al acabar el reparto no le devuelven ninguna, gana.', 'Hasta que se reparten las cartas, los afectados aún pueden pararlo con Antitodo, Égida o Reflejo.', 'Con Égida el efecto se bloquea por completo para ese jugador.'],
  adivinar: ['De las 3 cartas puedes quedarte o descartar tantas como quieras; el resto vuelve al Mazo en el orden que elijas.', 'En Tinieblas sí ves las 3 cartas (es su efecto); las que te quedas entran en tu mano boca abajo.', 'Con Inutilizar activo, la de color no tiene efecto: quien la juega decide si empieza el efecto; si lo hace, roba 3.'],
  recuperar: ['Se puede recuperar una carta Maldita para dársela a otro jugador (se ve boca arriba).', 'Si quien la recibe la bloquea con Antitodo, vuelve a ti.'],
  predestinar: ['La carta que acompaña queda encima de Predestinar: si es de color, manda su color; si es incolora, quien la lanza elige color.', 'Los Ataques y Magias predestinados se pueden defender o reflejar, pero el turno se concede igualmente.', 'Las cartas de Defensa NO se pueden predestinar.', 'Puedes predestinar una carta a ti mismo y volver a tener el turno.', 'Es posible predestinar y dar una carta Maldita a otro jugador; todos la ven boca arriba. Si la bloquea con Antitodo, vuelve a ti.', 'Si la carta acompañante era tu última, ganas al momento.'],
  mutis: ['Si un jugador habla, roba 3 cartas.', 'Con Inutilizar activo no se puede activar ni desactivar Mutis: quien lo juega decide si empieza el efecto; si lo hace, roba 3.'],
  inutilizar: ['Las cartas básicas (de color) se pueden seguir jugando, pero sin efecto.', 'Pone a prueba la atención: un Aplastar de color saca la mano igualmente y quien la pulse roba 3.', 'Con Travesura, Codicia, Adivinar o Mutis de color se pregunta si se empieza (o se recibe) el efecto: quien diga que sí roba 3.'],
  tinieblas: ['Al caer, hay unos segundos para memorizar tu mano antes de que las cartas se pongan boca abajo.', 'En tu turno juegas una carta a ciegas o robas 3.', 'Si la carta no se puede encadenar, vuelve a tu mano, robas 1 y acaba tu turno.', 'En cualquier momento puedes intentar usar una carta a ciegas (duplicar, Antitodo, defenderte…); si no sirve, robas 1 aunque no sea tu turno.', 'Todas las cartas van boca abajo: también las que recibes o entregas.', 'Acaba cuando el turno vuelve 3 veces al lanzador, o con otra Tinieblas o Antitodo.', 'Mirar tus cartas se castiga con 3 cartas.'],
  antitodo: ['Elimina las cartas boca arriba y reinicia los Indicadores de Entorno. Permite cambiar de color.', 'Como reacción lo anula todo: lo que se gastó en defenderse vuelve a su dueño.', 'Bloquea las cartas que te entregan (por ejemplo, una Maldición predestinada): vuelven a quien te las daba.', 'Aún sirve mientras se resuelve un Imán o una Codicia (antes del intercambio).', 'Contrario: en tu turno, junto a una Maldición, elimina ambas.'],
  maldicion: ['Todos empiezan la partida con una.', 'Puedes dársela a otro con Travesura, Codicia, Recuperar, Predestinar o Imán.', 'Cuando se entrega una Maldición (Predestinar, Recuperar, Condena…), todos la ven boca arriba.'],
  escarcha: ['Carta beta de V7: solo entra si la activas al crear la partida.', 'El lanzador ve las manos de los oponentes y cambia cartas de una mano a otra; cada uno conserva cuántas tiene.', 'Si quiere, además da 1 carta suya a un oponente.', 'Quien se protege con Égida queda fuera. Reflejada, es quien la refleja el que mueve las cartas.'],
  rafaga: ['Carta beta de V7: solo entra si la activas al crear la partida.', 'Se revelan las 5 siguientes cartas del Mazo; las juegas una a una, con su efecto, contra quien quieras. Las que no quieras se descartan.', 'Además puedes jugar 1 carta de tu mano del mismo modo (una Maldición se le entrega a quien elijas).', 'Es de Apoyo: al jugarla puedes descartar 1 Gema debajo, y no se puede defender ni reflejar.', 'Jugar una carta con Ráfaga no concede el turno.'],
  trastada: ['Carta beta de V7: solo entra si la activas al crear la partida.', 'Se encadena con Travesuras y Trastadas: todo se acumula sobre el siguiente.', 'Las cartas se dan al final, cuando ya se sabe quién las recibe.', 'Reflejada: solo se refleja la última carta de la cadena.'],
  ritual1: ['Carta beta de V7. Hay un Ritual I, un Ritual II y un Ritual III.', 'Se pueden echar como una carta incolora sin efecto.', 'Quien tenga los 3 a la vez en la mano gana al instante.'],
  ritual2: ['Carta beta de V7. Hay un Ritual I, un Ritual II y un Ritual III.', 'Se pueden echar como una carta incolora sin efecto.', 'Quien tenga los 3 a la vez en la mano gana al instante.'],
  ritual3: ['Carta beta de V7. Hay un Ritual I, un Ritual II y un Ritual III.', 'Se pueden echar como una carta incolora sin efecto.', 'Quien tenga los 3 a la vez en la mano gana al instante.'],
  condena: ['Advertido: solo quedas condenado desde que ves esta carta en tu mano.', 'Si buscas en el lugar equivocado pierdes el turno: ni juegas ni robas.', 'La Maldición que encuentras se ve boca arriba.', 'Absolución: con todas las Maldiciones en la mano puedes descartar Condena o dársela a otro jugador.', 'NO se elimina con Antitodo.'],
};

// ───────────────────────── mini partida de ejemplo ─────────────────────────

type Spot = 'A' | 'B' | 'C' | 'deck' | 'pile';
type Env = 'mutis' | 'inutilizar' | 'tinieblas';
/** [origen, destino, nº de cartas, carta boca arriba, va debajo de la Pila] */
type Move = [Spot, Spot, number?, Kind?, boolean?];
interface Step { t: string; m?: Move[]; mark?: [Spot, string][]; turn?: Spot; rev?: boolean; env?: Env[]; shield?: boolean; peek?: Kind[]; blind?: boolean }
interface Script { hand?: Kind[]; steps: Step[] }

const POS: Record<Spot, [number, number]> = { A: [50, 82], B: [15, 21], C: [85, 21], deck: [31, 47], pile: [50, 47] };
const WHO: Record<'A' | 'B' | 'C', string> = { A: 'Tú', B: 'Lilith', C: 'Grimm' };

const gem = (k: Kind): Script => ({ hand: [k, 'travesura', 'maldicion'], steps: [{ t: 'En tu turno encadenas la Gema: coincide en color o en símbolo con la Pila.', m: [['A', 'pile', 1, k]] }, { t: 'No tiene efecto: el turno pasa al siguiente jugador.', turn: 'B' }] });

const DEMOS: Record<Kind, Script> = {
  gema1: gem('gema1'), gema2: gem('gema2'), gema3: gem('gema3'),
  gematri: { hand: ['gematri', 'gema3', 'codicia', 'maldicion'], steps: [
    { t: 'Es incolora: se puede echar siempre.', m: [['A', 'pile', 1, 'gematri']] },
    { t: 'Todos pueden descartar las Gemas que quieran.', m: [['B', 'pile', 2, 'gema1', true], ['C', 'pile', 1, 'gema2', true], ['A', 'pile', 1, 'gema3', true]] },
    { t: 'Y tú, que echaste la incolora, eliges el color con el que se sigue.', mark: [['A', '🎨']] },
  ] },
  aplastar: { steps: [
    { t: 'Juegas Aplastar.', m: [['A', 'pile', 1, 'aplastar']] },
    { t: 'Los demás ponen la mano en la Pila a toda prisa.', mark: [['B', '✋'], ['C', '✋'], ['pile', '💥']] },
    { t: 'Lilith llega primero. Grimm es el último…', mark: [['B', '1º'], ['C', 'Último']] },
    { t: '…y roba 3 cartas. Puede defenderse o reflejarlo.', m: [['deck', 'C', 3]] },
  ] },
  cristalizar: { steps: [
    { t: 'Juegas Cristalizar (aquí, el morado).', m: [['A', 'pile', 1, 'cristalizar']] },
    { t: 'Quien deje una Gema de ese color, una Tricolor o una Égida se libra.', m: [['B', 'pile', 1, 'gema1', true]], mark: [['B', '✔']] },
    { t: 'El resto de oponentes roba 3. No se puede reflejar.', m: [['deck', 'C', 3]] },
  ] },
  travesura: { steps: [
    { t: 'Juegas Travesura contra el siguiente jugador.', m: [['A', 'pile', 1, 'travesura']], mark: [['B', '🎯']] },
    { t: 'Si responde con otra Travesura, todo se acumula sobre el siguiente.', m: [['B', 'pile', 1, 'travesura']], mark: [['C', '😱']] },
    { t: 'Al final, cada lanzador elige la carta que da… ¿tu Maldición?', m: [['A', 'C', 1, 'maldicion'], ['B', 'C', 1]] },
    { t: '…y quien la recibe roba 2 por cada Travesura. Después juega su turno.', m: [['deck', 'C', 4]], turn: 'C' },
  ] },
  egida: { hand: ['egida', 'gema2', 'codicia', 'maldicion'], steps: [
    { t: 'Te lanzan un Ataque o una Magia.', m: [['B', 'pile', 1, 'travesura']], mark: [['A', '⚠']] },
    { t: 'Respondes con Égida: te protege y queda boca arriba junto a ti.', shield: true, mark: [['A', '🛡']] },
    { t: 'Le queda un uso más. Aplastar y Antitodo la eliminan.', shield: true },
  ] },
  reflejo: { hand: ['reflejo', 'gema2', 'codicia', 'maldicion'], steps: [
    { t: 'Te lanzan un Ataque.', m: [['B', 'pile', 1, 'travesura']], mark: [['A', '⚠']] },
    { t: 'Respondes con Reflejo: cambia el sentido de la partida.', m: [['A', 'pile', 1, 'reflejo']], rev: true },
    { t: 'El Ataque va contra el jugador que tú elijas.', m: [['A', 'C', 1, 'maldicion'], ['deck', 'C', 2]], rev: true, mark: [['C', '🎯']] },
    { t: 'Si reflejas una Magia, su efecto cambia y afecta a todos.', rev: true, mark: [['B', '✨'], ['C', '✨']] },
  ] },
  codicia: { steps: [
    { t: 'Juegas Codicia y eliges a un oponente.', m: [['A', 'pile', 1, 'codicia']], mark: [['B', '🎯']] },
    { t: 'Te da su carta de mayor Jerarquía…', m: [['B', 'A', 1, 'predestinar']] },
    { t: '…y tú le das la que quieras. ¿Tu Maldición?', m: [['A', 'B', 1, 'maldicion']] },
  ] },
  purga: { steps: [
    { t: 'Juegas Purga y eliges a un jugador (puedes ser tú).', m: [['A', 'pile', 1, 'purga']], mark: [['C', '🎯']] },
    { t: 'Descarta toda su mano al fondo de la Pila…', m: [['C', 'pile', 4, undefined, true]] },
    { t: '…y roba tantas cartas como tenía.', m: [['deck', 'C', 4]] },
  ] },
  iman: { hand: ['iman', 'codicia', 'maldicion'], steps: [
    { t: 'Juegas Imán.', m: [['A', 'pile', 1, 'iman']] },
    { t: 'Cada oponente te entrega su mejor carta…', m: [['B', 'A', 1, 'tinieblas'], ['C', 'A', 1, 'maldicion']] },
    { t: '…y todas sus Gemas.', m: [['B', 'A', 1, 'gema1'], ['B', 'A', 1, 'gema2'], ['C', 'A', 1, 'gema3']] },
    { t: 'Te quedas hasta 3 (por ejemplo, Tinieblas)…', mark: [['A', '≤ 3']] },
    { t: '…devuelves hasta 3 a cada jugador: ¡también tu Maldición!', m: [['A', 'B', 1, 'maldicion'], ['A', 'C', 1, 'maldicion']] },
    { t: '…y eliminas el resto bajo la Pila.', m: [['A', 'pile', 1, 'gema1', true], ['A', 'pile', 1, 'gema2', true], ['A', 'pile', 1, 'gema3', true]] },
    { t: 'Reflejado: atrae las 3 mejores cartas y las Gemas de cada jugador.', mark: [['B', '×3'], ['C', '×3']] },
  ] },
  adivinar: { hand: ['adivinar', 'gema1', 'codicia', 'maldicion'], steps: [
    { t: 'Juegas Adivinar. Como es de Apoyo, puedes descartar una Gema debajo.', m: [['A', 'pile', 1, 'adivinar'], ['A', 'pile', 1, 'gema1', true]] },
    { t: 'Miras las 3 siguientes cartas del Mazo.', peek: ['antitodo', 'maldicion', 'gema2'] },
    { t: 'Te quedas las que quieras…', m: [['deck', 'A', 1, 'antitodo']], peek: ['maldicion', 'gema2'] },
    { t: '…descartas otras y devuelves el resto al Mazo en el orden que elijas.', m: [['deck', 'pile', 1, 'gema2', true]], peek: ['maldicion'] },
  ] },
  recuperar: { steps: [
    { t: 'Juegas Recuperar.', m: [['A', 'pile', 1, 'recuperar']] },
    { t: 'Coges una carta de la Pila y te la quedas…', m: [['pile', 'A', 1, 'antitodo']] },
    { t: '…o se la das a otro jugador. Vale con una Maldición.', m: [['pile', 'C', 1, 'maldicion']] },
  ] },
  predestinar: { hand: ['predestinar', 'travesura', 'gema2', 'maldicion'], steps: [
    { t: 'Predestinar se juega siempre junto a otra carta.', m: [['A', 'pile', 1, 'predestinar'], ['A', 'pile', 1, 'travesura']] },
    { t: 'Diriges el efecto de esa carta a quien elijas.', mark: [['C', '🎯']], m: [['A', 'C', 1, 'gema2'], ['deck', 'C', 2]] },
    { t: 'Y ese jugador recibe el turno.', turn: 'C' },
    { t: 'Con una Maldición: se la das y le pasas el turno.', m: [['A', 'B', 1, 'maldicion']], turn: 'B' },
  ] },
  mutis: { steps: [
    { t: 'Juegas Mutis: se activa su Indicador.', m: [['A', 'pile', 1, 'mutis']], env: ['mutis'] },
    { t: 'Silencio en la mesa: las cartas dejan de anunciarse.', env: ['mutis'], mark: [['B', '🤫'], ['C', '🤫'], ['A', '🤫']] },
    { t: 'Termina con otro Mutis o con Antitodo.', m: [['C', 'pile', 1, 'mutis']] },
  ] },
  inutilizar: { steps: [
    { t: 'Juegas Inutilizar: se activa su Indicador.', m: [['A', 'pile', 1, 'inutilizar']], env: ['inutilizar'] },
    { t: 'Las cartas de color se pueden jugar, pero no hacen nada.', env: ['inutilizar'], m: [['B', 'pile', 1, 'travesura']], mark: [['pile', '🚫']] },
    { t: 'Termina con otro Inutilizar o con Antitodo.', m: [['C', 'pile', 1, 'inutilizar']] },
  ] },
  tinieblas: { steps: [
    { t: 'Juegas Tinieblas: todos dan la vuelta a sus cartas.', m: [['A', 'pile', 1, 'tinieblas']], env: ['tinieblas'], blind: true },
    { t: 'En su turno, cada uno juega una carta a ciegas o roba 3.', env: ['tinieblas'], blind: true, m: [['B', 'pile', 1, 'gema1']], mark: [['B', '🙈']] },
    { t: 'Si la carta no se puede encadenar: vuelve a la mano, robas 1 y pierdes el turno.', env: ['tinieblas'], blind: true, m: [['deck', 'C', 1]], mark: [['C', '✖']] },
    { t: 'Dura 3 turnos del lanzador, o hasta otra Tinieblas o Antitodo.', env: ['tinieblas'], blind: true, mark: [['A', '3 turnos']] },
  ] },
  antitodo: { hand: ['antitodo', 'gema2', 'maldicion'], steps: [
    { t: 'Se juega en cualquier momento, aunque no sea tu turno.', m: [['B', 'pile', 1, 'travesura']], mark: [['A', '⚠']], env: ['mutis'] },
    { t: 'Anula lo que vaya contra ti. Nadie puede evitarlo.', m: [['A', 'pile', 1, 'antitodo']], mark: [['A', '✔']], env: ['mutis'] },
    { t: 'Reinicia los Entornos y elimina las Égidas boca arriba.', mark: [['pile', '✨']] },
    { t: 'En tu turno, junto a una Maldición, la elimina.', m: [['A', 'pile', 1, 'maldicion', true]] },
  ] },
  maldicion: { hand: ['maldicion', 'gema2', 'codicia', 'antitodo'], steps: [
    { t: 'Todos empiezan la partida con una Maldición.', mark: [['A', '💀'], ['B', '💀'], ['C', '💀']] },
    { t: 'No se puede encadenar por sí sola.', mark: [['A', '🚫']] },
    { t: 'Dásela a otro con Travesura, Codicia, Predestinar…', m: [['A', 'pile', 1, 'codicia'], ['A', 'B', 1, 'maldicion']] },
    { t: '…o elimínala junto a un Antitodo.', mark: [['A', '✨']] },
  ] },
  escarcha: { hand: ['escarcha', 'gema2', 'maldicion'], steps: [
    { t: 'Juegas Escarcha: el tiempo se congela.', m: [['A', 'pile', 1, 'escarcha']], mark: [['B', '❄'], ['C', '❄']] },
    { t: 'Ves las manos de los oponentes y cambias cartas de una a otra.', m: [['B', 'C', 1, 'antitodo'], ['C', 'B', 1, 'gema1']] },
    { t: 'Si quieres, además das 1 carta tuya.', m: [['A', 'B', 1, 'maldicion']] },
  ] },
  rafaga: { hand: ['rafaga', 'gema2', 'maldicion'], steps: [
    { t: 'Juegas Ráfaga.', m: [['A', 'pile', 1, 'rafaga']] },
    { t: 'Se revelan las 5 siguientes cartas del Mazo.', peek: ['aplastar', 'gema1', 'travesura', 'adivinar', 'gema3'] },
    { t: 'Juegas las que quieras contra quien quieras, con su efecto.', m: [['deck', 'pile', 1, 'travesura']], mark: [['B', '🎯']], peek: ['aplastar', 'gema1', 'adivinar', 'gema3'] },
    { t: 'También puedes jugar 1 carta tuya. Las que sobran se descartan.', m: [['A', 'C', 1, 'maldicion']] },
  ] },
  trastada: { hand: ['trastada', 'gema2', 'codicia', 'maldicion'], steps: [
    { t: 'Juegas Trastada.', m: [['A', 'pile', 1, 'trastada']] },
    { t: 'El siguiente jugador recibe 2 cartas tuyas…', m: [['A', 'B', 1, 'maldicion'], ['A', 'B', 1, 'gema2']] },
    { t: '…y roba 3 del Mazo.', m: [['deck', 'B', 3]], turn: 'B' },
  ] },
  ritual1: { hand: ['ritual1', 'ritual2', 'gema2', 'maldicion'], steps: [
    { t: 'Tienes dos Rituales en la mano.', mark: [['A', '2/3']] },
    { t: 'Consigues el tercero…', m: [['deck', 'A', 1, 'ritual3']] },
    { t: '…y ganas la partida al instante.', mark: [['A', '🏆']] },
  ] },
  ritual2: { hand: ['ritual1', 'ritual2', 'gema2', 'maldicion'], steps: [
    { t: 'Tienes dos Rituales en la mano.', mark: [['A', '2/3']] },
    { t: 'Consigues el tercero…', m: [['deck', 'A', 1, 'ritual3']] },
    { t: '…y ganas la partida al instante.', mark: [['A', '🏆']] },
  ] },
  ritual3: { hand: ['ritual1', 'ritual2', 'gema2', 'maldicion'], steps: [
    { t: 'Tienes dos Rituales en la mano.', mark: [['A', '2/3']] },
    { t: 'Consigues el tercero…', m: [['deck', 'A', 1, 'ritual3']] },
    { t: '…y ganas la partida al instante.', mark: [['A', '🏆']] },
  ] },
  condena: { hand: ['condena', 'gema2', 'codicia'], steps: [
    { t: 'Con Condena en la mano, al empezar tu turno debes buscar una Maldición.', mark: [['A', '⏳']], turn: 'A' },
    { t: 'Eliges dónde: el Mazo, la Pila o la mano de un oponente.', mark: [['deck', '?'], ['pile', '?'], ['B', '?']], turn: 'A' },
    { t: 'Si la hay, te la quedas y sigues tu turno.', m: [['B', 'A', 1, 'maldicion']], turn: 'A' },
    { t: 'Si no, pierdes el turno. Con todas las Maldiciones quedas absuelto.', turn: 'B' },
  ] },
};

type H = Kind | 'back';
interface Sim { A: H[]; B: number; C: number; top: Kind }

/** Estado de la mini mesa al llegar al paso `upto`; `landed` indica si sus cartas en vuelo ya han aterrizado. */
function simulate(kind: Kind, upto: number, landed: boolean): Sim {
  const sc = DEMOS[kind];
  const s: Sim = { A: [...(sc.hand ?? [kind, 'gema2', 'codicia', 'maldicion'])], B: 4, C: 4, top: 'gema1' };
  for (let k = 0; k <= upto; k++) {
    const ms = sc.steps[k].m ?? [];
    for (const [from, , n = 1, face] of ms) {
      if (from === 'A') for (let i = 0; i < n; i++) { const j = face ? s.A.indexOf(face) : -1; s.A.splice(j >= 0 ? j : s.A.length - 1, 1); }
      else if (from === 'B' || from === 'C') s[from] = Math.max(0, s[from] - n);
    }
    if (k === upto && !landed) break;
    for (const [, to, n = 1, face, under] of ms) {
      if (to === 'A') for (let i = 0; i < n; i++) s.A.push(face ?? 'back');
      else if (to === 'B' || to === 'C') s[to] += n;
      else if (to === 'pile' && face && !under) s.top = face;
    }
  }
  return s;
}

const STEP_MS = 3600;
const DFLY = 1050;

export function Demo({ kind }: { kind: Kind }) {
  const steps = DEMOS[kind].steps;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [landed, setLanded] = useState(-1);
  useEffect(() => { setI(0); setLanded(-1); setPlaying(true); }, [kind]);
  const n = Math.min(i, steps.length - 1);
  const st = steps[n];
  const flights = (st.m ?? []).flatMap(([from, to, count = 1, face]) => Array.from({ length: count }, () => ({ from, to, face })));
  useEffect(() => {
    const land = window.setTimeout(() => setLanded(n), flights.length ? DFLY + (flights.length - 1) * 150 : 0);
    const next = playing ? window.setTimeout(() => setI((n + 1) % steps.length), STEP_MS + flights.length * 150) : 0;
    return () => { clearTimeout(land); clearTimeout(next); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, playing, kind]);
  const sim = simulate(kind, n, landed === n);
  const at = (s: Spot) => ({ left: `${POS[s][0]}%`, top: `${POS[s][1]}%` });
  const env = st.env ?? [];
  const hand = st.shield ? sim.A.filter((c) => c !== 'egida') : sim.A;
  const go = (k: number) => { setPlaying(false); setLanded(-1); setI((k + steps.length) % steps.length); };
  return (
    <div className="demo" aria-label={`Ejemplo de ${KINDS[kind].name}`}>
      <div className={`stage ${env.includes('tinieblas') ? 'dark' : ''}`}>
        <div className="d-disc" style={at('pile')}>
          <svg className={`d-flow ${st.rev ? 'rev' : ''}`} viewBox="0 0 200 200">
            <path className="arc" d="M 30 62 A 80 80 0 0 1 96 20" /><path className="tip" d="M 112 20 L 92 8 L 92 32 Z" />
            <path className="arc" d="M 170 138 A 80 80 0 0 1 104 180" /><path className="tip" d="M 88 180 L 108 168 L 108 192 Z" />
          </svg>
        </div>
        <img className="d-c d-deck" style={at('deck')} src={asset(BACK)} alt="Mazo" />
        <img className="d-c d-pile" key={sim.top} style={at('pile')} src={dpic(sim.top)} alt={KINDS[sim.top].name} />
        <Triforce on={env} className="d-tri" />
        {(['B', 'C'] as const).map((p) => (
          <div key={p} className={`d-seat ${st.turn === p ? 'turn' : ''}`} style={at(p)}>
            <div className="d-fan">{Array.from({ length: Math.min(sim[p], 9) }, (_, k) => <img key={k} src={asset(BACK)} alt="" />)}</div>
            <span className="pill">{WHO[p]}<i>{sim[p]}</i></span>
          </div>
        ))}
        <div className={`d-seat me ${st.turn === 'A' ? 'turn' : ''}`} style={at('A')}>
          <div className="d-fan">
            {hand.map((c, k) => <img key={k} src={c === 'back' || st.blind ? asset(BACK) : dpic(c)} alt="" />)}
            {st.shield && <img className="d-shield" src={dpic('egida')} alt="Égida boca arriba" />}
          </div>
          <span className="pill">{WHO.A}<i>{sim.A.length}</i></span>
        </div>
        {st.peek && <div className="d-peek">{st.peek.map((k, j) => <img key={j} src={dpic(k)} alt={KINDS[k].name} />)}</div>}
        {(st.mark ?? []).map(([s, e], k) => <span key={`${n}-m${k}`} className={`d-mark ${s === 'A' ? 'low' : ''}`} style={at(s)}>{e}</span>)}
        {landed !== n && flights.map((f, k) => (
          <span key={`${kind}-${n}-${k}`} className="d-fx" style={{ '--x0': `${POS[f.from][0]}%`, '--x1': `${POS[f.to][0]}%`, '--y0': `${POS[f.from][1]}%`, '--y1': `${POS[f.to][1]}%`, '--dl': `${k * 150}ms` } as React.CSSProperties}>
            <img src={f.face && !(st.blind && f.from !== 'deck' && f.to !== 'pile') ? dpic(f.face) : asset(BACK)} alt="" />
          </span>
        ))}
      </div>
      <p className="d-cap" key={n}><b>{n + 1}</b>{st.t}</p>
      <div className="d-ctl">
        <button onClick={() => go(n - 1)} aria-label="Paso anterior">‹</button>
        <div className="d-dots">{steps.map((_, k) => <button key={k} className={k === n ? 'on' : ''} onClick={() => go(k)} aria-label={`Paso ${k + 1}`} />)}</div>
        <button onClick={() => go(n + 1)} aria-label="Paso siguiente">›</button>
        <button className="pp" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pausa' : 'Reproducir'}</button>
      </div>
    </div>
  );
}

// ───────────────────────── ficha de carta ─────────────────────────

export function KindInfo({ kind, full }: { kind: Kind; full?: boolean }) {
  const k = KINDS[kind];
  const h = HELP[kind];
  return (
    <div className="kinfo">
      <div className="k-head">
        <Icon kind={kind} size={full ? 44 : 34} />
        <div>
          <b>{nameOf(kind)}{BETA.includes(kind) && <i className="beta">Beta</i>}</b>
          <small>
            <span className="attr"><AttrIcon attr={k.attr} size={13} />{ATTR_NAME[k.attr]}</span>
            {k.rank > 0 && <span className="rank"><RankIcon rank={k.rank} dark={k.attr === 'maldita'} size={20} />Jerarquía {k.rank === 4 ? 'Diamante' : RANK_NAME[k.rank]}</span>}
            {full && <> · {countText(kind)}</>}
          </small>
        </div>
      </div>
      <p>{full ? k.desc : h.text}</p>
      {full && NOTES[kind].length > 0 && <ul>{NOTES[kind].map((x) => <li key={x}>{x}</li>)}</ul>}
      {h.reflejada && <p className="refl"><b>Reflejada:</b> {h.reflejada}</p>}
      <p className="note"><AttrIcon attr={k.attr} size={15} /> {ATTR_HELP[k.attr]}</p>
    </div>
  );
}

// ───────────────────────── compendio ─────────────────────────

export type CompTab = 'jugar' | 'mecanicas' | 'cartas' | 'jerarquia';
const TABS: [CompTab, string][] = [['jugar', 'Cómo jugar'], ['mecanicas', 'Mecánicas'], ['cartas', 'Cartas'], ['jerarquia', 'Jerarquía']];
const ALL = CATS.flatMap(entries);
const RANKS: [number, string][] = [[4, 'Diamante'], [3, 'III'], [2, 'II'], [1, 'I'], [0, 'Sin Jerarquía']];

type Filter = { t: 'all' } | { t: 'attr'; a: Attr } | { t: 'rank'; r: number } | { t: 'beta' };
const passes = (f: Filter, k: Kind) =>
  f.t === 'all' || (f.t === 'attr' && KINDS[k].attr === f.a) || (f.t === 'rank' && KINDS[k].rank === f.r) || (f.t === 'beta' && BETA.includes(k));
const same = (a: Filter, b: Filter) => JSON.stringify(a) === JSON.stringify(b);

/** Fila de cartas con rótulo debajo y, si procede, marca de válido / no válido. */
function Fig({ items, caption, tight }: { tight?: boolean; items: ({ k: Kind; c?: Color | null; label?: string; ok?: boolean; back?: boolean } | string)[]; caption?: string }) {
  return (
    <figure className={`fig ${tight ? 'tight' : ''}`}>
      <div>
        {items.map((it, i) => typeof it === 'string' ? <span key={i} className="sep">{it}</span> : (
          <span key={i} className={`fc ${it.ok === true ? 'ok' : it.ok === false ? 'no' : ''}`}>
            <img src={it.back ? asset(BACK) : pic(it.k, it.c === undefined ? 'm' : it.c)} alt={KINDS[it.k].name} />
            {it.ok !== undefined && <i>{it.ok ? '✓' : '✕'}</i>}
            {it.label && <small>{it.label}</small>}
          </span>
        ))}
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function HowTo() {
  return (
    <div className="guide one">
      <section>
        <h2>¿Cómo funciona?</h2>
        <p>En <i>Maldiciones</i> deberás deshacerte de todas las cartas para ganar. Cada jugador comienza con una <b>Maldición</b>, una carta especial que no puede jugarse por sí sola. En tu turno deberás encadenar tus cartas y usar sus habilidades para atacar, encantar o entorpecer a los oponentes. Prepara tu estrategia, pon a prueba tu ingenio y líbrate de tu Maldición y de todas las cartas para ganar.</p>
        <ul className="box-list">
          <li>103 Cartas de juego</li><li>4 Indicadores de Entorno</li><li>Reglas de juego</li><li>6 Mini guías</li>
        </ul>
      </section>
      <section>
        <h2>¿Cómo jugar?</h2>
        <p>Separa las cartas <b>Maldición</b> del Mazo y reparte una por cada jugador. Si lo deseas, para una mayor dificultad, añade al Mazo las Maldiciones que sobren. Después, baraja y reparte en sentido antihorario 6 cartas a cada jugador. En total, se deben tener 7 cartas en la mano.</p>
        <Fig tight items={[{ k: 'maldicion', c: null }, '+', ...Array.from({ length: 6 }, () => ({ k: 'maldicion' as Kind, back: true }))]} />
        <p>A continuación, coloca una carta boca arriba en el centro de la mesa: no tendrá ningún efecto y será la <i>Pila de juego</i>. Por último, coloca los <i>Indicadores de Entorno</i> en una zona apartada pero visible, con la cara oscura boca abajo, de este modo:</p>
        <Triforce className="g-tri" />
        <p>El jugador a la derecha del repartidor comienza la partida. En su turno debe <i>Encadenar</i> una de sus cartas con la carta superior de la Pila de juego. Para ello hay que fijarse en dos parámetros: el <b>color</b> y el <b>símbolo</b>. Al menos uno de los dos debe coincidir. Las <b>cartas incoloras</b> pueden encadenarse sin importar estos parámetros. No se pueden encadenar <b>cartas malditas</b> por sí solas.</p>
        <Fig items={[{ k: 'gema1', c: 'v', label: 'Pila de juego' }, '←', { k: 'codicia', c: 'v', label: 'Mismo color', ok: true }, { k: 'gema1', c: 'm', label: 'Mismo símbolo', ok: true }, { k: 'mutis', c: 'a', label: 'Distinto color y símbolo', ok: false }, { k: 'travesura', c: null, label: 'Carta incolora', ok: true }, { k: 'maldicion', c: null, label: 'Carta maldita', ok: false }]} />
        <p>En su turno, el jugador puede <i>encadenar</i> o robar una carta. En caso de robar, puede quedarse la carta o jugarla. Después, su turno acaba. <b>El primer jugador en quedarse sin cartas gana la partida.</b></p>
        <p>Se gana <b>en el momento de echar la última carta</b>, sin que se aplique su efecto: da igual que otros pudieran defenderse o encadenarla. La única excepción es el <i>Entorno maldito</i>: con 2 o más Entornos activos, quien se queda sin cartas no gana y roba 1.</p>
      </section>
      <section>
        <h2>En esta versión digital</h2>
        <ul>
          <li>Las reacciones (Égida, Reflejo, Antitodo, Gemas contra Cristalizar…) tienen una ventana de <b>20 segundos</b>: la cuenta atrás aparece en el borde inferior. Si un efecto te afecta y no tienes con qué responder, no se te pregunta.</li>
          <li>Opcionalmente, cada decisión puede tener un <b>tiempo máximo de 15 segundos</b>; si se agota, una máquina juega por ti. Se activa al configurar la partida, y el anfitrión puede cambiarlo durante la partida.</li>
          <li><b>Aplastar</b> es un minijuego de reflejos: aparece una mano en un sitio al azar de la mesa (el mismo para todos) y hay que pulsarla antes que los demás.</li>
          <li>En <b>Tinieblas</b> hay unos segundos para memorizar tu mano. Después juegas a ciegas y, en cualquier momento, puedes intentar usar una carta (duplicar, Antitodo, defenderte…): si no sirve, robas 1.</li>
          <li>Con <b>Inutilizar</b> activo, las cartas de color ponen a prueba tu atención: si intentas aplicar su efecto (o pulsas la mano de un Aplastar de color), robas 3.</li>
          <li>Con <b>Mutis</b> activo las cartas no se anuncian.</li>
          <li>Pasa el ratón por cualquier carta boca arriba para ver su ayuda en el panel de la derecha.</li>
          <li>Las <b>flechas</b> muestran quién lanza un efecto contra quién, mientras dura.</li>
          <li>Online, si alguien se desconecta la partida se detiene y le espera; el anfitrión puede seguir esperando, dejar que juegue una máquina por él o quitarlo (sus cartas van al fondo de la Pila). Se vuelve a entrar con el mismo código y el mismo nombre.</li>
        </ul>
      </section>
    </div>
  );
}

/** Etiquetas cortas: el menú va arriba (como en Jerarquía) y tiene que caber en una fila. */
const MECH: [string, string][] = [['m-cartas', 'Cartas'], ['m-jerarquia', 'Jerarquía'], ['m-duplicar', 'Duplicar'], ['m-tinte', 'Tinte'], ['m-gemas', 'Gemas'], ['m-atributos', 'Atributos'], ['m-reflejar', 'Reflejar Magia'], ['m-entorno', 'Entorno maldito']];

/** Mientras se desplaza por un clic en el menú, el resaltado se queda en la sección elegida. */
let spyLock = 0;
/** Lleva a una sección dentro del panel que se desplaza. */
const goTo = (id: string, set: (id: string) => void) => {
  spyLock = Date.now() + 900;
  set(id);
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/** Qué sección se está leyendo ahora mismo (para resaltarla en el menú). */
function useSpy(ids: string[]): [string, (id: string) => void] {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const root = document.querySelector('.guide-scroll');
    if (!root) return;
    const onScroll = () => {
      if (Date.now() < spyLock) return;
      const top = root.getBoundingClientRect().top + 90;
      let cur = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= top) cur = id;
      }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) cur = ids[ids.length - 1];
      setActive(cur);
    };
    onScroll();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [active, setActive];
}

/**
 * Menú de secciones fijo arriba. En pantallas estrechas no cabe en una fila: se desliza de lado
 * (con un degradado en los bordes) y la sección activa se mantiene a la vista.
 */
function TopNav({ label, active, children }: { label: string; active: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const b = nav?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!nav || !b || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
  }, [active]);
  return <nav ref={ref} className="top-nav" aria-label={label}>{children}</nav>;
}

function Mechanics({ open }: { open: (k: Kind) => void }) {
  const [active, setActive] = useSpy(MECH.map((m) => m[0]));
  return (
    <div className="guide one">
      <TopNav label="Mecánicas" active={active}>
        {MECH.map(([id, label]) => <button key={id} data-id={id} className={active === id ? 'on' : ''} onClick={() => goTo(id, setActive)}>{label}</button>)}
      </TopNav>
      <section id="m-cartas">
        <h2>Cartas</h2>
        <p>Se dividen en 3 tipos según el color: <b>básicas</b> (amarillas, moradas y verdes), <b>incoloras</b> (grises) y <b>míticas</b> (blancas y negras). Cada carta posee un <u>Atributo</u> que le otorga efectos especiales; se encuentra en la esquina superior derecha.</p>
        <Fig items={[{ k: 'codicia', c: 'a', label: 'Básica' }, { k: 'codicia', c: 'm', label: 'Básica' }, { k: 'codicia', c: 'v', label: 'Básica' }, '·', { k: 'reflejo', label: 'Incolora' }, '·', { k: 'antitodo', label: 'Mítica' }, { k: 'maldicion', label: 'Mítica' }]} />
      </section>
      <section id="m-jerarquia">
        <h2>Jerarquía</h2>
        <p>Las cartas tienen un valor dentro de la partida. A medida que aumenta, mejoran sus efectos y su importancia: <b>I</b> es el valor más bajo y <b>Diamante</b> el más alto. La Jerarquía está en la esquina inferior izquierda de la carta. Las Gemas no tienen valor.</p>
        <div className="ranks">
          <span><RankIcon rank={1} size={38} />I</span><span><RankIcon rank={2} size={38} />II</span><span><RankIcon rank={3} size={38} />III</span>
          <span><RankIcon rank={4} size={38} />Diamante</span><span><RankIcon rank={4} dark size={38} />Diamante</span>
        </div>
        <Fig items={[{ k: 'codicia', c: 'v', label: 'I' }, { k: 'purga', label: 'II' }, { k: 'travesura', c: 'v', label: 'III' }, { k: 'antitodo', label: '◆ Diamante' }]} caption="Codicia e Imán se llevan tu carta de mayor Jerarquía; si hay empate, eliges tú cuál entregas." />
      </section>
      <section id="m-duplicar">
        <h2>Duplicar</h2>
        <p>Si un jugador tiene una carta idéntica (<b>mismo símbolo</b> y <b>mismo color</b>) a la carta a encadenar, podrá echarla en cualquier momento de la partida, aunque no sea su turno y sin alterarlo. Solo se puede duplicar antes de que se ponga otra carta en juego que lo impida.</p>
        <p>En <b>tu propio turno</b>, duplicar no lo gasta: después puedes encadenar otra carta, robar o terminar tu turno.</p>
        <Fig items={[{ k: 'mutis', c: 'v', label: 'En la Pila' }, '←', { k: 'mutis', c: 'v', label: 'Mismo color y símbolo', ok: true }, { k: 'mutis', c: 'm', label: 'Distinto color', ok: false }]} caption="Duplicar una Travesura mientras está en juego acumula su efecto. Un Aplastar solo se duplica cuando el anterior ha acabado: es otra ronda completa. Duplicar un Entorno lo revierte." />
      </section>
      <section id="m-tinte">
        <h2>Tinte</h2>
        <p>Tras el uso de <b>cartas incoloras</b>, el jugador elegirá el color de la próxima carta sin alterar el orden de la partida. Aquel que use la última carta incolora elegirá el color, incluso sin ser su turno.</p>
        <Fig items={[{ k: 'travesura', c: 'a', label: 'Jugador 1' }, '→', { k: 'reflejo', label: 'Jugador 2' }, '→', { k: 'egida', label: 'Jugador 1' }]} caption="El Jugador 1 elige el siguiente color al echar la última carta incolora." />
      </section>
      <section id="m-gemas">
        <h2>Gemas</h2>
        <p>Cartas básicas que no tienen ningún efecto. Hay 4 tipos. No tienen valor en la Jerarquía ni poseen Atributo.</p>
        <Fig items={[{ k: 'gema1', c: 'a', label: 'Gema I · 12' }, { k: 'gema2', c: 'v', label: 'Gema II · 9' }, { k: 'gema3', c: 'm', label: 'Gema III · 6' }, { k: 'gematri', label: 'Tricolor · 3' }]} caption="Gema Tricolor: tras echarse en la Pila, todos los jugadores pueden descartar las Gemas que deseen." />
      </section>
      <section id="m-atributos">
        <h2>Atributos</h2>
        <div className="attrs">
          {CATS.filter((a) => a !== 'gema').map((a) => (
            <div key={a} className="attr-row">
              <AttrIcon attr={a} size={34} />
              <div>
                <h3>{ATTR_NAME[a]}</h3>
                <p>{ATTR_HELP[a]}</p>
              </div>
              <div className="attr-cards">
                {entries(a).map((k) => <button key={k} onClick={() => open(k)} title={`Ver ${nameOf(k)}`}><img src={pic(k)} alt={nameOf(k)} /></button>)}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section id="m-reflejar">
        <h2>Al reflejar una Magia…</h2>
        <p>El efecto de una Magia puede dirigirse a cualquier jugador. Al reflejarla, su efecto varía y se refleja a <b>todos</b> los jugadores.</p>
        <div className="refl-grid">
          {(['codicia', 'purga', 'iman', 'escarcha'] as Kind[]).map((k) => (
            <button key={k} onClick={() => open(k)}>
              <img src={pic(k)} alt="" />
              <span><b>{KINDS[k].name} reflejad{k === 'iman' ? 'o' : 'a'}{BETA.includes(k) && <i className="beta">Beta</i>}</b>{HELP[k].reflejada}</span>
            </button>
          ))}
        </div>
      </section>
      <section id="m-entorno">
        <h2>Entorno maldito</h2>
        <p>Las cartas de Entorno activan una regla temporal que afecta a toda la mesa y no se puede defender ni evitar. Al usar una, se da la vuelta a su Indicador. Si hay <b>2 o más Indicadores activos</b>, se gira también el central y se crea un Entorno maldito: quien encadene su última carta no gana la partida y roba 1.</p>
        <div className="tri-pair">
          <figure><Triforce className="g-tri" on={['mutis']} /><figcaption>Mutis activo</figcaption></figure>
          <figure><Triforce className="g-tri" on={['mutis', 'tinieblas']} /><figcaption>Entorno maldito</figcaption></figure>
        </div>
      </section>
    </div>
  );
}

function CardsTab({ kind, setKind }: { kind: Kind; setKind: (k: Kind) => void }) {
  const [filter, setFilter] = useState<Filter>({ t: 'all' });
  const list = ALL.filter((k) => passes(filter, k));
  const mid = (list.length - 1) / 2;
  const ov = list.length <= 8 ? -0.08 : list.length <= 12 ? -0.34 : -0.5;
  // Si las cartas no caben en la pantalla, al acercar el ratón a un lateral la fila se desplaza sola hacia ese lado.
  const handRef = useRef<HTMLDivElement>(null);
  const speed = useRef(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (speed.current && handRef.current) handRef.current.scrollLeft += speed.current;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // La fila deja pasar los clics por su zona vacía, así que el ratón se sigue en toda la ventana.
    const move = (e: MouseEvent) => {
      const el = handRef.current;
      if (!el || el.scrollWidth <= el.clientWidth) return void (speed.current = 0);
      const r = el.getBoundingClientRect();
      const inside = e.clientY >= r.top + r.height * 0.3 && e.clientY <= r.bottom;
      const EDGE = 110;
      const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
      speed.current = !inside ? 0 : x < EDGE ? -12 * (1 - x / EDGE) : x > r.width - EDGE ? 12 * (1 - (r.width - x) / EDGE) : 0;
    };
    window.addEventListener('mousemove', move);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('mousemove', move); };
  }, []);
  useEffect(() => {
    handRef.current?.querySelector('button.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [kind]);
  const zoom = list.length <= 4 ? 1.25 : list.length <= 8 ? 1.15 : 1.05;
  const pickFilter = (f: Filter) => {
    setFilter(f);
    const l = ALL.filter((k) => passes(f, k));
    if (l.length && !l.includes(kind)) setKind(l[0]);
  };
  const F = (f: Filter, label: React.ReactNode, key: string) => (
    <button key={key} className={same(filter, f) ? 'on' : ''} onClick={() => pickFilter(f)}>{label}</button>
  );
  return (
    // --ch (alto de referencia de las cartas de abajo) lo usan la fila y el hueco que le guarda sitio.
    <div className="cards-tab" style={{ '--ch': `clamp(${62 * zoom}px, ${6.4 * zoom}vw, ${118 * zoom}px)` } as React.CSSProperties}>
      <nav className="attr-nav" aria-label="Filtrar cartas">
        {F({ t: 'all' }, 'Todas', 'all')}
        <i className="sep" />
        {CATS.map((a) => F({ t: 'attr', a }, <><AttrIcon attr={a} size={20} />{ATTR_NAME[a]}</>, a))}
        <i className="sep" />
        {RANKS.map(([r, label]) => F({ t: 'rank', r }, <>{r > 0 && <RankIcon rank={r} size={18} />}{label}</>, `r${r}`))}
        <i className="sep" />
        {F({ t: 'beta' }, <>Arcanas <i className="beta">Beta</i></>, 'beta')}
      </nav>
      <main className="card-main">
        <RotCard kind={kind} className="big" />
        <KindInfo kind={kind} full />
        <Demo kind={kind} />
      </main>
      {/* Hueco que ocupa la fila de cartas; la fila va encima, en absoluto, con sitio de sobra para que la carta elegida suba sin cortarse */}
      <div className="comp-hand-space" aria-hidden="true" />
      {/* Con pocas cartas en el filtro, se ven más grandes y menos solapadas */}
      <div className="comp-hand" aria-label="Cartas" ref={handRef} style={{ '--ov': ov } as React.CSSProperties}>
        {list.map((k, i) => {
          const first = i > 0 && KINDS[k].attr !== KINDS[list[i - 1]].attr;
          return (
            <button
              key={k}
              className={`${k === kind ? 'on' : ''} same ${first ? 'first' : ''}`}
              style={{ '--r': `${(i - mid) * Math.min(1.1, 24 / list.length)}deg`, '--y': `${Math.abs(i - mid) ** 1.6 * 0.3}px` } as React.CSSProperties}
              onClick={() => setKind(k)}
              title={nameOf(k)}
            >
              <img src={pic(k)} alt={nameOf(k)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Todas las cartas colocadas por su Jerarquía, de la más alta a la más baja. */
function Hierarchy({ open }: { open: (k: Kind) => void }) {
  const [active, setActive] = useSpy(RANKS.map(([r]) => `h-${r}`));
  return (
    <div className="guide one hier">
      <TopNav label="Niveles de Jerarquía" active={active}>
        {RANKS.map(([r, label]) => (
          <button key={r} data-id={`h-${r}`} className={active === `h-${r}` ? 'on' : ''} onClick={() => goTo(`h-${r}`, setActive)}>
            {r > 0 && <RankIcon rank={r} size={18} />}{r > 0 ? label : 'Sin Jerarquía'}
          </button>
        ))}
      </TopNav>
      <section>
        <h2>Jerarquía</h2>
        <p>Las cartas tienen un valor dentro de la partida que corresponde con su Jerarquía. A medida que aumenta, mejoran sus efectos y su importancia: <b>I</b> es el valor más bajo y <b>Diamante</b> el más alto. Se encuentra en la esquina inferior izquierda de la carta.</p>
        <p>Codicia e Imán se llevan la carta de mayor Jerarquía; si hay empate, elige quien la entrega. Las Gemas no tienen valor en la Jerarquía.</p>
      </section>
      {RANKS.map(([r, label]) => {
        // Aquí sí van todas las cartas por separado (Gema I, II, III, cada Ritual…), y las beta siempre al final.
        const all = CATS.flatMap(kindsOf).filter((k) => KINDS[k].rank === r);
        const cards = [...all.filter((k) => !BETA.includes(k)), ...all.filter((k) => BETA.includes(k))];
        return (
          <section key={r} id={`h-${r}`} className="hier-row">
            <div className="hier-head">
              <h3>{r > 0 ? `Jerarquía ${label}` : label}</h3>
              {r > 0 && <span className="hier-icons"><RankIcon rank={r} size={30} />{r === 4 && <RankIcon rank={4} dark size={30} />}</span>}
            </div>
            <div className="hier-cards">
              {cards.map((k) => (
                <button key={k} onClick={() => open(repOf(k))} title={`Ver ${KINDS[k].name}`}>
                  <img src={pic(k)} alt={KINDS[k].name} />
                  <small>{KINDS[k].name}{BETA.includes(k) && <i className="beta">Beta</i>}</small>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function Compendium({ start, tab: tab0, onClose }: { start?: Kind; tab?: CompTab; onClose: () => void }) {
  const [tab, setTab] = useState<CompTab>(tab0 ?? 'cartas');
  const [kind, setKind] = useState<Kind>(repOf(start ?? 'travesura'));
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [tab]);
  return (
    <div className="page comp">
      <header>
        <button onClick={onClose}>← Volver</button>
        <h1>Compendio</h1>
        <div className="tabs">
          {TABS.map(([t, label]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{label}</button>)}
        </div>
      </header>
      {tab === 'cartas' ? <CardsTab kind={kind} setKind={setKind} /> : (
        <div className="guide-scroll" ref={body}>
          {tab === 'jugar' ? <HowTo /> : tab === 'jerarquia' ? <Hierarchy open={(k) => { setKind(k); setTab('cartas'); }} /> : <Mechanics open={(k) => { setKind(k); setTab('cartas'); }} />}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── ayuda rápida (esquina inferior derecha) ─────────────────────────

/**
 * Ayuda de cartas (esquina inferior derecha). Tiene un tamaño fijo y cuatro vistas:
 * el menú de Atributos, las cartas de un Atributo, la ficha resumida de una carta (al pasar el ratón por una carta
 * boca arriba o pulsar su «?»; se queda hasta que se mira otra) y, con «Ver más», la explicación completa en grande.
 * `ping` cambia cada vez que se pulsa un «?»: entonces se abre aunque estuviera cerrada.
 */
export function HelpDock({ kind, art, ping = 0, setKind, beta = true }: { kind: Kind | null; art?: string; ping?: number; setKind: (k: Kind | null) => void; beta?: boolean }) {
  const [cat, setCat] = useState<Attr | null>(null);
  const [card, setCard] = useState<Kind | null>(null);
  /** Imagen de la carta concreta que se está mirando (con su color). */
  const [cardArt, setCardArt] = useState<string | undefined>();
  const [more, setMore] = useState<Kind | null>(null);
  const [open, setOpen] = useState(() => window.innerWidth >= 1000);
  const list = useRef<HTMLDivElement>(null);
  const lastPing = useRef(ping);
  useEffect(() => {
    if (!kind) return;
    const asked = ping !== lastPing.current;
    lastPing.current = ping;
    if (asked) setOpen(true);
    // Mientras se lee la explicación completa, pasar el ratón por otras cartas no la cambia.
    if (more && !asked) return;
    setMore(null);
    setCard(repOf(kind));
    setCardArt(art);
    setCat(KINDS[kind].attr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, art, ping]);
  useEffect(() => {
    if (!kind || !cat || card || more) return;
    // Solo se desplaza la lista (scrollIntoView también movería la mesa que hay detrás).
    const box = list.current;
    const el = box?.querySelector<HTMLElement>(`[data-kind="${repOf(kind)}"]`);
    if (box && el) box.scrollTop = el.offsetTop - box.offsetTop - 8;
  }, [kind, cat, card, more]);
  if (!open) return <button className="dock-tab" onClick={() => setOpen(true)}>? Ayuda</button>;
  const menu = () => { setMore(null); setCard(null); setCat(null); setKind(null); };
  const back = () => { if (more) setMore(null); else if (card) setCard(null); else menu(); };
  const title = more ? nameOf(more) : card ? nameOf(card) : cat ? <><AttrIcon attr={cat} size={18} /> {ATTR_NAME[cat]}</> : 'Ayuda de cartas';
  return (
    <aside className={`dock ${more ? 'big' : ''}`}>
      <div className="dock-bar">
        {(more || card || cat) && <button onClick={back} aria-label="Atrás" title="Atrás">←</button>}
        <b>{title}</b>
        {(more || card || cat) && <button className="dock-menu" onClick={menu} title="Volver al menú de la ayuda">Menú</button>}
        <button onClick={() => { setOpen(false); setMore(null); }} aria-label="Cerrar ayuda">×</button>
      </div>
      {more ? (
        <div className="dock-more">
          <RotCard kind={more} className="dm-card" />
          <KindInfo kind={more} full />
          <Demo kind={more} />
        </div>
      ) : card ? (
        <div className="dock-peek">
          <img src={cardArt ?? pic(card)} alt={nameOf(card)} />
          <div>
            {/* Etiquetas: atributo y Jerarquía (solo si la tiene). */}
            <span className="dp-tags">
              <span className="dp-tag"><AttrIcon attr={KINDS[card].attr} size={15} />{ATTR_NAME[KINDS[card].attr]}</span>
              {KINDS[card].rank > 0 && (
                <span className="dp-tag"><RankIcon rank={KINDS[card].rank} dark={KINDS[card].attr === 'maldita'} size={14} />{KINDS[card].rank >= 4 ? 'Diamante' : `Jerarquía ${['', 'I', 'II', 'III'][KINDS[card].rank]}`}</span>
              )}
              {BETA.includes(card) && <i className="beta">Beta</i>}
            </span>
            <p>{HELP[card].text}</p>
            {HELP[card].reflejada && <p className="refl"><b>Reflejada:</b> {HELP[card].reflejada}</p>}
          </div>
          <button className="dp-more" onClick={() => setMore(card)}>Ver más</button>
        </div>
      ) : cat ? (
        <div className="dock-list" ref={list}>
          <p className="dock-note">{ATTR_HELP[cat]}</p>
          {entries(cat).filter((k) => beta || !BETA.includes(k)).map((k) => (
            <div key={k} data-kind={k} className={`dock-card ${kind && k === repOf(kind) ? 'on' : ''}`}>
              <img className="dc-art" src={pic(k)} alt="" />
              <div>
                <b>{nameOf(k)}{BETA.includes(k) && <i className="beta">Beta</i>}{KINDS[k].rank > 0 && <i><RankIcon rank={KINDS[k].rank} dark={KINDS[k].attr === 'maldita'} size={18} /></i>}</b>
                <p>{HELP[k].text}</p>
                {HELP[k].reflejada && <p className="refl"><b>Reflejada:</b> {HELP[k].reflejada}</p>}
              </div>
              <button onClick={() => setMore(k)} aria-label={`Ver más sobre ${nameOf(k)}`}>Ver más</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="dock-cats">
          {CATS.map((a) => <button key={a} onClick={() => setCat(a)}><AttrIcon attr={a} size={24} />{ATTR_NAME[a]}</button>)}
        </div>
      )}
    </aside>
  );
}

/**
 * Botón «Compendio» de los paneles de la portada, la partida local, la entrada online y la sala de espera.
 * Se abre por encima de todo; si la partida empieza mientras está abierto, se cierra solo (el panel desaparece).
 */
export function CompendioButton({ icon = false }: { icon?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {icon
        ? <button className="tool-btn" onClick={() => setOpen(true)} title="Compendio: reglas y cartas" aria-label="Compendio">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
          </button>
        : <button onClick={() => setOpen(true)}>Compendio</button>}
      {/* En el body: el panel tiene backdrop-filter y no dejaría salir un position: fixed. */}
      {open && createPortal(<div className="home-page home-overlay"><Compendium tab="cartas" onClose={() => setOpen(false)} /></div>, document.body)}
    </>
  );
}
