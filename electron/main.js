const { app, BrowserWindow } = require('electron');
const http = require('http');
const path = require('path');

const SERVER_HOST = process.env.HOST || '127.0.0.1';
const SERVER_PORT = Number(process.env.PORT) || 3434;
const isDev = !app.isPackaged;

function startBackend() {
  process.env.HOST = SERVER_HOST;
  process.env.PORT = String(SERVER_PORT);
  process.env.SESSION_HARBOR_APP_ROOT = process.env.SESSION_HARBOR_APP_ROOT || app.getAppPath();
  process.env.SESSION_HARBOR_DATA_DIR =
    process.env.SESSION_HARBOR_DATA_DIR || path.join(app.getPath('userData'), 'data');
  process.env.SESSION_HARBOR_REPORTS_DIR =
    process.env.SESSION_HARBOR_REPORTS_DIR || path.join(app.getPath('userData'), 'reports');

  const serverPath = path.join(app.getAppPath(), 'dist', 'server.js');
  require(serverPath);
}

function waitForServer(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get({ host: SERVER_HOST, port: SERVER_PORT, path: '/' }, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() > deadline) {
            reject(new Error('Backend did not start in time.'));
            return;
          }
          setTimeout(attempt, 300);
        });
    };
    attempt();
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
    },
    show: false,
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  const url = isDev && process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL
    : `http://${SERVER_HOST}:${SERVER_PORT}`;

  await win.loadURL(url);
}

app.whenReady().then(async () => {
  startBackend();
  await waitForServer();
  await createWindow();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
