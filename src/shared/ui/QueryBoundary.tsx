import { Box, Text } from '@mantine/core';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorState } from './ErrorState';
import { FetchingIndicator } from './FetchingIndicator';

type QueryBoundaryProps<T> = {
  query: UseQueryResult<T>;
  /** Что показать при первой загрузке: `ListSkeleton` или `CardSkeleton` по форме содержимого. */
  skeleton: ReactNode;
  /** Текст для `null` и пустого массива: «Задач пока нет», «Задача не найдена». */
  emptyText?: string;
  children: (data: NonNullable<T>) => ReactNode;
};

function hasContent<T>(data: T): data is NonNullable<T> {
  if (data === null || data === undefined) return false;
  return !Array.isArray(data) || data.length > 0;
}

/**
 * Состояния запроса для всех экранов (Р23). Сам показывает скелетон, ошибку с «Повторить», пустой
 * текст и индикатор обновления. `children` получает данные только когда они есть и не пусты.
 */
export function QueryBoundary<T>({
  query,
  skeleton,
  emptyText = 'Данных нет',
  children,
}: QueryBoundaryProps<T>) {
  const { data, error, isPending, isFetching, refetch } = query;
  const retry = () => void refetch();

  if (isPending) return skeleton;
  if (data === undefined) {
    return <ErrorState error={error} onRetry={retry} retrying={isFetching} />;
  }

  return (
    <Box pos="relative">
      <FetchingIndicator active={isFetching} />
      {/* Старые данные остаются на экране, но человек должен знать, что они могли устареть. */}
      {error && (
        <Box mb="sm">
          <ErrorState
            error={error}
            onRetry={retry}
            retrying={isFetching}
            title="Не удалось обновить данные"
          />
        </Box>
      )}
      {hasContent(data) ? children(data) : <Text c="dimmed">{emptyText}</Text>}
    </Box>
  );
}
