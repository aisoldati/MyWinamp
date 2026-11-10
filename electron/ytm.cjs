const path = require('path');
let BrowserWindow, session;
try {
  const electron = require('electron');
  BrowserWindow = electron.BrowserWindow;
  session = electron.session;
} catch (e) {}
const crypto = require('crypto');

const PARTITION = 'persist:ytm_session';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

let playlistsCache = { data: null, timestamp: 0, key: '' };
const PLAYLIST_CACHE_TTL_MS = 60 * 1000;
let activeLoginWindow = null;
let activeLoginPromise = null;
let headersHookInstalled = false;

function getSession() {
  if (!session) return null;
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(FIREFOX_UA);
  if (!headersHookInstalled) {
    headersHookInstalled = true;
    try {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        const url = details.url || '';
        if (url.includes('google.com') || url.includes('youtube.com')) {
          details.requestHeaders['User-Agent'] = FIREFOX_UA;
          delete details.requestHeaders['sec-ch-ua'];
          delete details.requestHeaders['sec-ch-ua-mobile'];
          delete details.requestHeaders['sec-ch-ua-platform'];
          delete details.requestHeaders['sec-ch-ua-model'];
          delete details.requestHeaders['X-DevTools-Emulate-Network-Conditions-Client-Id'];
        }
        callback({ cancel: false, requestHeaders: details.requestHeaders });
      });
    } catch (e) {}
  }
  return ses;
}

async function getCookies() {
  const ses = getSession();
  if (!ses) return { cookieStr: '', sapisid: '', isLoggedIn: false };
  const cookies = await ses.cookies.get({ domain: '.youtube.com' });
  const googleCookies = await ses.cookies.get({ domain: '.google.com' });
  const all = [...cookies, ...googleCookies];

  const cookieMap = {};
  all.forEach((c) => {
    cookieMap[c.name] = c.value;
  });

  const cookieStr = Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const sapisid = cookieMap['SAPISID'] || cookieMap['__Secure-3PAPISID'] || '';
  return { cookieStr, sapisid, isLoggedIn: !!sapisid };
}

function getSAPISIDHASH(sapisid, origin = 'https://music.youtube.com') {
  const timestamp = Math.floor(Date.now() / 1000);
  const sha1 = crypto.createHash('sha1');
  sha1.update(`${timestamp} ${sapisid} ${origin}`);
  return `${timestamp}_${sha1.digest('hex')}`;
}

