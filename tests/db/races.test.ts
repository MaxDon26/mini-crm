// З5: сценарии 23, 24, 25 и гонка правки с принятием. Параллельные вызовы через API повторяются по
// нескольку раз и проверяются по итогу: порядок выбирает база. Удержание транзакции через inTransaction
// задаёт порядок точно, чтобы проверить оба исхода, а не надеяться, что они случатся сами.
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
  type ObjectRow,
  type TaskRow,
  type TaskStatus,
  type TestUser,
} from './helpers.ts';

const RUNS = 8;
const HOLD_MS = 400;

interface HistoryRow {
  id: string;
  actor_id: string;
  from_status: TaskStatus | null;
  to_status: TaskStatus | null;
  from_assignee_id: string | null;
  to_assignee_id: string | null;
}

let manager: TestUser;
let otherManager: TestUser;
let assignee: TestUser;
let successor: TestUser;
let object: ObjectRow;

before(async () => {
  [manager, otherManager, assignee, successor] = await Promise.all([
    createUser('manager'),
    createUser('manager'),
    createUser('executor'),
    createUser('executor'),
  ]);
  object = await createObject(manager.client);
});

function changeStatus(
  user: TestUser,
  taskId: string,
  expected: TaskStatus,
  next: TaskStatus,
  comment?: string,
) {
  return user.client.rpc('change_task_status', {
    p_task_id: taskId,
    p_expected_status: expected,
    p_new_status: next,
    ...(comment === undefined ? {} : { p_comment: comment }),
  });
}

function deleteObject(user: TestUser, objectId: string) {
  return user.client.rpc('delete_object', { p_object_id: objectId });
}

async function taskInStatus(status: TaskStatus): Promise<TaskRow> {
  const task = await createTask(manager.client, { object_id: object.id, assignee_id: assignee.id });
  if (status !== 'new') await setTaskState(task.id, { status });
  return task;
}

async function readTask(id: string): Promise<TaskRow> {
  const [row] = await sql<TaskRow>('select * from public.tasks where id = $1', [id]);
  assert.ok(row);
  return row;
}

/** Записи после создания задачи, в порядке появления. */
async function laterHistory(taskId: string): Promise<HistoryRow[]> {
  const rows = await sql<HistoryRow>(
    'select * from public.task_history where task_id = $1 order by id',
    [taskId],
  );
  return rows.slice(1);
}

async function liveTasksIn(objectId: string): Promise<number> {
  const [row] = await sql<{ count: string }>(
    'select count(*) from public.tasks where object_id = $1 and deleted_at is null',
    [objectId],
  );
  return Number(row?.count);
}

/**
 * Выполняет hold в незавершённой транзакции от имени holderId, отправляет запрос через API, убеждается,
 * что он ждёт, фиксирует транзакцию и возвращает ответ запроса.
 */
