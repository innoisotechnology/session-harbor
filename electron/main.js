const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require('electron');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const SERVER_HOST = process.env.HOST || '127.0.0.1';
let serverPort = Number(process.env.PORT) || 3434;
const isDev = !app.isPackaged;

function startupLogPath() {
  try {
    return path.join(app.getPath('userData'), 'electron-startup.log');
  } catch (err) {
    return '/tmp/session-harbor-electron-startup.log';
  }
}

function logStartup(message) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(startupLogPath(), `[${ts}] pid=${process.pid} ${message}\n`, { encoding: 'utf8' });
  } catch (err) {
    // ignore
  }
}

function dataDirPath() {
  return path.join(app.getPath('userData'), 'data');
}

function ttsEnvFilePath() {
  return path.join(dataDirPath(), 'tts.env');
}

function bashSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function hasOpenAIApiKey() {
  try {
    return fs.existsSync(ttsEnvFilePath());
  } catch (err) {
    return false;
  }
}

function writeOpenAIApiKey(key) {
  const trimmed = String(key || '').trim();
  if (!trimmed) throw new Error('Key is empty.');
  const content = `# Session Harbor (generated)\nexport OPENAI_API_KEY=${bashSingleQuote(trimmed)}\n`;
  fs.mkdirSync(dataDirPath(), { recursive: true });
  fs.writeFileSync(ttsEnvFilePath(), content, { mode: 0o600 });
  try {
    fs.chmodSync(ttsEnvFilePath(), 0o600);
  } catch (err) {
    // ignore
  }
}

function clearOpenAIApiKey() {
  try {
    fs.unlinkSync(ttsEnvFilePath());
  } catch (err) {
    // ignore
  }
}

let apiKeyWin = null;

