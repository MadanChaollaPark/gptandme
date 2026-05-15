// Tests for hourKey (feat/hourly-heatmap background.js)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { todayKey, hourKey } = require('./helpers');

describe('todayKey', () => {
  it('returns yyyy-mm-dd format', () => {
    assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches today\'s local date', () => {
    const d = new Date();
    const expected = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
    assert.equal(todayKey(), expected);
  });
});

describe('hourKey', () => {
  it('returns yyyy-mm-dd-hh format', () => {
    assert.match(hourKey(), /^\d{4}-\d{2}-\d{2}-\d{2}$/);
  });

  it('starts with todayKey', () => {
    assert.ok(hourKey().startsWith(todayKey()));
  });

  it('ends with current hour zero-padded', () => {
    const h = String(new Date().getHours()).padStart(2, '0');
    assert.ok(hourKey().endsWith(`-${h}`));
  });
});
