import type { TaskStatus } from './statuses';
import type { NewTask, TaskChanges, TaskFormValues, TaskListItem, TaskOption } from './types';

export const UNASSIGNED_LABEL = 'не назначен';
export const UNKNOWN_NAME = 'Неизвестно';

// Тот же набор символов, что в функции базы private.has_text. Сверх `\s` база считает пробельными
// ещё четыре символа: такой текст форма пропустила бы, а база отказала.
const HAS_VISIBLE_CHARACTER = /[^\s\u0085\u180E\u200B\u2060]/;

export function normalizeText(value: string): string {
  return HAS_VISIBLE_CHARACTER.test(value) ? value.trim() : '';
}

export function formatPersonName(personId: string | null, name: string | null): string {
  if (personId === null) return UNASSIGNED_LABEL;
  // Номер есть, а имени нет: профиль скрыт правилами доступа, это не то же самое, что «не назначен».
  return name ?? UNKNOWN_NAME;
}

/** Снять исполнителя можно только у «Новой» (Р8): в остальных статусах база откажет. */
export function canClearAssignee(status: TaskStatus | undefined): boolean {
  return status === undefined || status === 'new';
}

/** Задачи на проверке первыми (Р22), порядок остальных не меняется. */
export function sortReviewFirst(tasks: TaskListItem[]): TaskListItem[] {
  return [...tasks].sort(
    (left, right) => Number(right.status === 'in_review') - Number(left.status === 'in_review'),
  );
}

/**
 * Текущее значение должно быть в списке, иначе поле выбора покажется пустым: исполнитель мог
 * сменить роль, а объект — выпасть из устаревшего списка.
 */
export function withCurrentOption(options: TaskOption[], current: TaskOption | null): TaskOption[] {
  if (!current || options.some((option) => option.id === current.id)) return options;
  return [current, ...options];
}

export function validateTaskForm(
  values: TaskFormValues,
): Partial<Record<'title' | 'objectId', string>> {
  const errors: Partial<Record<'title' | 'objectId', string>> = {};
  if (!normalizeText(values.title)) errors.title = 'Укажите название';
  if (!values.objectId) errors.objectId = 'Выберите объект';
  return errors;
}

export function buildNewTask(values: TaskFormValues & { objectId: string }): NewTask {
  return {
    title: normalizeText(values.title),
    description: normalizeText(values.description) || null,
    object_id: values.objectId,
    assignee_id: values.assigneeId,
  };
}

/**
 * Сравнение с тем, что человек видел при открытии формы, а не с текущей задачей: поля, которых он
 * не менял, не должны затереть правку другого постановщика.
 */
export function buildTaskChanges(initial: TaskFormValues, values: TaskFormValues): TaskChanges {
  const changes: TaskChanges = {};
  const title = normalizeText(values.title);
  const description = normalizeText(values.description);
  if (title !== normalizeText(initial.title)) changes.title = title;
  if (description !== normalizeText(initial.description)) {
    changes.description = description || null;
  }
  if (values.objectId && values.objectId !== initial.objectId) changes.object_id = values.objectId;
  if (values.assigneeId !== initial.assigneeId) changes.assignee_id = values.assigneeId;
  return changes;
}
