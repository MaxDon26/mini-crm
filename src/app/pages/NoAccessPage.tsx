import { Center, Paper, Stack, Text, Title } from '@mantine/core';
import { SignOutButton } from '@/features/auth';

export function NoAccessPage() {
  return (
    <Center mih="100dvh" p="md">
      <Paper withBorder radius="lg" p={{ base: 'lg', sm: 'xl' }} w={440} maw="100%">
        <Stack align="flex-start">
          <Title order={2}>Нет доступа</Title>
          <Text>У этой учётной записи нет профиля. Обратитесь к администратору.</Text>
          <SignOutButton />
        </Stack>
      </Paper>
    </Center>
  );
}
