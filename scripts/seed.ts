// Демо-данные заводятся только настоящими действиями пользователей с публичным ключом (Р15, Р26):
// так статусы и история получаются теми же, что и при работе через сайт.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { STATUS_LABELS } from '../src/features/tasks/statuses.ts';
import type { Database } from '../src/shared/database.types.ts';

type Client = SupabaseClient<Database>;
type Role = Database['public']['Enums']['app_role'];
type Status = Database['public']['Enums']['task_status'];

const USERS = {
  manager1: { env: 'SEED_MANAGER_1', role: 'manager' },
  manager2: { env: 'SEED_MANAGER_2', role: 'manager' },
  executor1: { env: 'SEED_EXECUTOR_1', role: 'executor' },
  executor2: { env: 'SEED_EXECUTOR_2', role: 'executor' },
} as const satisfies Record<string, { env: string; role: Role }>;

type UserKey = keyof typeof USERS;
type SignedInUser = { id: string; client: Client };
type SignedInUsers = Record<UserKey, SignedInUser>;

type StatusStep = { actor: UserKey; to: Status; comment?: string };
type ReassignStep = { actor: UserKey; reassignTo: UserKey };
type Step = StatusStep | ReassignStep;

const OBJECTS = {
  residential: { name: 'ЖК «Северный», корпус 2', address: 'г. Казань, ул. Лесная, 12' },
  school: { name: 'Реконструкция школы № 7', address: 'г. Казань, ул. Учительская, 7' },
  warehouse: { name: 'Складской комплекс «Восток»', address: 'г. Казань, Промышленный проезд, 3' },
};

type ObjectKey = keyof typeof OBJECTS;

type TaskScenario = {
  object: ObjectKey;
  title: string;
  description: string;
  author: UserKey;
  assignee: UserKey | null;
  steps: Step[];
};

const take = (actor: UserKey): StatusStep => ({ actor, to: 'in_progress' });
const submit = (actor: UserKey): StatusStep => ({ actor, to: 'in_review' });
const accept = (actor: UserKey): StatusStep => ({ actor, to: 'accepted' });
const sendBack = (actor: UserKey, comment: string): StatusStep => ({
  actor,
  to: 'rework',
  comment,
});

const TASKS: TaskScenario[] = [
  {
    object: 'residential',
    title: 'Кладка перегородок на 3 этаже',
    description: 'Перегородки из газобетона в квартирах 31–36 по плану этажа, толщина 100 мм.',
    author: 'manager1',
    assignee: 'executor1',
    steps: [],
  },
  {
    object: 'residential',
    title: 'Монтаж стояков отопления, секция Б',
    description: 'Стояки с 1 по 9 этаж, опрессовка после монтажа, акт скрытых работ.',
    author: 'manager1',
    assignee: 'executor1',
    steps: [take('executor1'), { actor: 'manager1', reassignTo: 'executor2' }],
  },
  {
    object: 'residential',
    title: 'Гидроизоляция кровли',
    description: 'Наплавляемая гидроизоляция в два слоя. Подрядчик ещё не определён.',
    author: 'manager2',
    assignee: null,
    steps: [],
  },
  {
    object: 'residential',
    title: 'Стяжка пола в подвале',
    description: 'Армированная стяжка 60 мм в технических помещениях, уклон к трапам.',
    author: 'manager1',
    assignee: 'executor2',
    steps: [
      take('executor2'),
      submit('executor2'),
      sendBack('manager1', 'Уклон к трапам меньше проектного, в двух помещениях стоит вода.'),
    ],
  },
  {
    object: 'school',
    title: 'Замена окон в спортзале',
    description: 'Демонтаж старых рам, установка 12 блоков с защитными решётками.',
    author: 'manager1',
    assignee: 'executor1',
    steps: [take('executor1'), submit('executor1')],
  },
  {
    object: 'school',
    title: 'Электропроводка в кабинетах 2 этажа',
    description: 'Замена проводки и щитка этажа, замер сопротивления изоляции.',
    author: 'manager2',
    assignee: 'executor1',
    steps: [
      take('executor1'),
      submit('executor1'),
      sendBack(
        'manager2',
        'Нет протокола замера сопротивления изоляции, приложите и проверьте щит.',
      ),
      take('executor1'),
    ],
  },
  {
    object: 'school',
    title: 'Покраска стен в коридорах',
    description: 'Шпаклёвка, грунт и два слоя моющейся краски на 1 и 2 этажах.',
    author: 'manager1',
    assignee: 'executor1',
    steps: [
      take('executor1'),
      submit('executor1'),
      sendBack('manager1', 'На 2 этаже просвечивает грунт у лестницы, нужен ещё один слой.'),
      take('executor1'),
      submit('executor1'),
      accept('manager2'),
    ],
  },
  {
    object: 'warehouse',
    title: 'Бетонный пол в зоне приёмки',
    description: 'Заливка плиты 200 мм с упрочнённым верхним слоем, нарезка швов.',
    author: 'manager2',
    assignee: 'executor2',
    steps: [take('executor2'), submit('executor2')],
  },
  {
    object: 'warehouse',
    title: 'Монтаж секционных ворот',
    description: 'Четыре ворота на рампе, подключение приводов и проверка датчиков.',
    author: 'manager2',
    assignee: 'executor2',
    steps: [take('executor2'), submit('executor2'), accept('manager1')],
  },
];

type DbError = { message: string; code?: string };

function refusal(action: string, error: DbError): Error {
  const code = error.code ? ` (${error.code})` : '';
  return new Error(`${action}: ${error.message}${code}`);
}

