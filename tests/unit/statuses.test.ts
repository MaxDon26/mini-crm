import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getAvailableActions,
  STATUS_LABELS,
  TRANSITIONS,
  type TaskStatus,
} from '../../src/features/tasks/statuses.ts';

// Ожидания записаны здесь отдельно от кода: тест сверяет код с ТЗ п. 2.3, а не код с самим собой.
const STATUSES: TaskStatus[] = ['new', 'in_progress', 'in_review', 'accepted', 'rework'];

type Expected = { from: TaskStatus; to: TaskStatus; label: string; commentRequired: boolean };

const ASSIGNEE_TRANSITIONS: Expected[] = [
  { from: 'new', to: 'in_progress', label: 'Взять в работу', commentRequired: false },
  { from: 'in_progress', to: 'in_review', label: 'Отправить на проверку', commentRequired: false },
  { from: 'rework', to: 'in_progress', label: 'Взять в работу', commentRequired: false },
];

const MANAGER_TRANSITIONS: Expected[] = [
  { from: 'in_review', to: 'accepted', label: 'Принять', commentRequired: false },
  { from: 'in_review', to: 'rework', label: 'Вернуть на доработку', commentRequired: true },
];

function pickTargets(status: TaskStatus, transitions: Expected[]): TaskStatus[] {
  return transitions.filter(({ from }) => from === status).map(({ to }) => to);
}

function expectedTargets(status: TaskStatus, role: string, isAssignee: boolean): TaskStatus[] {
  if (role === 'manager') return pickTargets(status, MANAGER_TRANSITIONS);
  return isAssignee ? pickTargets(status, ASSIGNEE_TRANSITIONS) : [];
}

describe('STATUS_LABELS', () => {
  it('даёт русские названия всех пяти статусов контракта', () => {
    assert.deepEqual(STATUS_LABELS, {
      new: 'Новая',
      in_progress: 'В работе',
      in_review: 'На проверке',
      accepted: 'Принята',
      rework: 'На доработке',
    });
  });
});

describe('TRANSITIONS', () => {
  it('содержит ровно 5 переходов ТЗ, без создания «— → Новая»', () => {
    const actual = TRANSITIONS.map(({ from, to, by }) => `${from}>${to}:${by}`).sort();
    assert.deepEqual(
      actual,
      [
        'new>in_progress:assignee',
        'in_progress>in_review:assignee',
        'in_review>accepted:manager',
        'in_review>rework:manager',
        'rework>in_progress:assignee',
      ].sort(),
    );
  });

  it('требует комментарий только при возврате на доработку', () => {
    const required = TRANSITIONS.filter(({ commentRequired }) => commentRequired);
    assert.deepEqual(
      required.map(({ from, to }) => [from, to]),
      [['in_review', 'rework']],
    );
  });

  it('задаёт подписи кнопок по-русски', () => {
    for (const expected of [...ASSIGNEE_TRANSITIONS, ...MANAGER_TRANSITIONS]) {
      const actual = TRANSITIONS.find(
        ({ from, to }) => from === expected.from && to === expected.to,
      );
      assert.equal(actual?.label, expected.label);
      assert.equal(actual?.commentRequired, expected.commentRequired);
    }
  });
});

describe('getAvailableActions: все сочетания статуса, роли и назначенности', () => {
  for (const status of STATUSES) {
    for (const role of ['manager', 'executor']) {
      for (const isAssignee of [true, false]) {
        const expected = expectedTargets(status, role, isAssignee);
        const title = `${status}, ${role}, isAssignee=${isAssignee} → [${expected.join(', ')}]`;
        it(title, () => {
          const actions = getAvailableActions({ status, role, isAssignee });
          assert.deepEqual(actions.map(({ to }) => to).sort(), [...expected].sort());
          for (const action of actions) assert.equal(action.from, status);
        });
      }
    }
  }
});

describe('getAvailableActions: особые случаи', () => {
  it('постановщик с isAssignee: true не получает кнопок исполнителя', () => {
    for (const status of ['new', 'in_progress', 'rework'] as const) {
      assert.deepEqual(getAvailableActions({ status, role: 'manager', isAssignee: true }), []);
    }
  });

  it('постановщик с isAssignee: true сохраняет свои кнопки', () => {
    const actions = getAvailableActions({
      status: 'in_review',
      role: 'manager',
      isAssignee: true,
    });
    assert.deepEqual(actions.map(({ to }) => to).sort(), ['accepted', 'rework']);
  });

  it('из принятой задачи не ведёт ни одна кнопка', () => {
    for (const role of ['manager', 'executor']) {
      for (const isAssignee of [true, false]) {
        assert.deepEqual(getAvailableActions({ status: 'accepted', role, isAssignee }), []);
      }
    }
  });

  it('возврат на доработку через getAvailableActions требует комментарий', () => {
    const actions = getAvailableActions({
      status: 'in_review',
      role: 'manager',
      isAssignee: false,
    });
    assert.equal(actions.find(({ to }) => to === 'rework')?.commentRequired, true);
    assert.equal(actions.find(({ to }) => to === 'accepted')?.commentRequired, false);
  });

  it('роль null или неизвестная даёт пустой список', () => {
    // Сравнение роли точное: другой регистр или имя из прототипа кнопок не дают.
    for (const role of [null, '', 'admin', 'assignee', 'Manager', 'EXECUTOR', 'constructor']) {
      for (const status of STATUSES) {
        for (const isAssignee of [true, false]) {
          assert.deepEqual(getAvailableActions({ status, role, isAssignee }), []);
        }
      }
    }
  });
});
