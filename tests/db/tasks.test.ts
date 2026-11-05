// З4: сценарии 9, 11, 15, 16, 17. Создание и правка задач через API с токеном постановщика.
// Запросы мимо API есть только там, где права сработали бы раньше триггера: так видно, что сам
// триггер отвечает верно, и все такие запросы отменяются.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import {
  assertRefusal,
  createObject,
  createTask,
  createUser,
  inTransaction,
  setTaskState,
  sql,
  sqlAs,
  type ObjectRow,
  type TaskRow,
  type TaskStatus,
  type TestUser,
} from './helpers.ts';

const PG_PERMISSION_DENIED = '42501';
const PG_CHECK_VIOLATION = '23514';
const PG_NOT_NULL_VIOLATION = '23502';
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

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

async function taskInStatus(status: TaskStatus): Promise<TaskRow> {
  const task = await createTask(manager.client, {
    object_id: object.id,
    assignee_id: executor.id,
    description: 'Описание',
  });
  if (status !== 'new') await setTaskState(task.id, { status });
  return { ...task, status };
}

async function readTask(id: string): Promise<TaskRow> {
  const [row] = await sql<TaskRow>('select * from public.tasks where id = $1', [id]);
  assert.ok(row, 'задача должна быть в базе');
  return row;
}

async function createDeletedObject(): Promise<ObjectRow> {
  const created = await createObject(manager.client);
  await sql('update public.objects set deleted_at = now(), deleted_by = $2 where id = $1', [
    created.id,
    manager.id,
  ]);
  return created;
}

async function countTasksTitled(title: string): Promise<number> {
  const [row] = await sql<{ count: string }>('select count(*) from public.tasks where title = $1', [
    title,
  ]);
  return Number(row?.count);
}

async function historyCount(taskId: string): Promise<number> {
  const [row] = await sql<{ count: string }>(
    'select count(*) from public.task_history where task_id = $1',
    [taskId],
  );
  return Number(row?.count);
}

describe('Сценарий 16: создание задачи', () => {
  test('статус, автор, дата и отметка в запросе дают отказ по правам', async () => {
    const title = `Служебные поля ${randomUUID()}`;
    for (const extra of [
      { status: 'accepted' as const, assignee_id: executor.id },
      { author_id: otherManager.id },
      { created_at: '2000-01-01T00:00:00Z' },
      { deleted_at: new Date().toISOString(), deleted_by: manager.id },
    ]) {
      const response = await manager.client
        .from('tasks')
        .insert({ title, object_id: object.id, ...extra });
      assert.equal(response.error?.code, PG_PERMISSION_DENIED, JSON.stringify(Object.keys(extra)));
    }
    assert.equal(await countTasksTitled(title), 0);
  });

  test('обычное создание: база ставит «Новая», текущего пользователя и дату', async () => {
    const task = await createTask(manager.client, { object_id: object.id });
    assert.equal(task.status, 'new');
    assert.equal(task.author_id, manager.id);
    assert.equal(task.assignee_id, null);
    assert.equal(task.deleted_at, null);
    assert.equal(task.deleted_by, null);

    const [row] = await sql<{ seconds: number }>(
      'select abs(extract(epoch from (now() - created_at)))::float as seconds from public.tasks where id = $1',
      [task.id],
    );
    assert.ok(row && row.seconds < 60, 'дата создания от базы');
  });

  test('сам триггер заменяет служебные значения, даже если права их пропустили', async () => {
    const [row] = await sqlAs<TaskRow>(
      manager.id,
      `insert into public.tasks
         (title, object_id, assignee_id, status, author_id, created_at, deleted_at, deleted_by)
       values ('Обход прав', $1, $2, 'accepted', $3, '2000-01-01', now(), $3)
       returning *`,
      [object.id, executor.id, otherManager.id],
      'postgres',
    );
    assert.equal(row?.status, 'new');
    assert.equal(row?.author_id, manager.id);
    assert.equal(row?.deleted_at, null);
    assert.equal(row?.deleted_by, null);
    assert.ok(row && new Date(row.created_at).getFullYear() > 2000, 'дата от базы');
  });

  test('без текущего пользователя база отказывает в создании', async () => {
    await assert.rejects(
      sql(`insert into public.tasks (title, object_id, author_id) values ('Панель', $1, $2)`, [
        object.id,
        manager.id,
      ]),
      (error: { message?: string; code?: string }) =>
        error.message === 'forbidden' && error.code === PG_PERMISSION_DENIED,
    );
  });
});

