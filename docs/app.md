# Maldiciones · Cómo funciona la app

Mapa de la aplicación web (juego en local y online, cuentas, app instalable). Para las reglas de las cartas, ver
[`cartas.md`](cartas.md). Si cambias la arquitectura, actualiza este archivo.

---

## 1. Piezas

```
Navegador (React + Vite, src/)                Cloudflare (server/, plan gratuito)          Neon (Postgres + Auth)
┌──────────────────────────────┐   HTTP/WS   ┌───────────────────────────────┐   SQL    ┌──────────────────────┐
│ Portada, opciones, Compendio │ ──────────▶ │ Worker: web estática (dist/)   │ ───────▶ │ games, game_players, │
│ Partida local (useGame)      │             │  /api/* (salas, perfil, …)     │          │ bug_reports, players,│
│ Partida online (NetClient)   │             │  /api/auth/* → Neon Auth       │          │ profiles             │
│ Cuenta (Neon Auth)           │             │ Durable Object «Sala» por sala │          │ Neon Auth (sesiones) │
└──────────────────────────────┘             └───────────────────────────────┘          └──────────────────────┘
```

- **Web:** `https://maldiciones.ryuusei3.workers.dev` (la sirve el mismo Worker).
- **Solo servicios gratuitos** (Cloudflare Workers + Durable Objects de SQLite, Neon).

## 2. Carpetas

| Ruta | Qué es |
| --- | --- |
| `src/game/cards.ts` | Definición de las cartas |
| `src/game/engine.ts` | Motor de reglas puro y determinista: `apply(estado, acción)`. Sin relojes ni `Math.random` (el azar sale de `state.seed`) |
| `src/game/bot.ts` | IA de las máquinas (fácil / normal / difícil) |
| `src/game/timing.ts` | Ritmos compartidos: ventanas de reacción, pausas de las máquinas, cuenta atrás de Tinieblas |
| `src/game/room.ts` | Sala online pura: espera, opciones, partida, relojes, máquinas, caídas, piloto automático |
| `src/game/view.ts` | Lo que ve cada jugador online (sin manos ajenas, Mazo, semilla ni secretos de Tinieblas; ids ocultos cambiados) |
| `src/game/record.ts` | Registro de partida (estado inicial + acciones) para guardarla y reproducirla |
| `src/game/tutorial.ts` | Partida guiada (manos y Mazo fijos) |
| `src/game/icons.ts`, `emotes.ts`, `banter.ts` | Iconos de jugador elegibles (cartas, atributos, Jerarquías, con teñido `:tN`), emoticonos y cuándo los mandan las máquinas |
| `src/ui/App.tsx` | Todo lo de la partida (mesa, animaciones `launch`/`useFlights`, avisos, bandejas, flechas, pantalla final) y el enrutado de pantallas |
| `src/ui/useGame.ts` | «Anfitrión» local: aplica acciones, mueve a las máquinas, lleva los relojes y guarda la partida |
| `src/ui/Online.tsx` | Cabecera del panel (`Shell`), crear/unirse a sala, sala de espera |
| `src/ui/QrScan.tsx` | Lector del QR de la sala con la cámara |
| `src/ui/Setup.tsx` | Opciones de partida (y modal «Más opciones») |
| `src/ui/Account.tsx` | Entrada (iniciar sesión / crear cuenta / Google / invitado), perfil, avatar hexagonal, selector de icono y color |
| `src/ui/Compendium.tsx` | Compendio (Cómo jugar · Mecánicas · Cartas · Jerarquía), mini partidas, ayuda rápida de la partida |
| `src/ui/Tutorial.tsx` | Pasos del tutorial y su caja |
| `src/ui/shared.tsx` | Piezas comunes (iconos, Trifuerza, paleta de colores `PCOL`, `asset()`) |
| `src/styles.css` | Estilos. Es muy largo y por capas: **las reglas de abajo ganan**; los cambios nuevos se añaden al final |
| `src/net/client.ts` | Conexión online (`NetClient`: WebSocket con reconexión, token por pestaña) y llamadas HTTP |
| `src/net/auth.ts` | Cuenta: Neon Auth, perfil, invitado, token para el servidor, traspaso de Google en iPhone |
| `server/src/index.ts` | Worker + Durable Object `Sala` |
| `server/src/db.ts`, `auth.ts` | Acceso a Neon (partidas, fallos, perfiles) y verificación del token (JWKS) |
| `db/schema.sql`, `scripts/db-migrate.ts` | Tablas de la base de datos |
| `scripts/sim.ts`, `scripts/room-sim.ts` | Simulaciones de comprobación (ver §8) |
| `scripts/gen-sw.mjs` | Genera el service worker al compilar |
| `public/` | Arte: `cards/` (cartas), `icons/` (iconos), `attr/` (atributos), `ui/` (fondo, Trifuerza), `pwa/` (iconos de la app), `manifest.webmanifest`, páginas legales |

