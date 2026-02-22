-- Game Hub Supabase schema (leaderboards + ratings)

create table if not exists public.games (
  slug text primary key,
  title text not null,
  description text not null default '',
  creator text not null default 'unknown',
  model text not null check (model in ('claude', 'codex', 'gemini', 'grok')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_slug_format_chk check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.leaderboard_scores (
  id bigint generated always as identity primary key,
  game_slug text not null references public.games(slug) on delete cascade,
  player_name text not null,
  score bigint not null,
  client_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint leaderboard_scores_player_name_len_chk check (char_length(trim(player_name)) between 1 and 20),
  constraint leaderboard_scores_fingerprint_len_chk check (char_length(trim(client_fingerprint)) between 8 and 128)
);

create table if not exists public.game_ratings (
  game_slug text not null references public.games(slug) on delete cascade,
  client_fingerprint text not null,
  rating smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (game_slug, client_fingerprint),
  constraint game_ratings_rating_chk check (rating between 1 and 5),
  constraint game_ratings_fingerprint_len_chk check (char_length(trim(client_fingerprint)) between 8 and 128)
);

create index if not exists leaderboard_scores_game_slug_score_idx
  on public.leaderboard_scores (game_slug, score desc, created_at asc);

create index if not exists leaderboard_scores_game_slug_created_idx
  on public.leaderboard_scores (game_slug, created_at desc);

create index if not exists game_ratings_game_slug_idx
  on public.game_ratings (game_slug);

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists games_set_updated_at on public.games;
create trigger games_set_updated_at
before update on public.games
for each row
execute function public.tg_set_updated_at();

drop trigger if exists game_ratings_set_updated_at on public.game_ratings;
create trigger game_ratings_set_updated_at
before update on public.game_ratings
for each row
execute function public.tg_set_updated_at();

create or replace function public.get_game_leaderboard(p_game_slug text, p_limit integer default 25)
returns table (
  rank bigint,
  player_name text,
  score bigint,
  created_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with ranked as (
    select
      row_number() over (order by s.score desc, s.created_at asc) as rank,
      s.player_name,
      s.score,
      s.created_at
    from public.leaderboard_scores s
    where s.game_slug = p_game_slug
  )
  select
    ranked.rank,
    ranked.player_name,
    ranked.score,
    ranked.created_at
  from ranked
  order by ranked.rank
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

create or replace function public.get_global_leaderboard(p_limit integer default 50)
returns table (
  rank bigint,
  game_slug text,
  game_title text,
  player_name text,
  score bigint,
  created_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with ranked as (
    select
      row_number() over (order by s.score desc, s.created_at asc) as rank,
      s.game_slug,
      g.title as game_title,
      s.player_name,
      s.score,
      s.created_at
    from public.leaderboard_scores s
    join public.games g on g.slug = s.game_slug
    where g.archived = false
  )
  select
    ranked.rank,
    ranked.game_slug,
    ranked.game_title,
    ranked.player_name,
    ranked.score,
    ranked.created_at
  from ranked
  order by ranked.rank
  limit greatest(1, least(coalesce(p_limit, 50), 250));
$$;

create or replace function public.upsert_game_rating(
  p_game_slug text,
  p_client_fingerprint text,
  p_rating smallint
)
returns table (
  game_slug text,
  client_fingerprint text,
  rating smallint,
  updated_at timestamptz
)
language plpgsql
set search_path = public
as $$
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;

  insert into public.game_ratings (game_slug, client_fingerprint, rating)
  values (trim(p_game_slug), trim(p_client_fingerprint), p_rating)
  on conflict (game_slug, client_fingerprint)
  do update
    set rating = excluded.rating,
        updated_at = now()
  returning
    public.game_ratings.game_slug,
    public.game_ratings.client_fingerprint,
    public.game_ratings.rating,
    public.game_ratings.updated_at
  into game_slug, client_fingerprint, rating, updated_at;

  return next;
end;
$$;

create or replace function public.get_game_rating_summary(p_game_slug text)
returns table (
  game_slug text,
  rating_count bigint,
  avg_rating numeric(4,2),
  rating_1 bigint,
  rating_2 bigint,
  rating_3 bigint,
  rating_4 bigint,
  rating_5 bigint
)
language sql
stable
set search_path = public
as $$
  select
    p_game_slug as game_slug,
    count(*)::bigint as rating_count,
    coalesce(round(avg(gr.rating)::numeric, 2), 0)::numeric(4,2) as avg_rating,
    count(*) filter (where gr.rating = 1)::bigint as rating_1,
    count(*) filter (where gr.rating = 2)::bigint as rating_2,
    count(*) filter (where gr.rating = 3)::bigint as rating_3,
    count(*) filter (where gr.rating = 4)::bigint as rating_4,
    count(*) filter (where gr.rating = 5)::bigint as rating_5
  from public.game_ratings gr
  where gr.game_slug = p_game_slug;
$$;

alter table public.games enable row level security;
alter table public.leaderboard_scores enable row level security;
alter table public.game_ratings enable row level security;

drop policy if exists games_read_public on public.games;
create policy games_read_public
on public.games
for select
using (true);

drop policy if exists leaderboard_scores_read_public on public.leaderboard_scores;
create policy leaderboard_scores_read_public
on public.leaderboard_scores
for select
using (true);

drop policy if exists leaderboard_scores_insert_public on public.leaderboard_scores;
create policy leaderboard_scores_insert_public
on public.leaderboard_scores
for insert
to anon, authenticated
with check (
  char_length(trim(player_name)) between 1 and 20
  and char_length(trim(client_fingerprint)) between 8 and 128
);

drop policy if exists game_ratings_read_public on public.game_ratings;
create policy game_ratings_read_public
on public.game_ratings
for select
using (true);

drop policy if exists game_ratings_insert_public on public.game_ratings;
create policy game_ratings_insert_public
on public.game_ratings
for insert
to anon, authenticated
with check (
  rating between 1 and 5
  and char_length(trim(client_fingerprint)) between 8 and 128
);

drop policy if exists game_ratings_update_public on public.game_ratings;
create policy game_ratings_update_public
on public.game_ratings
for update
to anon, authenticated
using (true)
with check (
  rating between 1 and 5
  and char_length(trim(client_fingerprint)) between 8 and 128
);

grant usage on schema public to anon, authenticated;

grant select on public.games to anon, authenticated;
grant select, insert on public.leaderboard_scores to anon, authenticated;
grant select, insert, update on public.game_ratings to anon, authenticated;

grant usage, select on sequence public.leaderboard_scores_id_seq to anon, authenticated;

grant execute on function public.get_game_leaderboard(text, integer) to anon, authenticated;
grant execute on function public.get_global_leaderboard(integer) to anon, authenticated;
grant execute on function public.upsert_game_rating(text, text, smallint) to anon, authenticated;
grant execute on function public.get_game_rating_summary(text) to anon, authenticated;
