const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shared = require('./helpers');

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this.shadowRoot = null;
    this.isConnected = false;
    this.id = '';
    this.className = '';
    this.title = '';
    this._textContent = '';
  }

  appendChild(child) {
    if (child.parentNode) child.remove();
    this.children.push(child);
    child.parentNode = this;
    child.setConnected(this.isConnected);
    this.ownerDocument?.notifyMutation();
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
    this.setConnected(false);
    this.ownerDocument?.notifyMutation();
  }

  setConnected(value) {
    this.isConnected = value;
    for (const child of this.children) child.setConnected(value);
    if (this.shadowRoot) this.shadowRoot.setConnected(value);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  attachShadow(options = {}) {
    this.shadowMode = options.mode || 'open';
    this.shadowRoot = new FakeShadowRoot(this.ownerDocument, this);
    this.shadowRoot.setConnected(this.isConnected);
    return this.shadowRoot;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      if (matchesSelector(element, selector)) matches.push(element);
      for (const child of element.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches;
  }

  get textContent() {
    return `${this._textContent}${this.children.map((child) => child.textContent).join('')}`;
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }
}

class FakeShadowRoot extends FakeElement {
  constructor(ownerDocument, host) {
    super('#shadow-root', ownerDocument);
    this.host = host;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = {};
    this.observers = [];
    this.documentElement = new FakeElement('html', this);
    this.documentElement.setConnected(true);
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.documentElement.append(this.head, this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  getElementById(id) {
    return this.querySelectorAll(`#${id}`)[0] || null;
  }

  notifyMutation() {
    for (const observer of [...this.observers]) {
      if (observer.active) observer.callback([{ type: 'childList' }]);
    }
  }
}

function matchesSelector(element, selector) {
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector === '[data-gptandme-counter-value]') {
    return Object.hasOwn(element.attributes, 'data-gptandme-counter-value');
  }
  if (selector === 'div[data-message-model-slug]') {
    return element.tagName === 'DIV' && Object.hasOwn(element.attributes, 'data-message-model-slug');
  }
  return false;
}

function createMutationObserver(document) {
  return class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      document.observers.push(this);
    }

    observe() {
      this.active = true;
    }

    disconnect() {
      this.active = false;
    }
  };
}

function runContent({ hostname = 'chatgpt.com', storageData = {} } = {}) {
  const document = new FakeDocument();
  const storageListeners = [];
  const windowListeners = {};
  const MutationObserver = createMutationObserver(document);
  const href = `https://${hostname}/`;

  const context = {
    URL,
    console,
    document,
    Element: FakeElement,
    GptAndMeShared: shared,
    location: { hostname, href, pathname: '/' },
    MutationObserver,
    queueMicrotask: (callback) => callback(),
    setInterval: () => 1,
    window: {
      MutationObserver,
      addEventListener(type, listener) {
        windowListeners[type] ||= [];
        windowListeners[type].push(listener);
      },
    },
    chrome: {
      runtime: {
        getURL: (resource) => `chrome-extension://test/${resource}`,
        sendMessage: () => {},
      },
      storage: {
        local: {
          get(defaults, callback) {
            callback({ ...defaults, ...storageData });
          },
        },
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          },
        },
      },
    },
  };
  context.globalThis = context;

  vm.runInNewContext(contentSource, context, { filename: 'content.js' });

  return {
    document,
    emitStorageChange(changes, namespace = 'local') {
      for (const listener of storageListeners) listener(changes, namespace);
    },
  };
}

function widgetHosts(document) {
  return document.querySelectorAll('#gptandme-page-counter');
}

function widgetValue(document) {
  const host = widgetHosts(document)[0];
  return host?.shadowRoot?.querySelector('[data-gptandme-counter-value]')?.textContent;
}

describe('content page counter widget', () => {
  it('inserts a compact widget with today count by default', () => {
    const today = shared.todayKey();
    const { document } = runContent({ storageData: { byDate: { [today]: 7 } } });

    assert.equal(widgetHosts(document).length, 1);
    assert.equal(widgetValue(document), '7');
    assert.equal(widgetHosts(document)[0].shadowMode, 'closed');
    assert.match(widgetHosts(document)[0].shadowRoot.textContent, /today/);
  });

  it('updates from byDate storage changes without duplicating the widget', () => {
    const today = shared.todayKey();
    const { document, emitStorageChange } = runContent({
      storageData: { byDate: { [today]: 1 } },
    });

    emitStorageChange({
      byDate: {
        oldValue: { [today]: 1 },
        newValue: { [today]: 4 },
      },
    });

    assert.equal(widgetHosts(document).length, 1);
    assert.equal(widgetValue(document), '4');
  });

  it('honors the showPageCounter toggle', () => {
    const today = shared.todayKey();
    const { document, emitStorageChange } = runContent({
      storageData: { byDate: { [today]: 2 }, showPageCounter: false },
    });

    assert.equal(widgetHosts(document).length, 0);

    emitStorageChange({
      showPageCounter: { oldValue: false, newValue: true },
    });
    assert.equal(widgetHosts(document).length, 1);
    assert.equal(widgetValue(document), '2');

    emitStorageChange({
      showPageCounter: { oldValue: true, newValue: false },
    });
    assert.equal(widgetHosts(document).length, 0);
  });

  it('reattaches once if the page removes the widget host', () => {
    const today = shared.todayKey();
    const { document } = runContent({ storageData: { byDate: { [today]: 3 } } });

    widgetHosts(document)[0].remove();

    assert.equal(widgetHosts(document).length, 1);
    assert.equal(widgetValue(document), '3');
  });

  it('does not insert on unsupported hosts', () => {
    const today = shared.todayKey();
    const { document } = runContent({
      hostname: 'example.com',
      storageData: { byDate: { [today]: 9 } },
    });

    assert.equal(widgetHosts(document).length, 0);
  });
});
