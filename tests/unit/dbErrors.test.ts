import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthRetryableFetchError, createClient, PostgrestError } from '@supabase/supabase-js';

import { getErrorCode, REFUSAL_MESSAGES, toUserMessage } from '../../src/shared/dbErrors.ts';

// Таблица продублирована из контракта (раздел 3.8), чтобы тест ловил случайную правку текста в коде.
const CONTRACT_REFUSALS = {
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
};

const POSTGRES_MESSAGES = {
  '42501': 'Недостаточно прав',
  '23514': 'Заполните обязательные поля',
  '23502': 'Заполните обязательные поля',
};

const NETWORK_MESSAGE = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
const UNKNOWN_MESSAGE = 'Что-то пошло не так. Попробуйте ещё раз.';

function postgrestError(message: string, code: string): PostgrestError {
  return new PostgrestError({ message, code, details: '', hint: '' });
}

function failingFetch(): Promise<Response> {
  return Promise.reject(new TypeError('Failed to fetch'));
}

function offlineClient() {
  return createClient('http://127.0.0.1:9', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: failingFetch },
  });
}

describe('коды отказов контракта', () => {
  it('набор кодов совпадает с таблицей контракта', () => {
    assert.deepEqual(REFUSAL_MESSAGES, CONTRACT_REFUSALS);
  });

  for (const [code, text] of Object.entries(CONTRACT_REFUSALS)) {
    it(`${code} из message → «${text}»`, () => {
      // RAISE EXCEPTION даёт PostgreSQL-код P0001, код отказа лежит только в message.
      for (const error of [
        { message: code, code: 'P0001', details: null, hint: null },
        postgrestError(code, 'P0001'),
        { message: code },
        new Error(code),
      ]) {
        assert.equal(getErrorCode(error), code);
        assert.equal(toUserMessage(error), text);
      }
    });
  }

  it('код отказа в message важнее кода PostgreSQL', () => {
    const error = { message: 'status_changed', code: '42501' };
    assert.equal(getErrorCode(error), 'status_changed');
    assert.equal(toUserMessage(error), 'Статус уже изменён');
  });

  it('код засчитывается только при точном совпадении всего message', () => {
    for (const message of [
      'column "forbidden" does not exist',
      'forbidden: some detail',
      'ERROR: task_not_found',
      'FORBIDDEN',
      ' forbidden',
    ]) {
      const error = { message, code: 'P0001' };
      assert.equal(getErrorCode(error), null, message);
      assert.equal(toUserMessage(error), UNKNOWN_MESSAGE, message);
    }
  });

  it('имена из прототипа объекта кодом не считаются', () => {
    for (const message of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(getErrorCode({ message }), null, message);
      assert.equal(toUserMessage({ message }), UNKNOWN_MESSAGE, message);
    }
  });
});

describe('коды PostgreSQL из поля code', () => {
  for (const [code, text] of Object.entries(POSTGRES_MESSAGES)) {
    it(`${code} → «${text}», текст базы не показан`, () => {
      const databaseText = `new row violates something on table "tasks" (${code})`;
      for (const error of [
        { message: databaseText, code },
        postgrestError(databaseText, code),
        Object.assign(new Error(databaseText), { code }),
      ]) {
        assert.equal(getErrorCode(error), code);
        assert.equal(toUserMessage(error), text);
      }
    });
  }

  it('код PostgreSQL в message не считается: только в поле code', () => {
    assert.equal(getErrorCode({ message: '42501' }), null);
    assert.equal(toUserMessage({ message: '23514', code: 'XX000' }), UNKNOWN_MESSAGE);
  });

  it('прочие коды PostgreSQL и PostgREST дают общий текст', () => {
    for (const code of ['23505', '23503', 'P0001', 'PGRST116', 'PGRST301', '57014']) {
      const error = { message: 'duplicate key value violates unique constraint', code };
      assert.equal(getErrorCode(error), null, code);
      assert.equal(toUserMessage(error), UNKNOWN_MESSAGE, code);
    }
  });
});

