import { Container } from '@mantine/core';
import { Navigate, Outlet } from 'react-router';
import { useCurrentUser, useReadyUser } from '@/shared/currentUser';
import type { CurrentUserState, Role } from '@/shared/currentUser';
import { CardSkeleton, ErrorState } from '@/shared/ui';
import { NoAccessPage } from './pages/NoAccessPage';

// Проверки маршрутов только подсказывают, куда идти: настоящую защиту делает база (ТЗ п. 3.1).

const HOME_BY_ROLE: Record<Role, string> = {
  manager: '/objects',
  executor: '/my-tasks',
};

type PendingState = Extract<CurrentUserState, { status: 'loading' }>;

export function CurrentUserPending({ state }: { state: PendingState }) {
  if (state.error) {
    return <ErrorState error={state.error} onRetry={state.retry} retrying={state.isRetrying} />;
  }
  return <CardSkeleton />;
}

export function RequireProfile() {
  const current = useCurrentUser();
  switch (current.status) {
    case 'loading':
      return (
        <Container size="lg" py="md">
          <CurrentUserPending state={current} />
        </Container>
      );
    case 'anonymous':
      return <Navigate to="/login" replace />;
    case 'no_profile':
      return <NoAccessPage />;
    case 'ready':
      return <Outlet />;
  }
}

export function RedirectByRole() {
  const { role } = useReadyUser();
  return <Navigate to={HOME_BY_ROLE[role]} replace />;
}

export function RequireExecutor() {
  const { role } = useReadyUser();
  return role === 'executor' ? <Outlet /> : <Navigate to="/objects" replace />;
}
