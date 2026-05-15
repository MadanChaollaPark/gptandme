// Tests for feat/weekly-monthly-totals
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getWeekTotal, getMonthTotal, todayKey } = require('./helpers');

function makeKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

describe('getWeekTotal', () => {
  it('returns 0 for empty byDate', () => {
    assert.equal(getWeekTotal({}), 0);
  });

  it('sums today if today is in the current week', () => {
    const byDate = { [todayKey()]: 7 };
    assert.equal(getWeekTotal(byDate), 7);
  });

  it('does not include dates outside current week', () => {
    // Create a date far in the past
    const byDate = { '2020-01-01': 99, [todayKey()]: 3 };
    assert.equal(getWeekTotal(byDate), 3);
  });

  it('sums multiple days within the same week', () => {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));

    const byDate = {};
    let expectedSum = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = makeKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
      byDate[key] = i + 1;
      expectedSum += i + 1;
    }
    assert.equal(getWeekTotal(byDate), expectedSum);
  });
});

describe('getMonthTotal', () => {
  it('returns 0 for empty byDate', () => {
    assert.equal(getMonthTotal({}), 0);
  });

  it('sums today if today is in the current month', () => {
    const byDate = { [todayKey()]: 12 };
    assert.equal(getMonthTotal(byDate), 12);
  });

  it('does not include dates from other months', () => {
    const byDate = { '2020-06-15': 50, [todayKey()]: 4 };
    assert.equal(getMonthTotal(byDate), 4);
  });

  it('sums all days in current month', () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const byDate = {};
    for (let i = 1; i <= daysInMonth; i++) {
      byDate[makeKey(year, month + 1, i)] = 1;
    }
    assert.equal(getMonthTotal(byDate), daysInMonth);
  });
});
