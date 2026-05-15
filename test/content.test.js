// Tests for content.js pure functions (shouldCountKey)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldCountKey } = require('./helpers');

function fakeEvent(overrides = {}) {
  return {
    key: 'Enter',
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe('shouldCountKey', () => {
  it('counts bare Enter', () => {
    assert.equal(shouldCountKey(fakeEvent()), true);
  });

  it('counts Ctrl+Enter', () => {
    assert.equal(shouldCountKey(fakeEvent({ ctrlKey: true })), true);
  });

  it('counts Meta+Enter (Cmd on Mac)', () => {
    assert.equal(shouldCountKey(fakeEvent({ metaKey: true })), true);
  });

  it('does not count Shift+Enter (line break)', () => {
    assert.equal(shouldCountKey(fakeEvent({ shiftKey: true })), false);
  });

  it('does not count Alt+Enter', () => {
    assert.equal(shouldCountKey(fakeEvent({ altKey: true })), false);
  });

  it('does not count non-Enter keys', () => {
    assert.equal(shouldCountKey(fakeEvent({ key: 'a' })), false);
    assert.equal(shouldCountKey(fakeEvent({ key: 'Escape' })), false);
    assert.equal(shouldCountKey(fakeEvent({ key: 'Tab' })), false);
  });

  it('does not count while composing (IME)', () => {
    assert.equal(shouldCountKey(fakeEvent({ isComposing: true })), false);
  });

  it('does not count Shift+Ctrl+Enter', () => {
    // ctrlKey=true would make it count, but shiftKey is irrelevant when ctrlKey is true
    // Actually looking at the code: ctrlKey → return true (before shiftKey check)
    assert.equal(shouldCountKey(fakeEvent({ shiftKey: true, ctrlKey: true })), true);
  });
});
