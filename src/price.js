'use strict';

/**
 * Логика окон цен DeepSeek API (без зависимостей от VS Code, чтобы её можно было тестировать в Node).
 *
 * Правило из официального сноски на странице цен:
 *   Пик: 01:00–04:00 и 06:00–10:00 UTC, понедельник–пятница, кроме государственных
 *   праздников Китая. Всё остальное время (включая выходные и праздники целиком) — off-peak,
 *   цена off-peak ровно вдвое ниже пиковой.
 *
 * День недели и праздники считаются по пекинскому времени (UTC+8), как в оригинальном
 * расширении для Chrome. Пиковые часы 01:00–10:00 UTC — это 09:00–18:00 по Пекину,
 * то есть одна и та же дата в обоих поясах.
 */

const PEAK_WINDOWS_MIN = [
  [1 * 60, 4 * 60],
  [6 * 60, 10 * 60],
];

// Государственные праздники Китая (включительно). ПРОВЕРЬТЕ и обновляйте раз в год
// (график на следующий год Госсовет КНР обычно публикует в ноябре).
// Можно не править код, а добавлять даты в настройку deepseekPriceClock.extraOffPeakDates.
// Даты — по пекинскому календарю (как в оригинальном price.js расширения для Chrome).
const CN_HOLIDAY_RANGES = [
  ['2026-09-25', '2026-09-27'], // Праздник середины осени
  ['2026-10-01', '2026-10-07'], // Национальный день
];

// Правило «выходные и праздники — off-peak весь день» действует с 00:00 по Пекину
// в воскресенье 23 августа 2026 (16:00 UTC в субботу 22 августа). До этого момента
// выходные тарифицировались как обычные дни.
const WEEKEND_RULE_START = Date.UTC(2026, 7, 22, 16);

const BEIJING_OFFSET_MS = 8 * 3600000;

// Цены в USD за 1M токенов в ПИК. Off-peak = ровно половина.
// Сверяйте с https://api-docs.deepseek.com/quick_start/pricing — цены менялись уже не раз.
const RATES = [
  { model: 'DeepSeek-V4.1-Flash', input: 0.3, cached: 0.006, output: 1.2 },
  { model: 'DeepSeek-V4-Pro', input: 1.32, cached: 0.044, output: 3.96 },
];

const DAY_MS = 86400000;
const CANDIDATE_HOURS = [0, 1, 4, 6, 10];

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKeyUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function expandRange(startKey, endKey) {
  const out = [];
  const [sy, sm, sd] = startKey.split('-').map(Number);
  const [ey, em, ed] = endKey.split('-').map(Number);
  for (let t = Date.UTC(sy, sm - 1, sd); t <= Date.UTC(ey, em - 1, ed); t += DAY_MS) {
    out.push(dateKeyUTC(t));
  }
  return out;
}

function createSchedule(options = {}) {
  const holidays = new Set();
  for (const [a, b] of CN_HOLIDAY_RANGES) expandRange(a, b).forEach((k) => holidays.add(k));
  for (const k of options.extraOffPeakDates || []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) holidays.add(k);
  }

  /** true, если в момент ms действует пиковая цена */
  function isPeak(ms) {
    if (ms >= WEEKEND_RULE_START) {
      const bj = ms + BEIJING_OFFSET_MS; // «сдвинутое» время: UTC-поля = пекинские
      const dow = new Date(bj).getUTCDay(); // 0 = вс, 6 = сб (по Пекину)
      if (dow === 0 || dow === 6) return false;
      if (holidays.has(dateKeyUTC(bj))) return false;
    }
    const d = new Date(ms);
    const min = d.getUTCHours() * 60 + d.getUTCMinutes();
    return PEAK_WINDOWS_MIN.some(([a, b]) => min >= a && min < b);
  }

  /** Ближайшие смены состояния после fromMs: [{ t, peak }] — peak это НОВОЕ состояние. */
  function transitions(fromMs, count, maxDays = 60) {
    const out = [];
    const day0 = Math.floor(fromMs / DAY_MS) * DAY_MS;
    let prev = isPeak(fromMs);
    for (let i = 0; i <= maxDays && out.length < count; i++) {
      for (const h of CANDIDATE_HOURS) {
        const t = day0 + i * DAY_MS + h * 3600000;
        if (t <= fromMs) continue;
        const s = isPeak(t);
        if (s !== prev) {
          out.push({ t, peak: s });
          prev = s;
          if (out.length >= count) break;
        }
      }
    }
    return out;
  }

  function state(ms) {
    const peak = isPeak(ms);
    const next = transitions(ms, 1)[0] || null;
    return { peak, nextChange: next ? next.t : null };
  }

  /** Массив boolean (true = пик) по шагам stepMin с момента startMs до endMs. */
  function segments(startMs, endMs, stepMin = 15) {
    const step = stepMin * 60000;
    const n = Math.max(1, Math.round((endMs - startMs) / step));
    const out = [];
    for (let i = 0; i < n; i++) out.push(isPeak(startMs + i * step));
    return out;
  }

  return { isPeak, transitions, state, segments };
}

module.exports = { createSchedule, RATES, CN_HOLIDAY_RANGES, PEAK_WINDOWS_MIN };
