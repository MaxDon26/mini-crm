-- Действия базы: смена статуса, удаление задачи и объекта (Р2, Р3, Р11, Р12, Р13, ТЗ п. 2.3, п. 3.3).
-- Логика лежит в private с повышенными правами: статус и отметка закрыты правами на колонки, а история
-- для authenticated вообще закрыта на запись. Сайт вызывает тонкие обёртки в public без повышенных прав.
-- Функции изменяемые: при READ COMMITTED каждый их запрос видит то, что зафиксировано к его началу,
-- поэтому после ожидания блокировки решение принимается по свежим данным.

-- Смена статуса (ТЗ п. 2.3, п. 3.3, Р11, Р12). Порядок: блокировка, доступ, ожидаемый статус, переход,
-- комментарий, действие. Нет доступа — один ответ до любых проверок статуса, иначе сообщение раскрыло бы
-- чужой статус. Блокировка делает так, что при двух одновременных нажатиях проходит только первое.
create function private.change_task_status(
  p_task_id uuid,
  p_expected_status public.task_status,
  p_new_status public.task_status,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.task_status;
  v_is_manager boolean;
  v_is_assignee boolean;
  v_allowed boolean;
begin
  select t.status into v_status
  from public.tasks t
  where t.id = p_task_id
  for update;

  if not private.can_read_task(p_task_id) then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;

  -- Статус, который видел пользователь, может быть пустым: обычное сравнение дало бы NULL и пропустило бы.
  if p_expected_status is distinct from v_status then
    raise exception 'status_changed' using errcode = 'P0001';
  end if;

  -- После проверки доступа исполнитель — это назначенный: чужому can_read_task уже отказал.
  v_is_manager := private.is_manager();
  v_is_assignee := private.is_executor();

  -- Таблица переходов ТЗ п. 2.3. Постановщик на переходе исполнителя и наоборот получают отказ:
  -- принимает любой постановщик (Р12), двигает работу только назначенный исполнитель.
  v_allowed := case
    when v_status = 'new' and p_new_status = 'in_progress' then v_is_assignee
    when v_status = 'in_progress' and p_new_status = 'in_review' then v_is_assignee
    when v_status = 'in_review' and p_new_status = 'accepted' then v_is_manager
    when v_status = 'in_review' and p_new_status = 'rework' then v_is_manager
    when v_status = 'rework' and p_new_status = 'in_progress' then v_is_assignee
    else false
  end;

  if v_allowed is not true then
    raise exception 'transition_forbidden' using errcode = 'P0001';
  end if;

  -- При возврате комментарий обязателен, при остальных переходах необязателен (раздел 3.1).
  if p_new_status = 'rework' and not private.has_text(p_comment) then
    raise exception 'comment_required' using errcode = 'P0001';
  end if;

  update public.tasks set status = p_new_status where id = p_task_id;

  -- Автор и время от базы (ТЗ п. 3.4). Пробельный комментарий хранится как пустое значение.
  insert into public.task_history (task_id, actor_id, from_status, to_status, comment)
  values (
    p_task_id,
    auth.uid(),
    v_status,
    p_new_status,
    case when private.has_text(p_comment) then p_comment end
  );
end;
$$;

-- Удаление задачи только скрывает её и хранит кто и когда (Р2, раздел 3.1). Принятую удалить можно (Р8).
-- Чужую задачу исполнитель не отличит от несуществующей, а на свою получает отказ в правах.
create function private.delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.tasks t where t.id = p_task_id for update;

  if not private.can_read_task(p_task_id) then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;

  if not private.is_manager() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.tasks
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_task_id;
end;
$$;

-- Удаление объекта вместе с живыми задачами (Р3). Роль проверяется до обращения к объекту, чтобы ответ
-- не раскрывал, существует ли он. Блокировка FOR UPDATE ждёт создание и перенос задач, взявшие FOR SHARE:
-- они попадут под удаление, а начавшие позже получат отказ. Запрос на задачи идёт после блокировки, поэтому
-- видит такие задачи. Уже удалённые задачи сохраняют свою отметку.
create function private.delete_object(p_object_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_at timestamptz;
  v_now timestamptz := now();
begin
  if not private.is_manager() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select o.deleted_at into v_deleted_at
  from public.objects o
  where o.id = p_object_id
  for update;

  if not found or v_deleted_at is not null then
    raise exception 'object_not_found' using errcode = 'P0001';
  end if;

  update public.objects
  set deleted_at = v_now, deleted_by = auth.uid()
  where id = p_object_id;

  update public.tasks
  set deleted_at = v_now, deleted_by = auth.uid()
  where object_id = p_object_id
    and deleted_at is null;
end;
$$;

-- Обёртка смены статуса для сайта: без логики и без повышенных прав (Р13).
create function public.change_task_status(
  p_task_id uuid,
  p_expected_status public.task_status,
  p_new_status public.task_status,
  p_comment text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.change_task_status(p_task_id, p_expected_status, p_new_status, p_comment);
$$;

-- Обёртка удаления задачи для сайта: без логики и без повышенных прав (Р13).
create function public.delete_task(p_task_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_task(p_task_id);
$$;

-- Обёртка удаления объекта для сайта: без логики и без повышенных прав (Р13).
create function public.delete_object(p_object_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_object(p_object_id);
$$;

-- Вызвать можно только после входа (раздел 3.1 «Права»). Обёртка работает с правами вызывающего, поэтому
-- право нужно и на неё, и на функцию в private; саму схему private через API не вызвать.
revoke all on function
  private.change_task_status(uuid, public.task_status, public.task_status, text),
  private.delete_task(uuid),
  private.delete_object(uuid),
  public.change_task_status(uuid, public.task_status, public.task_status, text),
  public.delete_task(uuid),
  public.delete_object(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  private.change_task_status(uuid, public.task_status, public.task_status, text),
  private.delete_task(uuid),
  private.delete_object(uuid),
  public.change_task_status(uuid, public.task_status, public.task_status, text),
  public.delete_task(uuid),
  public.delete_object(uuid)
to authenticated;
