import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { getErrorCode } from '@/shared/dbErrors';
import { queryKeys } from '@/shared/queryKeys';
import { notifyError } from '@/shared/ui';
import {
  countObjectTasks,
  createObject,
  fetchObject,
  fetchObjects,
  fetchObjectsWithTaskCounts,
  updateObject,
} from './api';
import type { ObjectFields, ObjectListItem } from './api';

// Ключи под `objects.list` и `objects.all`: их сбрасывают и действия над задачами, а список с
// числом задач по статусам не должен делить кэш с простым списком: у них разные данные.
const LIST_WITH_TASK_COUNTS_KEY = [...queryKeys.objects.list(), 'withTaskCounts'];
const taskCountKey = (objectId: string) => [...queryKeys.objects.all, 'taskCount', objectId];

type UseObjectsOptions = {
  /**
   * Добавляет `statusCounts` для полосы хода работ и `inReviewCount` для столбца постановщика (Р22).
   * Форме задачи числа не нужны, поэтому без флага читается только список.
   */
  withTaskCounts?: boolean;
  enabled?: boolean;
};

export function useObjects({ withTaskCounts = false, enabled = true }: UseObjectsOptions = {}) {
  return useQuery<ObjectListItem[]>({
    queryKey: withTaskCounts ? LIST_WITH_TASK_COUNTS_KEY : queryKeys.objects.list(),
    queryFn: withTaskCounts ? fetchObjectsWithTaskCounts : fetchObjects,
    enabled,
  });
}

export function useObject(objectId: string) {
  return useQuery({
    queryKey: queryKeys.objects.detail(objectId),
    queryFn: () => fetchObject(objectId),
  });
}

export function useObjectTaskCount(objectId: string, enabled: boolean) {
  return useQuery({
    queryKey: taskCountKey(objectId),
    queryFn: () => countObjectTasks(objectId),
    enabled,
    // Число нужно свежее при каждом открытии окна: его подтверждают перед удалением (Р3).
    staleTime: 0,
    // Пока окно открыто, число уже прочитано; повторный запрос лишь мигал бы индикатором.
    refetchOnWindowFocus: false,
  });
}

export function isObjectGone(error: unknown): boolean {
  return getErrorCode(error) === 'object_not_found';
}

export function refreshObjects(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.objects.all });
}

export function useCreateObject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createObject,
    // Ожидание обновления держит форму открытой: закрывшись, она покажет уже новый список.
    onSuccess: () => refreshObjects(queryClient),
    onError: notifyError,
  });
}

type UpdateObjectInput = {
  objectId: string;
  changes: Partial<ObjectFields>;
};

export function useUpdateObject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ objectId, changes }: UpdateObjectInput) => updateObject(objectId, changes),
    onSuccess: () => refreshObjects(queryClient),
    onError: (error) => {
      notifyError(error);
      // Объект удалил другой постановщик: экран должен перестать его показывать.
      if (isObjectGone(error)) return refreshObjects(queryClient);
    },
  });
}
