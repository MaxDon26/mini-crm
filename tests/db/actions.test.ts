// З5: сценарии 4, 6, 7, 10, 12, 14, 19 (смена статуса), 20, 21, 22. Все действия вызываются через API с
// токеном участника, как их вызывает сайт. Прямое подключение только готовит данные и сверяет итог.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import {
  assertRefusal,
  createObject,
  createTask,
  createUser,
  setTaskState,
  sql,
  type ObjectRow,
  type TaskRow,
  type TaskStatus,
  type TestUser,
} from './helpers.ts';
import {
  ALLOWED_TRANSITIONS,
  PARTICIPANTS,
  TASK_STATUSES,
  expectedAnswer,
  type Participant,
} from './transitions.ts';

const PG_CHECK_VIOLATION = '23514';
const PG_INVALID_TEXT = '22P02';
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

interface HistoryRow {
  id: string;
  task_id: string;
  actor_id: string;
  created_at: Date;
  from_status: TaskStatus | null;
  to_status: TaskStatus | null;
  from_assignee_id: string | null;
  to_assignee_id: string | null;
  comment: string | null;
}

let manager: TestUser;
let otherManager: TestUser;
let assignee: TestUser;
let otherExecutor: TestUser;
let noProfile: TestUser;
let object: ObjectRow;
let otherObject: ObjectRow;

before(async () => {
  [manager, otherManager, assignee, otherExecutor, noProfile] = await Promise.all([
    createUser('manager'),
    createUser('manager'),
    createUser('executor'),
    createUser('executor'),
    createUser('executor'),
  ]);
  await sql('delete from public.profiles where id = $1', [noProfile.id]);
  [object, otherObject] = await Promise.all([
    createObject(manager.client),
    createObject(manager.client),
  ]);
});

function changeStatus(
  user: TestUser,
  taskId: string,
  expected: TaskStatus | null,
  next: TaskStatus | null,
  comment?: string | null,
) {
  return user.client.rpc('change_task_status', {
    p_task_id: taskId,
    p_expected_status: expected as TaskStatus,
    p_new_status: next as TaskStatus,
    ...(comment === undefined ? {} : { p_comment: comment as string }),
  });
}

function deleteTask(user: TestUser, taskId: string) {
  return user.client.rpc('delete_task', { p_task_id: taskId });
}

function deleteObject(user: TestUser, objectId: string) {
  return user.client.rpc('delete_object', { p_object_id: objectId });
}

async function taskInStatus(status: TaskStatus, executor: TestUser = assignee): Promise<TaskRow> {
  const task = await createTask(manager.client, { object_id: object.id, assignee_id: executor.id });
  if (status !== 'new') await setTaskState(task.id, { status });
  return { ...task, status };
}

async function readTask(id: string): Promise<TaskRow> {
  const [row] = await sql<TaskRow>('select * from public.tasks where id = $1', [id]);
  assert.ok(row, 'задача должна оставаться в базе');
  return row;
}

async function readHistory(taskId: string): Promise<HistoryRow[]> {
  return sql<HistoryRow>('select * from public.task_history where task_id = $1 order by id', [
    taskId,
  ]);
}

async function assertUnchanged(taskId: string, action: () => PromiseLike<unknown>): Promise<void> {
  const taskBefore = await readTask(taskId);
  const historyBefore = await readHistory(taskId);
  await action();
  assert.deepEqual(await readTask(taskId), taskBefore, 'задача не должна измениться');
  assert.deepEqual(await readHistory(taskId), historyBefore, 'история не должна измениться');
}

