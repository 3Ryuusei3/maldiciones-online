# Maldiciones (web)

Versión de navegador del juego de mesa **Maldiciones**. Reglas V7.0.1 (103 cartas), arte de la V6.
De momento: 1 jugador contra 2–5 máquinas (fácil / normal / difícil).

```bash
npm install
npm run dev        # abre http://localhost:5173  (añade ?demo=5 para entrar directo a una partida)
npm run build      # web estática en dist/
npm run sim 500    # 500 partidas solo de máquinas para comprobar que el motor no se rompe
```

## Estructura

| Ruta | Qué es |
| --- | --- |
| `src/game/cards.ts` | Las 103 cartas: tipo, atributo, jerarquía, textos de ayuda, imagen |
| `src/game/engine.ts` | Reglas. Función pura `apply(estado, acción)`; sin relojes ni azar externo |
| `src/game/bot.ts` | IA de las máquinas |
| `src/ui/useGame.ts` | "Anfitrión": mueve a las máquinas y lleva las cuentas atrás |
| `src/ui/App.tsx` | Portada y mesa de juego |
| `src/ui/Compendium.tsx` | Compendio (Cómo jugar · Mecánicas · Cartas), mini partidas de ejemplo y ayuda rápida |
| `src/ui/shared.tsx`, `src/styles.css` | Piezas comunes y estilos |
| `public/cards`, `public/icons`, `public/ui` | Arte exportado de los `.ai` (cartas, iconos, indicadores, fondo) |

**Cambiar el arte:** sustituye los `.webp` de `public/cards` manteniendo el nombre
(`travesura-a.webp`, `cristalizar-m.webp`, `reflejo.webp`… a = amarillo, m = morado, v = verde, n = incolora).
`aplastar-*.webp` es ahora la ilustración de Embestida V6.

## Online (pendiente, solo Supabase)

El motor ya está pensado para ello: un jugador hace de **anfitrión**, ejecuta `apply` y los demás solo envían acciones.

1. Supabase Realtime (canal por sala): los invitados envían `Action`; el anfitrión difunde el estado.
2. Falta una función `vistaPara(estado, jugador)` que oculte manos ajenas y el Mazo antes de difundir.
3. Tabla `salas` (código, anfitrión, estado serializado) para reconexiones; Auth anónima.
4. `useGame.ts` es lo único que cambia: hoy el asiento humano es fijo (`ME = 0`).

## Adaptaciones y supuestos de reglas

Decididas con el autor:
- Gema I, II y III son símbolos distintos.
- Duplicar: se puede en cualquier momento mientras nadie ponga otra carta encima. Un Ataque se multiplica, un Entorno se revierte, el resto solo se descarta.
- Antitodo en tu turno gasta el turno (también con Maldición); fuera de tu turno es libre. No se puede predestinar.
- Reacciones con cuenta atrás (10 s). Aplastar es un minijuego de reflejos (5 s), también cuando va predestinado (el receptor juega después su turno).
- Mutis: mientras está activo no se anuncian las cartas. El anfitrión puede señalar faltas (`Falta +3`).
- Travesura: la víctima recibe, roba y después juega su turno; si se encadenan varias, juega el último receptor.
- Empates de Jerarquía (Codicia, Imán): elige siempre el dueño de las cartas, solo entre las empatadas. Las Gemas del Imán van solas.
- Una Magia ya reflejada se puede volver a reflejar.
- Antitodo como reacción lo anula todo: el efecto no alcanza a nadie, se restaura el sentido y lo gastado en defenderse (Gemas, Égidas, Reflejos) vuelve a su dueño.
- Imán: quien se queda sin cartas porque se las han atraído no gana; siguen retenidas hasta que vuelva a tener cartas.
- Tinieblas: te defiendes a ciegas eligiendo una carta boca abajo; si no sirve, robas 1. Un Reflejo acertado a ciegas vuelve contra quien lanzó el efecto.
- Opciones de partida: añadir las Maldiciones restantes y/o jugar con Condena.
- Tinte: el color se pregunta una sola vez, cuando ya no se van a echar más incoloras en esa acción; elige quien echó la última.
- Travesura: quien la lanza (o encadena, duplica o refleja) aparta primero la carta que va a dar; los demás esperan y reaccionan después. Si el efecto se bloquea, la carta vuelve a su dueño.
- Inutilizar no anula el descarte de Gema de las cartas de Apoyo.
- Condena: eliges Mazo, Pila o la mano de un rival; si hay Maldición ahí, te la quedas.
- Jerarquía: Aplastar, Adivinar, Mutis = I · Cristalizar, Égida, Codicia, Purga, Recuperar, Inutilizar = II · Travesura, Reflejo, Imán, Predestinar, Tinieblas = III · míticas = diamante.

Supuestos míos, a revisar:
- Al dar cartas (Travesura, Codicia) elige el lanzador; en Tinieblas todo lo que se entrega es al azar.
- Cualquiera con Reflejo puede reflejar un Ataque o Magia en curso.
- Codicia reflejada rota las manos entre todos menos quien reflejó.
- Con Gema Tricolor y con el descarte de Apoyo, las cartas van al fondo de la Pila.
- Tinieblas dura 3 turnos completos del lanzador después del turno en que la juega. En Tinieblas no se puede Duplicar, pero sí defenderse.
- Quien tiene una decisión a medias (elegir objetivo, entregar carta) la termina antes de poder Duplicar.

## Cambios de reglas confirmados (noviembre 2026)

- Travesura/Trastada: las cartas no se apartan al lanzar; se eligen y se dan al final, cuando se sabe quién las recibe. Un Reflejo solo refleja la última carta de la cadena (Travesura: 1 carta y robar 2; Trastada: 2 y robar 3) y lo acumulado antes se pierde.
- Cartas beta de V7 (opción al crear partida), 1 de cada, míticas e incoloras:
  - Escarcha (Magia): el lanzador ve las manos de los oponentes y cambia cartas entre ellas (cada uno conserva cuántas tiene); opcionalmente da 1 carta suya.
  - Ráfaga (Apoyo): se revelan 5 cartas del Mazo; el lanzador las juega una a una con su efecto contra quien quiera (o las descarta), y puede jugar 1 de su mano. Como es de Apoyo, permite descartar 1 Gema y no se puede defender ni reflejar.
  - Trastada (Ataque): como Travesura con 2 cartas y robar 3; se encadena con Travesuras.
  - Ritual I, II y III (Gema): sin efecto; quien tenga los 3 a la vez en la mano gana al instante.
- Supuestos míos: Escarcha reflejada la ejecuta quien refleja; las cartas jugadas con Ráfaga no conceden el turno; una Ráfaga dentro de otra no tiene efecto; los Rituales ganan aunque haya Entorno maldito.
