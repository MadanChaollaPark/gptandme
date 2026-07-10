const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shared = require('../shared');
const manifest = require('../manifest.json');
const packageJson = require('../package.json');

const ROOT = path.resolve(__dirname, '..');

const PROVIDER_ORDER = [
  'chatgpt',
  'claude',
  'gemini',
  'perplexity',
  'grok',
  'unknown',
];

const HOSTS = Object.freeze({
  'chat.openai.com': { provider: 'chatgpt', mainWorld: true },
  'chatgpt.com': { provider: 'chatgpt', mainWorld: true },
  'claude.ai': { provider: 'claude', mainWorld: true },
  'gemini.google.com': { provider: 'gemini', mainWorld: false },
  'grok.com': { provider: 'grok', mainWorld: true },
  'perplexity.ai': { provider: 'perplexity', mainWorld: true },
  'www.perplexity.ai': { provider: 'perplexity', mainWorld: true },
});

const PACKAGE_FILES = [
  'manifest.json',
  'shared.js',
  'background.js',
  'content.js',
  'inject.js',
  'popup.html',
  'popup.js',
  'privacy.html',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

function sorted(values) {
  return [...values].sort();
}

function matchPattern(host) {
  return `*://${host}/*`;
}

function contentScript(predicate, description) {
  const matches = manifest.content_scripts.filter(predicate);
  assert.equal(matches.length, 1, `expected exactly one ${description} content script`);
  return matches[0];
}

function parseShellFiles(source) {
  const match = /(?:^|\n)FILES=\(\n([\s\S]*?)\n\)/.exec(source);
  assert.ok(match, 'shell script must declare a FILES=(...) inventory');
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^['"]|['"]$/g, ''));
}

function parsePopupProviderOrder(source) {
  const match = /const providerOrder = \[([\s\S]*?)\];/.exec(source);
  assert.ok(match, 'popup must declare providerOrder');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

describe('extension provider manifest contract', () => {
  it('keeps canonical providers, host permissions, and site aliases aligned', () => {
    assert.deepEqual(sorted(Object.keys(shared.PROVIDERS)), sorted(PROVIDER_ORDER));

    const expectedHosts = Object.keys(HOSTS);
    assert.deepEqual(
      sorted(manifest.host_permissions),
      sorted(expectedHosts.map(matchPattern))
    );

    const configuredHosts = Object.values(shared.SITES)
      .flatMap((site) => site.hosts || []);
    assert.deepEqual(sorted(configuredHosts), sorted(expectedHosts));
    assert.equal(new Set(configuredHosts).size, configuredHosts.length);

    for (const [host, expected] of Object.entries(HOSTS)) {
      assert.equal(shared.providerForHost(host), expected.provider, host);
      assert.equal(shared.normalizeProviderId(host), expected.provider, host);

      const site = shared.siteConfigForHost(host);
      assert.ok(site, `${host} must have a SITES entry`);
      assert.equal(site.config.provider, expected.provider, host);
      assert.ok(site.config.hosts.includes(host), host);
      assert.ok(shared.PROVIDERS[expected.provider], `${expected.provider} must be canonical`);
    }
  });

  it('injects isolated scripts on every host and MAIN interception where required', () => {
    const expectedHosts = Object.keys(HOSTS);
    const expectedMainHosts = expectedHosts.filter((host) => HOSTS[host].mainWorld);
    assert.equal(manifest.content_scripts.length, 2);

    const main = contentScript(
      (entry) => entry.world === 'MAIN',
      'MAIN-world'
    );
    assert.deepEqual(main.js, ['inject.js']);
    assert.equal(main.run_at, 'document_start');
    assert.deepEqual(sorted(main.matches), sorted(expectedMainHosts.map(matchPattern)));

    const isolated = contentScript(
      (entry) => entry.world !== 'MAIN' && entry.js?.includes('content.js'),
      'isolated-world'
    );
    assert.deepEqual(isolated.js, ['shared.js', 'content.js']);
    assert.equal(isolated.run_at, 'document_end');
    assert.deepEqual(sorted(isolated.matches), sorted(expectedHosts.map(matchPattern)));

    for (const [host, expected] of Object.entries(HOSTS)) {
      const site = shared.siteConfigForHost(host).config;
      const networkInstrumented = Boolean(site.countViaNetwork || site.countViaPageNetwork);
      assert.equal(networkInstrumented, expected.mainWorld, host);
    }
  });

  it('keeps the popup provider order complete and deterministic', () => {
    const popupSource = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
    const popupOrder = parsePopupProviderOrder(popupSource);

    assert.deepEqual(popupOrder, PROVIDER_ORDER);
    assert.deepEqual(new Set(popupOrder).size, popupOrder.length);
    assert.equal(popupOrder.at(-1), 'unknown');
    assert.ok(popupOrder.includes('grok'));
  });

  it('keeps build, verification, manifest, and package versions in sync', () => {
    const buildSource = fs.readFileSync(path.join(ROOT, 'build.sh'), 'utf8');
    const verifySource = fs.readFileSync(
      path.join(ROOT, 'scripts', 'verify-package.sh'),
      'utf8'
    );

    assert.deepEqual(parseShellFiles(buildSource), PACKAGE_FILES);
    assert.deepEqual(parseShellFiles(verifySource), PACKAGE_FILES);
    assert.equal(manifest.version, packageJson.version);

    const manifestRuntimeFiles = [
      manifest.background?.service_worker,
      manifest.action?.default_popup,
      ...Object.values(manifest.icons || {}),
      ...manifest.content_scripts.flatMap((entry) => entry.js || []),
    ].filter(Boolean);
    for (const file of manifestRuntimeFiles) {
      assert.ok(PACKAGE_FILES.includes(file), `${file} must be packaged`);
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} must exist`);
    }

    assert.match(verifySource, /PACKAGE_VERSION=/);
    assert.match(verifySource, /MANIFEST_VERSION=/);
    assert.match(verifySource, /PACKAGE_VERSION[^\n]*!=[^\n]*MANIFEST_VERSION/);
  });
});
