// Tests for feat/streak-counter
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getStreak, todayKey } = require('./helpers');

function dateKey(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('getStreak', () => {
  it('returns 0 for empty byDate', () => {
    assert.equal(getStreak({}), 0);
  });

  it('returns 0 when today has no prompts', () => {
    assert.equal(getStreak({ '2020-01-01': 5 }), 0);
  });

  it('returns 1 when only today has prompts', () => {
    const byDate = { [dateKey(0)]: 3 };
    assert.equal(getStreak(byDate), 1);
  });

  it('counts consecutive days including today', () => {
    const byDate = {
      [dateKey(0)]: 2,
      [dateKey(1)]: 5,
      [dateKey(2)]: 1,
    };
    assert.equal(getStreak(byDate), 3);
  });

  it('breaks streak on gap day', () => {
    const byDate = {
      [dateKey(0)]: 2,
      [dateKey(1)]: 5,
      // gap at dateKey(2)
      [dateKey(3)]: 1,
    };
    assert.equal(getStreak(byDate), 2);
  });

  it('does not count days with zero prompts', () => {
    const byDate = {
      [dateKey(0)]: 3,
      [dateKey(1)]: 0,
    };
    assert.equal(getStreak(byDate), 1);
  });

  it('handles long streak', () => {
    const byDate = {};
    for (let i = 0; i < 30; i++) {
      byDate[dateKey(i)] = i + 1;
    }
    assert.equal(getStreak(byDate), 30);
  });
});
