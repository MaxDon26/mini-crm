-- Объект задачи задаётся при создании и не меняется (Р28, отменяет перенос из Р8), и ещё три
-- невидимых символа считаются пробельными (раздел 3.1 «Обязательные значения»).

-- Правка объекта закрыта правом на колонку: запрос с object_id получает отказ 42501 раньше любых
-- триггеров, поэтому ответ не зависит от того, существует ли целевой объект. Вставка остаётся (3.8).
revoke update (object_id) on table public.tasks from authenticated;

-- Правка задачи постановщиком (Р8): принятую менять нельзя, снять исполнителя можно только у «Новой»,
-- назначить можно только исполнителя. Роль назначаемого проверяется только при смене, поэтому правка
-- названия не падает, если исполнитель сменил роль. Ветки переноса нет: объект не меняется (Р28).
create or replace function private.check_task_update()
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

-- Следит только за тремя полями, которые правит постановщик: статус и отметку «удалена» меняют
-- действия базы, в том числе у принятых задач (Р8, раздел 3.1). Сравнение учитывает пустые значения.
drop trigger tasks_check_update on public.tasks;
create trigger tasks_check_update
  before update on public.tasks
  for each row
  when (
    old.title is distinct from new.title
    or old.description is distinct from new.description
    or old.assignee_id is distinct from new.assignee_id
  )
  execute function private.check_task_update();

-- Непустой текст: есть хотя бы один видимый символ (раздел 3.1). К прежнему набору добавлены мягкий
-- перенос U+00AD и невидимые разъединитель и соединитель U+200C, U+200D: строка только из них на
-- экране пуста. Тот же набор на сайте — src/shared/text.ts. Права на функцию сохраняются.
create or replace function private.has_text(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_value ~ '[^\u0009-\u000D\u0020\u0085\u00A0\u00AD\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]',
    false
  );
$$;
