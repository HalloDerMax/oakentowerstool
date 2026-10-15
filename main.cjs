/* Oaken Tower Overlay – Electron main process.
 * Two windows:
 *   panel  – the planner overlay (your tower, best buys, roll or level), always on top, movable
 *   hints  – a transparent, click-through layer over the whole display that draws tips above the shop items
 * The game is only *seen*: a screenshot of the display is taken now and then and the calibrated shop/tower
 * boxes are cut out and sent to the panel, which matches them against the item icons. Nothing reads the
 * game's memory or files. Our own windows are excluded from the screenshots (content protection).
 *
 * Hotkeys: Ctrl+Shift+O show/hide · Ctrl+Shift+L lock (click-through) · Ctrl+Shift+K calibrate · Ctrl+Shift+S scan on/off
 *          Ctrl+Shift+Up/Down panel more / less see-through
 */
const {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  screen: displays,
  Tray,
} = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.OAKEN_DEV_URL || '';
// separate settings for tests
if (process.env.OAKEN_USER_DATA) app.setPath('userData', process.env.OAKEN_USER_DATA);
const RENDERER = path.join(__dirname, 'app', 'renderer');
const CONFIG = () => path.join(app.getPath('userData'), 'overlay.json');

protocol.registerSchemesAsPrivileged([
  { scheme: 'oaken', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/** @type {{ displayId?: number, shop?: {x:number,y:number,w:number,h:number,n:number}[], tower?: {x:number,y:number,w:number,h:number,cols:number,rows:number}, panel?: {x:number,y:number,width:number,height:number}, scan?: boolean, autoTower?: boolean }} */
let config = {};
function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG(), 'utf8'));
  } catch {
    config = {};
  }
  // older settings had one shop box
  if (config.shop && !Array.isArray(config.shop)) config.shop = [config.shop];
  if (config.scan === undefined) config.scan = true;
  config.opacity = Math.max(0.2, Math.min(1, Number(config.opacity) || 1));
  if (config.autoTower === undefined) config.autoTower = true;
}
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG()), { recursive: true });
    fs.writeFileSync(CONFIG(), JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('config not saved', e);
  }
}

/** @type {BrowserWindow | null} */ let panel = null;
/** @type {BrowserWindow | null} */ let hints = null;
/** @type {Tray | null} */ let tray = null;
let locked = false;
let visible = true;
let calibrating = false;

const url = (page) => (DEV_URL ? DEV_URL.replace(/\/$/, '') + '/' + page : 'oaken://app/' + page);

function gameDisplay() {
  const all = displays.getAllDisplays();
  return all.find((d) => d.id === config.displayId) || displays.getPrimaryDisplay();
}

const common = {
  show: false,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: false,
  webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
};

function createPanel() {
  const d = gameDisplay().workArea;
  const b = config.panel || { width: 360, height: 640, x: d.x + d.width - 380, y: d.y + 80 };
  panel = new BrowserWindow({
    ...common,
    ...b,
    minWidth: 300,
    minHeight: 220,
    title: 'Oaken Tower Overlay',
    backgroundColor: '#120d0a',
    resizable: true,
  });
  panel.setAlwaysOnTop(true, 'screen-saver');
  panel.setContentProtection(true);
  panel.loadURL(url('panel.html'));
  panel.once('ready-to-show', () => {
    if (!panel) return;
    applyOpacity();
    panel.show();
  });
  const remember = () => {
    if (!panel || panel.isDestroyed()) return;
    config.panel = panel.getBounds();
    saveConfig();
  };
  panel.on('moved', remember);
  panel.on('resized', remember);
  panel.on('closed', () => {
    panel = null;
    app.quit();
  });
}

function createHints() {
  const d = gameDisplay().bounds;
  hints = new BrowserWindow({
    ...common,
    x: d.x,
    y: d.y,
    width: d.width,
    height: d.height,
    transparent: true,
    backgroundColor: '#00000000',
    focusable: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
  });
  hints.setAlwaysOnTop(true, 'screen-saver');
  hints.setContentProtection(true);
  hints.setIgnoreMouseEvents(true);
  hints.loadURL(url('hints.html'));
  hints.once('ready-to-show', () => hints && visible && hints.showInactive());
}

function placeHints() {
  if (!hints) return;
  hints.setBounds(gameDisplay().bounds);
}

function send(win, channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}
function state() {
  return { config, locked, visible, calibrating, display: gameDisplay().bounds };
}
function broadcast() {
  send(panel, 'state', state());
  send(hints, 'state', state());
  updateTray();
}

