# Maldiciones · Cómo funcionan las cartas

Reglas tal como las aplica el juego (reglamento V7.0.1). Es la referencia para cambiar una regla: dice qué hace
cada carta y **dónde está en el código**. Si cambias una regla, actualiza también este archivo.

---

## 1. La partida

- **Jugadores:** de 3 a 6 (tú + máquinas, o online con amigos y máquinas para completar).
- **Reparto:** cada jugador empieza con **1 Maldición + 6 cartas** (se puede cambiar en la partida personalizada). La primera carta de la Pila es siempre una carta de
  color (sin efecto). Se sortea quién empieza y en qué sentido se juega (`newGame` en `engine.ts`).
- **Mazo:** 103 cartas en total. Las 6 Maldiciones se reparten aparte; las que sobran solo entran en el Mazo con la opción
  «Maldiciones extra». La Condena solo entra con la opción «Carta Condena». Las Arcanas (beta) solo con «Cartas beta».
- **Partida personalizada** (en «Más opciones»):
  - **Color único:** todas las cartas de color (también el cristal de Cristalizar) son del color elegido. Ese color manda
    siempre y nunca se elige color: las incoloras no piden Tinte (`s.mono`, `paint` en `engine.ts`).
  - **Cartas del Mazo:** cuántas hay de cada carta (de 0 a 15; `DECK_BASE`, `buildDeck` y `counts` en `cards.ts`). Las de
    color se reparten entre los 3 colores; la Travesura incolora va aparte. Las Maldiciones no se configuran, y la
    Condena y las beta siguen con sus casillas. Con menos de 45 cartas (o de 6 × cartas iniciales + 9; `deckMin`), o sin
    ninguna de color, se completa con Gemas I. Sin ninguna carta para deshacerse de la Maldición (`CURSE_OUT`), entran los
    3 Antitodos. El botón «Aleatorio» pone de cada carta entre 0 y el doble de las normales (`randomCounts`).
  - **Cartas iniciales:** de 3 a 10 además de la Maldición (normal 6; `hand` en las opciones, `handSize`).
- **Si se acaba el Mazo:** se baraja la Pila (menos la carta de arriba) y pasa a ser el Mazo.
- **Objetivo:** quedarte sin cartas. Quien echa su última carta **gana en ese momento**, sin que se aplique su efecto
  (`lastCard` / `tryWin`). Excepción: en **Entorno maldito** (2 o más Entornos activos) nadie gana: roba 1 y sigue.
  Otra forma de ganar (beta): tener los **3 Rituales** a la vez en la mano.
- **Imán y manos vacías:** quien se queda sin cartas por un Imán las tiene «retenidas» (`held`) y no gana hasta que acaba el
  reparto; si no le devuelven ninguna, gana.

## 2. El turno

En tu turno haces una de estas cosas:

1. **Encadenar** una carta: tiene que coincidir con la Pila en **color** o en **símbolo** (mismo tipo de carta). Las
   incoloras se pueden echar siempre. Las Malditas y las de Defensa no se pueden echar por sí solas (`isLegal`).
2. **Robar 1.** Si la carta robada se puede encadenar (o acompañar a un Predestinar de tu mano), puedes echarla; si no, o si
   prefieres quedártela, acaba el turno.
3. **Duplicar** (en cualquier momento, aunque no sea tu turno): echar una carta **idéntica** a la de arriba de la Pila (mismo
   tipo y color). Duplicar en tu turno no lo gasta: después puedes encadenar otra o terminar.

Al terminar, el turno pasa al siguiente en el sentido de juego (`finish` → `beginTurn`). El **Reflejo** cambia el sentido.

### Reglas generales

- **Jerarquía:** Gemas sin valor; las demás de I a III; las míticas son ◆ Diamante (`rank` 0–4). Se usa para «tu mejor carta»
  (Codicia, Imán): se entrega la de mayor Jerarquía y, si hay empate, elige su dueño (`tieSplit`).
- **Tinte (elegir color):** quien echa la última carta incolora elige el color que manda, cuando termina la acción en curso
  (`s.tinte`, fase `tinte`). Las cartas de color fijan el color directamente.
