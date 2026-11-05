-- Закрытая схема, перечисления и таблицы (контракт, раздел 3.8).
-- RLS включается вместе с таблицей: пока нет правил, строки не отдаются никому. Правила и права —
-- в миграции rls_and_grants.

-- Схема функций с повышенными правами: документация Supabase запрещает создавать их в открытой (Р13).
-- USAGE у authenticated нужен, потому что выражения правил выполняются с правами вызывающего;
-- через API схема не открыта.
create schema private;
revoke all on schema private from public, anon, service_role;
grant usage on schema private to authenticated;

create type public.app_role as enum ('manager', 'executor');
create type public.task_status as enum ('new', 'in_progress', 'in_review', 'accepted', 'rework');

-- Непустой текст: есть хотя бы один видимый символ. Список пробельных задан явно, потому что
-- [[:space:]] зависит от локали базы и не считает пробельным неразрывный пробел (раздел 3.1).
-- EXECUTE у authenticated нужен: проверки таблиц выполняются с правами того, кто пишет.
create function private.has_text(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_value ~ '[^\u0009-\u000D\u0020\u0085\u00A0\u1680\u180E\u2000-\u200B\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]',
    false
  );
$$;
revoke all on function private.has_text(text) from public, anon, authenticated, service_role;
grant execute on function private.has_text(text) to authenticated;

-- Профиль: роль и имя отдельно от данных входа, которые пользователь может править сам (Р6).
-- Связь с auth.users без каскада: стереть пользователя с профилем база не даст.
create table public.profiles (
  id uuid primary key references auth.users (id),
  full_name text not null,
  role public.app_role not null default 'executor',
  constraint profiles_full_name_valid check (
    private.has_text(full_name) and char_length(full_name) <= 200
  )
);
alter table public.profiles enable row level security;

-- Объект (стройка). Удаление только скрывает: хранится кто и когда (Р2, Р3).
create table public.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  constraint objects_name_valid check (private.has_text(name) and char_length(name) <= 200),
  constraint objects_address_valid check (
    private.has_text(address) and char_length(address) <= 300
  ),
  constraint objects_deleted_complete check ((deleted_at is null) = (deleted_by is null))
);
alter table public.objects enable row level security;

-- Задача. Статус и автора ставит база: через API их передать нельзя (раздел 3.1, ТЗ п. 3.3).
-- Задача вне статуса «Новая» обязана иметь исполнителя (Р4, Р8).
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  object_id uuid not null references public.objects (id),
  assignee_id uuid references public.profiles (id),
  status public.task_status not null default 'new',
  author_id uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  constraint tasks_title_valid check (private.has_text(title) and char_length(title) <= 200),
  constraint tasks_description_valid check (char_length(description) <= 5000),
  constraint tasks_assignee_required check (status = 'new' or assignee_id is not null),
  constraint tasks_deleted_complete check ((deleted_at is null) = (deleted_by is null))
);
alter table public.tasks enable row level security;

create index tasks_object_id_idx on public.tasks (object_id);
create index tasks_assignee_id_idx on public.tasks (assignee_id);

-- История: одна таблица для создания, смены статуса и смены исполнителя (Р9, ТЗ п. 2.4, п. 3.4).
-- Запись обязана быть ровно одного вида. При пустом статусе обычное сравнение дало бы NULL, и
-- проверка бы прошла, поэтому сравнение учитывает пустое значение.
create table public.task_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id),
  actor_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  from_status public.task_status,
  to_status public.task_status,
  from_assignee_id uuid references public.profiles (id),
  to_assignee_id uuid references public.profiles (id),
  comment text,
  constraint task_history_comment_valid check (
    comment is null or (private.has_text(comment) and char_length(comment) <= 2000)
  ),
  constraint task_history_kind check (
    (
      from_status is null
      and to_status is not distinct from 'new'
      and from_assignee_id is null
    )
    or (
      from_status is not null
      and to_status is not null
      and from_assignee_id is null
      and to_assignee_id is null
    )
    or (
      from_status is null
      and to_status is null
      and comment is null
      and (from_assignee_id is not null or to_assignee_id is not null)
    )
  )
);
alter table public.task_history enable row level security;

create index task_history_task_id_idx on public.task_history (task_id);
