import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countTasksByStatus,
  describeProgress,
  getProgressParts,
  PROGRESS_ORDER,
} from '../../src/features/tasks/progress.ts';
import { STATUS_LABELS } from '../../src/features/tasks/statuses.ts';

describe('полоса хода работ', () => {
  it('в порядке участвуют все пять статусов ровно по разу', () => {
    assert.deepEqual([...PROGRESS_ORDER].sort(), Object.keys(STATUS_LABELS).sort());
  });

  it('подсчёт по статусам', () => {
    const counts = countTasksByStatus([
      { status: 'new' },
      { status: 'in_review' },
      { status: 'new' },
      { status: 'accepted' },
    ]);
    assert.deepEqual(counts, { new: 2, in_review: 1, accepted: 1 });
  });

  it('отрезки идут от готового к неначатому, пустые статусы пропускаются', () => {
    const parts = getProgressParts({ new: 2, in_review: 1, accepted: 1 });
    assert.deepEqual(
      parts.map(({ status, count }) => [status, count]),
      [
        ['accepted', 1],
        ['in_review', 1],
        ['new', 2],
      ],
    );
  });

  it('расшифровка словами: цвет не единственный носитель смысла', () => {
    const parts = getProgressParts({ rework: 1, in_progress: 2 });
    assert.equal(
      describeProgress(parts),
      'Ход работ: В работе — 2, На доработке — 1. Всего задач: 3',
    );
    assert.equal(describeProgress([]), 'Ход работ: задач нет');
  });
});
