export const REFUSAL_MESSAGES = {
  task_not_found: 'Задача не найдена',
  object_not_found: 'Объект не найден',
  status_changed: 'Статус уже изменён',
  transition_forbidden: 'Переход запрещён',
  comment_required: 'Укажите комментарий',
  forbidden: 'Недостаточно прав',
  task_accepted: 'Принятую задачу нельзя изменить',
  assignee_required: 'Нельзя снять исполнителя с задачи в работе',
  assignee_not_executor: 'Назначить можно только исполнителя',
  history_immutable: 'Историю нельзя изменить',
} as const;

// Коды, которые приходят в поле code: от PostgreSQL и от сервиса входа Supabase.
const CODE_MESSAGES = {
  '42501': 'Недостаточно прав',
  '23514': 'Заполните обязательные поля',
  '23502': 'Заполните обязательные поля',
  invalid_credentials: 'Неверный email или пароль',
} as const;

const NETWORK_ERROR_CODE = 'network_error';
const NETWORK_MESSAGE = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
const UNKNOWN_MESSAGE = 'Что-то пошло не так. Попробуйте ещё раз.';

export type RefusalCode = keyof typeof REFUSAL_MESSAGES;
export type CodeFieldErrorCode = keyof typeof CODE_MESSAGES;
export type ErrorCode = RefusalCode | CodeFieldErrorCode | typeof NETWORK_ERROR_CODE;

const NETWORK_ERROR_NAMES = new Set(['AuthRetryableFetchError', 'AbortError', 'TimeoutError']);

// Браузеры называют сбой fetch по-разному: Chrome, Firefox, Safari, затем Node.
// Клиент PostgREST при сбое склеивает имя и текст («TypeError: Failed to fetch»). Начало строки
// закреплено, чтобы текст базы, где слово fetch встретилось случайно, не выглядел как сбой сети.
const NETWORK_MESSAGE_PATTERN =
  /^(?:(?:TypeError|FetchError): )?(?:Failed to fetch|NetworkError when attempting to fetch|Load failed|fetch failed)|^(?:AbortError|TimeoutError):/;

function readTextField(error: unknown, field: 'message' | 'code' | 'name'): string | null {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return null;
  try {
    const value = (error as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : null;
  } catch {
    // Функция вызывается из обработчиков ошибок: новое исключение здесь скрыло бы исходный сбой.
    return null;
  }
}

function isNetworkFailure(error: unknown): boolean {
  const name = readTextField(error, 'name');
  if (name !== null && NETWORK_ERROR_NAMES.has(name)) return true;
  // Непустой код означает, что сервер ответил, поэтому это ошибка базы, а не сети.
  if (readTextField(error, 'code')) return false;
  const message = readTextField(error, 'message');
  return message !== null && NETWORK_MESSAGE_PATTERN.test(message);
}

export function getErrorCode(error: unknown): ErrorCode | null {
  const message = readTextField(error, 'message');
  // Только точное совпадение и только свои ключи: «forbidden» внутри текста базы или имя
  // из прототипа вроде «constructor» отказом не являются.
  if (message !== null && Object.hasOwn(REFUSAL_MESSAGES, message)) return message as RefusalCode;

  const code = readTextField(error, 'code');
  if (code !== null && Object.hasOwn(CODE_MESSAGES, code)) return code as CodeFieldErrorCode;

  return isNetworkFailure(error) ? NETWORK_ERROR_CODE : null;
}

export function toUserMessage(error: unknown): string {
  const code = getErrorCode(error);
  if (code === null) return UNKNOWN_MESSAGE;
  if (code === NETWORK_ERROR_CODE) return NETWORK_MESSAGE;
  if (code in REFUSAL_MESSAGES) return REFUSAL_MESSAGES[code as RefusalCode];
  return CODE_MESSAGES[code as CodeFieldErrorCode];
}
