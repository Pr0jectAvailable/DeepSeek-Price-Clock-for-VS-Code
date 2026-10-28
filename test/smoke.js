'use strict';
// Дымовой тест: подменяем модуль 'vscode' заглушкой, активируем расширение,
// проверяем статус-бар и данные панели, затем прогоняем скрипт веб-вью в jsdom (если установлен).
const Module = require('module');
const assert = require('assert');

const calls = { posted: [], items: [] };
const config = { timeZone: 'utc', notifyOnChange: false, showCountdownInStatusBar: true, extraOffPeakDates: [] };

const vscodeMock = {
  StatusBarAlignment: { Right: 2 },
  ViewColumn: { Beside: -2 },
  ConfigurationTarget: { Global: 1 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  MarkdownString: class { constructor() { this.value = ''; } appendMarkdown(s) { this.value += s; } },
  window: {
    createStatusBarItem() { const it = { show() {}, dispose() {} }; calls.items.push(it); return it; },
    createWebviewPanel() {
      const handlers = {};
      const panel = {
        webview: {
          html: '',
          postMessage(m) { calls.posted.push(m); },
          onDidReceiveMessage(fn) { handlers.msg = fn; },
        },
        reveal() {}, onDidDispose() {},
      };
      calls.panel = panel; calls.handlers = handlers;
      return panel;
    },
    showInformationMessage() {},
  },
  commands: { registerCommand(id, fn) { calls[id] = fn; return { dispose() {} }; }, executeCommand() {} },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d), update: async (k, v) => { config[k] = v; } }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') return vscodeMock;
  return origLoad.call(this, request, ...rest);
};

const ext = require('../src/extension');
const subs = [];
ext.activate({ subscriptions: subs });

const item = calls.items[0];
assert.ok(/DeepSeek/.test(item.text), 'текст статус-бара: ' + item.text);
console.log('status bar :', item.text);
assert.ok(item.tooltip.value.includes('command:deepseekPriceClock.openPanel'));

calls['deepseekPriceClock.openPanel']();
calls.handlers.msg({ type: 'ready' }, undefined);
const msg = calls.posted[calls.posted.length - 1];
assert.strictEqual(msg.type, 'state');
assert.strictEqual(msg.data.segments.length, 96);
assert.strictEqual(msg.data.upcoming.length, 8);
console.log('panel data : peak=%s, segments=%d, upcoming=%d', msg.data.peak, msg.data.segments.length, msg.data.upcoming.length);

// веб-вью: берём <script> и прогоняем в jsdom
const html = calls.panel.webview.html;
const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
new Function('acquireVsCodeApi', 'document', 'window', script); // проверка синтаксиса
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { /* необязательно */ }
if (JSDOM) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { w.acquireVsCodeApi = () => ({ postMessage() {} }); } });
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: msg }));
  const doc = dom.window.document;
  assert.ok(doc.querySelector('.timeline'), 'таймлайн отрисован');
  assert.strictEqual(doc.querySelectorAll('.timeline .seg').length, 96);
  assert.strictEqual(doc.querySelectorAll('ul li').length, 8);
  assert.ok(/\d\d:\d\d:\d\d/.test(doc.getElementById('count').textContent), 'обратный отсчёт');
  console.log('webview    : отрисовано, отсчёт =', doc.getElementById('count').textContent);
  dom.window.close();
} else {
  console.log('webview    : синтаксис скрипта в порядке (jsdom не установлен — рендер не проверялся)');
}

subs.forEach((s) => s.dispose && s.dispose());
ext.deactivate();
console.log('smoke.js: ок');
process.exit(0);
