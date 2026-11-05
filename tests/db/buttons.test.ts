// З10: сценарий 20 полностью (Р17). Сайт выбирает кнопки по statuses.ts, а решает база, и эти две копии
// правил никто больше не связывает: если они разойдутся, пользователь увидит кнопку с отказом или не
// увидит нужной. Ответы базы только настоящие: через API с токеном участника.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  STATUS_LABELS,
  TRANSITIONS,
  getAvailableActions,
  type AvailableActionsParams,
} from '../../src/features/tasks/statuses.ts';
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
  type Participant,
} from './transitions.ts';

const COMMENT = 'Комментарий';

// Постороннему база отвечает так же, как на несуществующую задачу, поэтому это тоже отказ в переходе.
// Любой другой ответ (status_changed, сбой сети, ошибка прав) про кнопки ничего не говорит: если считать
// его отказом, сломанная проверка выглядела бы как совпадение.
const TRANSITION_REFUSALS = ['task_not_found', 'transition_forbidden'];

const SITE_PARAMS: Record<Participant, Pick<AvailableActionsParams, 'role' | 'isAssignee'>> = {
  manager: { role: 'manager', isAssignee: false },
  assignee: { role: 'executor', isAssignee: true },
  other_executor: { role: 'executor', isAssignee: false },
  no_profile: { role: null, isAssignee: false },
};

let users: Record<Participant, TestUser>;
let object: ObjectRow;

before(async () => {
  const [manager, assignee, otherExecutor, noProfile] = await Promise.all([
    createUser('manager'),
    createUser('executor'),
    createUser('executor'),
    createUser('executor'),
  ]);
  await sql('delete from public.profiles where id = $1', [noProfile.id]);
  users = { manager, assignee, other_executor: otherExecutor, no_profile: noProfile };
  object = await createObject(manager.client);
});

async function taskInStatus(status: TaskStatus): Promise<TaskRow> {
  const task = await createTask(users.manager.client, {
    object_id: object.id,
    assignee_id: users.assignee.id,
  });
  if (status !== 'new') await setTaskState(task.id, { status });
  return task;
}

function changeStatus(
  participant: Participant,
  taskId: string,
  from: TaskStatus,
  to: TaskStatus,
  comment?: string,
) {
  return users[participant].client.rpc('change_task_status', {
    p_task_id: taskId,
    p_expected_status: from,
    p_new_status: to,
    ...(comment === undefined ? {} : { p_comment: comment }),
  });
}

async function currentStatus(taskId: string): Promise<TaskStatus | undefined> {
  const [row] = await sql<Pick<TaskRow, 'status'>>(
    'select status from public.tasks where id = $1',
    [taskId],
  );
  return row?.status;
}

function isButtonShown(from: TaskStatus, to: TaskStatus, participant: Participant): boolean {
  const actions = getAvailableActions({ status: from, ...SITE_PARAMS[participant] });
  return actions.some((action) => action.to === to);
}

describe('Сценарий 20: кнопки сайта и ответы базы совпадают', () => {
  const allowedByDatabase: string[] = [];

  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      for (const participant of PARTICIPANTS) {
        const shown = isButtonShown(from, to, participant);
        test(`${from} → ${to}, ${participant}: кнопка ${shown ? 'есть' : 'нет'}`, async () => {
          const task = await taskInStatus(from);
          // Комментарий передаём по правилу ТЗ, а не по таблице сайта: здесь сверяем только право на
          // переход, а commentRequired проверяется отдельно ниже.
          const comment = to === 'rework' ? COMMENT : undefined;
          const { error } = await changeStatus(participant, task.id, from, to, comment);

          if (error) {
            assert.ok(TRANSITION_REFUSALS.includes(error.message), JSON.stringify(error));
          } else {
            allowedByDatabase.push(`${from}:${to}:${participant}`);
          }
          assert.equal(shown, error === null, `кнопка: ${shown}, ответ базы: ${error?.message}`);
          assert.equal(await currentStatus(task.id), error ? from : to);
        });
      }
    }
  }

  test('база разрешила ровно то, что есть в таблице сайта, из 100 сочетаний', () => {
    assert.equal(TASK_STATUSES.length * TASK_STATUSES.length * PARTICIPANTS.length, 100);
    assert.deepEqual(
      [...allowedByDatabase].sort(),
      TRANSITIONS.map(({ from, to, by }) => `${from}:${to}:${by}`).sort(),
    );
  });
});

describe('Сценарий 20: обязательность комментария', () => {
  for (const { from, to, by, commentRequired } of TRANSITIONS) {
    const answer = commentRequired ? 'comment_required' : 'проходит';

    test(`${from} → ${to}: без комментария ${answer}`, async () => {
      const task = await taskInStatus(from);
      const response = await changeStatus(by, task.id, from, to);

      if (commentRequired) {
        assertRefusal(response, 'comment_required');
        assert.equal(await currentStatus(task.id), from);
      } else {
        assert.equal(response.error, null, JSON.stringify(response.error));
        assert.equal(await currentStatus(task.id), to);
      }
    });

    test(`${from} → ${to}: с комментарием проходит`, async () => {
      const task = await taskInStatus(from);
      const response = await changeStatus(by, task.id, from, to, COMMENT);

      assert.equal(response.error, null, JSON.stringify(response.error));
      assert.equal(await currentStatus(task.id), to);
    });
  }
});

describe('Сценарий 20: полнота сверки', () => {
  test('таблица сайта и таблица тестов совпадают как множества', () => {
    const toKey = (transition: {
      from: TaskStatus;
      to: TaskStatus;
      by: string;
      commentRequired: boolean;
    }) =>
      `${transition.from}:${transition.to}:${transition.by}:${String(transition.commentRequired)}`;

    assert.deepEqual(TRANSITIONS.map(toKey).sort(), ALLOWED_TRANSITIONS.map(toKey).sort());
  });

  // Сочетания перебираются по TASK_STATUSES: новый статус вне этого списка прошёл бы мимо сверки.
  test('перебор охватывает все статусы сайта и базы', async () => {
    const rows = await sql<{ status: string }>(
      'select unnest(enum_range(null::public.task_status))::text as status',
    );
    const expected = [...TASK_STATUSES].sort();

    assert.deepEqual(rows.map(({ status }) => status).sort(), expected);
    assert.deepEqual(Object.keys(STATUS_LABELS).sort(), expected);
  });
});
