import React, { useState, useEffect, useRef } from 'react';
import { Track, Playlist, WindowConfig, PlaybackState, WinampSkin } from './types';
import MainPlayer from './components/MainPlayer';
import Equalizer from './components/Equalizer';
import PlaylistEditor from './components/PlaylistEditor';
import VideoWindow from './components/VideoWindow';
import { audioManager } from './utils/audio';

// Default pre-loaded tracks for classic experience
const DEFAULT_TRACKS: Track[] = [
  {
    id: 'local-llama-intro',
    title: 'Winamp Intro (Llama Whip)',
    artist: 'DJ Mike Llama',
    duration: 5,
    url: 'https://archive.org/download/winamplhamasound/winamp-llama.mp3',
    source: 'local',
  },
  {
    id: 'local-synth-1',
    title: 'Retro Synthwave (Helix 1)',
    artist: 'SoundHelix',
    duration: 372,
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    source: 'local',
  },
  {
    id: 'local-synth-2',
    title: 'Electro Chill (Helix 2)',
    artist: 'SoundHelix',
    duration: 425,
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    source: 'local',
  },
  {
    id: 'local-synth-4',
    title: 'Cyber Lounge (Helix 4)',
    artist: 'SoundHelix',
    duration: 302,
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    source: 'local',
  },
];

