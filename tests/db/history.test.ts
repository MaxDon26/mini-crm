// З4: сценарии 18 и 19 (смена исполнителя), запись истории при создании. Запись о смене статуса
// проверяется вместе с действием в actions.test.ts.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createObject,
  createTask,
  createUser,
  guestClient,
  serviceClient,
  setTaskState,
  sql,
  sqlAs,
  type DbClient,
  type ObjectRow,
  type TaskRow,
  type TaskStatus,
  type TestUser,
} from './helpers.ts';

const PG_PERMISSION_DENIED = '42501';

interface HistoryRow {
  id: number;
  task_id: string;
  actor_id: string;
  created_at: string;
  from_status: TaskStatus | null;
  to_status: TaskStatus | null;
  from_assignee_id: string | null;
  to_assignee_id: string | null;
  comment: string | null;
}

let manager: TestUser;
let otherManager: TestUser;
let executor: TestUser;
let otherExecutor: TestUser;
let object: ObjectRow;
let otherObject: ObjectRow;

before(async () => {
  [manager, otherManager, executor, otherExecutor] = await Promise.all([
    createUser('manager'),
    createUser('manager'),
    createUser('executor'),
    createUser('executor'),
  ]);
  [object, otherObject] = await Promise.all([
    createObject(manager.client),
    createObject(manager.client),
  ]);
});

/** История задачи через API с токеном: то, что увидит сайт. */
async function readHistory(client: DbClient, taskId: string): Promise<HistoryRow[]> {
  const response = await client.from('task_history').select('*').eq('task_id', taskId).order('id');
  assert.equal(response.error, null, JSON.stringify(response.error));
  return response.data ?? [];
}

async function allHistory(taskId: string): Promise<HistoryRow[]> {
  return sql<HistoryRow>('select * from public.task_history where task_id = $1 order by id', [
    taskId,
  ]);
}

async function assertFromDatabaseClock(createdAt: string): Promise<void> {
  const [row] = await sql<{ seconds: number }>(
    'select abs(extract(epoch from (now() - $1::timestamptz)))::float as seconds',
    [createdAt],
  );
  assert.ok(row && row.seconds < 60, `время записи: ${createdAt}`);
}

async function assign(client: DbClient, task: TaskRow, assigneeId: string | null): Promise<void> {
  const response = await client
    .from('tasks')
    .update({ assignee_id: assigneeId })
    .eq('id', task.id)
    .select()
    .single();
  assert.equal(response.error, null, JSON.stringify(response.error));
}

describe('Запись при создании задачи (сценарий 16)', () => {
  test('без исполнителя: одна запись «— → Новая» от автора', async () => {
    const task = await createTask(manager.client, { object_id: object.id });
    const history = await readHistory(manager.client, task.id);
    assert.equal(history.length, 1);
    const [record] = history;
    assert.equal(record?.actor_id, manager.id);
    assert.equal(record?.from_status, null);
    assert.equal(record?.to_status, 'new');
    assert.equal(record?.from_assignee_id, null);
    assert.equal(record?.to_assignee_id, null);
    assert.equal(record?.comment, null);
    assert.ok(record);
    await assertFromDatabaseClock(record.created_at);
  });

  test('сразу с исполнителем: тоже одна запись, исполнитель в ней (Р9), и он её видит', async () => {
    const task = await createTask(manager.client, {
      object_id: object.id,
      assignee_id: executor.id,
    });
    const history = await readHistory(executor.client, task.id);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.actor_id, manager.id);
    assert.equal(history[0]?.to_status, 'new');
    assert.equal(history[0]?.to_assignee_id, executor.id);
  });

  test('автор записи виден назначенному исполнителю (Р10)', async () => {
    const assignee = await createUser('executor');
    await createTask(otherManager.client, { object_id: object.id, assignee_id: assignee.id });
    const profiles = await assignee.client.from('profiles').select('id');
    assert.ok(profiles.data?.some((row) => row.id === otherManager.id));
  });
});

