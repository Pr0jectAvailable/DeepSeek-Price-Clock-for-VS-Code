'use strict';

const vscode = require('vscode');
const { createSchedule, RATES } = require('./price');

const SECTION = 'deepseekPriceClock';
const PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing';

let statusItem;
let panel;
let schedule;
let lastPeak = null;
let timer;

function cfg() {
  return vscode.workspace.getConfiguration(SECTION);
}

function rebuildSchedule() {
  schedule = createSchedule({ extraOffPeakDates: cfg().get('extraOffPeakDates', []) });
}

function tzMode() {
  return cfg().get('timeZone', 'local') === 'utc' ? 'utc' : 'local';
}

function fmtTime(ms) {
  const utc = tzMode() === 'utc';
  const t = new Date(ms).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: utc ? 'UTC' : undefined,
  });
  return utc ? `${t} UTC` : t;
}

function fmtDay(ms) {
  const utc = tzMode() === 'utc';
  return new Date(ms).toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: utc ? 'UTC' : undefined,
  });
}

function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) return `${Math.floor(h / 24)}д ${h % 24}ч`;
  return h > 0 ? `${h}ч ${String(m).padStart(2, '0')}м` : `${m}м`;
}

function updateStatusBar(now = Date.now()) {
  const st = schedule.state(now);
  const left = st.nextChange ? st.nextChange - now : null;
  const showCountdown = cfg().get('showCountdownInStatusBar', true) && left !== null;

  if (st.peak) {
    statusItem.text = `$(flame) DeepSeek ПИК${showCountdown ? ' · ' + fmtDuration(left) : ''}`;
    statusItem.color = undefined;
    statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else {
    statusItem.text = `$(check) DeepSeek ½ цены${showCountdown ? ' · ' + fmtDuration(left) : ''}`;
    statusItem.color = new vscode.ThemeColor('testing.iconPassed');
    statusItem.backgroundColor = undefined;
  }

  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: [`${SECTION}.openPanel`, `${SECTION}.toggleTimeZone`] };
  md.appendMarkdown(`**DeepSeek API: ${st.peak ? 'пиковая цена' : 'off-peak (половина цены)'}**\n\n`);
  if (st.nextChange) {
    md.appendMarkdown(
      `${st.peak ? 'Пик закончится' : 'Пик начнётся'}: ${fmtDay(st.nextChange)}, ${fmtTime(st.nextChange)} ` +
        `(через ${fmtDuration(left)})\n\n`,
    );
  }
  md.appendMarkdown(
    `[Открыть панель](command:${SECTION}.openPanel) · [Локальное / UTC](command:${SECTION}.toggleTimeZone)`,
  );
  statusItem.tooltip = md;

  if (lastPeak !== null && lastPeak !== st.peak && cfg().get('notifyOnChange', false)) {
    vscode.window.showInformationMessage(
      st.peak
        ? 'DeepSeek API: началось пиковое окно — цена x2.'
        : 'DeepSeek API: off-peak — теперь половина цены.',
    );
  }
  lastPeak = st.peak;
}

/** Данные для панели: всё считается здесь, веб-вью только рисует. */
function buildPanelData(now = Date.now()) {
  const utc = tzMode() === 'utc';
  const d = new Date(now);
  let dayStart;
  let dayEnd;
  if (utc) {
    dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    dayEnd = dayStart + 86400000;
  } else {
    dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }
  const st = schedule.state(now);
  return {
    now,
    peak: st.peak,
    nextChange: st.nextChange,
    utc,
    dayStart,
    dayEnd,
    segments: schedule.segments(dayStart, dayEnd, 15),
    upcoming: schedule.transitions(now, 8),
    rates: RATES,
    pricingUrl: PRICING_URL,
  };
}

function pushPanelState() {
  if (panel) panel.webview.postMessage({ type: 'state', data: buildPanelData() });
}

function tick() {
  updateStatusBar();
  pushPanelState();
}

