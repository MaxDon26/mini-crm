// Расширения в импортах нужны, чтобы чистая логика запускалась в node:test без сборки.
import { STATUS_LABELS } from './statuses.ts';
import { formatPersonName } from './taskRules.ts';
import type { TaskHistoryRecord } from './types';

export type HistoryKind = 'created' | 'status' | 'assignee';

export type HistoryEntry = {
  kind: HistoryKind;
  text: string;
};

/** Вид записи определяется по заполненным полям: таблица истории одна на все виды (Р9). */
export function describeHistoryEntry(record: TaskHistoryRecord): HistoryEntry {
  const { fromStatus, toStatus } = record;
  const toAssignee = formatPersonName(record.toAssigneeId, record.toAssigneeName);

  if (fromStatus && toStatus) {
    return { kind: 'status', text: `${STATUS_LABELS[fromStatus]} → ${STATUS_LABELS[toStatus]}` };
  }
  if (toStatus) {
    return {
      kind: 'created',
      text: `Создана: ${STATUS_LABELS[toStatus]}, исполнитель ${toAssignee}`,
    };
  }
  const fromAssignee = formatPersonName(record.fromAssigneeId, record.fromAssigneeName);
  return { kind: 'assignee', text: `Исполнитель: ${fromAssignee} → ${toAssignee}` };
}