describe('Роль проверяется первой и ответ один: ошибка не раскрывает чужие данные', () => {
  test('исполнитель получает одно и то же про любой объект и любого назначаемого', async () => {
    const deleted = await createDeletedObject();
    const cases = [
      { label: 'живой объект', fields: { object_id: object.id } },
      { label: 'удалённый объект', fields: { object_id: deleted.id } },
      { label: 'несуществующий объект', fields: { object_id: randomUUID() } },
      { label: 'постановщик', fields: { object_id: object.id, assignee_id: manager.id } },
      { label: 'несуществующий', fields: { object_id: object.id, assignee_id: randomUUID() } },
    ];
    for (const { label, fields } of cases) {
      const response = await executor.client.from('tasks').insert({ title: 'Задача', ...fields });
      assertRefusal(response, 'forbidden', label);
    }
  });

  test('аккаунт без профиля получает тот же ответ', async () => {
    const user = await createUser('executor');
    await sql('delete from public.profiles where id = $1', [user.id]);
    const response = await user.client
      .from('tasks')
      .insert({ title: 'Задача', object_id: object.id });
    assertRefusal(response, 'forbidden');
  });

  test('триггер правки отвечает исполнителю одинаково, что бы ни было с задачей и целью', async () => {
    const deleted = await createDeletedObject();
    const accepted = await taskInStatus('accepted');
    const live = await taskInStatus('in_progress');
    const cases: [string, string, string, unknown][] = [
      ['название', live.id, 'title', 'Новое'],
      ['принятая задача', accepted.id, 'title', 'Новое'],
      ['удалённый объект', live.id, 'object_id', deleted.id],
      ['снятие исполнителя', live.id, 'assignee_id', null],
      ['назначение постановщика', live.id, 'assignee_id', manager.id],
    ];
    for (const [label, taskId, column, value] of cases) {
      await assert.rejects(
        sqlAs(
          executor.id,
          `update public.tasks set ${column} = $2 where id = $1`,
          [taskId, value],
          'postgres',
        ),
        (error: { message?: string }) => error.message === 'forbidden',
        label,
      );
    }
  });

  test('без текущего пользователя база отказывает в смене исполнителя', async () => {
    const task = await taskInStatus('new');
    await assert.rejects(
      sql('update public.tasks set assignee_id = $2 where id = $1', [task.id, otherExecutor.id]),
      (error: { message?: string }) => error.message === 'forbidden',
    );
    assert.equal((await readTask(task.id)).assignee_id, executor.id);
  });
});

