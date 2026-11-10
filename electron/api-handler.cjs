const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ytm = require('./ytm.cjs');

function getAuthFilePath() {
  try {
    const electron = require('electron');
    if (electron.app) {
      return path.join(electron.app.getPath('userData'), 'winamp_auth.json');
    }
  } catch (e) {}
  return path.join(__dirname, 'winamp_auth.json');
}

function loadPersistedAuth() {
  try {
    const file = getAuthFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && (data.token || data.savedAt)) {
        return data;
      }
    }
  } catch (e) {
    console.warn('Error reading auth file:', e.message);
  }
  return null;
}

function savePersistedAuth(data) {
  try {
    const file = getAuthFilePath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('Error saving auth file:', e.message);
  }
}

function clearPersistedAuth() {
  try {
    const file = getAuthFilePath();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (e) {
    console.warn('Error deleting auth file:', e.message);
  }
}

let latestOAuthToken = loadPersistedAuth()?.token || null;

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.end(JSON.stringify(data));
}

async function handleApiRequest(req, res, options = {}) {
  const { getMainWindow = () => null, isElectron = false } = options;
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.end();
    return true;
  }

  // 1. Session status
  if (pathname === '/api/auth/session') {
    let isDirect = false;
    try {
      const { isLoggedIn } = await ytm.getCookies();
      isDirect = isLoggedIn;
    } catch (e) {}
    const auth = loadPersistedAuth();
    const token = auth?.token || latestOAuthToken || null;
    sendJson(res, {
      success: true,
      token,
      isDirectLoggedIn: isDirect,
      savedAuth: auth,
      isElectron,
    });
    return true;
  }

  // 2. Save session manually
  if (pathname === '/api/auth/save-session' && req.method === 'POST') {
    const body = await readBody(req);
    const { token, clientId, expiresIn } = body;
    if (token) {
      latestOAuthToken = token;
      savePersistedAuth({
        token,
        clientId,
        savedAt: Date.now(),
        expiresIn: expiresIn || 3600,
      });
      sendJson(res, { success: true });
    } else {
      sendJson(res, { error: 'Token requerido' }, 400);
    }
    return true;
  }

  // 3. Logout endpoint
  if ((pathname === '/api/auth/logout' || pathname === '/api/ytm/logout') && (req.method === 'POST' || req.method === 'GET')) {
    const onlyOAuth = parsedUrl.searchParams.get('onlyOAuth') === 'true';
    latestOAuthToken = null;
    clearPersistedAuth();
    if (!onlyOAuth) {
      try {
        await ytm.logout();
      } catch (e) {}
    }
    sendJson(res, { success: true });
    return true;
  }

  // 4. Open URL in system default browser
  if (pathname === '/api/auth/open-browser' && req.method === 'POST') {
    const body = await readBody(req);
    const { url } = body;
    if (url) {
      let opened = false;
      if (options.shell && options.shell.openExternal) {
        try {
          options.shell.openExternal(url);
          opened = true;
        } catch (e) {}
      }
      if (!opened) {
        try {
          const { spawn } = require('child_process');
          spawn('powershell', ['-NoProfile', '-Command', `Start-Process '${url.replace(/'/g, "''")}'`], { detached: true, stdio: 'ignore' }).unref();
          opened = true;
        } catch (e) {}
      }
      sendJson(res, { success: true });
    } else {
      sendJson(res, { error: 'URL requerida' }, 400);
    }
    return true;
  }

  // 5. Callback token received from external browser
  if (pathname === '/api/auth/callback-token' && req.method === 'POST') {
    const body = await readBody(req);
    const { token, clientId, expiresIn } = body;
    if (token) {
      latestOAuthToken = token;
      savePersistedAuth({
        token,
        clientId,
        savedAt: Date.now(),
        expiresIn: expiresIn || 3600,
      });
      const win = getMainWindow();
      if (win) {
        win.show();
        win.focus();
      }
      sendJson(res, { success: true });
    } else {
      sendJson(res, { error: 'Token requerido' }, 400);
    }
    return true;
  }

  // 6. Poll for OAuth token
  if (pathname === '/api/auth/poll-token') {
    if (latestOAuthToken) {
      sendJson(res, { success: true, token: latestOAuthToken });
    } else {
      sendJson(res, { success: false });
    }
    return true;
  }

  // 7. Check if user is logged into YouTube Music
  if (pathname === '/api/ytm/status') {
    try {
      const { isLoggedIn } = await ytm.getCookies();
      sendJson(res, { success: true, loggedIn: isLoggedIn, isElectron });
    } catch (err) {
      sendJson(res, { success: false, loggedIn: false, isElectron, error: err.message });
    }
    return true;
  }

  // 8. Open Google login window (in Electron)
  if (pathname === '/api/ytm/login') {
    try {
      const result = await ytm.openLoginWindow();
      sendJson(res, result);
    } catch (err) {
      sendJson(res, { success: false, error: err.message }, 500);
    }
    return true;
  }

  // 9. Fetch user playlists and liked songs
  if (pathname === '/api/ytm/playlists' || pathname === '/api/youtube/library-playlists') {
    try {
      const auth = loadPersistedAuth();
      const token = parsedUrl.searchParams.get('token') || req.headers.authorization?.replace(/^Bearer\s+/i, '') || auth?.token;
      const forceRefresh = parsedUrl.searchParams.get('refresh') === 'true';
      const playlists = await ytm.getUserPlaylists(token, forceRefresh);
      sendJson(res, playlists);
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
    return true;
  }

  // 10. Fetch tracks for a specific playlist
  if (pathname === '/api/ytm/playlist-tracks') {
    try {
      const id = parsedUrl.searchParams.get('id');
      if (!id) return sendJson(res, { error: 'Falta el id de la playlist' }, 400);
      const auth = loadPersistedAuth();
      const token = parsedUrl.searchParams.get('token') || req.headers.authorization?.replace(/^Bearer\s+/i, '') || auth?.token;
      const tracks = await ytm.getPlaylistTracks(id, token);
      sendJson(res, tracks);
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
    return true;
  }

  // 10b. Fast InnerTube song search
  if (pathname === '/api/ytm/search') {
    try {
      const q = parsedUrl.searchParams.get('q') || '';
      if (!q.trim()) return sendJson(res, []);
      const results = await ytm.searchTracks(q);
      sendJson(res, results);
    } catch (err) {
      sendJson(res, [], 200);
    }
    return true;
  }

  // 11. Universal playlist importer (public or user playlists)
  if (pathname === '/api/ytm/import-playlist') {
    try {
      const raw = parsedUrl.searchParams.get('urlOrId') || parsedUrl.searchParams.get('id') || '';
      if (!raw) return sendJson(res, { error: 'Falta el enlace o ID de la playlist' }, 400);

      let playlistId = raw.trim();
      const match = playlistId.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
      if (match && match[1]) {
        playlistId = match[1];
      }

      const result = await ytm.importPlaylist(playlistId);
      sendJson(res, result);
    } catch (err) {
      console.error('Error in /api/ytm/import-playlist:', err.message);
      sendJson(res, { error: err.message }, 500);
    }
    return true;
  }

  // 12. Single video info
  if (pathname === '/api/ytm/video-info') {
    try {
      const videoId = parsedUrl.searchParams.get('id');
      if (!videoId) return sendJson(res, { error: 'Falta el id del video' }, 400);
      const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const r = await fetch(oEmbedUrl);
      if (!r.ok) return sendJson(res, { error: 'Video no encontrado' }, 404);
      const data = await r.json();
      sendJson(res, {
        title: data.title || 'Video de YouTube',
        artist: data.author_name || 'YouTube Music',
        thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
    return true;
  }

  // 13. Window controls
  if (pathname === '/api/window/minimize' && req.method === 'POST') {
    const win = getMainWindow();
    if (win) win.minimize();
    sendJson(res, { success: true });
    return true;
  }
  if (pathname === '/api/window/maximize' && req.method === 'POST') {
    const win = getMainWindow();
    if (win) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
    sendJson(res, { success: true });
    return true;
  }
  if (pathname === '/api/window/close' && req.method === 'POST') {
    const win = getMainWindow();
    if (win) win.close();
    sendJson(res, { success: true });
    return true;
  }

  return false;
}

module.exports = {
  handleApiRequest,
  loadPersistedAuth,
  savePersistedAuth,
  clearPersistedAuth,
};
