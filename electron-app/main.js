const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const config = require('./config');

// Simple JSON file store (replaces electron-store to avoid packaging issues)
class SimpleStore {
  constructor(defaults) {
    this._defaults = defaults;
    this._path = path.join(app.getPath('userData'), 'config.json');
    this._data = null;
  }
  _load() {
    if (this._data !== null) return;
    try {
      this._data = JSON.parse(fs.readFileSync(this._path, 'utf8'));
    } catch {
      this._data = { ...this._defaults };
    }
  }
  get(key) {
    this._load();
    return key in this._data ? this._data[key] : this._defaults[key];
  }
  set(key, value) {
    this._load();
    this._data[key] = value;
    fs.mkdirSync(path.dirname(this._path), { recursive: true });
    fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2));
  }
}

const store = new SimpleStore({
  serverUrl: config.servers.web.host,
  jwtSecret: null
});

let mainWindow;
let settingsWindow;
let apiServerProcess;
let webServerProcess;
let logStream;

function getLogPath() {
  return path.join(app.getPath('userData'), 'server.log');
}

function initLog() {
  const logPath = getLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  logStream = fs.createWriteStream(logPath, { flags: 'w' });
  logStream.write(`=== Client Time Tracker started at ${new Date().toISOString()} ===\n`);
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (logStream) logStream.write(line + '\n');
}

function getVersion() {
  try {
    const packagePath = path.join(__dirname, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return packageJson.version;
  } catch (e) {
    return '1.0.0';
  }
}

function getJwtSecret() {
  let secret = store.get('jwtSecret');
  if (!secret) {
    secret = 'ctt-' + crypto.randomBytes(32).toString('hex');
    store.set('jwtSecret', secret);
  }
  return secret;
}

function getDataDir() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'data');
  }
  return path.join(__dirname, '..', 'data');
}

function getServerDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server');
  }
  return path.join(__dirname, '..');
}

function spawnServer(label, scriptPath, cwd, extraEnv) {
  log(`Starting ${label} from: ${scriptPath}`);
  log(`  cwd: ${cwd}`);
  log(`  exists: ${fs.existsSync(scriptPath)}`);

  // Use Electron's own Node.js runtime with ELECTRON_RUN_AS_NODE=1
  // This avoids requiring Node.js to be installed on the target machine
  const child = spawn(process.execPath, [scriptPath], {
    cwd: cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ...extraEnv
    }
  });

  child.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) log(`[${label}] ${text}`);
  });

  child.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) log(`[${label} ERR] ${text}`);
  });

  child.on('error', (err) => {
    log(`[${label}] Failed to start: ${err.message}`);
  });

  child.on('close', (code) => {
    log(`[${label}] Exited with code ${code}`);
  });

  return child;
}

function startApiServer() {
  const serverDir = getServerDir();
  const dataDir = getDataDir();

  const apiServerPath = app.isPackaged
    ? path.join(serverDir, 'api-server.js')
    : path.join(serverDir, 'packages', 'server', 'dist', 'index.js');

  apiServerProcess = spawnServer('API', apiServerPath, path.dirname(apiServerPath), {
    API_PORT: String(config.servers.api.port),
    API_HOST: '0.0.0.0',
    JWT_SECRET: getJwtSecret(),
    PGLITE_DB_LOCATION: path.join(dataDir, 'time-tracker'),
    CTT_DATA_DIR: dataDir,
    NODE_ENV: 'production'
  });

  apiServerProcess.on('close', () => { apiServerProcess = null; });
}

function startWebServer() {
  const serverDir = getServerDir();

  // In dev, Next.js standalone may be flat or nested
  let devWebPath = path.join(serverDir, '.next', 'standalone', 'client-time-tracker', 'server.js');
  if (!fs.existsSync(devWebPath)) {
    devWebPath = path.join(serverDir, '.next', 'standalone', 'server.js');
  }
  const webServerPath = app.isPackaged
    ? path.join(serverDir, 'web', 'server.js')
    : devWebPath;

  webServerProcess = spawnServer('WEB', webServerPath, path.dirname(webServerPath), {
    PORT: String(config.servers.web.port),
    HOSTNAME: '0.0.0.0'
  });

  webServerProcess.on('close', () => { webServerProcess = null; });
}