/** see-through panel: 20–100 %, so the game stays visible behind it */
function applyOpacity() {
  if (panel && !panel.isDestroyed()) panel.setOpacity(config.opacity);
}
function stepOpacity(d) {
  config.opacity = Math.round(Math.max(0.2, Math.min(1, config.opacity + d)) * 100) / 100;
  applyOpacity();
  saveConfig();
  broadcast();
}

function setLocked(on) {
  locked = on;
  if (panel) {
    panel.setIgnoreMouseEvents(on, { forward: true });
    applyOpacity();
  }
  broadcast();
}
function setVisible(on) {
  visible = on;
  for (const w of [panel, hints]) {
    if (!w) continue;
    if (on && w === hints) w.showInactive();
    else if (on) w.show();
    else w.hide();
  }
  broadcast();
}
function startCalibration() {
  // calibrate on the display under the mouse: that is where the game is
  const d = displays.getDisplayNearestPoint(displays.getCursorScreenPoint());
  config.displayId = d.id;
  placeHints();
  calibrating = true;
  if (!visible) setVisible(true);
  if (hints) {
    hints.setFocusable(true);
    hints.setIgnoreMouseEvents(false);
    hints.focus();
  }
  broadcast();
}
function endCalibration() {
  calibrating = false;
  if (hints) {
    hints.setIgnoreMouseEvents(true);
    hints.setFocusable(false);
  }
  broadcast();
}

/* ---------- screen capture: cut the calibrated boxes out of a screenshot of the game display ---------- */
let sources = null;
async function capture() {
  if (!config.shop?.length && !config.tower) return null;
  const d = gameDisplay();
  const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
  if (!src) return null;
  const img = src.thumbnail;
  const full = img.getSize();
  const cut = (r) => {
    if (!r) return null;
    const rect = {
      x: Math.max(0, Math.round(r.x * full.width)),
      y: Math.max(0, Math.round(r.y * full.height)),
      width: Math.max(1, Math.round(r.w * full.width)),
      height: Math.max(1, Math.round(r.h * full.height)),
    };
    rect.width = Math.min(rect.width, full.width - rect.x);
    rect.height = Math.min(rect.height, full.height - rect.y);
    const part = img.crop(rect);
    const s = part.getSize();
    // toBitmap is BGRA on Windows; the renderer swaps it to RGBA
    return { w: s.width, h: s.height, bgra: true, data: part.toBitmap() };
  };
  return { shop: (config.shop || []).map(cut), tower: cut(config.tower) };
}

/* ---------- live plan: shared by the panel and the website planner ----------
 * A small server on 127.0.0.1 only (not reachable from other PCs). The planner page links to it when the
 * user clicks "Link desktop app"; only our site's origins may use it (OAKEN_ORIGINS adds more, comma separated).
 */
const LINK_PORT = 47321;
const ORIGINS = ['https://oaken.hallodasevent.de'].concat(
  (process.env.OAKEN_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const ID = /^[a-z0-9_]{1,48}$/;
/** structural check; the pages check the ids against the game data */
function cleanPlan(x) {
  if (!x || typeof x !== 'object' || !Array.isArray(x.cells)) return null;
  const cells = Array.from({ length: 6 }, (_, i) => {
    const c = x.cells[i];
    return c && typeof c.id === 'string' && ID.test(c.id) ? { id: c.id, star: Math.max(0, Math.min(3, Number(c.star) | 0)) } : null;
  });
  const perk = typeof x.perk === 'string' && ID.test(x.perk) ? x.perk : '';
  const day = Math.max(1, Math.min(16, Number(x.day) | 0 || 1));
  return { cells, perk, day };
}
let plan = null;
let planFrom = '';
const listeners = new Set();
let planSave = null;
function setPlan(p, from) {
  const c = cleanPlan(p);
  if (!c || JSON.stringify(c) === JSON.stringify(plan)) return;
  plan = c;
  planFrom = from;
  const msg = 'data: ' + JSON.stringify({ client: from, plan }) + '\n\n';
  for (const res of listeners) res.write(msg);
  send(panel, 'plan', { client: from, plan });
  clearTimeout(planSave);
  planSave = setTimeout(() => {
    config.plan = plan;
    saveConfig();
  }, 500);
}
function startLinkServer() {
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin || '';
    if (origin && !ORIGINS.includes(origin) && !LOCAL_ORIGIN.test(origin)) {
      res.writeHead(403).end();
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
    const url = (req.url || '').split('?')[0];
    if (req.method === 'GET' && url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 5000\n');
      res.write('data: ' + JSON.stringify({ client: planFrom, plan }) + '\n\n');
      listeners.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        listeners.delete(res);
      });
      return;
    }
    if (req.method === 'GET' && url === '/plan') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ plan }));
      return;
    }
    if (req.method === 'POST' && url === '/plan') {
      let body = '';
      req.on('data', (d) => {
        body += d;
        if (body.length > 8192) req.destroy();
      });
      req.on('end', () => {
        try {
          const m = JSON.parse(body);
          setPlan(m.plan, typeof m.client === 'string' ? m.client.slice(0, 16) : 'web');
          res.writeHead(204).end();
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }
    res.writeHead(404).end();
  });
  server.on('error', (e) => console.error('plan link not available:', e.message));
  server.listen(LINK_PORT, '127.0.0.1');
}

