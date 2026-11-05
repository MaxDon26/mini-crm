import { Group, Loader, Text } from '@mantine/core';
import { toUserMessage } from '@/shared/dbErrors';
import { ConfirmModal } from '@/shared/ui';
import { useObjectTaskCount } from './hooks';

type DeleteObjectModalProps = {
  object: { id: string; name: string };
  opened: boolean;
  deleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

function describeTasks(count: number): string {
  return count === 0 ? 'Задач нет.' : `Вместе с объектом будут удалены задачи: ${count}.`;
}

export function DeleteObjectModal({
  object,
  opened,
  deleting,
  onConfirm,
  onClose,
}: DeleteObjectModalProps) {
  const taskCount = useObjectTaskCount(object.id, opened);
  // Удалять можно только после свежего числа: старое из кэша могло устареть (Р3).
  const isCounting = opened && taskCount.isFetching;
  const hasCount = !isCounting && taskCount.isSuccess;
  const hasCountError = !isCounting && taskCount.isError;

  return (
    <ConfirmModal
      opened={opened}
      title="Удалить объект?"
      confirmLabel={hasCountError ? 'Повторить' : 'Удалить'}
      confirmColor={hasCountError ? 'blue' : 'red'}
      loading={deleting}
      // Пока идёт подсчёт, удалить нельзя, но окно можно закрыть: запрос может зависнуть.
      confirmDisabled={isCounting}
      // Без числа задач удалять нельзя, поэтому после сбоя главная кнопка повторяет подсчёт.
      onConfirm={hasCountError ? () => void taskCount.refetch() : onConfirm}
      onClose={onClose}
    >
      <Text style={{ overflowWrap: 'anywhere' }}>Объект «{object.name}» будет удалён.</Text>
      {isCounting && (
        <Group gap="xs" role="status">
          <Loader size="xs" />
          <Text size="sm">Считаем задачи объекта…</Text>
        </Group>
      )}
      {hasCount && <Text fw={500}>{describeTasks(taskCount.data)}</Text>}
      {hasCountError && (
        <Text c="red" size="sm">
          Не удалось посчитать задачи. {toUserMessage(taskCount.error)}
        </Text>
      )}
    </ConfirmModal>
  );
}
