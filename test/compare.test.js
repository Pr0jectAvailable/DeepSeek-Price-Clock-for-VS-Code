'use strict';
// Сверка с оригинальным price.js из расширения для Chrome (test/reference-price.js).
const assert = require('assert');
const ref = require('./reference-price');
const { createSchedule } = require('../src/price');
const s = createSchedule();

const from = Date.UTC(2026, 7, 16);   // старт пик/off-peak тарификации
const to = Date.UTC(2026, 11, 31);
let checked = 0;
for (let t = from; t < to; t += 5 * 60000) {
  const expected = ref.kindAtInstant(new Date(t)) === 'peak';
  assert.strictEqual(s.isPeak(t), expected, 'isPeak расходится в ' + new Date(t).toISOString());
  checked++;
}
// ближайшие смены из разных точек
for (let t = Date.UTC(2026, 9, 20); t < Date.UTC(2026, 10, 15); t += 37 * 60000) {
  const a = ref.nextSwitches(new Date(t), 6).map((x) => x.date.getTime());
  const b = s.transitions(t, 6).map((x) => x.t);
  assert.deepStrictEqual(b, a, 'transitions расходится от ' + new Date(t).toISOString());
}
console.log('compare.test.js: совпадает с оригиналом (%d точек + смены)', checked);
