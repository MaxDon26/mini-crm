import { Tooltip } from '@mantine/core';
import { describeProgress, getProgressParts } from './progress';
import type { ProgressPart, StatusCounts } from './progress';
import classes from './progress.module.css';
import { TaskStatusDot } from './TaskStatusBadge';
import { statusStyle } from './statusStyle';

function ProgressTrack({ parts, label }: { parts: ProgressPart[]; label?: string }) {
  return (
    <div
      className={classes.track}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {parts.map((part) => (
        <span
          key={part.status}
          className={classes.segment}
          style={{ ...statusStyle(part.status), flexGrow: part.count }}
        />
      ))}
    </div>
  );
}

function sumCounts(parts: readonly ProgressPart[]): number {
  return parts.reduce((sum, part) => sum + part.count, 0);
}

/**
 * Полоса хода работ в списке объектов: доля задач в каждом статусе. Словами её расшифровывают
 * подпись, подсказка при наведении и `aria-label`.
 */
export function TaskProgressBar({ counts }: { counts: StatusCounts }) {
  const parts = getProgressParts(counts);
  const total = sumCounts(parts);
  const accepted = counts.accepted ?? 0;
  const tooltip =
    total === 0 ? (
      'Задач нет'
    ) : (
      <div className={classes.tooltipList}>
        {parts.map((part) => (
          <span key={part.status}>{`${part.label}: ${part.count}`}</span>
        ))}
      </div>
    );
  return (
    <div className={classes.progress}>
      <Tooltip label={tooltip} withinPortal>
        <div>
          <ProgressTrack parts={parts} label={describeProgress(parts)} />
        </div>
      </Tooltip>
      <span className={classes.caption}>
        {total === 0 ? 'Задач нет' : `Принята: ${accepted} из ${total}`}
      </span>
    </div>
  );
}

/** Полоса с расшифровкой под ней для карточки объекта. */
export function TaskProgressSummary({ counts }: { counts: StatusCounts }) {
  const parts = getProgressParts(counts);
  if (parts.length === 0) return null;
  return (
    <div className={`${classes.progress} ${classes.large}`}>
      <ProgressTrack parts={parts} />
      <ul className={classes.legend} aria-label="Ход работ">
        {parts.map((part) => (
          <li key={part.status} className={classes.legendItem}>
            <TaskStatusDot status={part.status} />
            {`${part.label}: ${part.count}`}
          </li>
        ))}
        <li className={classes.legendItem}>{`Всего: ${sumCounts(parts)}`}</li>
      </ul>
    </div>
  );
}
