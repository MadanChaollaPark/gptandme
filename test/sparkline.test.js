// Tests for feat/sparkline-chart
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getRecentDays, todayKey } = require('./helpers');

function dateKey(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('getRecentDays', () => {
  it('returns array of n zeros for empty byDate', () => {
    const result = getRecentDays({}, 7);
    assert.equal(result.length, 7);
    assert.deepEqual(result, [0, 0, 0, 0, 0, 0, 0]);
  });

  it('returns single-element array for n=1', () => {
    const byDate = { [dateKey(0)]: 5 };
    assert.deepEqual(getRecentDays(byDate, 1), [5]);
  });

  it('places today at the end of the array', () => {
    const byDate = { [dateKey(0)]: 10 };
    const result = getRecentDays(byDate, 3);
    assert.equal(result[2], 10);
    assert.equal(result[0], 0);
    assert.equal(result[1], 0);
  });

  it('fills in correct values for consecutive days', () => {
    const byDate = {
      [dateKey(0)]: 3,
      [dateKey(1)]: 2,
      [dateKey(2)]: 1,
    };
    const result = getRecentDays(byDate, 3);
    assert.deepEqual(result, [1, 2, 3]); // oldest to newest
  });

  it('returns 0 for missing days in the range', () => {
    const byDate = {
      [dateKey(0)]: 5,
      [dateKey(4)]: 8,
    };
    const result = getRecentDays(byDate, 5);
    assert.deepEqual(result, [8, 0, 0, 0, 5]);
  });

  it('handles n=30', () => {
    const result = getRecentDays({}, 30);
    assert.equal(result.length, 30);
  });
});