describe('Сценарий 19: запись о смене исполнителя', () => {
  test('назначение с пустого: кто и когда от базы, статусы пусты, статус задачи не меняется', async () => {
    const task = await createTask(manager.client, { object_id: object.id });
    await assign(otherManager.client, task, executor.id);

    const history = await allHistory(task.id);
    assert.equal(history.length, 2);
    const record = history[1];
    assert.ok(record);
    assert.equal(
      record.actor_id,
      otherManager.id,
      'автор записи тот, кто правил, а не автор задачи',
    );
    assert.equal(record.from_assignee_id, null);
    assert.equal(record.to_assignee_id, executor.id);
    assert.equal(record.from_status, null);
    assert.equal(record.to_status, null);
    assert.equal(record.comment, null);
    await assertFromDatabaseClock(new Date(record.created_at).toISOString());

    const [row] = await sql<TaskRow>('select * from public.tasks where id = $1', [task.id]);
    assert.equal(row?.status, 'new');
  });

  test('передача в работе: оба исполнителя записаны, статус не меняется', async () => {
    const task = await createTask(manager.client, {
      object_id: object.id,
      assignee_id: executor.id,
    });
    await setTaskState(task.id, { status: 'in_progress' });
    await assign(manager.client, task, otherExecutor.id);

    const last = (await allHistory(task.id)).at(-1);
    assert.equal(last?.from_assignee_id, executor.id);
    assert.equal(last?.to_assignee_id, otherExecutor.id);
    assert.equal(last?.from_status, null);
    assert.equal(last?.to_status, null);
    const [row] = await sql<TaskRow>('select * from public.tasks where id = $1', [task.id]);
    assert.equal(row?.status, 'in_progress');
  });

  test('снятие у «Новой»: новый исполнитель пуст', async () => {
    const task = await createTask(manager.client, {
      object_id: object.id,
      assignee_id: executor.id,
    });
    await assign(manager.client, task, null);
    const last = (await allHistory(task.id)).at(-1);
    assert.equal(last?.from_assignee_id, executor.id);
    assert.equal(last?.to_assignee_id, null);
  });

  test('смена на того же исполнителя записи не создаёт', async () => {
    const task = await createTask(manager.client, {
      object_id: object.id,
      assignee_id: executor.id,
    });
    await assign(manager.client, task, executor.id);
    assert.equal((await allHistory(task.id)).length, 1);
  });

  test('правка названия, описания и объекта записи не создаёт (раздел 2.3)', async () => {
    const task = await createTask(manager.client, {
      object_id: object.id,
      assignee_id: executor.id,
    });
    const response = await manager.client
      .from('tasks')
      .update({ title: 'Новое', description: 'Новое', object_id: otherObject.id })
      .eq('id', task.id)
      .select()
      .single();
    assert.equal(response.error, null, JSON.stringify(response.error));
    assert.equal((await allHistory(task.id)).length, 1);
  });

  test('отклонённая смена не оставляет записи', async () => {
    const task = await createTask(manager.client, {
      object_id: object.id,
      assignee_id: executor.id,
    });
    const response = await manager.client
      .from('tasks')
      .update({ assignee_id: otherManager.id })
      .eq('id', task.id);
    assert.ok(response.error);
    assert.equal((await allHistory(task.id)).length, 1);
  });

  test('пример раздела 3.1: новый исполнитель видит всю историю, прежний ничего (сценарий 6)', async () => {
    const ivan = await createUser('executor');
    const petr = await createUser('executor');
    const task = await createTask(manager.client, { object_id: object.id });
    await assign(manager.client, task, ivan.id);
    assert.equal((await readHistory(ivan.client, task.id)).length, 2);

    await assign(manager.client, task, petr.id);

    assert.deepEqual(await readHistory(ivan.client, task.id), []);
    const ivanTask = await ivan.client.from('tasks').select('id').eq('id', task.id);
    assert.deepEqual(ivanTask.data, []);

    const seen = await readHistory(petr.client, task.id);
    assert.deepEqual(
      seen.map((row) => [row.to_status, row.from_assignee_id, row.to_assignee_id]),
      [
        ['new', null, null],
        [null, null, ivan.id],
        [null, ivan.id, petr.id],
      ],
    );
    const profiles = ids((await petr.client.from('profiles').select('id')).data);
    assert.ok(profiles.includes(ivan.id), 'прежний исполнитель упомянут в истории и виден новому');
    assert.ok(profiles.includes(manager.id), 'автор записей виден');
  });
});

function ids(rows: readonly { id: string }[] | null): string[] {
  return (rows ?? []).map((row) => row.id);
}

describe('Сценарий 18: историю нельзя подделать, изменить, удалить', () => {
  let task: TaskRow;
  let recordId: number;

  before(async () => {
    task = await createTask(manager.client, { object_id: object.id, assignee_id: executor.id });
    const [record] = await allHistory(task.id);
    assert.ok(record);
    recordId = Number(record.id);
  });

  for (const [label, getClient] of [
    ['постановщик', () => manager.client],
    ['назначенный исполнитель', () => executor.client],
    ['посторонний исполнитель', () => otherExecutor.client],
    ['гость', () => guestClient()],
    ['ключ service_role', () => serviceClient()],
  ] as const) {
    test(`${label}: запись, правка и удаление через API дают отказ`, async () => {
      const before = await allHistory(task.id);
      const api = (getClient() as unknown as SupabaseClient).from('task_history');
      const forged = await api.insert({
        task_id: task.id,
        actor_id: otherManager.id,
        from_status: 'in_review',
        to_status: 'accepted',
      });
      assert.equal(forged.error?.code, PG_PERMISSION_DENIED, 'подделка');
      const updated = await api.update({ comment: 'Подделка' }).eq('id', recordId);
      assert.equal(updated.error?.code, PG_PERMISSION_DENIED, 'правка');
      const deleted = await api.delete().eq('id', recordId);
      assert.equal(deleted.error?.code, PG_PERMISSION_DENIED, 'удаление');
      assert.deepEqual(await allHistory(task.id), before);
    });
  }

  test('автора и время записи через API не передать и при создании задачи', async () => {
    const response = await manager.client.from('tasks').insert({
      title: 'Чужой автор',
      object_id: object.id,
      author_id: otherManager.id,
      created_at: '2000-01-01T00:00:00Z',
    });
    assert.equal(response.error?.code, PG_PERMISSION_DENIED);
  });

  test('прямое подключение: правка, удаление и очистка получают history_immutable', async () => {
    const before = await allHistory(task.id);
    const statements: [string, string, unknown[]][] = [
      [
        'правка',
        'update public.task_history set comment = $2 where id = $1',
        [recordId, 'Подделка'],
      ],
      ['удаление', 'delete from public.task_history where id = $1', [recordId]],
      ['очистка', 'truncate public.task_history', []],
      ['правка без строк', 'update public.task_history set comment = null where false', []],
    ];
    for (const [label, text, params] of statements) {
      await assert.rejects(
        sqlAs(null, text, params, 'postgres'),
        (error: { message?: string }) => error.message === 'history_immutable',
        label,
      );
    }
    assert.deepEqual(await allHistory(task.id), before);
  });

  test('запрет снимается только владельцем: стереть задачу с историей база не даёт', async () => {
    await assert.rejects(
      sqlAs(null, 'delete from public.tasks where id = $1', [task.id], 'postgres'),
      (error: { code?: string }) => error.code === '23503',
    );
  });
});
