import { Group, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import type { ObjectItem } from './api';
import classes from './objects.module.css';

type ObjectInfoProps = {
  object: ObjectItem;
  /** Кнопки справа от названия. Экран передаёт их только постановщику. */
  actions?: ReactNode;
};

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' });

export function ObjectInfo({ object, actions }: ObjectInfoProps) {
  return (
    <div className={classes.info}>
      <div className={classes.infoText}>
        <Title order={2}>{object.name}</Title>
        <Text>{object.address}</Text>
        <Text size="sm" c="dimmed">
          Создан {dateFormat.format(new Date(object.created_at))}
        </Text>
      </div>
      {actions && (
        <Group gap="xs" wrap="nowrap">
          {actions}
        </Group>
      )}
    </div>
  );
}
