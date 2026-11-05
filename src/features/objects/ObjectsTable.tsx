import { Anchor, Badge, Button, Group, Table, Text } from '@mantine/core';
import { Link } from 'react-router';
import type { ObjectItem, ObjectListItem } from './api';

type ObjectsTableProps = {
  objects: ObjectListItem[];
  /** Столбец «На проверке» только для постановщика (Р22). */
  showInReview?: boolean;
  /** Без обработчиков столбца действий нет: исполнителю кнопки не показываются. */
  onEdit?: (object: ObjectItem) => void;
  onDelete?: (object: ObjectItem) => void;
};

const LONG_TEXT_STYLE = { overflowWrap: 'anywhere' } as const;

function InReviewCount({ count }: { count: number }) {
  if (count === 0) return <Text c="dimmed">0</Text>;
  return (
    <Badge color="yellow" variant="light">
      {count}
    </Badge>
  );
}

export function ObjectsTable({
  objects,
  showInReview = false,
  onEdit,
  onDelete,
}: ObjectsTableProps) {
  const hasActions = Boolean(onEdit || onDelete);

  return (
    <Table.ScrollContainer minWidth={600}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Название</Table.Th>
            <Table.Th>Адрес</Table.Th>
            {showInReview && <Table.Th>На проверке</Table.Th>}
            {hasActions && <Table.Th>Действия</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {objects.map((object) => (
            <Table.Tr key={object.id}>
              <Table.Td style={LONG_TEXT_STYLE}>
                <Anchor component={Link} to={`/objects/${object.id}`}>
                  {object.name}
                </Anchor>
              </Table.Td>
              <Table.Td style={LONG_TEXT_STYLE}>{object.address}</Table.Td>
              {showInReview && (
                <Table.Td>
                  <InReviewCount count={object.inReviewCount ?? 0} />
                </Table.Td>
              )}
              {hasActions && (
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    {onEdit && (
                      <Button
                        size="xs"
                        variant="default"
                        aria-label={`Изменить объект ${object.name}`}
                        onClick={() => onEdit(object)}
                      >
                        Изменить
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        aria-label={`Удалить объект ${object.name}`}
                        onClick={() => onDelete(object)}
                      >
                        Удалить
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