async function requestWhileHolding<Response>(
  holderId: string,
  hold: (
    query: (text: string, params?: readonly unknown[]) => Promise<unknown>,
  ) => Promise<unknown>,
  request: () => PromiseLike<Response>,
): Promise<Response> {
  const { pending } = await inTransaction(async (query) => {
    await hold(query);
    let settled = false;
    const started = Promise.resolve(request()).then((response) => {
      settled = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    assert.equal(settled, false, 'запрос должен ждать завершения транзакции');
    return { pending: started };
  }, holderId);
  return pending;
}

describe('Сценарий 23: двойной вызов смены статуса', () => {
  test('один пользователь дважды: прошёл один, в истории одна запись', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const task = await taskInStatus('new');
      const results = await Promise.all([
        changeStatus(assignee, task.id, 'new', 'in_progress'),
        changeStatus(assignee, task.id, 'new', 'in_progress'),
      ]);
      const refused = results.filter((result) => result.error);
      assert.equal(refused.length, 1, `прогон ${run}: ${JSON.stringify(results)}`);
      assert.ok(refused[0]);
      assertRefusal(refused[0], 'status_changed');
      assert.equal((await readTask(task.id)).status, 'in_progress');
      assert.equal((await laterHistory(task.id)).length, 1);
    }
  });

  test('пять одновременных нажатий: прошло одно', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const task = await taskInStatus('new');
      const results = await Promise.all(
        Array.from({ length: 5 }, () => changeStatus(assignee, task.id, 'new', 'in_progress')),
      );
      assert.equal(results.filter((result) => !result.error).length, 1, `прогон ${run}`);
      for (const result of results.filter((candidate) => candidate.error)) {
        assertRefusal(result, 'status_changed');
      }
      assert.equal((await laterHistory(task.id)).length, 1);
    }
  });

  test('два постановщика: принять и вернуть одновременно, итог совпадает с единственной записью', async () => {
    const outcomes = new Set<string>();
    for (let run = 0; run < RUNS; run += 1) {
      const task = await taskInStatus('in_review');
      const [accept, rework] = await Promise.all([
        changeStatus(manager, task.id, 'in_review', 'accepted'),
        changeStatus(otherManager, task.id, 'in_review', 'rework', 'Переделать'),
      ]);
      const passed = [accept, rework].filter((result) => !result.error);
      assert.equal(passed.length, 1, `прогон ${run}: ${JSON.stringify([accept, rework])}`);
      assertRefusal(accept.error ? accept : rework, 'status_changed');

      const final = (await readTask(task.id)).status;
      const history = await laterHistory(task.id);
      assert.equal(history.length, 1);
      assert.equal(history[0]?.to_status, final);
      assert.equal(history[0]?.actor_id, accept.error ? otherManager.id : manager.id);
      outcomes.add(final);
    }
    assert.ok(outcomes.size >= 1);
  });

  test('порядок задан: второй ждёт первого и получает «уже изменён»', async () => {
    const task = await taskInStatus('in_review');
    const response = await requestWhileHolding(
      manager.id,
      (query) => query(`select private.change_task_status($1, 'in_review', 'accepted')`, [task.id]),
      () => changeStatus(otherManager, task.id, 'in_review', 'rework', 'Переделать'),
    );
    assertRefusal(response, 'status_changed');
    assert.equal((await readTask(task.id)).status, 'accepted');
    assert.equal((await laterHistory(task.id)).length, 1);
  });
});

