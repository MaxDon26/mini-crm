import { Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import type { ObjectItem } from './api';

type ObjectInfoProps = {
  object: ObjectItem;
  /** Кнопки справа от названия. Экран передаёт их только постановщику. */
  actions?: ReactNode;
};

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' });

export function ObjectInfo({ object, actions }: ObjectInfoProps) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <Stack gap="xs" style={{ overflowWrap: 'anywhere' }}>
        <Title order={2}>{object.name}</Title>
        <Text>{object.address}</Text>
        <Text size="sm" c="dimmed">
          Создан {dateFormat.format(new Date(object.created_at))}
        </Text>
      </Stack>
      {actions && <Group wrap="nowrap">{actions}</Group>}
    </Group>
  );
}
