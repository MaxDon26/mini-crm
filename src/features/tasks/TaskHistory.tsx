import { Stack, Title } from '@mantine/core';
import type { CSSProperties } from 'react';
import { QueryBoundary, TimelineSkeleton } from '@/shared/ui';
import { formatShortDateTime } from './formatDate';
import { describeHistoryEntry } from './historyEntry';
import classes from './history.module.css';
import { useTaskHistory } from './hooks';
import { statusStyle } from './statusStyle';
import { UNKNOWN_NAME } from './taskRules';
import type { TaskHistoryRecord } from './types';

// Явный сброс: иначе точка унаследовала бы цвет статуса от родителя.
const NO_STATUS_STYLE = { '--status': 'initial' } as CSSProperties;

function HistoryRow({ record }: { record: TaskHistoryRecord }) {
  // Смена исполнителя статус не меняет, поэтому её точка без цвета.
  const style = record.toStatus ? statusStyle(record.toStatus) : NO_STATUS_STYLE;
  return (
    <tr role="row" className={classes.entry} style={style}>
      <td role="cell" className={classes.date}>
        {formatShortDateTime(record.createdAt)}
      </td>
      <td role="cell" className={classes.actor}>
        {record.actorName ?? UNKNOWN_NAME}
      </td>
      <td role="cell" className={classes.text}>
        {describeHistoryEntry(record).text}
        {record.comment && <p className={classes.comment}>Комментарий: {record.comment}</p>}
      </td>
    </tr>
  );
}

export function TaskHistory({ taskId }: { taskId: string }) {
  const history = useTaskHistory(taskId);
  return (
    <Stack gap="md">
      <Title order={3}>История</Title>
      <QueryBoundary query={history} skeleton={<TimelineSkeleton />} emptyText="Записей пока нет">
        {(records) => (
          <table role="table" className={classes.timeline}>
            <thead className={classes.hiddenHead}>
              <tr role="row">
                <th role="columnheader">Когда</th>
                <th role="columnheader">Кто</th>
                <th role="columnheader">Что</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <HistoryRow key={record.id} record={record} />
              ))}
            </tbody>
          </table>
        )}
      </QueryBoundary>
    </Stack>
  );
}