async function fetchInnerTube(endpoint, body = {}, options = {}) {
  const { isYTM = true, authToken = null, allowGuest = false } = options;
  const baseUrl = isYTM ? 'https://music.youtube.com' : 'https://www.youtube.com';
  const clientName = isYTM ? 'WEB_REMIX' : 'WEB';
  const clientVersion = isYTM ? '1.20241118.01.00' : '2.20241118.01.00';

  let headers = {
    'Content-Type': 'application/json',
    'User-Agent': CHROME_UA,
    'X-Origin': baseUrl,
    'Origin': baseUrl,
  };

  if (authToken && authToken !== 'direct_ytm_session') {
    headers['Authorization'] = `Bearer ${authToken}`;
  } else {
    const { cookieStr, sapisid, isLoggedIn } = await getCookies();
    if (isLoggedIn) {
      headers['Authorization'] = `SAPISIDHASH ${getSAPISIDHASH(sapisid, baseUrl)}`;
      headers['Cookie'] = cookieStr;
    } else if (!allowGuest) {
      throw new Error('No has iniciado sesión en YouTube Music');
    }
  }

  const res = await fetch(`${baseUrl}/youtubei/v1/${endpoint}?alt=json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      context: {
        client: {
          clientName,
          clientVersion,
          hl: 'es',
          gl: 'ES'
        }
      },
      ...body
    })
  });

  if (!res.ok) {
    throw new Error(`InnerTube error: ${res.status}`);
  }

  return res.json();
}

async function fetchYTM(endpoint, body = {}) {
  return fetchInnerTube(endpoint, body, { isYTM: true });
}

/**
 * Recursively extracts playlist items from any InnerTube response tree
 * (YouTube Music and YouTube Web formats: created, liked, saved, followed)
 */
function extractPlaylistsFromInnerTube(data) {
  const found = new Map();

  function traverse(obj) {
    if (!obj || typeof obj !== 'object') return;

    let id = '';
    let title = '';
    let thumbnail = '';
    let count = undefined;

    // Pattern 1: browseId starting with VL (YouTube Music format)
    const browseId = 
      obj.navigationEndpoint?.browseEndpoint?.browseId ||
      obj.browseEndpoint?.browseId ||
      obj.onTap?.innertubeCommand?.browseEndpoint?.browseId;
    if (browseId && typeof browseId === 'string' && browseId.startsWith('VL') && browseId !== 'VL') {
      id = browseId.replace(/^VL/, '');
    }

    // Pattern 2: playlistId directly (YouTube Web format)
    if (!id) {
      const plId = obj.playlistId || obj.navigationEndpoint?.watchEndpoint?.playlistId;
      if (plId && typeof plId === 'string' && plId.length >= 2) {
        id = plId;
      }
    }

    if (id && id !== 'WL') {
      // Extract title
      if (obj.title) {
        if (typeof obj.title === 'string') title = obj.title;
        else if (Array.isArray(obj.title.runs)) title = obj.title.runs.map(r => r.text).join('');
        else if (obj.title.simpleText) title = obj.title.simpleText;
      } else if (obj.headline) {
        if (Array.isArray(obj.headline.runs)) title = obj.headline.runs.map(r => r.text).join('');
      }

      // Extract thumbnails
      const thumbs = 
        obj.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
        obj.thumbnail?.thumbnails ||
        obj.thumbnails ||
        [];
      if (Array.isArray(thumbs) && thumbs.length > 0) {
        thumbnail = thumbs[thumbs.length - 1].url;
      }

      // Extract subtitle / track count
      const subtitle = 
        (Array.isArray(obj.subtitle?.runs) ? obj.subtitle.runs.map(r => r.text).join('') : '') ||
        (Array.isArray(obj.videoCountText?.runs) ? obj.videoCountText.runs.map(r => r.text).join('') : '') ||
        obj.videoCountShortText?.simpleText || '';
      const countMatch = subtitle.match(/(\d+)\s*(canciones|temas|songs|videos|tracks)/i);
      if (countMatch) {
        count = parseInt(countMatch[1], 10);
      }

      if (id && title && !found.has(id)) {
        found.set(id, {
          id,
          name: title.trim(),
          thumbnail: thumbnail || '',
          itemCount: count,
          tracks: []
        });
      }
    }

    // Recursively walk children
    if (Array.isArray(obj)) {
      for (const item of obj) traverse(item);
    } else {
      for (const key of Object.keys(obj)) {
        traverse(obj[key]);
      }
    }
  }

  traverse(data);
  return Array.from(found.values());
}

/**
 * Parses all user playlists (created, liked, saved, followed)
 * across YouTube Music and YouTube Web in parallel with TTL cache
 */
async function getUserPlaylists(authToken = null, forceRefresh = false) {
  const cacheKey = authToken || 'cookie';
  if (
    !forceRefresh &&
    playlistsCache.data &&
    playlistsCache.key === cacheKey &&
    Date.now() - playlistsCache.timestamp < PLAYLIST_CACHE_TTL_MS
  ) {
    return playlistsCache.data;
  }

  const playlistMap = new Map();

  // Always include user's Liked Music (LM) playlist on top
  playlistMap.set('LM', {
    id: 'LM',
    name: '⭐ Tus Me Gusta (YouTube Music)',
    itemCount: undefined,
    thumbnail: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?auto=format&fit=crop&w=120&q=80',
    tracks: [],
  });

  const fetchOptionsYTM = { isYTM: true, authToken };
  const fetchOptionsYT = { isYTM: false, authToken };

  // Run all browse endpoints in parallel to sweep all followed and created playlists
  const results = await Promise.allSettled([
    fetchInnerTube('browse', { browseId: 'FEmusic_liked_playlists' }, fetchOptionsYTM),
    fetchInnerTube('browse', { browseId: 'FEmusic_library_landing' }, fetchOptionsYTM),
    fetchInnerTube('browse', { browseId: 'FEmusic_library_corpus_playlists' }, fetchOptionsYTM),
    fetchInnerTube('browse', { browseId: 'FEplaylist_aggregation' }, fetchOptionsYT),
    fetchInnerTube('browse', { browseId: 'FElibrary' }, fetchOptionsYT),
  ]);

  results.forEach((res) => {
    if (res.status === 'fulfilled' && res.value) {
      const extracted = extractPlaylistsFromInnerTube(res.value);
      extracted.forEach((p) => {
        if (!playlistMap.has(p.id)) playlistMap.set(p.id, p);
      });
    }
  });

  const list = Array.from(playlistMap.values());
  if (list.length > 1) {
    playlistsCache = { data: list, timestamp: Date.now(), key: cacheKey };
  }
  return list;
}

/**
 * Parses track items from a playlist browse response
 */
async function getPlaylistTracks(playlistId, authToken = null) {
  const browseId = playlistId.startsWith('VL') ? playlistId : ('VL' + playlistId);
  let data;
  try {
    data = await fetchInnerTube('browse', { browseId }, { isYTM: true, authToken, allowGuest: true });
  } catch (err) {
    const pub = await fetchPublicPlaylist(playlistId);
    return pub.tracks || [];
  }

  const tracks = [];

  // Look for section contents
  const sections = 
    data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || 
    [];

  let items = [];
  sections.forEach((sec) => {
    if (sec.musicPlaylistShelfRenderer?.contents) {
      items = items.concat(sec.musicPlaylistShelfRenderer.contents);
    }
    if (sec.musicShelfRenderer?.contents) {
      items = items.concat(sec.musicShelfRenderer.contents);
    }
  });

  if (items.length === 0 && data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents) {
    const sec2 = data.contents.twoColumnBrowseResultsRenderer.secondaryContents.sectionListRenderer.contents;
    sec2.forEach(s => {
      if (s.musicPlaylistShelfRenderer?.contents) items = items.concat(s.musicPlaylistShelfRenderer.contents);
    });
  }

  items.forEach((wrapper, index) => {
    const item = wrapper.musicResponsiveListItemRenderer;
    if (!item) return;

    // Video ID
    const videoId = 
      item.playlistItemData?.videoId ||
      item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
      item.navigationEndpoint?.watchEndpoint?.videoId ||
      '';

    if (!videoId) return;

    // Title
    const title = 
      item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || 
      'Canción de YouTube Music';

    // Artist
    const artistRuns = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    const artist = artistRuns.length > 0 ? artistRuns[0].text : 'YouTube Music';

    // Duration
    const durationText = item.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || '3:30';
    let durationSec = 210;
    if (durationText && durationText.includes(':')) {
      const parts = durationText.split(':').map(Number);
      if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
      else if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    // Thumbnail
    const thumbs = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const thumbnail = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';

    tracks.push({
      id: `ytm-${videoId}-${index}`,
      title,
      artist,
      duration: durationSec,
      url: videoId,
      source: 'youtube',
      thumbnail,
    });
  });

  if (tracks.length === 0) {
    try {
      const pub = await fetchPublicPlaylist(playlistId);
      if (pub.tracks && pub.tracks.length > 0) return pub.tracks;
    } catch (e) {}
  }

  return tracks;
}

/**
 * Opens an in-app Google login window pointing to YouTube Music,
 * with standard Chrome user agent and instant cookie detection.
 */
function openLoginWindow() {
  if (!BrowserWindow) {
    const { exec } = require('child_process');
    exec('start https://music.youtube.com');
    return Promise.resolve({ success: false });
  }
  if (activeLoginWindow && !activeLoginWindow.isDestroyed() && activeLoginPromise) {
    activeLoginWindow.focus();
    return activeLoginPromise;
  }

  activeLoginPromise = new Promise((resolve) => {
    const ses = getSession();

    const loginWin = new BrowserWindow({
      width: 520,
      height: 700,
      title: 'YouTube Music - Iniciar Sesión',
      autoHideMenuBar: true,
      backgroundColor: '#0f0f0f',
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload-login.cjs'),
      },
    });

    activeLoginWindow = loginWin;
    loginWin.webContents.setUserAgent(FIREFOX_UA);

    let isDone = false;

    const finalizeLogin = async (success) => {
      if (isDone) return;
      isDone = true;
      clearInterval(pollInterval);
      try {
        ses.cookies.removeListener('changed', onCookieChanged);
      } catch (e) {}
      playlistsCache = { data: null, timestamp: 0, key: '' };
      try {
        await ses.cookies.flushStore();
      } catch (e) {}
      if (success && !loginWin.isDestroyed()) {
        setTimeout(() => {
          try {
            if (!loginWin.isDestroyed()) loginWin.close();
          } catch (e) {}
        }, 350);
      }
      activeLoginWindow = null;
      activeLoginPromise = null;
      resolve({ success });
    };

    const onCookieChanged = async (_event, cookie, _cause, removed) => {
      if (removed || isDone) return;
      if (cookie.name === 'SAPISID' || cookie.name === '__Secure-3PAPISID') {
        const { isLoggedIn } = await getCookies();
        if (isLoggedIn) {
          finalizeLogin(true);
        }
      }
    };

    try {
      ses.cookies.on('changed', onCookieChanged);
    } catch (e) {}

    const checkSuccess = async (url) => {
      if (isDone) return;
      if (url && url.includes('music.youtube.com') && !url.includes('accounts.google.com')) {
        const { isLoggedIn } = await getCookies();
        if (isLoggedIn) {
          finalizeLogin(true);
        }
      }
    };

    const pollInterval = setInterval(async () => {
      try {
        if (loginWin.isDestroyed()) {
          clearInterval(pollInterval);
          return;
        }
        const currentUrl = loginWin.webContents.getURL();
        if (currentUrl && currentUrl.includes('music.youtube.com') && !currentUrl.includes('accounts.google.com')) {
          const { isLoggedIn } = await getCookies();
          if (isLoggedIn) {
            finalizeLogin(true);
          }
        }
      } catch (e) {}
    }, 800);

    loginWin.webContents.on('did-navigate', (_e, url) => checkSuccess(url));
    loginWin.webContents.on('did-redirect-navigation', (_e, url) => checkSuccess(url));
    loginWin.webContents.on('did-navigate-in-page', (_e, url) => checkSuccess(url));

    loginWin.on('closed', async () => {
      if (!isDone) {
        const { isLoggedIn } = await getCookies();
        finalizeLogin(isLoggedIn);
      }
    });

    loginWin.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=https%3A%2F%2Fmusic.youtube.com%2F');
    loginWin.focus();
  });

  return activeLoginPromise;
}

async function logout() {
  playlistsCache = { data: null, timestamp: 0, key: '' };
  const ses = getSession();
  if (ses) {
    await ses.clearStorageData();
    try {
      await ses.cookies.flushStore();
    } catch (e) {}
  }
  return { success: true };
}

function cleanTitle(rawTitle, fallbackArtist = 'YouTube Music') {
  if (!rawTitle) return { title: 'Pista de YouTube', artist: fallbackArtist };
  let cleaned = rawTitle
    .replace(/\s*[\(\[](official\s*(music\s*)?video|video\s*oficial|official\s*audio|audio|letra|lyric\s*video|visualizer|hd|4k|remastered|lyrics)[\)\]]/gi, '')
    .trim();
  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ');
    return {
      artist: parts[0].trim() || fallbackArtist,
      title: parts.slice(1).join(' - ').trim() || cleaned,
    };
  }
  return {
    artist: fallbackArtist,
    title: cleaned || rawTitle,
  };
}

/**
 * Public parser that extracts tracks from any YouTube or YouTube Music playlist URL or ID
 * using YouTube initial data directly without requiring API keys, login, or mirrors.
 */
async function fetchPublicPlaylist(playlistId) {
  const url = `https://www.youtube.com/playlist?list=${playlistId}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': CHROME_UA,
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
    }
  });

  if (!res.ok) {
    throw new Error(`Error HTTP al consultar YouTube: ${res.status}`);
  }

  const html = await res.text();
  const match = html.match(/var ytInitialData = ({.*?});<\/script>/s) || html.match(/ytInitialData = ({.*?});/s);
  if (!match) {
    throw new Error('No se pudo encontrar la información pública de la playlist.');
  }

  const data = JSON.parse(match[1]);

  if (data.alerts && Array.isArray(data.alerts)) {
    const alertMsg = data.alerts
      .map((a) => a.alertRenderer?.text?.runs?.map((r) => r.text).join('') || '')
      .filter(Boolean)
      .join(' ');
    if (alertMsg) throw new Error(alertMsg);
  }

  const name =
    data?.metadata?.playlistMetadataRenderer?.title ||
    data?.header?.playlistHeaderRenderer?.title?.simpleText ||
    'Playlist de YouTube';

  const tracks = [];
  const secList =
    data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

  secList.forEach((sec) => {
    const rawItems = sec?.itemSectionRenderer?.contents || sec?.playlistVideoListRenderer?.contents || [];
    rawItems.forEach((item, index) => {
      // 1. Modern lockupViewModel
      if (item.lockupViewModel) {
        const vm = item.lockupViewModel;
        const videoId = vm.contentId;
        const rawTitle = vm.metadata?.lockupMetadataViewModel?.title?.content || '';
        const artistParts =
          vm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts || [];
        const rawArtist = artistParts[0]?.text?.content || 'YouTube Music';

        let duration = 210;
        try {
          const overlays = vm.contentImage?.thumbnailViewModel?.overlays || [];
          for (const ov of overlays) {
            const badgeText = ov.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text;
            if (badgeText && badgeText.includes(':')) {
              const parts = badgeText.split(':').map(Number);
              if (parts.length === 2) duration = parts[0] * 60 + parts[1];
              else if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
              break;
            }
          }
        } catch (e) {}

        const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        const { title, artist } = cleanTitle(rawTitle, rawArtist);

        if (videoId && title) {
          tracks.push({
            id: `yt-${videoId}-${index}`,
            title,
            artist,
            duration,
            url: videoId,
            source: 'youtube',
            thumbnail: thumb,
          });
        }
      }

      // 2. Classic playlistVideoRenderer
      if (item.playlistVideoRenderer) {
        const pvr = item.playlistVideoRenderer;
        const videoId = pvr.videoId;
        const rawTitle = pvr.title?.runs?.[0]?.text || '';
        const rawArtist = pvr.shortBylineText?.runs?.[0]?.text || 'YouTube Music';
        const duration = parseInt(pvr.lengthSeconds || '210', 10);
        const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        const { title, artist } = cleanTitle(rawTitle, rawArtist);

        if (videoId && title) {
          tracks.push({
            id: `yt-${videoId}-${index}`,
            title,
            artist,
            duration,
            url: videoId,
            source: 'youtube',
            thumbnail: thumb,
          });
        }
      }
    });
  });

  return { name, tracks };
}