describe('Сценарий 20: все сочетания статуса и участника', () => {
  const observed: string[] = [];

  function userOf(participant: Participant): TestUser {
    const users: Record<Participant, TestUser> = {
      manager,
      assignee,
      other_executor: otherExecutor,
      no_profile: noProfile,
    };
    return users[participant];
  }

  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      for (const participant of PARTICIPANTS) {
        const expected = expectedAnswer(from, to, participant);
        test(`${from} → ${to}, ${participant}: ${expected}`, async () => {
          const task = await taskInStatus(from);
          const historyBefore = await readHistory(task.id);
          const user = userOf(participant);
          const response = await changeStatus(user, task.id, from, to, 'Комментарий');

          if (expected === 'ok') {
            assert.equal(response.error, null, JSON.stringify(response.error));
            observed.push(`${from}:${to}:${participant}`);
            assert.equal((await readTask(task.id)).status, to);
            const history = await readHistory(task.id);
            assert.equal(history.length, historyBefore.length + 1, 'ровно одна новая запись');
            const record = history.at(-1);
            assert.equal(record?.from_status, from);
            assert.equal(record?.to_status, to);
            assert.equal(record?.actor_id, user.id);
            assert.equal(record?.comment, 'Комментарий');
            assert.equal(record?.from_assignee_id, null);
            assert.equal(record?.to_assignee_id, null);
          } else {
            assertRefusal(response, expected);
            assert.equal((await readTask(task.id)).status, from);
            assert.equal((await readHistory(task.id)).length, historyBefore.length);
          }
        });
      }
    }
  }

  test('разрешены ровно 5 переходов из 100 сочетаний', () => {
    assert.equal(TASK_STATUSES.length * TASK_STATUSES.length * PARTICIPANTS.length, 100);
    assert.deepEqual(
      [...observed].sort(),
      ALLOWED_TRANSITIONS.map(({ from, to, by }) => `${from}:${to}:${by}`).sort(),
    );
    assert.equal(observed.length, 5);
  });
});

describe('Сценарий 4: чужая задача', () => {
  test('смена статуса и удаление чужой задачи: «не найдена», ничего не меняется', async () => {
    const task = await taskInStatus('new');
    await assertUnchanged(task.id, async () => {
      assertRefusal(
        await changeStatus(otherExecutor, task.id, 'new', 'in_progress'),
        'task_not_found',
      );
      assertRefusal(await deleteTask(otherExecutor, task.id), 'task_not_found');
    });
  });

  test('ответ на чужую, удалённую и несуществующую задачу не отличается ничем', async () => {
    const foreign = await taskInStatus('in_review');
    const deleted = await taskInStatus('in_review', otherExecutor);
    await setTaskState(deleted.id, {
      deleted_at: new Date().toISOString(),
      deleted_by: manager.id,
    });

    const answers = [
      await changeStatus(otherExecutor, foreign.id, 'in_review', 'accepted'),
      await changeStatus(otherExecutor, deleted.id, 'in_review', 'accepted'),
      await changeStatus(otherExecutor, randomUUID(), 'in_review', 'accepted'),
    ].map((response) => JSON.stringify({ status: response.status, error: response.error }));
    assert.equal(new Set(answers).size, 1, answers.join(' | '));
  });

  test('неверный ожидаемый статус не раскрывает, какой статус у чужой задачи на самом деле', async () => {
    const task = await taskInStatus('in_review');
    for (const expected of TASK_STATUSES) {
      assertRefusal(
        await changeStatus(otherExecutor, task.id, expected, 'in_progress'),
        'task_not_found',
        expected,
      );
    }
  });

  test('задача без исполнителя: исполнителю не найдена, постановщику переход запрещён', async () => {
    const task = await createTask(manager.client, { object_id: object.id });
    assertRefusal(await changeStatus(assignee, task.id, 'new', 'in_progress'), 'task_not_found');
    assertRefusal(
      await changeStatus(manager, task.id, 'new', 'in_progress'),
      'transition_forbidden',
    );
  });

  test('исполнитель на свою задачу при удалении получает «недостаточно прав»', async () => {
    const task = await taskInStatus('in_progress');
    await assertUnchanged(task.id, async () => {
      assertRefusal(await deleteTask(assignee, task.id), 'forbidden');
    });
  });
});

