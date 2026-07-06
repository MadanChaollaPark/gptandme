const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shared = require('../shared');

function splitSelectorList(selector) {
  return selector.split(',').map((part) => part.trim()).filter(Boolean);
}

function selectorMatchesSingle(el, selector) {
  if (!el) return false;

  if (selector === ':disabled') {
    return Boolean(el.disabled || el.getAttribute('disabled') !== null);
  }

  const idMatch = /^#([\w-]+)$/.exec(selector);
  if (idMatch) return el.getAttribute('id') === idMatch[1];

  if (/^[a-z]+$/i.test(selector)) {
    return el.tagName.toLowerCase() === selector.toLowerCase();
  }

  const attrMatch = /^(?:(\w+))?\[([\w-]+)(\*?=)?(?:"([^"]*)"|'([^']*)'|([^\]]+))?\]$/.exec(selector);
  if (!attrMatch) return false;

  const [, tag, attr, op, doubleQuoted, singleQuoted, unquoted] = attrMatch;
  if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;

  const value = el.getAttribute(attr);
  if (value === null) return false;
  if (!op) return true;

  const expected = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
  if (op === '=') return value === expected;
  if (op === '*=') return value.includes(expected);
  return false;
}

function selectorMatches(el, selector) {
  return splitSelectorList(selector).some((part) => selectorMatchesSingle(el, part));
}

