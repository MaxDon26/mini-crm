import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as T from '../../src/shared/text.ts';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);

/** Набор пробельных символов из последней миграции, которая задаёт private.has_text. */
function databaseBlankCharacters(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of files.reverse()) {
    const text = readFileSync(new URL(name, MIGRATIONS), 'utf8');
    const start = text.indexOf('function private.has_text');
    if (start === -1) continue;
    const match = /p_value ~ '\[\^(.*?)\]'/.exec(text.slice(start));
    assert.ok(match?.[1], `в ${name} нет выражения has_text`);
    return match[1];
  }
  throw new Error('миграция с private.has_text не найдена');
}

// Коды из миграции 20261105000007: прежний набор и U+00AD, U+200C, U+200D.
const BLANK_CODES = [
  ...[0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0xad, 0x1680, 0x180e],
  ...Array.from({ length: 0x200d - 0x2000 + 1 }, (_, index) => 0x2000 + index),
  ...[0x2028, 0x2029, 0x202f, 0x205f, 0x2060, 0x3000, 0xfeff],
];

describe('text', () => {
  it('набор пробельных символов совпадает с базой', () => {
    assert.equal(T.BLANK_CHARACTERS, databaseBlankCharacters());
  });

  it('каждый пробельный символ базы: текста нет', () => {
    for (const code of BLANK_CODES) {
      const blank = String.fromCharCode(code);
      assert.equal(T.hasVisibleText(blank), false, code.toString(16));
      assert.equal(T.normalizeText(` ${blank} `), '', code.toString(16));
    }
  });

  it('мягкий перенос и невидимые соединители считаются пробельными', () => {
    const invisible = String.fromCharCode(0xad, 0x200c, 0x200d);
    assert.equal(T.hasVisibleText(invisible), false);
    assert.equal(T.normalizeText(invisible), '');
  });

  it('видимый символ — текст, края обрезаются тем же набором', () => {
    const edge = String.fromCharCode(0x200b, 0xad, 0xa0);
    assert.equal(T.hasVisibleText('я'), true);
    assert.equal(T.normalizeText(`${edge} a b \n${edge}`), 'a b');
    assert.equal(T.normalizeText('  a b \n'), 'a b');
    // Внутри текста символы остаются как есть.
    const inner = `a${String.fromCharCode(0x200d)}b`;
    assert.equal(T.normalizeText(inner), inner);
  });

  it('символ вне набора считается текстом, как и в базе', () => {
    assert.equal(T.hasVisibleText(String.fromCharCode(0x200e)), true);
  });
});
