import type { CSSProperties } from 'react';
import type { TaskStatus } from './statuses';

/** Три оттенка статуса из global.css: насыщенный, светлый и тёмный (раздел 3.9). */
export function statusStyle(status: TaskStatus): CSSProperties {
  return {
    '--status': `var(--status-${status})`,
    '--status-light': `var(--status-${status}-light)`,
    '--status-dark': `var(--status-${status}-dark)`,
  } as CSSProperties;
}
