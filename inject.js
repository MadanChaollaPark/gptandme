// inject.js — runs in the page context (not the content-script isolate).
// It emits only model/provider metadata and opaque request IDs. Prompt text
// never crosses into the extension or persistent storage.

(function () {
  const guard = Symbol.for('gptandme.page-interceptor.v2');
  if (window[guard]) return;
  Object.defineProperty(window, guard, { value: true });

  const nativeFetch = window.fetch;
  const nativeWebSocketSend = window.WebSocket?.prototype?.send;
  const nativeXhrOpen = window.XMLHttpRequest?.prototype?.open;
  const nativeXhrSend = window.XMLHttpRequest?.prototype?.send;
  const hostname = location.hostname.toLowerCase();
  const fallbackEvents = new Map();
  const xhrRequests = new WeakMap();
  const FALLBACK_EVENT_TTL_MS = 1000;

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
      body?.event_id,
      body?.eventId,
      body?.completion_request_id,
      body?.turn_message_uuids?.human_message_uuid,
      body?.human_message_uuid,
      body?.frontend_uuid,
      body?.request_id,
      body?.client_message_id,
      body?.clientMessageId,
      body?.item?.x_grok?.client_message_id,
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

  function isClaudePromptEndpoint(url) {
    const segments = String(url?.pathname || '').split('/').filter(Boolean);
    const apiIndex = segments.indexOf('api');
    const organizationsIndex = segments.indexOf('organizations');
    const conversationIndex = segments.indexOf('chat_conversations');
    if (apiIndex === -1 || organizationsIndex <= apiIndex || conversationIndex <= organizationsIndex + 1) {
      return false;
    }

    const conversationId = segments[conversationIndex + 1];
    const operation = segments[conversationIndex + 2];
    return Boolean(
      conversationId &&
      operation &&
      /^completion2?$/.test(operation) &&
      conversationIndex + 3 === segments.length
    );
  }

  function inspectClaude(url, method, rawBody) {
    if (method !== 'POST' || !isClaudePromptEndpoint(url)) return;

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

  function hasGrokUserInput(body = {}) {
    if (typeof body.message === 'string' && body.message.trim()) return true;
    return [body.attachments, body.files, body.fileAttachments, body.imageAttachments].some(
      (items) => Array.isArray(items) && items.length > 0
    );
  }

  function inspectGrok(url, method, rawBody) {
    if (
      method !== 'POST' ||
      !/^\/rest\/app-chat\/conversations\/(new|[^/]+\/responses)\/?$/.test(url?.pathname || '')
    ) {
      return;
    }
    const body = parseJson(rawBody);
    if (
      !body ||
      body.isRegenRequest === true ||
      body.is_regen_request === true ||
      !hasGrokUserInput(body)
    ) {
      return;
    }
    emitSend(
      'grok',
      requestEventId('grok', body, rawBody),
      body.modelName || body.model
    );
  }

  function hasGrokGatewayUserInput(event = {}) {
    const item = event.item || {};
    if (item.type !== 'message' || item.role !== 'user') return false;
    if (hasTextContent(item.content)) return true;
    if (hasTextContent(item.x_grok?.input_chunks)) return true;
    return Array.isArray(event.file_attachment_ids) && event.file_attachment_ids.length > 0;
  }

  function inspectGrokWebSocket(rawData) {
    const envelope = parseJson(rawData);
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return;
    const event = parseJson(envelope.event) || envelope.event || envelope;
    if (
      !event ||
      event.type !== 'conversation.item.create' ||
      event.isRegenRequest === true ||
      event.is_regen_request === true ||
      !hasGrokGatewayUserInput(event)
    ) {
      return;
    }
    emitSend(
      'grok',
      requestEventId('grok', event, rawData),
      event.modelName || event.model || event.item?.model
    );
  }

  function isGrokGatewaySocket(socket) {
    const url = parseUrl(socket?.url);
    return Boolean(
      url &&
      url.hostname.toLowerCase() === 'grok.com' &&
      /^\/ws\/(?:gw|mgw)\/?$/.test(url.pathname)
    );
  }

  function formDataToText(formData) {
    const fields = Object.create(null);
    for (const [key, value] of formData.entries()) {
      if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const safeValue = typeof value === 'string'
        ? value
        : { name: String(value?.name || 'attachment').slice(0, 160) };
      if (Object.hasOwn(fields, key)) {
        fields[key] = Array.isArray(fields[key])
          ? [...fields[key], safeValue]
          : [fields[key], safeValue];
      } else {
        fields[key] = safeValue;
      }
    }
    return JSON.stringify(fields);
  }

  function binaryBodyToText(value) {
    try {
      let bytes = null;
      if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value);
      } else if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView?.(value)) {
        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      }
      if (bytes && typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    } catch (_) {
      // Unsupported binary bodies are ignored without affecting the request.
    }
    return '';
  }

  async function valueText(value) {
    if (typeof value === 'string') return value;
    if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) {
      return value.toString();
    }
    if (typeof FormData !== 'undefined' && value instanceof FormData) {
      return formDataToText(value);
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob && typeof value.text === 'function') {
      try {
        return await value.text();
      } catch (_) {
        return '';
      }
    }
    return binaryBodyToText(value);
  }

  async function bodyText(input, init = {}) {
    const options = init && typeof init === 'object' ? init : {};
    if (Object.prototype.hasOwnProperty.call(options, 'body')) {
      return valueText(options.body);
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

  async function inspectTransport(input, method, body) {
    const url = parseUrl(input);
    if (!url) return;
    const normalizedMethod = String(method || input?.method || 'GET').toUpperCase();
    const rawBody = await valueText(body);

    if (hostname === 'chatgpt.com' || hostname === 'chat.openai.com') {
      inspectChatGpt(url, normalizedMethod, rawBody);
    } else if (hostname === 'claude.ai') {
      inspectClaude(url, normalizedMethod, rawBody);
    } else if (hostname === 'perplexity.ai' || hostname === 'www.perplexity.ai') {
      inspectPerplexityFetch(url, normalizedMethod, rawBody);
    } else if (hostname === 'grok.com') {
      inspectGrok(url, normalizedMethod, rawBody);
    }
  }

  async function inspectFetch(input, init = {}) {
    const options = init && typeof init === 'object' ? init : {};
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    const rawBody = await bodyText(input, options);
    return inspectTransport(input, method, rawBody);
  }

  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      inspectFetch(input, init).catch(() => {});
      return nativeFetch.apply(this, arguments);
    };
  }

  if (typeof nativeXhrOpen === 'function' && typeof nativeXhrSend === 'function') {
    window.XMLHttpRequest.prototype.open = function (method, url) {
      const result = nativeXhrOpen.apply(this, arguments);
      xhrRequests.set(this, { method: String(method || 'GET'), url });
      return result;
    };
    window.XMLHttpRequest.prototype.send = function (body) {
      const request = xhrRequests.get(this);
      if (request) inspectTransport(request.url, request.method, body).catch(() => {});
      return nativeXhrSend.apply(this, arguments);
    };
  }

  if (
    (
      hostname === 'perplexity.ai' ||
      hostname === 'www.perplexity.ai' ||
      hostname === 'grok.com'
    ) &&
    typeof nativeWebSocketSend === 'function'
  ) {
    window.WebSocket.prototype.send = function (data) {
      const inspectData = (rawData) => {
        try {
          if (hostname === 'grok.com') inspectGrokWebSocket(rawData);
          else inspectPerplexityWebSocket(rawData);
        } catch (_) {
          // Never interfere with the site's transport.
        }
      };
      const shouldInspect = hostname !== 'grok.com' || isGrokGatewaySocket(this);
      if (shouldInspect && typeof data === 'string') inspectData(data);
      else if (shouldInspect) valueText(data).then(inspectData).catch(() => {});
      return nativeWebSocketSend.apply(this, arguments);
    };
  }
})();
