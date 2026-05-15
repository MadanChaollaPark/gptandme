// Tests for feat/session-tracking
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getSessionStats } = require('./helpers');

describe('getSessionStats', () => {
  it('returns zeros for empty sessions', () => {
    assert.deepEqual(getSessionStats({}), { count: 0, avg: 0, max: 0 });
  });

  it('ignores sessions with 0 prompts', () => {
    const sessions = {
      's-1': { prompts: 0, site: 'chatgpt.com' },
      's-2': { prompts: 0, site: 'chatgpt.com' },
    };
    assert.deepEqual(getSessionStats(sessions), { count: 0, avg: 0, max: 0 });
  });

  it('counts a single active session', () => {
    const sessions = {
      's-1': { prompts: 5, site: 'chatgpt.com' },
    };
    assert.deepEqual(getSessionStats(sessions), { count: 1, avg: 5, max: 5 });
  });

  it('computes correct avg and max for multiple sessions', () => {
    const sessions = {
      's-1': { prompts: 10 },
      's-2': { prompts: 20 },
      's-3': { prompts: 30 },
    };
    const stats = getSessionStats(sessions);
    assert.equal(stats.count, 3);
    assert.equal(stats.avg, 20);
    assert.equal(stats.max, 30);
  });

  it('excludes zero-prompt sessions from avg calculation', () => {
    const sessions = {
      's-1': { prompts: 0 },
      's-2': { prompts: 6 },
      's-3': { prompts: 4 },
    };
    const stats = getSessionStats(sessions);
    assert.equal(stats.count, 2);
    assert.equal(stats.avg, 5); // (6+4)/2
    assert.equal(stats.max, 6);
  });

  it('rounds avg to one decimal place', () => {
    const sessions = {
      's-1': { prompts: 1 },
      's-2': { prompts: 2 },
      's-3': { prompts: 3 },
    };
    const stats = getSessionStats(sessions);
    assert.equal(stats.avg, 2); // 6/3 = 2.0
  });

  it('rounds avg correctly for non-integer results', () => {
    const sessions = {
      's-1': { prompts: 1 },
      's-2': { prompts: 2 },
    };
    const stats = getSessionStats(sessions);
    assert.equal(stats.avg, 1.5); // 3/2 = 1.5
  });
});
