// inject.js — runs in page context (not content-script isolate)
// Intercepts fetch to detect which model ChatGPT is sending to.

(function () {
  const _fetch = window.fetch;
  window.fetch = async function (url, opts) {
    try {
      if (
        typeof url === 'string' &&
        url.includes('/backend-api/conversation') &&
        opts &&
        opts.method === 'POST' &&
        opts.body
      ) {
        const body = JSON.parse(opts.body);
        if (body.model) {
          window.dispatchEvent(
            new CustomEvent('__gptandme_model', { detail: body.model })
          );
        }
      }
    } catch (_) {
      // ignore parse errors — don't break the page
    }
    return _fetch.apply(this, arguments);
  };
})();
