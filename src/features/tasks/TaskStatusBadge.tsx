import { STATUS_LABELS } from './statuses';
import type { TaskStatus } from './statuses';
import classes from './status.module.css';
import { statusStyle } from './statusStyle';

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={classes.badge} style={statusStyle(status)}>
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Цветная точка без текста: рядом всегда есть метка или подпись со словом. */
export function TaskStatusDot({ status }: { status: TaskStatus }) {
  return <span className={classes.dot} style={statusStyle(status)} aria-hidden />;
}
