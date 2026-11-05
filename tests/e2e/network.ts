// Управление сетью страницы. Задержка держится до явной команды, а не заданное число секунд:
// проверка не зависит от скорости машины и не может проскочить раньше ответа.
import type { Page, Route } from '@playwright/test';

export type RequestMatch = {
  /** Полный путь без параметров, например `/rest/v1/objects`. */
  path: string;
  method?: 'GET' | 'POST';
};

export const CHANGE_STATUS_REQUEST: RequestMatch = {
  path: '/rest/v1/rpc/change_task_status',
  method: 'POST',
};

async function interceptRequests(
  page: Page,
  match: RequestMatch,
  handle: (route: Route) => Promise<void>,
): Promise<{ count: () => number; stop: () => Promise<void> }> {
  let count = 0;
  const handler = async (route: Route) => {
    // Предварительный запрос CORS и чтение по тому же адресу не должны попасть в счётчик.
    if (match.method && route.request().method() !== match.method) {
      await route.fallback();
      return;
    }
    count += 1;
    await handle(route);
  };
  const predicate = (url: URL) => url.pathname === match.path;
  await page.route(predicate, handler);
  return { count: () => count, stop: () => page.unroute(predicate, handler) };
}

export type HeldResponses = {
  count: () => number;
  release: () => Promise<void>;
};

/** Сервер обрабатывает запрос сразу, а страница получает ответ только после `release`. */
export async function holdResponses(page: Page, match: RequestMatch): Promise<HeldResponses> {
  let open = () => {};
  const released = new Promise<void>((resolve) => {
    open = resolve;
  });
  const interception = await interceptRequests(page, match, async (route) => {
    const response = await route.fetch();
    await released;
    await route.fulfill({ response });
  });
  return {
    count: interception.count,
    // Перехват не снимается: счётчик должен заметить и лишний запрос, отправленный после ответа.
    release: async () => {
      open();
    },
  };
}

export type FailingRequests = {
  count: () => number;
  restore: () => Promise<void>;
};

export async function failRequests(page: Page, match: RequestMatch): Promise<FailingRequests> {
  const interception = await interceptRequests(page, match, (route) => route.abort('failed'));
  return { count: interception.count, restore: interception.stop };
}

/** Весь API базы недоступен: так выглядит обрыв связи, в отличие от сбоя одного запроса. */
export async function failAllDatabaseRequests(page: Page): Promise<FailingRequests> {
  let count = 0;
  const predicate = (url: URL) => url.pathname.startsWith('/rest/v1/');
  const handler = async (route: Route) => {
    count += 1;
    await route.abort('failed');
  };
  await page.route(predicate, handler);
  return { count: () => count, restore: () => page.unroute(predicate, handler) };
}

/** Считает запросы без вмешательства в них: нужно, когда запроса быть не должно. */
export function countRequests(page: Page, match: RequestMatch): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (match.method && request.method() !== match.method) return;
    if (new URL(request.url()).pathname === match.path) count += 1;
  });
  return () => count;
}
