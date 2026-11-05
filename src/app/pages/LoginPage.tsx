import { Center, Paper, Stack, Text, Title } from '@mantine/core';
import { Navigate } from 'react-router';
import { LoginForm } from '@/features/auth';
import { useCurrentUser } from '@/shared/currentUser';
import { CurrentUserPending } from '../guards';

export function LoginPage() {
  const current = useCurrentUser();
  if (current.status === 'ready' || current.status === 'no_profile') {
    return <Navigate to="/" replace />;
  }

  return (
    <Center mih="100dvh" p="md">
      <Stack gap="md" w={400} maw="100%">
        <Text fw={600} c="dimmed" ta="center">
          Объекты и задачи
        </Text>
        <Paper withBorder radius="lg" p={{ base: 'lg', sm: 'xl' }}>
          <Stack gap="lg">
            <Title order={2}>Вход</Title>
            {current.status === 'loading' ? <CurrentUserPending state={current} /> : <LoginForm />}
          </Stack>
        </Paper>
      </Stack>
    </Center>
  );
}
