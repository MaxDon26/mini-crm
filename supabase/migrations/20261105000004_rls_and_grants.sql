-- Права ролей и правила RLS (раздел 3.1, контракт 3.8, ТЗ п. 3.1, п. 3.2, п. 3.4).

-- Права на таблицы явные: новые проекты не выдают их автоматически, старые выдают всем, поэтому
-- сначала снимаем всё. Роль service_role прав не получает: секретный ключ обходит RLS, но не права (Р14).
revoke all on table public.profiles, public.objects, public.tasks, public.task_history
  from public, anon, authenticated, service_role;
revoke all on sequence public.task_history_id_seq
  from public, anon, authenticated, service_role;

grant usage on schema public to authenticated;

grant select on table public.profiles, public.objects, public.tasks, public.task_history
  to authenticated;

-- Запись только по перечисленным колонкам: право на всю таблицу отменило бы запрет на отдельную.
-- Статус, автор, даты и отметка «удалена» через API не меняются (раздел 3.1, ТЗ п. 3.3).
-- Удаления строк нет ни у кого (Р2).
grant insert (name, address), update (name, address)
  on table public.objects to authenticated;
grant insert (title, description, object_id, assignee_id),
      update (title, description, object_id, assignee_id)
  on table public.tasks to authenticated;

-- Профили: постановщик видит все, исполнитель себя и причастных (Р10). Записи нет: роль и имя
-- пользователь не меняет (Р6).
create policy profiles_select on public.profiles
  for select to authenticated
  using (private.can_read_profile(id));

-- Объекты: постановщик видит все, исполнитель только те, где есть его задача. Удалённое никому (Р5).
create policy objects_select on public.objects
  for select to authenticated
  using (
    deleted_at is null
    and (
      (select private.is_manager())
      or ((select private.is_executor()) and private.has_task_in_object(id))
    )
  );

-- Создание объекта: только постановщик (раздел 3.1 «Кто что может»).
create policy objects_insert on public.objects
  for insert to authenticated
  with check ((select private.is_manager()));

-- Правка объекта: только постановщик и только неудалённый (раздел 3.1 «Удаление»).
create policy objects_update on public.objects
  for update to authenticated
  using ((select private.is_manager()) and deleted_at is null)
  with check ((select private.is_manager()));

-- Задачи: постановщик видит все, исполнитель только свои, удалённое никому (ТЗ п. 3.2, Р5).
-- Условие на полях самой строки, а не can_read_task: при insert ... returning новая строка
-- проверяется до вставки, и функция, ищущая её в таблице, не нашла бы её и дала бы отказ.
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and (
      (select private.is_manager())
      or ((select private.is_executor()) and assignee_id = (select auth.uid()))
    )
  );

-- Создание задачи: только постановщик (раздел 3.1 «Кто что может»).
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check ((select private.is_manager()));

-- Правка задачи: только постановщик и только неудалённая, исполнителю закрыта любая (Р11).
create policy tasks_update on public.tasks
  for update to authenticated
  using ((select private.is_manager()) and deleted_at is null)
  with check ((select private.is_manager()));

-- История: читает тот, кто может читать задачу, записи создаёт только база (ТЗ п. 2.4, п. 3.4).
create policy task_history_select on public.task_history
  for select to authenticated
  using (private.can_read_task(task_id));