describe('Сценарий 9: правка принятой задачи', () => {
  test('каждое из четырёх полей: отказ, задача и история не меняются', async () => {
    const task = await taskInStatus('accepted');
    const historyBefore = await historyCount(task.id);
    const before = await readTask(task.id);
    for (const fields of [
      { title: 'Новое название' },
      { description: 'Новое описание' },
      { object_id: otherObject.id },
      { assignee_id: otherExecutor.id },
    ]) {
      const response = await manager.client.from('tasks').update(fields).eq('id', task.id);
      assertRefusal(response, 'task_accepted', JSON.stringify(Object.keys(fields)));
    }
    assert.deepEqual(await readTask(task.id), before);
    assert.equal(await historyCount(task.id), historyBefore);
  });

  test('сравнение учитывает пустое описание в обе стороны', async () => {
    const withoutDescription = await createTask(manager.client, {
      object_id: object.id,
      assignee_id: executor.id,
    });
    await setTaskState(withoutDescription.id, { status: 'accepted' });
    assertRefusal(
      await manager.client
        .from('tasks')
        .update({ description: 'Появилось' })
        .eq('id', withoutDescription.id),
      'task_accepted',
      'пусто → значение',
    );

    const withDescription = await taskInStatus('accepted');
    assertRefusal(
      await manager.client.from('tasks').update({ description: null }).eq('id', withDescription.id),
      'task_accepted',
      'значение → пусто',
    );
  });

  test('правка без изменений проходит: триггер смотрит на значения, а не на список полей', async () => {
    const task = await taskInStatus('accepted');
    const historyBefore = await historyCount(task.id);
    const response = await manager.client
      .from('tasks')
      .update({ title: task.title, assignee_id: task.assignee_id })
      .eq('id', task.id)
      .select();
    assert.equal(response.error, null);
    assert.equal(response.data?.length, 1);
    assert.equal(await historyCount(task.id), historyBefore);
  });

  test('статус и отметка «удалена» принятой задачи триггером не закрыты: их меняют действия З5', async () => {
    const task = await taskInStatus('accepted');
    await setTaskState(task.id, {
      deleted_at: new Date().toISOString(),
      deleted_by: manager.id,
    });
    assert.ok((await readTask(task.id)).deleted_at);

    const other = await taskInStatus('accepted');
    await setTaskState(other.id, { status: 'in_review' });
    assert.equal((await readTask(other.id)).status, 'in_review');
  });

  for (const status of ['new', 'in_progress', 'in_review', 'rework'] as const) {
    test(`статус ${status}: четыре поля правятся, статус не меняется (Р8)`, async () => {
      const task = await taskInStatus(status);
      const response = await manager.client
        .from('tasks')
        .update({
          title: 'Новое название',
          description: 'Новое описание',
          object_id: otherObject.id,
          assignee_id: otherExecutor.id,
        })
        .eq('id', task.id)
        .select()
        .single();
      assert.equal(response.error, null, JSON.stringify(response.error));
      assert.equal(response.data?.title, 'Новое название');
      assert.equal(response.data?.description, 'Новое описание');
      assert.equal(response.data?.object_id, otherObject.id);
      assert.equal(response.data?.assignee_id, otherExecutor.id);
      assert.equal(response.data?.status, status);
    });
  }
});

describe('Сценарий 11: снятие и назначение исполнителя', () => {
  for (const status of ['in_progress', 'in_review', 'rework'] as const) {
    test(`статус ${status}: снять исполнителя нельзя`, async () => {
      const task = await taskInStatus(status);
      assertRefusal(
        await manager.client.from('tasks').update({ assignee_id: null }).eq('id', task.id),
        'assignee_required',
      );
      assert.equal((await readTask(task.id)).assignee_id, executor.id);
    });
  }

  test('статус accepted: сначала отказ о принятой задаче', async () => {
    const task = await taskInStatus('accepted');
    assertRefusal(
      await manager.client.from('tasks').update({ assignee_id: null }).eq('id', task.id),
      'task_accepted',
    );
  });

  test('статус new: снять исполнителя можно', async () => {
    const task = await taskInStatus('new');
    const response = await manager.client
      .from('tasks')
      .update({ assignee_id: null })
      .eq('id', task.id)
      .select()
      .single();
    assert.equal(response.error, null, JSON.stringify(response.error));
    assert.equal(response.data?.assignee_id, null);
  });

  test('при создании назначить можно только исполнителя', async () => {
    const noProfile = await createUser('executor');
    await sql('delete from public.profiles where id = $1', [noProfile.id]);
    const title = `Не исполнитель ${randomUUID()}`;
    for (const [label, assigneeId] of [
      ['постановщик', otherManager.id],
      ['без профиля', noProfile.id],
      ['несуществующий', randomUUID()],
    ] as const) {
      const response = await manager.client
        .from('tasks')
        .insert({ title, object_id: object.id, assignee_id: assigneeId });
      assertRefusal(response, 'assignee_not_executor', label);
    }
    assert.equal(await countTasksTitled(title), 0);
  });

  test('при правке назначить можно только исполнителя, и с пустого, и с другого', async () => {
    const unassigned = await createTask(manager.client, { object_id: object.id });
    const assigned = await taskInStatus('in_progress');
    for (const task of [unassigned, assigned]) {
      for (const assigneeId of [otherManager.id, randomUUID()]) {
        assertRefusal(
          await manager.client.from('tasks').update({ assignee_id: assigneeId }).eq('id', task.id),
          'assignee_not_executor',
        );
      }
      assert.equal((await readTask(task.id)).assignee_id, task.assignee_id);
    }
  });

  test('роль проверяется только при смене: правка не падает, если исполнитель сменил роль', async () => {
    const promoted = await createUser('executor');
    const task = await createTask(manager.client, {
      object_id: object.id,
      assignee_id: promoted.id,
    });
    await sql(`update public.profiles set role = 'manager' where id = $1`, [promoted.id]);

    const edited = await manager.client
      .from('tasks')
      .update({ title: 'Правка после смены роли', assignee_id: promoted.id })
      .eq('id', task.id)
      .select()
      .single();
    assert.equal(edited.error, null, JSON.stringify(edited.error));
    assert.equal(edited.data?.title, 'Правка после смены роли');

    const reassigned = await manager.client
      .from('tasks')
      .update({ assignee_id: otherExecutor.id })
      .eq('id', task.id)
      .select()
      .single();
    assert.equal(reassigned.error, null, JSON.stringify(reassigned.error));
    assert.equal(reassigned.data?.assignee_id, otherExecutor.id);
  });
});