describe('Сценарий 6: передача задачи другому исполнителю', () => {
  test('прежний сразу теряет доступ и не может сдать, новый продолжает и видит всю историю', async () => {
    const previous = await createUser('executor');
    const next = await createUser('executor');
    const task = await taskInStatus('new', previous);
    assert.equal((await changeStatus(previous, task.id, 'new', 'in_progress')).error, null);

    const moved = await manager.client
      .from('tasks')
      .update({ assignee_id: next.id })
      .eq('id', task.id)
      .select()
      .single();
    assert.equal(moved.error, null, JSON.stringify(moved.error));

    assertRefusal(
      await changeStatus(previous, task.id, 'in_progress', 'in_review'),
      'task_not_found',
    );
    assert.deepEqual((await previous.client.from('tasks').select('id')).data, []);
    assert.deepEqual((await previous.client.from('task_history').select('id')).data, []);

    assert.equal((await changeStatus(next, task.id, 'in_progress', 'in_review')).error, null);
    const seen = await next.client
      .from('task_history')
      .select('*')
      .eq('task_id', task.id)
      .order('id');
    assert.deepEqual(
      seen.data?.map((row) => [row.actor_id, row.from_status, row.to_status, row.to_assignee_id]),
      [
        [manager.id, null, 'new', previous.id],
        [previous.id, 'new', 'in_progress', null],
        [manager.id, null, null, next.id],
        [next.id, 'in_progress', 'in_review', null],
      ],
    );
  });
});

describe('Сценарий 12: комментарий при возврате на доработку', () => {
  const BLANK: [string, string | null | undefined][] = [
    ['не передан', undefined],
    ['пустое значение', null],
    ['пустая строка', ''],
    ['пробелы', '   '],
    ['перенос строки', '\n'],
    ['табуляция', '\t'],
    ['неразрывный пробел', ` ${NO_BREAK_SPACE}\r\n`],
  ];

  for (const [label, comment] of BLANK) {
    test(`без текста (${label}): отказ, статус и история не меняются`, async () => {
      const task = await taskInStatus('in_review');
      await assertUnchanged(task.id, async () => {
        assertRefusal(
          await changeStatus(manager, task.id, 'in_review', 'rework', comment),
          'comment_required',
        );
      });
    });

    test(`другой переход (${label}): проходит, комментарий пуст`, async () => {
      const task = await taskInStatus('in_review');
      const response = await changeStatus(manager, task.id, 'in_review', 'accepted', comment);
      assert.equal(response.error, null, JSON.stringify(response.error));
      assert.equal((await readHistory(task.id)).at(-1)?.comment, null);
    });
  }

  test('с текстом: возврат проходит, текст сохранён как есть', async () => {
    const task = await taskInStatus('in_review');
    const response = await changeStatus(manager, task.id, 'in_review', 'rework', '  Переделать  ');
    assert.equal(response.error, null, JSON.stringify(response.error));
    assert.equal((await readTask(task.id)).status, 'rework');
    assert.equal((await readHistory(task.id)).at(-1)?.comment, '  Переделать  ');
  });

  test('комментарий при обычном переходе сохраняется', async () => {
    const task = await taskInStatus('new');
    const response = await changeStatus(assignee, task.id, 'new', 'in_progress', 'Начал');
    assert.equal(response.error, null, JSON.stringify(response.error));
    assert.equal((await readHistory(task.id)).at(-1)?.comment, 'Начал');
  });

  test('длина ограничена: 2000 проходит, 2001 отказ по проверке таблицы и статус на месте', async () => {
    const tooLong = await taskInStatus('in_review');
    await assertUnchanged(tooLong.id, async () => {
      const response = await changeStatus(
        manager,
        tooLong.id,
        'in_review',
        'rework',
        'я'.repeat(2001),
      );
      assert.equal(response.error?.code, PG_CHECK_VIOLATION);
    });

    const longest = await taskInStatus('in_review');
    const response = await changeStatus(
      manager,
      longest.id,
      'in_review',
      'rework',
      'я'.repeat(2000),
    );
    assert.equal(response.error, null, JSON.stringify(response.error));
  });

  test('запрет перехода важнее комментария: чужому переходу отвечаем про переход', async () => {
    const task = await taskInStatus('in_review');
    assertRefusal(
      await changeStatus(assignee, task.id, 'in_review', 'rework'),
      'transition_forbidden',
    );
  });
});

