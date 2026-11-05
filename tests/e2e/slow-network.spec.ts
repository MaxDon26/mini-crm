// Сценарий 30: что человек видит, пока ответ сервера не пришёл (Р23).
import type { Locator, Page } from '@playwright/test';
import {
  arrangeNewTask,
  arrangeObject,
  arrangeTaskInReview,
  expect,
  fillTaskForm,
  test,
  uniqueName,
  USERS,
} from './helpers.ts';
import { CHANGE_STATUS_REQUEST, holdResponses } from './network.ts';
import type { HeldResponses } from './network.ts';
import {
  actionButton,
  ARRANGED_REVIEW_HISTORY,
  buttonLoader,
  commentField,
  expectHistory,
  expectTaskCard,
  MANAGER_REVIEW_BUTTONS,
  mainArea,
  taskStatus,
} from './taskCard.ts';

function loadingSkeleton(page: Page): Locator {
  return page.getByRole('status', { name: 'Загрузка' });
}

/** Профиль уже прочитан, значит скелетон на экране относится к содержимому, а не к проверке входа. */
async function expectContentSkeleton(page: Page, held: HeldResponses): Promise<void> {
  await expect(page.getByRole('banner').getByText(USERS.anna.name)).toBeVisible();
  await expect(loadingSkeleton(page)).toBeVisible();
  await expect.poll(held.count).toBeGreaterThan(0);
}

