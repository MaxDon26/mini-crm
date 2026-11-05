import { Link } from 'react-router';
import { useIsPhone } from '@/shared/ui';
import classes from './list.module.css';
import { statusStyle } from './statusStyle';
import { formatPersonName, UNKNOWN_NAME } from './taskRules';
import { TaskStatusBadge, TaskStatusDot } from './TaskStatusBadge';
import type { TaskListItem } from './types';

type TaskListProps = {
  tasks: TaskListItem[];
  /** Что показать в третьем столбце: исполнителя в карточке объекта, объект в «Моих задачах». */
  column?: 'assignee' | 'object';
};

const COLUMN_TITLES = { assignee: 'Исполнитель', object: 'Объект' };

function describeColumn(task: TaskListItem, column: 'assignee' | 'object'): string {
  return column === 'assignee'
    ? formatPersonName(task.assigneeId, task.assigneeName)
    : (task.objectName ?? UNKNOWN_NAME);
}

function TaskLink({ task }: { task: TaskListItem }) {
  return (
    <Link to={`/tasks/${task.id}`} className={classes.link}>
      {task.title}
    </Link>
  );
}

function TaskCards({ tasks, column }: Required<TaskListProps>) {
  // У «Моих задач» цвет статуса на кромке, в карточке объекта — точкой у названия (раздел 3.9).
  const withEdge = column === 'object';
  return (
    <ul className={classes.cards}>
      {tasks.map((task) => (
        <li
          key={task.id}
          className={withEdge ? `${classes.card} ${classes.edge}` : classes.card}
          style={statusStyle(task.status)}
        >
          <span className={classes.titleLine}>
            {!withEdge && <TaskStatusDot status={task.status} />}
            <TaskLink task={task} />
          </span>
          <div className={classes.cardMeta}>
            <span>{describeColumn(task, column)}</span>
            <TaskStatusBadge status={task.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** В карточке объекта: точка, название, исполнитель, метка. */
function ObjectTasksTable({ tasks }: { tasks: TaskListItem[] }) {
  return (
    <table className={classes.table}>
      <thead>
        <tr>
          <th>Название</th>
          <th className={classes.personColumn}>{COLUMN_TITLES.assignee}</th>
          <th className={classes.statusColumn}>Статус</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id}>
            <td className={classes.titleCell}>
              <span className={classes.titleLine}>
                <TaskStatusDot status={task.status} />
                <TaskLink task={task} />
              </span>
            </td>
            <td className={classes.wrapCell}>{describeColumn(task, 'assignee')}</td>
            <td className={classes.narrow}>
              <TaskStatusBadge status={task.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** «Мои задачи»: строки с кромкой цвета статуса, столбцы название, статус, объект. */
function MyTasksTable({ tasks }: { tasks: TaskListItem[] }) {
  return (
    <table className={classes.table}>
      <thead>
        <tr>
          <th>Название</th>
          <th className={classes.statusColumn}>Статус</th>
          <th className={classes.objectColumn}>{COLUMN_TITLES.object}</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id} className={classes.edge} style={statusStyle(task.status)}>
            <td className={classes.titleCell}>
              <TaskLink task={task} />
            </td>
            <td className={classes.narrow}>
              <TaskStatusBadge status={task.status} />
            </td>
            <td className={classes.wrapCell}>{describeColumn(task, 'object')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TaskList({ tasks, column = 'assignee' }: TaskListProps) {
  const isPhone = useIsPhone();
  if (isPhone) return <TaskCards tasks={tasks} column={column} />;
  return column === 'assignee' ? (
    <ObjectTasksTable tasks={tasks} />
  ) : (
    <MyTasksTable tasks={tasks} />
  );
}