describe('Сценарий 19: запись о смене статуса', () => {
  test('полный цикл ТЗ: кто, откуда, куда, комментарий, время от базы, исполнитель не трогается', async () => {
    const task = await taskInStatus('new');
    const steps: [TestUser, TaskStatus, TaskStatus, string?][] = [
      [assignee, 'new', 'in_progress'],
      [assignee, 'in_progress', 'in_review'],
      [otherManager, 'in_review', 'rework', 'Нет фото'],
      [assignee, 'rework', 'in_progress'],
      [assignee, 'in_progress', 'in_review'],
      [manager, 'in_review', 'accepted'],
    ];
    for (const [user, from, to, comment] of steps) {
      const response = await changeStatus(user, task.id, from, to, comment);
      assert.equal(response.error, null, `${from} → ${to}: ${JSON.stringify(response.error)}`);
    }

    const history = await readHistory(task.id);
    assert.deepEqual(
      history.slice(1).map((row) => [row.actor_id, row.from_status, row.to_status, row.comment]),
      steps.map(([user, from, to, comment]) => [user.id, from, to, comment ?? null]),
    );
    for (const row of history.slice(1)) {
      assert.equal(row.from_assignee_id, null);
      assert.equal(row.to_assignee_id, null);
    }

    const [clock] = await sql<{ seconds: number }>(
      `select max(abs(extract(epoch from (now() - created_at))))::float as seconds
       from public.task_history where task_id = $1`,
      [task.id],
    );
    assert.ok(clock && clock.seconds < 60, 'время записей от базы');

    const row = await readTask(task.id);
    assert.equal(row.status, 'accepted');
    assert.equal(row.assignee_id, assignee.id);
  });

  test('обе роли видят запись через API', async () => {
    const task = await taskInStatus('new');
    await changeStatus(assignee, task.id, 'new', 'in_progress', 'Начал');
    for (const user of [assignee, manager]) {
      const seen = await user.client
        .from('task_history')
        .select('from_status, to_status, comment, actor_id')
        .eq('task_id', task.id)
        .not('from_status', 'is', null);
      assert.deepEqual(seen.data, [
        {
          from_status: 'new',
          to_status: 'in_progress',
          comment: 'Начал',
          actor_id: assignee.id,
        },
      ]);
    }
  });
});