describe('Сценарий 24: смена исполнителя вместе со сменой статуса', () => {
  test('параллельно: история верна при любом порядке, снятый исполнитель не сдаёт', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const task = await taskInStatus('in_progress');
      const [submit, reassign] = await Promise.all([
        changeStatus(assignee, task.id, 'in_progress', 'in_review'),
        manager.client
          .from('tasks')
          .update({ assignee_id: successor.id })
          .eq('id', task.id)
          .select()
          .single(),
      ]);
      assert.equal(reassign.error, null, JSON.stringify(reassign.error));

      const row = await readTask(task.id);
      assert.equal(row.assignee_id, successor.id, 'передача проходит всегда');
      const history = await laterHistory(task.id);

      if (submit.error) {
        assertRefusal(submit, 'task_not_found');
        assert.equal(row.status, 'in_progress', 'снятый исполнитель не сдал задачу');
        assert.equal(history.length, 1);
        assert.equal(history[0]?.to_assignee_id, successor.id);
      } else {
        assert.equal(row.status, 'in_review');
        assert.equal(history.length, 2);
        assert.equal(history[0]?.to_status, 'in_review', 'сначала сдал, потом передали');
        assert.equal(history[0]?.actor_id, assignee.id);
        assert.equal(history[1]?.to_assignee_id, successor.id);
        assert.equal(history[1]?.from_assignee_id, assignee.id);
      }
    }
  });

  test('порядок задан: передача первой, снятый исполнитель ждёт и получает «не найдена»', async () => {
    const task = await taskInStatus('in_progress');
    const response = await requestWhileHolding(
      manager.id,
      (query) =>
        query('update public.tasks set assignee_id = $2 where id = $1', [task.id, successor.id]),
      () => changeStatus(assignee, task.id, 'in_progress', 'in_review'),
    );
    assertRefusal(response, 'task_not_found');
    const row = await readTask(task.id);
    assert.equal(row.status, 'in_progress');
    assert.equal(row.assignee_id, successor.id);
  });

  test('порядок задан: сдача первой, передача ждёт и пишется после неё', async () => {
    const task = await taskInStatus('in_progress');
    const response = await requestWhileHolding(
      assignee.id,
      (query) =>
        query(`select private.change_task_status($1, 'in_progress', 'in_review')`, [task.id]),
      () =>
        manager.client
          .from('tasks')
          .update({ assignee_id: successor.id })
          .eq('id', task.id)
          .select()
          .single(),
    );
    assert.equal(response.error, null, JSON.stringify(response.error));
    const history = await laterHistory(task.id);
    assert.deepEqual(
      history.map((row) => [row.to_status, row.to_assignee_id]),
      [
        ['in_review', null],
        [null, successor.id],
      ],
    );
  });

  test('снятие исполнителя вместе со взятием в работу: задача не остаётся в работе без исполнителя', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const task = await taskInStatus('new');
      const [start, remove] = await Promise.all([
        changeStatus(assignee, task.id, 'new', 'in_progress'),
        manager.client.from('tasks').update({ assignee_id: null }).eq('id', task.id).select(),
      ]);
      const row = await readTask(task.id);
      if (start.error) {
        assertRefusal(start, 'task_not_found');
        assert.equal(remove.error, null);
        assert.equal(row.status, 'new');
        assert.equal(row.assignee_id, null);
      } else {
        assertRefusal(remove, 'assignee_required');
        assert.equal(row.status, 'in_progress');
        assert.equal(row.assignee_id, assignee.id);
      }
    }
  });
});

