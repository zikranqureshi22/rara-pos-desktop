// RARA POS — Electron main process.
// Local-only offline desktop app. No remote content is ever loaded:
// the window only loads the bundled local index.html.
const { app, BrowserWindow, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

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

  win.on('close', () => { backupOnClose(); });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
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