describe('Сценарий 15: удалённые объекты и задачи', () => {
  test('создать задачу в удалённом и несуществующем объекте нельзя', async () => {
    const deleted = await createDeletedObject();
    const title = `В удалённом ${randomUUID()}`;
    for (const objectId of [deleted.id, randomUUID()]) {
      assertRefusal(
        await manager.client.from('tasks').insert({ title, object_id: objectId }),
        'object_not_found',
      );
    }
    assert.equal(await countTasksTitled(title), 0);
  });

  test('перенести задачу в удалённый и несуществующий объект нельзя', async () => {
    const deleted = await createDeletedObject();
    const task = await taskInStatus('in_progress');
    for (const objectId of [deleted.id, randomUUID()]) {
      assertRefusal(
        await manager.client.from('tasks').update({ object_id: objectId }).eq('id', task.id),
        'object_not_found',
      );
    }
    assert.equal((await readTask(task.id)).object_id, object.id);
  });

  test('перенос в живой объект работает, исполнитель сразу видит новый объект вместо старого', async () => {
    const assignee = await createUser('executor');
    const from = await createObject(manager.client);
    const to = await createObject(manager.client);
    const task = await createTask(manager.client, { object_id: from.id, assignee_id: assignee.id });
    const moved = await manager.client
      .from('tasks')
      .update({ object_id: to.id })
      .eq('id', task.id)
      .select()
      .single();
    assert.equal(moved.error, null, JSON.stringify(moved.error));
    const visible = await assignee.client.from('objects').select('id');
    assert.deepEqual(visible.data, [{ id: to.id }]);
  });

  test('правка удалённой задачи не находит строку, данные и история не меняются', async () => {
    const task = await taskInStatus('in_progress');
    await setTaskState(task.id, { deleted_at: new Date().toISOString(), deleted_by: manager.id });
    const before = await readTask(task.id);
    const historyBefore = await historyCount(task.id);
    for (const fields of [
      { title: 'Новое' },
      { description: 'Новое' },
      { object_id: otherObject.id },
      { assignee_id: otherExecutor.id },
    ]) {
      const response = await manager.client.from('tasks').update(fields).eq('id', task.id).select();
      assert.equal(response.error, null);
      assert.deepEqual(response.data, [], JSON.stringify(Object.keys(fields)));
    }
    assert.deepEqual(await readTask(task.id), before);
    assert.equal(await historyCount(task.id), historyBefore);
  });

  test('правка удалённого объекта не находит строку', async () => {
    const deleted = await createDeletedObject();
    const response = await manager.client
      .from('objects')
      .update({ name: 'Новое' })
      .eq('id', deleted.id)
      .select();
    assert.equal(response.error, null);
    assert.deepEqual(response.data, []);
    const [row] = await sql<ObjectRow>('select * from public.objects where id = $1', [deleted.id]);
    assert.equal(row?.name, deleted.name);
  });

  test('создание ждёт незавершённое удаление объекта и получает отказ', async () => {
    const target = await createObject(manager.client);
    const title = `Гонка создания ${randomUUID()}`;
    const response = await inTransaction(async (query) => {
      await query('update public.objects set deleted_at = now(), deleted_by = $2 where id = $1', [
        target.id,
        manager.id,
      ]);
      const pending = manager.client
        .from('tasks')
        .insert({ title, object_id: target.id })
        .then((result) => result);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { pending };
    }).then(({ pending }) => pending);
    assertRefusal(response, 'object_not_found');
    assert.equal(await countTasksTitled(title), 0);
  });

  test('перенос ждёт незавершённое удаление объекта и получает отказ', async () => {
    const target = await createObject(manager.client);
    const task = await taskInStatus('in_progress');
    const response = await inTransaction(async (query) => {
      await query('update public.objects set deleted_at = now(), deleted_by = $2 where id = $1', [
        target.id,
        manager.id,
      ]);
      const pending = manager.client
        .from('tasks')
        .update({ object_id: target.id })
        .eq('id', task.id)
        .then((result) => result);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { pending };
    }).then(({ pending }) => pending);
    assertRefusal(response, 'object_not_found');
    assert.equal((await readTask(task.id)).object_id, object.id);
  });
});