## 3. Partida en local

`Game` (App.tsx) usa `useGame`, que guarda el `GameState` y aplica las acciones con `apply`. Las máquinas deciden con
`botDecide` tras una pausa (`botDelay`), y las ventanas de reacción tienen su reloj. Al terminar (o al abandonar) la partida se
envía a `/api/partidas`.

El motor deja en `state.fx` los movimientos de cartas de la última acción; la interfaz los anima (`launch`: cartas que vuelan,
se ven en grande sobre la Pila y se asientan). Velocidad en `setAnimSpeed` (App.tsx): 1.1 en partida, 1.4 en el tutorial.

URLs de depuración: `?demo=N` (partida directa con N jugadores), `&mano=carta,carta` (te reparte esas cartas).

## 4. Partida online

- **Servidor autoritativo:** cada sala (código de 4 letras) es un Durable Object `Sala` que ejecuta `apply`, lleva los relojes y
  mueve a las máquinas (`room.ts`). Usa WebSockets con hibernación: sin nadie jugando no consume.
- Cada jugador recibe solo su vista (`viewFor`). El cliente nunca tiene el estado completo.
- **Mensajes** (`ClientMsg` / `ServerMsg` en `room.ts`): `hello`, `screen`, `opts`, `start`, `act`, `color`, `drop`, `lobby`, `leave`,
  `bug`, `emote`.
- Huecos libres = máquinas (con nivel por máquina). Quien entra con la partida empezada ocupa el sitio de una máquina.
- Decisiones con tiempo máximo de 15 s (opción). Si alguien se cae, se le espera; el anfitrión decide si juega una máquina por
  él o se le quita.
- El anfitrión puede cambiar en partida el tiempo máximo y las flechas.
- Las partidas online las guarda la propia sala al terminar (o al abandonarse).
- **En el sofá (pantalla de mesa):** «Online → Crear mesa». Esa pantalla (tele, portátil) entra en la sala como
  pantalla (`{t: 'screen'}`, `screenHello` en `room.ts`; `r.screens`): no se sienta, ve la partida sin ninguna mano
  (`viewFor(s, -1)`) y, mientras está conectada, es el anfitrión (opciones, empezar, caídas, volver a la sala). Su sala de
  espera (`TableLobby` en `Online.tsx`) enseña el código y un QR con el enlace `?sala=`. En móviles y tabletas, junto al código de sala hay un botón de cámara
  (`QrScanner` en `src/ui/QrScan.tsx`: `BarcodeDetector` o, si no hay, jsQR) que lee ese QR sin salir de la web; en la
  app instalada es la forma de entrar, porque la cámara del sistema abriría el enlace en el navegador. Si la pestaña de la mesa se
  recarga, vuelve sola a su sala (`maldiciones:mesa` en `sessionStorage`). Cada jugador entra desde su móvil como en
  cualquier sala online; con `RoomView.couch`, su partida es un **mando** (`Game` con `pad`, clase `.game.pad`): no se
  pintan los rivales; arriba, en pequeño, el Mazo, la carta de arriba (y su color) y la Trifuerza; debajo el aviso y mi
  mano en rejilla, grande. Las elecciones salen en recuadros: el color, el jugador (`pick-modal`: a quién dirigir, reflejar,
  dar, buscar con Condena…, con la carta de la que se trata) y las bandejas de Imán, Adivinar y Recuperar (`tray-modal`);
  Escarcha y Ráfaga siguen con su bandeja porque también se elige carta de la mano. Aplastar: la diana, grande en el centro.
  El anuncio de la carta jugada, las flechas y el mini historial solo salen en la mesa (el mini historial, abajo a la
  izquierda y con 8 jugadas, si la pantalla mide 1000 px o más). Al acabar la partida, en el mando la mano baja y sale, la
  mesa crece hasta ocupar la pantalla con la Pila en el centro y ahí se hace el final (`.game.pad[data-finale]`).
  En horizontal: mi ficha arriba a la izquierda, junto a la mesa; la mano en una fila (con más de 7 cartas, más pequeñas,
  `data-many`) y en el recuadro de elegir jugador los jugadores van en fila.
  En la mesa, `Game` recibe `tv`: se añade al final un asiento vacío y fuera de la partida que hace de «yo»
  (`withTableSeat` en `App.tsx`), así todos los jugadores se sientan alrededor; la clase `.game.tv` oculta la mano y los
  avisos personales. El reparto espera también a las pantallas (`ready`).

