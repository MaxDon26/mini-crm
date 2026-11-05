import { notifications } from '@mantine/notifications';
import { toUserMessage } from '../dbErrors';

export function notifyError(error: unknown): void {
  notifications.show({ color: 'red', title: 'Ошибка', message: toUserMessage(error) });
}
