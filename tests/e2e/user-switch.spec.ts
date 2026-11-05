// Сценарий 35: смена пользователя в одной вкладке. Данные прежнего пользователя живут в кэше запросов
// страницы, поэтому вкладка не перезагружается: выход и вход идут через интерфейс, как у человека.
import { arrangeNewTask, arrangeObject, credentials, expect, test, USERS } from './helpers.ts';

declare global {
  interface Window {
    foreignTextSeen?: boolean;
  }
}

test('сценарий 35: после выхода и входа другим пользователем чужих данных не видно ни на миг', async ({
  openAs,
}) => {
  // Объект без задач Ивана: его название Иван не должен увидеть ни из кэша, ни из базы.
  const foreign = await arrangeObject();
  const own = await arrangeNewTask();
  const page = await openAs(USERS.anna);

  await test.step('постановщик открывает карточку задачи, карточку объекта и список', async () => {
    await page.goto(`/tasks/${own.taskId}`);
    await expect(page.getByRole('heading', { name: own.taskTitle })).toBeVisible();
    await page.getByRole('link', { name: own.objectName, exact: true }).click();
    // Форма задачи в карточке объекта загружает полный список объектов под тем же ключом, что
    // «Объекты» исполнителя: без очистки кэша Иван увидел бы его. Поле выбора объекта доступно,
    // когда список загружен.
    await page.getByRole('button', { name: 'Создать задачу' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Объект')).toBeEnabled();
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('banner').getByRole('link', { name: 'Объекты' }).click();
    await expect(page.getByRole('link', { name: foreign.objectName, exact: true })).toBeVisible();
  });

  await test.step('выход в той же вкладке', async () => {
    await page.getByRole('banner').getByRole('button', { name: 'Выйти' }).click();
    await expect(page).toHaveURL('/login');
  });

  // Наблюдатель срабатывает на каждое изменение страницы до её отрисовки, поэтому замечает и текст,
  // который показался бы на мгновение до ответа базы.
  await page.evaluate((name) => {
    window.foreignTextSeen = document.body.textContent?.includes(name) ?? false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes(name)) window.foreignTextSeen = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, foreign.objectName);

  await test.step('исполнитель входит без перезагрузки вкладки', async () => {
    const { email, password } = credentials(USERS.ivan);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(USERS.ivan.home);
    await expect(page.getByRole('banner').getByText(USERS.ivan.name)).toBeVisible();
  });

  await test.step('исполнитель открывает «Объекты»: только свои', async () => {
    await page.getByRole('banner').getByRole('link', { name: 'Объекты' }).click();
    // Сразу после перехода, до ответа базы: кэш прежнего пользователя не должен попасть на экран.
    expect(
      await page.evaluate((name) => document.body.textContent?.includes(name), foreign.objectName),
    ).toBe(false);
    await expect(page.getByRole('link', { name: own.objectName, exact: true })).toBeVisible();
    await expect(page.getByText(foreign.objectName)).toHaveCount(0);
    expect(await page.evaluate(() => window.foreignTextSeen)).toBe(false);
  });
});
