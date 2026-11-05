const SHORT_DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const FULL_DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatShortDateTime(value: string): string {
  return SHORT_DATE_TIME.format(new Date(value)).replace(',', '');
}

export function formatFullDateTime(value: string): string {
  return FULL_DATE_TIME.format(new Date(value)).replace(',', '');
}