function waitForServer(url, timeout) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(url, (res) => {
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Server at ${url} did not start within ${timeout}ms`));
        } else {
          setTimeout(check, config.servers.healthPollInterval);
        }
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error(`Server at ${url} did not start within ${timeout}ms`));
        } else {
          setTimeout(check, config.servers.healthPollInterval);
        }
      });
    };
    check();
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 700,
    height: 500,
    title: 'Settings - Client Time Tracker',
    parent: mainWindow,
    modal: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.setMenu(null);

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createWindow(serverUrl) {
  const version = getVersion();

  mainWindow = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    title: `${config.window.title} v${version}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => createSettingsWindow()
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  mainWindow.loadURL(serverUrl);

  // Intercept close to allow renderer to sync before closing
  let allowClose = false;
  mainWindow.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    mainWindow.webContents.send('close-requested');
    // Safety timeout: force close after 10 seconds
    setTimeout(() => {
      allowClose = true;
      mainWindow?.close();
    }, 10000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers
ipcMain.handle('get-server-url', () => {
  return store.get('serverUrl');
});

ipcMain.handle('set-server-url', (event, url) => {
  store.set('serverUrl', url);
  return true;
});

ipcMain.handle('get-version', () => {
  return getVersion();
});

ipcMain.on('open-settings', () => {
  createSettingsWindow();
});

ipcMain.on('close-settings', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
});

ipcMain.on('close-ready', () => {
  if (mainWindow) {
    // Renderer finished syncing, allow close
    mainWindow.destroy();
  }
});

ipcMain.on('restart-app', () => {
  log('Restart requested - relaunching application...');
  killServers();
  BrowserWindow.getAllWindows().forEach(window => window.close());
  app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) });
  setTimeout(() => app.exit(0), 100);
});

function killServers() {
  if (apiServerProcess) {
    log('Killing API server...');
    apiServerProcess.kill();
    apiServerProcess = null;
  }
  if (webServerProcess) {
    log('Killing web server...');
    webServerProcess.kill();
    webServerProcess = null;
  }
}

app.whenReady().then(async () => {
  initLog();

  const version = getVersion();
  log('========================================');
  log(`  Client Time Tracker v${version}`);
  log('========================================');
  log(`  Packaged: ${app.isPackaged}`);
  log(`  execPath: ${process.execPath}`);
  log(`  resourcesPath: ${process.resourcesPath}`);
  log(`  userData: ${app.getPath('userData')}`);

  const serverUrl = store.get('serverUrl');

  // Determine if we should start bundled servers
  let shouldStart = config.servers.startBundledServers;
  if (shouldStart === null || shouldStart === undefined) {
    try {
      const url = new URL(serverUrl);
      shouldStart = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
      shouldStart = true;
    }
  }

  if (shouldStart) {
    log('Starting bundled servers...');

    // Ensure data directory exists
    const dataDir = getDataDir();
    log(`  Data dir: ${dataDir}`);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Log server directory contents for debugging
    const serverDir = getServerDir();
    log(`  Server dir: ${serverDir}`);
    try {
      const files = fs.readdirSync(serverDir);
      log(`  Server dir contents: ${files.join(', ')}`);
    } catch (e) {
      log(`  ERROR reading server dir: ${e.message}`);
    }

    startApiServer();
    startWebServer();

    try {
      const apiUrl = `${config.servers.api.host}${config.servers.api.healthEndpoint}`;
      const webUrl = `${config.servers.web.host}${config.servers.web.healthEndpoint}`;

      log('Waiting for servers to start...');
      await Promise.all([
        waitForServer(apiUrl, config.servers.startupTimeout),
        waitForServer(webUrl, config.servers.startupTimeout)
      ]);
      log('Both servers are ready.');
    } catch (err) {
      log(`Server startup error: ${err.message}`);
      log('Attempting to load anyway...');

      // Show error dialog so user knows what happened
      dialog.showMessageBox({
        type: 'warning',
        title: 'Server Startup Issue',
        message: 'One or both servers failed to start in time.',
        detail: `Check the log file for details:\n${getLogPath()}\n\nThe app will try to load anyway.`,
        buttons: ['OK']
      });
    }
  } else {
    log('Connecting to remote server at: ' + serverUrl);
  }

  createWindow(serverUrl);
});

app.on('window-all-closed', () => {
  killServers();
  if (process.platform !== 'darwin') {
    app.quit();
  }
  // Force exit after a short delay to prevent zombie processes
  setTimeout(() => process.exit(0), 3000);
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow(store.get('serverUrl'));
  }
});

app.on('before-quit', () => {
  killServers();
  if (logStream) logStream.end();
});
