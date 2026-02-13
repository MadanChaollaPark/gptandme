const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { todayKey, isUserSendPayload } = require('./helpers');

describe('todayKey', () => {
  it('returns yyyy-mm-dd format', () => {
    const key = todayKey();
    assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
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

describe('isUserSendPayload', () => {
  it('returns false for null/undefined', () => {
    assert.equal(isUserSendPayload(null), false);
    assert.equal(isUserSendPayload(undefined), false);
  });

  it('returns false for non-"next" actions', () => {
    assert.equal(isUserSendPayload({
      action: 'variant',
      messages: [{ role: 'user', content: 'hello' }],
    }), false);
  });

  it('returns false when messages is not an array', () => {
    assert.equal(isUserSendPayload({ action: 'next', messages: 'hello' }), false);
  });

  it('returns false when no user role message', () => {
    assert.equal(isUserSendPayload({
      action: 'next',
      messages: [{ role: 'assistant', content: 'hi' }],
    }), false);
  });

  it('detects user message with string content', () => {
    assert.equal(isUserSendPayload({
      action: 'next',
      messages: [{ role: 'user', content: 'hello world' }],
    }), true);
  });

  it('detects user message with author.role format', () => {
    assert.equal(isUserSendPayload({
      action: 'next',
      messages: [{ author: { role: 'user' }, content: 'hello' }],
    }), true);
  });

  it('detects user message with input_text array content', () => {
    assert.equal(isUserSendPayload({
      action: 'next',
      messages: [{
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      }],
    }), true);
  });

  it('detects user message with parts content', () => {
    assert.equal(isUserSendPayload({
      action: 'next',
      messages: [{
        role: 'user',
        content: { parts: ['hello world'] },
      }],
    }), true);
  });

  it('rejects empty string content', () => {
    assert.equal(isUserSendPayload({
      action: 'next',
      messages: [{ role: 'user', content: '   ' }],
    }), false);
  });

  it('rejects empty parts', () => {
    assert.equal(isUserSendPayload({
      action: 'next',
      messages: [{ role: 'user', content: { parts: ['  '] } }],
    }), false);
  });

  it('accepts payload without explicit action (defaults to counting)', () => {
    assert.equal(isUserSendPayload({
      messages: [{ role: 'user', content: 'hello' }],
    }), true);
  });
});
