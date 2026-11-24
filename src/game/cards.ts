// Definición de cartas de Maldiciones (reglas V7.0.1, 103 cartas).

export type Color = 'a' | 'm' | 'v'; // amarillo, morado, verde
export const COLORS: Color[] = ['a', 'm', 'v'];
export const COLOR_NAME: Record<Color, string> = { a: 'Amarillo', m: 'Morado', v: 'Verde' };

export type Kind =
  | 'gema1' | 'gema2' | 'gema3' | 'gematri'
  | 'aplastar' | 'cristalizar' | 'travesura'
  | 'egida' | 'reflejo'
  | 'codicia' | 'purga' | 'iman'
  | 'adivinar' | 'recuperar' | 'predestinar'
  | 'mutis' | 'inutilizar' | 'tinieblas'
  | 'antitodo' | 'maldicion' | 'condena'
  // Cartas beta de V7 (Arcanas): solo entran si se activan al configurar la partida.
  | 'escarcha' | 'rafaga' | 'trastada' | 'ritual1' | 'ritual2' | 'ritual3';

export const BETA: Kind[] = ['escarcha', 'rafaga', 'trastada', 'ritual1', 'ritual2', 'ritual3'];
export const RITUALS: Kind[] = ['ritual1', 'ritual2', 'ritual3'];

export type Attr = 'gema' | 'ataque' | 'defensa' | 'magia' | 'apoyo' | 'entorno' | 'sagrada' | 'maldita';

export interface Card {
  id: string;
  kind: Kind;
  /** Color de la carta; null = incolora o mítica. */
  color: Color | null;
  /** Solo Cristalizar: color del cristal (la carta es incolora). */
  tone?: Color;
}

export interface KindInfo {
  name: string;
  attr: Attr;
  /** Jerarquía: 0 gemas, 1-3 (I-III), 4 míticas (diamante). */
  rank: number;
  desc: string;
}