describe('Сценарий 21: статус устарел или перехода нет', () => {
  test('повторное действие получает «уже изменён», записи нет', async () => {
    const task = await taskInStatus('new');
    assert.equal((await changeStatus(assignee, task.id, 'new', 'in_progress')).error, null);
    await assertUnchanged(task.id, async () => {
      assertRefusal(await changeStatus(assignee, task.id, 'new', 'in_progress'), 'status_changed');
    });
  });

  test('устаревший статус проверяется раньше перехода', async () => {
    const task = await taskInStatus('in_review');
    assertRefusal(await changeStatus(manager, task.id, 'new', 'in_progress'), 'status_changed');
    assertRefusal(await changeStatus(assignee, task.id, 'new', 'accepted'), 'status_changed');
  });

  test('статус совпал, перехода нет: «запрещён»', async () => {
    const task = await taskInStatus('in_review');
    assertRefusal(await changeStatus(manager, task.id, 'in_review', 'new'), 'transition_forbidden');
    assertRefusal(
      await changeStatus(assignee, task.id, 'in_review', 'in_review'),
      'transition_forbidden',
    );
  });

  test('пустые значения не обходят проверки', async () => {
    const task = await taskInStatus('in_review');
    await assertUnchanged(task.id, async () => {
      assertRefusal(await changeStatus(manager, task.id, null, 'accepted'), 'status_changed');
      assertRefusal(
        await changeStatus(manager, task.id, 'in_review', null),
        'transition_forbidden',
      );
    });
  });

  test('значение не из перечисления отклоняется до функции', async () => {
    const task = await taskInStatus('in_review');
    await assertUnchanged(task.id, async () => {
      const response = await changeStatus(
        manager,
        task.id,
        'in_review',
        'accepted_by_hacker' as TaskStatus,
      );
      assert.equal(response.error?.code, PG_INVALID_TEXT);
    });
  });

  test('обёртка не меняет код отказа: чистый текст без подробностей', async () => {
    const task = await taskInStatus('in_review');
    const response = await changeStatus(manager, task.id, 'new', 'in_progress');
    assert.equal(response.error?.message, 'status_changed');
    assert.equal(response.error?.code, 'P0001');
    assert.equal(response.error?.details, null);
    assert.equal(response.error?.hint, null);
  });
});

describe('Сценарий 22: аккаунт без профиля', () => {
  test('смена статуса и удаление задачи: «не найдена», удаление объекта: «нет прав»', async () => {
    const task = await taskInStatus('in_review');
    await assertUnchanged(task.id, async () => {
      for (const status of TASK_STATUSES) {
        assertRefusal(
          await changeStatus(noProfile, task.id, status, 'accepted', 'Комментарий'),
          'task_not_found',
          status,
        );
      }
      assertRefusal(await deleteTask(noProfile, task.id), 'task_not_found');
    });
    const target = await createObject(manager.client);
    assertRefusal(await deleteObject(noProfile, target.id), 'forbidden');
    assertRefusal(await deleteObject(noProfile, randomUUID()), 'forbidden');
    const [row] = await sql<ObjectRow>('select * from public.objects where id = $1', [target.id]);
    assert.equal(row?.deleted_at, null);
  });
});

describe('Роль проверяется в момент действия (Р6, раздел 2.3)', () => {
  test('исполнитель, ставший постановщиком: принимает бывшую работу, но уже не сдаёт', async () => {
    const promoted = await createUser('executor');
    const review = await taskInStatus('in_review', promoted);
    const inWork = await taskInStatus('in_progress', promoted);
    assertRefusal(
      await changeStatus(promoted, review.id, 'in_review', 'accepted'),
      'transition_forbidden',
    );

    await sql(`update public.profiles set role = 'manager' where id = $1`, [promoted.id]);

    assert.equal((await changeStatus(promoted, review.id, 'in_review', 'accepted')).error, null);
    assertRefusal(
      await changeStatus(promoted, inWork.id, 'in_progress', 'in_review'),
      'transition_forbidden',
    );
  });

  test('постановщик, ставший исполнителем: с тем же токеном права сразу пропадают', async () => {
    const demoted = await createUser('manager');
    const task = await taskInStatus('in_review');
    await sql(`update public.profiles set role = 'executor' where id = $1`, [demoted.id]);
    assertRefusal(await changeStatus(demoted, task.id, 'in_review', 'accepted'), 'task_not_found');
    assertRefusal(await deleteTask(demoted, task.id), 'task_not_found');
    assertRefusal(await deleteObject(demoted, object.id), 'forbidden');
  });
});

