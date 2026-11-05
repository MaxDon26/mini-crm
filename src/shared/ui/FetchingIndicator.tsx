import { Group, Loader, Text } from '@mantine/core';

/**
 * Прижимается к правому верхнему углу родителя с `position: relative`,
 * чтобы содержимое не прыгало при каждом обновлении данных.
 */
export function FetchingIndicator({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <Group
      role="status"
      aria-label="Обновление"
      gap={6}
      px={6}
      pos="absolute"
      top={0}
      right={0}
      bg="var(--mantine-color-body)"
      style={{ zIndex: 1 }}
    >
      <Loader size={14} />
      <Text size="xs" c="dimmed">
        Обновление…
      </Text>
    </Group>
  );
}
