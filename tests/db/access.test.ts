// З3: сценарии 1, 2, 3, 5, 8, 13, 26, 27 и те части сценариев З4 и З5, что зависят только от правил
// чтения. Каждый запрет доказывается запросом через API, а прямое подключение лишь сверяет,
// что данные не изменились.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createObject,
  createTask,
  createUser,
  guestClient,
  localApi,
  serviceClient,
  setTaskState,
  sql,
  sqlAs,
  type DbClient,
  type ObjectRow,
  type TaskRow,
  type TestUser,
} from './helpers.ts';

const PG_PERMISSION_DENIED = '42501';
const PG_CHECK_VIOLATION = '23514';
const PG_NOT_NULL_VIOLATION = '23502';
const POSTGREST_FUNCTION_NOT_FOUND = 'PGRST202';
const POSTGREST_INVALID_SCHEMA = 'PGRST106';

const TABLES = ['objects', 'profiles', 'task_history', 'tasks'] as const;
const ACCESS_HELPERS = [
  'can_read_profile',
  'can_read_task',
  'current_user_role',
  'has_task_in_object',
  'is_executor',
  'is_manager',
] as const;
const ACTIONS = ['change_task_status', 'delete_object', 'delete_task'] as const;

type Row = Record<string, unknown>;

/** Обобщённый клиент для перебора таблиц и функций, которых нет в созданных типах. */
function untyped(client: DbClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function ids(rows: readonly { id: string | number }[] | null): string[] {
  return (rows ?? []).map((row) => String(row.id)).sort();
}

function assertDenied(response: { error: { code?: string } | null }, label: string): void {
  assert.equal(response.error?.code, PG_PERMISSION_DENIED, `${label}: ${JSON.stringify(response)}`);
}

/** Правка прошла правила прав на колонки, но RLS не дал ни одной строки: ответ пустой, без ошибки. */
function assertNothingUpdated(
  response: { error: unknown; data: readonly unknown[] | null },
  label: string,
): void {
  assert.equal(response.error, null, `${label}: ${JSON.stringify(response.error)}`);
  assert.deepEqual(response.data, [], label);
}

async function rowSnapshot(table: string, id: string | number): Promise<Row | undefined> {
  const [row] = await sql(`select * from public.${table} where id = $1`, [id]);
  return row;
}

async function addHistory(fields: {
  task_id: string;
  actor_id: string;
  from_status?: string;
  to_status?: string;
  from_assignee_id?: string;
  to_assignee_id?: string;
}): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into public.task_history
       (task_id, actor_id, from_status, to_status, from_assignee_id, to_assignee_id)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      fields.task_id,
      fields.actor_id,
      fields.from_status ?? null,
      fields.to_status ?? null,
      fields.from_assignee_id ?? null,
      fields.to_assignee_id ?? null,
    ],
  );
  assert.ok(row);
  return row.id;
}

interface World {
  manager: TestUser;
  uninvolvedManager: TestUser;
  executor: TestUser;
  stranger: TestUser;
  sharedObject: ObjectRow;
  foreignObject: ObjectRow;
  emptyObject: ObjectRow;
  ownTask: TaskRow;
  neighbourTask: TaskRow;
  foreignTask: TaskRow;
  unassignedTask: TaskRow;
  ownHistoryId: string;
  foreignHistoryId: string;
}

/**
 * Общий объект с задачами двух исполнителей, чужой объект и пустой объект. Чужая задача создана
 * другим постановщиком: когда появится запись истории при создании (З4), он так и останется
 * посторонним для нашего исполнителя.
 */
async function createWorld(): Promise<World> {
  const [manager, uninvolvedManager, executor, stranger] = await Promise.all([
    createUser('manager'),
    createUser('manager'),
    createUser('executor'),
    createUser('executor'),
  ]);
  const [sharedObject, foreignObject, emptyObject] = await Promise.all([
    createObject(manager.client),
    createObject(uninvolvedManager.client),
    createObject(manager.client),
  ]);
  const [ownTask, neighbourTask, foreignTask, unassignedTask] = await Promise.all([
    createTask(manager.client, { object_id: sharedObject.id, assignee_id: executor.id }),
    createTask(uninvolvedManager.client, { object_id: sharedObject.id, assignee_id: stranger.id }),
    createTask(uninvolvedManager.client, { object_id: foreignObject.id, assignee_id: stranger.id }),
    createTask(uninvolvedManager.client, { object_id: sharedObject.id }),
  ]);
  const ownHistoryId = await addHistory({
    task_id: ownTask.id,
    actor_id: manager.id,
    to_status: 'new',
    to_assignee_id: executor.id,
  });
  const foreignHistoryId = await addHistory({
    task_id: foreignTask.id,
    actor_id: uninvolvedManager.id,
    to_status: 'new',
    to_assignee_id: stranger.id,
  });
  return {
    manager,
    uninvolvedManager,
    executor,
    stranger,
    sharedObject,
    foreignObject,
    emptyObject,
    ownTask,
    neighbourTask,
    foreignTask,
    unassignedTask,
    ownHistoryId,
    foreignHistoryId,
  };
}

/** Каждая таблица: чтение, создание, правка и удаление дают отказ, данные не меняются. */
async function assertNoTableAccess(client: DbClient, world: World, label: string): Promise<void> {
  const marker = `blocked-${randomUUID()}`;
  const targets = {
    profiles: {
      id: world.executor.id,
      insert: { id: randomUUID(), full_name: marker },
      update: { full_name: marker },
    },
    objects: {
      id: world.sharedObject.id,
      insert: { name: marker, address: marker },
      update: { name: marker },
    },
    tasks: {
      id: world.ownTask.id,
      insert: { title: marker, object_id: world.sharedObject.id },
      update: { title: marker },
    },
    task_history: {
      id: world.ownHistoryId,
      insert: { task_id: world.ownTask.id, actor_id: world.manager.id, to_status: 'new' },
      update: { comment: marker },
    },
  };

  for (const table of TABLES) {
    const target = targets[table];
    const before = await rowSnapshot(table, target.id);
    const api = untyped(client).from(table);
    assertDenied(await api.select('*'), `${label}: чтение ${table}`);
    assertDenied(await api.insert(target.insert as Row), `${label}: создание в ${table}`);
    assertDenied(await api.update(target.update).eq('id', target.id), `${label}: правка ${table}`);
    assertDenied(await api.delete().eq('id', target.id), `${label}: удаление из ${table}`);
    assert.deepEqual(await rowSnapshot(table, target.id), before, `${label}: строка ${table}`);
  }

  const [leaked] = await sql(
    `select 1 from public.objects where name = $1
     union all select 1 from public.tasks where title = $1
     union all select 1 from public.profiles where full_name = $1
     union all select 1 from public.task_history where comment = $1`,
    [marker],
  );
  assert.equal(leaked, undefined, `${label}: запись дошла до базы`);
}

