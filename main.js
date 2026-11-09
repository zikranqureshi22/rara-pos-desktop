// RARA POS — Electron main process.
// Local-only offline desktop app. No remote content is ever loaded:
// the window only loads the bundled local index.html.
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Self auto-update (electron-updater, GitHub provider).
// The repo is PRIVATE, so GitHub Releases cannot be downloaded without
// authentication. The Owner pastes a read-only fine-grained token ONCE in
// the app (Settings > Updates); it is stored ONLY here, in a file inside
// the app-data folder — never in the repo, never in code, never in logs.
// The token is a fine-grained PAT with read-only access to this one repo
// (Contents: Read-only) and can be revoked/rotated anytime on GitHub.
// Without a token, update checks fail gracefully with a Roman Urdu
// notice telling the Owner the token is needed — never a crash.
// ---------------------------------------------------------------------------
const UPDATE_OWNER = 'zikranqureshi22';
const UPDATE_REPO = 'rara-pos-desktop';
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch (e) { autoUpdater = null; }
let mainWin = null;
let updateStateCache = { autoCheck: true, lastCheck: null, status: 'idle', downloadedVersion: null };
let lastProgressBucket = -1;

function updateTokenPath() { return path.join(app.getPath('userData'), 'update-token.json'); }
function updateStatePath() { return path.join(app.getPath('userData'), 'update-state.json'); }
function readUpdateToken() {
  try {
    const raw = fs.readFileSync(updateTokenPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const t = parsed && typeof parsed.token === 'string' ? parsed.token.trim() : '';
    return t || null;
  } catch (e) { return null; }
}
function writeUpdateToken(token) {
  fs.writeFileSync(updateTokenPath(), JSON.stringify({ token }), 'utf8');
}
function clearUpdateToken() {
  try { fs.unlinkSync(updateTokenPath()); } catch (e) { /* already gone */ }
}
function readUpdateState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(updateStatePath(), 'utf8'));
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.autoCheck === 'boolean') updateStateCache.autoCheck = parsed.autoCheck;
      if (parsed.lastCheck) updateStateCache.lastCheck = parsed.lastCheck;
    }
  } catch (e) { /* first run — defaults stand */ }
  return updateStateCache;
}
function writeUpdateState() {
  try { fs.writeFileSync(updateStatePath(), JSON.stringify({ autoCheck: updateStateCache.autoCheck, lastCheck: updateStateCache.lastCheck }), 'utf8'); } catch (e) { /* ignore */ }
}
function sendUpdateEvent(evt) {
  // evt carries only a type + safe fields (version, percent, message) —
  // the token is never put in an event or a log line.
  try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('update-event', evt); } catch (e) { /* ignore */ }
}
function setUpdateStatus(status) {
  updateStateCache.status = status;
  if (status === 'downloaded' || status === 'available' || status === 'none' || status === 'error' || status === 'no-token') {
    updateStateCache.lastCheck = new Date().toISOString();
    writeUpdateState();
  }
  sendUpdateEvent({ type: 'status', status, version: updateStateCache.downloadedVersion, lastCheck: updateStateCache.lastCheck });
}
function configureUpdaterFeed() {
  if (!autoUpdater) return false;
  const token = readUpdateToken();
  if (!token) return false;
  try {
    autoUpdater.setFeedURL({ provider: 'github', owner: UPDATE_OWNER, repo: UPDATE_REPO, private: true, token });
    return true;
  } catch (e) { return false; }
}
function checkForUpdates(manual) {
  // Order matters: the token question is answered first, so a manual
  // check with no token saved always explains that clearly — even in a
  // development run, where the packaged-app check below would stop it.
  if (!autoUpdater) {
    setUpdateStatus('error');
    sendUpdateEvent({ type: 'error', message: 'Update system available nahi hai — dobara install karein' });
    return;
  }
  if (!readUpdateToken()) {
    setUpdateStatus('no-token');
    sendUpdateEvent({ type: 'no-token', message: 'Update ke liye token chahiye — Settings > Updates me GitHub token dalein' });
    return;
  }
  if (!app.isPackaged) {
    setUpdateStatus('error');
    sendUpdateEvent({ type: 'error', message: 'Ye development run hai — update check sirf install ki hui app me chalta hai' });
    return;
  }
  if (!configureUpdaterFeed()) {
    setUpdateStatus('error');
    sendUpdateEvent({ type: 'error', message: 'Update check shuru nahi ho saka — dobara koshish karein' });
    return;
  }
  updateStateCache.status = 'checking';
  sendUpdateEvent({ type: 'status', status: 'checking', lastCheck: updateStateCache.lastCheck });
  lastProgressBucket = -1;
  autoUpdater.checkForUpdates().catch(() => {
    // Errors are also reported through the 'error' event below; this
    // catch only stops an unhandled rejection from escaping.
  });
}
function setupAutoUpdater() {
  if (!autoUpdater) return;
  readUpdateState();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('update-available', (info) => {
    updateStateCache.downloadedVersion = null;
    setUpdateStatus('available');
    sendUpdateEvent({ type: 'available', version: info && info.version ? String(info.version) : '' });
  });
  autoUpdater.on('update-not-available', () => {
    setUpdateStatus('none');
    sendUpdateEvent({ type: 'none', message: 'App pehle se latest version par hai' });
  });
  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round((p && p.percent) || 0);
    const bucket = Math.floor(pct / 10);
    if (bucket === lastProgressBucket) return; // one notice per 10% step
    lastProgressBucket = bucket;
    sendUpdateEvent({ type: 'progress', percent: pct });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateStateCache.downloadedVersion = info && info.version ? String(info.version) : '';
    setUpdateStatus('downloaded');
    sendUpdateEvent({ type: 'downloaded', version: updateStateCache.downloadedVersion });
  });
  autoUpdater.on('error', (err) => {
    // Never surface raw errors (they can contain URLs/paths); the
    // renderer shows a short Roman Urdu notice instead.
    setUpdateStatus('error');
    const msg = (err && err.message) || '';
    const friendly = /404|not found/i.test(msg)
      ? 'Update nahi mila — token check karein (Settings > Updates)'
      : /ENOTFOUND|ECONN|network|offline/i.test(msg)
        ? 'Internet nahi hai — connection check kar ke dobara koshish karein'
        : 'Update check nahi ho saka — dobara koshish karein';
    sendUpdateEvent({ type: 'error', message: friendly });
  });
  ipcMain.handle('update-get-state', () => ({
    version: app.getVersion(),
    hasToken: !!readUpdateToken(),
    autoCheck: updateStateCache.autoCheck,
    lastCheck: updateStateCache.lastCheck,
    status: updateStateCache.status,
    downloadedVersion: updateStateCache.downloadedVersion,
    packaged: app.isPackaged,
  }));
  ipcMain.on('update-check-now', () => checkForUpdates(true));
  ipcMain.on('update-save-token', (_e, token) => {
    if (typeof token === 'string' && token.trim()) { writeUpdateToken(token.trim()); configureUpdaterFeed(); }
  });
  ipcMain.on('update-clear-token', () => { clearUpdateToken(); });
  ipcMain.on('update-set-auto-check', (_e, on) => {
    updateStateCache.autoCheck = !!on;
    writeUpdateState();
  });
  ipcMain.on('update-quit-install', () => {
    try { if (autoUpdater) autoUpdater.quitAndInstall(false, true); } catch (e) { /* ignore */ }
  });
}

