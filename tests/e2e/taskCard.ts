// Проверки экранов: точный набор кнопок, история, столбец «На проверке».
import type { Locator, Page } from '@playwright/test';
import { expect, USERS } from './helpers.ts';

export const NETWORK_ERROR_MESSAGE =
  'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';

export const MANAGER_REVIEW_BUTTONS = [
  'Принять',
  'Вернуть на доработку',
  'Изменить',
  'Удалить',
] as const;

export type HistoryEntry = { actor: string; text: string; comment?: string };

/** История задачи, которую подготовил `arrangeTaskInReview`. */
export const ARRANGED_REVIEW_HISTORY: readonly HistoryEntry[] = [
  { actor: USERS.anna.name, text: `Создана: Новая, исполнитель ${USERS.ivan.name}` },
  { actor: USERS.ivan.name, text: 'Новая → В работе' },
  { actor: USERS.ivan.name, text: 'В работе → На проверке' },
];

export function mainArea(page: Page): Locator {
  return page.getByRole('main');
}

export function actionButton(page: Page, name: string): Locator {
  return mainArea(page).getByRole('button', { name, exact: true });
}

export function buttonLoader(button: Locator): Locator {
  return button.locator('.mantine-Loader-root');
}

export function commentField(page: Page): Locator {
  return mainArea(page).getByLabel('Комментарий');
}

/** Значок статуса вне таблиц: иначе совпал бы со значками списка, с которого ещё идёт переход. */
export function taskStatus(page: Page, status: string): Locator {
  return mainArea(page).getByText(status, { exact: true }).and(page.locator(':not(table *)'));
}

/** Сначала статус: пустой набор кнопок иначе совпал бы и с ещё не загруженной карточкой. */
export async function expectTaskCard(
  page: Page,
  status: string,
  buttons: readonly string[],
): Promise<void> {
  await expect(taskStatus(page, status)).toBeVisible();
  await expect(mainArea(page).getByRole('button')).toHaveText([...buttons]);
}

export async function expectHistory(page: Page, entries: readonly HistoryEntry[]): Promise<void> {
  const rows = mainArea(page).getByRole('table').locator('tbody tr');
  await expect(rows.locator('td:nth-child(1)')).toHaveText(
    entries.map(() => /^\d{2}\.\d{2} \d{2}:\d{2}$/),
  );
  await expect(rows.locator('td:nth-child(2)')).toHaveText(entries.map(({ actor }) => actor));
  await expect(rows.locator('td:nth-child(3)')).toHaveText(
    entries.map(({ text, comment }) => (comment ? `${text}Комментарий: ${comment}` : text)),
  );
}

export async function expectInReviewCount(
  page: Page,
  objectName: string,
  count: number,
): Promise<void> {
  // Полная загрузка: другая роль сменила статус в своём контексте, кэш этой страницы о том не знает.
  await page.goto('/objects');
  const row = mainArea(page)
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: objectName, exact: true }) });
  // Третий столбец таблицы постановщика: Название, Адрес, На проверке.
  await expect(row.getByRole('cell').nth(2)).toHaveText(String(count));
}