export const KINDS: Record<Kind, KindInfo> = {
  gema1: { name: 'Gema I', attr: 'gema', rank: 0, desc: 'Sin efecto.' },
  gema2: { name: 'Gema II', attr: 'gema', rank: 0, desc: 'Sin efecto.' },
  gema3: { name: 'Gema III', attr: 'gema', rank: 0, desc: 'Sin efecto.' },
  gematri: { name: 'Gema Tricolor', attr: 'gema', rank: 0, desc: 'Incolora. Al echarla, todos los jugadores pueden descartar las Gemas que deseen.' },
  aplastar: { name: 'Aplastar', attr: 'ataque', rank: 1, desc: 'El resto pone la mano en la Pila: el último roba 3. Descarta las Égidas boca arriba.' },
  cristalizar: { name: 'Cristalizar', attr: 'ataque', rank: 2, desc: 'Los oponentes roban 3 salvo que jueguen una Gema del color del cristal, una Gema Tricolor o una Égida. No se puede reflejar.' },
  travesura: { name: 'Travesura', attr: 'ataque', rank: 3, desc: 'El siguiente jugador recibe 1 carta tuya y roba 2. Se puede encadenar con otra Travesura acumulando el efecto.' },
  egida: { name: 'Égida', attr: 'defensa', rank: 2, desc: 'Protege de un Ataque, Magia o Reflejo. 2 usos: tras el primero queda boca arriba.' },
  reflejo: { name: 'Reflejo', attr: 'defensa', rank: 3, desc: 'Refleja el último Ataque a un jugador a elegir, o la última Magia a todos. Cambia el sentido de la partida.' },
  codicia: { name: 'Codicia', attr: 'magia', rank: 1, desc: 'Elige un oponente: te da su carta de mayor Jerarquía y tú le das la que quieras.' },
  purga: { name: 'Purga', attr: 'magia', rank: 2, desc: 'Elige un jugador (puedes ser tú): descarta su mano y roba tantas cartas como tuviese.' },
  iman: { name: 'Imán', attr: 'magia', rank: 3, desc: 'Atrae la mejor carta y todas las Gemas de cada oponente. Quédate hasta 3, devuelve hasta 3 por jugador o elimínalas.' },
  adivinar: { name: 'Adivinar', attr: 'apoyo', rank: 1, desc: 'Mira las 3 siguientes cartas del Mazo: reordénalas, quédatelas o descártalas.' },
  recuperar: { name: 'Recuperar', attr: 'apoyo', rank: 2, desc: 'Recupera una carta de la Pila. Quédatela o dásela a otro jugador.' },
  predestinar: { name: 'Predestinar', attr: 'apoyo', rank: 3, desc: 'Se juega junto a otra carta: diriges su efecto a un jugador a elegir y le concedes el turno.' },
  mutis: { name: 'Mutis', attr: 'entorno', rank: 1, desc: 'Silencio: no se anuncian las cartas. Acaba con otro Mutis o Antitodo.' },
  inutilizar: { name: 'Inutilizar', attr: 'entorno', rank: 2, desc: 'Las cartas de color pierden su efecto. Acaba con otro Inutilizar o Antitodo.' },
  tinieblas: { name: 'Tinieblas', attr: 'entorno', rank: 3, desc: 'Todos juegan con las cartas boca abajo durante 3 turnos del lanzador. Jugar a ciegas o robar 3.' },
  antitodo: { name: 'Antitodo', attr: 'sagrada', rank: 4, desc: 'Se juega en cualquier momento. Anula lo que vaya contra ti, reinicia los Entornos y elimina las Égidas boca arriba. Junto a una Maldición, la elimina.' },
  maldicion: { name: 'Maldición', attr: 'maldita', rank: 4, desc: 'No se puede encadenar. Deshazte de ella con otras cartas o junto a un Antitodo.' },
  condena: { name: 'Condena', attr: 'maldita', rank: 4, desc: 'Al inicio de tu turno debes buscar una Maldición (Mazo, Pila o un oponente). Si fallas, pierdes el turno.' },
  escarcha: { name: 'Escarcha', attr: 'magia', rank: 4, desc: 'Congela el tiempo: ves las manos de los oponentes y puedes cambiar sus cartas de una mano a otra (cada uno conserva cuántas tiene). Además, si quieres, das 1 carta tuya.' },
  rafaga: { name: 'Ráfaga', attr: 'apoyo', rank: 4, desc: 'Juegas las 5 siguientes cartas del Mazo y 1 tuya, con sus efectos, contra quien quieras. Las que no quieras jugar se descartan.' },
  trastada: { name: 'Trastada', attr: 'ataque', rank: 4, desc: 'Como Travesura, más fuerte: el siguiente jugador recibe 2 cartas tuyas y roba 3. Se encadena con Travesuras y Trastadas.' },
  ritual1: { name: 'Ritual I', attr: 'gema', rank: 0, desc: 'Sin efecto. Quien tenga a la vez en la mano los 3 Rituales gana la partida.' },
  ritual2: { name: 'Ritual II', attr: 'gema', rank: 0, desc: 'Sin efecto. Quien tenga a la vez en la mano los 3 Rituales gana la partida.' },
  ritual3: { name: 'Ritual III', attr: 'gema', rank: 0, desc: 'Sin efecto. Quien tenga a la vez en la mano los 3 Rituales gana la partida.' },
};

export const ATTR_NAME: Record<Attr, string> = {
  gema: 'Gema', ataque: 'Ataque', defensa: 'Defensa', magia: 'Magia', apoyo: 'Apoyo', entorno: 'Entorno', sagrada: 'Sagrada', maldita: 'Maldita',
};

export const isGem = (c: Card) => KINDS[c.kind].attr === 'gema';
export const isPlainGem = (c: Card) => c.kind === 'gema1' || c.kind === 'gema2' || c.kind === 'gema3';
export const isCursed = (c: Card) => KINDS[c.kind].attr === 'maldita';
export const rankOf = (c: Card) => KINDS[c.kind].rank;

export function cardName(c: Card): string {
  const base = KINDS[c.kind].name;
  if (c.kind === 'cristalizar' && c.tone) return `${base} ${COLOR_NAME[c.tone]}`;
  if (c.kind === 'travesura' && !c.color) return `${base} Incolora`;
  return c.color ? `${base} ${COLOR_NAME[c.color]}` : base;
}

