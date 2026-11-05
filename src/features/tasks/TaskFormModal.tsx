import { Button, Group, Modal, Select, Stack, Textarea, TextInput } from '@mantine/core';
import { ErrorState } from '@/shared/ui';
import { useTaskForm } from './useTaskForm';
import type { TaskFormParams } from './useTaskForm';
import type { TaskOption } from './types';

const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 5000;

type TaskFormModalProps = TaskFormParams & {
  opened: boolean;
};

function toSelectData(options: TaskOption[]) {
  return options.map((option) => ({ value: option.id, label: option.name }));
}

function TaskFormDialog(params: TaskFormParams) {
  const { task, objects, onClose } = params;
  const { form, submit, saving, executors, executorOptions, objectOptions, assigneeClearable } =
    useTaskForm(params);

  return (
    <Modal
      opened
      onClose={onClose}
      title={task ? 'Изменить задачу' : 'Новая задача'}
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
      withCloseButton={!saving}
    >
      <form onSubmit={submit} noValidate>
        <Stack>
          <TextInput
            label="Название"
            required
            maxLength={TITLE_MAX_LENGTH}
            disabled={saving}
            {...form.getInputProps('title')}
          />
          <Textarea
            label="Описание"
            autosize
            minRows={3}
            maxLength={DESCRIPTION_MAX_LENGTH}
            disabled={saving}
            {...form.getInputProps('description')}
          />
          {Boolean(objects.error) && (
            <ErrorState
              error={objects.error}
              onRetry={() => void objects.refetch()}
              retrying={objects.isFetching}
              title="Не удалось загрузить объекты"
            />
          )}
          <Select
            label="Объект"
            required
            allowDeselect={false}
            data={toSelectData(objectOptions)}
            placeholder={objects.isPending ? 'Загрузка…' : 'Выберите объект'}
            disabled={saving || objects.isPending}
            {...form.getInputProps('objectId')}
          />
          {executors.isError && (
            <ErrorState
              error={executors.error}
              onRetry={() => void executors.refetch()}
              retrying={executors.isFetching}
              title="Не удалось загрузить исполнителей"
            />
          )}
          <Select
            label="Исполнитель"
            clearable={assigneeClearable}
            allowDeselect={assigneeClearable}
            data={toSelectData(executorOptions)}
            placeholder={executors.isPending ? 'Загрузка…' : 'Не назначен'}
            disabled={saving || executors.isPending}
            {...form.getInputProps('assigneeId')}
          />
          <Group justify="flex-end">
            <Button variant="default" disabled={saving} onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={saving}>
              Сохранить
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/**
 * Содержимое создаётся заново при каждом открытии: форма начинает с текущих значений задачи,
 * а список исполнителей запрашивается только тогда, когда окно действительно открыто.
 */
export function TaskFormModal({ opened, ...params }: TaskFormModalProps) {
  return opened ? <TaskFormDialog {...params} /> : null;
}
