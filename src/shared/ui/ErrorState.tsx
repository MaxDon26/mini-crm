import { Alert, Button, Stack, Text } from '@mantine/core';
import { toUserMessage } from '../dbErrors';

type ErrorStateProps = {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  title?: string;
};

export function ErrorState({
  error,
  onRetry,
  retrying = false,
  title = 'Не удалось загрузить данные',
}: ErrorStateProps) {
  return (
    <Alert color="red" title={title}>
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{toUserMessage(error)}</Text>
        <Button size="xs" variant="light" color="red" loading={retrying} onClick={onRetry}>
          Повторить
        </Button>
      </Stack>
    </Alert>
  );
}