/** Ruta de la imagen (arte V6; sustituir los .webp de public/cards para actualizar). */
export function cardImage(c: Card): string {
  const base = 'cards/';
  if (c.kind === 'cristalizar') return `${base}cristalizar-${c.tone}.webp`;
  if (c.kind === 'travesura' && !c.color) return `${base}travesura-n.webp`;
  return c.color ? `${base}${c.kind}-${c.color}.webp` : `${base}${c.kind}.webp`;
}

/**
 * Cartas del Mazo que se pueden configurar («Partida personalizada»): cuántas hay de cada una. Las de color se reparten
 * entre los 3 colores (con «Color único», todas de ese color); Cristalizar, igual con el color del cristal. La Travesura
 * incolora va aparte. La Condena y las beta se activan con sus casillas; las Maldiciones no se configuran.
 */
export type DeckKey =
  | 'gema1' | 'gema2' | 'gema3' | 'gematri' | 'aplastar' | 'cristalizar' | 'travesura' | 'travesuraN'
  | 'egida' | 'reflejo' | 'codicia' | 'purga' | 'iman' | 'adivinar' | 'recuperar' | 'predestinar'
  | 'mutis' | 'inutilizar' | 'tinieblas' | 'antitodo'
  | 'escarcha' | 'rafaga' | 'trastada' | 'ritual1' | 'ritual2' | 'ritual3';

export interface DeckEntry { key: DeckKey; kind: Kind; colored: boolean; count: number; beta?: boolean }

/** Mazo normal (reglamento V7.0.1), en el orden de la Jerarquía de atributos. */
export const DECK_BASE: DeckEntry[] = [
  { key: 'gema1', kind: 'gema1', colored: true, count: 12 },
  { key: 'gema2', kind: 'gema2', colored: true, count: 9 },
  { key: 'gema3', kind: 'gema3', colored: true, count: 6 },
  { key: 'gematri', kind: 'gematri', colored: false, count: 3 },
  { key: 'aplastar', kind: 'aplastar', colored: true, count: 6 },
  { key: 'cristalizar', kind: 'cristalizar', colored: true, count: 3 },
  { key: 'travesura', kind: 'travesura', colored: true, count: 6 },
  { key: 'travesuraN', kind: 'travesura', colored: false, count: 3 },
  { key: 'egida', kind: 'egida', colored: false, count: 3 },
  { key: 'reflejo', kind: 'reflejo', colored: false, count: 6 },
  { key: 'codicia', kind: 'codicia', colored: true, count: 6 },
  { key: 'purga', kind: 'purga', colored: false, count: 3 },
  { key: 'iman', kind: 'iman', colored: false, count: 3 },
  { key: 'adivinar', kind: 'adivinar', colored: true, count: 6 },
  { key: 'recuperar', kind: 'recuperar', colored: false, count: 3 },
  { key: 'predestinar', kind: 'predestinar', colored: false, count: 3 },
  { key: 'mutis', kind: 'mutis', colored: true, count: 6 },
  { key: 'inutilizar', kind: 'inutilizar', colored: false, count: 3 },
  { key: 'tinieblas', kind: 'tinieblas', colored: false, count: 3 },
  { key: 'antitodo', kind: 'antitodo', colored: false, count: 3 },
  ...(['escarcha', 'rafaga', 'trastada', 'ritual1', 'ritual2', 'ritual3'] as const).map((k) => ({ key: k, kind: k, colored: false, count: 1, beta: true })),
];
/** Máximo de copias de una carta en un Mazo personalizado. */
export const DECK_MAX = 15;
/** Mínimo de cartas del Mazo (para repartir 6 a cada uno con 6 jugadores y que quede Mazo): si falta, se completa con Gemas I. */
export const DECK_MIN = 45;
/** Cartas con las que deshacerse de una Maldición (sin ninguna, nadie podría ganar). */
export const CURSE_OUT: Kind[] = ['antitodo', 'travesura', 'trastada', 'codicia', 'iman', 'recuperar', 'predestinar'];

