// Сценарий 29: полный цикл задачи двумя ролями в разных контекстах браузера.
import { createObjectInUi, expect, fillTaskForm, test, uniqueName, USERS } from './helpers.ts';
import { CHANGE_STATUS_REQUEST, countRequests } from './network.ts';
import {
  actionButton,
  commentField,
  expectHistory,
  expectInReviewCount,
  expectTaskCard,
  MANAGER_REVIEW_BUTTONS,
  mainArea,
} from './taskCard.ts';

const TAKE = 'Взять в работу';
const SUBMIT = 'Отправить на проверку';
const ACCEPT = 'Принять';
const RETURN = 'Вернуть на доработку';
const EDIT = 'Изменить';
const DELETE = 'Удалить';
const TASK_URL = /\/tasks\//;

test('сценарий 29: полный цикл задачи у постановщиков и исполнителя', async ({ openAs }) => {
  // Весь цикл идёт через интерфейс тремя пользователями и не укладывается в 30 секунд по умолчанию.
  test.setTimeout(180_000);
  const objectName = uniqueName('объект');
  const taskTitle = uniqueName('задача');
  const description = 'Описание задачи для сквозной проверки';
  const comment = `Переделать крепление ${uniqueName('замечание')}`;
  const anna = await openAs(USERS.anna, { viaForm: true });
  let taskPath = '';

  await test.step('постановщик создаёт объект и задачу с исполнителем', async () => {
    await createObjectInUi(anna, objectName, 'ул. Проверочная, 1');
    await anna.getByRole('link', { name: objectName, exact: true }).click();
    await fillTaskForm(anna, { title: taskTitle, description, assignee: USERS.ivan.name });
    await anna.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
    await expect(anna.getByRole('dialog')).toBeHidden();
    await anna.getByRole('link', { name: taskTitle, exact: true }).click();
    await anna.waitForURL(TASK_URL);
    taskPath = new URL(anna.url()).pathname;
    await expectTaskCard(anna, 'Новая', [EDIT, DELETE]);
    await expect(mainArea(anna).getByText(description)).toBeVisible();
    await expectInReviewCount(anna, objectName, 0);
  });

  const ivan = await openAs(USERS.ivan, { viaForm: true });

  await test.step('исполнитель видит задачу и берёт её в работу', async () => {
    const row = mainArea(ivan)
      .getByRole('row')
      .filter({ has: ivan.getByRole('link', { name: taskTitle, exact: true }) });
    await expect(row.getByRole('cell')).toHaveText([taskTitle, 'Новая', objectName]);
    await row.getByRole('link').click();
    await ivan.waitForURL(TASK_URL);
    await expectTaskCard(ivan, 'Новая', [TAKE]);
    await actionButton(ivan, TAKE).click();
    await expectTaskCard(ivan, 'В работе', [SUBMIT]);
  });

  await test.step('исполнитель сдаёт: у него кнопок нет, у постановщика появляются', async () => {
    await actionButton(ivan, SUBMIT).click();
    await expectTaskCard(ivan, 'На проверке', []);
    await expectInReviewCount(anna, objectName, 1);
    await anna.goto(taskPath);
    await expectTaskCard(anna, 'На проверке', MANAGER_REVIEW_BUTTONS);
  });

  await test.step('возврат без комментария не проходит', async () => {
    const statusRequests = countRequests(anna, CHANGE_STATUS_REQUEST);
    for (const emptyComment of ['', '   ']) {
      await commentField(anna).fill(emptyComment);
      await actionButton(anna, RETURN).click();
      await expect(commentField(anna)).toHaveAttribute('aria-invalid', 'true');
      await expect(commentField(anna)).toHaveAccessibleDescription('Укажите комментарий');
    }
    await expectTaskCard(anna, 'На проверке', MANAGER_REVIEW_BUTTONS);
    expect(statusRequests()).toBe(0);
  });

  await test.step('возврат с комментарием', async () => {
    await commentField(anna).fill(comment);
    await actionButton(anna, RETURN).click();
    await expectTaskCard(anna, 'На доработке', [EDIT, DELETE]);
    await expectInReviewCount(anna, objectName, 0);
  });

  await test.step('исполнитель видит комментарий, снова берёт и сдаёт', async () => {
    await ivan.reload();
    await expectTaskCard(ivan, 'На доработке', [TAKE]);
    await expect(mainArea(ivan).getByText(`Комментарий: ${comment}`)).toBeVisible();
    await actionButton(ivan, TAKE).click();
    await expectTaskCard(ivan, 'В работе', [SUBMIT]);
    await actionButton(ivan, SUBMIT).click();
    await expectTaskCard(ivan, 'На проверке', []);
    await expectInReviewCount(anna, objectName, 1);
  });

  const boris = await openAs(USERS.boris, { viaForm: true });

  await test.step('второй постановщик принимает', async () => {
    await expectInReviewCount(boris, objectName, 1);
    await boris.getByRole('link', { name: objectName, exact: true }).click();
    await boris.getByRole('link', { name: taskTitle, exact: true }).click();
    await boris.waitForURL(TASK_URL);
    await expectTaskCard(boris, 'На проверке', MANAGER_REVIEW_BUTTONS);
    await actionButton(boris, ACCEPT).click();
    await expectTaskCard(boris, 'Принята', [DELETE]);
    await expectInReviewCount(boris, objectName, 0);
  });

  await test.step('кнопок статуса нет у всех, история одинакова у обеих ролей', async () => {
    const history = [
      { actor: USERS.anna.name, text: `Создана: Новая, исполнитель ${USERS.ivan.name}` },
      { actor: USERS.ivan.name, text: 'Новая → В работе' },
      { actor: USERS.ivan.name, text: 'В работе → На проверке' },
      { actor: USERS.anna.name, text: 'На проверке → На доработке', comment },
      { actor: USERS.ivan.name, text: 'На доработке → В работе' },
      { actor: USERS.ivan.name, text: 'В работе → На проверке' },
      { actor: USERS.boris.name, text: 'На проверке → Принята' },
    ];
    await anna.goto(taskPath);
    await expectTaskCard(anna, 'Принята', [DELETE]);
    await expectHistory(anna, history);
    await boris.goto(taskPath);
    await expectTaskCard(boris, 'Принята', [DELETE]);
    await expectHistory(boris, history);
    await ivan.reload();
    await expectTaskCard(ivan, 'Принята', []);
    await expectHistory(ivan, history);
  });
});
