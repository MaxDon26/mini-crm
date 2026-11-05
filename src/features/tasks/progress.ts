import { STATUS_LABELS } from './statuses.ts';
import type { TaskStatus } from './statuses.ts';

export type StatusCounts = Partial<Record<TaskStatus, number>>;

// Слева готовое, справа ещё не начатое: так полоса читается как ход работ.
export const PROGRESS_ORDER: readonly TaskStatus[] = [
  'accepted',
  'in_review',
  'in_progress',
  'rework',
  'new',
];

export type ProgressPart = { status: TaskStatus; label: string; count: number };

export function countTasksByStatus(tasks: readonly { status: TaskStatus }[]): StatusCounts {
  const counts: StatusCounts = {};
  for (const { status } of tasks) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

export function getProgressParts(counts: StatusCounts): ProgressPart[] {
  return PROGRESS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: counts[status] ?? 0,
  })).filter((part) => part.count > 0);
}

/** Расшифровка полосы словами: цвет не единственный носитель смысла (раздел 3.9). */
export function describeProgress(parts: readonly ProgressPart[]): string {
  if (parts.length === 0) return 'Ход работ: задач нет';
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  const items = parts.map((part) => `${part.label} — ${part.count}`).join(', ');
  return `Ход работ: ${items}. Всего задач: ${total}`;
}