describe('Сценарий 7: удаление единственной задачи исполнителя в объекте', () => {
  test('объект и имена из этой задачи ему больше не видны', async () => {
    const executor = await createUser('executor');
    const author = await createUser('manager');
    const target = await createObject(manager.client);
    const task = await createTask(author.client, {
      object_id: target.id,
      assignee_id: executor.id,
    });

    const { client } = executor;
    assert.deepEqual((await client.from('objects').select('id')).data, [{ id: target.id }]);
    const names = (await client.from('profiles').select('id')).data?.map((row) => row.id);
    assert.ok(names?.includes(author.id), 'до удаления автор виден');

    assert.equal((await deleteTask(manager, task.id)).error, null);

    assert.deepEqual((await client.from('tasks').select('id')).data, []);
    assert.deepEqual((await client.from('task_history').select('id')).data, []);
    assert.deepEqual((await client.from('objects').select('id')).data, []);
    assert.deepEqual((await client.from('profiles').select('id')).data, [{ id: executor.id }]);
  });

  test('если в объекте осталась другая задача, объект виден, а задача нет', async () => {
    const executor = await createUser('executor');
    const target = await createObject(manager.client);
    const removed = await createTask(manager.client, {
      object_id: target.id,
      assignee_id: executor.id,
    });
    const kept = await createTask(manager.client, {
      object_id: target.id,
      assignee_id: executor.id,
    });
    assert.equal((await deleteTask(manager, removed.id)).error, null);
    const { client } = executor;
    assert.deepEqual((await client.from('objects').select('id')).data, [{ id: target.id }]);
    assert.deepEqual((await client.from('tasks').select('id')).data, [{ id: kept.id }]);
  });
});

describe('Сценарий 10: удаление задачи постановщиком', () => {
  for (const status of TASK_STATUSES) {
    test(`статус ${status}: скрыта для всех, история сохранена, записано кто и когда`, async () => {
      const task = await taskInStatus(status);
      const historyBefore = await readHistory(task.id);

      assert.equal((await deleteTask(otherManager, task.id)).error, null);

      const row = await readTask(task.id);
      assert.equal(row.deleted_by, otherManager.id);
      assert.ok(row.deleted_at, 'когда удалили');
      assert.equal(row.status, status, 'статус не меняется');
      assert.deepEqual(await readHistory(task.id), historyBefore, 'история сохранена');

      for (const user of [manager, otherManager, assignee]) {
        assert.deepEqual(
          (await user.client.from('tasks').select('id').eq('id', task.id)).data,
          [],
          'задача через API',
        );
        assert.deepEqual(
          (await user.client.from('task_history').select('id').eq('task_id', task.id)).data,
          [],
          'история через API',
        );
      }
    });
  }

  test('удалённую нельзя удалить снова, двигать и править', async () => {
    const task = await taskInStatus('in_review');
    assert.equal((await deleteTask(manager, task.id)).error, null);
    await assertUnchanged(task.id, async () => {
      assertRefusal(await deleteTask(manager, task.id), 'task_not_found');
      assertRefusal(await deleteTask(otherManager, task.id), 'task_not_found');
      assertRefusal(
        await changeStatus(manager, task.id, 'in_review', 'accepted'),
        'task_not_found',
      );
      const edit = await manager.client
        .from('tasks')
        .update({ title: 'Новое' })
        .eq('id', task.id)
        .select();
      assert.deepEqual(edit.data, []);
    });
  });

  test('несуществующая: «не найдена»', async () => {
    assertRefusal(await deleteTask(manager, randomUUID()), 'task_not_found');
  });
});

