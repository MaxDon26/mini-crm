-- Автоматическое создание профилей (Р7): человек не может войти без роли из-за забытого ручного шага.

-- Имя по умолчанию: часть email до @. Значение обязано пройти проверку таблицы, иначе сбой
-- помешает создать пользователя, поэтому пустой и слишком длинный случаи обработаны здесь.
create function private.full_name_from_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when private.has_text(left(split_part(p_email, '@', 1), 200))
      then left(split_part(p_email, '@', 1), 200)
    else 'Без имени'
  end;
$$;
revoke all on function private.full_name_from_email(text)
  from public, anon, authenticated, service_role;

-- Создаёт профиль новому пользователю с ролью «исполнитель». Метаданные пользователя не читает:
-- он может править их сам (Р6). Повышенные права нужны, потому что вставку выполняет роль сервиса
-- входа, у которой нет прав на наши таблицы.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, private.full_name_from_email(new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Профили пользователям, созданным до этой миграции (раздел 3.1 «Профили»).
insert into public.profiles (id, full_name)
select u.id, private.full_name_from_email(u.email)
from auth.users u
on conflict (id) do nothing;
