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

/**
 * Создание или правка. Объект выбирают только при создании: потом он не меняется (Р28), поэтому
 * форме правки список объектов не нужен.
 */
export type TaskFormParams =
  | {
      task?: undefined;
      /** Объект, выбранный заранее. */
      defaultObjectId?: string;
      objects: TaskObjectsSource;
      onClose: () => void;
    }
  | {
      /** Правка этой задачи. */
      task: TaskDetails;
      onClose: () => void;
    };

function getInitialValues(params: TaskFormParams): TaskFormValues {
  const { task } = params;
  if (task) {
    return {
      title: task.title,
      description: task.description ?? '',
      objectId: task.objectId,
      assigneeId: task.assigneeId,
    };
  }
  return {
    title: '',
    description: '',
    objectId: params.defaultObjectId ?? null,
    assigneeId: null,
  };
}

function getCurrentAssignee(task: TaskDetails | undefined): TaskOption | null {
  if (!task?.assigneeId) return null;
  return { id: task.assigneeId, name: task.assigneeName ?? UNKNOWN_NAME };
}

export function useTaskForm(params: TaskFormParams) {
  const { task, onClose } = params;
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
    assigneeClearable: canClearAssignee(task?.status),
  };
}