describe('Сценарий 17: обязательные значения при правке и создании', () => {
  const BLANK = ['', '   ', '\n', '\t', ` ${NO_BREAK_SPACE}\n`];

  test('название задачи нельзя сделать пустым', async () => {
    const task = await taskInStatus('in_progress');
    for (const blank of BLANK) {
      const response = await manager.client
        .from('tasks')
        .update({ title: blank })
        .eq('id', task.id);
      assert.equal(response.error?.code, PG_CHECK_VIOLATION, JSON.stringify(blank));
    }
    const missing = await manager.client
      .from('tasks')
      .update({ title: null as never })
      .eq('id', task.id);
    assert.equal(missing.error?.code, PG_NOT_NULL_VIOLATION);
    assert.equal((await readTask(task.id)).title, task.title);
  });

  test('название и адрес объекта нельзя сделать пустыми', async () => {
    const target = await createObject(manager.client);
    for (const blank of BLANK) {
      for (const fields of [{ name: blank }, { address: blank }]) {
        const response = await manager.client.from('objects').update(fields).eq('id', target.id);
        assert.equal(response.error?.code, PG_CHECK_VIOLATION, JSON.stringify(fields));
      }
    }
  });

  test('объект задачи нельзя убрать ни при создании, ни при правке', async () => {
    const task = await taskInStatus('in_progress');
    const update = await manager.client
      .from('tasks')
      .update({ object_id: null as never })
      .eq('id', task.id);
    assert.equal(update.error?.code, PG_NOT_NULL_VIOLATION);
    const insert = await manager.client
      .from('tasks')
      .insert({ title: 'Без объекта', object_id: null as never });
    assert.equal(insert.error?.code, PG_NOT_NULL_VIOLATION);
  });

  test('длина текста ограничена и при правке', async () => {
    const task = await taskInStatus('new');
    const title = await manager.client
      .from('tasks')
      .update({ title: 'я'.repeat(201) })
      .eq('id', task.id);
    assert.equal(title.error?.code, PG_CHECK_VIOLATION);
    const description = await manager.client
      .from('tasks')
      .update({ description: 'я'.repeat(5001) })
      .eq('id', task.id);
    assert.equal(description.error?.code, PG_CHECK_VIOLATION);
  });

  test('описание можно убрать', async () => {
    const task = await taskInStatus('new');
    const response = await manager.client
      .from('tasks')
      .update({ description: null })
      .eq('id', task.id)
      .select()
      .single();
    assert.equal(response.error, null);
    assert.equal(response.data?.description, null);
  });
});
