// Относительный путь с расширением: модуль проверяет node:test, а там нет `@/`.
import { hasVisibleText, normalizeText } from '../../shared/text.ts';
import type { ObjectFields } from './api';

// Те же пределы, что в базе. Форма подсказывает раньше, решает всё равно база (раздел 3.8).
const NAME_MAX_LENGTH = 200;
const ADDRESS_MAX_LENGTH = 300;

function validateText(value: string, maxLength: number, emptyMessage: string): string | null {
  if (!hasVisibleText(value)) return emptyMessage;
  // Считаем символы, а не единицы UTF-16: база считает так же, и эмодзи не должен стоить двух знаков.
  return Array.from(normalizeText(value)).length > maxLength
    ? `Не больше ${maxLength} знаков`
    : null;
}

export function validateObjectForm(
  values: ObjectFields,
): Partial<Record<keyof ObjectFields, string>> {
  const errors: Partial<Record<keyof ObjectFields, string>> = {};
  const name = validateText(values.name, NAME_MAX_LENGTH, 'Укажите название');
  const address = validateText(values.address, ADDRESS_MAX_LENGTH, 'Укажите адрес');
  if (name) errors.name = name;
  if (address) errors.address = address;
  return errors;
}

export function normalizeObjectFields(values: ObjectFields): ObjectFields {
  return { name: normalizeText(values.name), address: normalizeText(values.address) };
}

/**
 * Сравнение с тем, что форма показала при открытии, а не с текущим объектом: если он успел
 * обновиться в фоне, нетронутое поле не должно затереть чужую правку.
 */
export function pickObjectChanges(
  initial: ObjectFields,
  values: ObjectFields,
): Partial<ObjectFields> {
  const before = normalizeObjectFields(initial);
  const after = normalizeObjectFields(values);
  const changes: Partial<ObjectFields> = {};
  if (after.name !== before.name) changes.name = after.name;
  if (after.address !== before.address) changes.address = after.address;
  return changes;
}