/** Окно заблокировано и не закрывается: ни клавишей, ни щелчком мимо, крестика нет. */
async function expectFormLocked(
  page: Page,
  fields: readonly string[],
  submitName: string,
): Promise<void> {
  const dialog = page.getByRole('dialog');
  for (const field of fields) await expect(dialog.getByLabel(field)).toBeDisabled();
  const submit = dialog.getByRole('button', { name: submitName, exact: true });
  await expect(dialog.getByRole('button')).toHaveText(['Отмена', submitName]);
  await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeDisabled();
  await expect(submit).toBeDisabled();
  await expect(buttonLoader(submit)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
}

test.describe('сценарий 30: медленная сеть', () => {
  test('первая загрузка списка объектов: скелетон без данных, затем данные', async ({ openAs }) => {
    const { objectName } = await arrangeObject();
    const anna = await openAs(USERS.anna);
    const held = await holdResponses(anna, { path: '/rest/v1/objects', method: 'GET' });

    await anna.goto('/objects');
    await expectContentSkeleton(anna, held);
    await expect(mainArea(anna).getByRole('table')).toHaveCount(0);
    await expect(anna.getByRole('link', { name: objectName, exact: true })).toHaveCount(0);

    await held.release();
    await expect(anna.getByRole('link', { name: objectName, exact: true })).toBeVisible();
    await expect(loadingSkeleton(anna)).toHaveCount(0);
  });

  test('первая загрузка карточки задачи: скелетон без данных, затем данные', async ({ openAs }) => {
    const { taskId, taskTitle } = await arrangeNewTask();
    const anna = await openAs(USERS.anna);
    const held = await holdResponses(anna, { path: '/rest/v1/tasks', method: 'GET' });

    await anna.goto(`/tasks/${taskId}`);
    await expectContentSkeleton(anna, held);
    await expect(mainArea(anna).getByRole('heading')).toHaveCount(0);
    await expect(mainArea(anna).getByRole('button')).toHaveCount(0);

    await held.release();
    await expect(mainArea(anna).getByRole('heading', { name: taskTitle })).toBeVisible();
    await expect(loadingSkeleton(anna)).toHaveCount(0);
  });

  test('смена статуса: индикатор, блокировка карточки, один запрос', async ({ openAs }) => {
    const { taskId } = await arrangeTaskInReview();
    const anna = await openAs(USERS.anna);
    await anna.goto(`/tasks/${taskId}`);
    await expectTaskCard(anna, 'На проверке', MANAGER_REVIEW_BUTTONS);
    const held = await holdResponses(anna, CHANGE_STATUS_REQUEST);

    const accept = actionButton(anna, 'Принять');
    await accept.click();
    await expect(accept).toBeDisabled();
    await expect(buttonLoader(accept)).toBeVisible();
    for (const name of ['Вернуть на доработку', 'Изменить', 'Удалить']) {
      await expect(actionButton(anna, name)).toBeDisabled();
    }
    await expect(commentField(anna)).toBeDisabled();
    // Обычный щелчок ждал бы снятия блокировки, а здесь нужна сама попытка нажать.
    await accept.click({ force: true });
    expect(held.count()).toBe(1);
    await expect(taskStatus(anna, 'На проверке')).toBeVisible();

    await held.release();
    await expectTaskCard(anna, 'Принята', ['Удалить']);
    expect(held.count()).toBe(1);
    await expectHistory(anna, [
      ...ARRANGED_REVIEW_HISTORY,
      { actor: USERS.anna.name, text: 'На проверке → Принята' },
    ]);
  });

  test('после ответа на смену статуса старые данные и блокировка держатся до перечитывания', async ({
    openAs,
  }) => {
    const { taskId, taskTitle } = await arrangeTaskInReview();
    const anna = await openAs(USERS.anna);
    await anna.goto(`/tasks/${taskId}`);
    await expectTaskCard(anna, 'На проверке', MANAGER_REVIEW_BUTTONS);
    const held = await holdResponses(anna, { path: '/rest/v1/tasks', method: 'GET' });

    const accept = actionButton(anna, 'Принять');
    await accept.click();
    await expect(anna.getByRole('status', { name: 'Обновление' }).first()).toBeVisible();
    await expect.poll(held.count).toBeGreaterThan(0);
    await expect(mainArea(anna).getByRole('heading', { name: taskTitle })).toBeVisible();
    await expect(taskStatus(anna, 'На проверке')).toBeVisible();
    await expect(accept).toBeDisabled();

    await held.release();
    await expectTaskCard(anna, 'Принята', ['Удалить']);
    await expect(anna.getByRole('status', { name: 'Обновление' })).toHaveCount(0);
  });

  test('форма создания объекта заблокирована и не закрывается до ответа', async ({ openAs }) => {
    const anna = await openAs(USERS.anna);
    await anna.goto('/objects');
    const objectName = uniqueName('объект');
    const held = await holdResponses(anna, { path: '/rest/v1/objects', method: 'POST' });

    await anna.getByRole('button', { name: 'Создать объект' }).click();
    const dialog = anna.getByRole('dialog');
    await dialog.getByLabel('Название').fill(objectName);
    await dialog.getByLabel('Адрес').fill('Адрес для проверки');
    const submit = dialog.getByRole('button', { name: 'Создать', exact: true });
    await submit.click();

    await expectFormLocked(anna, ['Название', 'Адрес'], 'Создать');
    await submit.click({ force: true });
    expect(held.count()).toBe(1);

    await held.release();
    await expect(dialog).toBeHidden();
    await expect(anna.getByRole('link', { name: objectName, exact: true })).toBeVisible();
    expect(held.count()).toBe(1);
  });

  test('форма создания задачи заблокирована и не закрывается до ответа', async ({ openAs }) => {
    const { objectId } = await arrangeObject();
    const anna = await openAs(USERS.anna);
    await anna.goto(`/objects/${objectId}`);
    const taskTitle = uniqueName('задача');
    const held = await holdResponses(anna, { path: '/rest/v1/tasks', method: 'POST' });

    await fillTaskForm(anna, {
      title: taskTitle,
      description: 'Описание для проверки',
      assignee: USERS.ivan.name,
    });
    const dialog = anna.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: 'Сохранить', exact: true });
    await submit.click();

    await expectFormLocked(anna, ['Название', 'Описание', 'Объект', 'Исполнитель'], 'Сохранить');
    await submit.click({ force: true });
    expect(held.count()).toBe(1);

    await held.release();
    await expect(dialog).toBeHidden();
    await expect(anna.getByRole('link', { name: taskTitle, exact: true })).toBeVisible();
    expect(held.count()).toBe(1);
  });
});
