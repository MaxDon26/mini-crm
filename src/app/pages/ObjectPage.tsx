import { Button, Stack, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useNavigate, useParams } from 'react-router';
import {
  ObjectFormModal,
  ObjectInfo,
  useDeleteObject,
  useObject,
  useObjects,
} from '@/features/objects';
import type { ObjectItem } from '@/features/objects';
import {
  countTasksByStatus,
  TaskFormModal,
  TaskList,
  TaskProgressSummary,
  useObjectTasks,
} from '@/features/tasks';
import { useReadyUser } from '@/shared/currentUser';
import { REFUSAL_MESSAGES } from '@/shared/dbErrors';
import { CardSkeleton, ListSkeleton, QueryBoundary } from '@/shared/ui';
import classes from './pages.module.css';

function ObjectTasks({ objectId }: { objectId: string }) {
  const tasks = useObjectTasks(objectId);
  return (
    <QueryBoundary query={tasks} skeleton={<ListSkeleton columns={3} />} emptyText="Задач пока нет">
      {(data) => <TaskList tasks={data} />}
    </QueryBoundary>
  );
}

/**
 * Полоса под адресом объекта. Тот же запрос, что у списка задач ниже: TanStack Query читает его один
 * раз, а пока он идёт или не удался, полосы просто нет — состояние показывает список.
 */
function ObjectProgress({ objectId }: { objectId: string }) {
  const tasks = useObjectTasks(objectId);
  if (!tasks.data?.length) return null;
  return <TaskProgressSummary counts={countTasksByStatus(tasks.data)} />;
}

function CreateTaskButton({ objectId }: { objectId: string }) {
  const [opened, { open, close }] = useDisclosure(false);
  // Список объектов нужен только форме задачи, а она есть только у постановщика.
  const objects = useObjects();
  return (
    <>
      <Button onClick={open}>Создать задачу</Button>
      <TaskFormModal opened={opened} onClose={close} defaultObjectId={objectId} objects={objects} />
    </>
  );
}

function ObjectControls({ object }: { object: ObjectItem }) {
  const navigate = useNavigate();
  const [formOpened, form] = useDisclosure(false);
  const deletion = useDeleteObject({ onDeleted: () => void navigate('/objects') });
  return (
    <>
      <Button variant="default" onClick={form.open}>
        Изменить
      </Button>
      <Button variant="default" onClick={() => deletion.request(object)}>
        Удалить
      </Button>
      <ObjectFormModal opened={formOpened} object={object} onClose={form.close} />
      {deletion.modal}
    </>
  );
}

function ObjectCard({ object }: { object: ObjectItem }) {
  const { role } = useReadyUser();
  const isManager = role === 'manager';
  return (
    <Stack gap="xl">
      <Stack gap="lg">
        <ObjectInfo object={object} actions={isManager && <ObjectControls object={object} />} />
        <ObjectProgress objectId={object.id} />
      </Stack>
      <Stack gap="md">
        <div className={classes.pageHeader}>
          <Title order={3}>Задачи</Title>
          {isManager && <CreateTaskButton objectId={object.id} />}
        </div>
        <ObjectTasks objectId={object.id} />
      </Stack>
    </Stack>
  );
}

export function ObjectPage() {
  const { objectId = '' } = useParams();
  const object = useObject(objectId);
  return (
    <QueryBoundary
      query={object}
      skeleton={<CardSkeleton lines={3} withActions />}
      emptyText={REFUSAL_MESSAGES.object_not_found}
    >
      {(data) => <ObjectCard object={data} />}
    </QueryBoundary>
  );
}
