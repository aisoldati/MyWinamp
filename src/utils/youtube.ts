import { Track, Playlist } from '../types';

export function getGoogleClientId(): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('youtube_custom_client_id');
    if (saved) return saved;
  }
  return (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '747959013800-kg136ck67gt13edktqgi0ou1b12jeuqt.apps.googleusercontent.com';
}

export function setGoogleClientId(id: string) {
  if (typeof window !== 'undefined') {
    if (!id || id.trim() === '') {
      localStorage.removeItem('youtube_custom_client_id');
    } else {
      localStorage.setItem('youtube_custom_client_id', id.trim());
    }
  }
}

export function getGoogleAuthUrl(): string {
  const redirectUri = 'http://localhost:3000/auth/youtube/callback';
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    include_granted_scopes: 'true',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function handleGoogleCallback() {
  if (typeof window === 'undefined') return;

  // Google OAuth sends token in hash (implicit grant flow)
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : hash);
  const token = params.get('access_token');
  const expiresIn = params.get('expires_in');
  const error = params.get('error');

    if (token) {
      localStorage.setItem('youtube_token', token);
      const expiry = Date.now() + parseInt(expiresIn || '3600', 10) * 1000;
      localStorage.setItem('youtube_token_expiry', expiry.toString());

      // Send token to local Winamp server so Electron receives it automatically
      fetch('/api/auth/callback-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, expiresIn: expiresIn || 3600 })
      }).catch(() => {});

      if (window.opener) {
        try {
          window.opener.postMessage({ type: 'OAUTH_YT_SUCCESS', token }, '*');
          window.close();
          return;
        } catch (e) {
          console.warn('Could not postMessage to opener:', e);
        }
      }
      // Render success message for browser tab
      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.innerHTML = `
          <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background-color: #0d0e11;
            color: #22c55e;
            font-family: sans-serif;
            text-align: center;
            padding: 20px;
          ">
            <h1 style="margin-bottom: 8px; font-size: 24px;">¡Conexión Exitosa con YouTube!</h1>
            <p style="color: #9ca3af; font-size: 14px; margin-bottom: 20px;">Tu cuenta ha sido vinculada correctamente. Ya puedes cerrar esta pestaña y volver a Winamp.</p>
            <button onclick="window.close()" style="
              padding: 8px 18px;
              background: #2563eb;
              color: #fff;
              border: none;
              cursor: pointer;
              border-radius: 4px;
              font-weight: bold;
              font-size: 13px;
            ">Cerrar pestaña</button>
          </div>
        `;
        return;
      }
      window.location.href = window.location.origin + '/';
    } else {
    console.error('OAuth callback error or no token:', error);
    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'OAUTH_YT_ERROR', error: error || 'Token not found' }, '*');
        window.close();
        return;
      } catch (e) {
        console.warn('Could not postMessage to opener:', e);
      }
    }
    alert('Error al autenticar con Google: ' + (error || 'No se recibió el token de acceso.'));
    window.location.href = window.location.origin + '/';
  }
}

export async function fetchServerSession(): Promise<{ token: string | null; isDirectLoggedIn: boolean }> {
  try {
    const res = await fetch('/api/auth/session');
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('youtube_token', data.token);
      }
      return {
        token: data.token || null,
        isDirectLoggedIn: !!data.isDirectLoggedIn,
      };
    }
  } catch (e) {}
  return {
    token: getYoutubeToken(),
    isDirectLoggedIn: false,
  };
}

export function getYoutubeToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('youtube_token') || null;
}

export function setYoutubeToken(token: string | null, expiresIn = '3600') {
  if (typeof window === 'undefined') return;
  if (!token) {
    logoutYoutube();
    return;
  }
  localStorage.setItem('youtube_token', token);
  fetch('/api/auth/save-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, expiresIn })
  }).catch(() => {});
}

export function logoutYoutube(onlyOAuth = false) {
  localStorage.removeItem('youtube_token');
  localStorage.removeItem('youtube_token_expiry');
  fetch(`/api/auth/logout${onlyOAuth ? '?onlyOAuth=true' : ''}`, { method: 'POST' }).catch(() => {});
}

