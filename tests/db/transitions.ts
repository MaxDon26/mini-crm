// Таблица ожидаемых ответов смены статуса (ТЗ п. 2.3, раздел 3.1). Сценарий 20 проверяет по ней базу,
// а З10 сравнит её со statuses.ts сайта. Форма переходов та же, что у TRANSITIONS на сайте.
import type { TaskStatus } from './helpers.ts';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'new',
  'in_progress',
  'in_review',
  'accepted',
  'rework',
];

export const PARTICIPANTS = ['manager', 'assignee', 'other_executor', 'no_profile'] as const;
export type Participant = (typeof PARTICIPANTS)[number];

export type ExpectedAnswer = 'ok' | 'task_not_found' | 'transition_forbidden';

export const ALLOWED_TRANSITIONS: readonly {
  from: TaskStatus;
  to: TaskStatus;
  by: Extract<Participant, 'manager' | 'assignee'>;
  commentRequired: boolean;
}[] = [
  { from: 'new', to: 'in_progress', by: 'assignee', commentRequired: false },
  { from: 'in_progress', to: 'in_review', by: 'assignee', commentRequired: false },
  { from: 'in_review', to: 'accepted', by: 'manager', commentRequired: false },
  { from: 'in_review', to: 'rework', by: 'manager', commentRequired: true },
  { from: 'rework', to: 'in_progress', by: 'assignee', commentRequired: false },
];

/**
 * Ответ базы на сочетание, когда статус, который видел пользователь, совпадает с текущим и комментарий
 * есть. Тому, кто не имеет доступа к задаче, ответ один при любых статусах, чтобы не раскрыть чужой статус.
 */
export function expectedAnswer(
  from: TaskStatus,
  to: TaskStatus,
  participant: Participant,
): ExpectedAnswer {
  if (participant === 'other_executor' || participant === 'no_profile') return 'task_not_found';
  const allowed = ALLOWED_TRANSITIONS.some(
    (transition) =>
      transition.from === from && transition.to === to && transition.by === participant,
  );
  return allowed ? 'ok' : 'transition_forbidden';
}