function openApiKeyPrompt(parentWin) {
  if (apiKeyWin && !apiKeyWin.isDestroyed()) {
    apiKeyWin.show();
    apiKeyWin.focus();
    return;
  }

  apiKeyWin = new BrowserWindow({
    width: 520,
    height: 240,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    modal: Boolean(parentWin),
    parent: parentWin || undefined,
    title: 'Set OpenAI API Key',
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  apiKeyWin.on('closed', () => {
    apiKeyWin = null;
  });

  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;">
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; margin: 18px; }
      h1 { font-size: 16px; margin: 0 0 10px; }
      p { font-size: 12px; color: #555; margin: 0 0 12px; }
      input { width: 100%; font-size: 13px; padding: 10px 12px; border: 1px solid #ccc; border-radius: 8px; }
      .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      button { font-size: 12px; padding: 8px 12px; border-radius: 8px; border: 1px solid #bbb; background: #f6f6f6; }
      button.primary { background: #0a84ff; border-color: #0a84ff; color: white; }
    </style>
  </head>
  <body>
    <h1>OpenAI API Key</h1>
    <p>This will be stored locally and used for Speech Watcher TTS.</p>
    <input id="key" type="password" placeholder="sk-..." autocomplete="off" />
    <div class="row">
      <button id="cancel">Cancel</button>
      <button id="save" class="primary">Save</button>
    </div>
    <script>
      const { ipcRenderer } = require('electron');
      const input = document.getElementById('key');
      document.getElementById('cancel').addEventListener('click', () => ipcRenderer.send('session-harbor:openai-key:cancel'));
      document.getElementById('save').addEventListener('click', () => ipcRenderer.send('session-harbor:openai-key:set', input.value || ''));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ipcRenderer.send('session-harbor:openai-key:set', input.value || ''); });
      input.focus();
    </script>
  </body>
</html>
`;
  apiKeyWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

// Tray apps often "stay open" after closing all windows; enforce single-instance
// to avoid port conflicts and confusing duplicate background processes.
//
// IMPORTANT: If we don't get the lock, we must not register any event handlers
// that would create windows/tray icons in the losing process.
const gotTheLock = app.requestSingleInstanceLock();
logStartup(`boot gotTheLock=${gotTheLock} argv=${JSON.stringify(process.argv)}`);
if (!gotTheLock) {
  app.quit();
}

function requestJson(method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        host: SERVER_HOST,
        port: serverPort,
        path: reqPath,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': data.length }
          : undefined,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) : null;
            resolve({ status: res.statusCode || 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getTtsWatcherState() {
  const res = await requestJson('GET', '/api/tts-watcher');
  if (res.status >= 400) {
    throw new Error(res.body?.error || `GET /api/tts-watcher failed (${res.status})`);
  }
  return res.body;
}

async function setTtsWatcherEnabled(enabled) {
  const res = await requestJson('POST', '/api/tts-watcher', { enabled: Boolean(enabled) });
  if (res.status >= 400) {
    throw new Error(res.body?.error || `POST /api/tts-watcher failed (${res.status})`);
  }
  return res.body;
}

function isSessionHarborService(payload) {
  return Boolean(payload && typeof payload === 'object' && payload.service === 'session-harbor');
}

function probeSessionHarbor(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: SERVER_HOST, port, path: '/status', timeout: timeoutMs },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) : null;
            resolve(res.statusCode === 200 && isSessionHarborService(parsed));
          } catch (err) {
            resolve(false);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.unref();
    s.on('error', () => resolve(false));
    s.listen({ host: SERVER_HOST, port }, () => {
      s.close(() => resolve(true));
    });
  });
}

async function selectBackendPort() {
  // If something is already listening on the configured port:
  // - If it's our service, reuse it (skip starting another backend).
  // - Otherwise, pick the next available port.
  const available = await checkPortAvailable(serverPort);
  if (available) {
    return { mode: 'start', port: serverPort };
  }

  const isOurs = await probeSessionHarbor(serverPort);
  if (isOurs) {
    return { mode: 'reuse', port: serverPort };
  }

  for (let i = 1; i <= 20; i++) {
    const p = serverPort + i;
    // eslint-disable-next-line no-await-in-loop
    const ok = await checkPortAvailable(p);
    if (ok) {
      serverPort = p;
      return { mode: 'start', port: serverPort };
    }
  }

  // Give up; keep existing port and let startup fail loudly.
  return { mode: 'start', port: serverPort };
}

function installTtsWatcherMenu() {
  let watcherItem;
  let openLogItem;
  let setKeyItem;
  let clearKeyItem;
  let refreshing = false;

  async function refreshState() {
    if (refreshing) return;
    refreshing = true;
    try {
      const state = await getTtsWatcherState();
      if (watcherItem) watcherItem.checked = Boolean(state.enabled);
      if (openLogItem) openLogItem.enabled = Boolean(state.logFile);
      if (openLogItem) openLogItem._logFile = state.logFile || null;
      if (setKeyItem) setKeyItem.enabled = true;
      if (clearKeyItem) clearKeyItem.enabled = hasOpenAIApiKey();
    } catch (err) {
      // Ignore; backend may not be up yet.
    } finally {
      refreshing = false;
    }
  }

  const template = [
    {
      label: app.name,
      submenu: [
        {
          label: 'Speech Watcher',
          type: 'checkbox',
          checked: false,
          click: async (item) => {
            try {
              const updated = await setTtsWatcherEnabled(item.checked);
              item.checked = Boolean(updated.enabled);
              if (openLogItem) openLogItem._logFile = updated.logFile || null;
            } catch (err) {
              item.checked = !item.checked;
              dialog.showErrorBox('Session Harbor', `Failed to toggle Speech Watcher.\n\n${err?.message || err}`);
            }
          },
        },
        {
          label: 'Open Speech Watcher Log',
          enabled: true,
          click: async () => {
            try {
              const state = await getTtsWatcherState();
              const logFile = state.logFile;
              if (!logFile) return;
              shell.showItemInFolder(logFile);
            } catch (err) {
              dialog.showErrorBox('Session Harbor', `Failed to open watcher log.\n\n${err?.message || err}`);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Set OpenAI API Key…',
          click: async () => {
            const parentWin = BrowserWindow.getAllWindows()[0] || null;
            openApiKeyPrompt(parentWin);
          },
        },
        {
          label: 'Clear OpenAI API Key',
          enabled: hasOpenAIApiKey(),
          click: async () => {
            const result = await dialog.showMessageBox({
              type: 'warning',
              buttons: ['Cancel', 'Clear'],
              defaultId: 0,
              cancelId: 0,
              message: 'Clear stored OpenAI API key?',
              detail: 'This only removes the local key file used for Speech Watcher.',
            });
            if (result.response !== 1) return;
            clearOpenAIApiKey();
            refreshState();
          },
        },
        { type: 'separator' },
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Get live references for updates.
  watcherItem = menu.items[0].submenu.items[0];
  openLogItem = menu.items[0].submenu.items[1];
  setKeyItem = menu.items[0].submenu.items[3];
  clearKeyItem = menu.items[0].submenu.items[4];

  refreshState();
  setInterval(refreshState, 15_000).unref();
}

let tray = null;

function installTrayMenu() {
  if (process.platform !== 'darwin') return;
  if (tray) return;

  // Use a macOS template image so the icon is monochrome and adapts to light/dark mode.
  // (We ship a small boat glyph as PNG; macOS will tint template images automatically.)
  let img;
  try {
    const iconPath = path.join(app.getAppPath(), 'assets', 'tray', 'boatTemplate.png');
    img = nativeImage.createFromPath(iconPath);
    if (img && !img.isEmpty()) {
      img.setTemplateImage(true);
    } else {
      img = null;
    }
  } catch (err) {
    img = null;
  }
  if (!img) {
    // Fallback to a built-in template icon if the asset is missing.
    img = nativeImage.createFromNamedImage('NSImageNameActionTemplate');
  }
  tray = new Tray(img);
  tray.setToolTip(app.name);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Speech Watcher',
      type: 'checkbox',
      checked: false,
      click: async (item) => {
        try {
          const updated = await setTtsWatcherEnabled(item.checked);
          item.checked = Boolean(updated.enabled);
        } catch (err) {
          item.checked = !item.checked;
          dialog.showErrorBox('Session Harbor', `Failed to toggle Speech Watcher.\n\n${err?.message || err}`);
        }
      },
    },
    {
      label: 'Open Speech Watcher Log',
      click: async () => {
        try {
          const state = await getTtsWatcherState();
          const logFile = state.logFile;
          if (!logFile) return;
          shell.showItemInFolder(logFile);
        } catch (err) {
          dialog.showErrorBox('Session Harbor', `Failed to open watcher log.\n\n${err?.message || err}`);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Set OpenAI API Key…',
      click: async () => {
        const parentWin = BrowserWindow.getAllWindows()[0] || null;
        openApiKeyPrompt(parentWin);
      },
    },
    {
      label: 'Clear OpenAI API Key',
      enabled: hasOpenAIApiKey(),
      click: async () => {
        const result = await dialog.showMessageBox({
          type: 'warning',
          buttons: ['Cancel', 'Clear'],
          defaultId: 0,
          cancelId: 0,
          message: 'Clear stored OpenAI API key?',
        });
        if (result.response !== 1) return;
        clearOpenAIApiKey();
        refreshTrayState();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Keep the tray checkbox in sync.
  async function refreshTrayState() {
    try {
      const state = await getTtsWatcherState();
      const item = contextMenu.items[0];
      item.checked = Boolean(state.enabled);
      // Update key-dependent menu items.
      const clearItem = contextMenu.items.find((it) => it.label === 'Clear OpenAI API Key');
      if (clearItem) clearItem.enabled = hasOpenAIApiKey();
    } catch (err) {
      // ignore
    }
  }
  refreshTrayState();
  setInterval(refreshTrayState, 15_000).unref();
}

function startBackend() {
  process.env.HOST = SERVER_HOST;
  process.env.PORT = String(serverPort);
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

  installZshCompletion(cliTarget);

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

function installZshCompletion(cliTarget) {
  const shell = process.env.SHELL || '';
  if (!shell.includes('zsh')) {
    return;
  }

  const homeDir = app.getPath('home');
  const completionDir = path.join(homeDir, '.zsh', 'completions');
  const completionPath = path.join(completionDir, '_session-harbor');

  try {
    fs.mkdirSync(completionDir, { recursive: true });
    // In packaged Electron builds, `process.execPath` is the Electron binary.
    // Without ELECTRON_RUN_AS_NODE this would launch a second app instance.
    const result = spawnSync(process.execPath, [cliTarget, 'completion', 'zsh'], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    if (result.status !== 0 || !result.stdout) {
      console.warn('[session-harbor] failed to generate zsh completion:', result.stderr || 'no output');
      return;
    }
    fs.writeFileSync(completionPath, result.stdout, { mode: 0o644 });
  } catch (error) {
    console.warn('[session-harbor] failed to install zsh completion:', error?.message || error);
    return;
  }

  const zshrcPath = path.join(homeDir, '.zshrc');
  const snippet = '\n# session-harbor completions\nif [[ -d ~/.zsh/completions ]]; then\n  fpath=(~/.zsh/completions $fpath)\n  autoload -Uz compinit && compinit\nfi\n';

  try {
    const current = fs.readFileSync(zshrcPath, 'utf8');
    if (!current.includes('session-harbor completions') && !current.includes('~/.zsh/completions')) {
      fs.appendFileSync(zshrcPath, snippet);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      fs.writeFileSync(zshrcPath, snippet, { mode: 0o644 });
      return;
    }
    console.warn('[session-harbor] failed to update ~/.zshrc for completion:', error?.message || error);
  }
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
        .get({ host: SERVER_HOST, port: serverPort, path: '/' }, (res) => {
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (mainWindowPromise) {
    await mainWindowPromise;
    return;
  }

  logStartup('createWindow:start');
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

  mainWindow = win;

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  const url = isDev && process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL
    : `http://${SERVER_HOST}:${serverPort}`;

  mainWindowPromise = win.loadURL(url).finally(() => {
    mainWindowPromise = null;
    logStartup('createWindow:done');
  });
  await mainWindowPromise;
}

let mainWindow = null;
let mainWindowPromise = null;

if (gotTheLock) {
  ipcMain.on('session-harbor:openai-key:cancel', () => {
    if (apiKeyWin && !apiKeyWin.isDestroyed()) apiKeyWin.close();
  });
  ipcMain.on('session-harbor:openai-key:set', async (_event, key) => {
    try {
      writeOpenAIApiKey(key);
      if (apiKeyWin && !apiKeyWin.isDestroyed()) apiKeyWin.close();
      dialog.showMessageBox({ type: 'info', message: 'OpenAI API key saved for Speech Watcher.' });
    } catch (err) {
      dialog.showErrorBox('Session Harbor', `Failed to save OpenAI API key.\n\n${err?.message || err}`);
    }
  });

  app.on('second-instance', () => {
    logStartup('event:second-instance');
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) {
      const win = wins[0];
      if (win.isMinimized()) win.restore();
      win.focus();
      return;
    }
    // If for some reason there is no window, recreate one.
    void createWindow();
  });

  app.whenReady().then(async () => {
    logStartup('event:whenReady');
    const { mode } = await selectBackendPort();
    if (mode === 'start') {
      startBackend();
    }
    installCliBinary();
    await waitForServer();
    installTtsWatcherMenu();
    installTrayMenu();
    await createWindow();
  });

  app.on('activate', async () => {
    logStartup('event:activate');
    await createWindow();
  });

  app.on('window-all-closed', () => {
    logStartup('event:window-all-closed');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
