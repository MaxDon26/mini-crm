import { Button, Group, Stack, Textarea } from '@mantine/core';
import { useTaskStatusActions } from './useTaskStatusActions';
import type { TaskActionsTask } from './useTaskStatusActions';

const COMMENT_MAX_LENGTH = 2000;

export function TaskActions({ task }: { task: TaskActionsTask }) {
  const { actions, comment, commentError, updateComment, submit, busy, pendingStatus } =
    useTaskStatusActions(task);

  if (actions.length === 0) return null;

  return (
    <Stack gap="xs">
      <Textarea
        label="Комментарий"
        autosize
        minRows={2}
        maxLength={COMMENT_MAX_LENGTH}
        value={comment}
        error={commentError}
        disabled={busy}
        onChange={(event) => updateComment(event.currentTarget.value)}
      />
      <Group gap="sm">
        {actions.map((action) => (
          <Button
            key={action.to}
            variant={action.commentRequired ? 'default' : 'filled'}
            loading={pendingStatus === action.to}
            disabled={busy}
            onClick={() => submit(action)}
          >
            {action.label}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}
