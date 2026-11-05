import { useForm } from '@mantine/form';
import { useState } from 'react';
import { useExecutors, useSaveTask } from './hooks';
import {
  buildNewTask,
  buildTaskChanges,
  canClearAssignee,
  UNKNOWN_NAME,
  validateTaskForm,
  withCurrentOption,
} from './taskRules';
import type { TaskDetails, TaskFormValues, TaskOption } from './types';

/** Список объектов от экрана: разделы друг друга не импортируют, подходит результат `useObjects()`. */
export type TaskObjectsSource = {
  data?: TaskOption[];
  isPending: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => unknown;
};

export type TaskFormParams = {
  /** Правка этой задачи. Без неё форма создаёт новую. */
  task?: TaskDetails;
  /** Объект, выбранный заранее при создании. */
  defaultObjectId?: string;
  objects: TaskObjectsSource;
  onClose: () => void;
};

function getInitialValues({ task, defaultObjectId }: TaskFormParams): TaskFormValues {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    objectId: task?.objectId ?? defaultObjectId ?? null,
    assigneeId: task?.assigneeId ?? null,
  };
}

function getCurrentAssignee(task: TaskDetails | undefined): TaskOption | null {
  if (!task?.assigneeId) return null;
  return { id: task.assigneeId, name: task.assigneeName ?? UNKNOWN_NAME };
}

function getCurrentObject(task: TaskDetails | undefined): TaskOption | null {
  return task ? { id: task.objectId, name: task.objectName ?? UNKNOWN_NAME } : null;
}

export function useTaskForm(params: TaskFormParams) {
  const { task, objects, onClose } = params;
  const taskId = task?.id;
  // Снимок на момент открытия: фоновое обновление карточки не должно менять, что считается правкой.
  const [initialValues] = useState(() => getInitialValues(params));
  const form = useForm<TaskFormValues>({ initialValues, validate: validateTaskForm });
  const save = useSaveTask(taskId);
  const executors = useExecutors();

  const submit = form.onSubmit((values) => {
    if (taskId === undefined) {
      if (!values.objectId) return;
      const newTask = buildNewTask({ ...values, objectId: values.objectId });
      save.mutate({ newTask }, { onSuccess: onClose });
      return;
    }
    const changes = buildTaskChanges(initialValues, values);
    if (Object.keys(changes).length === 0) onClose();
    else save.mutate({ taskId, changes }, { onSuccess: onClose });
  });

  return {
    form,
    submit,
    saving: save.isPending,
    executors,
    executorOptions: withCurrentOption(executors.data ?? [], getCurrentAssignee(task)),
    objectOptions: withCurrentOption(objects.data ?? [], getCurrentObject(task)),
    assigneeClearable: canClearAssignee(task?.status),
  };
}