- **Apoyo:** al encadenar una carta de Apoyo puedes descartar 1 Gema de tu mano (fase `choose` con `need: 'gem'`).
- **Ataque duplicado:** su efecto se multiplica (Travesura acumula; un Aplastar duplicado es otra ronda completa).
- **Jugar juntas:** se pueden echar a la vez varias copias idénticas. Van todas a la Pila juntas y el efecto se hace **una
  vez**; si son Ataques, se multiplica (`joinable` + `multiplyJoined`). También Antitodo + Maldición juntos.
- **Defenderse no altera el turno.**
- **Entornos (Mutis, Inutilizar, Tinieblas):** reglas temporales para todos, marcadas en la Trifuerza. No se pueden defender.
  Con 2 o más activos hay **Entorno maldito**: nadie puede ganar y quien se quede sin cartas roba 1 (`isCursedEnv`).
- **Antitodo reinicia** los Entornos y elimina las Égidas boca arriba.

### Reacciones (ventana de reacción)

Cuando se lanza un Ataque, una Magia o una entrega, se abre una **ventana de reacción** (fase `react`) para los afectados
(20 s si hay humanos, `WINDOW_MS`). Opciones (`reactOptionsFor`):
- **Égida** (o la Égida boca arriba), **Reflejo**, **Antitodo**;
- **Encadenar** otra Travesura/Trastada (si va contra ti);
- **Gema** del color contra Cristalizar;
- en **Tinieblas**: probar suerte con una carta boca abajo.

Lo gastado al defenderse se apunta en `s.undo`: si alguien usa **Antitodo**, todo vuelve a sus dueños.
Si todos los afectados se protegen, el efecto se acaba ahí. Imán y Codicia aún se pueden parar mientras se resuelven
(antes del intercambio o del reparto).

---

## 3. Las cartas

Columnas: cuántas hay · atributo · Jerarquía. Colores: a = amarillo, m = morado, v = verde.

### Gemas (sin efecto)

| Carta | Cuántas | Notas |
| --- | --- | --- |
| Gema I | 4 por color (12) | Sirve para encadenar por color o símbolo. |
| Gema II | 3 por color (9) | Ídem. |
| Gema III | 2 por color (6) | Ídem. |
| Gema Tricolor | 3, incolora | Al echarla, todos pueden descartar las Gemas que quieran (van debajo de la Pila). Fase `gemas`. Vale contra Cristalizar de cualquier color. |

### Ataque

| Carta | Cuántas · Jerarquía | Efecto | Detalles |
| --- | --- | --- | --- |
| **Aplastar** (arte: «Embestida») | 2 por color · I | Todos menos el lanzador pulsan la mano en la Pila; el último roba 3. Descarta las Égidas boca arriba. | Fase `aplastar`. El robo se puede defender o reflejar. Duplicarlo (solo cuando el anterior acabó) = otra ronda completa (`queue`). Con Inutilizar, el de color saca la mano igual y quien la pulse roba 3 (`fake`). |
| **Cristalizar** | 1 de cada color del cristal · II | Los oponentes roban 3 salvo que dejen una Gema del color del cristal, una Gema Tricolor o una Égida. | La carta es incolora con `tone` (color del cristal). **No se puede reflejar.** Con Antitodo, todos quedan exentos. El lanzador también puede dejar sus Gemas. |
| **Travesura** | 2 por color + 3 incoloras · III | El siguiente recibe 1 carta tuya y roba 2. | Se encadena con otras Travesuras acumulando (1 carta + 2 robos por cada una). Las cartas se eligen y se dan al final (fase `give`). Reflejada: solo cuenta la última de la cadena; no se puede encadenar a un Reflejo. **Turno:** quien encadena pasa el turno (después juega quien la recibe). Reflejada a quien echó la última, el turno es suyo; a otro, juega el siguiente a quien la reflejó en el sentido de antes del Reflejo (`s.after` en el caso `reflejo` de `handleReact`). Con Inutilizar, quien la recibiría decide si acepta el efecto (si acepta, roba 3). |
| **Trastada** (beta) | 1 · ◆ | Como Travesura, más fuerte: recibe 2 cartas tuyas y roba 3. | Se encadena con Travesuras y Trastadas. |

### Defensa (no se echan solas)

