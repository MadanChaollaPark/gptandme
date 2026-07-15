import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sorted(values) {
  return [...values].sort();
}

function assertSameValues(actual, expected, label) {
  assert(
    JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected)),
    `${label} mismatch: expected ${JSON.stringify(sorted(expected))}, got ${JSON.stringify(sorted(actual))}`
  );
}

function assertMatches(source, pattern, label) {
  assert(pattern.test(source), label);
}

function assertIncludes(source, needle, label) {
  assert(source.includes(needle), label || `expected source to include ${needle}`);
}

function assertNotIncludes(source, needle, label) {
  assert(!source.includes(needle), label || `expected source not to include ${needle}`);
}

const manifest = readJson('manifest.json');
const packageJson = readJson('package.json');
const version = manifest.version;
const targetVersion = '1.5.0';
const contentMatches = manifest.content_scripts.flatMap((entry) => entry.matches || []);
const background = read('background.js');
const content = read('content.js');
const inject = read('inject.js');
const popup = read('popup.js');
const shared = read('shared.js');

assert(version === packageJson.version, 'manifest and package versions must match');
assert(version === targetVersion, `release target must be ${targetVersion}`);
assert(manifest.incognito === 'not_allowed', 'incognito must remain explicitly not_allowed');
assertSameValues(
  manifest.permissions || [],
  ['activeTab', 'alarms', 'scripting', 'storage', 'webRequest'],
  'named permissions'
);
assertSameValues(
  manifest.host_permissions || [],
  ['https://chat.openai.com/*', 'https://chatgpt.com/*'],
  'webRequest host permissions'
);
assertSameValues(
  manifest.optional_host_permissions || [],
  ['https://grok.com/*'],
  'optional Grok host permission'
);
assert(contentMatches.length > 0, 'manifest must declare content-script matches');
assert(
  contentMatches.every((pattern) => pattern.startsWith('https://')),
  'all content-script matches must be HTTPS-only'
);
assert(
  !contentMatches.includes('https://grok.com/*'),
  'Grok must not be a required static content-script match'
);

for (const needle of [
  'gptandme-grok-main',
  'gptandme-grok-isolated',
  'registerContentScripts',
  "world: 'MAIN'",
]) {
  assert(background.includes(needle), `background must configure optional Grok scripts: ${needle}`);
}

const privacy = read('privacy.html');
const publicPrivacy = read('docs/privacy.html');
assert(privacy === publicPrivacy, 'privacy.html and docs/privacy.html must be byte-for-byte identical');

const versionContracts = [
  ['README.md', `GPTandME ${version} requires`],
  ['docs/index.html', `version ${version}`],
  ['docs/privacy.html', `Version ${version}`],
  ['docs/support.html', `version ${version}`],
];
for (const [file, needle] of versionContracts) {
  assert(read(file).includes(needle), `${file} must contain current version text: ${needle}`);
}

const thinkingDocs = [
  'provider-reported',
  'ChatGPT',
  'CSV',
  'JSON backup',
];
for (const file of ['README.md', 'privacy.html', 'docs/index.html', 'docs/support.html', 'docs/release-checklist.md']) {
  const source = read(file);
  for (const needle of thinkingDocs) {
    assertIncludes(source, needle, `${file} must disclose v1.5.0 thinking-time contract: ${needle}`);
  }
  assertMatches(
    source,
    /thinking[- ]time|timing aggregates|timing label|average thinking time/i,
    `${file} must disclose thinking-time behavior`
  );
  assertMatches(
    source,
    /new (?:ChatGPT )?responses|new responses|after (?:the user|you) sends?|after you send/i,
    `${file} must disclose that thinking time is for new responses after a user send`
  );
  assertMatches(
    source,
    /no historical backfill|does not backfill|not backfilled/i,
    `${file} must disclose no historical backfill`
  );
}

for (const file of ['README.md', 'privacy.html', 'docs/index.html']) {
  const source = read(file);
  for (const needle of ['prompt text', 'response text', 'raw thinking labels', 'raw timing samples']) {
    assertIncludes(source, needle, `${file} must disclose not storing ${needle}`);
  }
}

for (const file of ['README.md', 'privacy.html']) {
  const source = read(file);
  assertIncludes(source, 'Existing permissions are unchanged', `${file} must disclose unchanged permissions`);
}

assertIncludes(
  read('docs/release-checklist.md'),
  'byThinkingProviderModel[YYYY-MM-DD][provider][model] = { reportedCount, totalMs }',
  'release checklist must document the storage v3 thinking aggregate key'
);
assertIncludes(
  read('docs/release-checklist.md'),
  'thinkingMetric',
  'release checklist must document the thinkingMetric runtime message type'
);
assertIncludes(
  read('docs/release-checklist.md'),
  'totalMs / reportedCount',
  'release checklist must document the average calculation'
);

