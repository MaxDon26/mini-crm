import { Center, Paper, Stack, Text, Title } from '@mantine/core';
import { SignOutButton } from '@/features/auth';

export function NoAccessPage() {
  return (
    <Center mih="100vh" p="md">
      <Paper withBorder p="lg" w={420} maw="100%">
        <Stack align="flex-start">
          <Title order={2}>Нет доступа</Title>
          <Text>У этой учётной записи нет профиля. Обратитесь к администратору.</Text>
          <SignOutButton />
        </Stack>
      </Paper>
    </Center>
  );
}
