import { Button, Group, Modal, Stack } from '@mantine/core';
import type { ReactNode } from 'react';

type ConfirmModalProps = {
  opened: boolean;
  title: string;
  /** Текст вопроса. При удалении объекта здесь число его задач (Р3). */
  children: ReactNode;
  confirmLabel: string;
  confirmColor?: string;
  /** Идёт запрос: кнопки заблокированы, окно не закрыть. */
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Управляется снаружи и не закрывается само после подтверждения: при отказе базы окно остаётся
 * открытым, закрывать его нужно в `onSuccess` действия. Подтверждение из `@mantine/modals` не
 * подходит: оно не умеет показывать ход запроса.
 */
export function ConfirmModal({
  opened,
  title,
  children,
  confirmLabel,
  confirmColor = 'red',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      closeOnClickOutside={!loading}
      closeOnEscape={!loading}
      withCloseButton={!loading}
    >
      <Stack>
        {children}
        <Group justify="flex-end">
          <Button variant="default" disabled={loading} onClick={onClose}>
            Отмена
          </Button>
          <Button color={confirmColor} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
