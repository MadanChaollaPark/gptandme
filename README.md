# GPTandme

GPTandme is a Manifest V3 browser extension that counts prompts sent from supported AI chat sites and stores the counts locally in the browser.

## v1.2 Surfaces

- Daily, weekly, monthly, and all-time prompt counts
- Per-model breakdown when the site exposes the model
- Hourly and session-level storage for analytics
- CSV export from the popup
- Local-only storage through `chrome.storage.local`

## Supported Sites

- ChatGPT (`chatgpt.com`, `chat.openai.com`)
- Claude (`claude.ai`)
- Gemini (`gemini.google.com`)
- Perplexity (`perplexity.ai`, `www.perplexity.ai`)

## Development

```bash
npm test
npm run build
```

`npm run build` creates `dist/gptandme.zip` for Chrome Web Store submission.

## Local Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this repository folder.

## Privacy

The extension does not send prompt counts, model names, or browsing data to any server. Counts stay in local browser storage unless you export them manually as CSV.
