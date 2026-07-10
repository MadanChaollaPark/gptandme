<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="GPTandME icon">
</p>

<h1 align="center">GPTandME</h1>

<p align="center">
  A local-first prompt counter for ChatGPT, Claude, Gemini, and Perplexity.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/jkejkpkndbbkfjpbjecbaldjgnhjiilf?utm_source=item-share-cb"><strong>Install from the Chrome Web Store</strong></a>
  &middot;
  <a href="https://madanchaollapark.github.io/gptandme/privacy.html">Privacy</a>
  &middot;
  <a href="https://madanchaollapark.github.io/gptandme/support.html">Support</a>
</p>

GPTandME counts prompts sent from supported AI chat sites and stores the usage data in the browser. It does not require an account or a GPTandME server.

## What It Shows

- Today's prompt count in the extension badge and optional in-page counter.
- Today, week, month, last 24 hours, streak, total, and session statistics.
- Model breakdowns when the chat site exposes a model label.
- An OpenAI API cost proxy based on prompt counts, not actual token usage or billing data.
- CSV export and import for user-controlled backups.
- Diagnostics and reset controls in the popup.

## Supported Sites

| Service | Hosts |
| --- | --- |
| ChatGPT | `chatgpt.com`, `chat.openai.com` |
| Claude | `claude.ai` |
| Gemini | `gemini.google.com` |
| Perplexity | `perplexity.ai`, `www.perplexity.ai` |

The extension does not run on OpenAI API, billing, documentation, or playground pages.

## Install

Install the published extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/jkejkpkndbbkfjpbjecbaldjgnhjiilf?utm_source=item-share-cb).

To test the current source locally:

1. Clone this repository.
2. Open `chrome://extensions` in Chrome or another Chromium browser.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository root.
5. Send a new prompt on a supported site and confirm the badge increments.

Historical prompts are not backfilled.

## Privacy

Prompt counts, dates, model labels, session statistics, supported-site labels, diagnostics, and preferences stay in `chrome.storage.local`. GPTandME does not send that data or prompt text to an external server. Data leaves the browser only when the user manually exports a CSV.

The extension requests access only to its supported chat hosts. ChatGPT request detection uses `webRequest` as a backup counting signal; prompt text is not retained or transmitted by GPTandME.

Read the full [privacy policy](https://madanchaollapark.github.io/gptandme/privacy.html).

## Development

Requires Node.js 20 or newer plus the standard `zip` and `unzip` commands.

```bash
npm test
npm run build
npm run verify:package
```

`npm run build` creates `dist/gptandme.zip`. The build normalizes archive metadata so the same source produces the same ZIP bytes. `npm run verify:package` checks the exact file inventory and confirms that package and manifest versions match.

## Troubleshooting

- Badge does not change: confirm the current tab is a supported chat host, then reload the extension.
- Popup values stay at zero: send a new prompt after installation; existing conversations are not imported automatically.
- API proxy is low or unpriced: it is an estimate based on available model labels and prompt counts, not token telemetry.
- Counts belong to another extension ID: export a CSV from the old popup, then import it into the current extension.

GPTandME is an independent project and is not affiliated with, endorsed by, or sponsored by OpenAI, Anthropic, Google, or Perplexity.