## 5. Cuentas

- **Neon Auth** (Better Auth gestionado): correo y contraseña, o Google (credenciales propias de Google Cloud).
  **Invitado:** nombre, color e icono guardados en el navegador.
- **Todo pasa por nuestro dominio:** el cliente habla con `/api/auth/*` y el Worker lo reenvía a Neon Auth, reescribiendo la
  cookie de sesión para que sea de este sitio (`proxyAuth`). Así Safari y la app instalada no la bloquean.
- **Perfil** (nickname único, color, icono) en la tabla `profiles` vía `/api/perfil` (GET/PUT). El servidor comprueba el token
  (JWT) con las claves públicas de Neon (`NEON_AUTH_JWKS_URL`).
- **Google en la app instalada del iPhone:** Google se abre en Safari, que no comparte sesión con la app. La página a la que
  vuelve Safari deja un código de un solo uso en `/api/handoff/:id` y la app, que lo está esperando, termina de entrar
  (`signInGoogle` / `handoffFromSafari` en `auth.ts`).
- **Secretos:** `DATABASE_URL` como secreto del Worker (`wrangler secret put`). `.env.local`, `server/.dev.vars` y `.neon` no
  se suben a git.

## 6. App instalable (PWA) y móvil

- `public/manifest.webmanifest` + iconos en `public/pwa/` (emblema del dorso: calavera, estrella y rayos).
- **Service worker** (`scripts/gen-sw.mjs` lo genera en `dist/sw.js` al compilar):
  - al instalarse descarga toda la web;
  - imágenes y código salen de la caché;
  - la página siempre se pide primero a la red (última versión);
  - `/api` nunca pasa por la caché;
  - cada versión nueva tiene su propia caché.
- **Pantallas con muesca:** `viewport-fit=cover`; los fondos llegan a los bordes y los controles usan `env(safe-area-inset-*)`.
- **Móvil** (media queries «vertical estrecho» y «horizontal bajo», al final de `styles.css`; en código, `PHONE_Q` / `useMedia`
  de `shared.tsx`):
  - tamaños según la pantalla; la mano se ve entera;
  - cada rival es un hexágono grande con su número de cartas, su nombre y un abanico pequeño con sus cartas que sale del
    hexágono apuntando a la Pila (en el móvil el abanico va dentro de `.hex-hold`; el ángulo lo calcula `Game` en `fanAngles`
    y llega como `--fa`). En horizontal: los de arriba con el nombre al lado del hexágono, pegado a su borde superior; los
    de los lados, con el nombre encima. En vertical van en fila arriba (`SEATS_ROW`; con 2-3 rivales, nombre al lado; con
    más, encima); en horizontal, alrededor de la mesa como en grande (`SEATS`). Mi ficha, abajo a la izquierda;
  - mensajes: el aviso de lo que se me pide va justo encima de mi mano, con sus botones a la derecha en la misma fila
    (como en escritorio). En horizontal, el anuncio de la carta jugada va en una columna estrecha abajo a la derecha y la
    mano queda centrada; en vertical, encima del aviso;
  - bordes blancos de las cartas más finos (1,5 px);
  - elegir color: recuadro centrado sobre la mesa (`gem-modal`), en vez de las gemas bajo la trifuerza;
  - arriba solo un botón de menú (☰): la pausa incluye el reloj de la partida, el compendio y el registro;
  - sin flechas, sin mini historial y sin botón de pantalla completa;
  - bandejas compactas; fin de partida con los botones siempre a la vista;
  - compendio: cabecera compacta («Compendio» a la derecha) y pestañas en una fila fina; «Cartas» es una cuadrícula y al tocar una carta se abre su ficha a pantalla
    completa (se pasa de carta con las flechas o deslizando el dedo) (`PhoneCards` en `Compendium.tsx`);
  - portada: sin el enlace repetido al compendio y con el contenido centrado; iconos de jugador en dos filas que se deslizan.
