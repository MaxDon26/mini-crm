import { Button, Group } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useIsPhone } from '@/shared/ui';
import type { ObjectItem, ObjectListItem } from './api';
import classes from './objects.module.css';

type ObjectsTableProps = {
  objects: ObjectListItem[];
  /** Столбец «На проверке» только для постановщика (Р22). */
  showInReview?: boolean;
  /** Полоса хода работ: её рисует раздел задач, а экран передаёт сюда (Р16). */
  renderProgress?: (object: ObjectListItem) => ReactNode;
  /** Без обработчиков столбца действий нет: исполнителю кнопки не показываются. */
  onEdit?: (object: ObjectItem) => void;
  onDelete?: (object: ObjectItem) => void;
};

function InReviewCount({ count }: { count: number }) {
  return <span className={count === 0 ? classes.zero : classes.inReview}>{count}</span>;
}

function ObjectName({ object }: { object: ObjectItem }) {
  return (
    <>
      <Link to={`/objects/${object.id}`} className={classes.name}>
        {object.name}
      </Link>
      <div className={classes.address}>{object.address}</div>
    </>
  );
}

type ObjectActionsProps = Pick<ObjectsTableProps, 'onEdit' | 'onDelete'> & { object: ObjectItem };

function ObjectActions({ object, onEdit, onDelete }: ObjectActionsProps) {
  return (
    <Group gap="xs" wrap="nowrap">
      {onEdit && (
        <Button
          size="xs"
          variant="default"
          aria-label={`Изменить объект ${object.name}`}
          onClick={() => onEdit(object)}
        >
          Изменить
        </Button>
      )}
      {onDelete && (
        <Button
          size="xs"
          variant="default"
          aria-label={`Удалить объект ${object.name}`}
          onClick={() => onDelete(object)}
        >
          Удалить
        </Button>
      )}
    </Group>
  );
}

function ObjectCards({
  objects,
  showInReview,
  renderProgress,
  onEdit,
  onDelete,
}: ObjectsTableProps) {
  const hasActions = Boolean(onEdit || onDelete);
  return (
    <ul className={classes.cards}>
      {objects.map((object) => (
        <li key={object.id} className={classes.card}>
          <div>
            <ObjectName object={object} />
          </div>
          {renderProgress?.(object)}
          {(showInReview || hasActions) && (
            <div className={classes.cardFooter}>
              {showInReview && (
                <span>
                  На проверке: <InReviewCount count={object.inReviewCount ?? 0} />
                </span>
              )}
              {hasActions && <ObjectActions object={object} onEdit={onEdit} onDelete={onDelete} />}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ObjectsTable(props: ObjectsTableProps) {
  const { objects, showInReview = false, renderProgress, onEdit, onDelete } = props;
  const isPhone = useIsPhone();
  if (isPhone) return <ObjectCards {...props} showInReview={showInReview} />;

  const hasActions = Boolean(onEdit || onDelete);
  return (
    <table className={classes.table}>
      <thead>
        <tr>
          <th>Название</th>
          {renderProgress && <th className={classes.progressColumn}>Ход работ</th>}
          {showInReview && <th className={classes.fitColumn}>На проверке</th>}
          {hasActions && <th className={classes.fitColumn}>Действия</th>}
        </tr>
      </thead>
      <tbody>
        {objects.map((object) => (
          <tr key={object.id}>
            <td className={classes.nameCell}>
              <ObjectName object={object} />
            </td>
            {renderProgress && <td>{renderProgress(object)}</td>}
            {showInReview && (
              <td className={classes.narrow}>
                <InReviewCount count={object.inReviewCount ?? 0} />
              </td>
            )}
            {hasActions && (
              <td className={classes.narrow}>
                <ObjectActions object={object} onEdit={onEdit} onDelete={onDelete} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
