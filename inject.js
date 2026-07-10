// inject.js — runs in the page context (not the content-script isolate).
// It emits only model/provider metadata and opaque request IDs. Prompt text
// never crosses into the extension or persistent storage.

(function () {
  const guard = Symbol.for('gptandme.page-interceptor.v2');
  if (window[guard]) return;
  Object.defineProperty(window, guard, { value: true });

  const nativeFetch = window.fetch;
  const nativeWebSocketSend = window.WebSocket?.prototype?.send;
  const hostname = location.hostname.toLowerCase();
  const fallbackEvents = new Map();
  const FALLBACK_EVENT_TTL_MS = 60 * 1000;

  function parseUrl(input) {
    try {
      const target = typeof input === 'string' || input instanceof URL
        ? input
        : input?.url;
      return new URL(target, location.origin);
    } catch (_) {
      return null;
    }
  }

  function parseJson(value) {
    if (!value) return null;
    if (typeof value === 'object' && !(value instanceof String)) return value;
    try {
      return JSON.parse(String(value));
    } catch (_) {
      return null;
    }
  }

  function safeId(value) {
    const text = String(value ?? '').trim();
    if (!text || text.length > 140 || !/^[a-zA-Z0-9:._-]+$/.test(text)) return null;
    return text;
  }

  function randomId() {
    try {
      if (crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {
      // Fall through to an ephemeral random identifier.
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function hashText(value) {
    const text = String(value ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  function fallbackEventId(provider, rawBody) {
    const now = Date.now();
    const fingerprint = `${provider}:${hashText(rawBody)}`;
    const existing = fallbackEvents.get(fingerprint);
    if (existing && now - existing.at < FALLBACK_EVENT_TTL_MS) return existing.id;

    const id = `${provider}:local-${randomId()}`;
    fallbackEvents.set(fingerprint, { id, at: now });
    for (const [key, value] of fallbackEvents) {
      if (now - value.at >= FALLBACK_EVENT_TTL_MS) fallbackEvents.delete(key);
    }
    return id;
  }

  function requestEventId(provider, body, rawBody) {
    const params = parseJson(body?.params) || body?.params || {};
    const candidates = [
      body?.completion_request_id,
      body?.turn_message_uuids?.human_message_uuid,
      body?.human_message_uuid,
      body?.frontend_uuid,
      body?.request_id,
      params?.frontend_uuid,
      params?.request_id,
      params?.uuid,
    ];
    for (const candidate of candidates) {
      const id = safeId(candidate);
      if (id) return `${provider}:${id}`;
    }
    return fallbackEventId(provider, rawBody);
  }

  function emitSend(provider, eventId, model = null) {
    const id = safeId(eventId);
    if (!id) return;
    window.dispatchEvent(new CustomEvent('__gptandme_send', {
      detail: {
        eventId: id,
        model: safeId(model),
        provider,
      },
    }));
  }

  function isChatGptPromptEndpoint(url) {
    const pathSegments = url?.pathname.split('/').filter(Boolean) || [];
    const backendIndex = pathSegments.indexOf('backend-api');
    if (backendIndex === -1) return false;
    const backendSegments = pathSegments.slice(backendIndex + 1);
    return backendSegments.includes('conversation') || backendSegments.includes('responses');
  }

  function inspectChatGpt(url, method, rawBody) {
    if (!isChatGptPromptEndpoint(url) || method !== 'POST') return;
    const body = parseJson(rawBody);
    if (body?.model) {
      window.dispatchEvent(new CustomEvent('__gptandme_model', { detail: body.model }));
    }
  }

  function inspectClaude(url, method, rawBody) {
    if (method !== 'POST') return;
    if (!/^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion2?$/.test(url?.pathname || '')) {
      return;
    }

    const body = parseJson(rawBody);
    if (!body || !hasClaudeUserInput(body)) return;
    emitSend(
      'claude',
      requestEventId('claude', body, rawBody),
      body.model || body.model_name
    );
  }

  function hasTextContent(value) {
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.some(hasTextContent);
    if (!value || typeof value !== 'object') return false;
    return [value.text, value.content, value.input_text].some(hasTextContent);
  }

  function hasClaudeUserInput(body = {}) {
    if (safeId(body.turn_message_uuids?.human_message_uuid)) return true;
    if ([body.prompt, body.content, body.input, body.message].some(hasTextContent)) return true;
    if (Array.isArray(body.messages) && body.messages.some((message) => {
      const role = String(message?.role || message?.author?.role || '').toLowerCase();
      return (role === 'user' || role === 'human') && hasTextContent(message);
    })) {
      return true;
    }
    return [body.attachments, body.files, body.images].some(
      (items) => Array.isArray(items) && items.length > 0
    );
  }

  function perplexityParams(body) {
    const parsed = parseJson(body?.params);
    return parsed && typeof parsed === 'object' ? parsed : (body?.params || {});
  }

  function isPerplexityRetryOrBackground(params = {}) {
    const source = String(params.query_source || '').toLowerCase();
    return (
      source === 'retry' ||
      source.includes('related') ||
      params.is_related_query === true ||
      params.is_background === true
    );
  }

  function hasPerplexityUserInput(body = {}, query = '') {
    if (typeof query === 'string' && query.trim()) return true;
    if (typeof body.query_str === 'string' && body.query_str.trim()) return true;
    if (typeof body.query === 'string' && body.query.trim()) return true;
    return [body.attachments, body.files, body.images].some(
      (items) => Array.isArray(items) && items.length > 0
    );
  }

  function inspectPerplexityFetch(url, method, rawBody) {
    if (method !== 'POST' || !/\/rest\/sse\/perplexity_ask\/?$/.test(url?.pathname || '')) return;
    const body = parseJson(rawBody);
    if (!body) return;
    const params = perplexityParams(body);
    if (isPerplexityRetryOrBackground(params) || !hasPerplexityUserInput(body)) return;
    emitSend(
      'perplexity',
      requestEventId('perplexity', { ...body, params }, rawBody),
      params.model || body.model
    );
  }

  function inspectPerplexityWebSocket(data) {
    if (typeof data !== 'string') return;
    const jsonStart = data.indexOf('[');
    if (jsonStart === -1) return;
    const frame = parseJson(data.slice(jsonStart));
    if (!Array.isArray(frame) || frame[0] !== 'perplexity_ask') return;

    const query = typeof frame[1] === 'string' ? frame[1] : '';
    const params = parseJson(frame[2]) || frame[2] || {};
    if (isPerplexityRetryOrBackground(params) || !hasPerplexityUserInput({}, query)) return;
    emitSend(
      'perplexity',
      requestEventId('perplexity', { params }, data),
      params.model
    );
  }

  async function bodyText(input, init = {}) {
    if (typeof init.body === 'string') return init.body;
    if (typeof URLSearchParams !== 'undefined' && init.body instanceof URLSearchParams) {
      return init.body.toString();
    }
    try {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        return await input.clone().text();
      }
    } catch (_) {
      return '';
    }
    return '';
  }

  async function inspectFetch(input, init = {}) {
    const url = parseUrl(input);
    if (!url) return;
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    const rawBody = await bodyText(input, init);

    if (hostname === 'chatgpt.com' || hostname === 'chat.openai.com') {
      inspectChatGpt(url, method, rawBody);
    } else if (hostname === 'claude.ai') {
      inspectClaude(url, method, rawBody);
    } else if (hostname === 'perplexity.ai' || hostname === 'www.perplexity.ai') {
      inspectPerplexityFetch(url, method, rawBody);
    }
  }

  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      inspectFetch(input, init).catch(() => {});
      return nativeFetch.apply(this, arguments);
    };
  }

  if (
    (hostname === 'perplexity.ai' || hostname === 'www.perplexity.ai') &&
    typeof nativeWebSocketSend === 'function'
  ) {
    window.WebSocket.prototype.send = function (data) {
      try {
        inspectPerplexityWebSocket(data);
      } catch (_) {
        // Never interfere with the site's transport.
      }
      return nativeWebSocketSend.apply(this, arguments);
    };
  }
})();
