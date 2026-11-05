import type { TaskStatus } from './statuses';

export type TaskListItem = {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  objectName: string | null;
  createdAt: string;
};

export type TaskDetails = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  objectId: string;
  objectName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  authorName: string | null;
  createdAt: string;
};

export type TaskHistoryRecord = {
  id: number;
  createdAt: string;
  actorName: string | null;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  fromAssigneeId: string | null;
  fromAssigneeName: string | null;
  toAssigneeId: string | null;
  toAssigneeName: string | null;
  comment: string | null;
};

export type TaskOption = {
  id: string;
  name: string;
};

export type TaskFormValues = {
  title: string;
  description: string;
  objectId: string | null;
  assigneeId: string | null;
};

export type NewTask = {
  title: string;
  description: string | null;
  object_id: string;
  assignee_id: string | null;
};

// Объект задачи задаётся только при создании (Р28).
export type TaskChanges = Partial<Omit<NewTask, 'object_id'>>;
