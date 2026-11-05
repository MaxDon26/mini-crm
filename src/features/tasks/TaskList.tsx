import { Anchor, Table } from '@mantine/core';
import { Link } from 'react-router';
import { formatPersonName, UNKNOWN_NAME } from './taskRules';
import { TaskStatusBadge } from './TaskStatusBadge';
import type { TaskListItem } from './types';

type TaskListProps = {
  tasks: TaskListItem[];
  /** Что показать в третьем столбце: исполнителя в карточке объекта, объект в «Моих задачах». */
  column?: 'assignee' | 'object';
};

const COLUMN_TITLES = { assignee: 'Исполнитель', object: 'Объект' };

export function TaskList({ tasks, column = 'assignee' }: TaskListProps) {
  return (
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Название</Table.Th>
          <Table.Th>Статус</Table.Th>
          <Table.Th>{COLUMN_TITLES[column]}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {tasks.map((task) => (
          <Table.Tr key={task.id}>
            <Table.Td style={{ wordBreak: 'break-word' }}>
              <Anchor component={Link} to={`/tasks/${task.id}`}>
                {task.title}
              </Anchor>
            </Table.Td>
            <Table.Td>
              <TaskStatusBadge status={task.status} />
            </Table.Td>
            <Table.Td>
              {column === 'assignee'
                ? formatPersonName(task.assigneeId, task.assigneeName)
                : (task.objectName ?? UNKNOWN_NAME)}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
