import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const key: string | undefined = import.meta.env.VITE_SUPABASE_KEY;

if (!url || !key) {
  const message =
    'Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_KEY. Заполните файл .env по образцу .env.example.';
  // Модуль загружается раньше React, поэтому без этой строки страница осталась бы белой.
  document.getElementById('root')?.replaceChildren(message);
  throw new Error(message);
}

export const supabase = createClient<Database>(url, key, {
  // Клиент сам повторяет чтение 3 раза с паузами 1, 2 и 4 с, а поверх него повторяет TanStack Query.
  // Вместе это 15 с скелетона до сообщения об ошибке, поэтому повторы остаются только в queryClient.
  db: { retry: false },
});