function openPanel(context) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, true);
    pushPanelState();
    return;
  }
  panel = vscode.window.createWebviewPanel(
    'deepseekPriceClock',
    'DeepSeek Price Clock',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true },
  );
  panel.webview.html = getHtml();
  panel.webview.onDidReceiveMessage(
    (msg) => {
      if (msg.type === 'ready') pushPanelState();
      if (msg.type === 'toggleTz') vscode.commands.executeCommand(`${SECTION}.toggleTimeZone`);
    },
    undefined,
    context.subscriptions,
  );
  panel.onDidDispose(() => (panel = undefined), undefined, context.subscriptions);
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function getHtml() {
  const nonce = getNonce();
  return /* html */ `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  :root { --ok: var(--vscode-testing-iconPassed, #3fb950); --bad: var(--vscode-errorForeground, #f85149); }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px 24px; max-width: 760px; }
  h1 { font-size: 1.1em; font-weight: 600; margin: 0 0 12px; }
  .hero { display: flex; align-items: center; gap: 16px; padding: 16px; border-radius: 8px;
          border: 1px solid var(--vscode-panel-border); margin-bottom: 20px; }
  .badge { font-size: 1.1em; font-weight: 700; padding: 6px 12px; border-radius: 6px; color: #fff; white-space: nowrap; }
  .badge.off { background: var(--ok); } .badge.peak { background: var(--bad); }
  .count { font-size: 2em; font-variant-numeric: tabular-nums; font-weight: 600; line-height: 1.1; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-top: 2px; }
  h2 { font-size: 0.95em; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); }
  .timeline { position: relative; height: 28px; display: flex; border-radius: 4px; overflow: hidden;
              border: 1px solid var(--vscode-panel-border); }
  .timeline div.seg { flex: 1; } .seg.off { background: var(--ok); opacity: .55; } .seg.peak { background: var(--bad); opacity: .85; }
  .marker { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--vscode-foreground); }
  .ticks { position: relative; height: 18px; margin-top: 4px; font-size: 0.8em; color: var(--vscode-descriptionForeground); }
  .ticks span { position: absolute; transform: translateX(-50%); }
  .legend { display: flex; gap: 16px; font-size: 0.85em; margin-top: 6px; color: var(--vscode-descriptionForeground); }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
  table { border-collapse: collapse; width: 100%; font-size: 0.92em; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 5px 10px 5px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  th { font-weight: 600; color: var(--vscode-descriptionForeground); }
  td.num, th.num { text-align: right; } td.now { font-weight: 700; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 10px; }
  li .when { width: 150px; color: var(--vscode-descriptionForeground); }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
           border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .foot { margin-top: 20px; font-size: 0.82em; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h1>DeepSeek API · окна цен</h1>
<div id="root"><div class="sub">Загрузка…</div></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let data = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function tz() { return data && data.utc ? 'UTC' : undefined; }
  function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz() });
  }
  function fmtDay(ms) {
    return new Date(ms).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz() });
  }
  function fmtCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return (d ? d + 'д ' : '') + p(h) + ':' + p(m) + ':' + p(sec);
  }
  const money = (n) => '$' + (n < 0.01 ? n.toFixed(4).replace(/0+$/, '') : n.toFixed(2));

  function render() {
    if (!data) return;
    const d = data;
    const zone = d.utc ? 'UTC' : 'локальное время';

    const segs = d.segments.map((p) => '<div class="seg ' + (p ? 'peak' : 'off') + '"></div>').join('');
    let ticks = '';
    for (let k = 0; k <= 24; k += 3) {
      const t = d.dayStart + (d.dayEnd - d.dayStart) * (k / 24);
      ticks += '<span style="left:' + (k / 24 * 100) + '%">' + esc(fmtTime(t)) + '</span>';
    }

    const rows = d.rates.map((r) => {
      const peakCls = d.peak ? ' now' : '', offCls = d.peak ? '' : ' now';
      return '<tr><td>' + esc(r.model) + '</td>'
        + '<td class="num' + peakCls + '">' + money(r.input) + ' / ' + money(r.cached) + ' / ' + money(r.output) + '</td>'
        + '<td class="num' + offCls + '">' + money(r.input / 2) + ' / ' + money(r.cached / 2) + ' / ' + money(r.output / 2) + '</td></tr>';
    }).join('');

    const upcoming = d.upcoming.map((u) =>
      '<li><span class="when">' + esc(fmtDay(u.t)) + ', ' + esc(fmtTime(u.t)) + '</span><span>'
      + (u.peak ? '🔴 начинается пик (цена ×2)' : '🟢 начинается off-peak (½ цены)') + '</span></li>'
    ).join('');

    $('root').innerHTML =
      '<div class="hero"><span class="badge ' + (d.peak ? 'peak' : 'off') + '">' + (d.peak ? 'ПИК' : 'OFF-PEAK · ½ цены') + '</span>'
      + '<div><div class="count" id="count"></div><div class="sub" id="sub"></div></div></div>'
      + '<h2>Сегодня · ' + esc(zone) + '</h2>'
      + '<div class="timeline">' + segs + '<div class="marker" id="marker"></div></div>'
      + '<div class="ticks">' + ticks + '</div>'
      + '<div class="legend"><span><i class="dot" style="background:var(--ok);opacity:.55"></i>off-peak</span>'
      + '<span><i class="dot" style="background:var(--bad)"></i>пик</span></div>'
      + '<h2>Ближайшие смены</h2><ul>' + upcoming + '</ul>'
      + '<h2>Цены, за 1M токенов (input miss / cache hit / output)</h2>'
      + '<table><tr><th>Модель</th><th class="num">Пик</th><th class="num">Off-peak</th></tr>' + rows + '</table>'
      + '<p><button id="tzbtn">Показывать: ' + (d.utc ? 'UTC → локальное' : 'локальное → UTC') + '</button></p>'
      + '<div class="foot">Пик: пн–пт 01:00–04:00 и 06:00–10:00 UTC, кроме праздников Китая; выходные и праздники — off-peak. '
      + 'Цены в таблице могут устареть — проверяйте на <span>' + esc(d.pricingUrl) + '</span>.</div>';

    $('tzbtn').addEventListener('click', () => vscode.postMessage({ type: 'toggleTz' }));
    tickCountdown();
  }

  let receivedAt = 0;
  function tickCountdown() {
    if (!data) return;
    const now = data.now + (Date.now() - receivedAt);
    const c = $('count'), sub = $('sub'), m = $('marker');
    if (!c) return;
    if (data.nextChange) {
      c.textContent = fmtCountdown(data.nextChange - now);
      sub.textContent = (data.peak ? 'до конца пика' : 'до начала пика') + ' · ' + fmtDay(data.nextChange) + ', ' + fmtTime(data.nextChange);
    } else {
      c.textContent = '—'; sub.textContent = '';
    }
    const frac = (now - data.dayStart) / (data.dayEnd - data.dayStart);
    m.style.left = Math.min(100, Math.max(0, frac * 100)) + '%';
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'state') {
      data = e.data.data;
      receivedAt = Date.now();
      render();
    }
  });
  setInterval(tickCountdown, 1000);
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

function activate(context) {
  rebuildSchedule();

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = `${SECTION}.openPanel`;
  statusItem.name = 'DeepSeek Price Clock';
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand(`${SECTION}.openPanel`, () => openPanel(context)),
    vscode.commands.registerCommand(`${SECTION}.toggleTimeZone`, async () => {
      const next = tzMode() === 'utc' ? 'local' : 'utc';
      await cfg().update('timeZone', next, vscode.ConfigurationTarget.Global);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SECTION)) {
        rebuildSchedule();
        tick();
      }
    }),
  );

  tick();
  timer = setInterval(tick, 15000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function deactivate() {
  if (timer) clearInterval(timer);
}

module.exports = { activate, deactivate };
