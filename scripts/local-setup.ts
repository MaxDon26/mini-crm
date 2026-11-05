// Готовит локальный запуск: пишет настройки сайта в .env.local и заводит четырёх тестовых пользователей
// с ролями. Работает только с локальной Supabase: секретный ключ берётся из `supabase status` и никуда не
// записывается. Пароли создаются случайно и хранятся только в .env.local (файл вне git).
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

type Role = 'manager' | 'executor';
type LocalUser = { envPrefix: string; email: string; fullName: string; role: Role };

const ENV_FILE = '.env.local';
const USERS: readonly LocalUser[] = [
  {
    envPrefix: 'SEED_MANAGER_1',
    email: 'anna@example.test',
    fullName: 'Анна Петрова',
    role: 'manager',
  },
  {
    envPrefix: 'SEED_MANAGER_2',
    email: 'boris@example.test',
    fullName: 'Борис Смирнов',
    role: 'manager',
  },
  {
    envPrefix: 'SEED_EXECUTOR_1',
    email: 'ivan@example.test',
    fullName: 'Иван Кузнецов',
    role: 'executor',
  },
  {
    envPrefix: 'SEED_EXECUTOR_2',
    email: 'petr@example.test',
    fullName: 'Пётр Волков',
    role: 'executor',
  },
];

function readLocalStatus(): Record<string, string> {
  const output = execSync('npx --no-install supabase status -o env', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const entries = output
    .split(/\r?\n/)
    .map((line) => /^([A-Z0-9_]+)="?(.*?)"?\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [match[1] ?? '', match[2] ?? ''] as const);
  return Object.fromEntries(entries);
}

function requireValue(status: Record<string, string>, name: string): string {
  const value = status[name];
  if (!value)
    throw new Error(
      `Локальная Supabase не запущена или не отдала ${name}: выполните npm run db:start`,
    );
  return value;
}

/** Заменяет или дописывает строки, остальные строки файла сохраняет. */
function writeEnv(values: Record<string, string>): void {
  const kept = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line && !Object.hasOwn(values, line.slice(0, line.indexOf('='))))
    : [];
  const added = Object.entries(values).map(([name, value]) => `${name}=${value}`);
  writeFileSync(ENV_FILE, [...kept, ...added].join('\n') + '\n');
}

async function createUsers(status: Record<string, string>): Promise<Record<string, string>> {
  const admin = createClient(requireValue(status, 'API_URL'), requireValue(status, 'SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = new pg.Client({ connectionString: requireValue(status, 'DB_URL') });
  await db.connect();
  const values: Record<string, string> = {};
  try {
    for (const user of USERS) {
      const password = randomBytes(12).toString('hex');
      // Прямой запрос, а не список API администратора: тот отдаёт пользователей постранично, и после
      // прогонов тестов нужного email на первой странице может не оказаться.
      const found = await db.query<{ id: string }>('select id from auth.users where email = $1', [
        user.email,
      ]);
      const existing = found.rows[0];
      // Повторный запуск не плодит пользователей: существующему задаётся новый пароль.
      const { data, error } = existing
        ? await admin.auth.admin.updateUserById(existing.id, { password })
        : await admin.auth.admin.createUser({ email: user.email, password, email_confirm: true });
      if (error) throw error;
      // Профиль создаёт база при появлении пользователя, роль и имя задаются здесь (Р7).
      await db.query('update public.profiles set full_name = $1, role = $2 where id = $3', [
        user.fullName,
        user.role,
        data.user.id,
      ]);
      values[`${user.envPrefix}_EMAIL`] = user.email;
      values[`${user.envPrefix}_PASSWORD`] = password;
    }
  } finally {
    await db.end();
  }
  return values;
}

const status = readLocalStatus();
const users = await createUsers(status);
writeEnv({
  VITE_SUPABASE_URL: requireValue(status, 'API_URL'),
  VITE_SUPABASE_KEY: requireValue(status, 'PUBLISHABLE_KEY'),
  ...users,
});
console.log(
  `Готово: ${ENV_FILE} заполнен, пользователей ${USERS.length}. Пароли смотрите в этом файле.`,
);