// Пустое значение считается отсутствующим: в .env.example переменные перечислены без значений.
function readEnv(): {
  url: string;
  key: string;
  credentials: Record<UserKey, { email: string; password: string }>;
} {
  const userKeys = Object.keys(USERS) as UserKey[];
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_KEY',
    ...userKeys.flatMap((key) => [`${USERS[key].env}_EMAIL`, `${USERS[key].env}_PASSWORD`]),
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Не заданы переменные окружения: ${missing.join(', ')}`);
  }

  const read = (name: string): string => process.env[name] ?? '';
  const credentials = Object.fromEntries(
    userKeys.map((key) => [
      key,
      { email: read(`${USERS[key].env}_EMAIL`), password: read(`${USERS[key].env}_PASSWORD`) },
    ]),
  ) as Record<UserKey, { email: string; password: string }>;

  return { url: read('VITE_SUPABASE_URL'), key: read('VITE_SUPABASE_KEY'), credentials };
}

async function signInAll(env: ReturnType<typeof readEnv>): Promise<SignedInUsers> {
  const users: Partial<SignedInUsers> = {};
  for (const key of Object.keys(USERS) as UserKey[]) {
    // Без автообновления токена процесс завершается сам: иначе его держал бы таймер клиента.
    const client = createClient<Database>(env.url, env.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    users[key] = { id: await signInWithRole(client, key, env.credentials[key]), client };
  }
  return users as SignedInUsers;
}

async function signInWithRole(
  client: Client,
  key: UserKey,
  credentials: { email: string; password: string },
): Promise<string> {
  const { env, role } = USERS[key];
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error) throw refusal(`Вход ${env}`, error);

  const profile = await client.from('profiles').select('role').eq('id', data.user.id).single();
  if (profile.error) throw refusal(`Чтение профиля ${env}`, profile.error);
  if (profile.data.role !== role) {
    throw new Error(`${env}: ожидалась роль ${role}, в профиле ${profile.data.role}`);
  }
  return data.user.id;
}

// История неизменяема и стереть прошлый запуск нельзя, поэтому повторный запуск отличается меткой.
async function runLabel(manager: Client): Promise<string> {
  const names = Object.values(OBJECTS).map((object) => object.name);
  const { data, error } = await manager.from('objects').select('id').in('name', names).limit(1);
  if (error) throw refusal('Проверка повторного запуска', error);
  if (data.length === 0) return '';
  return ` [запуск ${new Date().toISOString().slice(0, 19).replace('T', ' ')}]`;
}

async function createObjects(manager: Client, label: string): Promise<Record<ObjectKey, string>> {
  const ids: Partial<Record<ObjectKey, string>> = {};
  for (const key of Object.keys(OBJECTS) as ObjectKey[]) {
    const { name, address } = OBJECTS[key];
    const { data, error } = await manager
      .from('objects')
      .insert({ name: name + label, address })
      .select('id')
      .single();
    if (error) throw refusal(`Создание объекта «${name}»`, error);
    ids[key] = data.id;
  }
  return ids as Record<ObjectKey, string>;
}

async function runScenario(
  scenario: TaskScenario,
  objectId: string,
  label: string,
  users: SignedInUsers,
): Promise<Status> {
  const action = `Задача «${scenario.title}»`;
  const { data, error } = await users[scenario.author].client
    .from('tasks')
    .insert({
      title: scenario.title + label,
      description: scenario.description,
      object_id: objectId,
      assignee_id: scenario.assignee && users[scenario.assignee].id,
    })
    .select('id')
    .single();
  if (error) throw refusal(`${action}, создание`, error);

  let status: Status = 'new';
  for (const step of scenario.steps) {
    if ('reassignTo' in step) {
      await reassign(data.id, users[step.actor].client, users[step.reassignTo].id, action);
    } else {
      await changeStatus(data.id, users[step.actor].client, status, step, action);
      status = step.to;
    }
  }
  return status;
}

async function reassign(taskId: string, manager: Client, assigneeId: string, action: string) {
  // Отказ правил даёт не ошибку, а 0 строк: single превращает пустой ответ в ошибку (контракт 3.8).
  const { error } = await manager
    .from('tasks')
    .update({ assignee_id: assigneeId })
    .eq('id', taskId)
    .select('id')
    .single();
  if (error) throw refusal(`${action}, смена исполнителя`, error);
}

async function changeStatus(
  taskId: string,
  client: Client,
  expected: Status,
  step: StatusStep,
  action: string,
) {
  const { error } = await client.rpc('change_task_status', {
    p_task_id: taskId,
    p_expected_status: expected,
    p_new_status: step.to,
    p_comment: step.comment,
  });
  if (error) throw refusal(`${action}, ${expected} → ${step.to}`, error);
}

async function main() {
  const users = await signInAll(readEnv());
  const label = await runLabel(users.manager1.client);
  const objectIds = await createObjects(users.manager1.client, label);

  const counts = new Map<Status, number>();
  for (const scenario of TASKS) {
    const status = await runScenario(scenario, objectIds[scenario.object], label, users);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  const byStatus = (Object.keys(STATUS_LABELS) as Status[]).map(
    (status) => `${STATUS_LABELS[status]}: ${counts.get(status) ?? 0}`,
  );
  console.log(`Создано объектов: ${Object.keys(objectIds).length}, задач: ${TASKS.length}.`);
  console.log(`По статусам: ${byStatus.join(', ')}.`);
  if (label) console.log(`Повторный запуск, метка в названиях:${label}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
