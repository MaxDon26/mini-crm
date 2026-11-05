import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as R from '../../src/features/objects/objectRules.ts';

describe('objectRules', () => {
  it('пустые и невидимые значения: обе ошибки', () => {
    const invisible = String.fromCharCode(0x200b, 0xad, 0x200d);
    assert.deepEqual(R.validateObjectForm({ name: '  ', address: invisible }), {
      name: 'Укажите название',
      address: 'Укажите адрес',
    });
  });

  it('длина считается по символам после обрезки краёв', () => {
    assert.deepEqual(
      R.validateObjectForm({ name: ` ${'я'.repeat(200)} `, address: 'а'.repeat(300) }),
      {},
    );
    assert.deepEqual(R.validateObjectForm({ name: 'я'.repeat(201), address: 'а'.repeat(301) }), {
      name: 'Не больше 200 знаков',
      address: 'Не больше 300 знаков',
    });
    // Эмодзи — один символ, хотя в UTF-16 занимает два.
    assert.deepEqual(R.validateObjectForm({ name: '😀'.repeat(200), address: 'адрес' }), {});
  });

  it('значения для отправки без пробелов по краям', () => {
    assert.deepEqual(R.normalizeObjectFields({ name: ' Дом \n', address: '\tУлица ' }), {
      name: 'Дом',
      address: 'Улица',
    });
  });

  it('изменённые поля: только отличающиеся после обрезки', () => {
    const initial = { name: 'Дом ', address: 'Улица' };
    assert.deepEqual(R.pickObjectChanges(initial, { name: ' Дом', address: 'Улица' }), {});
    assert.deepEqual(R.pickObjectChanges(initial, { name: 'Дом', address: ' Проспект ' }), {
      address: 'Проспект',
    });
    assert.deepEqual(R.pickObjectChanges(initial, { name: 'Склад', address: 'Шоссе' }), {
      name: 'Склад',
      address: 'Шоссе',
    });
  });
});