export default function App() {
  // 1. Window Configuration State
  const [windows, setWindows] = useState<WindowConfig[]>([
    { id: 'main', title: 'Main Window', x: 0, y: 0, isOpen: true, isShaded: false, width: 275, height: 116 },
    { id: 'equalizer', title: 'Equalizer', x: 0, y: 116, isOpen: true, isShaded: false, width: 275, height: 116 },
    { id: 'playlist', title: 'Playlist Editor', x: 0, y: 232, isOpen: true, isShaded: false, width: 275, height: 232 },
    { id: 'video', title: 'Video Window', x: 275, y: 0, isOpen: false, isShaded: false, width: 275, height: 232 },
  ]);

  const [doubleSize, setDoubleSize] = useState<boolean>(false);

  const [activeWindowId, setActiveWindowId] = useState<string>('main');

  // 2. Dragging & Resizing Physics State
  const dragInfoRef = useRef<{
    windowId: string;
    startX: number;
    startY: number;
    startWinX: number;
    startWinY: number;
  } | null>(null);

  const resizeInfoRef = useRef<{
    windowId: string;
    direction: 'se' | 'e' | 's';
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  // 3. Audio & Playback State
  const [playlist, setPlaylist] = useState<Track[]>(DEFAULT_TRACKS);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [volume, setVolume] = useState<number>(0.75);
  const [pan, setPan] = useState<number>(0); // balance
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(5);
  const [shuffle, setShuffle] = useState<boolean>(false);
  const [repeat, setRepeat] = useState<boolean>(false);
  const [skin, setSkin] = useState<WinampSkin>('classic');

  // 4. YouTube Player API Refs & State
  const ytPlayerRef = useRef<any>(null);
  const [ytReady, setYtReady] = useState(false);
  const [ytActive, setYtActive] = useState(false);

  const currentTrack = playlist[currentTrackIndex] || null;

  // Sync Duration when track index changes
  useEffect(() => {
    if (currentTrack) {
      setDuration(currentTrack.duration);
      setCurrentTime(0);
    }
  }, [currentTrackIndex, playlist]);

  // Keyboard shortcut: Ctrl+D toggles Double Size (2x) mode (classic Winamp feature)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setDoubleSize((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load YouTube Iframe API
  useEffect(() => {
    const checkYT = () => {
      if ((window as any).YT && (window as any).YT.Player) {
        setYtReady(true);
        return true;
      }
      return false;
    };

    if (!checkYT()) {
      (window as any).onYouTubeIframeAPIReady = () => {
        setYtReady(true);
        console.log('YouTube Iframe Player API is Ready');
      };

      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      }

      const poll = setInterval(() => {
        if (checkYT()) clearInterval(poll);
      }, 300);

      return () => {
        clearInterval(poll);
        delete (window as any).onYouTubeIframeAPIReady;
      };
    }
  }, []);

  // Initialize YouTube player in persistent node
  useEffect(() => {
    if (ytReady && !ytPlayerRef.current) {
      try {
        ytPlayerRef.current = new (window as any).YT.Player('yt-player-iframe', {
          height: '100%',
          width: '100%',
          videoId: '',
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            showinfo: 0,
            iv_load_policy: 3,
          },
          events: {
            onStateChange: (event: any) => {
              // Sync playback states automatically
              // YT.PlayerState.PLAYING = 1, PAUSED = 2, ENDED = 0, BUFFERING = 3
              const state = event.data;
              if (state === 1) {
                setPlaybackState('playing');
              } else if (state === 2) {
                setPlaybackState('paused');
              } else if (state === 0) {
                handleTrackEnded();
              }
            },
            onReady: (event: any) => {
              event.target.setVolume(volume * 100);
            },
            onError: (event: any) => {
              console.warn('YouTube Player error code:', event.data);
              setTimeout(() => {
                handleNextTrack();
              }, 1000);
            },
          },
        });
      } catch (err) {
        console.error('Failed to create YouTube player:', err);
      }
    }
  }, [ytReady]);

  // Track finished callback helper
  const handleTrackEnded = () => {
    if (repeat) {
      seekTo(0);
      playTrack();
    } else {
      handleNextTrack();
    }
  };

  // HTML5 audio event listeners
  useEffect(() => {
    const audio = audioManager.getAudioElement();

    const onTimeUpdate = () => {
      if (!ytActive) {
        const nextSec = Math.floor(audio.currentTime);
        setCurrentTime((prev) => (Math.floor(prev) === nextSec ? prev : nextSec));
      }
    };

    const onLoadedMetadata = () => {
      if (!ytActive) {
        setDuration(audio.duration || currentTrack?.duration || 240);
      }
    };

    const onEnded = () => {
      if (!ytActive) {
        handleTrackEnded();
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [ytActive, currentTrackIndex, repeat, playlist]);

  // Sync HTML5 volume
  useEffect(() => {
    audioManager.getAudioElement().volume = volume;
    if (ytPlayerRef.current && ytPlayerRef.current.setVolume) {
      ytPlayerRef.current.setVolume(volume * 100);
    }
  }, [volume]);

  // YouTube Polling loop for playback progress
  useEffect(() => {
    let timer: number;
    if (ytActive && playbackState === 'playing' && ytPlayerRef.current) {
      timer = window.setInterval(() => {
        try {
          if (ytPlayerRef.current.getCurrentTime) {
            const time = ytPlayerRef.current.getCurrentTime();
            const nextSec = Math.floor(time || 0);
            setCurrentTime((prev) => (Math.floor(prev) === nextSec ? prev : nextSec));
            
            const dur = ytPlayerRef.current.getDuration();
            if (dur && dur > 0 && Math.abs(duration - dur) > 5) {
              setDuration(dur);
            }
          }
        } catch (e) {
          // ignore transient player errors
        }
      }, 500);
    }

    return () => clearInterval(timer);
  }, [ytActive, playbackState, duration]);
  // Playback control routing
  const playTrackAtIndex = (index: number, startAtZero = false) => {
    if (index < 0 || index >= playlist.length) return;
    const targetTrack = playlist[index];
    if (!targetTrack) return;

    audioManager.resumeContext();
    setCurrentTrackIndex(index);
    if (startAtZero) {
      setCurrentTime(0);
    }

    if (targetTrack.source === 'youtube') {
      setYtActive(true);
      // Pause local audio
      audioManager.getAudioElement().pause();

      const startSec = startAtZero ? 0 : (currentTime > 0 ? currentTime : 0);

      const triggerYTPlay = () => {
        if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
          try {
            ytPlayerRef.current.loadVideoById({
              videoId: targetTrack.url,
              startSeconds: startSec,
            });
            ytPlayerRef.current.playVideo?.();
          } catch (e) {
            console.warn('Error playing video in YouTube iframe:', e);
          }
          setPlaybackState('playing');
          return true;
        }
        return false;
      };

      if (!triggerYTPlay()) {
        setPlaybackState('playing');
        let retries = 0;
        const retryTimer = setInterval(() => {
          retries++;
          if (triggerYTPlay() || retries > 20) {
            clearInterval(retryTimer);
          }
        }, 200);
      }
    } else {
      // Local MP3 track
      setYtActive(false);
      // Pause YT
      if (ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
        ytPlayerRef.current.pauseVideo();
      }

      const audio = audioManager.getAudioElement();
      if (audio.src !== targetTrack.url) {
        audio.src = targetTrack.url;
        audio.load();
      }
      if (startAtZero) {
        audio.currentTime = 0;
      }

      audio.play()
        .then(() => {
          setPlaybackState('playing');
        })
        .catch((err) => {
          console.error('HTML5 audio play error:', err);
          alert('No se pudo reproducir esta canción. Verifique el formato de su archivo.');
          setPlaybackState('stopped');
        });
    }
  };

  const playTrack = () => {
    playTrackAtIndex(currentTrackIndex, false);
  };

  const pauseTrack = () => {
    setPlaybackState('paused');
    if (ytActive) {
      if (ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
        ytPlayerRef.current.pauseVideo();
      }
    } else {
      audioManager.getAudioElement().pause();
    }
  };

  const stopTrack = () => {
    setPlaybackState('stopped');
    setCurrentTime(0);
    if (ytActive) {
      if (ytPlayerRef.current && ytPlayerRef.current.stopVideo) {
        ytPlayerRef.current.stopVideo();
      }
    } else {
      const audio = audioManager.getAudioElement();
      audio.pause();
      audio.currentTime = 0;
    }
  };

  const seekTo = (time: number) => {
    setCurrentTime(time);
    if (ytActive) {
      if (ytPlayerRef.current && ytPlayerRef.current.seekTo) {
        ytPlayerRef.current.seekTo(time, true);
      }
    } else {
      audioManager.getAudioElement().currentTime = time;
    }
  };

  const handleNextTrack = () => {
    if (playlist.length === 0) return;
    const nextIdx = shuffle
      ? Math.floor(Math.random() * playlist.length)
      : (currentTrackIndex + 1) % playlist.length;
    playTrackAtIndex(nextIdx, true);
  };

  const handlePrevTrack = () => {
    if (playlist.length === 0) return;
    const prevIdx = currentTrackIndex === 0 ? playlist.length - 1 : currentTrackIndex - 1;
    playTrackAtIndex(prevIdx, true);
  };

  const handleSelectTrack = (index: number) => {
    setSelectedTrackIndex(index);
  };

  const handlePlayTrack = (index: number) => {
    setSelectedTrackIndex(index);
    playTrackAtIndex(index, true);
  };

  // Playlist track actions
  const handleAddTrack = (track: Track, andPlay = false) => {
    setPlaylist((prev) => {
      const isDuplicate = prev.length > 0 && prev[prev.length - 1].id === track.id;
      const updated = isDuplicate ? prev : [...prev, track];
      if (andPlay) {
        const newIndex = updated.length - 1;
        setTimeout(() => {
          handlePlayTrack(newIndex);
        }, 50);
      }
      return updated;
    });
  };

  const handleAddTracks = (newTracks: Track[], replace = false, autoPlay = false) => {
    if (!newTracks || newTracks.length === 0) return;
    if (replace) {
      setPlaylist(newTracks);
      setCurrentTrackIndex(0);
      setSelectedTrackIndex(0);
      if (autoPlay) {
        const firstTrack = newTracks[0];
        if (firstTrack.source === 'youtube') {
          setYtActive(true);
          audioManager.getAudioElement().pause();
          setCurrentTime(0);
          setPlaybackState('playing');
          const tryPlay = () => {
            if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
              ytPlayerRef.current.loadVideoById({ videoId: firstTrack.url, startSeconds: 0 });
              ytPlayerRef.current.playVideo?.();
              return true;
            }
            return false;
          };
          if (!tryPlay()) {
            let retries = 0;
            const t = setInterval(() => {
              if (tryPlay() || ++retries > 20) clearInterval(t);
            }, 200);
          }
        }
      }
    } else {
      setPlaylist((prev) => [...prev, ...newTracks]);
    }
  };

  const handleRemoveTrack = (index: number) => {
    const updated = playlist.filter((_, idx) => idx !== index);
    setPlaylist(updated);
    
    // Adjust active index
    if (currentTrackIndex >= updated.length) {
      setCurrentTrackIndex(Math.max(0, updated.length - 1));
    }
    if (selectedTrackIndex >= updated.length) {
      setSelectedTrackIndex(Math.max(0, updated.length - 1));
    }
  };

  const handleClearPlaylist = () => {
    stopTrack();
    setPlaylist([]);
    setCurrentTrackIndex(0);
  };

  const handleSortPlaylist = () => {
    const sorted = [...playlist].sort((a, b) => a.title.localeCompare(b.title));
    setPlaylist(sorted);
    setCurrentTrackIndex(0);
  };

  const handleReorderPlaylist = (from: number, to: number) => {
    if (from < 0 || from >= playlist.length || to < 0 || to >= playlist.length) return;
    const updated = [...playlist];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    setPlaylist(updated);

    // Sync current active track index
    if (currentTrackIndex === from) {
      setCurrentTrackIndex(to);
    } else if (currentTrackIndex === to) {
      setCurrentTrackIndex(from);
    }
  };

  // Window actions
  const toggleWindow = (id: string) => {
    setWindows(windows.map(w => w.id === id ? { ...w, isOpen: !w.isOpen } : w));
  };

  const toggleShade = (id: string) => {
    setWindows(windows.map(w => w.id === id ? { ...w, isShaded: !w.isShaded } : w));
  };

  // 5. Draggable & Resizing Core Physics
  const handlePointerDown = (id: string, e: React.PointerEvent) => {
    setActiveWindowId(id);
    const win = windows.find((w) => w.id === id);
    if (!win) return;

    // Windows should ONLY be dragged by their title/header bar (.cursor-move)!
    const target = e.target as HTMLElement;
    if (!target.closest('.cursor-move')) {
      return;
    }
    if (target.closest('button') || target.closest('select') || target.closest('input')) {
      return;
    }

    dragInfoRef.current = {
      windowId: id,
      startX: e.clientX,
      startY: e.clientY,
      startWinX: win.x,
      startWinY: win.y,
    };
    
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizeDown = (id: string, direction: 'se' | 'e' | 's', e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setActiveWindowId(id);
    const win = windows.find((w) => w.id === id);
    if (!win) return;

    resizeInfoRef.current = {
      windowId: id,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: win.width,
      startHeight: win.height,
    };

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    // A. Handle Resizing
    if (resizeInfoRef.current) {
      const { windowId, direction, startX, startY, startWidth, startHeight } = resizeInfoRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      setWindows((prev) =>
        prev.map((w) => {
          if (w.id !== windowId) return w;
          const minW = w.id === 'video' ? 200 : 275;
          const minH = w.id === 'playlist' ? 120 : w.id === 'video' ? 120 : 100;

          let newWidth = w.width;
          let newHeight = w.height;

          if (direction === 'se' || direction === 'e') {
            newWidth = Math.max(minW, startWidth + dx);
          }
          if (direction === 'se' || direction === 's') {
            newHeight = Math.max(minH, startHeight + dy);
          }

          return { ...w, width: newWidth, height: newHeight };
        })
      );
      return;
    }

    // B. Handle Dragging
    if (!dragInfoRef.current) return;
    const { windowId, startX, startY, startWinX, startWinY } = dragInfoRef.current;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let targetX = startWinX + dx;
    let targetY = startWinY + dy;

    // Apply Screen boundaries & Snapping to other windows!
    const win = windows.find((w) => w.id === windowId);
    if (!win) return;

    const SNAP_DIST = 10;
    const windowHeight = win.isShaded ? 14 : win.height;

    // A. Snap to viewport edges
    if (Math.abs(targetX) < SNAP_DIST) targetX = 0;
    if (Math.abs(targetY) < SNAP_DIST) targetY = 0;

    // B. Snap to other open windows (magnetic fields)
    windows.forEach((other) => {
      if (other.id === windowId || !other.isOpen) return;

      const otherHeight = other.isShaded ? 14 : other.height;

      // Horizontal snapping options
      // 1. Left edge aligns with Left edge
      if (Math.abs(targetX - other.x) < SNAP_DIST) {
        targetX = other.x;
      }
      // 2. Right edge aligns with Left edge
      if (Math.abs((targetX + win.width) - other.x) < SNAP_DIST) {
        targetX = other.x - win.width;
      }
      // 3. Left edge aligns with Right edge
      if (Math.abs(targetX - (other.x + other.width)) < SNAP_DIST) {
        targetX = other.x + other.width;
      }

      // Vertical snapping options
      // 1. Top edge aligns with Top edge
      if (Math.abs(targetY - other.y) < SNAP_DIST) {
        targetY = other.y;
      }
      // 2. Bottom edge aligns with Top edge
      if (Math.abs((targetY + windowHeight) - other.y) < SNAP_DIST) {
        targetY = other.y - windowHeight;
      }
      // 3. Top edge aligns with Bottom edge
      if (Math.abs(targetY - (other.y + otherHeight)) < SNAP_DIST) {
        targetY = other.y + otherHeight;
      }
    });

    setWindows(windows.map((w) => w.id === windowId ? { ...w, x: targetX, y: targetY } : w));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (resizeInfoRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      resizeInfoRef.current = null;
    }
    if (!dragInfoRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {}
    dragInfoRef.current = null;
  };

  const handleWindowDoubleClick = (id: string, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Only toggle shade when double clicking the window's title bar (.cursor-move) and not a button!
    if (target.closest('.cursor-move') && !target.closest('button')) {
      toggleShade(id);
    }
  };

  const getWindowConfig = (id: string) => windows.find((w) => w.id === id)!;

  const mainWin = getWindowConfig('main');
  const eqWin = getWindowConfig('equalizer');
  const plWin = getWindowConfig('playlist');
  const vidWin = getWindowConfig('video');

  return (
    <div className="w-full h-full min-h-screen bg-transparent relative overflow-hidden select-none flex flex-col font-sans text-gray-200">
      {/* DRAGGABLE WINDOWS CONTEXT CONTAINER */}
      <div 
        className="w-full flex-1 relative p-0 overflow-hidden"
        style={{
          transform: doubleSize ? 'scale(2)' : 'none',
          transformOrigin: 'top left',
          imageRendering: 'pixelated',
        }}
      >

        {/* 1. Main Window */}
        {mainWin.isOpen && (
          <div 
            style={{
              position: 'absolute',
              left: `${mainWin.x}px`,
              top: `${mainWin.y}px`,
              width: `${mainWin.width}px`,
              height: mainWin.isShaded ? '14px' : `${mainWin.height}px`,
              overflow: 'hidden',
              zIndex: activeWindowId === 'main' ? 40 : 30
            }}
            onPointerDown={(e) => handlePointerDown('main', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={(e) => handleWindowDoubleClick('main', e)}
            className="rounded-none select-none touch-none"
          >
            <MainPlayer 
              currentTrack={currentTrack}
              playbackState={playbackState}
              volume={volume}
              pan={pan}
              currentTime={currentTime}
              duration={duration}
              shuffle={shuffle}
              repeat={repeat}
              skin={skin}
              isEqOpen={eqWin.isOpen}
              isPlOpen={plWin.isOpen}
              isVideoOpen={vidWin.isOpen}
              isDoubleSize={doubleSize}
              onPlay={playTrack}
              onPause={pauseTrack}
              onStop={stopTrack}
              onPrev={handlePrevTrack}
              onNext={handleNextTrack}
              onSeek={seekTo}
              onVolumeChange={setVolume}
              onPanChange={setPan}
              onToggleShuffle={() => setShuffle(!shuffle)}
              onToggleRepeat={() => setRepeat(!repeat)}
              onToggleEq={() => toggleWindow('equalizer')}
              onTogglePl={() => toggleWindow('playlist')}
              onToggleVideo={() => toggleWindow('video')}
              onToggleDoubleSize={() => setDoubleSize(!doubleSize)}
              onEject={() => toggleWindow('playlist')}
              onSkinChange={setSkin}
            />
          </div>
        )}

        {/* 2. Equalizer Window */}
        {eqWin.isOpen && (
          <div 
            style={{
              position: 'absolute',
              left: `${eqWin.x}px`,
              top: `${eqWin.y}px`,
              width: `${eqWin.width}px`,
              height: eqWin.isShaded ? '14px' : `${eqWin.height}px`,
              overflow: 'hidden',
              zIndex: activeWindowId === 'equalizer' ? 40 : 30
            }}
            onPointerDown={(e) => handlePointerDown('equalizer', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={(e) => handleWindowDoubleClick('equalizer', e)}
            className="rounded-none select-none touch-none relative group"
          >
            <Equalizer 
              skin={skin} 
              onClose={() => toggleWindow('equalizer')} 
            />
          </div>
        )}

        {/* 3. Playlist Editor Window */}
        {plWin.isOpen && (
          <div 
            style={{
              position: 'absolute',
              left: `${plWin.x}px`,
              top: `${plWin.y}px`,
              width: `${plWin.width}px`,
              height: plWin.isShaded ? '14px' : `${plWin.height}px`,
              overflow: 'hidden',
              zIndex: activeWindowId === 'playlist' ? 40 : 30
            }}
            onPointerDown={(e) => handlePointerDown('playlist', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={(e) => handleWindowDoubleClick('playlist', e)}
            className="rounded-none select-none touch-none relative group"
          >
            <PlaylistEditor 
              tracks={playlist}
              currentTrackIndex={currentTrackIndex}
              selectedTrackIndex={selectedTrackIndex}
              currentTime={currentTime}
              skin={skin}
              onSelectTrack={handleSelectTrack}
              onPlayTrack={handlePlayTrack}
              onAddTrack={handleAddTrack}
              onAddTracks={handleAddTracks}
              onRemoveTrack={handleRemoveTrack}
              onClearPlaylist={handleClearPlaylist}
              onSortPlaylist={handleSortPlaylist}
              onReorderPlaylist={handleReorderPlaylist}
              onClose={() => toggleWindow('playlist')}
            />

            {/* Resize Handles */}
            {!plWin.isShaded && (
              <>
                <div 
                  onPointerDown={(e) => handleResizeDown('playlist', 'e', e)}
                  className="absolute top-0 right-0 w-[6px] h-full cursor-e-resize z-40"
                  title="Arrastrar para ajustar ancho"
                />
                <div 
                  onPointerDown={(e) => handleResizeDown('playlist', 's', e)}
                  className="absolute bottom-0 left-0 h-[6px] w-full cursor-s-resize z-40"
                  title="Arrastrar para ajustar alto"
                />
                <div 
                  onPointerDown={(e) => handleResizeDown('playlist', 'se', e)}
                  className="absolute bottom-0 right-0 w-[14px] h-[14px] cursor-se-resize z-50 flex items-end justify-end p-[1px]"
                  title="Arrastrar para ajustar tamaño"
                >
                  <div className="w-[8px] h-[8px] flex flex-col justify-between items-end pointer-events-none opacity-50 group-hover:opacity-100">
                    <div className="w-[2px] h-[2px] bg-gray-400 group-hover:bg-[#00e100]" />
                    <div className="w-[5px] h-[2px] border-r-2 border-b-2 border-gray-400 group-hover:border-[#00e100]" />
                    <div className="w-[8px] h-[2px] border-r-2 border-b-2 border-gray-400 group-hover:border-[#00e100]" />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 4. Video monitor Window */}
        {vidWin.isOpen && (
          <div 
            style={{
              position: 'absolute',
              left: `${vidWin.x}px`,
              top: `${vidWin.y}px`,
              width: `${vidWin.width}px`,
              height: vidWin.isShaded ? '14px' : `${vidWin.height}px`,
              overflow: 'hidden',
              zIndex: activeWindowId === 'video' ? 40 : 30
            }}
            onPointerDown={(e) => handlePointerDown('video', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={(e) => handleWindowDoubleClick('video', e)}
            className="transition-all duration-75 shadow-2xl rounded-[3px] select-none touch-none relative group"
          >
            <VideoWindow 
              currentTrack={currentTrack}
              playbackState={playbackState}
              skin={skin}
              volume={volume}
              onClose={() => toggleWindow('video')}
            />

            {/* Resize Handles */}
            {!vidWin.isShaded && (
              <>
                <div 
                  onPointerDown={(e) => handleResizeDown('video', 'e', e)}
                  className="absolute top-0 right-0 w-[6px] h-full cursor-e-resize z-40"
                  title="Arrastrar para ajustar ancho"
                />
                <div 
                  onPointerDown={(e) => handleResizeDown('video', 's', e)}
                  className="absolute bottom-0 left-0 h-[6px] w-full cursor-s-resize z-40"
                  title="Arrastrar para ajustar alto"
                />
                <div 
                  onPointerDown={(e) => handleResizeDown('video', 'se', e)}
                  className="absolute bottom-0 right-0 w-[14px] h-[14px] cursor-se-resize z-50 flex items-end justify-end p-[1px]"
                  title="Arrastrar para ajustar tamaño"
                >
                  <div className="w-[8px] h-[8px] flex flex-col justify-between items-end pointer-events-none opacity-50 group-hover:opacity-100">
                    <div className="w-[2px] h-[2px] bg-gray-400 group-hover:bg-[#00e100]" />
                    <div className="w-[5px] h-[2px] border-r-2 border-b-2 border-gray-400 group-hover:border-[#00e100]" />
                    <div className="w-[8px] h-[2px] border-r-2 border-b-2 border-gray-400 group-hover:border-[#00e100]" />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 5. Persistent YouTube Iframe mount point overlay */}
        {/* We dynamically position this absolute div exactly over the Video Window's monitor bezel */}
        {/* This avoids iframe unmounting/re-creating when dragging or toggling states! */}
        <div 
          id="yt-iframe-persistent-container"
          style={{
            position: 'absolute',
            left: (vidWin.isOpen && !vidWin.isShaded) ? `${vidWin.x + 7}px` : '-9999px',
            top: (vidWin.isOpen && !vidWin.isShaded) ? `${vidWin.y + 19}px` : '-9999px',
            width: `${vidWin.width - 14}px`,
            height: `${vidWin.height - 30}px`,
            zIndex: activeWindowId === 'video' ? 41 : 31,
            pointerEvents: (playbackState === 'playing' && currentTrack?.source === 'youtube' && vidWin.isOpen && !vidWin.isShaded) ? 'auto' : 'none',
            opacity: (vidWin.isOpen && !vidWin.isShaded) ? 1 : 0.01,
            backgroundColor: '#000',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
          className="shadow-inner border border-black/80 transition-all duration-75"
        >
          <div id="yt-player-iframe" className="w-full h-full" />
        </div>

      </div>
    </div>
  );
}
