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

  it('includes grok.com', () => {
    assert.ok('grok.com' in SITES);
  });

  it('maps grok.com to the canonical Grok provider', () => {
    assert.deepEqual(SITES['grok.com'].hosts, ['grok.com']);
    assert.equal(SITES['grok.com'].provider, 'grok');
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

  it('counts ChatGPT sends from network requests instead of DOM key events', () => {
    assert.equal(SITES['chatgpt.com'].countViaNetwork, true);
    assert.equal(SITES['chat.openai.com'].countViaNetwork, true);
  });

  it('keeps a DOM fallback enabled for ChatGPT UI sends', () => {
    assert.equal(SITES['chatgpt.com'].domFallback, true);
    assert.equal(SITES['chat.openai.com'].domFallback, true);
  });

  it('keeps DOM counting enabled for sites without network payload detection', () => {
    assert.equal(Boolean(SITES['claude.ai'].countViaNetwork), false);
    assert.equal(Boolean(SITES['gemini.google.com'].countViaNetwork), false);
    assert.equal(Boolean(SITES['www.perplexity.ai'].countViaNetwork), false);
    assert.equal(Boolean(SITES['grok.com'].countViaNetwork), false);
  });

  it('counts Grok sends via the page-context interceptor with a DOM fallback', () => {
    assert.equal(SITES['grok.com'].countViaPageNetwork, true);
    assert.equal(SITES['grok.com'].domFallback, true);
  });
});
