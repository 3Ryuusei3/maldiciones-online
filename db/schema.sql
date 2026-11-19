-- Maldiciones: histórico de partidas y reportes de fallos (Neon / Lakebase Postgres).
-- Se aplica con: npx tsx scripts/db-migrate.ts   (idempotente)

-- Jugadores: de momento, invitados identificados por un id anónimo de su navegador.
-- Cuando haya registro, `user_id` enlazará con la cuenta.
create table if not exists players (
  id uuid primary key,
  name text not null,
  user_id text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- Una fila por partida. `initial` (estado inicial completo) + `actions` (acciones aplicadas, en orden)
-- permiten reproducir la partida jugada a jugada con el motor (para entrenar la IA y reproducir fallos).
create table if not exists games (
  id uuid primary key,
  mode text not null check (mode in ('local', 'online')),
  room text,
  status text not null check (status in ('finished', 'unfinished')),
  format int not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_ms int not null,
  player_count int not null,
  options jsonb not null,
  winner_seat int,
  win_reason text,
  turns int not null,
  initial jsonb not null,
  actions jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists games_ended_at on games (ended_at desc);

-- Una fila por jugador y partida (las máquinas sin `player_id`).
create table if not exists game_players (
  game_id uuid not null references games (id) on delete cascade,
  seat int not null,
  player_id uuid references players (id) on delete set null,
  name text not null,
  is_bot boolean not null,
  bot_level int,
  color int,
  won boolean not null,
  final_hand int not null,
  played int not null,
  drawn int not null,
  max_curses int not null,
  max_hand int not null,
  min_hand int not null,
  left_game boolean not null default false,
  primary key (game_id, seat)
);
create index if not exists game_players_player on game_players (player_id);

-- Reportes de fallos: lo que cuenta el jugador, el estado de la partida y sus últimas jugadas.
create table if not exists bug_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  player_id uuid,
  game_id uuid,
  mode text,
  room text,
  description text not null,
  user_agent text,
  build text,
  state jsonb,
  recent_actions jsonb,
  status text not null default 'open'
);
create index if not exists bug_reports_created on bug_reports (created_at desc);

-- Perfiles de las cuentas (Neon Auth guarda los usuarios en el esquema neon_auth; aquí, lo propio del juego).
-- `user_id` es el id de Neon Auth (el «sub» del token). El nickname es único sin distinguir mayúsculas.
create table if not exists profiles (
  user_id text primary key,
  nickname text not null,
  color int not null default 0,
  icon text not null default 'maldicion',
  guest_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_nickname_lc on profiles (lower(nickname));

-- Cada jugador de una partida, enlazado con su cuenta (si jugaba con sesión iniciada).
alter table game_players add column if not exists user_id text;
create index if not exists game_players_user on game_players (user_id);