describe('Сценарий 25: создание и перенос задачи вместе с удалением объекта', () => {
  test('создание параллельно: живой задачи в удалённом объекте нет', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const target = await createObject(manager.client);
      const title = `Гонка ${randomUUID()}`;
      const [created, deleted] = await Promise.all([
        manager.client.from('tasks').insert({ title, object_id: target.id }).select(),
        deleteObject(otherManager, target.id),
      ]);
      assert.equal(deleted.error, null, JSON.stringify(deleted.error));
      assert.equal(await liveTasksIn(target.id), 0, `прогон ${run}`);
      if (created.error) {
        assertRefusal(created, 'object_not_found');
      } else {
        const task = await readTask(created.data[0]?.id ?? '');
        assert.equal(task.deleted_by, otherManager.id, 'созданная раньше попала под удаление');
      }
    }
  });

  test('несколько созданий параллельно с удалением', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const target = await createObject(manager.client);
      const [deleted] = await Promise.all([
        deleteObject(otherManager, target.id),
        ...Array.from({ length: 4 }, (_, index) =>
          manager.client.from('tasks').insert({ title: `Гонка ${index}`, object_id: target.id }),
        ),
      ]);
      assert.equal(deleted.error, null, JSON.stringify(deleted.error));
      assert.equal(await liveTasksIn(target.id), 0, `прогон ${run}`);
    }
  });

  test('перенос параллельно: живой задачи в удалённом объекте нет', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const target = await createObject(manager.client);
      const task = await taskInStatus('in_progress');
      const [moved, deleted] = await Promise.all([
        manager.client.from('tasks').update({ object_id: target.id }).eq('id', task.id).select(),
        deleteObject(otherManager, target.id),
      ]);
      assert.equal(deleted.error, null, JSON.stringify(deleted.error));
      assert.equal(await liveTasksIn(target.id), 0, `прогон ${run}`);
      const row = await readTask(task.id);
      if (moved.error) {
        assertRefusal(moved, 'object_not_found');
        assert.equal(row.object_id, object.id);
        assert.equal(row.deleted_at, null, 'задача осталась живой в прежнем объекте');
      } else {
        assert.equal(row.object_id, target.id);
        assert.equal(row.deleted_by, otherManager.id);
      }
    }
  });

  test('порядок задан: удаление первым, создание ждёт и получает отказ', async () => {
    const target = await createObject(manager.client);
    const title = `Гонка ${randomUUID()}`;
    const response = await requestWhileHolding(
      otherManager.id,
      (query) => query('select private.delete_object($1)', [target.id]),
      () => manager.client.from('tasks').insert({ title, object_id: target.id }).select(),
    );
    assertRefusal(response, 'object_not_found');
    assert.equal(await liveTasksIn(target.id), 0);
  });

  test('порядок задан: создание первым, удаление ждёт и отмечает новую задачу', async () => {
    const target = await createObject(manager.client);
    let taskId = '';
    const response = await requestWhileHolding(
      manager.id,
      async (query) => {
        const result = (await query(
          `insert into public.tasks (title, object_id) values ('Гонка', $1) returning id`,
          [target.id],
        )) as { rows: { id: string }[] };
        taskId = result.rows[0]?.id ?? '';
      },
      () => deleteObject(otherManager, target.id),
    );
    assert.equal(response.error, null, JSON.stringify(response.error));
    assert.equal(await liveTasksIn(target.id), 0);
    const task = await readTask(taskId);
    assert.equal(task.deleted_by, otherManager.id);
    const [row] = await sql<ObjectRow>('select * from public.objects where id = $1', [target.id]);
    assert.deepEqual(task.deleted_at, row?.deleted_at, 'то же время, что у объекта');
  });

  test('порядок задан: перенос первым, удаление ждёт и отмечает перенесённую задачу', async () => {
    const target = await createObject(manager.client);
    const task = await taskInStatus('in_progress');
    const response = await requestWhileHolding(
      manager.id,
      (query) =>
        query('update public.tasks set object_id = $2 where id = $1', [task.id, target.id]),
      () => deleteObject(otherManager, target.id),
    );
    assert.equal(response.error, null, JSON.stringify(response.error));
    assert.equal(await liveTasksIn(target.id), 0);
    assert.equal((await readTask(task.id)).deleted_by, otherManager.id);
  });

  test('два удаления одного объекта: прошло одно, отметка от него', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const target = await createObject(manager.client);
      const task = await createTask(manager.client, { object_id: target.id });
      const [first, second] = await Promise.all([
        deleteObject(manager, target.id),
        deleteObject(otherManager, target.id),
      ]);
      assert.equal([first, second].filter((result) => !result.error).length, 1, `прогон ${run}`);
      assertRefusal(first.error ? first : second, 'object_not_found');
      assert.equal(
        (await readTask(task.id)).deleted_by,
        first.error ? otherManager.id : manager.id,
      );
    }
  });
});

