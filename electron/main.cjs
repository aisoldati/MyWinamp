const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { handleApiRequest, loadPersistedAuth } = require('./api-handler.cjs');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('Another instance of Winamp is already running. Exiting second instance.');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.userAgentFallback = CHROME_UA;

let server = null;
let mainWindow = null;

const isDev = process.env.VITE_DEV_SERVER_URL ? true : false;

const ytm = require('./ytm.cjs');


function startLocalServer() {
  return new Promise((resolve, reject) => {
    const distPath = path.join(__dirname, '../dist');
    const portToUse = 3000;

    server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.url && req.url.startsWith('/auth/youtube/callback')) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Winamp - Conectado</title>
</head>
<body style="background:#0c0d10;color:#00e100;font-family:'Courier New', monospace, sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;text-align:center;">
  <div style="border:2px solid #00e100;padding:28px 36px;border-radius:6px;background:#14151b;box-shadow:0 0 20px rgba(0,225,0,0.2);">
    <h1 style="margin:0 0 8px;color:#00e100;font-size:20px;letter-spacing:2px;">WINAMP</h1>
    <h2 style="margin:0 0 12px;color:#22c55e;font-size:16px;">⚡ ¡Conectado con YouTube Music!</h2>
    <p id="msg" style="color:#aaa;margin:0 0 16px;font-size:13px;">Guardando sesión en Winamp...</p>
    <div id="status" style="font-size:12px;color:#888;">Cerrando pestaña automáticamente...</div>
  </div>
  <script>
    (function() {
      try {
        const hash = window.location.hash.substring(1);
        const search = window.location.search.substring(1);
        const params = new URLSearchParams(hash || search);
        const token = params.get('access_token');
        const expiresIn = params.get('expires_in') || 3600;
        if (token) {
          try { localStorage.setItem('youtube_token', token); } catch(e){}
          fetch('/api/auth/callback-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, expiresIn })
          }).then(() => {
            document.getElementById('msg').innerText = '¡Sesión transferida con éxito!';
            document.getElementById('status').innerText = '¡Listo! Puedes volver a Winamp.';
            setTimeout(() => {
              window.close();
            }, 800);
          }).catch(() => {
            document.getElementById('status').innerText = 'Sesión guardada en navegador. Puedes volver a Winamp.';
          });
        } else {
          const err = params.get('error') || 'No se recibió token';
          document.getElementById('msg').innerText = 'Error: ' + err;
          document.getElementById('status').innerText = 'Cierra esta ventana e intenta de nuevo.';
        }
      } catch(e) {
        document.getElementById('msg').innerText = 'Error: ' + e.message;
      }
    })();
  </script>
</body></html>`);
        return;
      }

      if (req.url && req.url.startsWith('/api/')) {
        try {
          const handled = await handleApiRequest(req, res, {
            isElectron: true,
            getMainWindow: () => mainWindow,
            shell,
          });
          if (handled) return;
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
      }

      // Static files in production
      let filePath = path.join(distPath, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const mimeTypes = {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff2': 'font/woff2',
        };
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
      } else {
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.setHeader('Content-Type', 'text/html');
          fs.createReadStream(indexPath).pipe(res);
        } else {
          res.statusCode = 404;
          res.end('Not found');
        }
      }
    });

    const tryListen = (retries = 8) => {
      server.listen(portToUse, () => {
        console.log(`Production/API server listening dual-stack on port ${portToUse}`);
        resolve(portToUse);
      }).on('error', (err) => {
        server.removeAllListeners('error');
        if (err.code === 'EADDRINUSE' && retries > 0) {
          console.log(`Port ${portToUse} in TimeWait, retrying in 400ms...`);
          setTimeout(() => tryListen(retries - 1), 400);
        } else {
          server.listen(0, () => {
            const port = server.address().port;
            console.log(`Production/API server listening on random port ${port}`);
            resolve(port);
          });
        }
      });
    };
    tryListen();
  });
}

async function createWindow() {
  let port = 3000;
  
  try {
    port = await startLocalServer();
  } catch (e) {
    console.error('Failed to start local Express server:', e);
  }

  mainWindow = new BrowserWindow({
    width: 564,
    height: 472,
    useContentSize: true,
    resizable: true,
    minWidth: 283,
    minHeight: 126,
    title: 'Winamp',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#18191d',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadURL(`http://localhost:${port}`);
  }
  if (process.env.DEBUG === 'true') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`[Renderer] ${message}`);
  });

  // Open all external URLs (including Google login) in system default browser (Chrome/Edge)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[main] Opening external URL in default browser:', url);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (server) {
      server.close();
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