function signJwt(payload: Row): string {
  const encode = (value: Row) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  const signature = createHmac('sha256', randomUUID()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

describe('Сценарий 1: гость', () => {
  let world: World;
  before(async () => {
    world = await createWorld();
  });

  for (const key of ['publishable', 'anon'] as const) {
    test(`ключ ${key}: каждая таблица закрыта на чтение и запись`, async () => {
      await assertNoTableAccess(guestClient(key), world, `гость (${key})`);
    });

    test(`ключ ${key}: действия вызвать нельзя`, async () => {
      const args = {
        change_task_status: {
          p_task_id: world.ownTask.id,
          p_expected_status: 'new',
          p_new_status: 'in_progress',
        },
        delete_task: { p_task_id: world.ownTask.id },
        delete_object: { p_object_id: world.sharedObject.id },
      };
      for (const action of ACTIONS) {
        const response = await untyped(guestClient(key)).rpc(action, args[action]);
        // До З5 действий ещё нет, поэтому принимаем и «не найдено»; в З5 останется только отказ в правах.
        assert.ok(
          response.error?.code === PG_PERMISSION_DENIED ||
            response.error?.code === POSTGREST_FUNCTION_NOT_FOUND,
          `${action}: ${JSON.stringify(response)}`,
        );
      }
      const [task] = await sql<TaskRow>('select * from public.tasks where id = $1', [
        world.ownTask.id,
      ]);
      assert.equal(task?.status, 'new');
      assert.equal(task?.deleted_at, null);
    });
  }

  test('поддельный токен с ролью authenticated не даёт доступа', async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: world.manager.id, role: 'authenticated', aud: 'authenticated' };
    const forged = signJwt({ ...claims, iat: now, exp: now + 3600 });
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ ...claims, iat: now, exp: now + 3600 }),
    ).toString('base64url')}.`;
    for (const token of [forged, unsigned]) {
      const client = createClient(localApi.url, localApi.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      for (const table of TABLES) {
        const response = await client.from(table).select('*');
        assert.ok(response.error, `${table}: ${JSON.stringify(response.data)}`);
        assert.equal(response.data, null);
      }
    }
  });

  test('описание API не показывает гостю наши таблицы', async () => {
    const response = await fetch(`${localApi.url}/rest/v1/`, {
      headers: { apikey: localApi.publishableKey, Accept: 'application/openapi+json' },
    });
    assert.equal(response.status, 200);
    const spec = (await response.json()) as { paths?: Record<string, unknown> };
    for (const table of TABLES) {
      assert.equal(spec.paths?.[`/${table}`], undefined, table);
    }
  });
});

describe('Сценарий 2: исполнитель не читает чужое', () => {
  let world: World;
  before(async () => {
    world = await createWorld();
  });

  test('задачи: видит только свои, в том числе по прямому запросу чужой', async () => {
    const { client } = world.executor;
    const all = await client.from('tasks').select('id');
    assert.equal(all.error, null);
    assert.deepEqual(ids(all.data), [world.ownTask.id]);

    for (const task of [world.neighbourTask, world.foreignTask, world.unassignedTask]) {
      const direct = await client.from('tasks').select('*').eq('id', task.id);
      assert.equal(direct.error, null);
      assert.deepEqual(direct.data, []);
    }

    const counted = await client.from('tasks').select('*', { count: 'exact', head: true });
    assert.equal(counted.count, 1, 'подсчёт не должен раскрывать чужие строки');
  });

  test('история: только по своим задачам', async () => {
    const { client } = world.executor;
    const all = await client.from('task_history').select('id, task_id');
    assert.equal(all.error, null);
    assert.ok(all.data && all.data.length > 0);
    assert.ok(all.data.every((row) => row.task_id === world.ownTask.id));
    assert.ok(all.data.some((row) => String(row.id) === world.ownHistoryId));

    const direct = await client
      .from('task_history')
      .select('*')
      .eq('task_id', world.foreignTask.id);
    assert.equal(direct.error, null);
    assert.deepEqual(direct.data, []);
  });

  test('объекты: только те, где есть его задача', async () => {
    const { client } = world.executor;
    const all = await client.from('objects').select('id');
    assert.equal(all.error, null);
    assert.deepEqual(ids(all.data), [world.sharedObject.id]);

    for (const object of [world.foreignObject, world.emptyObject]) {
      const direct = await client.from('objects').select('*').eq('id', object.id);
      assert.equal(direct.error, null);
      assert.deepEqual(direct.data, []);
    }
  });

  test('карточка объекта: чужие задачи общего объекта не приходят и через вложенный запрос', async () => {
    const { client } = world.executor;
    const embedded = await client.from('objects').select('id, tasks(id)');
    assert.equal(embedded.error, null);
    assert.deepEqual(embedded.data, [
      { id: world.sharedObject.id, tasks: [{ id: world.ownTask.id }] },
    ]);
  });

  test('профили: себя и причастных, посторонних нет', async () => {
    const { client } = world.executor;
    const all = await client.from('profiles').select('id');
    assert.equal(all.error, null);
    const visible = ids(all.data);
    assert.ok(visible.includes(world.executor.id), 'себя');
    assert.ok(visible.includes(world.manager.id), 'автора записи в истории своей задачи');
    assert.ok(!visible.includes(world.stranger.id), 'исполнителя соседней задачи');
    assert.ok(!visible.includes(world.uninvolvedManager.id), 'постороннего постановщика');

    const direct = await client.from('profiles').select('*').eq('id', world.stranger.id);
    assert.equal(direct.error, null);
    assert.deepEqual(direct.data, []);
  });

  test('профили: автор записи, прежний и новый исполнитель видны по каждому полю истории (Р10)', async () => {
    const [executor, actor, fromAssignee, toAssignee] = await Promise.all([
      createUser('executor'),
      createUser('manager'),
      createUser('executor'),
      createUser('executor'),
    ]);
    const task = await createTask(world.manager.client, {
      object_id: world.sharedObject.id,
      assignee_id: executor.id,
    });
    await addHistory({
      task_id: task.id,
      actor_id: actor.id,
      from_assignee_id: fromAssignee.id,
      to_assignee_id: toAssignee.id,
    });
    const visible = ids((await executor.client.from('profiles').select('id')).data);
    assert.ok(visible.includes(actor.id), 'автор записи');
    assert.ok(visible.includes(fromAssignee.id), 'прежний исполнитель');
    assert.ok(visible.includes(toAssignee.id), 'новый исполнитель');
  });

  test('постановщик видит всё: задачи без исполнителя, историю, объекты, профили', async () => {
    // Запросы по номерам: без условия API отдаёт не больше max_rows строк, а база без пересоздания
    // копит данные других прогонов, и свежих строк в первой тысяче могло бы не оказаться.
    const { client } = world.uninvolvedManager;
    const taskIds = [
      world.ownTask.id,
      world.neighbourTask.id,
      world.foreignTask.id,
      world.unassignedTask.id,
    ];
    assert.deepEqual(
      ids((await client.from('tasks').select('id').in('id', taskIds)).data),
      [...taskIds].sort(),
    );
    const objectIds = [world.sharedObject.id, world.foreignObject.id, world.emptyObject.id];
    assert.deepEqual(
      ids((await client.from('objects').select('id').in('id', objectIds)).data),
      [...objectIds].sort(),
    );
    const historyIds = [world.ownHistoryId, world.foreignHistoryId];
    assert.deepEqual(
      ids((await client.from('task_history').select('id').in('id', historyIds.map(Number))).data),
      [...historyIds].sort(),
    );
    const profileIds = [world.manager.id, world.executor.id, world.stranger.id];
    assert.deepEqual(
      ids((await client.from('profiles').select('id').in('id', profileIds)).data),
      [...profileIds].sort(),
    );
  });
});

describe('Сценарий 3: исполнитель не меняет задачи и объекты напрямую', () => {
  let world: World;
  before(async () => {
    world = await createWorld();
  });

  test('правка своей задачи: разрешённое постановщику поле не меняется, ответ пустой', async () => {
    const before = await rowSnapshot('tasks', world.ownTask.id);
    const { client } = world.executor;
    for (const fields of [
      { title: 'взломано' },
      { description: 'взломано' },
      { assignee_id: world.stranger.id },
      { object_id: world.foreignObject.id },
    ]) {
      const response = await client
        .from('tasks')
        .update(fields)
        .eq('id', world.ownTask.id)
        .select();
      assertNothingUpdated(response, JSON.stringify(fields));
    }
    assert.deepEqual(await rowSnapshot('tasks', world.ownTask.id), before);
  });

  test('правка своей задачи: статус, автор и отметка закрыты правами на колонки', async () => {
    const before = await rowSnapshot('tasks', world.ownTask.id);
    const { client } = world.executor;
    for (const fields of [
      { status: 'in_progress' as const },
      { author_id: world.executor.id },
      { deleted_at: new Date().toISOString() },
    ]) {
      assertDenied(
        await client.from('tasks').update(fields).eq('id', world.ownTask.id),
        JSON.stringify(Object.keys(fields)),
      );
    }
    assert.deepEqual(await rowSnapshot('tasks', world.ownTask.id), before);
  });

  test('создание задачи и объекта: отказ', async () => {
    const { client } = world.executor;
    assertDenied(
      await client.from('tasks').insert({
        title: 'новая',
        object_id: world.sharedObject.id,
        assignee_id: world.executor.id,
      }),
      'создание задачи',
    );
    assertDenied(
      await client.from('objects').insert({ name: 'новый', address: 'адрес' }),
      'создание объекта',
    );
  });

  test('удаление своей задачи и объекта: отказ', async () => {
    const { client } = world.executor;
    assertDenied(await client.from('tasks').delete().eq('id', world.ownTask.id), 'удаление задачи');
    assertDenied(
      await client.from('objects').delete().eq('id', world.sharedObject.id),
      'удаление объекта',
    );
    assert.ok(await rowSnapshot('tasks', world.ownTask.id));
    assert.ok(await rowSnapshot('objects', world.sharedObject.id));
  });

  test('правка видимого объекта: не меняется', async () => {
    const before = await rowSnapshot('objects', world.sharedObject.id);
    const response = await world.executor.client
      .from('objects')
      .update({ name: 'взломано' })
      .eq('id', world.sharedObject.id)
      .select();
    assertNothingUpdated(response, 'правка объекта');
    assert.deepEqual(await rowSnapshot('objects', world.sharedObject.id), before);
  });

  test('запись через вставку с заменой: отказ', async () => {
    const { client } = world.executor;
    assertDenied(
      await client.from('tasks').upsert({
        id: world.ownTask.id,
        title: 'взломано',
        object_id: world.ownTask.object_id,
      }),
      'upsert задачи',
    );
    assertDenied(
      await client.from('objects').upsert({
        id: world.sharedObject.id,
        name: 'взломано',
        address: 'взломано',
      }),
      'upsert объекта',
    );
  });
});

describe('Сценарий 5: профиль и роль менять нельзя', () => {
  let world: World;
  before(async () => {
    world = await createWorld();
  });

  for (const who of ['executor', 'manager'] as const) {
    test(`${who}: своя роль, имя, создание и удаление профиля дают отказ`, async () => {
      const user = world[who];
      const before = await rowSnapshot('profiles', user.id);
      const profiles = user.client.from('profiles');
      assertDenied(await profiles.update({ role: 'manager' }).eq('id', user.id), 'смена роли');
      assertDenied(
        await profiles.update({ full_name: 'взломано' }).eq('id', user.id),
        'смена имени',
      );
      assertDenied(
        await profiles.insert({ id: randomUUID(), full_name: 'новый', role: 'manager' }),
        'создание профиля',
      );
      assertDenied(
        await profiles.upsert({ id: user.id, full_name: 'взломано', role: 'manager' }),
        'upsert профиля',
      );
      assertDenied(await profiles.delete().eq('id', user.id), 'удаление профиля');
      assert.deepEqual(await rowSnapshot('profiles', user.id), before);
    });
  }

  test('метаданные пользователя не дают роль (Р6)', async () => {
    const executor = await createUser('executor');
    const updated = await executor.client.auth.updateUser({
      data: { role: 'manager', app_role: 'manager' },
    });
    assert.equal(updated.error, null);
    const session = await executor.client.auth.refreshSession();
    assert.equal(session.error, null);

    assertDenied(
      await executor.client.from('objects').insert({ name: 'новый', address: 'адрес' }),
      'создание объекта',
    );
    const [profile] = await sql<{ role: string }>(
      'select role from public.profiles where id = $1',
      [executor.id],
    );
    assert.equal(profile?.role, 'executor');
  });
});

describe('Сценарий 8: постановщик не меняет служебные поля', () => {
  let world: World;
  before(async () => {
    world = await createWorld();
  });

  test('задача: статус, автор, дата, отметка, номер', async () => {
    const before = await rowSnapshot('tasks', world.ownTask.id);
    const { client } = world.manager;
    for (const fields of [
      { status: 'accepted' as const },
      { author_id: world.uninvolvedManager.id },
      { created_at: '2000-01-01T00:00:00Z' },
      { deleted_at: new Date().toISOString() },
      { deleted_by: world.manager.id },
      { id: randomUUID() },
    ]) {
      assertDenied(
        await client.from('tasks').update(fields).eq('id', world.ownTask.id),
        JSON.stringify(Object.keys(fields)),
      );
    }
    assert.deepEqual(await rowSnapshot('tasks', world.ownTask.id), before);
  });

  test('задача: запрещённое поле рядом с разрешённым отклоняет всю правку', async () => {
    const before = await rowSnapshot('tasks', world.ownTask.id);
    assertDenied(
      await world.manager.client
        .from('tasks')
        .update({ title: 'новое', status: 'accepted' })
        .eq('id', world.ownTask.id),
      'смешанная правка',
    );
    assert.deepEqual(await rowSnapshot('tasks', world.ownTask.id), before);
  });

  test('объект: дата, отметка, номер', async () => {
    const before = await rowSnapshot('objects', world.sharedObject.id);
    const { client } = world.manager;
    for (const fields of [
      { created_at: '2000-01-01T00:00:00Z' },
      { deleted_at: new Date().toISOString() },
      { deleted_by: world.manager.id },
      { id: randomUUID() },
    ]) {
      assertDenied(
        await client.from('objects').update(fields).eq('id', world.sharedObject.id),
        JSON.stringify(Object.keys(fields)),
      );
    }
    assert.deepEqual(await rowSnapshot('objects', world.sharedObject.id), before);
  });

  test('создание и вставка с заменой не принимают служебные поля', async () => {
    const { client } = world.manager;
    const objectId = world.sharedObject.id;
    for (const extra of [
      { status: 'accepted' as const, assignee_id: world.executor.id },
      { author_id: world.uninvolvedManager.id },
      { created_at: '2000-01-01T00:00:00Z' },
      { deleted_at: new Date().toISOString() },
      { id: randomUUID() },
    ]) {
      assertDenied(
        await client.from('tasks').insert({ title: 'новая', object_id: objectId, ...extra }),
        JSON.stringify(Object.keys(extra)),
      );
    }
    assertDenied(
      await client.from('tasks').upsert({ id: world.ownTask.id, title: 'x', object_id: objectId }),
      'upsert задачи',
    );
    assertDenied(
      await client
        .from('objects')
        .insert({ name: 'новый', address: 'адрес', deleted_at: new Date().toISOString() }),
      'создание удалённого объекта',
    );
  });

  test('разрешённые поля постановщик правит, база сама ставит автора и статус', async () => {
    const { client, id } = world.manager;
    const object = await createObject(client);
    const updatedObject = await client
      .from('objects')
      .update({ name: 'Другое название', address: 'Другой адрес' })
      .eq('id', object.id)
      .select()
      .single();
    assert.equal(updatedObject.error, null);
    assert.equal(updatedObject.data?.name, 'Другое название');
    assert.equal(updatedObject.data?.address, 'Другой адрес');

    const task = await createTask(client, { object_id: object.id });
    assert.equal(task.status, 'new');
    assert.equal(task.author_id, id);
    assert.equal(task.deleted_at, null);

    const updatedTask = await client
      .from('tasks')
      .update({
        title: 'Новое название',
        description: 'Описание',
        object_id: world.sharedObject.id,
        assignee_id: world.stranger.id,
      })
      .eq('id', task.id)
      .select()
      .single();
    assert.equal(updatedTask.error, null);
    assert.equal(updatedTask.data?.title, 'Новое название');
    assert.equal(updatedTask.data?.object_id, world.sharedObject.id);
    assert.equal(updatedTask.data?.assignee_id, world.stranger.id);
    assert.equal(updatedTask.data?.status, 'new');
  });
});

describe('Сценарий 13: настоящее удаление закрыто', () => {
  let world: World;
  before(async () => {
    world = await createWorld();
  });

  test('постановщик: удаление строки задачи и объекта', async () => {
    const { client } = world.manager;
    assertDenied(await client.from('tasks').delete().eq('id', world.ownTask.id), 'задача');
    assertDenied(await client.from('objects').delete().eq('id', world.emptyObject.id), 'объект');
    const [task] = await sql<TaskRow>('select * from public.tasks where id = $1', [
      world.ownTask.id,
    ]);
    const [object] = await sql<ObjectRow>('select * from public.objects where id = $1', [
      world.emptyObject.id,
    ]);
    assert.equal(task?.deleted_at, null);
    assert.equal(object?.deleted_at, null);
  });

  test('постановщик: запись, правка и удаление истории', async () => {
    const { client } = world.manager;
    const before = await rowSnapshot('task_history', world.ownHistoryId);
    assertDenied(
      await client
        .from('task_history')
        .insert({ task_id: world.ownTask.id, actor_id: world.manager.id, to_status: 'new' }),
      'запись истории',
    );
    assertDenied(
      await client
        .from('task_history')
        .update({ comment: 'x' })
        .eq('id', Number(world.ownHistoryId)),
      'правка истории',
    );
    assertDenied(
      await client.from('task_history').delete().eq('id', Number(world.ownHistoryId)),
      'удаление истории',
    );
    assert.deepEqual(await rowSnapshot('task_history', world.ownHistoryId), before);
  });

  test('ключ service_role: ни чтения, ни записи, ни удаления (Р14)', async () => {
    await assertNoTableAccess(serviceClient(), world, 'service_role');
  });

  test('связи без каскада: пользователя с профилем база не даёт стереть', async () => {
    const user = await createUser('executor');
    const deleted = await serviceClient().auth.admin.deleteUser(user.id);
    assert.ok(deleted.error, 'удаление должно получить отказ базы');
    assert.ok(await rowSnapshot('profiles', user.id));
  });
});

describe('Профили: создание базой (Р6, Р7)', () => {
  test('новый пользователь получает роль исполнителя и имя из части email до @', async () => {
    const user = await createUser('executor');
    const own = await user.client.from('profiles').select('*').eq('id', user.id).single();
    assert.equal(own.error, null);
    assert.equal(own.data?.role, 'executor');
    assert.equal(own.data?.full_name, user.email.split('@')[0]);
  });

  test('метаданные при создании не задают роль и имя', async () => {
    const user = await createUser('executor', { role: 'manager', full_name: 'Самозванец' });
    const [profile] = await sql<{ role: string; full_name: string }>(
      'select role, full_name from public.profiles where id = $1',
      [user.id],
    );
    assert.equal(profile?.role, 'executor');
    assert.equal(profile?.full_name, user.email.split('@')[0]);
  });

  test('пользователь без email не ломается и получает непустое имя', async () => {
    const [row] = await sql<{ id: string }>(
      'insert into auth.users (id) values (gen_random_uuid()) returning id',
    );
    assert.ok(row);
    const [profile] = await sql<{ role: string; full_name: string }>(
      'select role, full_name from public.profiles where id = $1',
      [row.id],
    );
    assert.equal(profile?.role, 'executor');
    assert.ok(profile?.full_name);
  });

  test('имя из email: пустая и слишком длинная часть до @', async () => {
    const [row] = await sql<{ blank: string; absent: string; long: string }>(
      `select private.full_name_from_email('@example.com') as blank,
              private.full_name_from_email(null) as absent,
              private.full_name_from_email(repeat('a', 300) || '@example.com') as long`,
    );
    assert.ok(row);
    assert.ok(row.blank.length > 0);
    assert.ok(row.absent.length > 0);
    assert.equal(row.long.length, 200);
  });
});

describe('Служебные функции: только текущий пользователь и точная роль', () => {
  let world: World;
  before(async () => {
    world = await createWorld();
  });

  test('роль определяется точно, без профиля и без пользователя ответ false, а не пусто', async () => {
    const noProfile = await createUser('executor');
    await sql('delete from public.profiles where id = $1', [noProfile.id]);
    const cases: [string | null, boolean, boolean][] = [
      [world.manager.id, true, false],
      [world.executor.id, false, true],
      [noProfile.id, false, false],
      [null, false, false],
    ];
    for (const [userId, manager, executor] of cases) {
      const [row] = await sqlAs<{ manager: boolean; executor: boolean; task: boolean }>(
        userId,
        `select private.is_manager() as manager,
                private.is_executor() as executor,
                private.can_read_profile($1) as profile,
                private.can_read_task($2) as task,
                private.has_task_in_object($3) as object`,
        [world.stranger.id, world.foreignTask.id, world.foreignObject.id],
      );
      assert.strictEqual(row?.manager, manager, `is_manager для ${userId}`);
      assert.strictEqual(row?.executor, executor, `is_executor для ${userId}`);
      for (const [name, value] of Object.entries(row ?? {})) {
        assert.equal(typeof value, 'boolean', `${name} для ${userId} не должно быть пустым`);
      }
    }
  });
});

describe('Аккаунт без профиля (чтение и прямая запись, сценарий 22 частично)', () => {
  let world: World;
  before(async () => {
    world = await createWorld();
  });

  test('ничего не читает и ничего не создаёт', async () => {
    const user = await createUser('executor');
    await sql('delete from public.profiles where id = $1', [user.id]);
    for (const table of TABLES) {
      const response = await untyped(user.client).from(table).select('*');
      assert.equal(response.error, null, table);
      assert.deepEqual(response.data, [], table);
    }
    assertDenied(
      await user.client.from('objects').insert({ name: 'новый', address: 'адрес' }),
      'создание объекта',
    );
    assertDenied(
      await user.client.from('tasks').insert({ title: 'новая', object_id: world.sharedObject.id }),
      'создание задачи',
    );
  });
});

describe('Удалённое и передача задачи: правила чтения (сценарии 6, 7, 10, 14 частично)', () => {
  test('передача: прежний сразу не видит задачу, историю и объект, новый видит всю историю', async () => {
    const world = await createWorld();
    const successor = await createUser('executor');
    const updated = await world.manager.client
      .from('tasks')
      .update({ assignee_id: successor.id })
      .eq('id', world.ownTask.id)
      .select()
      .single();
    assert.equal(updated.error, null);

    const previous = world.executor.client;
    assert.deepEqual((await previous.from('tasks').select('id')).data, []);
    assert.deepEqual((await previous.from('task_history').select('id')).data, []);
    assert.deepEqual((await previous.from('objects').select('id')).data, []);
    assert.deepEqual(ids((await previous.from('profiles').select('id')).data), [world.executor.id]);

    const next = successor.client;
    assert.deepEqual(ids((await next.from('tasks').select('id')).data), [world.ownTask.id]);
    const history = ids((await next.from('task_history').select('id')).data);
    assert.ok(history.includes(world.ownHistoryId), 'новый видит запись, сделанную до него');
    assert.deepEqual(ids((await next.from('objects').select('id')).data), [world.sharedObject.id]);
  });

  test('удалённая задача и её история никому не приходят, объект и имена уходят от исполнителя', async () => {
    const world = await createWorld();
    await setTaskState(world.ownTask.id, {
      deleted_at: new Date().toISOString(),
      deleted_by: world.manager.id,
    });

    for (const user of [world.manager, world.executor]) {
      const task = await user.client.from('tasks').select('*').eq('id', world.ownTask.id);
      assert.equal(task.error, null);
      assert.deepEqual(task.data, [], 'задача');
      const history = await user.client
        .from('task_history')
        .select('*')
        .eq('task_id', world.ownTask.id);
      assert.equal(history.error, null);
      assert.deepEqual(history.data, [], 'история');
    }

    const { client } = world.executor;
    assert.deepEqual((await client.from('objects').select('id')).data, []);
    assert.deepEqual(ids((await client.from('profiles').select('id')).data), [world.executor.id]);
  });

  test('удалённый объект никому не приходит', async () => {
    const world = await createWorld();
    await sql('update public.objects set deleted_at = now(), deleted_by = $2 where id = $1', [
      world.sharedObject.id,
      world.manager.id,
    ]);
    for (const user of [world.manager, world.executor]) {
      const object = await user.client.from('objects').select('*').eq('id', world.sharedObject.id);
      assert.equal(object.error, null);
      assert.deepEqual(object.data, []);
    }
  });

  test('удалённую задачу постановщик не правит прямым запросом', async () => {
    const world = await createWorld();
    await setTaskState(world.ownTask.id, {
      deleted_at: new Date().toISOString(),
      deleted_by: world.manager.id,
    });
    const before = await rowSnapshot('tasks', world.ownTask.id);
    const response = await world.manager.client
      .from('tasks')
      .update({ title: 'взломано' })
      .eq('id', world.ownTask.id)
      .select();
    assertNothingUpdated(response, 'правка удалённой');
    assert.deepEqual(await rowSnapshot('tasks', world.ownTask.id), before);
  });
});

describe('Обязательные значения (план З3, шаг 3)', () => {
  let world: World;
  before(async () => {
    world = await createWorld();
  });

  const BLANK_VALUES = ['', '   ', '\n', '\t', ' \r\n\t ', '\u00A0', ' \u00A0\u2003\u3000\u200B '];

  test('текст из любых пробельных символов считается пустым', async () => {
    const { client } = world.manager;
    for (const blank of BLANK_VALUES) {
      const label = JSON.stringify(blank);
      const name = await client.from('objects').insert({ name: blank, address: 'адрес' });
      assert.equal(name.error?.code, PG_CHECK_VIOLATION, `objects.name ${label}`);
      const address = await client.from('objects').insert({ name: 'имя', address: blank });
      assert.equal(address.error?.code, PG_CHECK_VIOLATION, `objects.address ${label}`);
      const title = await client
        .from('tasks')
        .insert({ title: blank, object_id: world.sharedObject.id });
      assert.equal(title.error?.code, PG_CHECK_VIOLATION, `tasks.title ${label}`);
    }
  });

  test('has_text: каждый пробельный символ по его коду, видимый символ считается текстом', async () => {
    const zeroWidthAndSpaces = Array.from({ length: 0x200b - 0x2000 + 1 }, (_, i) => 0x2000 + i);
    const codes = [
      ...[0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x180e],
      ...zeroWidthAndSpaces,
      ...[0x2028, 0x2029, 0x202f, 0x205f, 0x2060, 0x3000, 0xfeff],
    ];
    const accepted = await sql<{ code: number }>(
      `select code from unnest($1::int[]) as code where private.has_text(chr(code))`,
      [codes],
    );
    assert.deepEqual(accepted, [], 'эти символы приняты за текст');

    const [row] = await sql<Record<string, boolean>>(
      `select private.has_text('я') as letter,
              private.has_text(chr(160) || '.' || chr(160)) as surrounded,
              private.has_text(null) as absent`,
    );
    assert.deepEqual(row, { letter: true, surrounded: true, absent: false });
  });

  test('обязательные поля нельзя опустить', async () => {
    const api = untyped(world.manager.client);
    const missingName = await api.from('objects').insert({ address: 'адрес' });
    assert.equal(missingName.error?.code, PG_NOT_NULL_VIOLATION);
    const missingAddress = await api.from('objects').insert({ name: 'имя' });
    assert.equal(missingAddress.error?.code, PG_NOT_NULL_VIOLATION);
    const missingTitle = await api.from('tasks').insert({ object_id: world.sharedObject.id });
    assert.equal(missingTitle.error?.code, PG_NOT_NULL_VIOLATION);
    const missingObject = await api.from('tasks').insert({ title: 'задача' });
    assert.equal(missingObject.error?.code, PG_NOT_NULL_VIOLATION);
  });

  test('длина текста ограничена контрактом', async () => {
    const { client } = world.manager;
    const objectId = world.sharedObject.id;
    const cases = [
      await client.from('objects').insert({ name: 'я'.repeat(201), address: 'адрес' }),
      await client.from('objects').insert({ name: 'имя', address: 'я'.repeat(301) }),
      await client.from('tasks').insert({ title: 'я'.repeat(201), object_id: objectId }),
      await client
        .from('tasks')
        .insert({ title: 'задача', object_id: objectId, description: 'я'.repeat(5001) }),
    ];
    for (const response of cases) {
      assert.equal(response.error?.code, PG_CHECK_VIOLATION);
    }
    await createObject(client, { name: 'я'.repeat(200), address: 'я'.repeat(300) });
    await createTask(client, {
      object_id: objectId,
      title: 'я'.repeat(200),
      description: 'я'.repeat(5000),
    });
  });

  test('описание необязательно', async () => {
    const task = await createTask(world.manager.client, { object_id: world.sharedObject.id });
    assert.equal(task.description, null);
  });

  test('задача не в статусе «Новая» обязана иметь исполнителя', async () => {
    await assert.rejects(
      setTaskState(world.unassignedTask.id, { status: 'in_progress' }),
      (error: { code?: string }) => error.code === PG_CHECK_VIOLATION,
    );
  });

  test('запись истории обязана быть одного из трёх видов и иметь автора', async () => {
    const taskId = world.ownTask.id;
    const actorId = world.manager.id;
    const invalid: [string, string | null, string | null, string | null, string | null][] = [
      ['пустая запись', null, null, null, null],
      ['создание не в «Новую»', null, 'accepted', null, null],
      ['смена статуса вместе с исполнителем', 'new', 'in_progress', null, world.executor.id],
      ['откуда есть, куда нет', 'new', null, null, null],
    ];
    for (const [label, fromStatus, toStatus, fromAssignee, toAssignee] of invalid) {
      await assert.rejects(
        sql(
          `insert into public.task_history
             (task_id, actor_id, from_status, to_status, from_assignee_id, to_assignee_id)
           values ($1, $2, $3, $4, $5, $6)`,
          [taskId, actorId, fromStatus, toStatus, fromAssignee, toAssignee],
        ),
        (error: { code?: string }) => error.code === PG_CHECK_VIOLATION,
        label,
      );
    }
    await assert.rejects(
      sql(`insert into public.task_history (task_id, to_status) values ($1, 'new')`, [taskId]),
      (error: { code?: string }) => error.code === PG_NOT_NULL_VIOLATION,
    );
  });

  test('отметка «удалена» хранит и кто, и когда', async () => {
    await assert.rejects(
      setTaskState(world.ownTask.id, { deleted_at: new Date().toISOString() }),
      (error: { code?: string }) => error.code === PG_CHECK_VIOLATION,
    );
    await assert.rejects(
      sql('update public.objects set deleted_by = $2 where id = $1', [
        world.sharedObject.id,
        world.manager.id,
      ]),
      (error: { code?: string }) => error.code === PG_CHECK_VIOLATION,
    );
  });
});

describe('Сценарий 26: служебные функции через API недоступны', () => {
  let world: World;
  before(async () => {
    world = await createWorld();
  });

  test('все служебные функции лежат в закрытой схеме', async () => {
    const rows = await sql<{ name: string }>(
      `select p.proname as name from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private'`,
    );
    const names = rows.map((row) => row.name);
    for (const helper of [...ACCESS_HELPERS, 'handle_new_user', 'has_text']) {
      assert.ok(names.includes(helper), helper);
    }
  });

  test('вызов из открытой и закрытой схемы: гость, исполнитель, постановщик', async () => {
    const callers: [string, SupabaseClient][] = [
      ['гость', untyped(guestClient())],
      ['исполнитель', untyped(world.executor.client)],
      ['постановщик', untyped(world.manager.client)],
    ];
    const args: Record<string, Row> = {
      can_read_profile: { p_profile_id: world.stranger.id },
      can_read_task: { p_task_id: world.foreignTask.id },
      has_task_in_object: { p_object_id: world.foreignObject.id },
    };
    for (const [label, client] of callers) {
      for (const name of [...ACCESS_HELPERS, 'handle_new_user', 'has_text']) {
        const direct = await client.rpc(name, args[name] ?? {});
        assert.equal(
          direct.error?.code,
          POSTGREST_FUNCTION_NOT_FOUND,
          `${label}, public.${name}: ${JSON.stringify(direct)}`,
        );
        const viaSchema = await client.schema('private').rpc(name, args[name] ?? {});
        assert.equal(
          viaSchema.error?.code,
          POSTGREST_INVALID_SCHEMA,
          `${label}, private.${name}: ${JSON.stringify(viaSchema)}`,
        );
      }
    }
  });

  test('закрытая схема и auth не открыты для чтения таблиц', async () => {
    for (const schema of ['private', 'auth']) {
      const response = await untyped(world.manager.client).schema(schema).from('users').select('*');
      assert.equal(response.error?.code, POSTGREST_INVALID_SCHEMA, schema);
    }
  });
});