describe('Правка задачи в момент принятия', () => {
  async function editTitle(taskId: string, title: string) {
    return otherManager.client.from('tasks').update({ title }).eq('id', taskId).select();
  }

  test('параллельно: правка либо прошла до принятия, либо получила отказ', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const task = await taskInStatus('in_review');
      const title = `Правка ${randomUUID()}`;
      const [accept, edit] = await Promise.all([
        changeStatus(manager, task.id, 'in_review', 'accepted'),
        editTitle(task.id, title),
      ]);
      assert.equal(accept.error, null, JSON.stringify(accept.error));
      const row = await readTask(task.id);
      assert.equal(row.status, 'accepted');
      if (edit.error) {
        assertRefusal(edit, 'task_accepted');
        assert.equal(row.title, task.title, 'отклонённая правка не записана');
      } else {
        assert.equal(row.title, title);
      }
      assert.equal((await laterHistory(task.id)).length, 1);
    }
  });

  test('порядок задан: принятие первым, правка ждёт и получает отказ, название прежнее', async () => {
    const task = await taskInStatus('in_review');
    const response = await requestWhileHolding(
      manager.id,
      (query) => query(`select private.change_task_status($1, 'in_review', 'accepted')`, [task.id]),
      () => editTitle(task.id, 'Поверх принятия'),
    );
    assertRefusal(response, 'task_accepted');
    const row = await readTask(task.id);
    assert.equal(row.status, 'accepted');
    assert.equal(row.title, task.title);
  });

  test('порядок задан: правка первой, принятие ждёт и проходит, правка сохранена', async () => {
    const task = await taskInStatus('in_review');
    const response = await requestWhileHolding(
      otherManager.id,
      (query) => query(`update public.tasks set title = 'До принятия' where id = $1`, [task.id]),
      () => changeStatus(manager, task.id, 'in_review', 'accepted'),
    );
    assert.equal(response.error, null, JSON.stringify(response.error));
    const row = await readTask(task.id);
    assert.equal(row.status, 'accepted');
    assert.equal(row.title, 'До принятия');
  });
});

describe('Два удаления одного и того же', () => {
  test('задача параллельно: прошло одно, отметка от него', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const task = await taskInStatus('in_progress');
      const [first, second] = await Promise.all([
        manager.client.rpc('delete_task', { p_task_id: task.id }),
        otherManager.client.rpc('delete_task', { p_task_id: task.id }),
      ]);
      assert.equal([first, second].filter((result) => !result.error).length, 1, `прогон ${run}`);
      assertRefusal(first.error ? first : second, 'task_not_found');
      assert.equal(
        (await readTask(task.id)).deleted_by,
        first.error ? otherManager.id : manager.id,
      );
    }
  });

  test('задача, порядок задан: второе ждёт, получает «не найдена» и не переписывает отметку', async () => {
    const task = await taskInStatus('in_progress');
    const response = await requestWhileHolding(
      manager.id,
      (query) => query('select private.delete_task($1)', [task.id]),
      () => otherManager.client.rpc('delete_task', { p_task_id: task.id }),
    );
    assertRefusal(response, 'task_not_found');
    assert.equal((await readTask(task.id)).deleted_by, manager.id);
  });

  test('объект, порядок задан: второе ждёт, получает «не найден» и не переписывает отметку', async () => {
    const target = await createObject(manager.client);
    const task = await createTask(manager.client, { object_id: target.id });
    const response = await requestWhileHolding(
      manager.id,
      (query) => query('select private.delete_object($1)', [target.id]),
      () => deleteObject(otherManager, target.id),
    );
    assertRefusal(response, 'object_not_found');
    const [row] = await sql<ObjectRow>('select * from public.objects where id = $1', [target.id]);
    assert.equal(row?.deleted_by, manager.id);
    assert.equal((await readTask(task.id)).deleted_by, manager.id);
  });
});

describe('Удаление задачи вместе со сменой статуса', () => {
  test('параллельно: удалённая задача не двигается, запись появляется только если сдача прошла раньше', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const task = await taskInStatus('in_progress');
      const [submit, removed] = await Promise.all([
        changeStatus(assignee, task.id, 'in_progress', 'in_review'),
        manager.client.rpc('delete_task', { p_task_id: task.id }),
      ]);
      assert.equal(removed.error, null, JSON.stringify(removed.error));
      const row = await readTask(task.id);
      assert.ok(row.deleted_at);
      const history = await laterHistory(task.id);
      if (submit.error) {
        assertRefusal(submit, 'task_not_found');
        assert.equal(row.status, 'in_progress');
        assert.equal(history.length, 0);
      } else {
        assert.equal(row.status, 'in_review');
        assert.equal(history.length, 1);
      }
    }
  });
});
