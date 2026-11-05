-- Служебные функции для правил доступа (раздел 3.1 «Права», контракт 3.8).
-- Работают только с текущим пользователем: его номер параметром не принимают, вызвать их через API
-- нельзя. Функции, читающие таблицы, работают с повышенными правами, иначе цепочка
-- профили → история → задачи → роль дала бы бесконечную рекурсию правил (42P17).

-- Роль текущего пользователя; без профиля и без входа — пусто. Проверяется в момент действия (Р6).
create function private.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

-- Постановщик ли текущий пользователь. Только точное совпадение: при пустой роли ответ false, не NULL.
create function private.is_manager()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.current_user_role() = 'manager', false);
$$;

-- Исполнитель ли текущий пользователь. Только точное совпадение: при пустой роли ответ false, не NULL.
create function private.is_executor()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.current_user_role() = 'executor', false);
$$;

-- Можно ли текущему пользователю читать задачу: для правила истории (раздел 3.1, ТЗ п. 3.2).
-- Удалённое никому не отдаётся, в том числе постановщику (Р5).
create function private.can_read_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and t.deleted_at is null
      and (
        private.is_manager()
        or (private.is_executor() and t.assignee_id = auth.uid())
      )
  );
$$;

-- Есть ли у текущего пользователя неудалённая задача в объекте (раздел 3.1 «Объекты», ТЗ п. 2.2).
create function private.has_task_in_object(p_object_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    where t.object_id = p_object_id
      and t.assignee_id = auth.uid()
      and t.deleted_at is null
  );
$$;

-- Можно ли текущему пользователю читать профиль (Р10): постановщику все, исполнителю свой и тех,
-- кто упомянут в истории его неудалённых задач. Параметр — чей профиль читают, а не кто читает.
create function private.can_read_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.is_manager()
    or (
      private.is_executor()
      and (
        p_profile_id = auth.uid()
        or exists (
          select 1
          from public.task_history h
          join public.tasks t on t.id = h.task_id
          where t.assignee_id = auth.uid()
            and t.deleted_at is null
            and p_profile_id in (h.actor_id, h.from_assignee_id, h.to_assignee_id)
        )
      )
    ),
    false
  );
$$;

-- Права снимаем у public, anon и service_role, выдаём только authenticated (раздел 3.1 «Права»).
revoke all on function
  private.current_user_role(),
  private.is_manager(),
  private.is_executor(),
  private.can_read_task(uuid),
  private.has_task_in_object(uuid),
  private.can_read_profile(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  private.current_user_role(),
  private.is_manager(),
  private.is_executor(),
  private.can_read_task(uuid),
  private.has_task_in_object(uuid),
  private.can_read_profile(uuid)
to authenticated;
