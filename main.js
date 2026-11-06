// RARA POS — Electron main process.
// Local-only offline desktop app. No remote content is ever loaded:
// the window only loads the bundled local index.html.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

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

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
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
