import type { PostgrestError } from '@supabase/supabase-js';
import type { Database } from '@/shared/database.types';
import { supabase } from '@/shared/supabaseClient';

type ObjectRow = Database['public']['Tables']['objects']['Row'];

export type ObjectItem = Pick<ObjectRow, 'id' | 'name' | 'address' | 'created_at'>;
export type ObjectFields = Pick<ObjectRow, 'name' | 'address'>;
export type ObjectListItem = ObjectItem & { inReviewCount?: number };

const OBJECT_COLUMNS = 'id, name, address, created_at';
const PAGE_SIZE = 1000; // Предел API: `max_rows` в supabase/config.toml.

type PageResponse<Row> = { data: Row[] | null; error: PostgrestError | null };

/** API молча обрезает ответ до 1000 строк, поэтому без постраничного чтения список и счётчик занижаются. */
async function fetchAllRows<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (;;) {
    const { data, error } = await fetchPage(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

export function fetchObjects(): Promise<ObjectItem[]> {
  // `id` в сортировке нужен для постраничного чтения: у одинаковых названий порядок иначе не задан.
  return fetchAllRows<ObjectItem>((from, to) =>
    supabase.from('objects').select(OBJECT_COLUMNS).order('name').order('id').range(from, to),
  );
}

async function fetchInReviewCounts(): Promise<Map<string, number>> {
  const rows = await fetchAllRows<{ object_id: string }>((from, to) =>
    supabase
      .from('tasks')
      .select('object_id')
      .eq('status', 'in_review')
      .order('id')
      .range(from, to),
  );
  const counts = new Map<string, number>();
  for (const { object_id: objectId } of rows) {
    counts.set(objectId, (counts.get(objectId) ?? 0) + 1);
  }
  return counts;
}

export async function fetchObjectsWithInReviewCount(): Promise<ObjectListItem[]> {
  const [objects, counts] = await Promise.all([fetchObjects(), fetchInReviewCounts()]);
  return objects.map((object) => ({ ...object, inReviewCount: counts.get(object.id) ?? 0 }));
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
