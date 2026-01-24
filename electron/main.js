const { app, BrowserWindow } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

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

async function installCliBinary() {
  if (!app.isPackaged) {
    return;
  }
  if (process.env.SESSION_HARBOR_SKIP_CLI_INSTALL) {
    return;
  }

  const cliSource = path.join(app.getAppPath(), 'clis', 'session-harbor', 'dist', 'cli.cjs');
  const cliDir = path.join(app.getPath('userData'), 'cli');
  const cliTarget = path.join(cliDir, 'session-harbor');

  try {
    await fs.promises.mkdir(cliDir, { recursive: true });
    const data = await fs.promises.readFile(cliSource);
    await fs.promises.writeFile(cliTarget, data, { mode: 0o755 });
    await fs.promises.chmod(cliTarget, 0o755);
  } catch (error) {
    console.warn('[session-harbor] failed to install CLI binary:', error?.message || error);
    return;
  }

  const homeDir = app.getPath('home');
  const candidateBins = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(homeDir, 'bin'),
  ];

  for (const binDir of candidateBins) {
    try {
      await fs.promises.mkdir(binDir, { recursive: true });
      const linkPath = path.join(binDir, 'session-harbor');
      const existing = await safeLstat(linkPath);
      if (existing && !existing.isSymbolicLink()) {
        continue;
      }
      if (existing && existing.isSymbolicLink()) {
        const currentTarget = await fs.promises.readlink(linkPath);
        if (currentTarget === cliTarget) {
          console.log(`[session-harbor] CLI already installed at ${linkPath}`);
          return;
        }
        await fs.promises.unlink(linkPath);
      }
      await fs.promises.symlink(cliTarget, linkPath);
      console.log(`[session-harbor] CLI installed at ${linkPath}`);
      return;
    } catch (error) {
      if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
        continue;
      }
      console.warn(`[session-harbor] failed to link CLI in ${binDir}:`, error?.message || error);
    }
  }

  console.warn('[session-harbor] Unable to link CLI into PATH. Add it manually from:', cliTarget);
}

async function safeLstat(targetPath) {
  try {
    return await fs.promises.lstat(targetPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
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
  installCliBinary();
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
