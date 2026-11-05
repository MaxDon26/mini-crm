import { useNavigate, useParams } from 'react-router';
import { TaskActions, TaskHistory, TaskInfo, TaskManagement, useTask } from '@/features/tasks';
import type { TaskDetails } from '@/features/tasks';
import { useReadyUser } from '@/shared/currentUser';
import { REFUSAL_MESSAGES } from '@/shared/dbErrors';
import { CardSkeleton, QueryBoundary } from '@/shared/ui';
import classes from './pages.module.css';

function ManagerControls({ task }: { task: TaskDetails }) {
  const navigate = useNavigate();
  return (
    <TaskManagement task={task} onDeleted={() => void navigate(`/objects/${task.objectId}`)} />
  );
}

function TaskCard({ task }: { task: TaskDetails }) {
  const { role } = useReadyUser();
  return (
    <div className={classes.taskLayout}>
      {/* Порядок в разметке: кнопки статуса раньше «Изменить» и «Удалить», как читает экран. */}
      <section className={classes.panel}>
        <div className={classes.section}>
          <TaskInfo task={task} />
        </div>
        <div className={classes.section}>
          <TaskActions task={task} />
        </div>
        {role === 'manager' && (
          <div className={classes.section}>
            <ManagerControls task={task} />
          </div>
        )}
      </section>
      <section className={classes.aside}>
        <TaskHistory taskId={task.id} />
      </section>
    </div>
  );
}

export function TaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);
  return (
    <QueryBoundary
      query={task}
      skeleton={<CardSkeleton lines={5} withActions withAside />}
      emptyText={REFUSAL_MESSAGES.task_not_found}
    >
      {(data) => <TaskCard task={data} />}
    </QueryBoundary>
  );
}
