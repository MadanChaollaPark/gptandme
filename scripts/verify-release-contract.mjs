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

const manifest = readJson('manifest.json');
const packageJson = readJson('package.json');
const version = manifest.version;
const contentMatches = manifest.content_scripts.flatMap((entry) => entry.matches || []);

assert(version === packageJson.version, 'manifest and package versions must match');
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

const background = read('background.js');
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
