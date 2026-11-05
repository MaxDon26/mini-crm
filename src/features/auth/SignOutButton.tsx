import { Button } from '@mantine/core';
import { useSignOut } from './hooks';

export function SignOutButton() {
  const signOutMutation = useSignOut();
  return (
    <Button
      variant="default"
      size="xs"
      loading={signOutMutation.isPending}
      onClick={() => signOutMutation.mutate()}
    >
      Выйти
    </Button>
  );
}
