// Сценарий 31: обрыв сети при загрузке и при действии (раздел 3.3).
import type { Locator, Page } from '@playwright/test';
import {
  arrangeNewTask,
  arrangeObject,
  arrangeTaskInReview,
  expect,
  test,
  USERS,
} from './helpers.ts';
import { CHANGE_STATUS_REQUEST, failAllDatabaseRequests, failRequests } from './network.ts';
import {
  actionButton,
  ARRANGED_REVIEW_HISTORY,
  commentField,
  expectHistory,
  expectTaskCard,
  MANAGER_REVIEW_BUTTONS,
  mainArea,
} from './taskCard.ts';

const NETWORK_ERROR_MESSAGE = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';

function loadErrorMessage(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: 'Не удалось загрузить данные' });
}

function retryButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Повторить' });
}

async function expectLoadError(page: Page): Promise<void> {
  await expect(loadErrorMessage(page)).toContainText(NETWORK_ERROR_MESSAGE);
  await expect(retryButton(page)).toBeEnabled();
  await expect(page.getByRole('status', { name: 'Загрузка' })).toHaveCount(0);
}

test.describe('сценарий 31: сбой сети', () => {
  test('список объектов: сообщение и «Повторить», после снятия сбоя данные', async ({ openAs }) => {
    const { objectName } = await arrangeObject();
    const anna = await openAs(USERS.anna);
    const failing = await failRequests(anna, { path: '/rest/v1/objects', method: 'GET' });

    await anna.goto('/objects');
    await expectLoadError(anna);
    await expect(anna.getByRole('link', { name: objectName, exact: true })).toHaveCount(0);
    await expect(mainArea(anna).getByRole('table')).toHaveCount(0);
    expect(failing.count()).toBeGreaterThan(0);

    await failing.restore();
    await retryButton(anna).click();
    await expect(anna.getByRole('link', { name: objectName, exact: true })).toBeVisible();
    await expect(loadErrorMessage(anna)).toHaveCount(0);
  });

  test('карточка задачи: сообщение и «Повторить», после снятия сбоя данные', async ({ openAs }) => {
    const { taskId, taskTitle } = await arrangeNewTask();
    const anna = await openAs(USERS.anna);
    const failing = await failRequests(anna, { path: '/rest/v1/tasks', method: 'GET' });

    await anna.goto(`/tasks/${taskId}`);
    await expectLoadError(anna);
    await expect(mainArea(anna).getByRole('heading', { name: taskTitle })).toHaveCount(0);

    await failing.restore();
    await retryButton(anna).click();
    await expectTaskCard(anna, 'Новая', ['Изменить', 'Удалить']);
    await expect(mainArea(anna).getByRole('heading', { name: taskTitle })).toBeVisible();
    await expect(loadErrorMessage(anna)).toHaveCount(0);
  });

  test('исполнитель при полном обрыве: профиль и «Мои задачи» загружаются после «Повторить»', async ({
    openAs,
  }) => {
    const { taskTitle } = await arrangeNewTask();
    const ivan = await openAs(USERS.ivan);
    const failing = await failAllDatabaseRequests(ivan);

    await ivan.goto('/my-tasks');
    await expectLoadError(ivan);
    await expect(ivan.getByRole('link', { name: taskTitle, exact: true })).toHaveCount(0);

    await failing.restore();
    await retryButton(ivan).click();
    await expect(ivan.getByRole('link', { name: taskTitle, exact: true })).toBeVisible();
    await expect(ivan.getByRole('banner').getByText(USERS.ivan.name)).toBeVisible();
  });

  test('смена статуса: уведомление, кнопки доступны, данные и комментарий на месте', async ({
    openAs,
  }) => {
    const { taskId } = await arrangeTaskInReview();
    const anna = await openAs(USERS.anna);
    const comment = 'Текст, который нельзя потерять при обрыве';
    await anna.goto(`/tasks/${taskId}`);
    await expectTaskCard(anna, 'На проверке', MANAGER_REVIEW_BUTTONS);
    await expectHistory(anna, ARRANGED_REVIEW_HISTORY);
    await commentField(anna).fill(comment);
    const screenBefore = await mainArea(anna).innerText();
    const failing = await failRequests(anna, CHANGE_STATUS_REQUEST);

    await actionButton(anna, 'Вернуть на доработку').click();

    await expect(anna.getByRole('alert').filter({ hasText: NETWORK_ERROR_MESSAGE })).toBeVisible();
    for (const name of MANAGER_REVIEW_BUTTONS) await expect(actionButton(anna, name)).toBeEnabled();
    await expect(commentField(anna)).toBeEnabled();
    await expect(commentField(anna)).toHaveValue(comment);
    await expectTaskCard(anna, 'На проверке', MANAGER_REVIEW_BUTTONS);
    await expectHistory(anna, ARRANGED_REVIEW_HISTORY);
    expect(await mainArea(anna).innerText()).toBe(screenBefore);
    expect(failing.count()).toBe(1);

    // Сохранённый текст должен годиться для повтора: иначе обрыв всё равно заставил бы писать заново.
    await failing.restore();
    await actionButton(anna, 'Вернуть на доработку').click();
    await expectTaskCard(anna, 'На доработке', ['Изменить', 'Удалить']);
    await expectHistory(anna, [
      ...ARRANGED_REVIEW_HISTORY,
      { actor: USERS.anna.name, text: 'На проверке → На доработке', comment },
    ]);
  });
});
