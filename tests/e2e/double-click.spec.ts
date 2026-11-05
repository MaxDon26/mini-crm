// Двойной клик без паузы: кнопка должна заблокироваться раньше второго нажатия (Р23).
// Обычное создание дало бы вторую строку: у объектов нет уникального поля, которое бы его отклонило.
import { arrangeTaskInReview, expect, test, uniqueName, USERS } from './helpers.ts';
import { CHANGE_STATUS_REQUEST, holdResponses } from './network.ts';
import { actionButton, expectTaskCard, MANAGER_REVIEW_BUTTONS } from './taskCard.ts';

const ATTEMPTS = 5;

test.describe('двойной клик без паузы', () => {
  test('создание объекта отправляет один запрос', async ({ openAs }) => {
    const anna = await openAs(USERS.anna);
    await anna.goto('/objects');

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      // На каждую попытку свой перехват: снятое удержание действует и на все следующие ответы.
      const held = await holdResponses(anna, { path: '/rest/v1/objects', method: 'POST' });
      await anna.getByRole('button', { name: 'Создать объект' }).click();
      const dialog = anna.getByRole('dialog');
      await dialog.getByLabel('Название').fill(uniqueName('e2e двойной клик'));
      await dialog.getByLabel('Адрес').fill('Казань, ул. Проверочная, 1');
      await dialog.getByRole('button', { name: 'Создать', exact: true }).dblclick();
      await expect(dialog.getByRole('button', { name: 'Создать', exact: true })).toBeDisabled();
      await expect.poll(held.count).toBe(1);
      await held.release();
      await expect(dialog).toBeHidden();
      expect(held.count()).toBe(1);
    }
  });

  test('смена статуса отправляет один запрос', async ({ openAs }) => {
    const { taskId } = await arrangeTaskInReview();
    const anna = await openAs(USERS.anna);
    await anna.goto(`/tasks/${taskId}`);
    await expectTaskCard(anna, 'На проверке', MANAGER_REVIEW_BUTTONS);
    const held = await holdResponses(anna, CHANGE_STATUS_REQUEST);

    await actionButton(anna, 'Принять').dblclick();
    await expect(actionButton(anna, 'Принять')).toBeDisabled();
    await expect.poll(held.count).toBe(1);
    await held.release();

    await expectTaskCard(anna, 'Принята', ['Удалить']);
    expect(held.count()).toBe(1);
  });
});
