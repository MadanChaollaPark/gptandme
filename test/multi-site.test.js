// Tests for feature/multi-site-support
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SITES } = require('./helpers');

describe('SITES config', () => {
  it('includes chatgpt.com', () => {
    assert.ok('chatgpt.com' in SITES);
  });

  it('includes chat.openai.com', () => {
    assert.ok('chat.openai.com' in SITES);
  });

  it('includes claude.ai', () => {
    assert.ok('claude.ai' in SITES);
  });

  it('includes gemini.google.com', () => {
    assert.ok('gemini.google.com' in SITES);
  });

  it('includes www.perplexity.ai', () => {
    assert.ok('www.perplexity.ai' in SITES);
  });

  it('every site has a non-empty sendButtons array', () => {
    for (const [site, config] of Object.entries(SITES)) {
      assert.ok(Array.isArray(config.sendButtons), `${site} sendButtons should be array`);
      assert.ok(config.sendButtons.length > 0, `${site} should have at least one selector`);
    }
  });

  it('all selectors are non-empty strings', () => {
    for (const [site, config] of Object.entries(SITES)) {
      for (const sel of config.sendButtons) {
        assert.ok(typeof sel === 'string' && sel.length > 0, `${site} has empty selector`);
      }
    }
  });

  it('chatgpt.com and chat.openai.com have matching selectors', () => {
    assert.deepEqual(SITES['chatgpt.com'].sendButtons, SITES['chat.openai.com'].sendButtons);
  });
});