/**
 * Universal importer for any playlist (public, authenticated, or mixed)
 */
async function importPlaylist(playlistId) {
  // 1. Try public scraping first (no login needed, works for 99% of playlists)
  try {
    const res = await fetchPublicPlaylist(playlistId);
    if (res.tracks && res.tracks.length > 0) {
      return res;
    }
  } catch (err) {
    console.warn('fetchPublicPlaylist failed, trying YTM session...', err.message);
  }

  // 2. If logged in to YouTube Music, try innerTube session
  try {
    const { isLoggedIn } = await getCookies();
    if (isLoggedIn) {
      const tracks = await getPlaylistTracks(playlistId);
      if (tracks && tracks.length > 0) {
        return { name: 'Playlist de YouTube Music', tracks };
      }
    }
  } catch (err) {
    console.warn('getPlaylistTracks session failed:', err.message);
  }

  throw new Error('No se pudieron obtener las canciones de la lista de YouTube.');
}

/**
 * Direct InnerTube search for fast, keyless song search (<300ms)
 */
async function searchTracks(query) {
  if (!query || !query.trim()) return [];
  const tracks = [];
  const seen = new Set();

  try {
    const data = await fetchInnerTube('search', { query: query.trim() }, { isYTM: false, allowGuest: true });
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

    contents.forEach((sec) => {
      const items = sec?.itemSectionRenderer?.contents || [];
      items.forEach((item) => {
        const v = item.videoRenderer;
        if (!v || !v.videoId || seen.has(v.videoId)) return;
        seen.add(v.videoId);

        const rawTitle = v.title?.runs?.map((r) => r.text).join('') || v.title?.simpleText || '';
        const rawArtist = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || 'YouTube Music';
        const { title, artist } = cleanTitle(rawTitle, rawArtist);

        const lengthText = v.lengthText?.simpleText || '3:30';
        let duration = 210;
        if (lengthText.includes(':')) {
          const parts = lengthText.split(':').map(Number);
          if (parts.length === 2) duration = parts[0] * 60 + parts[1];
          else if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }

        const thumbs = v.thumbnail?.thumbnails || [];
        const thumbnail = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

        if (title) {
          tracks.push({
            id: `yt-${v.videoId}`,
            title,
            artist,
            duration,
            url: v.videoId,
            source: 'youtube',
            thumbnail,
          });
        }
      });
    });
  } catch (err) {
    console.warn('InnerTube search error:', err.message);
  }

  return tracks.slice(0, 20);
}

module.exports = {
  getCookies,
  openLoginWindow,
  getUserPlaylists,
  getPlaylistTracks,
  fetchPublicPlaylist,
  importPlaylist,
  searchTracks,
  logout,
};

