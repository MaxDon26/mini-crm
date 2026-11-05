import { Box, Button, Container, Group, Text } from '@mantine/core';
import { Link, useMatch } from 'react-router';
import { SignOutButton } from '@/features/auth';
import { ROLE_LABELS, useReadyUser } from '@/shared/currentUser';
import type { Role } from '@/shared/currentUser';

const SECTIONS_BY_ROLE: Record<Role, { to: string; label: string }[]> = {
  manager: [{ to: '/objects', label: 'Объекты' }],
  executor: [
    { to: '/my-tasks', label: 'Мои задачи' },
    { to: '/objects', label: 'Объекты' },
  ],
};

function SectionLink({ to, label }: { to: string; label: string }) {
  const isActive = useMatch({ path: to, end: false }) !== null;
  return (
    <Button component={Link} to={to} size="xs" variant={isActive ? 'light' : 'subtle'}>
      {label}
    </Button>
  );
}

export function TopBar() {
  const { fullName, role } = useReadyUser();
  return (
    <Box
      component="header"
      py="xs"
      style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}
    >
      <Container size="lg">
        <Group justify="space-between" gap="xs">
          <Group component="nav" gap="xs">
            {SECTIONS_BY_ROLE[role].map((section) => (
              <SectionLink key={section.to} {...section} />
            ))}
          </Group>
          <Group gap="sm">
            <Text size="sm">{fullName}</Text>
            <Text size="sm" c="dimmed">
              {ROLE_LABELS[role]}
            </Text>
            <SignOutButton />
          </Group>
        </Group>
      </Container>
    </Box>
  );
}