| Carta | Cuántas · Jerarquía | Efecto | Detalles |
| --- | --- | --- | --- |
| **Égida** | 3 · II | Protege de un Ataque, Magia o Reflejo. 2 usos. | Tras el primer uso queda boca arriba junto a su dueño (`player.egida`); en el segundo se descarta encima de la Pila y su dueño elige color. Antitodo y Aplastar eliminan las boca arriba. Contra el Imán, quien se protege queda fuera del todo (tampoco recibe reparto). |
| **Reflejo** | 6 · III | Refleja el último Ataque a un jugador a elegir, o la última Magia a todos. Cambia el sentido. | Se pueden reflejar efectos propios u otros Reflejos, pero no un Antitodo. El Ataque (también una Travesura predestinada) va a quien se elija; en Tinieblas, al acertarlo a ciegas, también se elige (`aim` en la fase `react`; si pasa o se acaba el tiempo, va a quien lo lanzó). Una Magia reflejada cambia de efecto (ver columna «reflejada» abajo). |

### Magia (se dirige a cualquier jugador; reflejada afecta a todos)

| Carta | Cuántas · Jerarquía | Efecto | Reflejada |
| --- | --- | --- | --- |
| **Codicia** | 2 por color · I | Elige un oponente: te da su carta de mayor Jerarquía y tú le das la que quieras. Fase `codicia`. | Todos pasan su mano al jugador de al lado. |
| **Purga** | 3 · II | Elige un jugador (puedes ser tú): descarta su mano (al fondo de la Pila) y roba tantas como tenía. | Todos descartan su mano y roban una nueva. |
| **Imán** | 3 · III | Atrae la mejor carta y todas las Gemas de cada oponente (fases `imanPick` → `iman`). Te quedas hasta 3, devuelves hasta 3 por jugador o las eliminas (bajo la Pila). | Atrae las 3 mejores y las Gemas de cada jugador. |
| **Escarcha** (beta) | 1 · ◆ | Ves las manos de los oponentes y mueves cartas entre ellas (cada uno conserva cuántas tiene); además puedes dar 1 tuya. Fase `escarcha`. | Quien la refleja es quien mueve las cartas. |

Con **Inutilizar** activo, la Codicia de color no tiene efecto: quien la juega decide si «empieza el efecto» (si lo hace, roba 3).

### Apoyo (al encadenarla puedes descartar 1 Gema)

| Carta | Cuántas · Jerarquía | Efecto | Detalles |
| --- | --- | --- | --- |
| **Adivinar** | 2 por color · I | Mira las 3 siguientes del Mazo: reordénalas, quédatelas o descártalas. Fase `adivinar`. | En Tinieblas sí las ves; las que te quedas entran boca abajo. |
| **Recuperar** | 3 · II | Recupera una carta de la Pila; quédatela o dásela a otro. Fase `recuperar`. | Se puede recuperar una Maldita para dársela a otro (se ve boca arriba). Si la bloquea con Antitodo, vuelve a ti. |
| **Predestinar** | 3 · III | Se juega junto a otra carta: diriges su efecto a un jugador y le concedes el turno. | La acompañante queda encima y manda su color. No se pueden predestinar Defensas ni Antitodo (`companions`). Se puede jugar con la carta recién robada. Una Maldita predestinada se entrega (fase `react` con efecto `gift`). |
| **Ráfaga** (beta) | 1 · ◆ | Juegas las 5 siguientes del Mazo y 1 tuya, con sus efectos, contra quien quieras; las que no, se descartan. | No se puede defender ni reflejar. No concede el turno. Estado en `s.rafaga`. |

### Entorno (se activa/desactiva con otra igual o con Antitodo)