class TestElement {
  constructor(tagName = 'div', attributes = {}, options = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this.listeners = new Map();
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.disabled = Boolean(options.disabled);

    for (const [name, value] of Object.entries(attributes)) {
      this.setAttribute(name, value);
    }
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get isConnected() {
    let cursor = this;
    while (cursor) {
      if (cursor === this.ownerDocument?.documentElement) return true;
      cursor = cursor.parentElement;
    }
    return false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  appendChild(child) {
    if (!(child instanceof TestElement)) return child;
    child.parentElement = this;
    setOwnerDocument(child, this.ownerDocument);
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index !== -1) siblings.splice(index, 1);
    this.parentElement = null;
  }

  matches(selector) {
    return selectorMatches(this, selector);
  }

  closest(selector) {
    let cursor = this;
    while (cursor) {
      if (cursor.matches(selector)) return cursor;
      cursor = cursor.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  attachShadow() {
    this.shadowRoot = new TestElement('#shadow-root');
    this.shadowRoot.ownerDocument = this.ownerDocument;
    return this.shadowRoot;
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  click() {
    if (this.tagName === 'A') {
      this.ownerDocument?.downloads.push({
        href: this.href,
        download: this.download,
      });
    }

    for (const callback of this.listeners.get('click') || []) {
      callback({ target: this });
    }
  }
}

function setOwnerDocument(element, document) {
  element.ownerDocument = document;
  for (const child of element.children) {
    setOwnerDocument(child, document);
  }
  if (element.shadowRoot) {
    setOwnerDocument(element.shadowRoot, document);
  }
}

function createTestDocument(ids = []) {
  const listeners = new Map();
  const elementsById = new Map();
  const document = {
    downloads: [],
    head: new TestElement('head'),
    documentElement: new TestElement('html'),
    body: new TestElement('body'),

    createElement(tagName) {
      const element = new TestElement(tagName);
      element.ownerDocument = document;
      return element;
    },

    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },

    dispatch(type, event = {}) {
      for (const callback of listeners.get(type) || []) {
        callback(event);
      }
    },

    getElementById(id) {
      return elementsById.get(id) || null;
    },

    querySelectorAll(selector) {
      return document.body.querySelectorAll(selector);
    },

    registerElement(id, element = new TestElement('div')) {
      element.ownerDocument = document;
      element.setAttribute('id', id);
      elementsById.set(id, element);
      return element;
    },
  };

  setOwnerDocument(document.head, document);
  setOwnerDocument(document.documentElement, document);
  setOwnerDocument(document.body, document);
  document.documentElement.append(document.head, document.body);

  for (const id of ids) {
    document.registerElement(id);
  }

  return document;
}

function runScript(fileName, sandbox) {
  const source = fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: fileName });
}

function createContentScriptHarness(options = {}) {
  const {
    hostname = 'claude.ai',
    pathname = '/chat/test-thread',
    href = `https://${hostname}${pathname}`,
    storageData = null,
  } = options;
  const document = createTestDocument();
  const messages = [];
  const windowListeners = new Map();
  const storageChangeListeners = [];
  let now = 1000;
  const chrome = {
    runtime: {
      getURL(file) {
        return `chrome-extension://test/${file}`;
      },
      sendMessage(message) {
        messages.push(message);
      },
    },
  };

  if (storageData) {
    chrome.storage = {
      local: {
        get(defaults, callback) {
          callback({ ...defaults, ...storageData });
        },
      },
      onChanged: {
        addListener(callback) {
          storageChangeListeners.push(callback);
        },
      },
    };
  }

  class HarnessDate extends Date {
    static now() {
      return now;
    }
  }

  const sandbox = {
    GptAndMeShared: shared,
    Element: TestElement,
    URL,
    Date: HarnessDate,
    queueMicrotask,
    document,
    location: { hostname, pathname, href },
    window: {
      addEventListener(type, callback) {
        if (!windowListeners.has(type)) windowListeners.set(type, []);
        windowListeners.get(type).push(callback);
      },
    },
    chrome,
  };

  runScript('content.js', sandbox);

  return {
    document,
    messages,
    setNow(value) {
      now = value;
    },
    dispatch(type, event) {
      document.dispatch(type, event);
    },
    emitStorageChange(changes, namespace = 'local') {
      for (const callback of storageChangeListeners) {
        callback(changes, namespace);
      }
    },
  };
}

function createPopupScriptHarness(storageData = {}) {
  const document = createTestDocument([
    'today',
    'week',
    'month',
    'last24',
    'streak',
    'total',
    'cost',
    'sessions',
    'modelSection',
    'modelBreakdown',
    'sparkline',
    'statusValue',
    'currentSite',
    'pageCounterToggle',
    'version',
    'lastCounted',
    'lastReason',
    'importCsv',
    'importCsvInput',
    'importStatus',
    'resetToday',
    'resetAll',
    'downloadCsv',
  ]);
  const objectUrls = new Map();
  const revokedUrls = [];
  const sets = [];
  let nextUrlId = 0;

  const sandbox = {
    GptAndMeShared: shared,
    Blob: class TestBlob {
      constructor(parts, options = {}) {
        this.parts = parts;
        this.type = options.type || '';
        this.text = parts.join('');
      }
    },
    URL: {
      createObjectURL(blob) {
        const url = `blob:test-${nextUrlId}`;
        nextUrlId += 1;
        objectUrls.set(url, blob);
        return url;
      },
      revokeObjectURL(url) {
        revokedUrls.push(url);
      },
    },
    document,
    chrome: {
      runtime: {
        getManifest() {
          return { version: 'test-version' };
        },
        sendMessage(message, callback) {
          if (message.type === 'importData') {
            Object.assign(storageData, message.payload.data);
            callback?.({ ok: true, import: { total: storageData.total || 0 } });
            return;
          }
          callback?.({ ok: false, error: 'unknown message' });
        },
      },
      storage: {
        local: {
          get(defaults, callback) {
            callback({ ...defaults, ...storageData });
          },
          set(data, callback) {
            Object.assign(storageData, data);
            sets.push(data);
            callback?.();
          },
        },
        onChanged: {
          addListener() {},
        },
      },
      tabs: {
        query(query, callback) {
          callback([{ url: storageData.activeTabUrl || 'https://chatgpt.com/' }]);
        },
      },
    },
  };

  runScript('popup.js', sandbox);

  return {
    document,
    objectUrls,
    revokedUrls,
    sets,
    fireDOMContentLoaded() {
      document.dispatch('DOMContentLoaded');
    },
    click(id) {
      document.getElementById(id).click();
    },
    lastDownloadText() {
      const download = document.downloads.at(-1);
      if (!download) return null;
      return objectUrls.get(download.href)?.text || null;
    },
    lastDownload() {
      return document.downloads.at(-1) || null;
    },
  };
}

module.exports = {
  ...shared,
  TestElement,
  createContentScriptHarness,
  createPopupScriptHarness,
};
