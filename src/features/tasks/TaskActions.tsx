import { Button, Stack, Textarea } from '@mantine/core';
import classes from './task.module.css';
import { useTaskStatusActions } from './useTaskStatusActions';
import type { TaskActionsTask } from './useTaskStatusActions';

const COMMENT_MAX_LENGTH = 2000;

export function TaskActions({ task }: { task: TaskActionsTask }) {
  const { actions, comment, commentError, updateComment, submit, busy, pendingStatus } =
    useTaskStatusActions(task);

  if (actions.length === 0) return null;

  return (
    <Stack gap="sm">
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
      {/* Одни и те же кнопки: на телефоне CSS закрепляет их внизу экрана, копий в разметке нет. */}
      <div className={`${classes.actions} ${classes.sticky}`} data-sticky-actions>
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
      </div>
    </Stack>
  );
}
