import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, Fragment, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Database } from './database.types';
import { queryKeys } from './queryKeys';
import { supabase } from './supabaseClient';

export type Role = Database['public']['Enums']['app_role'];

export type CurrentUser = {
  id: string;
  fullName: string;
  role: Role;
};

export const ROLE_LABELS: Record<Role, string> = {
  manager: 'Постановщик',
  executor: 'Исполнитель',
};

// Сбой чтения профиля не равен «нет профиля»: состояние остаётся `loading` с ошибкой,
// иначе человек с профилем при обрыве сети увидел бы «Нет доступа».
export type CurrentUserState =
  | { status: 'loading'; error: Error | null; isRetrying: boolean; retry: () => void }
  | { status: 'anonymous' }
  | { status: 'no_profile' }
  | { status: 'ready'; user: CurrentUser };

const CurrentUserContext = createContext<CurrentUserState | null>(null);

async function fetchProfile(userId: string): Promise<CurrentUser | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data && { id: data.id, fullName: data.full_name, role: data.role };
}

/** `undefined` — сессия ещё не прочитана, `null` — входа нет. */
function useSessionUserId(): string | null | undefined {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let knownUserId: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      // Очистка здесь, а не в кнопке выхода: сессия может закончиться и в другой вкладке,
      // а следующий пользователь не должен увидеть чужие данные из кэша.
      if (knownUserId && knownUserId !== nextUserId) queryClient.clear();
      knownUserId = nextUserId;
      setUserId(nextUserId);
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  return userId;
}

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const userId = useSessionUserId();
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: queryKeys.profiles.byId(userId ?? ''),
    queryFn: userId ? () => fetchProfile(userId) : skipToken,
  });

  const state = useMemo<CurrentUserState>(() => {
    if (userId === null) return { status: 'anonymous' };
    if (userId === undefined || data === undefined) {
      return {
        status: 'loading',
        error,
        isRetrying: isFetching,
        retry: () => void refetch(),
      };
    }
    return data === null ? { status: 'no_profile' } : { status: 'ready', user: data };
  }, [userId, data, error, isFetching, refetch]);

  return (
    <CurrentUserContext.Provider value={state}>
      {/* Смена пользователя пересоздаёт экраны: их запросы не должны пережить очистку кэша. */}
      <Fragment key={userId ?? 'anonymous'}>{children}</Fragment>
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUserState {
  const state = useContext(CurrentUserContext);
  if (!state) throw new Error('useCurrentUser вызван вне CurrentUserProvider');
  return state;
}

/** Для экранов за проверкой входа в маршрутах: там профиль уже есть, лишние проверки не нужны. */
export function useReadyUser(): CurrentUser {
  const state = useCurrentUser();
  if (state.status !== 'ready') throw new Error('useReadyUser вызван без готового профиля');
  return state.user;
}
