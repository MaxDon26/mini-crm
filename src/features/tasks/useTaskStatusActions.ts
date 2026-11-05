import { useState } from 'react';
import { useReadyUser } from '@/shared/currentUser';
import { REFUSAL_MESSAGES } from '@/shared/dbErrors';
import { useChangeTaskStatus, useIsTaskBusy } from './hooks';
import { getAvailableActions } from './statuses';
import type { StatusTransition } from './statuses';
import { normalizeText } from './taskRules';
import type { TaskDetails } from './types';

export type TaskActionsTask = Pick<TaskDetails, 'id' | 'status' | 'assigneeId'>;

export function useTaskStatusActions(task: TaskActionsTask) {
  const user = useReadyUser();
  const change = useChangeTaskStatus(task.id);
  const busy = useIsTaskBusy(task.id);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);

  const actions = getAvailableActions({
    status: task.status,
    role: user.role,
    isAssignee: task.assigneeId === user.id,
  });

  const updateComment = (value: string) => {
    setComment(value);
    setCommentError(null);
  };

  const submit = (action: StatusTransition) => {
    const text = normalizeText(comment);
    if (action.commentRequired && !text) {
      setCommentError(REFUSAL_MESSAGES.comment_required);
      return;
    }
    setCommentError(null);
    change.mutate(
      // Статус, который видит человек: база по нему отличает гонку от запрещённого перехода (Р11).
      { expectedStatus: task.status, newStatus: action.to, comment: text || undefined },
      { onSuccess: () => setComment('') },
    );
  };

  return {
    actions,
    comment,
    commentError,
    updateComment,
    submit,
    busy,
    pendingStatus: change.isPending ? change.variables.newStatus : null,
  };
}
