# GPTandME release checklist

Use this checklist for every Chrome Web Store release. The release artifact must come from the tagged GitHub Actions run; do not upload a separately rebuilt local ZIP.

## 1. Align source and public documentation

- Set the same release version in `manifest.json` and `package.json`.
- Update version-specific text in `README.md`, `privacy.html`, `docs/index.html`, `docs/privacy.html`, and `docs/support.html`.
- Keep `privacy.html` and `docs/privacy.html` byte-for-byte identical.
- Confirm the supported browser hosts, permissions, stored fields, retention bounds, and provider list still match the runtime.
- Keep Grok in `optional_host_permissions`, not static content-script matches, so an update does not disable existing installations for a new required host warning.
- State the product boundary clearly: GPTandME counts supported browser chat sites only. Claude Code, native desktop apps, command-line tools, direct provider API clients, and Chrome Incognito are not supported.
- For v1.5.0 thinking time, state the contract exactly: local-only aggregate provider-reported ChatGPT timing for new responses observed after the user sends; no raw prompt/response content, no raw thinking labels, no raw timing samples, and no historical backfill.
- Confirm JSON backups include thinking aggregates, while CSV export/import remains prompt counts only with `date,provider,model,count`.

## 2. Verify locally

Run:

```bash
npm test
node scripts/verify-release-contract.mjs
npm run verify:package
```

Confirm that the test suite passes, the release contract verifier passes, the package inventory is exact, and the reported ZIP SHA-256 is recorded in the release notes.

Use Chrome's extension update testing flow to confirm the production 1.2.4 package updates to this version without being disabled for a new required permission. Enable Grok from the popup and verify that its dynamic scripts register only after the optional grok.com grant. Confirm v1.5.0 keeps the same required permissions as v1.4.0.

For the v1.5.0 thinking-time feature, confirm:

- Storage schema v3 contains `byThinkingProviderModel[YYYY-MM-DD][provider][model] = { reportedCount, totalMs }`.
- `recentThinkingEvents` is bounded and retained like the existing provider event ledger.
- The content-to-background runtime message type is `thinkingMetric` with `{ eventId, model, thinkingMs, source: "provider-reported" }`.
- The background derives and validates the provider from the sender tab and never trusts a forged provider in the message.
- ChatGPT is the only thinking-time provider in v1.5.0.
- Timing is read from provider-reported finalized DOM labels only; there is no stream cloning, response text capture, raw label/sample storage, or historical backfill.
- Valid durations are 1 second through 6 hours inclusive.
- The average is `totalMs / reportedCount`; untimed prompts are not included as zero-duration samples.

## 3. Publish policy and support pages

- Copy `docs/index.html`, `docs/privacy.html`, and `docs/support.html` to the `gptandme/` directory of the separate `MadanChaollaPark.github.io` repository and merge that site change. This repository is not itself the Pages source.
- Confirm these public URLs return HTTP 200 and show the new version before submitting the extension update:
  - `https://madanchaollapark.github.io/gptandme/`
  - `https://madanchaollapark.github.io/gptandme/privacy.html`
  - `https://madanchaollapark.github.io/gptandme/support.html`
- Confirm the support email and public issue tracker work.

## 4. Build the release artifact

- Tag the exact reviewed commit as `v<manifest-version>` and push the tag.
- Wait for `.github/workflows/release.yml` to pass. The workflow rejects a tag that does not match `package.json`.
- Download the `gptandme-v<version>-<commit>` artifact from that workflow run or the durable GitHub Release created by the workflow.
- Verify `gptandme.zip` against `gptandme.zip.sha256`.
- Verify the GitHub build attestation when the GitHub CLI is available:

```bash
gh attestation verify gptandme.zip --repo MadanChaollaPark/gptandme
```

## 5. Update the Chrome Web Store listing

- Upload the exact attested `gptandme.zip` from the tagged workflow run.
- Update the detailed description, version-specific feature text, supported services, screenshots, and permission justifications.
- Keep the privacy declarations consistent with the code and public policy. GPTandME handles local user activity and website content to count browser prompts; it does not transmit that data to a GPTandME server.
- Confirm the privacy-policy URL points to the public GitHub Pages policy.
- Review all listing text for stale, inappropriate, or accidental content before submission.

## 6. Post-publication smoke test

- Confirm the Store shows the expected version and updated date.
- Install the Store build in a clean Chrome profile.
- Verify one prompt on each supported browser service, including the Grok opt-in and required tab reload, plus badge and popup totals, provider attribution, ChatGPT provider-reported average and total thinking-time behavior, JSON backup/restore, CSV export/import merge warnings, both reset controls, and the optional in-page counter.
- Confirm Claude Code and Incognito are not advertised as supported.
