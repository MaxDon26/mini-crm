// Пустой текст по тем же правилам, что в базе (раздел 3.1 «Обязательные значения»). Без импортов через
// `@/`, чтобы модуль работал в node:test.

/**
 * Пробельные символы — ровно набор функции базы private.has_text: форма не должна пропускать то, от
 * чего база откажется. Совпадение с последней миграцией проверяет tests/unit/text.test.ts.
 */
export const BLANK_CHARACTERS = String.raw`\u0009-\u000D\u0020\u0085\u00A0\u00AD\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF`;

const HAS_VISIBLE_CHARACTER = new RegExp(`[^${BLANK_CHARACTERS}]`);
const EDGE_BLANKS = new RegExp(`^[${BLANK_CHARACTERS}]+|[${BLANK_CHARACTERS}]+$`, 'g');

/** Есть ли хотя бы один видимый символ. */
export function hasVisibleText(value: string): boolean {
  return HAS_VISIBLE_CHARACTER.test(value);
}

/** Текст без пробельных символов по краям; пустая строка, если видимых символов нет. */
export function normalizeText(value: string): string {
  return value.replace(EDGE_BLANKS, '');
}
