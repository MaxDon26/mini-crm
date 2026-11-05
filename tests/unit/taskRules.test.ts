import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeHistoryEntry } from '../../src/features/tasks/historyEntry.ts';
import type { TaskStatus } from '../../src/features/tasks/statuses.ts';
import * as R from '../../src/features/tasks/taskRules.ts';

const base = {
  id: 1,
  createdAt: '',
  actorName: 'Анна',
  fromStatus: null,
  toStatus: null,
  fromAssigneeId: null,
  fromAssigneeName: null,
  toAssigneeId: null,
  toAssigneeName: null,
  comment: null,
};

describe('history', () => {
  it('создание без исполнителя', () =>
    assert.deepEqual(describeHistoryEntry({ ...base, toStatus: 'new' }), {
      kind: 'created',
      text: 'Создана: Новая, исполнитель не назначен',
    }));
  it('создание с исполнителем', () =>
    assert.equal(
      describeHistoryEntry({ ...base, toStatus: 'new', toAssigneeId: 'u', toAssigneeName: 'Иван' })
        .text,
      'Создана: Новая, исполнитель Иван',
    ));
  it('смена статуса', () =>
    assert.deepEqual(
      describeHistoryEntry({ ...base, fromStatus: 'new', toStatus: 'in_progress' }),
      { kind: 'status', text: 'Новая → В работе' },
    ));
  it('назначение', () =>
    assert.deepEqual(describeHistoryEntry({ ...base, toAssigneeId: 'u', toAssigneeName: 'Иван' }), {
      kind: 'assignee',
      text: 'Исполнитель: не назначен → Иван',
    }));
  it('передача', () =>
    assert.equal(
      describeHistoryEntry({
        ...base,
        fromAssigneeId: 'a',
        fromAssigneeName: 'Иван',
        toAssigneeId: 'b',
        toAssigneeName: 'Пётр',
      }).text,
      'Исполнитель: Иван → Пётр',
    ));
  it('снятие', () =>
    assert.equal(
      describeHistoryEntry({ ...base, fromAssigneeId: 'a', fromAssigneeName: 'Иван' }).text,
      'Исполнитель: Иван → не назначен',
    ));
  it('имя недоступно', () =>
    assert.equal(
      describeHistoryEntry({
        ...base,
        fromAssigneeId: 'a',
        toAssigneeId: 'b',
        toAssigneeName: 'Пётр',
      }).text,
      'Исполнитель: Неизвестно → Пётр',
    ));
});

describe('rules', () => {
  it('на проверке первыми, порядок остальных сохранён', () => {
    const t = (id: string, status: TaskStatus) => ({
      id,
      status,
      title: id,
      assigneeId: null,
      assigneeName: null,
      objectName: null,
      createdAt: '',
    });
    const sorted = R.sortReviewFirst([
      t('a', 'new'),
      t('b', 'in_review'),
      t('c', 'accepted'),
      t('d', 'in_review'),
    ]);
    assert.deepEqual(
      sorted.map((x: { id: string }) => x.id),
      ['b', 'd', 'a', 'c'],
    );
  });
  const initial = { title: 'Т', description: '', objectId: 'o1', assigneeId: 'a1' };
  it('без изменений пусто', () =>
    assert.deepEqual(
      R.buildTaskChanges(initial, { ...initial, title: ' Т ', description: '  ' }),
      {},
    ));
  it('только изменённые поля', () => {
    assert.deepEqual(R.buildTaskChanges(initial, { ...initial, description: 'x' }), {
      description: 'x',
    });
    assert.deepEqual(R.buildTaskChanges(initial, { ...initial, assigneeId: null }), {
      assignee_id: null,
    });
    // Объект задачи после создания не меняется (Р28): в правку он не попадает.
    assert.deepEqual(R.buildTaskChanges(initial, { ...initial, objectId: 'o2', title: 'Н' }), {
      title: 'Н',
    });
    assert.deepEqual(R.buildTaskChanges(initial, { ...initial, objectId: 'o2' }), {});
    assert.deepEqual(
      R.buildTaskChanges({ ...initial, description: 'x' }, { ...initial, description: '' }),
      { description: null },
    );
  });
  it('новая задача', () =>
    assert.deepEqual(
      R.buildNewTask({ title: ' Т ', description: ' ', objectId: 'o', assigneeId: null }),
      { title: 'Т', description: null, object_id: 'o', assignee_id: null },
    ));
  it('снять исполнителя только у новой', () => {
    assert.equal(R.canClearAssignee('new'), true);
    assert.equal(R.canClearAssignee(undefined), true);
    const others: TaskStatus[] = ['in_progress', 'in_review', 'rework', 'accepted'];
    for (const s of others) assert.equal(R.canClearAssignee(s), false);
  });
  it('текущий вариант добавляется только если его нет', () => {
    const o = [{ id: 'a', name: 'A' }];
    assert.equal(R.withCurrentOption(o, { id: 'a', name: 'A' }), o);
    assert.deepEqual(
      R.withCurrentOption(o, { id: 'b', name: 'B' }).map((x: { id: string }) => x.id),
      ['b', 'a'],
    );
    assert.equal(R.withCurrentOption(o, null), o);
  });
  it('проверка формы', () => {
    assert.deepEqual(
      R.validateTaskForm({ title: '\u200b', description: '', objectId: null, assigneeId: null }),
      { title: 'Укажите название', objectId: 'Выберите объект' },
    );
    assert.deepEqual(R.validateTaskForm(initial), {});
    // Набор пробельных символов общий с базой (shared/text.ts), в том числе новые три.
    const invisible = String.fromCharCode(0xad, 0x200c, 0x200d);
    assert.deepEqual(R.validateTaskForm({ ...initial, title: invisible }), {
      title: 'Укажите название',
    });
    assert.deepEqual(
      R.buildNewTask({
        title: `${invisible}Т `,
        description: invisible,
        objectId: 'o',
        assigneeId: null,
      }),
      { title: 'Т', description: null, object_id: 'o', assignee_id: null },
    );
  });
});