/* ---------- tray ---------- */
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: visible ? 'Hide overlay (Ctrl+Shift+O)' : 'Show overlay (Ctrl+Shift+O)', click: () => setVisible(!visible) },
      { label: locked ? 'Unlock panel (Ctrl+Shift+L)' : 'Lock panel, click-through (Ctrl+Shift+L)', click: () => setLocked(!locked) },
      { label: 'Calibrate shop and tower (Ctrl+Shift+K)', click: startCalibration },
      {
        label: 'Scan the shop (Ctrl+Shift+S)',
        type: 'checkbox',
        checked: !!config.scan,
        click: () => {
          config.scan = !config.scan;
          saveConfig();
          broadcast();
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.setToolTip('Oaken Tower Overlay');
}

// one app at a time: a second start brings the running one to the front
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();
app.on('second-instance', () => setVisible(true));

app.whenReady().then(() => {
  if (!firstInstance) return;
  loadConfig();
  plan = cleanPlan(config.plan) || { cells: [null, null, null, null, null, null], perk: '', day: 1 };
  startLinkServer();
  protocol.handle('oaken', (req) => {
    const u = new URL(req.url);
    const file = path.normalize(path.join(RENDERER, decodeURIComponent(u.pathname)));
    if (!file.startsWith(RENDERER)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // the panel's screen stream: answered here without a picker, only for our own page, with the game display
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    const from = req.frame ? req.frame.url : '';
    if (!(from.startsWith('oaken://app/') || (DEV_URL && from.startsWith(DEV_URL)))) return cb({});
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((list) => {
        const d = gameDisplay();
        const src = list.find((s) => String(s.display_id) === String(d.id)) || list[0];
        cb(src ? { video: src } : {});
      })
      .catch(() => cb({}));
  });
  ipcMain.handle('capture', () => capture());
  ipcMain.handle('plan:get', () => plan);
  ipcMain.on('plan:set', (_e, p) => setPlan(p, 'app'));
  ipcMain.handle('state', () => state());
  ipcMain.handle('set', (_e, patch) => {
    // only known keys from our own pages
    for (const k of ['shop', 'tower', 'scan', 'autoTower']) if (k in patch) config[k] = patch[k];
    if ('opacity' in patch) {
      config.opacity = Math.max(0.2, Math.min(1, Number(patch.opacity) || 1));
      applyOpacity();
    }
    saveConfig();
    broadcast();
    return state();
  });
  ipcMain.on('hints', (_e, data) => send(hints, 'hints', data));
  ipcMain.on('calibrate', () => startCalibration());
  ipcMain.on('calibrated', () => endCalibration());
  ipcMain.on('lock', (_e, on) => setLocked(!!on));
  ipcMain.on('hide', () => setVisible(false));
  ipcMain.on('quit', () => app.quit());

  createPanel();
  createHints();

  const iconFile = path.join(__dirname, 'build', 'icon.png');
  if (fs.existsSync(iconFile)) {
    tray = new Tray(nativeImage.createFromPath(iconFile).resize({ width: 16, height: 16 }));
    tray.on('click', () => setVisible(!visible));
    updateTray();
  }

  globalShortcut.register('CommandOrControl+Shift+O', () => setVisible(!visible));
  globalShortcut.register('CommandOrControl+Shift+L', () => setLocked(!locked));
  globalShortcut.register('CommandOrControl+Shift+K', () => (calibrating ? endCalibration() : startCalibration()));
  globalShortcut.register('CommandOrControl+Shift+Up', () => stepOpacity(0.1));
  globalShortcut.register('CommandOrControl+Shift+Down', () => stepOpacity(-0.1));
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    config.scan = !config.scan;
    saveConfig();
    broadcast();
  });
  displays.on('display-metrics-changed', placeHints);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
