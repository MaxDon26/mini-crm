import { Button, Group, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { ConfirmModal } from '@/shared/ui';
import { useDeleteTask, useIsTaskBusy } from './hooks';
import { TaskFormModal } from './TaskFormModal';
import type { TaskObjectsSource } from './useTaskForm';
import type { TaskDetails } from './types';

type TaskManagementProps = {
  task: TaskDetails;
  objects: TaskObjectsSource;
  onDeleted: () => void;
};

/** «Изменить» и «Удалить» для постановщика. Принятую задачу менять нельзя, удалить можно (Р8). */
export function TaskManagement({ task, objects, onDeleted }: TaskManagementProps) {
  const busy = useIsTaskBusy(task.id);
  const remove = useDeleteTask(task.id);
  const [formOpened, form] = useDisclosure(false);
  const [confirmOpened, confirm] = useDisclosure(false);
  const editable = task.status !== 'accepted';

  return (
    <Group gap="sm">
      {editable && (
        <Button variant="default" disabled={busy} onClick={form.open}>
          Изменить
        </Button>
      )}
      <Button variant="outline" color="red" disabled={busy} onClick={confirm.open}>
        Удалить
      </Button>
      {/* Задачу могли принять, пока окно открыто: править её уже нельзя. */}
      <TaskFormModal
        opened={formOpened && editable}
        task={task}
        objects={objects}
        onClose={form.close}
      />
      <ConfirmModal
        opened={confirmOpened}
        title="Удалить задачу?"
        confirmLabel="Удалить"
        loading={remove.isPending}
        onClose={confirm.close}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              confirm.close();
              onDeleted();
            },
          })
        }
      >
        <Text style={{ wordBreak: 'break-word' }}>Задача «{task.title}» будет удалена.</Text>
      </ConfirmModal>
    </Group>
  );
}
