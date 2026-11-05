import { Group, Skeleton } from '@mantine/core';
import type { CSSProperties } from 'react';
import classes from './skeletons.module.css';

type ListSkeletonProps = {
  rows?: number;
  /** Столбцов в строке: у таблицы столько же, сколько в настоящей таблице. */
  columns?: number;
};

/** Строки списка: на компьютере как строки таблицы, на телефоне как карточки. */
export function ListSkeleton({ rows = 5, columns = 1 }: ListSkeletonProps) {
  const rowStyle = { '--skeleton-columns': Math.max(columns - 1, 0) } as CSSProperties;
  return (
    <div role="status" aria-label="Загрузка" className={classes.list}>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className={classes.row} style={rowStyle}>
          <div className={classes.lines}>
            <Skeleton height={18} width="70%" />
            <Skeleton height={14} width="45%" />
          </div>
          {Array.from({ length: columns - 1 }, (_, column) => (
            <Skeleton key={column} height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TimelineRows({ rows }: { rows: number }) {
  return (
    <div className={classes.timeline}>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className={classes.entry}>
          <Skeleton height={12} circle mt={4} />
          <div className={classes.lines}>
            <Skeleton height={14} width="55%" />
            <Skeleton height={16} width="80%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** История задачи: точки ленты и две строки записи. */
export function TimelineSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Загрузка">
      <TimelineRows rows={rows} />
    </div>
  );
}

type CardSkeletonProps = {
  lines?: number;
  withActions?: boolean;
  /** Справа лента истории, как у карточки задачи на компьютере. */
  withAside?: boolean;
};

export function CardSkeleton({
  lines = 3,
  withActions = false,
  withAside = false,
}: CardSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Загрузка"
      className={withAside ? `${classes.card} ${classes.withAside}` : classes.card}
    >
      <div className={classes.panel}>
        <Skeleton height={30} width="55%" />
        <Skeleton height={22} width={110} radius="xl" />
        {Array.from({ length: lines }, (_, line) => (
          <Skeleton key={line} height={16} width={line % 2 === 0 ? '90%' : '70%'} />
        ))}
        {withActions && (
          <Group gap="sm" mt="xs">
            <Skeleton height={36} width={140} />
            <Skeleton height={36} width={120} />
          </Group>
        )}
      </div>
      {withAside && <TimelineRows rows={3} />}
    </div>
  );
}
