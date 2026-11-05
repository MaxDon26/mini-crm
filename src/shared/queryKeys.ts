// Разделы не импортируют друг друга (Р16), поэтому обновляют чужие данные через эти ключи.
// Сброс по `objects.all` или `tasks.all` задевает все запросы этого раздела.
// Задачи влияют на столбец «На проверке: N», поэтому действие над задачей сбрасывает и `objects.all`.
export const queryKeys = {
  profiles: {
    all: ['profiles'],
    byId: (userId: string) => ['profiles', 'byId', userId],
    executors: () => ['profiles', 'executors'],
  },
  objects: {
    all: ['objects'],
    list: () => ['objects', 'list'],
    detail: (objectId: string) => ['objects', 'detail', objectId],
  },
  tasks: {
    all: ['tasks'],
    byObject: (objectId: string) => ['tasks', 'byObject', objectId],
    mine: () => ['tasks', 'mine'],
    detail: (taskId: string) => ['tasks', 'detail', taskId],
    history: (taskId: string) => ['tasks', 'history', taskId],
  },
} as const;