export async function youtubeFetch(endpoint: string, options: RequestInit = {}) {
  const token = getYoutubeToken();
  if (!token || token === 'direct_ytm_session') {
    throw new Error('YouTube no está autenticado con OAuth');
  }

  const apiKey = (import.meta as any).env?.VITE_GOOGLE_API_KEY;
  const keyParam = apiKey && apiKey.trim() ? `${endpoint.includes('?') ? '&' : '?'}key=${apiKey.trim()}` : '';
  const url = `https://www.googleapis.com/youtube/v3/${endpoint}${keyParam}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 401) {
    logoutYoutube(true);
    throw new Error('La sesión de YouTube OAuth ha expirado');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `YouTube API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Clean up common noise from YouTube song titles (e.g. "(Official Video)", "[Lyric Video]")
 */
export function cleanTrackTitle(rawTitle: string, fallbackChannel: string): { title: string; artist: string } {
  let cleaned = rawTitle
    .replace(/\s*[\(\[](official\s*(music\s*)?video|video\s*oficial|official\s*audio|audio|letra|lyric\s*video|visualizer|hd|4k|remastered|lyrics)[\)\]]/gi, '')
    .trim();

  // If the title contains "Artist - Song", split it
  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ');
    const artist = parts[0].trim();
    const title = parts.slice(1).join(' - ').trim();
    return {
      artist: artist || fallbackChannel || 'YouTube Music',
      title: title || cleaned,
    };
  }

  return {
    artist: fallbackChannel || 'YouTube Music',
    title: cleaned || rawTitle,
  };
}

const LOCAL_SAVED_PLAYLISTS_KEY = 'winamp_saved_playlists';

export function getLocalSavedPlaylists(): Playlist[] {
  try {
    const stored = localStorage.getItem(LOCAL_SAVED_PLAYLISTS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {}
  return [];
}

export function savePlaylistToLocal(playlist: Playlist): void {
  try {
    const list = getLocalSavedPlaylists().filter(p => p.id !== playlist.id);
    list.unshift(playlist);
    localStorage.setItem(LOCAL_SAVED_PLAYLISTS_KEY, JSON.stringify(list));
  } catch {}
}

export function removePlaylistFromLocal(playlistId: string): void {
  try {
    const list = getLocalSavedPlaylists().filter(p => p.id !== playlistId);
    localStorage.setItem(LOCAL_SAVED_PLAYLISTS_KEY, JSON.stringify(list));
  } catch {}
}

/**
 * Fetches all user playlists from YouTube / YouTube Music:
 * - Liked Music / Liked Videos (LL / LM)
 * - Playlists saved and followed from other channels
 * - Playlists created by the user
 * - Playlists bookmarked/saved in Winamp
 */
export async function fetchYoutubePlaylists(): Promise<Playlist[]> {
  const playlistMap = new Map<string, Playlist>();

  // 1. Try to fetch user's "Liked Videos / Liked Music" playlist
  try {
    const channelData = await youtubeFetch('channels?part=contentDetails&mine=true');
    const likesPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.likes;
    if (likesPlaylistId) {
      playlistMap.set(likesPlaylistId, {
        id: likesPlaylistId,
        name: '⭐ Tus Me Gusta (YouTube Music)',
        tracks: [],
        itemCount: undefined,
        thumbnail: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?auto=format&fit=crop&w=120&q=80',
      });
    }
  } catch (err) {
    console.warn('Could not fetch Liked Music playlist ID from Data API:', err);
  }

  // 2. Fetch all saved, followed, liked and created playlists from InnerTube backend
  try {
    const token = getYoutubeToken();
    const url = token 
      ? `/api/youtube/library-playlists?token=${encodeURIComponent(token)}`
      : '/api/youtube/library-playlists';
    const res = await fetch(url);
    if (res.ok) {
      const libraryLists: Playlist[] = await res.json();
      libraryLists.forEach((p) => {
        if (!playlistMap.has(p.id)) {
          playlistMap.set(p.id, p);
        }
      });
    }
  } catch (err) {
    console.warn('Could not fetch InnerTube library playlists:', err);
  }

  // 3. Fetch user-created playlists via YouTube Data API v3 (up to 100 items)
  try {
    let pageToken = '';
    let pages = 0;
    const maxPages = 2; // up to 100 playlists

    do {
      const pageParam = pageToken ? `&pageToken=${pageToken}` : '';
      const data = await youtubeFetch(`playlists?part=snippet,contentDetails&mine=true&maxResults=50${pageParam}`);
      const items = data.items || [];

      items.forEach((p: any) => {
        const thumb = p.snippet?.thumbnails?.medium?.url || p.snippet?.thumbnails?.default?.url || '';
        if (!playlistMap.has(p.id)) {
          playlistMap.set(p.id, {
            id: p.id,
            name: p.snippet?.title || 'Sin Título',
            tracks: [],
            itemCount: p.contentDetails?.itemCount,
            thumbnail: thumb,
          });
        }
      });

      pageToken = data.nextPageToken || '';
      pages++;
    } while (pageToken && pages < maxPages);
  } catch (err) {
    console.warn('Failed to fetch user-created playlists via Data API:', err);
  }

  // 4. Include any locally saved / bookmarked playlists from localStorage
  try {
    const localSaved = getLocalSavedPlaylists();
    localSaved.forEach((pl) => {
      if (!playlistMap.has(pl.id)) {
        playlistMap.set(pl.id, pl);
      }
    });
  } catch (e) {}

  if (playlistMap.size > 0) {
    return Array.from(playlistMap.values());
  }

  return [];
}

/**
 * Fetches tracks from a specific YouTube playlist (supports pagination up to 150 tracks).
 */
export async function fetchYoutubePlaylistTracks(playlistId: string, maxTracks = 150): Promise<Track[]> {
  const tracks: Track[] = [];
  let pageToken = '';
  let fetched = 0;

  try {
    do {
      const pageParam = pageToken ? `&pageToken=${pageToken}` : '';
      const data = await youtubeFetch(`playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=50${pageParam}`);
      const items = data.items || [];

      for (const item of items) {
        const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '';
        if (!videoId) continue;

        const rawTitle = item.snippet?.title || 'Video de YouTube';
        const channel = item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'YouTube Music';
        const { title, artist } = cleanTrackTitle(rawTitle, channel);

        const thumb = item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '';

        tracks.push({
          id: `yt-${videoId}-${tracks.length}`,
          title,
          artist,
          duration: 240, // standard placeholder duration, updated when video metadata loads
          url: videoId,
          source: 'youtube',
          thumbnail: thumb,
        });

        fetched++;
        if (fetched >= maxTracks) break;
      }

      pageToken = data.nextPageToken || '';
    } while (pageToken && fetched < maxTracks);

    return tracks;
  } catch (err) {
    console.error(`Failed to fetch tracks for YouTube playlist ${playlistId}:`, err);
    throw err;
  }
}

/**
 * Extract YouTube / YouTube Music playlist ID from URL or text
 */
export function extractPlaylistId(urlOrId: string): string | null {
  const trimmed = urlOrId.trim();
  // Check direct ID format
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed) && (trimmed.startsWith('PL') || trimmed.startsWith('OLAK') || trimmed.startsWith('RD') || trimmed.startsWith('LL') || trimmed.startsWith('UU'))) {
    return trimmed;
  }

  // Check URL parameter format: ...list=PL...
  const match = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
  if (match && match[1]) {
    return match[1];
  }

  return null;
}

