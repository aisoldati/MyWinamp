const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { handleApiRequest, loadPersistedAuth } = require('./api-handler.cjs');

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
    const portToUse = 3001;

    server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.url && req.url.startsWith('/api/')) {
        try {
          const handled = await handleApiRequest(req, res, {
            isElectron: true,
            getMainWindow: () => mainWindow,
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

    server.listen(portToUse, '127.0.0.1', () => {
      console.log(`Production/API server listening on port ${portToUse}`);
      resolve(portToUse);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        server.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          console.log(`Production/API server listening on random port ${port}`);
          resolve(port);
        });
      } else {
        reject(err);
      }
    });
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

  // Handle OAuth popups and open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Google OAuth flows need to open inside Electron popup windows
    if (
      url === 'about:blank' ||
      url.includes('accounts.google.com') ||
      url.includes('/auth/youtube/callback')
    ) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 550,
          height: 650,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          }
        }
      };
    }
    
    // Default browser for other links
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
