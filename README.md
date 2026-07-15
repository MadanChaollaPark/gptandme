<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="GPTandME icon">
</p>

<h1 align="center">GPTandME</h1>

<p align="center">
  A local-first prompt counter for ChatGPT, Claude, Gemini, Perplexity, and Grok.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/jkejkpkndbbkfjpbjecbaldjgnhjiilf?utm_source=item-share-cb"><strong>Install from the Chrome Web Store</strong></a>
  &middot;
  <a href="https://madanchaollapark.github.io/gptandme/privacy.html">Privacy</a>
  &middot;
  <a href="https://madanchaollapark.github.io/gptandme/support.html">Support</a>
</p>

GPTandME is a browser-only Chrome extension that counts prompts sent from supported AI chat sites and stores the usage data in the browser. It does not require an account or a GPTandME server.

## What It Shows

- Today's prompt count in the extension badge and optional in-page counter.
- Today, week, month, last 24 hours, streak, total, and session statistics.
- Today and all-time prompt counts for each supported service: ChatGPT, Claude, Gemini, Perplexity, and Grok.
- Model breakdowns when the chat site exposes a model label.
- ChatGPT-only average and total thinking time when ChatGPT exposes a finalized provider-reported timing label for a new response after a user send.
- An OpenAI API cost proxy based on prompt counts, not actual token usage or billing data.
- Complete JSON backup/restore plus CSV export/import for dated prompt counts.
- Diagnostics and reset controls in the popup.

## Supported Sites

| Service | Hosts |
| --- | --- |
| ChatGPT | `chatgpt.com`, `chat.openai.com` |
| Claude | `claude.ai` |
| Gemini | `gemini.google.com` |
| Perplexity | `perplexity.ai`, `www.perplexity.ai` |
| Grok | `grok.com` (optional access enabled from the popup) |

The extension does not run on OpenAI API, billing, documentation, or playground pages.
It does not count activity from Claude Code, native desktop apps, command-line tools, or direct provider API usage outside those browser chat sites.

## Install

Install the published extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/jkejkpkndbbkfjpbjecbaldjgnhjiilf?utm_source=item-share-cb).

GPTandME 1.5.0 requires Chrome/Chromium 111 or newer so its early page-context send detector runs in the manifest-declared MAIN world.

To test the current source locally:

1. Clone this repository.
2. Open `chrome://extensions` in Chrome or another Chromium browser.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository root.
5. Reload every already-open supported-site tab so the updated content scripts are active.
6. To count Grok prompts, open the popup, enable optional Grok counting, and reload any already-open Grok tabs.
7. Send a new prompt on a supported site and confirm the badge increments.

Historical prompts are not backfilled.

## Local Usage Data

GPTandME stores aggregate usage locally by date, service/provider, and model label when one is available. The popup shows today's and all-time counts for ChatGPT, Claude, Gemini, Perplexity, and Grok alongside the existing combined totals. Both `perplexity.ai` hosts count toward Perplexity, and both ChatGPT hosts count toward ChatGPT. Session diagnostics are bounded to the 500 most recent page sessions. Deduplication storage is also bounded to 500 opaque provider event IDs for 24 hours and 500 supported-host/tab keys for two seconds.

Complete JSON backups preserve counts, hours, sessions, settings, and diagnostics; restoring one replaces the data currently stored. CSV exports contain dated counts using the columns `date,provider,model,count`, and CSV imports merge by adding counts, so importing the same file twice duplicates them. CSV files from earlier GPTandME versions that use `date,model,count` remain importable; their provider is recorded as `unknown` because historical provider attribution cannot be reconstructed safely.

## Privacy

Prompt counts, dates, service/provider counts, model labels, session statistics, supported-site labels, diagnostics, and preferences stay in `chrome.storage.local`. GPTandME does not store prompt text or a page's full URL path, and it does not send usage data to an external server. Data leaves the browser only when the user manually downloads a JSON backup or CSV usage file.

Static content scripts run only on the supported HTTPS chat hosts other than Grok. The narrower `host_permissions` list contains only the two ChatGPT hosts required by the local `webRequest` backup detector. Grok is declared as an optional host permission and runs only after the user explicitly enables grok.com access in the popup; this keeps existing installations active during the upgrade. Claude, Perplexity, and enabled Grok counting use an early page-context interceptor to recognize supported send endpoints and opaque request IDs, with DOM detection as a fallback. Prompt text is never emitted to the extension, retained, or transmitted by GPTandME. Version 1.4.0 adds optional Grok browser counting without analytics or external usage telemetry.

GPTandME declares `incognito: not_allowed`, so Chrome cannot enable it in Incognito mode and private-window activity cannot be combined with regular-profile usage totals.

Read the full [privacy policy](https://madanchaollapark.github.io/gptandme/privacy.html).

## Development

Requires Node.js 20 or newer plus the standard `zip` and `unzip` commands.

```bash
npm test
npm run build
npm run verify:package
```

`npm run build` creates `dist/gptandme.zip`. The build normalizes archive metadata so the same source produces the same ZIP bytes. `npm run verify:package` checks the exact file inventory and confirms that package and manifest versions match.

Tagged releases use the pinned GitHub Actions workflow in `.github/workflows/release.yml` to run the full tests, build the ZIP once, create its SHA-256 checksum, attest its build provenance, upload the ZIP plus checksum as one workflow artifact, and publish the same files in a durable GitHub Release. Follow the [release checklist](docs/release-checklist.md) before submitting that exact ZIP to the Chrome Web Store.

## Troubleshooting

- Badge does not change: confirm the current tab is a supported chat host, reload the extension, and then reload the site tab. Updating an unpacked extension does not retrofit scripts into tabs that were already open.
- Popup values stay at zero: send a new prompt after installation; existing conversations are not imported automatically.
- A service total is lower than the combined total: usage recorded before service attribution was introduced remains under `unknown` instead of being guessed.
- Reset today also clears session aggregates and recent deduplication IDs so deleted prompts cannot remain in session stats or suppress a fresh count; older daily/service/model totals remain.
- API proxy is low or unpriced: it is an estimate based on available model labels and prompt counts, not token telemetry.
- Counts belong to another extension ID: export a CSV from the old popup, then import it into the current extension.
- Claude Code activity is missing: GPTandME tracks supported browser chat sites only; Claude Code and other native, command-line, or direct API clients are outside its scope.
- Grok activity is missing: open the popup, turn on optional Grok counting, accept access to grok.com, and reload any Grok tab that was already open.

For support, email [chaollapark@gmail.com](mailto:chaollapark@gmail.com) or use the [public issue tracker](https://github.com/MadanChaollaPark/gptandme/issues). Do not include prompt text or conversation URLs.

GPTandME is an independent project and is not affiliated with, endorsed by, or sponsored by OpenAI, Anthropic, Google, Perplexity, or xAI.
