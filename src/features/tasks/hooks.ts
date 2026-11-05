import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useReadyUser } from '@/shared/currentUser';
import { getErrorCode } from '@/shared/dbErrors';
import type { ErrorCode } from '@/shared/dbErrors';
import { queryKeys } from '@/shared/queryKeys';
import { notifyError } from '@/shared/ui';
import {
  changeTaskStatus,
  createTask,
  deleteTask,
  fetchExecutors,
  fetchMyTasks,
  fetchObjectTasks,
  fetchTask,
  fetchTaskHistory,
  updateTask,
} from './api';
import type { ChangeStatusInput } from './api';
import { sortReviewFirst } from './taskRules';
import type { NewTask, TaskChanges } from './types';

// Такой отказ означает, что данные на экране устарели, поэтому их нужно перечитать.
// Сбой сети сюда не входит: при нём данные на экране не меняются (раздел 3.3).
const STALE_DATA_CODES: ReadonlySet<ErrorCode | null> = new Set<ErrorCode>([
  'task_not_found',
  'status_changed',
  'task_accepted',
  'assignee_required',
  'assignee_not_executor',
  'object_not_found',
]);

function taskActionKey(taskId: string | undefined) {
  return ['task-action', taskId ?? 'new'];
}

function useTaskCacheRefresh() {
  const queryClient = useQueryClient();

  // От задач зависит столбец «На проверке: N» в разделе объектов, поэтому сбрасываются оба раздела.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.objects.all }),
    ]);

  const handleFailure = async (error: unknown) => {
    notifyError(error);
    const code = getErrorCode(error);
    if (code === 'assignee_not_executor') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.executors() });
    }
    if (STALE_DATA_CODES.has(code)) await refresh();
  };

  return { refresh, handleFailure };
}

/** Задачи объекта: на проверке первыми, внутри групп сначала новые по дате создания. */
export function useObjectTasks(objectId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.byObject(objectId),
    queryFn: () => fetchObjectTasks(objectId),
    select: sortReviewFirst,
  });
}

export function useMyTasks() {
  const { id: userId } = useReadyUser();
  return useQuery({
    queryKey: queryKeys.tasks.mine(),
    queryFn: () => fetchMyTasks(userId),
  });
}

/** `null` в данных означает, что задачи нет или она недоступна: экран покажет «Задача не найдена». */
export function useTask(taskId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.detail(taskId),
    queryFn: () => fetchTask(taskId),
  });
}

export function useTaskHistory(taskId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.history(taskId),
    queryFn: () => fetchTaskHistory(taskId),
  });
}

export function useExecutors() {
  return useQuery({ queryKey: queryKeys.profiles.executors(), queryFn: fetchExecutors });
}

/** Идёт любое действие над задачей: остальные действия карточки на это время заблокированы (Р23). */
export function useIsTaskBusy(taskId: string): boolean {
  return useIsMutating({ mutationKey: taskActionKey(taskId) }) > 0;
}

// Хуки ждут перечитывания данных, чтобы кнопки старого статуса не успели снова стать доступными.
export function useChangeTaskStatus(taskId: string) {
  const { refresh, handleFailure } = useTaskCacheRefresh();
  return useMutation({
    mutationKey: taskActionKey(taskId),
    mutationFn: (input: ChangeStatusInput) => changeTaskStatus(taskId, input),
    onSuccess: refresh,
    onError: handleFailure,
  });
}

export type SaveTaskInput =
  { taskId?: undefined; newTask: NewTask } | { taskId: string; changes: TaskChanges };

export function useSaveTask(taskId: string | undefined) {
  const { refresh, handleFailure } = useTaskCacheRefresh();
  return useMutation({
    mutationKey: taskActionKey(taskId),
    mutationFn: async (input: SaveTaskInput) => {
      if (input.taskId === undefined) await createTask(input.newTask);
      else await updateTask(input.taskId, input.changes);
    },
    onSuccess: refresh,
    onError: handleFailure,
  });
}

export function useDeleteTask(taskId: string) {
  const { refresh, handleFailure } = useTaskCacheRefresh();
  return useMutation({
    mutationKey: taskActionKey(taskId),
    mutationFn: () => deleteTask(taskId),
    // Без ожидания: экран сразу уходит на объект, иначе успел бы показать «Задача не найдена».
    onSuccess: () => void refresh(),
    onError: handleFailure,
  });
}