describe('Сценарий 14: удаление объекта с задачами', () => {
  test('объект и живые задачи отмечены одним временем и автором, история сохранена и скрыта', async () => {
    const target = await createObject(manager.client);
    const executor = await createUser('executor');
    const tasks = await Promise.all(
      TASK_STATUSES.map(async (status) => {
        const task = await createTask(manager.client, {
          object_id: target.id,
          assignee_id: executor.id,
        });
        if (status !== 'new') await setTaskState(task.id, { status });
        return { ...task, status };
      }),
    );
    const unassigned = await createTask(manager.client, { object_id: target.id });
    const deletedEarlier = await createTask(manager.client, {
      object_id: target.id,
      assignee_id: executor.id,
    });
    assert.equal((await deleteTask(otherManager, deletedEarlier.id)).error, null);
    const earlierMark = await readTask(deletedEarlier.id);
    const elsewhere = await createTask(manager.client, {
      object_id: otherObject.id,
      assignee_id: executor.id,
    });

    const live = [...tasks, unassigned];
    const historyBefore = await Promise.all(live.map((task) => readHistory(task.id)));

    assert.equal((await deleteObject(manager, target.id)).error, null);

    const [objectRow] = await sql<ObjectRow>('select * from public.objects where id = $1', [
      target.id,
    ]);
    assert.equal(objectRow?.deleted_by, manager.id);
    assert.ok(objectRow?.deleted_at);

    for (const [index, task] of live.entries()) {
      const row = await readTask(task.id);
      assert.equal(row.deleted_by, manager.id);
      assert.deepEqual(row.deleted_at, objectRow.deleted_at, 'то же время, что у объекта');
      assert.equal(row.status, task.status);
      assert.deepEqual(await readHistory(task.id), historyBefore[index], 'история сохранена');
    }

    const earlier = await readTask(deletedEarlier.id);
    assert.equal(earlier.deleted_by, otherManager.id, 'уже удалённую задачу не переписываем');
    assert.deepEqual(earlier.deleted_at, earlierMark.deleted_at);
    assert.equal((await readTask(elsewhere.id)).deleted_at, null, 'задача другого объекта жива');

    const ids = [...live.map((task) => task.id), deletedEarlier.id];
    for (const user of [manager, otherManager, executor]) {
      const { client } = user;
      assert.deepEqual((await client.from('objects').select('id').eq('id', target.id)).data, []);
      assert.deepEqual(
        (await client.from('tasks').select('id').eq('object_id', target.id)).data,
        [],
      );
      assert.deepEqual(
        (await client.from('task_history').select('id').in('task_id', ids)).data,
        [],
      );
    }
    assert.deepEqual((await executor.client.from('objects').select('id')).data, [
      { id: otherObject.id },
    ]);
  });

  test('только постановщик: остальным один ответ независимо от существования объекта', async () => {
    const target = await createObject(manager.client);
    const task = await createTask(manager.client, {
      object_id: target.id,
      assignee_id: assignee.id,
    });
    const deleted = await createObject(manager.client);
    assert.equal((await deleteObject(manager, deleted.id)).error, null);

    for (const user of [assignee, otherExecutor, noProfile]) {
      for (const objectId of [target.id, deleted.id, randomUUID()]) {
        assertRefusal(await deleteObject(user, objectId), 'forbidden');
      }
    }
    const [row] = await sql<ObjectRow>('select * from public.objects where id = $1', [target.id]);
    assert.equal(row?.deleted_at, null);
    assert.equal((await readTask(task.id)).deleted_at, null);
  });

  test('удалённый и несуществующий объект: «не найден»', async () => {
    const deleted = await createObject(manager.client);
    assert.equal((await deleteObject(manager, deleted.id)).error, null);
    assertRefusal(await deleteObject(manager, deleted.id), 'object_not_found');
    assertRefusal(await deleteObject(otherManager, randomUUID()), 'object_not_found');
  });

  test('в удалённом объекте нельзя создать задачу и перенести её туда', async () => {
    const deleted = await createObject(manager.client);
    assert.equal((await deleteObject(manager, deleted.id)).error, null);
    assertRefusal(
      await manager.client.from('tasks').insert({ title: 'Задача', object_id: deleted.id }),
      'object_not_found',
    );
    const task = await taskInStatus('new');
    assertRefusal(
      await manager.client.from('tasks').update({ object_id: deleted.id }).eq('id', task.id),
      'object_not_found',
    );
  });
});
