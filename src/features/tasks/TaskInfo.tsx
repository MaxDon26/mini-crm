import { Stack, Title } from '@mantine/core';
import { Link } from 'react-router';
import { formatFullDateTime } from './formatDate';
import classes from './task.module.css';
import { formatPersonName, UNKNOWN_NAME } from './taskRules';
import { TaskStatusBadge } from './TaskStatusBadge';
import type { TaskDetails } from './types';

export function TaskInfo({ task }: { task: TaskDetails }) {
  return (
    <Stack gap="lg">
      <div className={classes.header}>
        <Title order={2} className={classes.title}>
          {task.title}
        </Title>
        <TaskStatusBadge status={task.status} />
      </div>
      <dl className={classes.fields}>
        <dt>Объект</dt>
        <dd>
          <Link to={`/objects/${task.objectId}`} className={classes.link}>
            {task.objectName ?? UNKNOWN_NAME}
          </Link>
        </dd>
        <dt>Исполнитель</dt>
        <dd>{formatPersonName(task.assigneeId, task.assigneeName)}</dd>
        <dt>Автор</dt>
        <dd>{task.authorName ?? UNKNOWN_NAME}</dd>
        <dt>Создана</dt>
        <dd>{formatFullDateTime(task.createdAt)}</dd>
      </dl>
      <div>
        <div className={classes.descriptionLabel}>Описание</div>
        <p className={classes.description}>{task.description ?? 'Нет описания'}</p>
      </div>
    </Stack>
  );
}
