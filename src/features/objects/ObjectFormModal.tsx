import { Button, Group, Modal, Stack, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { ObjectFields, ObjectItem } from './api';
import { isObjectGone, useCreateObject, useUpdateObject } from './hooks';

// Те же пределы, что в базе. Форма подсказывает раньше, решает всё равно база (раздел 3.8).
const NAME_MAX_LENGTH = 200;
const ADDRESS_MAX_LENGTH = 300;
// База считает пробельными ещё четыре символа сверх `\s` (private.has_text): форма их не пропускает.
const HAS_VISIBLE_CHARACTER = /[^\s\u0085\u180E\u200B\u2060]/;

function validateText(value: string, maxLength: number, emptyMessage: string): string | null {
  if (!HAS_VISIBLE_CHARACTER.test(value)) return emptyMessage;
  // Считаем символы, а не единицы UTF-16: база считает так же, и эмодзи не должен стоить двух знаков.
  return Array.from(value.trim()).length > maxLength ? `Не больше ${maxLength} знаков` : null;
}

function pickChanges(values: ObjectFields, initial: ObjectFields): Partial<ObjectFields> {
  const changes: Partial<ObjectFields> = {};
  if (values.name !== initial.name) changes.name = values.name;
  if (values.address !== initial.address) changes.address = values.address;
  return changes;
}

type ObjectFormProps = {
  initialValues: ObjectFields;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: ObjectFields, initialValues: ObjectFields) => void;
  onCancel: () => void;
};

function ObjectForm({ initialValues, submitLabel, pending, onSubmit, onCancel }: ObjectFormProps) {
  const form = useForm({
    initialValues,
    validate: {
      name: (value) => validateText(value, NAME_MAX_LENGTH, 'Укажите название'),
      address: (value) => validateText(value, ADDRESS_MAX_LENGTH, 'Укажите адрес'),
    },
  });

  const handleSubmit = form.onSubmit(({ name, address }) => {
    // Сравнение с тем, что форма показала при открытии: если объект успел обновиться в фоне,
    // нетронутое поле не должно затереть чужую правку.
    onSubmit({ name: name.trim(), address: address.trim() }, form.getInitialValues());
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
    const changes = pickChanges(values, initialValues);
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