/** Cartas iniciales (además de la Maldición): normal, mínimo y máximo. */
export const HAND = 6, HAND_MIN = 3, HAND_MAX = 10;
/** Mínimo del Mazo según las cartas iniciales: repartir a 6 jugadores y que aún quede Mazo. */
export const deckMin = (hand = HAND) => Math.max(DECK_MIN, 6 * hand + 9);
/** Cartas iniciales válidas (las que no lo sean, las normales). */
export const handSize = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= HAND_MIN && n <= HAND_MAX ? n : HAND);

/** Mazo al azar: de cada carta, entre ninguna y el doble de las normales (máx. 15). */
export function randomCounts(rnd: () => number = Math.random): DeckCounts {
  const out: DeckCounts = {};
  for (const e of DECK_BASE) out[e.key] = Math.min(DECK_MAX, Math.floor(rnd() * (e.beta ? 3 : 2 * e.count + 1)));
  return out;
}

export type DeckCounts = Partial<Record<DeckKey, number>>;

/** Cuántas hay de una carta: la elegida (válida) o la del Mazo normal. */
export function deckCount(e: DeckEntry, counts?: DeckCounts | null): number {
  const n = counts?.[e.key];
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= DECK_MAX ? n : e.count;
}

/** Deja solo las cantidades válidas y distintas de las del Mazo normal (null si no queda ninguna). */
export function cleanCounts(c: unknown): DeckCounts | null {
  if (!c || typeof c !== 'object') return null;
  const out: DeckCounts = {};
  for (const e of DECK_BASE) {
    const n = (c as Record<string, unknown>)[e.key];
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= DECK_MAX && n !== e.count) out[e.key] = n;
  }
  return Object.keys(out).length ? out : null;
}

export interface DeckOptions {
  beta?: boolean;
  /** Color único: todas las cartas de color (y los cristales) son de este color. */
  mono?: Color | null;
  counts?: DeckCounts | null;
  /** Cartas iniciales de cada jugador (para el mínimo del Mazo). */
  hand?: number;
}

/** Mazo de la partida. Las Maldiciones se devuelven aparte. */
export function buildDeck(o: DeckOptions = {}): { deck: Card[]; curses: Card[] } {
  const deck: Card[] = [];
  let n = 0;
  const add = (kind: Kind, color: Color | null, count: number, tone?: Color) => {
    for (let i = 0; i < count; i++) deck.push({ id: `c${n++}`, kind, color, ...(tone ? { tone } : {}) });
  };
  const used = DECK_BASE.filter((e) => !e.beta || o.beta);
  // De color: repartidas entre los colores (las que no salen exactas, a los primeros); con color único, todas de ese.
  COLORS.forEach((c, ci) => {
    for (const e of used) {
      if (!e.colored) continue;
      const total = deckCount(e, o.counts);
      const k = o.mono ? (c === o.mono ? total : 0) : Math.floor(total / 3) + (ci < total % 3 ? 1 : 0);
      if (e.kind === 'cristalizar') add('cristalizar', null, k, c);
      else add(e.kind, c, k);
    }
  });
  for (const e of used) if (!e.colored) add(e.kind, null, deckCount(e, o.counts));
  add('condena', null, 1);
  // Sin cartas para deshacerse de la Maldición nadie podría ganar: entran los 3 Antitodos.
  if (!deck.some((c) => CURSE_OUT.includes(c.kind))) add('antitodo', null, 3);
  // Mazo personalizado demasiado corto o sin cartas de color (la primera de la Pila tiene que serlo): se completa con Gemas I.
  let i = 0;
  while (deck.length < deckMin(handSize(o.hand)) || !deck.some((c) => c.color)) add('gema1', o.mono ?? COLORS[i++ % 3], 1);
  const curses: Card[] = [];
  for (let i = 0; i < 6; i++) curses.push({ id: `c${n++}`, kind: 'maldicion', color: null });
  return { deck, curses };
}

