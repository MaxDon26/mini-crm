import { Group, Skeleton, Stack } from '@mantine/core';

type ListSkeletonProps = {
  rows?: number;
  /** Столбцов в строке: у таблицы столько же, сколько в настоящей таблице. */
  columns?: number;
};

export function ListSkeleton({ rows = 5, columns = 1 }: ListSkeletonProps) {
  return (
    <Stack role="status" aria-label="Загрузка" gap="sm">
      {Array.from({ length: rows }, (_, row) => (
        <Group key={row} gap="md" wrap="nowrap" grow>
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} height={28} />
          ))}
        </Group>
      ))}
    </Stack>
  );
}

type CardSkeletonProps = {
  lines?: number;
  withActions?: boolean;
};

export function CardSkeleton({ lines = 3, withActions = false }: CardSkeletonProps) {
  return (
    <Stack role="status" aria-label="Загрузка" gap="sm">
      <Skeleton height={32} width="50%" />
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton key={line} height={16} />
      ))}
      {withActions && (
        <Group gap="sm">
          <Skeleton height={36} width={120} />
          <Skeleton height={36} width={120} />
        </Group>
      )}
    </Stack>
  );
}
