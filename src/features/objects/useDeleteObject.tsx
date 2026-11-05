import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { queryKeys } from '@/shared/queryKeys';
import { notifyError } from '@/shared/ui';
import { deleteObject } from './api';
import type { ObjectItem } from './api';
import { DeleteObjectModal } from './DeleteObjectModal';
import { isObjectGone, refreshObjects } from './hooks';

type DeleteTarget = Pick<ObjectItem, 'id' | 'name'>;

type UseDeleteObjectOptions = {
  /** После успешного удаления, когда окно уже закрыто: например, уйти со страницы объекта. */
  onDeleted?: () => void;
};

type UseDeleteObjectResult = {
  /** Открывает окно подтверждения с числом задач объекта. */
  request: (object: DeleteTarget) => void;
  /** Окно подтверждения: вставить на экран один раз. */
  modal: ReactNode;
  isPending: boolean;
};

/**
 * Окно отдаётся вместе с действием: подтверждение с числом задач обязательно (Р3), и экранам
 * незачем собирать его заново, рискуя удалить объект без вопроса.
 */
export function useDeleteObject({ onDeleted }: UseDeleteObjectOptions = {}): UseDeleteObjectResult {
  const queryClient = useQueryClient();
  // Цель не сбрасывается при закрытии: иначе текст окна исчезал бы во время его плавного скрытия.
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [opened, setOpened] = useState(false);

  const refreshAll = () =>
    Promise.all([
      refreshObjects(queryClient),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
    ]);

  const mutation = useMutation({
    mutationFn: deleteObject,
    onSuccess: () => {
      setOpened(false);
      // Обновление не ждём и начинаем после ухода со страницы: иначе карточка объекта успела бы
      // показать «Объект не найден» про только что удалённый объект.
      onDeleted?.();
      void refreshAll();
    },
    onError: (error) => {
      notifyError(error);
      if (isObjectGone(error)) {
        setOpened(false);
        void refreshAll();
      }
    },
  });

  return {
    request: (object) => {
      setTarget(object);
      setOpened(true);
    },
    modal: target && (
      <DeleteObjectModal
        object={target}
        opened={opened}
        deleting={mutation.isPending}
        onConfirm={() => mutation.mutate(target.id)}
        onClose={() => setOpened(false)}
      />
    ),
    isPending: mutation.isPending,
  };
}
