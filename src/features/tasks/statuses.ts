export type TaskStatus = 'new' | 'in_progress' | 'in_review' | 'accepted' | 'rework';

export type TransitionActor = 'manager' | 'assignee';

export interface StatusTransition {
  from: TaskStatus;
  to: TaskStatus;
  by: TransitionActor;
  label: string;
  commentRequired: boolean;
}

export interface AvailableActionsParams {
  status: TaskStatus;
  role: string | null;
  isAssignee: boolean;
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  in_review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработке',
};

export const TRANSITIONS: readonly StatusTransition[] = [
  {
    from: 'new',
    to: 'in_progress',
    by: 'assignee',
    label: 'Взять в работу',
    commentRequired: false,
  },
  {
    from: 'in_progress',
    to: 'in_review',
    by: 'assignee',
    label: 'Отправить на проверку',
    commentRequired: false,
  },
  { from: 'in_review', to: 'accepted', by: 'manager', label: 'Принять', commentRequired: false },
  {
    from: 'in_review',
    to: 'rework',
    by: 'manager',
    label: 'Вернуть на доработку',
    commentRequired: true,
  },
  {
    from: 'rework',
    to: 'in_progress',
    by: 'assignee',
    label: 'Взять в работу',
    commentRequired: false,
  },
];

function getActor({ role, isAssignee }: AvailableActionsParams): TransitionActor | null {
  if (role === 'manager') return 'manager';
  // Постановщик может остаться назначенным после смены роли (раздел 2.3), но кнопки исполнителя
  // ему не положены: назначенный по разделу 3.1 — только пользователь с ролью исполнителя.
  if (role === 'executor' && isAssignee) return 'assignee';
  return null;
}

export function getAvailableActions(params: AvailableActionsParams): StatusTransition[] {
  const actor = getActor(params);
  return TRANSITIONS.filter(({ from, by }) => from === params.status && by === actor);
}
