import { Stack, Title } from '@mantine/core';
import { TaskList, useMyTasks } from '@/features/tasks';
import { ListSkeleton, QueryBoundary } from '@/shared/ui';

export function MyTasksPage() {
  const tasks = useMyTasks();
  return (
    <Stack gap="lg">
      <Title order={2}>Мои задачи</Title>
      <QueryBoundary
        query={tasks}
        skeleton={<ListSkeleton columns={3} />}
        emptyText="Задач пока нет"
      >
        {(items) => <TaskList tasks={items} column="object" />}
      </QueryBoundary>
    </Stack>
  );
}
