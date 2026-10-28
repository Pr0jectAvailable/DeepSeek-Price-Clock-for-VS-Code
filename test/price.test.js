'use strict';
const assert = require('assert');
const { createSchedule } = require('../src/price');

const s = createSchedule();
const utc = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);

// 2026-10-28 — среда, не праздник
assert.strictEqual(s.isPeak(utc(2026, 10, 28, 0, 59)), false, '00:59 off-peak');
assert.strictEqual(s.isPeak(utc(2026, 10, 28, 1, 0)), true, '01:00 peak начинается');
assert.strictEqual(s.isPeak(utc(2026, 10, 28, 3, 59)), true, '03:59 peak');
assert.strictEqual(s.isPeak(utc(2026, 10, 28, 4, 0)), false, '04:00 off-peak');
assert.strictEqual(s.isPeak(utc(2026, 10, 28, 5, 59)), false, '05:59 off-peak');
assert.strictEqual(s.isPeak(utc(2026, 10, 28, 6, 0)), true, '06:00 peak');
assert.strictEqual(s.isPeak(utc(2026, 10, 28, 9, 59)), true, '09:59 peak');
assert.strictEqual(s.isPeak(utc(2026, 10, 28, 10, 0)), false, '10:00 off-peak');

// выходные — off-peak весь день (2026-10-31 — суббота)
assert.strictEqual(s.isPeak(utc(2026, 10, 31, 2, 0)), false, 'суббота');
assert.strictEqual(s.isPeak(utc(2026, 11, 1, 7, 0)), false, 'воскресенье');

// праздник (Национальный день, 2026-10-01 — четверг) — off-peak
assert.strictEqual(s.isPeak(utc(2026, 10, 1, 7, 0)), false, 'праздник');
assert.strictEqual(s.isPeak(utc(2026, 10, 8, 7, 0)), true, 'после праздника, четверг — пик');

// extraOffPeakDates
const s2 = createSchedule({ extraOffPeakDates: ['2026-10-28'] });
assert.strictEqual(s2.isPeak(utc(2026, 10, 28, 2, 0)), false, 'extra date');

// ближайшие смены в среду 00:30 UTC: 01:00 → пик, 04:00 → off, 06:00 → пик, 10:00 → off
const t = s.transitions(utc(2026, 10, 28, 0, 30), 4);
assert.deepStrictEqual(
  t.map((x) => [new Date(x.t).toISOString().slice(0, 16), x.peak]),
  [
    ['2026-10-28T01:00', true],
    ['2026-10-28T04:00', false],
    ['2026-10-28T06:00', true],
    ['2026-10-28T10:00', false],
  ],
);

// в пятницу после 10:00 следующая смена — понедельник 01:00 UTC
const fri = s.state(utc(2026, 10, 30, 11, 0));
assert.strictEqual(fri.peak, false);
assert.strictEqual(new Date(fri.nextChange).toISOString(), '2026-11-02T01:00:00.000Z');

// перед праздником: 2026-09-24 (четверг) 11:00 → следующий пик 2026-09-28 01:00 (пн)
const pre = s.state(utc(2026, 9, 24, 11, 0));
assert.strictEqual(new Date(pre.nextChange).toISOString(), '2026-09-28T01:00:00.000Z');

// сегменты: 96 шагов по 15 минут, 7 пиковых часов = 28 шагов
const seg = s.segments(utc(2026, 10, 28), utc(2026, 10, 29));
assert.strictEqual(seg.length, 96);
assert.strictEqual(seg.filter(Boolean).length, 28);

console.log('price.test.js: все проверки пройдены');
