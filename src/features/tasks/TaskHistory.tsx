import { Stack, Table, Text, Title } from '@mantine/core';
import { ListSkeleton, QueryBoundary } from '@/shared/ui';
import { formatShortDateTime } from './formatDate';
import { describeHistoryEntry } from './historyEntry';
import { useTaskHistory } from './hooks';
import { UNKNOWN_NAME } from './taskRules';
import type { TaskHistoryRecord } from './types';

function HistoryRow({ record }: { record: TaskHistoryRecord }) {
  return (
    <Table.Tr>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatShortDateTime(record.createdAt)}</Table.Td>
      <Table.Td>{record.actorName ?? UNKNOWN_NAME}</Table.Td>
      <Table.Td style={{ wordBreak: 'break-word' }}>
        {describeHistoryEntry(record).text}
        {record.comment && (
          <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
            Комментарий: {record.comment}
          </Text>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

export function TaskHistory({ taskId }: { taskId: string }) {
  const history = useTaskHistory(taskId);
  return (
    <Stack gap="xs">
      <Title order={3}>История</Title>
      <QueryBoundary
        query={history}
        skeleton={<ListSkeleton rows={3} columns={3} />}
        emptyText="Записей пока нет"
      >
        {(records) => (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Когда</Table.Th>
                <Table.Th>Кто</Table.Th>
                <Table.Th>Что</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {records.map((record) => (
                <HistoryRow key={record.id} record={record} />
              ))}
            </Table.Tbody>
          </Table>
        )}
      </QueryBoundary>
    </Stack>
  );
}
