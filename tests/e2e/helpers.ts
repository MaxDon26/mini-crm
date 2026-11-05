// Вход и подготовка данных для браузерных тестов. Всё идёт только в локальную Supabase.
import { randomUUID } from 'node:crypto';
import { expect as baseExpect, test as base } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/shared/database.types.ts';

const ENV_FILE = '.env.local';
const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/;

function loadEnv(): void {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    throw new Error(
      `Не удалось прочитать ${ENV_FILE}: файл нужен браузерным тестам. Создайте его по README, образец — .env.example.`,
    );
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`В ${ENV_FILE} не задано значение ${name}. Образец — .env.example.`);
  return value;
}

loadEnv();

const supabaseUrl = requireEnv('VITE_SUPABASE_URL');
// Тесты создают данные: случайный запуск на настройках облака засорил бы настоящий проект.
if (!LOCAL_URL.test(supabaseUrl)) {
  throw new Error(`В ${ENV_FILE} VITE_SUPABASE_URL должен вести на локальную Supabase.`);
}

// В локальной базе много данных, и вместе с первой сборкой страницы ответ бывает дольше 5 секунд.
export const expect = baseExpect.configure({ timeout: 15_000 });

export type TestUser = { envPrefix: string; name: string; home: string };

export const USERS = {
  anna: { envPrefix: 'SEED_MANAGER_1', name: 'Анна Петрова', home: '/objects' },
  boris: { envPrefix: 'SEED_MANAGER_2', name: 'Борис Смирнов', home: '/objects' },
  ivan: { envPrefix: 'SEED_EXECUTOR_1', name: 'Иван Кузнецов', home: '/my-tasks' },
} as const satisfies Record<string, TestUser>;

export function credentials(user: TestUser): { email: string; password: string } {
  return {
    email: requireEnv(`${user.envPrefix}_EMAIL`),
    password: requireEnv(`${user.envPrefix}_PASSWORD`),
  };
}

export function uniqueName(prefix: string): string {
  return `e2e ${prefix} ${randomUUID().slice(0, 8)}`;
}

export async function signInThroughForm(page: Page, user: TestUser): Promise<void> {
  const { email, password } = credentials(user);
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(user.home);
  await expect(page.getByRole('banner').getByText(user.name)).toBeVisible();
}

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

// Supabase разрешает 30 входов за 5 минут с одного адреса (supabase/config.toml), а два прогона
// подряд и тесты базы делят этот предел. Форму проверяет сценарий 29, остальным хватает сессии.
const savedSessions = new Map<string, StorageState>();

export type OpenAs = (user: TestUser, options?: { viaForm?: boolean }) => Promise<Page>;

export const test = base.extend<{ openAs: OpenAs }>({
  openAs: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (user, options = {}) => {
      const saved = options.viaForm ? undefined : savedSessions.get(user.envPrefix);
      const context = await browser.newContext(saved ? { storageState: saved } : {});
      contexts.push(context);
      const page = await context.newPage();
      if (!saved) {
        await signInThroughForm(page, user);
        savedSessions.set(user.envPrefix, await context.storageState());
      }
      return page;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export async function createObjectInUi(page: Page, name: string, address: string): Promise<void> {
  await page.getByRole('button', { name: 'Создать объект' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название').fill(name);
  await dialog.getByLabel('Адрес').fill(address);
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function fillTaskForm(
  page: Page,
  fields: { title: string; description: string; assignee: string },
): Promise<void> {
  await page.getByRole('button', { name: 'Создать задачу' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название').fill(fields.title);
  await dialog.getByLabel('Описание').fill(fields.description);
  await dialog.getByLabel('Исполнитель').click();
  await page.getByRole('option', { name: fields.assignee, exact: true }).click();
}

type DbClient = SupabaseClient<Database>;

// Клиент на пользователя живёт весь прогон: это экономит входы (см. savedSessions).
const apiClients = new Map<string, { client: DbClient; userId: string }>();

async function apiClient(user: TestUser): Promise<{ client: DbClient; userId: string }> {
  const known = apiClients.get(user.envPrefix);
  if (known) return known;
  const client = createClient<Database>(supabaseUrl, requireEnv('VITE_SUPABASE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword(credentials(user));
  if (error) throw new Error(`Не удалось войти через API как ${user.name}: ${error.code}`);
  const signedIn = { client, userId: data.user.id };
  apiClients.set(user.envPrefix, signedIn);
  return signedIn;
}

export type ArrangedTask = {
  objectId: string;
  objectName: string;
  taskId: string;
  taskTitle: string;
};

export async function arrangeObject(): Promise<{ objectId: string; objectName: string }> {
  const { client } = await apiClient(USERS.anna);
  const objectName = uniqueName('объект');
  const { data, error } = await client
    .from('objects')
    .insert({ name: objectName, address: 'Адрес для проверки' })
    .select('id')
    .single();
  if (error) throw new Error(`Не удалось создать объект: ${error.message}`);
  return { objectId: data.id, objectName };
}

/** Новая задача у Ивана. Подготовка через API, потому что формы проверяют сценарии 29 и 30. */
export async function arrangeNewTask(): Promise<ArrangedTask> {
  const { objectId, objectName } = await arrangeObject();
  const { client } = await apiClient(USERS.anna);
  const { userId: assigneeId } = await apiClient(USERS.ivan);
  const taskTitle = uniqueName('задача');
  const { data, error } = await client
    .from('tasks')
    .insert({ title: taskTitle, object_id: objectId, assignee_id: assigneeId })
    .select('id')
    .single();
  if (error) throw new Error(`Не удалось создать задачу: ${error.message}`);
  return { objectId, objectName, taskId: data.id, taskTitle };
}

export async function arrangeTaskInReview(): Promise<ArrangedTask> {
  const task = await arrangeNewTask();
  const { client } = await apiClient(USERS.ivan);
  const steps = [
    { p_expected_status: 'new', p_new_status: 'in_progress' },
    { p_expected_status: 'in_progress', p_new_status: 'in_review' },
  ] as const;
  for (const step of steps) {
    const { error } = await client.rpc('change_task_status', { p_task_id: task.taskId, ...step });
    if (error) throw new Error(`Не удалось сменить статус: ${error.message}`);
  }
  return task;
}