/**
 * Loads any YouTube / YouTube Music playlist by URL or ID (authenticated or via mirrors)
 */
export async function fetchPlaylistByUrlOrId(urlOrId: string): Promise<{ name: string; tracks: Track[] }> {
  const playlistId = extractPlaylistId(urlOrId);
  if (!playlistId) {
    throw new Error('No se reconoció un ID de playlist válido de YouTube o YouTube Music.');
  }

  // 1. Try local backend first (direct Node fetch, avoids CORS and blocked public mirrors)
  let lastBackendError = '';
  try {
    const res = await fetch(`/api/ytm/import-playlist?urlOrId=${encodeURIComponent(urlOrId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.tracks && data.tracks.length > 0) {
        return data;
      }
    } else {
      const errData = await res.json().catch(() => null);
      if (errData?.error) lastBackendError = errData.error;
    }
  } catch (e: any) {
    console.warn('Backend /api/ytm/import-playlist failed or not available:', e);
    if (e?.message) lastBackendError = e.message;
  }

  // 2. Try authenticated API if logged in
  if (getYoutubeToken()) {
    try {
      // Get playlist snippet title
      let playlistName = 'Playlist de YouTube Music';
      try {
        const info = await youtubeFetch(`playlists?part=snippet&id=${playlistId}`);
        if (info.items?.[0]?.snippet?.title) {
          playlistName = info.items[0].snippet.title;
        }
      } catch (e) {
        // May be special or liked playlist
      }

      const tracks = await fetchYoutubePlaylistTracks(playlistId, 100);
      if (tracks.length > 0) {
        return { name: playlistName, tracks };
      }
    } catch (e) {
      console.warn('Authenticated playlist fetch failed, trying mirrors...', e);
    }
  }

  // 3. Fallback to public Invidious / Piped API mirrors
  const mirrors = [
    { type: 'invidious', url: 'https://invidious.projectsegfau.lt' },
    { type: 'invidious', url: 'https://yewtu.be' },
    { type: 'piped', url: 'https://pipedapi.kavin.rocks' },
    { type: 'piped', url: 'https://pipedapi.adminforge.de' },
  ];

  for (const mirror of mirrors) {
    try {
      if (mirror.type === 'invidious') {
        const res = await fetch(`${mirror.url}/api/v1/playlists/${playlistId}`);
        if (res.ok) {
          const data = await res.json();
          const videos = data.videos || [];
          if (videos.length > 0) {
            const tracks: Track[] = videos.map((v: any) => {
              const { title, artist } = cleanTrackTitle(v.title || '', v.author || 'YouTube Music');
              return {
                id: `yt-${v.videoId}`,
                title,
                artist,
                duration: v.lengthSeconds || 240,
                url: v.videoId,
                source: 'youtube' as const,
                thumbnail: v.videoThumbnails?.[0]?.url || '',
              };
            });
            return {
              name: data.title || 'Playlist de YouTube Music',
              tracks,
            };
          }
        }
      } else {
        const res = await fetch(`${mirror.url}/playlists/${playlistId}`);
        if (res.ok) {
          const data = await res.json();
          const items = data.relatedStreams || [];
          if (items.length > 0) {
            const tracks: Track[] = items.map((v: any) => {
              const videoId = v.url ? v.url.split('v=')[1] || v.url.split('/').pop() : '';
              const { title, artist } = cleanTrackTitle(v.title || '', v.uploaderName || 'YouTube Music');
              return {
                id: `yt-${videoId}`,
                title,
                artist,
                duration: v.duration || 240,
                url: videoId,
                source: 'youtube' as const,
                thumbnail: v.thumbnail || '',
              };
            }).filter((t: Track) => t.url);
            return {
              name: data.name || 'Playlist de YouTube Music',
              tracks,
            };
          }
        }
      }
    } catch (e) {
      // try next
    }
  }

  throw new Error(lastBackendError ? `No se pudieron obtener las canciones: ${lastBackendError}` : 'No se pudieron obtener las canciones de la lista de YouTube.');
}

/**
 * Fetches information (title, artist, thumbnail) for a single YouTube video
 */
export async function fetchVideoInfo(videoId: string): Promise<{ title: string; artist: string; thumbnail?: string }> {
  try {
    const res = await fetch(`/api/ytm/video-info?id=${encodeURIComponent(videoId)}`);
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title || 'Video de YouTube',
        artist: data.artist || 'YouTube Music',
        thumbnail: data.thumbnail,
      };
    }
  } catch (e) {}

  try {
    const oembed = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (oembed.ok) {
      const data = await oembed.json();
      return {
        title: data.title || 'Video de YouTube',
        artist: data.author_name || 'YouTube Music',
        thumbnail: data.thumbnail_url,
      };
    }
  } catch (e) {}

  return {
    title: 'Video de YouTube',
    artist: 'YouTube Music',
  };
}

/**
 * Checks if the local automated YouTube Music backend is available (running inside Winamp desktop)
 */
export async function checkDirectYTMSupport(): Promise<boolean> {
  try {
    const res = await fetch('/api/ytm/status');
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.isElectron;
  } catch {
    return false;
  }
}

export async function getDirectYTMStatus(): Promise<{ loggedIn: boolean }> {
  try {
    const res = await fetch('/api/ytm/status');
    if (res.ok) {
      const data = await res.json();
      return { loggedIn: !!data.loggedIn };
    }
  } catch (e) {}
  return { loggedIn: false };
}

export async function loginDirectYTM(): Promise<boolean> {
  try {
    const res = await fetch('/api/ytm/login');
    if (res.ok) {
      const data = await res.json();
      return !!data.success;
    }
  } catch (e) {
    console.error('Error during direct YTM login:', e);
  }
  return false;
}

export async function fetchDirectYTMPlaylists(forceRefresh = false): Promise<Playlist[]> {
  const res = await fetch(`/api/ytm/playlists${forceRefresh ? '?refresh=true' : ''}`);
  if (!res.ok) throw new Error('Error obteniendo playlists de YouTube Music');
  const remote: Playlist[] = await res.json();
  const map = new Map<string, Playlist>();
  remote.forEach(p => map.set(p.id, p));
  getLocalSavedPlaylists().forEach(p => {
    if (!map.has(p.id)) map.set(p.id, p);
  });
  return Array.from(map.values());
}

export async function searchYoutubeBackend(query: string): Promise<Track[]> {
  try {
    const res = await fetch(`/api/ytm/search?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.warn('Backend InnerTube search failed:', e);
  }
  return [];
}

export async function fetchDirectYTMPlaylistTracks(playlistId: string): Promise<Track[]> {
  const res = await fetch(`/api/ytm/playlist-tracks?id=${encodeURIComponent(playlistId)}`);
  if (!res.ok) throw new Error('Error obteniendo pistas de YouTube Music');
  return res.json();
}

export async function logoutDirectYTM(): Promise<void> {
  await fetch('/api/ytm/logout');
}

export async function openOAuthInSystemBrowser(url: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/open-browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return res.ok;
  } catch {
    window.open(url, '_blank');
    return true;
  }
}

export async function pollOAuthToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/poll-token');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.token) {
        return data.token;
      }
    }
  } catch {}
  return null;
}