describe('Сценарий 27: обзор базы', () => {
  test('все таблицы под RLS, без принудительного режима, представлений нет', async () => {
    const rows = await sql<{
      schema: string;
      name: string;
      kind: string;
      rls: boolean;
      force: boolean;
    }>(
      `select n.nspname as schema, c.relname as name, c.relkind::text as kind,
              c.relrowsecurity as rls, c.relforcerowsecurity as force
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
       order by 1, 2`,
    );
    assert.deepEqual(
      rows.map((row) => `${row.schema}.${row.name}:${row.kind}`),
      TABLES.map((table) => `public.${table}:r`),
      'в базе только четыре таблицы и нет представлений',
    );
    for (const row of rows) {
      assert.equal(row.rls, true, `${row.name}: RLS`);
      assert.equal(row.force, false, `${row.name}: force`);
    }
  });

  test('public, anon и service_role не имеют никаких прав на таблицы', async () => {
    const rows = await sql<{ role: string; table_name: string; privilege: string }>(
      `select r.role, t.table_name, p.privilege
       from unnest(array['public', 'anon', 'service_role']) as r(role)
       cross join unnest($1::text[]) as t(table_name)
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
                               'TRIGGER']) as p(privilege)
       where has_table_privilege(r.role, 'public.' || t.table_name, p.privilege)
          or (p.privilege in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
              and has_any_column_privilege(r.role, 'public.' || t.table_name, p.privilege))`,
      [TABLES],
    );
    assert.deepEqual(rows, []);
  });

  test('authenticated: на таблицу только чтение, запись только по разрешённым колонкам', async () => {
    const tablePrivileges = await sql<{ table_name: string; privilege: string }>(
      `select t.table_name, p.privilege
       from unnest($1::text[]) as t(table_name)
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
                               'TRIGGER']) as p(privilege)
       where has_table_privilege('authenticated', 'public.' || t.table_name, p.privilege)
       order by 1, 2`,
      [TABLES],
    );
    assert.deepEqual(
      tablePrivileges.map((row) => `${row.table_name}:${row.privilege}`),
      TABLES.map((table) => `${table}:SELECT`),
    );

    const columnPrivileges = await sql<{ entry: string }>(
      `select c.table_name || '.' || c.column_name || ':' || p.privilege as entry
       from information_schema.columns c
       cross join unnest(array['INSERT', 'UPDATE', 'REFERENCES']) as p(privilege)
       where c.table_schema = 'public'
         and has_column_privilege('authenticated', 'public.' || c.table_name, c.column_name,
                                  p.privilege)`,
    );
    const writable = ['name', 'address'].map((column) => `objects.${column}`);
    writable.push(
      ...['title', 'description', 'object_id', 'assignee_id'].map((column) => `tasks.${column}`),
    );
    const expected = writable.flatMap((column) => [`${column}:INSERT`, `${column}:UPDATE`]);
    assert.deepEqual(columnPrivileges.map((row) => row.entry).sort(), expected.sort());
  });

  test('последовательности закрыты для всех ролей API', async () => {
    const sequences = await sql<{ name: string }>(
      `select sequencename as name from pg_sequences where schemaname = 'public'`,
    );
    assert.deepEqual(
      sequences.map((row) => row.name),
      ['task_history_id_seq'],
    );
    const rows = await sql(
      `select s.sequencename, r.role
       from pg_sequences s
       cross join unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(role)
       cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as p(privilege)
       where s.schemaname = 'public'
         and has_sequence_privilege(r.role, 'public.' || s.sequencename, p.privilege)`,
    );
    assert.deepEqual(rows, []);
  });

  test('правила только для authenticated, ожидаемый состав, без разрешения всем', async () => {
    const rows = await sql<{
      tablename: string;
      policyname: string;
      permissive: string;
      roles: string[];
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `select tablename, policyname, permissive, roles::text[] as roles, cmd, qual, with_check
       from pg_policies where schemaname in ('public', 'private')`,
    );
    assert.deepEqual(rows.map((row) => `${row.tablename}:${row.cmd}`).sort(), [
      'objects:INSERT',
      'objects:SELECT',
      'objects:UPDATE',
      'profiles:SELECT',
      'task_history:SELECT',
      'tasks:INSERT',
      'tasks:SELECT',
      'tasks:UPDATE',
    ]);
    for (const row of rows) {
      assert.deepEqual(row.roles, ['authenticated'], row.policyname);
      assert.equal(row.permissive, 'PERMISSIVE', row.policyname);
      assert.notEqual(row.qual?.trim(), 'true', row.policyname);
      assert.notEqual(row.with_check?.trim(), 'true', row.policyname);
    }

    // В правке условие об удалении запросом не проверить: с условием WHERE строку уже скрывает
    // правило чтения, а правку без WHERE блокирует само API. Поэтому только обзор.
    for (const entry of ['objects:SELECT', 'objects:UPDATE', 'tasks:SELECT', 'tasks:UPDATE']) {
      const row = rows.find((candidate) => `${candidate.tablename}:${candidate.cmd}` === entry);
      assert.match(row?.qual ?? '', /deleted_at IS NULL/, entry);
    }
  });

  test('функции: закреплённый search_path, нет повышенных прав в открытой схеме, нет лишних прав', async () => {
    const rows = await sql<{
      schema: string;
      name: string;
      definer: boolean;
      config: string[] | null;
      args: string[] | null;
      public_can: boolean;
      anon_can: boolean;
      service_can: boolean;
      authenticated_can: boolean;
    }>(
      `select n.nspname as schema, p.proname as name, p.prosecdef as definer,
              p.proconfig as config, p.proargnames::text[] as args,
              has_function_privilege('public', p.oid, 'execute') as public_can,
              has_function_privilege('anon', p.oid, 'execute') as anon_can,
              has_function_privilege('service_role', p.oid, 'execute') as service_can,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')`,
    );
    // Вызывать с токеном нужно только то, что входит в выражения правил и проверок таблиц.
    const authenticatedOnly = new Set<string>([...ACCESS_HELPERS, 'has_text', ...ACTIONS]);

    assert.ok(rows.length > 0);
    for (const row of rows) {
      const label = `${row.schema}.${row.name}`;
      assert.equal(row.public_can, false, `${label}: PUBLIC`);
      assert.equal(row.anon_can, false, `${label}: anon`);
      assert.equal(row.service_can, false, `${label}: service_role`);
      assert.equal(
        row.authenticated_can,
        authenticatedOnly.has(row.name),
        `${label}: authenticated`,
      );
      assert.ok(
        !(row.args ?? []).some((arg) => arg.includes('user')),
        `${label}: номер пользователя параметром`,
      );
      if (row.schema === 'public') {
        assert.equal(row.definer, false, `${label}: повышенные права в открытой схеме`);
        assert.ok((ACTIONS as readonly string[]).includes(row.name), `${label}: лишняя функция`);
      }
      assert.ok(
        row.config?.some((entry) => /^search_path=(""|'')?$/.test(entry)),
        `${label}: search_path ${JSON.stringify(row.config)}`,
      );
    }
  });

  test('схемы: закрытая недоступна посторонним, в открытой никто не создаёт объекты', async () => {
    const [row] = await sql<Record<string, boolean>>(
      `select has_schema_privilege('public', 'private', 'USAGE') as public_usage,
              has_schema_privilege('anon', 'private', 'USAGE') as anon_usage,
              has_schema_privilege('service_role', 'private', 'USAGE') as service_usage,
              has_schema_privilege('authenticated', 'private', 'USAGE') as authenticated_usage,
              has_schema_privilege('authenticated', 'private', 'CREATE') as authenticated_create,
              has_schema_privilege('anon', 'public', 'CREATE') as anon_create_public,
              has_schema_privilege('authenticated', 'public', 'CREATE') as authenticated_create_public`,
    );
    assert.deepEqual(row, {
      public_usage: false,
      anon_usage: false,
      service_usage: false,
      authenticated_usage: true,
      authenticated_create: false,
      anon_create_public: false,
      authenticated_create_public: false,
    });
  });

  test('ссылки между таблицами и на auth.users без каскада', async () => {
    const rows = await sql<{ name: string; on_delete: string; on_update: string }>(
      `select c.conname as name, c.confdeltype::text as on_delete, c.confupdtype::text as on_update
       from pg_constraint c join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
       where c.contype = 'f' and n.nspname = 'public'`,
    );
    assert.equal(rows.length, 10, 'все ссылки контракта');
    for (const row of rows) {
      assert.equal(row.on_delete, 'a', `${row.name}: при удалении`);
      assert.equal(row.on_update, 'a', `${row.name}: при изменении`);
    }
  });

  test('триггер создания профиля стоит на auth.users и включён', async () => {
    const rows = await sql<{ enabled: string }>(
      `select tgenabled::text as enabled from pg_trigger
       where tgrelid = 'auth.users'::regclass and not tgisinternal
         and tgfoid = 'private.handle_new_user'::regproc`,
    );
    assert.deepEqual(rows, [{ enabled: 'O' }]);
  });
});
