import { Anchor, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { formatFullDateTime } from './formatDate';
import { formatPersonName, UNKNOWN_NAME } from './taskRules';
import { TaskStatusBadge } from './TaskStatusBadge';
import type { TaskDetails } from './types';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Text c="dimmed" w={130} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text component="div" style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
        {children}
      </Text>
    </Group>
  );
}

export function TaskInfo({ task }: { task: TaskDetails }) {
  return (
    <Stack gap="xs">
      <Group gap="sm" align="center">
        <Title order={2} style={{ wordBreak: 'break-word' }}>
          {task.title}
        </Title>
        <TaskStatusBadge status={task.status} />
      </Group>
      <Field label="Описание">{task.description ?? 'Нет описания'}</Field>
      <Field label="Объект">
        <Anchor component={Link} to={`/objects/${task.objectId}`}>
          {task.objectName ?? UNKNOWN_NAME}
        </Anchor>
      </Field>
      <Field label="Исполнитель">{formatPersonName(task.assigneeId, task.assigneeName)}</Field>
      <Field label="Автор">{task.authorName ?? UNKNOWN_NAME}</Field>
      <Field label="Создана">{formatFullDateTime(task.createdAt)}</Field>
    </Stack>
  );
}