describe('сбой сети', () => {
  const transportMessages = [
    'Failed to fetch',
    'TypeError: Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'TypeError: NetworkError when attempting to fetch resource.',
    'Load failed',
    'TypeError: Load failed',
    'fetch failed',
    'TypeError: fetch failed',
    'FetchError: Failed to fetch',
    'AbortError: signal is aborted without reason',
    'TimeoutError: The operation timed out.',
  ];

  for (const message of transportMessages) {
    it(`объект с пустым code и message «${message}»`, () => {
      const error = { message, details: '', hint: '', code: '' };
      assert.equal(getErrorCode(error), 'network_error');
      assert.equal(toUserMessage(error), NETWORK_MESSAGE);
    });
  }

  it('обычный TypeError от fetch', () => {
    for (const message of ['Failed to fetch', 'Load failed', 'fetch failed']) {
      const error = new TypeError(message);
      assert.equal(getErrorCode(error), 'network_error');
      assert.equal(toUserMessage(error), NETWORK_MESSAGE);
    }
  });

  it('AuthRetryableFetchError при любом message и статусе', () => {
    for (const error of [
      new AuthRetryableFetchError('Failed to fetch', 0),
      new AuthRetryableFetchError('{}', 0),
      new AuthRetryableFetchError('upstream connect error', 503),
    ]) {
      assert.equal(getErrorCode(error), 'network_error');
      assert.equal(toUserMessage(error), NETWORK_MESSAGE);
    }
  });

  it('AbortError и TimeoutError по имени ошибки', () => {
    for (const name of ['AbortError', 'TimeoutError']) {
      const error = new DOMException('The operation was aborted', name);
      assert.equal(getErrorCode(error), 'network_error', name);
      assert.equal(toUserMessage(error), NETWORK_MESSAGE, name);
    }
  });

  it('настоящий клиент при упавшем fetch: запрос к базе', async () => {
    const { error } = await offlineClient().rpc('change_task_status', {});
    assert.ok(error);
    assert.equal(getErrorCode(error), 'network_error');
    assert.equal(toUserMessage(error), NETWORK_MESSAGE);
  });

  it('настоящий клиент при упавшем fetch: вход', async () => {
    const { error } = await offlineClient().auth.signInWithPassword({
      email: 'user@example.com',
      password: 'not-a-secret',
    });
    assert.ok(error);
    assert.equal(getErrorCode(error), 'network_error');
    assert.equal(toUserMessage(error), NETWORK_MESSAGE);
  });

  it('похожий текст с кодом от сервера сбоем сети не считается', () => {
    // Ответ с кодом означает, что сервер доступен: это ошибка базы, а не сети.
    const error = { message: 'Failed to fetch foreign data', code: 'HV000' };
    assert.equal(getErrorCode(error), null);
    assert.equal(toUserMessage(error), UNKNOWN_MESSAGE);
  });

  it('прочий TypeError (ошибка в коде) сбоем сети не считается', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'fetch')");
    assert.equal(getErrorCode(error), null);
    assert.equal(toUserMessage(error), UNKNOWN_MESSAGE);
  });

  it('упоминание fetch внутри текста сбоем сети не считается', () => {
    const error = { message: 'cursor "fetch failed" does not exist', code: '' };
    assert.equal(getErrorCode(error), null);
  });
});

describe('неизвестные ошибки', () => {
  const secretText = 'relation "private.secret_table" does not exist at /srv/app';
  const unknownValues: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['строка', secretText],
    ['строка с кодом', 'forbidden'],
    ['число', 42],
    ['логическое', false],
    ['символ', Symbol('error')],
    ['функция', () => 'forbidden'],
    ['массив', ['forbidden']],
    ['пустой объект', {}],
    ['объект без прототипа', Object.create(null)],
    ['обычный Error', new Error(secretText)],
    ['объект с текстом базы', { message: secretText, code: 'XX000' }],
    ['нестроковый message', { message: { nested: 'forbidden' } }],
    ['message null', { message: null, code: null }],
    ['числовой code', { message: secretText, code: 42501 }],
    ['нестроковое имя', { name: 42, message: secretText }],
  ];

  for (const [title, value] of unknownValues) {
    it(`${title} → общий текст`, () => {
      assert.equal(getErrorCode(value), null);
      assert.equal(toUserMessage(value), UNKNOWN_MESSAGE);
    });
  }

  it('объект, бросающий исключение при чтении поля, не роняет обработчик', () => {
    const hostile = {
      get message(): string {
        throw new Error('getter failed');
      },
    };
    assert.equal(getErrorCode(hostile), null);
    assert.equal(toUserMessage(hostile), UNKNOWN_MESSAGE);

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assert.equal(getErrorCode(proxy), null);
    assert.equal(toUserMessage(proxy), UNKNOWN_MESSAGE);
  });

  it('текст базы не попадает в сообщение ни при каком виде ошибки', () => {
    const allowed = new Set([
      ...Object.values(CONTRACT_REFUSALS),
      ...Object.values(POSTGRES_MESSAGES),
      NETWORK_MESSAGE,
      UNKNOWN_MESSAGE,
    ]);
    const samples: unknown[] = [
      ...unknownValues.map(([, value]) => value),
      { message: secretText, code: '42501' },
      { message: secretText, code: '23514' },
      { message: secretText, code: '' },
      new AuthRetryableFetchError(secretText, 500),
    ];
    for (const sample of samples) {
      const text = toUserMessage(sample);
      assert.ok(allowed.has(text), text);
      assert.ok(!text.includes('secret_table'), text);
    }
  });
});

it('неверный пароль при входе даёт понятный текст', () => {
  const error = {
    name: 'AuthApiError',
    code: 'invalid_credentials',
    message: 'Invalid login credentials',
    status: 400,
  };
  assert.equal(getErrorCode(error), 'invalid_credentials');
  assert.equal(toUserMessage(error), 'Неверный email или пароль');
});