- **En todas las pantallas:** los emoticonos tienen su propio botón junto a mi nombre (el menú se cierra al tocar fuera y,
  mientras está abierto, se oculta el mini historial), y el
  cartel de «¿Quién empieza?» se cierra al tocarlo; mientras está, no se puede jugar.
- **Emoticonos de las máquinas** (`src/game/banter.ts`): de vez en cuando reaccionan a lo que pasa (al echar Travesura,
  Magia, Antitodo…; al robar 3 o más; al fallar a ciegas; al acabar). La elección sale del número de jugada y del jugador,
  así que en online todos ven lo mismo sin que el servidor envíe nada; `Game` limita a uno cada 10 s (25 s por máquina) y
  nunca en el tutorial.
- **Tinieblas:** cuando alguien falla a ciegas fuera de su turno, el aviso de abajo (`.blind-hint`) se realza un momento.
- El ajuste del móvil de «reducir movimiento» se ignora a propósito: el juego se explica con sus animaciones.

## 7. Arte

Las imágenes salen de los `.ai` de iCloud (`…/Maldiciones/Versiones/Versión 7/Versión 7.0/`):
- **Exportar:** «Todas Las Cartas» → PNG de 1600 px en «Fotos» (con `qlmanage`, porque los `.ai` son compatibles con PDF).
- **Recortar:** quitar el desfase del lienzo y el filo; el filo de la carta lo pone el CSS.
- **Al juego:** WebP de 404×566 en `public/cards/`, con el nombre `tipo-color.webp` (a/m/v; `travesura-n` la incolora;
  `cristalizar-<tono>`; `inutilizar-2/3` y `tinieblas-2/3` son versiones II y III).
- **Excepciones:** la Maldición es la v7 regenerada y el dorso (`back.webp`) es el de la v6.
- **Iconos:** de la chuleta (`Chuleta I/II v7.0.ai`) a `public/icons/` (192 px, fondo transparente).

## 8. Comprobar y publicar

```bash
npm run dev                         # http://localhost:5173  (con `cd server && npm run dev` para el online)
npm run build                       # tsc + vite + service worker → dist/
npx tsx scripts/sim.ts              # partidas de máquinas: ninguna atascada
npx tsx scripts/room-sim.ts         # online: sin atascos, sin fugas de información, reproducción exacta del registro
cd server && npm run deploy         # compila la web y publica Worker + web
```

Forma de trabajar acordada:
- Se sube (commit + push + deploy) solo cuando se pide.
- «amend» significa `git commit --amend --no-edit && git push --force-with-lease` y desplegar.

## 9. Limitaciones conocidas

- **Bloqueo de LaLiga:** en España, durante los partidos, algunas compañías bloquean direcciones de Cloudflare. Ahí la web y
  el online pueden no cargar. El juego en local y la app ya instalada siguen funcionando.
- **Google en la app del iPhone:** depende del traspaso desde Safari (§5). Con correo y contraseña no hay problema.
- **Tinieblas:** la cuenta atrás de memorizar la lleva cada pantalla; el servidor no sabe en qué momento está.
