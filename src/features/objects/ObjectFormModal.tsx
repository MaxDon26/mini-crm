import { Button, Group, Modal, Stack, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { ObjectFields, ObjectItem } from './api';
import { isObjectGone, useCreateObject, useUpdateObject } from './hooks';
import { normalizeObjectFields, pickObjectChanges, validateObjectForm } from './objectRules';

type ObjectFormProps = {
  initialValues: ObjectFields;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: ObjectFields, initialValues: ObjectFields) => void;
  onCancel: () => void;
};

function ObjectForm({ initialValues, submitLabel, pending, onSubmit, onCancel }: ObjectFormProps) {
  const form = useForm({ initialValues, validate: validateObjectForm });

  const handleSubmit = form.onSubmit((values) => {
    onSubmit(normalizeObjectFields(values), form.getInitialValues());
  });

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack>
        <TextInput
          label="Название"
          required
          data-autofocus
          disabled={pending}
          {...form.getInputProps('name')}
        />
        <Textarea
          label="Адрес"
          required
          autosize
          minRows={2}
          disabled={pending}
          {...form.getInputProps('address')}
        />
        <Group justify="flex-end">
          <Button variant="default" disabled={pending} onClick={onCancel}>
            Отмена
          </Button>
          <Button type="submit" loading={pending}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

type ObjectFormModalProps = {
  opened: boolean;
  /** Объект для правки. Без него окно создаёт новый. */
  object?: ObjectItem | null;
  /** Закрыть окно. Вызывается и после успешного сохранения. */
  onClose: () => void;
};

export function ObjectFormModal({ opened, object, onClose }: ObjectFormModalProps) {
  const createMutation = useCreateObject();
  const updateMutation = useUpdateObject();
  const pending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (values: ObjectFields, initialValues: ObjectFields) => {
    if (!object) {
      createMutation.mutate(values, { onSuccess: onClose });
      return;
    }
    const changes = pickObjectChanges(initialValues, values);
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    updateMutation.mutate(
      { objectId: object.id, changes },
      {
        onSuccess: onClose,
        // Объекта больше нет: повторять правку незачем, держать форму открытой бессмысленно.
        onError: (error) => {
          if (isObjectGone(error)) onClose();
        },
      },
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={object ? 'Изменить объект' : 'Новый объект'}
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      withCloseButton={!pending}
    >
      {/* Окно монтирует содержимое при каждом открытии, поэтому значения формы всегда свежие. */}
      <ObjectForm
        initialValues={{ name: object?.name ?? '', address: object?.address ?? '' }}
        submitLabel={object ? 'Сохранить' : 'Создать'}
        pending={pending}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
