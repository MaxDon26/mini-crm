import { Badge } from '@mantine/core';
import { STATUS_LABELS } from './statuses';
import type { TaskStatus } from './statuses';

const STATUS_COLORS: Record<TaskStatus, string> = {
  new: 'gray',
  in_progress: 'blue',
  in_review: 'orange',
  accepted: 'green',
  rework: 'red',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge color={STATUS_COLORS[status]} variant="light">
      {STATUS_LABELS[status]}
    </Badge>
  );
}
