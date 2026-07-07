# GPTandme

GPTandme is a Manifest V3 browser extension that counts prompts sent from supported AI chat sites and stores the counts locally in the browser.

## v1.2.2 Surfaces

- Extension badge: shows today's prompt count.
- Extension popup: shows today, week, month, last 24 hours, streak, total, an OpenAI API cost proxy, sessions, model breakdown, diagnostics, CSV import/export, and reset controls.
- Optional in-page widget/counter: shows today's local count on supported chat hosts. It is optional; core tracking should still work through the badge and popup if the widget is hidden or unavailable.

## Supported Browsers

- Supported: Chrome and Chromium-based browsers that support Manifest V3 unpacked extensions, including Helium.
- Also expected to work: Microsoft Edge, Brave, and other Chromium browsers with `chrome.storage`, `chrome.webRequest`, and extension action badge support.
- Not currently packaged for: Firefox or Safari.

## Supported Hosts

GPTandme only runs on these chat hosts:

- ChatGPT: `chatgpt.com`, `chat.openai.com`
- Claude: `claude.ai`
- Gemini: `gemini.google.com`
- Perplexity: `perplexity.ai`, `www.perplexity.ai`

OpenAI/platform boundary:

- Counts ChatGPT prompts on `chatgpt.com` and the legacy `chat.openai.com` host.
- Does not run on `openai.com`, `platform.openai.com`, `api.openai.com`, `help.openai.com`, docs pages, billing pages, playground/API pages, or unrelated OpenAI web properties.

## Local Install

1. Open the extensions page for your browser:
   - Chrome/Chromium/Helium: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the repository folder exactly:

```text
/Users/madan/Code/ai-tools/gptandme
```

Do not select `/Users/madan/Code/gptandme`; that path is stale/missing on this machine.

## Helium Stale Entry Cleanup

If Helium shows an old unpacked extension entry or an error for `/Users/madan/Code/gptandme`, remove that entry from the extensions page first. Then click **Load unpacked** again and choose:

```text
/Users/madan/Code/ai-tools/gptandme
```

After reload, send one prompt on a supported host and confirm the badge increments and the popup values update.

## Diagnostics Panel

Use the popup diagnostics panel first:

1. Open a supported chat host.
2. Open the GPTandme extension popup.
3. Check **Diagnostics** for version, status, current-site support, last-counted time, and any last reason.
4. Use the **In-page counter** toggle to confirm whether the optional page widget is enabled.

Then use the browser extensions diagnostics if the popup still does not explain the issue:

1. Open `chrome://extensions` or the equivalent extensions page for your browser.
2. Find **GPTandme** / **ChatGPT Query Counter**.
3. Check that the extension is enabled and loaded from `/Users/madan/Code/ai-tools/gptandme`.
4. Open **Details** and inspect **Errors** for content-script, service-worker, or permission failures.
5. Open **Inspect views** / **service worker** to watch background logs while sending a test prompt.
6. Confirm you are testing on a supported chat host, not an OpenAI platform/API/docs page.
7. Reload the extension after editing files or switching branches.

Common install symptoms:

- Badge does not change: verify the current tab is one of the supported hosts and reload the extension.
- Popup opens but all counts are zero: send a new prompt after the extension is loaded; historical prompts are not backfilled.
- API proxy looks too low or says unpriced: the popup only has prompt counts, not real token usage. Unknown or unsupported model names are not charged with a fake fallback price.
- Helium still references `/Users/madan/Code/gptandme`: remove the stale entry and load the correct repo path.
- OpenAI platform pages do not count: this is expected; only ChatGPT chat hosts are supported.
- Old counts live under another extension ID: export CSV from the old popup if possible, then use **Import CSV** in the current popup to merge those rows.

## Development

```bash
npm test
npm run build
```

`npm run build` creates the Chrome Web Store zip at:

```text
/Users/madan/Code/ai-tools/gptandme/dist/gptandme.zip
```

## Privacy

GPTandme is local-only. It does not send prompt counts, model names, session stats, host data, request data, or browsing data to any server. Counts stay in `chrome.storage.local` unless you manually export a CSV from the popup.
