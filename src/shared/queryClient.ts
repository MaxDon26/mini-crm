import { QueryClient } from '@tanstack/react-query';
import { getErrorCode } from './dbErrors';

const MAX_RETRIES = 1;

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  // Отказ базы (нет прав, «не найдена») от повтора не изменится, а скелетон висел бы дольше.
  const code = getErrorCode(error);
  return code === null || code === 'network_error';
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      staleTime: 10_000,
      // В режиме по умолчанию без сети запрос встаёт на паузу: скелетон висел бы без конца
      // вместо сообщения с кнопкой «Повторить» (раздел 3.3).
      networkMode: 'always',
    },
    mutations: {
      networkMode: 'always',
    },
  },
});
