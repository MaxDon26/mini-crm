-- Создание и правка задач, запись истории (раздел 3.1, Р8, Р9, Р14, ТЗ п. 2.3, п. 2.4, п. 3.4).
-- Отказ передаётся кодом в тексте ошибки: forbidden с ERRCODE 42501, остальные правила с P0001.
-- Триггерные функции читают то, что постановщику через RLS не видно (удалённый объект), и пишут
-- историю, на которую у authenticated нет прав, поэтому работают с повышенными правами.

-- Блокирует целевой объект и проверяет отметку «удалена» (раздел 3.1 «Удаление»). FOR SHARE заставляет
-- дождаться незавершённого удаления объекта и не даёт ему пройти до конца нашей транзакции, поэтому
-- живая задача не остаётся в удалённом объекте. Пустой объект отклонит обязательность колонки (23502).
create function private.lock_live_object(p_object_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_deleted_at timestamptz;
begin
  if p_object_id is null then
    return;
  end if;

  select o.deleted_at into v_deleted_at
  from public.objects o
  where o.id = p_object_id
  for share;

  if not found or v_deleted_at is not null then
    raise exception 'object_not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Назначить можно только пользователя с ролью исполнителя (раздел 2.3). Только точное совпадение:
-- профиля нет или роль другая — отказ.
create function private.check_assignee_is_executor(p_assignee_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = p_assignee_id and p.role = 'executor'
  ) then
    raise exception 'assignee_not_executor' using errcode = 'P0001';
  end if;
end;
$$;

-- Создание задачи (раздел 3.1, ТЗ п. 2.3). Роль проверяется первой и ответ один, потому что этот триггер
-- срабатывает раньше проверки RLS: иначе исполнитель узнавал бы о чужих объектах и пользователях по
-- разным ответам. Без текущего пользователя роли нет, поэтому отказ. Статус, автора и дату ставит база.
create function private.prepare_new_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_manager() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_live_object(new.object_id);

  if new.assignee_id is not null then
    perform private.check_assignee_is_executor(new.assignee_id);
  end if;

  new.status := 'new';
  new.author_id := auth.uid();
  new.created_at := now();
  new.deleted_at := null;
  new.deleted_by := null;
  return new;
end;
$$;

create trigger tasks_prepare_new
  before insert on public.tasks
  for each row execute function private.prepare_new_task();

-- Первая запись истории «— → Новая», создание сразу с исполнителем — одна запись (Р9). После вставки,
-- потому что запись ссылается на задачу.
create function private.log_task_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_history (task_id, actor_id, to_status, to_assignee_id)
  values (new.id, new.author_id, new.status, new.assignee_id);
  return null;
end;
$$;

create trigger tasks_log_created
  after insert on public.tasks
  for each row execute function private.log_task_created();

-- Правка задачи постановщиком (Р8): принятую менять нельзя, снять исполнителя можно только у «Новой»,
-- назначить можно только исполнителя, перенести только в живой объект. Роль назначаемого проверяется
-- только при смене, поэтому правка названия не падает, если исполнитель сменил роль.
create function private.check_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_manager() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if old.status = 'accepted' then
    raise exception 'task_accepted' using errcode = 'P0001';
  end if;

  if new.object_id is distinct from old.object_id then
    perform private.lock_live_object(new.object_id);
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if new.assignee_id is not null then
      perform private.check_assignee_is_executor(new.assignee_id);
    elsif old.status <> 'new' then
      raise exception 'assignee_required' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- Следит только за четырьмя полями: статус и отметку «удалена» меняют действия базы, в том числе
-- у принятых задач (Р8, раздел 3.1). Сравнение учитывает пустые значения.
create trigger tasks_check_update
  before update on public.tasks
  for each row
  when (
    old.title is distinct from new.title
    or old.description is distinct from new.description
    or old.object_id is distinct from new.object_id
    or old.assignee_id is distinct from new.assignee_id
  )
  execute function private.check_task_update();

-- Смена исполнителя пишется в общую историю (Р9). Кто и когда — от базы. Смена на того же записи не создаёт.
create function private.log_assignee_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_history (task_id, actor_id, from_assignee_id, to_assignee_id)
  values (new.id, auth.uid(), old.assignee_id, new.assignee_id);
  return null;
end;
$$;

create trigger tasks_log_assignee_change
  after update on public.tasks
  for each row
  when (old.assignee_id is distinct from new.assignee_id)
  execute function private.log_assignee_change();

-- Историю нельзя изменить и удалить никому, кто не владеет базой (Р14, ТЗ п. 3.4). Вставку закрывают
-- права: записи создают только функции базы. Срабатывает на весь запрос, поэтому и очистка таблицы
-- получает отказ. Повышенные права не нужны: функция только отказывает.
create function private.forbid_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'history_immutable' using errcode = 'P0001';
end;
$$;

create trigger task_history_immutable
  before update or delete or truncate on public.task_history
  for each statement execute function private.forbid_history_change();

-- Триггеры срабатывают без права на вызов, а напрямую этих функций никому вызывать незачем (раздел 3.1).
revoke all on function
  private.lock_live_object(uuid),
  private.check_assignee_is_executor(uuid),
  private.prepare_new_task(),
  private.log_task_created(),
  private.check_task_update(),
  private.log_assignee_change(),
  private.forbid_history_change()
from public, anon, authenticated, service_role;
