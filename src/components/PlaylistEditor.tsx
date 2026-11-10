import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, Trash2, ArrowUp, ArrowDown, Music, Search, LogIn, LogOut, 
  Loader2, ListMusic, Copy, Check, ExternalLink, RefreshCw, Library, Play, Star, Bookmark
} from 'lucide-react';

const Youtube = ({ size = 16, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);
import { Track, Playlist, WinampSkin } from '../types';
import { 
  getGoogleAuthUrl, getGoogleClientId, getYoutubeToken, 
  fetchYoutubePlaylists, fetchYoutubePlaylistTracks, logoutYoutube, 
  setGoogleClientId, fetchPlaylistByUrlOrId, extractPlaylistId,
  checkDirectYTMSupport, getDirectYTMStatus, loginDirectYTM,
  fetchDirectYTMPlaylists, fetchDirectYTMPlaylistTracks, logoutDirectYTM,
  openOAuthInSystemBrowser, pollOAuthToken, fetchVideoInfo,
  savePlaylistToLocal, removePlaylistFromLocal, getLocalSavedPlaylists,
  fetchServerSession, setYoutubeToken as persistYoutubeToken, searchYoutubeBackend
} from '../utils/youtube';

interface PlaylistEditorProps {
  tracks: Track[];
  currentTrackIndex: number;
  selectedTrackIndex?: number;
  currentTime?: number;
  skin: WinampSkin;
  onSelectTrack: (index: number) => void;
  onPlayTrack?: (index: number) => void;
  onAddTrack: (track: Track, andPlay?: boolean) => void;
  onAddTracks?: (tracks: Track[], replace?: boolean, autoPlay?: boolean) => void;
  onRemoveTrack: (index: number) => void;
  onClearPlaylist: () => void;
  onSortPlaylist: () => void;
  onReorderPlaylist: (from: number, to: number) => void;
  onClose: () => void;
}

export default function PlaylistEditor({
  tracks,
  currentTrackIndex,
  selectedTrackIndex,
  currentTime = 0,
  skin,
  onSelectTrack,
  onPlayTrack,
  onAddTrack,
  onAddTracks,
  onRemoveTrack,
  onClearPlaylist,
  onSortPlaylist,
  onReorderPlaylist,
  onClose,
}: PlaylistEditorProps) {
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);

  // YouTube States
  const [youtubeToken, setYoutubeToken] = useState<string | null>(getYoutubeToken());
  const [ytPlaylists, setYtPlaylists] = useState<Playlist[]>([]);
  const [selectedYtPlaylistId, setSelectedYtPlaylistId] = useState<string>('');
  const [isLoadingYtPlaylists, setIsLoadingYtPlaylists] = useState(false);
  const [isDirectYTM, setIsDirectYTM] = useState(false);
  const [isDirectLoggedIn, setIsDirectLoggedIn] = useState(false);
  const [isPollingOAuth, setIsPollingOAuth] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);

  // Playlist Explorer / Search Modal
  const [showPlaylistExplorer, setShowPlaylistExplorer] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');
  const [playlistTab, setPlaylistTab] = useState<'all' | 'liked' | 'saved'>('all');

  // Config States
  const [showConfig, setShowConfig] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [customGoogleClientId, setCustomGoogleClientId] = useState(() => getGoogleClientId());
  const [directTokenInput, setDirectTokenInput] = useState('');

  const handleSaveDirectToken = () => {
    let raw = directTokenInput.trim();
    if (!raw) return;
    let token = raw;
    if (raw.includes('access_token=')) {
      const match = raw.match(/access_token=([a-zA-Z0-9_\-\.]+)/);
      if (match && match[1]) token = match[1];
    }
    if (token) {
      setYoutubeToken(token);
      persistYoutubeToken(token);
      setShowConfig(false);
      setDirectTokenInput('');
      loadYoutubePlaylists(false, true);
    }
  };

  // Search States (YouTube/Invidious only)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [addedIds, setAddedIds] = useState<string[]>([]);

  // Direct paste states
  const [pastedUrl, setPastedUrl] = useState('');
  const [showUrlPanel, setShowUrlPanel] = useState(false);
  const [isLoadingUrlPlaylist, setIsLoadingUrlPlaylist] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showRemMenu, setShowRemMenu] = useState(false);

  // Total playlist duration
  const totalDuration = useMemo(() => {
    return tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  }, [tracks]);

  const currentTrackDuration = tracks[currentTrackIndex]?.duration || 0;

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Filtered playlists based on search query and category tabs
  const filteredPlaylists = useMemo(() => {
    let list = ytPlaylists;
    if (playlistTab === 'liked') {
      list = list.filter(p => p.id === 'LM' || p.id === 'LL' || p.id.startsWith('LL') || p.name.includes('Me Gusta') || p.name.startsWith('⭐'));
    } else if (playlistTab === 'saved') {
      list = list.filter(p => p.id !== 'LM' && p.id !== 'LL' && !p.name.includes('Me Gusta') && !p.name.startsWith('⭐'));
    }

    if (!playlistSearchQuery.trim()) return list;
    const q = playlistSearchQuery.toLowerCase();
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [ytPlaylists, playlistSearchQuery, playlistTab]);

  // Check and restore persistent session on startup (both Direct YTM and OAuth from disk)
  useEffect(() => {
    let isMounted = true;

    const initSession = async () => {
      try {
        const supported = await checkDirectYTMSupport();
        if (isMounted) setIsDirectYTM(supported);

        // Fetch persistent auth session saved on disk by local server
        const { token, isDirectLoggedIn: directLogged } = await fetchServerSession();

        if (!isMounted) return;

        if (directLogged) {
          setIsDirectLoggedIn(true);
          setYoutubeToken('direct_ytm_session');
          return;
        }

        if (token) {
          setYoutubeToken(token);
          persistYoutubeToken(token);
          return;
        }

        // Fallback to localStorage if any
        const localTok = getYoutubeToken();
        if (localTok) {
          setYoutubeToken(localTok);
          persistYoutubeToken(localTok);
        }
      } catch (e) {
        console.error('Error initializing persistent session:', e);
      }
    };

    initSession();

    const handleOAuthMessage = (e: MessageEvent) => {
      if (e.data?.type === 'OAUTH_YT_SUCCESS') {
        const token = e.data.token || getYoutubeToken();
        if (token) {
          setYoutubeToken(token);
          persistYoutubeToken(token);
          loadYoutubePlaylists();
        }
      } else if (e.data?.type === 'OAUTH_YT_ERROR') {
        alert('Error de autenticación con YouTube: ' + e.data.error);
      }
    };
    window.addEventListener('message', handleOAuthMessage);

    return () => {
      isMounted = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      window.removeEventListener('message', handleOAuthMessage);
    };
  }, []);

  // Auto-load YouTube playlists if authenticated
  useEffect(() => {
    if (youtubeToken) {
      loadYoutubePlaylists();
    }
  }, [youtubeToken]);

  const loadYoutubePlaylists = async (forceDirect?: boolean, forceRefresh = false) => {
    setIsLoadingYtPlaylists(true);
    try {
      if (forceDirect || isDirectLoggedIn || youtubeToken === 'direct_ytm_session') {
        const lists = await fetchDirectYTMPlaylists(forceRefresh);
        setYtPlaylists(lists);
      } else {
        try {
          const lists = await fetchYoutubePlaylists();
          setYtPlaylists(lists);
        } catch (oauthErr) {
          // If OAuth token expired, check if Direct YTM cookies exist as fallback
          const status = await getDirectYTMStatus();
          if (status.loggedIn) {
            setIsDirectLoggedIn(true);
            setYoutubeToken('direct_ytm_session');
            const lists = await fetchDirectYTMPlaylists(forceRefresh);
            setYtPlaylists(lists);
          } else {
            setYoutubeToken(null);
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to load YouTube playlists:', err);
    } finally {
      setIsLoadingYtPlaylists(false);
    }
  };

  const handleDirectLogin = async () => {
    setShowConnectModal(false);
    setIsLoadingYtPlaylists(true);
    try {
      const ok = await loginDirectYTM();
      if (ok) {
        setIsDirectLoggedIn(true);
        setYoutubeToken('direct_ytm_session');
        await loadYoutubePlaylists(true, true);
      }
    } catch (e) {
      console.error('Error in Direct YTM login:', e);
    } finally {
      setIsLoadingYtPlaylists(false);
    }
  };

  const cancelOAuthPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPollingOAuth(false);
    setIsLoadingYtPlaylists(false);
  };

  const handleBrowserLogin = async () => {
    setShowConnectModal(false);
    const clientId = getGoogleClientId();
    if (!clientId || clientId.trim() === '') {
      setShowConfig(true);
      setShowPlaylistExplorer(false);
      setShowSearchPanel(false);
      setShowUrlPanel(false);
      alert('Para conectar con tu navegador (Chrome/Edge), configura tu Google Client ID en este panel o usa la opción "En Winamp (Permanente)".');
      return;
    }

    try {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setIsPollingOAuth(true);
      const authUrl = getGoogleAuthUrl();
      
      // Open in user's default external browser (Chrome / Edge)
      await openOAuthInSystemBrowser(authUrl);

      // Start polling for token arrival from callback page
      pollIntervalRef.current = window.setInterval(async () => {
        const token = await pollOAuthToken();
        if (token) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setIsPollingOAuth(false);
          setYoutubeToken(token);
          persistYoutubeToken(token);
          loadYoutubePlaylists(false, true);
        }
      }, 1000);

      // Timeout polling after 3 minutes
      setTimeout(() => {
        cancelOAuthPolling();
      }, 180000);
    } catch (err: any) {
      console.error('Error initiating OAuth in system browser:', err);
      cancelOAuthPolling();
      alert('Error al abrir el navegador: ' + (err.message || ''));
    }
  };

  const handleYoutubeConnect = () => {
    handleBrowserLogin();
  };

  const handleYoutubeDisconnect = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      await logoutDirectYTM();
    } catch (e) {
      console.error(e);
    }
    setIsDirectLoggedIn(false);
    logoutYoutube();
    setYoutubeToken(null);
    setYtPlaylists([]);
    setSelectedYtPlaylistId('');
    setShowPlaylistExplorer(false);
  };

  // Load a playlist's tracks directly into Winamp
  const handleLoadPlaylist = async (id: string, replace = true) => {
    if (!id) return;
    setIsLoadingTracks(true);
    try {
      let playlistTracks: Track[] = [];
      if (isDirectLoggedIn || youtubeToken === 'direct_ytm_session') {
        playlistTracks = await fetchDirectYTMPlaylistTracks(id);
      } else {
        playlistTracks = await fetchYoutubePlaylistTracks(id);
      }

      if (playlistTracks.length === 0) {
        alert('Esta lista no contiene canciones o videos disponibles.');
        return;
      }
      
      if (onAddTracks) {
        onAddTracks(playlistTracks, replace, replace);
      } else if (replace) {
        onClearPlaylist();
        playlistTracks.forEach((t, idx) => onAddTrack(t, idx === 0));
      } else {
        playlistTracks.forEach((t) => onAddTrack(t, false));
      }

      setSelectedYtPlaylistId(id);
      setShowPlaylistExplorer(false);
    } catch (err) {
      console.error(err);
      alert('Error al cargar canciones de la lista de YouTube. Vuelva a conectar su cuenta si la sesión expiró.');
    } finally {
      setIsLoadingTracks(false);
    }
  };

  // Quick dropdown handler
  const handleYtPlaylistSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id === '__EXPLORE__') {
      setShowPlaylistExplorer(true);
      return;
    }
    handleLoadPlaylist(id, true);
  };

  // Search YouTube / Invidious keylessly
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]);

    let success = false;

    // 0. Try fast local InnerTube search first (<300ms, no API key or mirrors needed)
    try {
      const localResults = await searchYoutubeBackend(searchQuery);
      if (localResults && localResults.length > 0) {
        setSearchResults(localResults);
        success = true;
      }
    } catch (e) {}

    // 1. Try official YouTube Search API if authenticated and local search didn't return
    if (!success && youtubeToken && youtubeToken !== 'direct_ytm_session') {
      try {
        const apiKey = (import.meta as any).env?.VITE_GOOGLE_API_KEY;
        const keyParam = apiKey && apiKey.trim() ? `&key=${apiKey.trim()}` : '';
        const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery)}&type=video&maxResults=15${keyParam}`, {
          headers: {
            Authorization: `Bearer ${youtubeToken}`,
            Accept: 'application/json',
          }
        });
        if (res.ok) {
          const data = await res.json();
          const items = data.items || [];
          const formatted: Track[] = items
            .map((item: any) => ({
              id: `yt-${item.id?.videoId || ''}`,
              title: item.snippet?.title || '',
              artist: item.snippet?.channelTitle || 'YouTube Music',
              duration: 240,
              url: item.id?.videoId || '',
              source: 'youtube' as const,
              thumbnail: item.snippet?.thumbnails?.default?.url || '',
            }))
            .filter((t: any) => t.url);

          if (formatted.length > 0) {
            setSearchResults(formatted);
            success = true;
          }
        }
      } catch (err) {
        console.warn('Official YouTube API Search failed, falling back to mirrors...', err);
      }
    }

    // 2. Query Piped and Invidious APIs across active mirrors as fallback
    if (!success) {
      const endpoints = [
        { type: 'piped', url: 'https://pipedapi.kavin.rocks' },
        { type: 'piped', url: 'https://pipedapi.adminforge.de' },
        { type: 'piped', url: 'https://pipedapi.privacydev.net' },
        { type: 'invidious', url: 'https://invidious.projectsegfau.lt' },
        { type: 'invidious', url: 'https://yewtu.be' }
      ];
      
      for (const endpoint of endpoints) {
        try {
          if (endpoint.type === 'piped') {
            const res = await fetch(`${endpoint.url}/search?q=${encodeURIComponent(searchQuery)}&filter=all`);
            if (res.ok) {
              const data = await res.json();
              const items = Array.isArray(data) ? data : (data.items || []);
              const formatted: Track[] = items
                .filter((item: any) => item.type === 'stream')
                .map((item: any) => {
                  const videoId = item.url ? item.url.split('v=')[1] || item.url.split('/').pop() : '';
                  return {
                    id: `yt-${videoId}`,
                    title: item.title || '',
                    artist: item.uploaderName || 'YouTube Music',
                    duration: item.duration || 240,
                    url: videoId || '',
                    source: 'youtube' as const,
                    thumbnail: item.thumbnail || '',
                  };
                })
                .filter((t: any) => t.url);

              if (formatted.length > 0) {
                setSearchResults(formatted);
                success = true;
                break;
              }
            }
          } else {
            const res = await fetch(`${endpoint.url}/api/v1/search?q=${encodeURIComponent(searchQuery)}&limit=15`);
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data) && data.length > 0) {
                const formatted: Track[] = data.map((item: any) => ({
                  id: `yt-${item.videoId}`,
                  title: item.title,
                  artist: item.author || 'YouTube Music',
                  duration: item.lengthSeconds || 240,
                  url: item.videoId,
                  source: 'youtube' as const,
                  thumbnail: item.videoThumbnails?.[0]?.url || '',
                }));
                setSearchResults(formatted);
                success = true;
                break;
              }
            }
          }
        } catch (err) {
          // ignore mirror error and try next
        }
      }
    }

    if (!success) {
      setSearchResults([
        {
          id: `yt-dQw4w9WgXcQ`,
          title: `${searchQuery} (Búsqueda Fallida - Reproducción Fallback)`,
          artist: 'YouTube Fallback',
          duration: 212,
          url: 'dQw4w9WgXcQ',
          source: 'youtube',
        }
      ]);
    }
    setIsSearching(false);
  };

  // Add parsed URL manually (supports playlists or single videos / MP3s)
  const handleAddUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = pastedUrl.trim();
    if (!url) return;

    // 1. Check if it is a YouTube / YouTube Music playlist
    const playlistId = extractPlaylistId(url);
    if (playlistId) {
      setIsLoadingUrlPlaylist(true);
      try {
        const result = await fetchPlaylistByUrlOrId(url);
        if (result.tracks.length === 0) {
          alert('La lista no contiene canciones reproducibles.');
          return;
        }

        if (onAddTracks) {
          onAddTracks(result.tracks, false, false);
        } else {
          result.tracks.forEach((track) => onAddTrack(track, false));
        }
        savePlaylistToLocal({
          id: playlistId,
          name: result.name,
          itemCount: result.tracks.length,
          tracks: [],
          thumbnail: result.tracks[0]?.thumbnail || '',
        });
        loadYoutubePlaylists();
        alert(`¡Lista "${result.name}" importada con éxito y guardada en tu biblioteca! Se añadieron ${result.tracks.length} canciones.`);
        setPastedUrl('');
        setShowUrlPanel(false);
        return;
      } catch (err: any) {
        console.error(err);
        alert(err.message || 'No se pudo cargar la playlist de YouTube Music.');
      } finally {
        setIsLoadingUrlPlaylist(false);
      }
      return;
    }

    // 2. Check if it is a single YouTube video
    const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/i);
    if (ytMatch && ytMatch[1]) {
      const videoId = ytMatch[1];
      setIsLoadingUrlPlaylist(true);
      try {
        const info = await fetchVideoInfo(videoId);
        onAddTrack({
          id: `yt-${videoId}-${Date.now()}`,
          title: info.title || 'Video de YouTube',
          artist: info.artist || 'YouTube Music',
          duration: 240,
          url: videoId,
          source: 'youtube',
          thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        });
        setPastedUrl('');
        setShowUrlPanel(false);
      } catch (e) {
        onAddTrack({
          id: `yt-${videoId}-${Date.now()}`,
          title: 'Video Manual de YouTube',
          artist: 'YouTube Music',
          duration: 240,
          url: videoId,
          source: 'youtube',
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        });
        setPastedUrl('');
        setShowUrlPanel(false);
      } finally {
        setIsLoadingUrlPlaylist(false);
      }
      return;
    }

    // 3. Direct MP3 links
    if (url.endsWith('.mp3') || url.includes('.mp3?')) {
      const title = url.split('/').pop()?.split('?')[0] || 'Enlace Directo MP3';
      onAddTrack({
        id: `local-${Date.now()}`,
        title: decodeURIComponent(title),
        artist: 'Web Audio',
        duration: 240,
        url: url,
        source: 'local',
      });
      setPastedUrl('');
      setShowUrlPanel(false);
      return;
    }

    alert('Enlace no reconocido. Pegue un enlace de playlist de YouTube Music (con list=...), video de YouTube o archivo MP3.');
  };

  const handleCopyRedirectUri = () => {
    const uri = 'http://localhost:3000/auth/youtube/callback';
    navigator.clipboard.writeText(uri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2000);
  };

  // Move track up/down helpers
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    onReorderPlaylist(index, index - 1);
  };

  const handleMoveDown = (index: number) => {
    if (index === tracks.length - 1) return;
    onReorderPlaylist(index, index + 1);
  };

  // Theme mapper
  const getSkinTheme = () => {
    switch (skin) {
      case 'slate':
        return {
          bg: 'bg-slate-900 border-slate-700 text-slate-100',
          trackActive: 'bg-sky-950 text-sky-400 font-bold',
          controlBg: 'bg-slate-950 border-slate-800',
          scrollbar: 'winamp-scrollbar',
        };
      case 'llama':
        return {
          bg: 'bg-amber-950 border-amber-700 text-amber-100',
          trackActive: 'bg-amber-950 text-amber-500 font-bold',
          controlBg: 'bg-black border-amber-900',
          scrollbar: 'winamp-scrollbar',
        };
      case 'classic':
      default:
        return {
          bg: 'winamp-metal text-[#b4b5b8] font-mono',
          trackActive: 'bg-[#0000d8] text-[#00ffff] font-bold',
          controlBg: 'bg-[#000000] border-[#1a1a24]',
          scrollbar: 'winamp-scrollbar',
        };
    }
  };

  const theme = getSkinTheme();

  return (
    <div 
      id="winamp-playlist"
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.cursor-move')) {
          e.stopPropagation();
        }
      }}
      className={`w-full h-full p-[3px] box-border select-none rounded-[2px] flex flex-col justify-between shadow-2xl relative ${theme.bg} winamp-border-outset overflow-hidden`}
    >
      {/* 1. Classic Winamp Titlebar with Dual Brass Lines */}
      <div className="h-[14px] flex items-center justify-between cursor-move winamp-titlebar-classic px-[3px] relative overflow-hidden">
        <div className="absolute inset-y-[3px] left-4 right-8 winamp-titlebar-stripes opacity-70 pointer-events-none" />
        <span className="text-[8px] font-pixel text-[#e0e0ea] font-bold tracking-[0.15em] z-10 pointer-events-none uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] px-1 bg-[#242438]/80">
          WINAMP PLAYLIST
        </span>
        <button 
          id="close-pl-btn"
          onClick={onClose}
          className="w-[10px] h-[9px] winamp-btn-silver text-[7px] font-bold text-[#b00] hover:text-red-600 flex items-center justify-center p-0 z-10"
        >
          ×
        </button>
      </div>

      {/* 2. YouTube Music Account & Library Quick Bar */}
      <div className="p-[3px] rounded-[1px] text-[10px] flex items-center justify-between gap-[3px] border border-black bg-black/50 mt-[1px] shrink-0">
        <div className="flex items-center gap-[4px] truncate flex-1">
          <Youtube size={13} className="text-red-500 shrink-0" />
          {youtubeToken ? (
            <div className="flex items-center gap-[3px] w-full">
              {isLoadingYtPlaylists ? (
                <div className="flex items-center gap-1 text-[8px] text-red-400 font-pixel">
                  <Loader2 size={10} className="animate-spin" /> Cargando listas...
                </div>
              ) : (
                <div className="flex items-center gap-[2px] w-full">
                  <button
                    onClick={() => {
                      setShowPlaylistExplorer(true);
                      setShowSearchPanel(false);
                      setShowUrlPanel(false);
                      setShowConfig(false);
                    }}
                    className="flex-1 px-[4px] py-[2px] bg-red-950/60 hover:bg-red-900 border border-red-800 text-red-300 rounded-[2px] text-[8px] font-pixel flex items-center justify-between truncate cursor-pointer"
                    title="Buscar y explorar tus playlists de YouTube Music"
                  >
                    <span className="truncate flex items-center gap-1">
                      <Library size={9} className="shrink-0 text-red-400" />
                      {selectedYtPlaylistId 
                        ? (ytPlaylists.find(p => p.id === selectedYtPlaylistId)?.name || 'Playlists')
                        : `Mis Playlists (${ytPlaylists.length})`}
                    </span>
                    <Search size={8} className="shrink-0 opacity-70 ml-1" />
                  </button>

                  <select
                    id="youtube-playlist-select"
                    value={selectedYtPlaylistId}
                    onChange={handleYtPlaylistSelect}
                    className="bg-[#1c1c1f] text-red-300 text-[8px] border border-gray-700 rounded-[2px] px-[2px] py-[1px] max-w-[70px] focus:outline-none cursor-pointer"
                    title="Selección rápida de playlist"
                  >
                    <option value="">Listas...</option>
                    <option value="__EXPLORE__">🔍 Buscar lista...</option>
                    {ytPlaylists.map((pl) => (
                      <option key={pl.id} value={pl.id}>{pl.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <span className="text-[8px] text-gray-400 truncate font-pixel">YouTube Music</span>
          )}
        </div>

        {youtubeToken ? (
          <div className="flex items-center gap-[2px] shrink-0">
            <button 
              onClick={() => loadYoutubePlaylists(undefined, true)}
              disabled={isLoadingYtPlaylists}
              title="Recargar mis listas"
              className="p-[2px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-[2px] text-[8px] cursor-pointer"
            >
              <RefreshCw size={8} className={isLoadingYtPlaylists ? 'animate-spin' : ''} />
            </button>
            <button 
              id="youtube-logout-btn"
              onClick={handleYoutubeDisconnect}
              title="Cerrar sesión de YouTube"
              className="px-[4px] py-[2px] bg-red-950/50 hover:bg-red-900 border border-red-800 text-red-400 rounded-[2px] text-[8px] flex items-center gap-[2px] cursor-pointer"
            >
              <LogOut size={8} /> Salir
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-[2px] shrink-0">
            <button 
              id="youtube-info-btn"
              onClick={() => {
                setShowConfig(true);
                setShowPlaylistExplorer(false);
                setShowSearchPanel(false);
                setShowUrlPanel(false);
              }}
              className="px-[4px] py-[2px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-300 rounded-[2px] text-[8px] font-mono cursor-pointer"
              title="Configurar Google Client ID y Redirect URI"
            >
              ⚙️
            </button>
            {isPollingOAuth ? (
              <button
                onClick={cancelOAuthPolling}
                className="px-[5px] py-[2px] bg-amber-950/80 hover:bg-amber-900 border border-amber-700 text-amber-300 rounded-[2px] text-[8px] flex items-center gap-[2px] font-bold cursor-pointer font-pixel"
                title="Cancelar espera del navegador"
              >
                <Loader2 size={8} className="animate-spin" /> Cancelar
              </button>
            ) : (
              <button 
                id="youtube-connect-btn"
                onClick={handleYoutubeConnect}
                title="Conectar cuenta de Google / YouTube Music"
                className="px-[5px] py-[2px] bg-red-950/70 hover:bg-red-900 border border-red-700 text-red-400 rounded-[2px] text-[8px] flex items-center gap-[2px] font-bold cursor-pointer font-pixel"
              >
                {isLoadingYtPlaylists ? <Loader2 size={8} className="animate-spin" /> : <LogIn size={8} />} Conectar
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3. Playlist Tracks Scroller Area */}
      <div className={`flex-1 overflow-y-auto ${theme.controlBg} ${theme.scrollbar} winamp-border-inset mt-[2px] relative`}>
        {tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-3 text-gray-500">
            <Music size={16} className="opacity-40 animate-pulse mb-1" />
            <span className="text-[8px] leading-tight font-pixel text-[#00aa00]">Lista vacía. Conecta YouTube o usa +ADD</span>
          </div>
        ) : (
          <div className="flex flex-col font-winamp-playlist text-[11px]">
            {tracks.map((track, idx) => {
              const isPlaying = idx === currentTrackIndex;
              const isSelected = selectedTrackIndex !== undefined ? idx === selectedTrackIndex : isPlaying;

              // Only text color changes for playing track - no background box or shading
              let textStyle = 'text-[#00bb00]';
              if (isPlaying) {
                textStyle = 'text-[#ffff00] font-bold drop-shadow-[0_0_2px_rgba(255,255,0,0.5)]';
              } else if (isSelected) {
                textStyle = 'text-[#00ffff] font-medium';
              }

              return (
                <div 
                  key={track.id}
                  onClick={() => onSelectTrack(idx)}
                  onDoubleClick={(e) => { 
                    e.preventDefault(); 
                    e.stopPropagation(); 
                    if (onPlayTrack) {
                      onPlayTrack(idx);
                    } else {
                      onSelectTrack(idx);
                    }
                  }}
                  className={`flex items-center justify-between py-[1.5px] px-[4px] border-b border-[#0d0d14]/60 hover:bg-white/5 group cursor-pointer select-none leading-none ${textStyle}`}
                >
                  <div className="flex items-center gap-[3px] truncate flex-1 pr-[4px]">
                    {isPlaying ? (
                      <span className="text-[#39ff14] font-bold text-[9px] w-[12px] shrink-0 text-center animate-pulse">▶</span>
                    ) : (
                      <span className="w-[12px] shrink-0" />
                    )}
                    <span className={`text-[10px] w-[18px] shrink-0 text-right ${isPlaying ? 'text-[#ffff00] font-bold' : isSelected ? 'text-[#00ffff]' : 'text-[#008800]'}`}>
                      {idx + 1}.
                    </span>
                    {track.source === 'youtube' && <Youtube size={10} className="text-red-500 shrink-0" />}
                    <span className="truncate">
                      {track.artist} - {track.title}
                    </span>
                  </div>
                  
                  {/* Track Duration or Row Actions */}
                  <div className="flex items-center gap-[4px] shrink-0">
                    <span className={`text-[10px] font-mono group-hover:hidden ${isPlaying ? 'text-[#ffff00] font-bold' : isSelected ? 'text-[#00ffff]' : 'text-[#00aa00]'}`}>
                      {Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}
                    </span>
                    
                    {/* Action buttons on hover */}
                    <div className="hidden group-hover:flex items-center gap-[2px]">
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          if (onPlayTrack) onPlayTrack(idx);
                          else onSelectTrack(idx); 
                        }}
                        className="p-[1px] text-[#00e100] hover:text-green-300 cursor-pointer"
                        title="Reproducir ahora"
                      >
                        <Play size={8} className="fill-current" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleMoveUp(idx); }}
                        disabled={idx === 0}
                        className="p-[1px] hover:text-white disabled:opacity-20"
                        title="Mover arriba"
                      >
                        <ArrowUp size={8} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleMoveDown(idx); }}
                        disabled={idx === tracks.length - 1}
                        className="p-[1px] hover:text-white disabled:opacity-20"
                        title="Mover abajo"
                      >
                        <ArrowDown size={8} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onRemoveTrack(idx); }}
                        className="p-[1px] text-red-500 hover:text-red-400"
                        title="Quitar"
                      >
                        <Trash2 size={8} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Floating loading cover */}
        {isLoadingTracks && (
          <div className="absolute inset-0 bg-black/75 flex items-center justify-center z-20">
            <Loader2 size={16} className="animate-spin text-red-500" />
            <span className="text-[9px] font-pixel text-white ml-2">Cargando canciones de la lista...</span>
          </div>
        )}
      </div>

      {/* 4. OVERLAY: Explorer & Search User's YouTube Music Playlists */}
      {showPlaylistExplorer && (
        <div className="absolute inset-x-0 bottom-[22px] top-[14px] bg-[#141416] border-t border-black p-[5px] flex flex-col justify-between z-30 font-pixel">
          <div className="flex items-center justify-between border-b border-gray-800 pb-1 mb-1">
            <div className="flex items-center gap-1 text-[9px] font-bold text-red-400">
              <Library size={10} />
              <span>BIBLIOTECA DE PLAYLISTS</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setShowUrlPanel(true);
                  setShowPlaylistExplorer(false);
                }}
                className="px-1.5 py-[1px] bg-green-950/80 hover:bg-green-900 border border-green-800 text-[7px] text-[#00e100] rounded-[1px] font-bold cursor-pointer flex items-center gap-1"
                title="Pegar enlace de cualquier playlist seguida para importarla"
              >
                <span>➕</span> Importar Link
              </button>
              <span className="text-[8px] text-gray-500">{filteredPlaylists.length} listas</span>
              {youtubeToken ? (
                <button
                  onClick={handleYoutubeDisconnect}
                  className="px-1.5 py-[1px] bg-zinc-800 hover:bg-red-950/80 border border-zinc-700 hover:border-red-800 text-[7px] text-gray-400 hover:text-red-300 rounded-[1px]"
                  title="Cerrar sesión de YouTube Music"
                >
                  Salir
                </button>
              ) : (
                <button
                  onClick={handleYoutubeConnect}
                  className="px-1.5 py-[1px] bg-red-950/80 hover:bg-red-900 border border-red-800 text-[7px] text-red-300 rounded-[1px] font-bold"
                >
                  Conectar
                </button>
              )}
            </div>
          </div>

          {/* Search filter input */}
          <div className="relative my-1">
            <input
              type="text"
              placeholder="Buscar playlist por nombre..."
              value={playlistSearchQuery}
              onChange={(e) => setPlaylistSearchQuery(e.target.value)}
              className="w-full bg-black text-white border border-gray-700 text-[8px] pl-[18px] pr-[16px] py-[2px] focus:outline-none rounded-[1px] font-sans"
              autoFocus
            />
            <Search size={9} className="absolute left-[5px] top-[4px] text-gray-500" />
            {playlistSearchQuery && (
              <button
                onClick={() => setPlaylistSearchQuery('')}
                className="absolute right-[4px] top-[2px] text-gray-400 hover:text-white text-[9px]"
              >
                ×
              </button>
            )}
          </div>

          {/* Quick Filter Tabs: Todas, Me Gusta, Seguidas & Guardadas */}
          <div className="flex items-center gap-[2px] mb-1 text-[7px]">
            <button
              onClick={() => setPlaylistTab('all')}
              className={`px-2 py-[2px] rounded-[1px] border cursor-pointer ${playlistTab === 'all' ? 'bg-red-900/80 border-red-700 text-white font-bold' : 'bg-[#181820] border-gray-800 text-gray-400 hover:text-gray-200'}`}
            >
              Todas ({ytPlaylists.length})
            </button>
            <button
              onClick={() => setPlaylistTab('liked')}
              className={`px-2 py-[2px] rounded-[1px] border cursor-pointer ${playlistTab === 'liked' ? 'bg-red-900/80 border-red-700 text-white font-bold' : 'bg-[#181820] border-gray-800 text-gray-400 hover:text-gray-200'}`}
            >
              ⭐ Me Gusta
            </button>
            <button
              onClick={() => setPlaylistTab('saved')}
              className={`px-2 py-[2px] rounded-[1px] border cursor-pointer ${playlistTab === 'saved' ? 'bg-red-900/80 border-red-700 text-white font-bold' : 'bg-[#181820] border-gray-800 text-gray-400 hover:text-gray-200'}`}
            >
              📋 Seguidas / Guardadas
            </button>
          </div>

          {/* Playlists List */}
          <div className="flex-1 overflow-y-auto bg-black/60 border border-[#222] my-[2px] p-[2px] text-[8px] winamp-scrollbar">
            {!youtubeToken ? (
              <div className="flex flex-col items-center justify-center h-full p-2 text-center text-gray-400">
                <Youtube size={20} className="text-red-500 mb-1 opacity-70" />
                <p className="text-[8px] leading-tight mb-2">Conecta tu cuenta de Google para ver y buscar todas tus playlists de YouTube Music.</p>
                <button
                  onClick={handleYoutubeConnect}
                  className="px-2 py-1 bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-300 rounded-[2px] text-[8px] font-bold"
                >
                  Conectar Cuenta
                </button>
              </div>
            ) : isLoadingYtPlaylists ? (
              <div className="flex items-center justify-center h-full gap-1 text-gray-500">
                <Loader2 size={12} className="animate-spin text-red-500" /> Sincronizando playlists y seguidas...
              </div>
            ) : filteredPlaylists.length === 0 ? (
              <div className="text-center text-gray-500 py-4">
                {playlistSearchQuery ? 'No se encontraron playlists que coincidan' : 'No hay playlists en esta categoría'}
              </div>
            ) : (
              filteredPlaylists.map((pl) => {
                const isLiked = pl.id === 'LM' || pl.id === 'LL' || pl.id.startsWith('LL') || pl.name.includes('Me Gusta') || pl.name.startsWith('⭐');
                const isLocalSaved = getLocalSavedPlaylists().some(s => s.id === pl.id);

                return (
                  <div
                    key={pl.id}
                    className="flex items-center justify-between p-[2px] border-b border-gray-900/80 hover:bg-[#222]/80 group text-white cursor-pointer"
                    onClick={() => handleLoadPlaylist(pl.id, true)}
                  >
                    <div className="flex items-center gap-[4px] truncate flex-1 pr-1">
                      {pl.thumbnail ? (
                        <img src={pl.thumbnail} alt="" className="w-[20px] h-[20px] object-cover rounded-[1px] shrink-0 border border-black" />
                      ) : (
                        <div className="w-[20px] h-[20px] bg-[#222] flex items-center justify-center rounded-[1px] shrink-0">
                          <ListMusic size={10} className="text-gray-500" />
                        </div>
                      )}
                      <div className="flex flex-col truncate">
                        <div className="flex items-center gap-1">
                          <span className="font-sans font-medium text-[8px] truncate leading-tight text-gray-200 group-hover:text-red-400">
                            {pl.name}
                          </span>
                          {isLiked ? (
                            <span className="text-[6px] bg-red-950 text-red-400 border border-red-800 px-[2px] rounded-[1px] shrink-0 font-pixel">
                              FAVORITAS
                            </span>
                          ) : isLocalSaved ? (
                            <span className="text-[6px] bg-sky-950 text-sky-300 border border-sky-800 px-[2px] rounded-[1px] shrink-0 font-pixel">
                              GUARDADA
                            </span>
                          ) : (
                            <span className="text-[6px] bg-zinc-800 text-gray-400 border border-zinc-700 px-[2px] rounded-[1px] shrink-0 font-pixel">
                              BIBLIOTECA
                            </span>
                          )}
                        </div>
                        {pl.itemCount !== undefined && (
                          <span className="text-[7px] text-gray-500 font-mono">
                            {pl.itemCount} temas
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-[2px] shrink-0">
                      {isLocalSaved && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removePlaylistFromLocal(pl.id);
                            loadYoutubePlaylists();
                          }}
                          className="px-[2px] py-[1px] text-gray-500 hover:text-red-400 text-[8px]"
                          title="Eliminar de guardadas locales"
                        >
                          ×
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLoadPlaylist(pl.id, true);
                        }}
                        className="px-[4px] py-[1px] bg-green-950/60 hover:bg-green-900 border border-green-800 text-green-400 rounded-[1px] text-[7px] font-bold"
                        title="Reemplazar playlist actual y reproducir"
                      >
                        ▶ Cargar
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLoadPlaylist(pl.id, false);
                        }}
                        className="px-[4px] py-[1px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-[1px] text-[7px]"
                        title="Añadir canciones a la lista existente"
                      >
                        + Cola
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex gap-1 mt-1">
            {youtubeToken && (
              <button
                onClick={() => loadYoutubePlaylists(undefined, true)}
                disabled={isLoadingYtPlaylists}
                className="flex items-center justify-center gap-1 px-2 py-[2px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-[1px] text-[8px]"
              >
                <RefreshCw size={8} className={isLoadingYtPlaylists ? 'animate-spin' : ''} /> Actualizar
              </button>
            )}
            <button
              onClick={() => setShowPlaylistExplorer(false)}
              className="flex-1 text-center text-[8px] py-[2px] bg-red-950/60 hover:bg-red-900 text-red-400 border border-red-900 rounded-[1px]"
            >
              Cerrar Explorador
            </button>
          </div>
        </div>
      )}

      {/* 4b. OVERLAY: Connect / Login Modal */}
      {false && (
        <div className="absolute inset-x-0 bottom-[22px] top-[14px] bg-[#141416]/95 border-t border-black p-3 flex flex-col justify-between z-40 font-pixel">
          <div className="flex items-center justify-between border-b border-gray-800 pb-1 mb-2">
            <span className="text-red-400 font-bold text-[9px] flex items-center gap-1">
              <Youtube size={12} className="text-red-500" /> CONECTAR YOUTUBE MUSIC
            </span>
            <button
              onClick={() => setShowConnectModal(false)}
              className="text-gray-400 hover:text-white text-[10px] px-1"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 flex flex-col justify-center gap-2 px-1 text-center">
            <p className="text-[8px] text-gray-300 leading-normal">
              Elige cómo deseas iniciar sesión. Tu sesión quedará guardada permanentemente:
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={handleDirectLogin}
                className="w-full text-left p-2 bg-[#201818] hover:bg-[#2e1d1d] border border-red-800/80 hover:border-red-600 rounded-[2px] cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-1.5 text-red-300 font-bold text-[8px] group-hover:text-red-200">
                  <span>⚡</span> En Winamp (Permanente - Recomendado)
                </div>
                <p className="text-[7px] text-gray-400 mt-0.5 leading-tight font-sans">
                  Abre la ventana oficial de Google dentro de la app. Guarda la sesión en disco para no tener que volver a iniciarla nunca.
                </p>
              </button>

              <button
                onClick={handleBrowserLogin}
                className="w-full text-left p-2 bg-[#181a20] hover:bg-[#1d222e] border border-sky-800/80 hover:border-sky-600 rounded-[2px] cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-1.5 text-sky-300 font-bold text-[8px] group-hover:text-sky-200">
                  <span>🌐</span> Mediante Navegador Web (Chrome / Edge)
                </div>
                <p className="text-[7px] text-gray-400 mt-0.5 leading-tight font-sans">
                  Usa tu navegador habitual con OAuth. Requiere configurar Google Client ID en el engranaje ⚙.
                </p>
              </button>
            </div>
          </div>

          <div className="mt-2 pt-1 border-t border-gray-900 flex justify-end">
            <button
              onClick={() => setShowConnectModal(false)}
              className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-gray-300 border border-zinc-700 rounded-[1px] text-[8px]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* 5. OVERLAY: Search individual videos */}
      {showSearchPanel && (
        <div className="absolute inset-x-0 bottom-[22px] top-[14px] bg-[#1a1a1c] border-t border-black p-[5px] flex flex-col justify-between z-30 font-pixel">
          <form onSubmit={handleSearch} className="flex gap-1 p-1">
            <input 
              type="text"
              placeholder="Buscar canción en YouTube..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-black text-white border border-gray-700 text-[8px] px-[4px] py-[2px] focus:outline-none rounded-[1px] font-sans"
              autoFocus
            />
            <button 
              type="submit"
              className="px-[6px] py-[1px] bg-[#3a3b40] hover:bg-[#5a5c64] border border-[#555] rounded-[1px]"
            >
              <Search size={10} className="text-white" />
            </button>
          </form>

          {/* Results Scroller */}
          <div className="flex-1 overflow-y-auto bg-black border border-[#222] my-[3px] p-[2px] text-[8px] winamp-scrollbar">
            {isSearching ? (
              <div className="flex items-center justify-center h-full gap-1 text-gray-500 font-pixel">
                <Loader2 size={10} className="animate-spin text-green-500" /> Buscando canciones...
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center text-gray-500 py-3 font-pixel">Escriba y presione Enter para buscar</div>
            ) : (
              searchResults.map((t) => (
                <div 
                  key={t.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddTrack(t, true);
                    setShowSearchPanel(false);
                    setSearchResults([]);
                  }}
                  className="flex items-center justify-between p-[2px] border-b border-gray-900 hover:bg-[#222]/60 cursor-pointer text-white group"
                >
                  <span className="truncate flex-1 font-sans pr-1 text-[8px]">{t.artist} - {t.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddTrack(t, false);
                      setAddedIds((prev) => [...prev, t.id]);
                      setTimeout(() => {
                        setAddedIds((prev) => prev.filter((id) => id !== t.id));
                      }, 1500);
                    }}
                    className={`text-[8px] select-none font-bold shrink-0 bg-transparent border-0 cursor-pointer px-1 ${addedIds.includes(t.id) ? 'text-[#00e100]' : 'text-green-500 hover:text-green-300'}`}
                    title="Añadir a la lista sin interrumpir reproducción"
                  >
                    {addedIds.includes(t.id) ? '✔ Añadido' : '+ Añadir'}
                  </button>
                </div>
              ))
            )}
          </div>

          <button 
            id="close-search-panel"
            onClick={() => { setShowSearchPanel(false); setSearchResults([]); }}
            className="w-full text-center text-[8px] py-[1px] bg-red-950/60 hover:bg-red-900 text-red-400 border border-red-900 rounded-[1px] font-pixel"
          >
            Cerrar Buscador
          </button>
        </div>
      )}

      {/* 6. OVERLAY: Add URL (Playlist or Single Video / MP3) */}
      {showUrlPanel && (
        <div className="absolute inset-x-0 bottom-[22px] top-[14px] bg-[#1a1a1c] border-t border-black p-[5px] flex flex-col justify-between z-30 font-pixel">
          <form onSubmit={handleAddUrl} className="flex flex-col gap-1 p-1">
            <span className="text-[8px] text-gray-400 leading-tight">
              Pegar Enlace (Playlist de YouTube Music, Video o MP3):
            </span>
            <input 
              id="playlist-url-input"
              type="text"
              placeholder="https://music.youtube.com/playlist?list=..."
              value={pastedUrl}
              onChange={(e) => setPastedUrl(e.target.value)}
              disabled={isLoadingUrlPlaylist}
              className="bg-black text-[#00e100] border border-gray-700 text-[8px] px-[4px] py-[2px] focus:outline-none rounded-[1px] font-sans"
              autoFocus
            />
            <p className="text-[7px] text-gray-500 leading-tight">
              * Soporta enlaces de playlists completas de YouTube Music con <span className="text-gray-300 font-mono">list=PL...</span>
            </p>
            <button 
              id="playlist-url-submit-btn"
              type="submit"
              disabled={isLoadingUrlPlaylist}
              className="py-[3px] bg-green-950/60 hover:bg-green-900 border border-green-800 text-[#00e100] rounded-[1px] text-[8px] font-bold flex items-center justify-center gap-1 cursor-pointer"
            >
              {isLoadingUrlPlaylist ? (
                <>
                  <Loader2 size={10} className="animate-spin" /> Importando canciones de la lista...
                </>
              ) : (
                'Importar a Winamp'
              )}
            </button>
          </form>

          <button 
            id="close-url-panel"
            onClick={() => setShowUrlPanel(false)}
            disabled={isLoadingUrlPlaylist}
            className="w-full text-center text-[8px] py-[1px] bg-red-950/60 hover:bg-red-900 text-red-400 border border-red-900 rounded-[1px]"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* 7. OVERLAY: Config (Google Client ID & Redirect URI) */}
      {showConfig && (
        <div className="absolute inset-x-0 bottom-[22px] top-[14px] bg-[#1a1a1c] border-t border-black p-[5px] flex flex-col justify-between z-30 font-pixel">
          <div className="flex-1 flex flex-col gap-1 overflow-y-auto winamp-scrollbar pr-1">
            <div className="flex items-center justify-between">
              <span className="text-[8px] text-red-500 font-bold">CONFIGURACIÓN YOUTUBE MUSIC</span>
              <span className={`text-[7px] px-1 rounded-[1px] ${youtubeToken ? 'bg-green-950 text-green-400' : 'bg-zinc-800 text-gray-400'}`}>
                {youtubeToken ? '🟢 Conectado' : '⚪ Desconectado'}
              </span>
            </div>

            <div className="my-1">
              {youtubeToken ? (
                <button
                  onClick={handleYoutubeDisconnect}
                  className="w-full py-[3px] bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-300 text-[8px] rounded-[1px] font-bold cursor-pointer"
                >
                  Cerrar Sesión Activa
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowConfig(false);
                    handleBrowserLogin();
                  }}
                  className="w-full py-[3px] bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-300 text-[8px] rounded-[1px] font-bold cursor-pointer"
                >
                  🌐 Iniciar Sesión en Navegador
                </button>
              )}
            </div>

            <div className="bg-black/50 p-1.5 border border-gray-800 rounded-[1px] mt-1 flex flex-col gap-1">
              <span className="text-[7px] text-[#00e100] font-bold">Pegar Token o Enlace de Retorno:</span>
              <div className="flex gap-1">
                <input
                  type="text"
                  placeholder="Pegar URL de callback o token ya29..."
                  value={directTokenInput}
                  onChange={(e) => setDirectTokenInput(e.target.value)}
                  className="flex-1 bg-black text-[#00e100] border border-gray-700 text-[8px] px-1 py-[2px] focus:outline-none rounded-[1px] font-mono text-[7px]"
                />
                <button
                  onClick={handleSaveDirectToken}
                  className="px-2 py-[2px] bg-green-950 hover:bg-green-900 border border-green-700 text-green-300 rounded-[1px] text-[7px] font-bold cursor-pointer shrink-0"
                >
                  Guardar
                </button>
              </div>
            </div>

            <span className="text-[8px] text-gray-300 font-bold mt-1">Google Client ID:</span>
            <input 
              type="text"
              placeholder="72834...apps.googleusercontent.com"
              value={customGoogleClientId}
              onChange={(e) => setCustomGoogleClientId(e.target.value)}
              className="bg-black text-red-400 border border-gray-700 text-[8px] px-[4px] py-[2px] w-full focus:outline-none rounded-[1px] font-sans"
            />
            
            <div className="flex items-center justify-between mt-1">
              <span className="text-[7px] text-gray-400">
                URI de redireccionamiento autorizada:
              </span>
              <button
                onClick={handleCopyRedirectUri}
                className="text-[7px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
              >
                {copiedUri ? <Check size={8} className="text-green-400" /> : <Copy size={8} />}
                {copiedUri ? '¡Copiado!' : 'Copiar URI'}
              </button>
            </div>
            <div className="bg-black text-gray-300 p-[2px] border border-gray-800 text-[6px] font-mono select-all truncate">
              http://localhost:3000/auth/youtube/callback
            </div>

            <button
              onClick={() => openOAuthInSystemBrowser('https://console.cloud.google.com/apis/credentials')}
              className="mt-1 w-full text-[7px] bg-sky-950/70 hover:bg-sky-900 border border-sky-800 text-sky-300 py-[2px] rounded-[1px] flex items-center justify-center gap-1 cursor-pointer font-bold"
            >
              <ExternalLink size={8} /> Abrir Google Cloud Console en el Navegador
            </button>
            
            <div className="text-[6px] text-gray-400 leading-snug bg-black/40 p-1 border border-gray-900 rounded-[1px] mt-1 flex flex-col gap-[2px]">
              <span className="text-gray-300 font-bold">Pasos simples (solo se hace una vez):</span>
              <span>1. Abre Google Cloud Console con el botón de arriba.</span>
              <span>2. Clic en <b>+ Crear credenciales</b> → <b>ID de cliente de OAuth</b> (Tipo: <b>App web</b>).</span>
              <span>3. En <i>URI de redireccionamiento autorizados</i>, pega la URI de arriba.</span>
              <span>4. Copia tu <b>ID de cliente</b> y pégalo arriba. ¡Listo!</span>
            </div>
          </div>
          
          <div className="flex gap-[3px] mt-2">
            <button 
              onClick={() => {
                setGoogleClientId(customGoogleClientId);
                setShowConfig(false);
                alert("Google Client ID guardado correctamente.");
              }}
              className="flex-1 text-center text-[8px] py-[2px] bg-green-950/60 hover:bg-green-900 text-green-400 border border-green-800 rounded-[1px] font-bold cursor-pointer"
            >
              Guardar
            </button>
            <button 
              onClick={() => {
                setCustomGoogleClientId('');
                setGoogleClientId('');
                setShowConfig(false);
                alert("Restablecido a los valores por defecto.");
              }}
              className="text-center text-[8px] py-[2px] px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-600 rounded-[1px] cursor-pointer"
            >
              Reset
            </button>
            <button 
              onClick={() => setShowConfig(false)}
              className="text-center text-[8px] py-[2px] px-2 bg-red-950/60 hover:bg-red-900 text-red-400 border border-red-900 rounded-[1px] cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* 8. Classic Winamp Bottom Navigation Bar */}
      <div className="h-[24px] flex justify-between items-center text-[7px] border-t border-[#181824] pt-[2px] mt-[1px] relative select-none">
        {/* Backdrop for closing popups when clicking anywhere outside */}
        {(showAddMenu || showRemMenu) && (
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => { setShowAddMenu(false); setShowRemMenu(false); }} 
          />
        )}

        {/* Left: Classic 4 Silver Buttons */}
        <div className="flex items-center gap-[2px] relative z-50">
          {/* ADD Button */}
          <div className="relative">
            <button 
              id="pl-add-btn"
              onClick={() => {
                setShowAddMenu(!showAddMenu);
                setShowRemMenu(false);
              }}
              className="h-[15px] px-[5px] winamp-btn-silver font-pixel text-[7px] font-bold flex items-center gap-[1px]"
            >
              ADD
            </button>
            {showAddMenu && (
              <div className="absolute bottom-[17px] left-0 w-[125px] bg-[#20212e] border-2 border-[#666680] shadow-2xl z-50 text-[8px] font-pixel text-white flex flex-col py-1">
                <button 
                  onClick={() => { setShowSearchPanel(true); setShowUrlPanel(false); setShowPlaylistExplorer(false); setShowAddMenu(false); }}
                  className="px-2 py-1 text-left hover:bg-[#00e100]/20 hover:text-[#00e100] flex items-center gap-1"
                >
                  <Search size={9} /> Buscar canción
                </button>
                <button 
                  onClick={() => { setShowUrlPanel(true); setShowSearchPanel(false); setShowPlaylistExplorer(false); setShowAddMenu(false); }}
                  className="px-2 py-1 text-left hover:bg-[#00e100]/20 hover:text-[#00e100] flex items-center gap-1"
                >
                  <ExternalLink size={9} /> Pegar URL / Lista
                </button>
                <button 
                  onClick={() => { setShowPlaylistExplorer(true); setShowSearchPanel(false); setShowUrlPanel(false); setShowAddMenu(false); }}
                  className="px-2 py-1 text-left hover:bg-[#00e100]/20 hover:text-[#00e100] flex items-center gap-1"
                >
                  <Library size={9} /> Mis Playlists YTM
                </button>
              </div>
            )}
          </div>

          {/* REM Button */}
          <div className="relative">
            <button 
              id="pl-rem-btn"
              onClick={() => {
                setShowRemMenu(!showRemMenu);
                setShowAddMenu(false);
              }}
              className="h-[15px] px-[5px] winamp-btn-silver font-pixel text-[7px] font-bold flex items-center gap-[1px]"
            >
              REM
            </button>
            {showRemMenu && (
              <div className="absolute bottom-[17px] left-0 w-[130px] bg-[#20212e] border-2 border-[#666680] shadow-2xl z-50 text-[8px] font-pixel text-white flex flex-col py-1">
                <button 
                  onClick={() => {
                    const idxToRemove = selectedTrackIndex !== undefined ? selectedTrackIndex : currentTrackIndex;
                    if (idxToRemove >= 0) onRemoveTrack(idxToRemove);
                    setShowRemMenu(false);
                  }}
                  className="px-2 py-1 text-left hover:bg-red-500/20 hover:text-red-400 flex items-center gap-1"
                >
                  <Trash2 size={9} /> Quitar seleccionada
                </button>
                <button 
                  onClick={() => {
                    onClearPlaylist();
                    setShowRemMenu(false);
                  }}
                  className="px-2 py-1 text-left hover:bg-red-500/20 hover:text-red-400 flex items-center gap-1"
                >
                  <Trash2 size={9} /> Limpiar todo
                </button>
              </div>
            )}
          </div>

          {/* SEL Button */}
          <button 
            id="pl-sel-btn"
            onClick={() => {
              setShowAddMenu(false);
              setShowRemMenu(false);
              const targetIdx = selectedTrackIndex !== undefined ? selectedTrackIndex : currentTrackIndex;
              if (targetIdx >= 0 && targetIdx < tracks.length) {
                if (onPlayTrack) onPlayTrack(targetIdx);
                else onSelectTrack(targetIdx);
              }
            }}
            className="h-[15px] px-[5px] winamp-btn-silver font-pixel text-[7px] font-bold"
          >
            SEL
          </button>

          {/* MISC Button */}
          <button 
            id="pl-misc-btn"
            onClick={() => {
              setShowAddMenu(false);
              setShowRemMenu(false);
              setShowConfig(!showConfig);
            }}
            className="h-[15px] px-[5px] winamp-btn-silver font-pixel text-[7px] font-bold"
          >
            MISC
          </button>
        </div>

        {/* Center: Black LCD Time Screen */}
        <div className="bg-[#000000] border border-[#222234] px-[5px] py-[1px] rounded-[1px] flex flex-col items-center justify-center min-w-[82px] shadow-inner">
          <div className="text-[#00ff00] font-mono text-[9px] font-bold leading-none tracking-tight">
            {formatDuration(currentTrackDuration)}/{formatDuration(totalDuration)}
          </div>
          <div className="text-[#00aa00] text-[6px] tracking-tight font-mono leading-none flex items-center justify-between w-full mt-[1px]">
            <span className="tracking-widest">|&lt;&lt; ▶ || ■ &gt;&gt;| ^</span>
            <span className="text-[#00ff00] font-bold ml-1">{formatDuration(currentTime)}</span>
          </div>
        </div>

        {/* Right: LIST OPTS Button */}
        <button 
          id="pl-opts-btn"
          onClick={onSortPlaylist}
          title="Ordenar alfabéticamente (A-Z)"
          className="h-[15px] px-[4px] winamp-btn-silver font-pixel text-[6px] font-bold leading-tight text-center"
        >
          LIST<br />OPTS
        </button>
      </div>
    </div>
  );
}
