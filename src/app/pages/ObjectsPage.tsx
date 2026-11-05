import { Button, Stack, Title } from '@mantine/core';
import { useState } from 'react';
import { ObjectFormModal, ObjectsTable, useDeleteObject, useObjects } from '@/features/objects';
import type { ObjectItem, ObjectListItem } from '@/features/objects';
import { TaskProgressBar } from '@/features/tasks';
import { useReadyUser } from '@/shared/currentUser';
import { ListSkeleton, QueryBoundary } from '@/shared/ui';
import classes from './pages.module.css';

function renderProgress(object: ObjectListItem) {
  return <TaskProgressBar counts={object.statusCounts ?? {}} />;
}

export function ObjectsPage() {
  const { role } = useReadyUser();
  const isManager = role === 'manager';
  const objectsQuery = useObjects({ withTaskCounts: true });
  const deletion = useDeleteObject();
  const [formOpened, setFormOpened] = useState(false);
  // Объект не сбрасывается при закрытии: иначе заголовок окна менялся бы во время его скрытия.
  const [editedObject, setEditedObject] = useState<ObjectItem | null>(null);

  const openForm = (object: ObjectItem | null) => {
    setEditedObject(object);
    setFormOpened(true);
  };

  return (
    <Stack gap="lg">
      <div className={classes.pageHeader}>
        <Title order={2}>Объекты</Title>
        {isManager && <Button onClick={() => openForm(null)}>Создать объект</Button>}
      </div>

      <QueryBoundary
        query={objectsQuery}
        skeleton={<ListSkeleton columns={isManager ? 4 : 2} />}
        emptyText="Объектов пока нет"
      >
        {(objects) => (
          <ObjectsTable
            objects={objects}
            showInReview={isManager}
            renderProgress={renderProgress}
            onEdit={isManager ? openForm : undefined}
            onDelete={isManager ? deletion.request : undefined}
          />
        )}
      </QueryBoundary>

      {isManager && (
        <ObjectFormModal
          opened={formOpened}
          object={editedObject}
          onClose={() => setFormOpened(false)}
        />
      )}
      {deletion.modal}
    </Stack>
  );
}
