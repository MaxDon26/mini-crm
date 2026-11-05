import { fetchAllRows } from '@/shared/fetchAllRows';
import { supabase } from '@/shared/supabaseClient';
import type { TaskStatus } from './statuses';
import type {
  NewTask,
  TaskChanges,
  TaskDetails,
  TaskHistoryRecord,
  TaskListItem,
  TaskOption,
} from './types';

// Имя связи обязательно: из tasks и task_history в profiles ведёт несколько связей.
const TASK_LIST_COLUMNS =
  'id, title, status, assignee_id, created_at, assignee:profiles!tasks_assignee_id_fkey(full_name), object:objects(name)';
const TASK_DETAILS_COLUMNS =
  'id, title, description, status, object_id, assignee_id, created_at, assignee:profiles!tasks_assignee_id_fkey(full_name), author:profiles!tasks_author_id_fkey(full_name), object:objects(name)';
const HISTORY_COLUMNS =
  'id, created_at, from_status, to_status, from_assignee_id, to_assignee_id, comment, actor:profiles!task_history_actor_id_fkey(full_name), from_assignee:profiles!task_history_from_assignee_id_fkey(full_name), to_assignee:profiles!task_history_to_assignee_id_fkey(full_name)';

const INVALID_UUID_CODE = '22P02';

// Типы схемы считают вложенные объект и автора обязательными, но правила доступа могут их скрыть,
// поэтому на сайт вложенные значения попадают как необязательные.
type NestedName = { full_name: string } | null;
type NestedObject = { name: string } | null;

type TaskListRow = {
  id: string;
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  created_at: string;
  assignee: NestedName;
  object: NestedObject;
};

function toListItem(row: TaskListRow): TaskListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee?.full_name ?? null,
    objectName: row.object?.name ?? null,
    createdAt: row.created_at,
  };
}

export async function fetchObjectTasks(objectId: string): Promise<TaskListItem[]> {
  // `id` в сортировке нужен для постраничного чтения: у одинаковых дат порядок иначе не задан.
  const rows = await fetchAllRows<TaskListRow>((from, to) =>
    supabase
      .from('tasks')
      .select(TASK_LIST_COLUMNS)
      .eq('object_id', objectId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  );
  return rows.map(toListItem);
}

export async function fetchMyTasks(userId: string): Promise<TaskListItem[]> {
  const rows = await fetchAllRows<TaskListRow>((from, to) =>
    supabase
      .from('tasks')
      .select(TASK_LIST_COLUMNS)
      .eq('assignee_id', userId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  );
  return rows.map(toListItem);
}

export async function fetchTask(taskId: string): Promise<TaskDetails | null> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_DETAILS_COLUMNS)
    .eq('id', taskId)
    .maybeSingle();
  // Испорченная ссылка для человека ничем не отличается от старой: задачи по ней нет.
  if (error?.code === INVALID_UUID_CODE) return null;
  if (error) throw error;
  if (!data) return null;
  const author: NestedName = data.author;
  const object: NestedObject = data.object;
  return {
    id: data.id,
    title: data.title,
    description: data.description,
    status: data.status,
    objectId: data.object_id,
    objectName: object?.name ?? null,
    assigneeId: data.assignee_id,
    assigneeName: data.assignee?.full_name ?? null,
    authorName: author?.full_name ?? null,
    createdAt: data.created_at,
  };
}

export async function fetchTaskHistory(taskId: string): Promise<TaskHistoryRecord[]> {
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from('task_history')
      .select(HISTORY_COLUMNS)
      .eq('task_id', taskId)
      .order('id')
      .range(from, to),
  );
  return rows.map((row) => {
    const actor: NestedName = row.actor;
    return {
      id: row.id,
      createdAt: row.created_at,
      actorName: actor?.full_name ?? null,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      fromAssigneeId: row.from_assignee_id,
      fromAssigneeName: row.from_assignee?.full_name ?? null,
      toAssigneeId: row.to_assignee_id,
      toAssigneeName: row.to_assignee?.full_name ?? null,
      comment: row.comment,
    };
  });
}

export async function fetchExecutors(): Promise<TaskOption[]> {
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'executor')
      .order('full_name')
      .order('id')
      .range(from, to),
  );
  return rows.map((row) => ({ id: row.id, name: row.full_name }));
}

export async function createTask(task: NewTask): Promise<{ id: string }> {
  const { data, error } = await supabase.from('tasks').insert(task).select('id').single();
  if (error) throw error;
  return data;
}

export async function updateTask(taskId: string, changes: TaskChanges): Promise<void> {
  const { data, error } = await supabase
    .from('tasks')
    .update(changes)
    .eq('id', taskId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  // Строку, которую нельзя менять, база пропускает без ошибки: 0 строк и никаких изменений.
  if (!data) throw new Error('task_not_found');
}

export type ChangeStatusInput = {
  expectedStatus: TaskStatus;
  newStatus: TaskStatus;
  comment?: string;
};

export async function changeTaskStatus(taskId: string, input: ChangeStatusInput): Promise<void> {
  const { error } = await supabase.rpc('change_task_status', {
    p_task_id: taskId,
    p_expected_status: input.expectedStatus,
    p_new_status: input.newStatus,
    ...(input.comment ? { p_comment: input.comment } : {}),
  });
  if (error) throw error;
}

export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_task', { p_task_id: taskId });
  if (error) throw error;
}
