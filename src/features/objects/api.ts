import type { Database } from '@/shared/database.types';
import { fetchAllRows } from '@/shared/fetchAllRows';
import { supabase } from '@/shared/supabaseClient';

type ObjectRow = Database['public']['Tables']['objects']['Row'];

export type ObjectItem = Pick<ObjectRow, 'id' | 'name' | 'address' | 'created_at'>;
export type ObjectFields = Pick<ObjectRow, 'name' | 'address'>;
type TaskStatus = Database['public']['Enums']['task_status'];

/** Число задач объекта в каждом статусе: из него рисуется полоса хода работ (раздел 3.9). */
export type TaskStatusCounts = Partial<Record<TaskStatus, number>>;

export type ObjectListItem = ObjectItem & {
  inReviewCount?: number;
  statusCounts?: TaskStatusCounts;
};

const OBJECT_COLUMNS = 'id, name, address, created_at';

export function fetchObjects(): Promise<ObjectItem[]> {
  // `id` в сортировке нужен для постраничного чтения: у одинаковых названий порядок иначе не задан.
  return fetchAllRows<ObjectItem>((from, to) =>
    supabase.from('objects').select(OBJECT_COLUMNS).order('name').order('id').range(from, to),
  );
}

async function fetchStatusCounts(): Promise<Map<string, TaskStatusCounts>> {
  // Одно чтение на все объекты вместо запроса на каждый. Исполнителю правила доступа отдают только
  // его задачи, поэтому его полоса показывает его работу.
  const rows = await fetchAllRows<{ object_id: string; status: TaskStatus }>((from, to) =>
    supabase.from('tasks').select('object_id, status').order('id').range(from, to),
  );
  const counts = new Map<string, TaskStatusCounts>();
  for (const { object_id: objectId, status } of rows) {
    const objectCounts = counts.get(objectId) ?? {};
    objectCounts[status] = (objectCounts[status] ?? 0) + 1;
    counts.set(objectId, objectCounts);
  }
  return counts;
}

export async function fetchObjectsWithTaskCounts(): Promise<ObjectListItem[]> {
  const [objects, counts] = await Promise.all([fetchObjects(), fetchStatusCounts()]);
  return objects.map((object) => {
    const statusCounts = counts.get(object.id) ?? {};
    return { ...object, statusCounts, inReviewCount: statusCounts.in_review ?? 0 };
  });
}

export async function fetchObject(objectId: string): Promise<ObjectItem | null> {
  const { data, error } = await supabase
    .from('objects')
    .select(OBJECT_COLUMNS)
    .eq('id', objectId)
    .maybeSingle();
  // Адрес страницы можно исказить вручную: номер не в формате uuid равен несуществующему объекту.
  if (error?.code === '22P02') return null;
  if (error) throw error;
  return data;
}

export async function createObject(fields: ObjectFields): Promise<void> {
  const { error } = await supabase.from('objects').insert(fields);
  if (error) throw error;
}

export async function updateObject(
  objectId: string,
  changes: Partial<ObjectFields>,
): Promise<void> {
  const { data, error } = await supabase
    .from('objects')
    .update(changes)
    .eq('id', objectId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  // RLS отвечает на правку удалённого объекта не ошибкой, а пустым ответом (раздел 3.8).
  if (!data) throw new Error('object_not_found');
}

export async function deleteObject(objectId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_object', { p_object_id: objectId });
  if (error) throw error;
}

export async function countObjectTasks(objectId: string): Promise<number> {
  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('object_id', objectId);
  if (error) throw error;
  // Без числа нельзя честно спросить подтверждение (Р3), поэтому его отсутствие считаем сбоем.
  if (count === null) throw new Error('task_count_missing');
  return count;
}
