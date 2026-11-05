import type { PostgrestError } from '@supabase/supabase-js';

const PAGE_SIZE = 1000; // Предел API: `max_rows` в supabase/config.toml.

type PageResponse<Row> = { data: Row[] | null; error: PostgrestError | null };

/** API молча обрезает ответ до 1000 строк, поэтому без постраничного чтения списки и счётчики занижаются. */
export async function fetchAllRows<Row>(
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