// ---------------------------------------------------------------------------
// Thermal receipt printing (v1.1.2): the printed receipt must be exactly one
// page whose length matches the bill content. CSS alone cannot do that
// (measured: @page size:80mm auto is invalid in Blink, and a square 80mm
// page splits a 3-item bill across 2 pages mid-bill). So the renderer
// measures the rendered receipt height and the main process prints it with
// Electron's pageSize option — 72mm wide (v1.1.3), content height, one copy, no
// margins. The token/auto-update code above is untouched.
// ---------------------------------------------------------------------------
ipcMain.handle('printer-list', async () => {
  try {
    if (!mainWin || mainWin.isDestroyed()) return [];
    const printers = await mainWin.webContents.getPrintersAsync();
    return (printers || []).map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
  } catch (e) { return []; }
});
ipcMain.handle('print-receipt', async (_e, opts) => {
  try {
    if (!mainWin || mainWin.isDestroyed()) return { ok: false, error: 'no-window' };
    const height = opts && Number(opts.heightMicrons);
    const deviceName = opts && typeof opts.deviceName === 'string' ? opts.deviceName.trim() : '';
    if (!deviceName) return { ok: false, error: 'no-printer' };
    if (!height || height < 20000 || height > 600000) return { ok: false, error: 'bad-height' };
    await mainWin.webContents.print({
      silent: true,
      deviceName,
      pageSize: { width: 72000, height: Math.round(height) },
      margins: { marginType: 'none' },
      printBackground: false,
      copies: 1
    });
    return { ok: true };
  } catch (e) {
    // Never surface raw errors (they can contain paths); the renderer
    // shows a short Roman Urdu notice and falls back to the dialog.
    return { ok: false, error: 'print-failed' };
  }
});

