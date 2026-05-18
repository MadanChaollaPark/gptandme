const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { todayKey, isChatGptPromptEndpoint, isUserSendPayload } = require('./helpers');

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

  it('detects user message with object parts content', () => {
    assert.equal(isUserSendPayload({
      action: 'next',
      messages: [{
        role: 'user',
        content: {
          parts: [{ content_type: 'text', text: 'hello world' }],
        },
      }],
    }), true);
  });

  it('detects singular message payloads', () => {
    assert.equal(isUserSendPayload({
      action: 'next',
      message: {
        author: { role: 'user' },
        content: { parts: ['hello'] },
      },
    }), true);
  });

  it('detects responses-style input strings', () => {
    assert.equal(isUserSendPayload({
      input: 'hello world',
    }), true);
  });

  it('detects responses-style user input arrays', () => {
    assert.equal(isUserSendPayload({
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: 'hello world' }],
      }],
    }), true);
  });

  it('detects attachment-only user messages', () => {
    assert.equal(isUserSendPayload({
      action: 'next',
      messages: [{
        author: { role: 'user' },
        content: {
          parts: [{ type: 'input_file', file_id: 'file-123' }],
        },
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

  it('rejects responses-style assistant input arrays', () => {
    assert.equal(isUserSendPayload({
      input: [{
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hello world' }],
      }],
    }), false);
  });
});

describe('isChatGptPromptEndpoint', () => {
  it('detects legacy conversation endpoints', () => {
    assert.equal(
      isChatGptPromptEndpoint('https://chatgpt.com/backend-api/conversation'),
      true
    );
  });

  it('detects prefixed conversation endpoints', () => {
    assert.equal(
      isChatGptPromptEndpoint('https://chatgpt.com/backend-api/f/conversation'),
      true
    );
  });

  it('detects responses endpoints', () => {
    assert.equal(
      isChatGptPromptEndpoint('https://chatgpt.com/backend-api/responses'),
      true
    );
  });

  it('rejects conversation list endpoints', () => {
    assert.equal(
      isChatGptPromptEndpoint('https://chatgpt.com/backend-api/conversations'),
      false
    );
  });

  it('rejects non-backend endpoints', () => {
    assert.equal(
      isChatGptPromptEndpoint('https://chatgpt.com/api/conversation'),
      false
    );
  });
});