| Carta | Cuántas · Jerarquía | Efecto | Detalles |
| --- | --- | --- | --- |
| **Mutis** | 2 por color · I | Silencio: no se anuncian las cartas (quien hable roba 3). | Con Inutilizar no se puede activar ni desactivar (se pregunta; si dice que sí, roba 3). |
| **Inutilizar** | 3 · II | Las cartas de color se pueden jugar pero no tienen efecto (fase `inutil`). | Pone a prueba la atención: Aplastar de color saca la mano igual; Travesura, Codicia, Adivinar o Mutis de color preguntan si se empieza o se recibe el efecto (quien diga que sí roba 3). |
| **Tinieblas** | 3 · III | Todos juegan con las cartas boca abajo hasta que el turno vuelve 3 veces al lanzador. | Al caer hay una cuenta atrás para memorizar la mano (durante ella no se puede jugar ni usar cartas, salvo duplicar la Tinieblas, que la desactiva). En tu turno juegas a ciegas o robas 3. Si la carta no encadena, vuelve a tu mano, robas 1 y pierdes el turno. Fuera de tu turno puedes probar una carta (duplicar, Antitodo, defenderte…); si no sirve, robas 1. Lo que se entrega viaja boca abajo; el historial dice «una carta (???)» y se cuenta al disiparse (`logSecret` / `revealSecrets`). Estado en `s.env.tinieblas`. |

### Sagrada y Malditas (míticas, Jerarquía ◆)

| Carta | Cuántas | Efecto | Detalles |
| --- | --- | --- | --- |
| **Antitodo** | 3 | Se juega en cualquier momento. Anula lo que vaya contra ti, reinicia los Entornos y elimina las Égidas boca arriba. Junto a una Maldición (en tu turno), elimina ambas. | Como reacción lo anula todo y devuelve lo gastado (`s.undo`). Bloquea las entregas: la carta vuelve a quien la daba. Sirve aún mientras se resuelve un Imán o una Codicia. |
| **Maldición** | 6 (1 por jugador) | No se puede encadenar. Deshazte de ella con otras cartas o junto a un Antitodo. | Se puede dar con Travesura, Codicia, Recuperar, Predestinar o Imán. Las Malditas que se entregan se ven boca arriba (salvo en Tinieblas). |
| **Condena** | 1 (opcional) | Al empezar tu turno debes buscar una Maldición en el Mazo, la Pila o la mano de un oponente; si fallas, pierdes el turno (fase `condena`). | Solo empieza su efecto cuando la has visto (en Tinieblas, una recibida a ciegas no cuenta hasta que se disipan: `tinieblas.known`). Absolución: con todas las Maldiciones en la mano, la descartas o se la das a otro. **No se elimina con Antitodo.** |

### Arcanas (beta, opción «Cartas beta»)

Escarcha, Ráfaga y Trastada (arriba) y **Ritual I, II y III**: incoloras sin efecto que se pueden echar; quien tenga
los 3 a la vez en la mano gana al instante (comprobado en `apply`).

---

## 4. Dónde está cada cosa en el código

| Qué | Dónde |
| --- | --- |
| Lista de cartas, cantidades, atributo, Jerarquía, textos cortos (`desc`, `HELP`, `ATTR_HELP`), imagen | `src/game/cards.ts` |
| Reglas (función pura `apply(estado, acción)`) | `src/game/engine.ts` |
| Notas detalladas de cada carta (Compendio) | `NOTES` en `src/ui/Compendium.tsx` |
| Mini partidas de ejemplo de cada carta | `DEMOS` en `src/ui/Compendium.tsx` |
| Cómo juegan las máquinas | `src/game/bot.ts` |
| Tiempos (ventanas, pausas de las máquinas, Tinieblas) | `src/game/timing.ts` |
| Partida guiada del tutorial | `src/game/tutorial.ts` y `src/ui/Tutorial.tsx` |
| Lo que ve cada jugador online (oculta manos, Mazo, secretos) | `src/game/view.ts` |

### Para cambiar una regla

1. Cámbiala en `engine.ts` (y, si hace falta, el tipo de fase o de acción).
2. Revisa que la IA la entienda (`bot.ts`) y que la interfaz ofrezca la jugada (`App.tsx`: función de acciones de cada carta,
   avisos del `banner`).
3. Actualiza los textos: `desc` y `HELP` en `cards.ts`, `NOTES` (y si cambia mucho, `DEMOS`) en `Compendium.tsx`, y este archivo.
4. Si la información oculta cambia (qué carta se entrega, manos…), revisa `view.ts`.
5. Comprueba: `npx tsx scripts/sim.ts` (partidas de máquinas sin atascos) y `npx tsx scripts/room-sim.ts`
   (online: sin fugas de información y reproducción exacta).