/** Mini ayuda, con el texto resumido de las chuletas. */
export const HELP: Record<Kind, { text: string; reflejada?: string }> = {
  gema1: { text: 'Sin efecto. Sirve para encadenar por color o símbolo.' },
  gema2: { text: 'Sin efecto. Sirve para encadenar por color o símbolo.' },
  gema3: { text: 'Sin efecto. Sirve para encadenar por color o símbolo.' },
  gematri: { text: 'Incolora. Tras echarla, todos pueden descartar las Gemas que deseen.' },
  aplastar: { text: 'Todos los jugadores ponen las manos, el último coge 3. Elimina Égidas boca arriba.' },
  cristalizar: { text: 'Todos roban 3. Evita con Gema del color, Gema Tricolor o Égida. NO se puede reflejar.' },
  travesura: { text: 'El siguiente jugador recibe 1 de tus cartas y roba 2. Se encadena con otras Travesuras.' },
  egida: { text: 'Protege al portador contra Magias, Ataques y Reflejos. 2 usos; tras el primero permanece boca arriba.' },
  reflejo: { text: 'Refleja el último efecto de Magia o Ataque. 1 uso. Pueden reflejarse efectos propios u otros Reflejos. Cambia el sentido de la partida.' },
  codicia: { text: 'Te da su mejor carta y tú le das la que quieras.', reflejada: 'Todos cambian la mano con el jugador de al lado.' },
  purga: { text: 'Elimina la mano y roba tantas cartas como tuviese.', reflejada: 'Todos eliminan su mano y roban nueva mano.' },
  iman: { text: 'Todos dan su mejor carta y Gemas. El lanzador las redistribuye hasta 3 por cada jugador.', reflejada: 'Todos dan sus 3 mejores y Gemas. El lanzador las redistribuye hasta 3 por cada jugador.' },
  adivinar: { text: 'Ve, coge, altera o descarta las 3 primeras cartas del Mazo.' },
  recuperar: { text: 'Recupera 1 carta de la Pila. Se puede guardar o dar.' },
  predestinar: { text: 'Dirige el efecto de 1 carta de la mano y concede el turno.' },
  mutis: { text: 'Silencia a todo el grupo.' },
  inutilizar: { text: 'Las cartas de color pierden su efecto.' },
  tinieblas: { text: 'Todos los jugadores juegan con sus cartas boca abajo durante 3 turnos.' },
  antitodo: { text: 'Elimina cualquier efecto en la partida. Defiende al usuario de toda acción. No puede ser evitada. Reinicia los Indicadores de Entorno y elimina las cartas boca arriba.' },
  maldicion: { text: 'Cada jugador empieza con una. No se puede jugar sola. Se elimina junto a un Antitodo.' },
  condena: { text: 'Al inicio de cada turno busca y quédate con una Maldición; si no, pierdes el turno. Con todas, quedas absuelto. NO se elimina con Antitodo.' },
  escarcha: { text: 'Congela el tiempo: mueve las cartas de los oponentes entre sus manos y, si quieres, da 1 tuya.', reflejada: 'Quien la refleja congela el tiempo y reparte él.' },
  rafaga: { text: 'Juega las 5 siguientes cartas del Mazo y 1 tuya, con sus efectos, contra quien quieras. O descártalas.' },
  trastada: { text: 'El siguiente jugador recibe 2 de tus cartas y roba 3. Se encadena con Travesuras.' },
  ritual1: { text: 'Reúne los 3 Rituales en tu mano y ganas la partida.' },
  ritual2: { text: 'Reúne los 3 Rituales en tu mano y ganas la partida.' },
  ritual3: { text: 'Reúne los 3 Rituales en tu mano y ganas la partida.' },
};

export const ATTR_HELP: Record<Attr, string> = {
  gema: 'Carta básica sin Atributo ni valor en la Jerarquía.',
  ataque: 'Al Duplicar una carta de Ataque su efecto se multiplica.',
  defensa: 'Solo se usa contra Magia o Ataque. No se echa por sí sola. Defenderse no altera el turno.',
  magia: 'Puede dirigirse a cualquier jugador. Al reflejarla, su efecto varía y se refleja a todos.',
  apoyo: 'Se puede descartar 1 Gema al encadenarla.',
  entorno: 'Regla temporal para todos. No se puede defender. Con 2 o más activos nadie puede ganar y roba 1.',
  sagrada: 'Se puede jugar en cualquier momento, sin importar el turno.',
  maldita: 'No se puede jugar por sí sola: hay que usar otras cartas para deshacerse de ella.',
};

export const RANK_NAME = ['—', 'I', 'II', 'III', '◆'];
