// Tests for feat/hourly-heatmap
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildHeatmapGrid, getHeatmapColor } = require('./helpers');

describe('buildHeatmapGrid', () => {
  it('returns 7x24 grid of zeros for empty input', () => {
    const grid = buildHeatmapGrid({});
    assert.equal(grid.length, 7);
    for (const row of grid) {
      assert.equal(row.length, 24);
      assert.deepEqual(row, Array(24).fill(0));
    }
  });

  it('places counts in correct day-of-week and hour slot', () => {
    // 2026-02-16 is a Monday (dow=0 in Mon-based grid)
    const byHour = { '2026-02-16-09': 5 };
    const grid = buildHeatmapGrid(byHour);
    assert.equal(grid[0][9], 5); // Monday, hour 9
  });

  it('accumulates counts for same dow/hour across different weeks', () => {
    // 2026-02-16 and 2026-02-23 are both Mondays
    const byHour = {
      '2026-02-16-14': 3,
      '2026-02-23-14': 7,
    };
    const grid = buildHeatmapGrid(byHour);
    assert.equal(grid[0][14], 10); // Monday hour 14, accumulated
  });

  it('ignores malformed keys', () => {
    const byHour = {
      'bad-key': 10,
      '2026-02-16': 5, // only 3 parts, not 4
      '2026-02-16-09': 2,
    };
    const grid = buildHeatmapGrid(byHour);
    assert.equal(grid[0][9], 2);
    // bad keys should not appear anywhere
    const total = grid.flat().reduce((a, b) => a + b, 0);
    assert.equal(total, 2);
  });

  it('maps Sunday correctly (dow=6)', () => {
    // 2026-02-22 is a Sunday
    const byHour = { '2026-02-22-23': 4 };
    const grid = buildHeatmapGrid(byHour);
    assert.equal(grid[6][23], 4); // Sunday, hour 23
  });
});

describe('getHeatmapColor', () => {
  it('returns grey for zero', () => {
    assert.equal(getHeatmapColor(0, 10), '#ebedf0');
  });

  it('returns lightest green for low ratio (<=0.25)', () => {
    assert.equal(getHeatmapColor(1, 10), '#9be9a8');
    assert.equal(getHeatmapColor(25, 100), '#9be9a8');
  });

  it('returns medium green for ratio 0.25-0.50', () => {
    assert.equal(getHeatmapColor(3, 10), '#40c463');
    assert.equal(getHeatmapColor(50, 100), '#40c463');
  });

  it('returns dark green for ratio 0.50-0.75', () => {
    assert.equal(getHeatmapColor(6, 10), '#30a14e');
    assert.equal(getHeatmapColor(75, 100), '#30a14e');
  });

  it('returns darkest green for ratio >0.75', () => {
    assert.equal(getHeatmapColor(8, 10), '#216e39');
    assert.equal(getHeatmapColor(10, 10), '#216e39');
  });

  it('returns lightest green when value equals max and max is 1', () => {
    // ratio = 1/1 = 1.0 > 0.75 → darkest
    assert.equal(getHeatmapColor(1, 1), '#216e39');
  });
});
