// inject.js — runs in page context (not content-script isolate)
// Intercepts fetch to detect which model ChatGPT is sending to.

(function () {
  const _fetch = window.fetch;

  function isPromptEndpoint(url) {
    try {
      const target = typeof url === 'string' ? url : url?.url;
      const pathSegments = new URL(target, location.origin).pathname.split('/').filter(Boolean);
      const backendIndex = pathSegments.indexOf('backend-api');
      if (backendIndex === -1) return false;
      const backendSegments = pathSegments.slice(backendIndex + 1);
      return backendSegments.includes('conversation') || backendSegments.includes('responses');
    } catch (_) {
      return false;
    }
  }

  window.fetch = async function (url, opts) {
    try {
      if (
        isPromptEndpoint(url) &&
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
