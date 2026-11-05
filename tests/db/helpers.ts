// Помощники тестов защиты базы (контракт, раздел 3.8). Работают только с локальной Supabase:
// секретный ключ и подключение postgres нужны для подготовки данных и обзора, а доказательством
// считаются только запросы через API с токеном участника.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Pool, type QueryResultRow } from 'pg';
import type { Database, Tables, TablesInsert } from '../../src/shared/database.types.ts';

export type DbClient = SupabaseClient<Database>;
export type AppRole = Database['public']['Enums']['app_role'];
export type TaskStatus = Database['public']['Enums']['task_status'];
export type ObjectRow = Tables<'objects'>;
export type TaskRow = Tables<'tasks'>;

export interface TestUser {
  id: string;
  email: string;
  client: DbClient;
}

const LOCAL_HOST = /^(https?|postgres(ql)?):\/\/([^/@]*@)?(127\.0\.0\.1|localhost)[:/]/;

function readLocalEnv(): Record<string, string> {
  const output = execSync('npx --no-install supabase status -o env', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const env: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2];
  }
  return env;
}

function requireEnv(env: Record<string, string>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`В выводе supabase status нет ${name}: локальная база запущена?`);
  return value;
}

const env = readLocalEnv();
const API_URL = requireEnv(env, 'API_URL');
const DB_URL = requireEnv(env, 'DB_URL');
const ANON_KEY = requireEnv(env, 'ANON_KEY');
const PUBLISHABLE_KEY = requireEnv(env, 'PUBLISHABLE_KEY');
const SERVICE_ROLE_KEY = requireEnv(env, 'SERVICE_ROLE_KEY');

// Р21: на сдаваемой базе тесты не запускаем.
if (!LOCAL_HOST.test(API_URL) || !LOCAL_HOST.test(DB_URL)) {
  throw new Error('Тесты базы запускаются только на локальной Supabase');
}

const pool = new Pool({ connectionString: DB_URL, max: 4, allowExitOnIdle: true });

function newClient(key: string): DbClient {
  return createClient<Database>(API_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const adminClient = newClient(SERVICE_ROLE_KEY);

/** Публичные значения для запросов мимо supabase-js. Секретного ключа здесь нет. */
export const localApi = { url: API_URL, publishableKey: PUBLISHABLE_KEY };

/** Прямое подключение postgres. Обходит RLS: только подготовка данных и обзор базы. */
export async function sql<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  const result = await pool.query<Row>(text, [...params]);
  return result.rows;
}

/**
 * Запрос от указанного пользователя внутри отменяемой транзакции. Нужен там, куда не дойти через API:
 * служебным функциям (роль authenticated) и триггерам, когда права и RLS не должны сработать раньше
 * них (роль postgres, у неё прав хватает, а пользователь в запросе есть).
 */
export async function sqlAs<Row extends QueryResultRow = QueryResultRow>(
  userId: string | null,
  text: string,
  params: readonly unknown[] = [],
  role: 'authenticated' | 'postgres' = 'authenticated',
): Promise<Row[]> {
  const connection = await pool.connect();
  try {
    await connection.query('begin');
    const claims = userId ? { sub: userId, role: 'authenticated' } : { role: 'authenticated' };
    await connection.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claims),
    ]);
    if (role === 'authenticated') await connection.query('set local role authenticated');
    const result = await connection.query<Row>(text, [...params]);
    return result.rows;
  } finally {
    await connection.query('rollback');
    connection.release();
  }
}

/** Держит транзакцию postgres открытой, пока работает body, и фиксирует её: для проверки блокировок. */
export async function inTransaction<Result>(
  body: (query: (text: string, params?: readonly unknown[]) => Promise<unknown>) => Promise<Result>,
): Promise<Result> {
  const connection = await pool.connect();
  try {
    await connection.query('begin');
    const result = await body((text, params = []) => connection.query(text, [...params]));
    await connection.query('commit');
    return result;
  } catch (error) {
    await connection.query('rollback');
    throw error;
  } finally {
    connection.release();
  }
}

/** Отказ базы: код чистым текстом в message (контракт 3.8). Права дают 42501, остальные правила P0001. */
export function assertRefusal(
  response: { error: { code?: string; message?: string } | null },
  refusal: string,
  label = refusal,
): void {
  assert.equal(response.error?.message, refusal, `${label}: ${JSON.stringify(response.error)}`);
  assert.equal(response.error?.code, refusal === 'forbidden' ? '42501' : 'P0001', label);
}

/** Клиент без входа. По умолчанию с тем ключом, что на новых проектах получает сайт. */
export function guestClient(key: 'publishable' | 'anon' = 'publishable'): DbClient {
  return newClient(key === 'publishable' ? PUBLISHABLE_KEY : ANON_KEY);
}

/** Клиент с ключом service_role: прав на наши таблицы у него быть не должно (Р14). */
export function serviceClient(): DbClient {
  return newClient(SERVICE_ROLE_KEY);
}

/** Создаёт пользователя через API администратора и входит им: профиль заводит сама база (Р7). */
export async function createUser(
  role: AppRole = 'executor',
  metadata?: Record<string, string>,
): Promise<TestUser> {
  const email = `${role}.${randomUUID()}@example.com`;
  const password = randomUUID();
  const created = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (created.error) throw new Error(`createUser: ${created.error.message}`);
  const id = created.data.user.id;

  if (role !== 'executor') {
    await sql('update public.profiles set role = $2 where id = $1', [id, role]);
  }

  const client = newClient(PUBLISHABLE_KEY);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`createUser, вход: ${signedIn.error.message}`);
  return { id, email, client };
}

/** Создаёт объект через API, клиент должен быть постановщика. */
export async function createObject(
  client: DbClient,
  fields: Partial<TablesInsert<'objects'>> = {},
): Promise<ObjectRow> {
  const suffix = randomUUID();
  const { data, error } = await client
    .from('objects')
    .insert({ name: `Объект ${suffix}`, address: `Адрес ${suffix}`, ...fields })
    .select()
    .single();
  if (error) throw new Error(`createObject: ${error.code} ${error.message}`);
  return data;
}

export type TaskFields = Pick<TablesInsert<'tasks'>, 'object_id'> &
  Partial<Pick<TablesInsert<'tasks'>, 'title' | 'description' | 'assignee_id'>>;

/** Создаёт задачу через API, клиент должен быть постановщика. */
export async function createTask(client: DbClient, fields: TaskFields): Promise<TaskRow> {
  const { data, error } = await client
    .from('tasks')
    .insert({ title: `Задача ${randomUUID()}`, ...fields })
    .select()
    .single();
  if (error) throw new Error(`createTask: ${error.code} ${error.message}`);
  return data;
}

// Исполнителя здесь нет: без текущего пользователя база отказывает в его смене. Назначайте его
// при создании или правкой постановщика через API.
export type TaskStateFields = Partial<
  Pick<TaskRow, 'status' | 'author_id' | 'deleted_at' | 'deleted_by'>
>;

/** Прямой правкой ставит задачу в нужное состояние. Только подготовка данных, не доказательство. */
export async function setTaskState(taskId: string, fields: TaskStateFields): Promise<void> {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const assignments = entries.map(([column], index) => `"${column}" = $${index + 2}`).join(', ');
  const values = entries.map(([, value]) => value);
  await sql(`update public.tasks set ${assignments} where id = $1`, [taskId, ...values]);
}