// Automatic backup on close: copy the live data file into
// <userData>/backups with a timestamp and verify it parses, so the
// last good state always survives a bad shutdown. Keeps the last 7.
// This runs synchronously in the window 'close' handler — it never
// blocks quitting for long (a few ms on a small JSON file) and any
// failure is swallowed, never shown to the user as a crash.
function backupOnClose() {
  try {
    const userData = app.getPath('userData');
    const dataFile = path.join(userData, 'rara-pos-data.json');
    if (!fs.existsSync(dataFile)) return;
    const backupDir = path.join(userData, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const now = new Date();
    const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') +
      '_' + String(now.getHours()).padStart(2, '0') + '-' + String(now.getMinutes()).padStart(2, '0') + '-' + String(now.getSeconds()).padStart(2, '0') +
      '-' + String(now.getMilliseconds()).padStart(3, '0');
    const dest = path.join(backupDir, 'rara-pos-backup-' + stamp + '.json');
    fs.copyFileSync(dataFile, dest);
    // Verify the copy parses — a backup that cannot be read is useless.
    JSON.parse(fs.readFileSync(dest, 'utf8'));
    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith('rara-pos-backup-') && f.endsWith('.json'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    files.slice(7).forEach((f) => { try { fs.unlinkSync(path.join(backupDir, f.name)); } catch (e) { /* ignore */ } });
  } catch (e) { /* backup failure must never stop the app closing */ }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWin = win;

  win.on('close', () => { backupOnClose(); });

  win.loadFile(path.join(__dirname, 'index.html'));
  // Auto-update check, delayed so first paint is never blocked. Only
  // runs in the installed (packaged) app and only when the Owner left
  // auto-check ON (default). A missing token is reported, not fatal.
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      try {
        if (app.isPackaged && updateStateCache.autoCheck) checkForUpdates(false);
      } catch (e) { /* update check must never break startup */ }
    }, 8000);
  });
}

app.whenReady().then(() => {
  setupAutoUpdater();
  // The renderer cannot call app.getPath() itself (app lives in the
  // main process), so hand it the data folder through the environment
  // before the window is created — src/db.js reads RARA_DATA_DIR
  // first and stores the live data in <userData>/rara-pos-data.json.
  // Without this, the renderer would fall back to ./data next to the
  // code, which is read-only inside the packaged app.
  process.env.RARA_DATA_DIR = app.getPath('userData');
  // No default application menu — the POS provides its own in-app navigation.
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // On Windows (and Linux) quit when every window is closed.
  // On macOS apps conventionally stay alive; this app targets Windows.
  if (process.platform !== 'darwin') app.quit();
});
