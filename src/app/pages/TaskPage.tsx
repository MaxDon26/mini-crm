import { Stack } from '@mantine/core';
import { useNavigate, useParams } from 'react-router';
import { TaskActions, TaskHistory, TaskInfo, TaskManagement, useTask } from '@/features/tasks';
import type { TaskDetails } from '@/features/tasks';
import { useReadyUser } from '@/shared/currentUser';
import { REFUSAL_MESSAGES } from '@/shared/dbErrors';
import { CardSkeleton, QueryBoundary } from '@/shared/ui';

function ManagerControls({ task }: { task: TaskDetails }) {
  const navigate = useNavigate();
  return (
    <TaskManagement task={task} onDeleted={() => void navigate(`/objects/${task.objectId}`)} />
  );
}

function TaskCard({ task }: { task: TaskDetails }) {
  const { role } = useReadyUser();
  return (
    <Stack gap="lg">
      <TaskInfo task={task} />
      <TaskActions task={task} />
      {role === 'manager' && <ManagerControls task={task} />}
      <TaskHistory taskId={task.id} />
    </Stack>
  );
}

export function TaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);
  return (
    <QueryBoundary
      query={task}
      skeleton={<CardSkeleton lines={5} withActions />}
      emptyText={REFUSAL_MESSAGES.task_not_found}
    >
      {(data) => <TaskCard task={data} />}
    </QueryBoundary>
  );
}