assertIncludes(background, 'const STORAGE_SCHEMA_VERSION = 3', 'storage schema must be v3 for thinking aggregates');
assertIncludes(background, 'const EXPORT_SCHEMA_VERSION = 3', 'JSON export schema must be v3 for thinking aggregates');
assertIncludes(background, 'byThinkingProviderModel: {}', 'storage defaults must include thinking aggregates');
assertIncludes(background, 'recentThinkingEvents: {}', 'storage defaults must include bounded thinking event dedupe');
assertIncludes(background, 'byThinkingProviderModel', 'background must normalize/export thinking aggregates');
assertIncludes(background, 'recentThinkingEvents', 'background must retain thinking event dedupe');
assertIncludes(background, "message.type === 'thinkingMetric'", 'background must handle thinkingMetric messages');
assertIncludes(background, 'supportedSenderContext(sender)', 'background must derive provider from sender context');
assertMatches(
  background,
  /message\.type\s*===\s*['"]thinkingMetric['"][\s\S]{0,3000}supportedSenderContext\(sender\)/,
  'thinkingMetric handler must validate the sender context'
);
assertMatches(
  background,
  /message\.type\s*===\s*['"]thinkingMetric['"][\s\S]{0,1000}parseThinkingMetric\(message,\s*context\)/,
  'thinkingMetric handler must validate payloads against sender context'
);
assertMatches(
  background,
  /function parseThinkingMetric[\s\S]{0,1000}context\.provider\s*!==\s*['"]chatgpt['"]/,
  'thinkingMetric handler must be ChatGPT-only in v1.5.0'
);
assertMatches(
  background,
  /function parseThinkingMetric[\s\S]{0,1000}message\.source\s*!==\s*['"]provider-reported['"]/,
  'thinkingMetric handler must require provider-reported source'
);
assertMatches(
  background,
  /function parseThinkingMetric[\s\S]{0,1000}thinkingMs/,
  'thinkingMetric handler must validate thinkingMs'
);
assertMatches(
  background,
  /const MIN_THINKING_MS\s*=\s*(1000|1\s*\*\s*1000)/,
  'thinkingMetric handler must enforce the 1 second minimum'
);
assertMatches(
  background,
  /const MAX_THINKING_MS\s*=\s*6\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
  'thinkingMetric handler must enforce the 6 hour maximum'
);
assert(
  !/message\.type\s*===\s*['"]thinkingMetric['"][\s\S]{0,3000}message\.provider/.test(background),
  'thinkingMetric handler must not trust a forged provider from the message'
);

assertIncludes(content, "type: 'thinkingMetric'", 'content script must emit thinkingMetric messages');
assertIncludes(content, "source: 'provider-reported'", 'content script must mark thinking metrics as provider-reported');
assertIncludes(content, 'thinkingMs', 'content script must emit thinkingMs');
assertMatches(content, /provider\s*={2,3}\s*['"]chatgpt['"]/, 'content thinking detector must be ChatGPT-only');
assertNotIncludes(inject, 'thinkingMetric', 'thinking metrics must not be emitted from page-world injection');
assertNotIncludes(inject, 'thinkingMs', 'thinking metrics must not use page-world stream/request cloning');
assertIncludes(shared, 'reportedCount', 'shared helpers must expose reported thinking counts');
assertIncludes(shared, 'totalMs', 'shared helpers must expose total thinking milliseconds');
for (const id of [
  'thinkingTodayTotal',
  'thinkingTodayAverage',
  'thinkingAllTimeTotal',
  'thinkingAllTimeAverage',
]) {
  assertIncludes(read('popup.html'), id, `popup must expose thinking-time metric: ${id}`);
}
assert(
  /totalMs\s*\/\s*reportedCount/.test(shared) ||
    /totalMs\s*\/\s*reportedCount/.test(popup) ||
    /totalMs\s*\/\s*reportedCount/.test(background),
  'thinking average must derive from totalMs / reportedCount'
);
assertMatches(
  shared,
  /date,provider,model,count/,
  'CSV header must remain prompt counts only'
);
assertNotIncludes(shared, 'date,provider,model,count,thinking', 'CSV export must not add thinking columns');

for (const file of ['README.md', 'privacy.html', 'docs/index.html', 'docs/support.html']) {
  const source = read(file);
  assert(source.includes('Claude Code'), `${file} must disclose the browser-only Claude Code boundary`);
  assert(source.includes('Incognito'), `${file} must disclose the Incognito boundary`);
  assert(source.includes('JSON backup'), `${file} must disclose complete JSON backup behavior`);
}

for (const file of ['README.md', 'privacy.html', 'docs/support.html']) {
  assert(
    read(file).includes('chaollapark@gmail.com'),
    `${file} must contain the support contact`
  );
}

for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
  const source = read(workflow);
  for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    assert(
      /@[0-9a-f]{40}$/.test(match[1]),
      `${workflow} action must be pinned to a full commit SHA: ${match[1]}`
    );
  }
}

const releaseWorkflow = read('.github/workflows/release.yml');
assert(releaseWorkflow.includes('attest-build-provenance@'), 'release workflow must attest provenance');
assert(releaseWorkflow.includes('gptandme.zip.sha256'), 'release workflow must publish a checksum');
assert(releaseWorkflow.includes('GITHUB_REF_NAME'), 'release workflow must validate the version tag');
assert(releaseWorkflow.includes('tag_commit') && releaseWorkflow.includes('main_commit'), 'release tag must equal the exact main commit');
assert(releaseWorkflow.includes('gh release create'), 'release workflow must publish durable release assets');
assert(releaseWorkflow.includes('--draft'), 'release assets must be staged in a draft');
assert(releaseWorkflow.includes('gh release edit') && releaseWorkflow.includes('--draft=false'), 'release must publish only after assets are staged');
assert(releaseWorkflow.includes('Artifact SHA-256:'), 'release notes must record the ZIP checksum');
assert(releaseWorkflow.includes('persist-credentials: false'), 'checkout must not retain push credentials');
assert(!releaseWorkflow.includes('--clobber'), 'published release assets must never be overwritten');
assert(
  read('docs/release-checklist.md').includes('MadanChaollaPark.github.io'),
  'release checklist must identify the separate public Pages source'
);

console.log(`Verified GPTandME ${version} release contract`);
