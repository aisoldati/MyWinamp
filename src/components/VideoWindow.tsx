import React, { useEffect, useRef } from 'react';
import { Tv, MonitorPlay } from 'lucide-react';
import { Track, PlaybackState, WinampSkin } from '../types';

interface VideoWindowProps {
  currentTrack: Track | null;
  playbackState: PlaybackState;
  skin: WinampSkin;
  volume: number;
  onClose: () => void;
}

export default function VideoWindow({
  currentTrack,
  playbackState,
  skin,
  volume,
  onClose,
}: VideoWindowProps) {
  const visualizerRef = useRef<HTMLDivElement | null>(null);

  // Sync animation speeds or scales based on volume/state
  const isPlaying = playbackState === 'playing';
  const isYouTube = currentTrack?.source === 'youtube';

  const getSkinTheme = () => {
    switch (skin) {
      case 'slate':
        return {
          bg: 'bg-slate-900 border-slate-700 text-slate-100',
        };
      case 'llama':
        return {
          bg: 'bg-amber-950 border-amber-700 text-amber-100',
        };
      case 'classic':
      default:
        return {
          bg: 'winamp-metal text-[#b4b5b8] font-mono',
        };
    }
  };

  const theme = getSkinTheme();

  return (
    <div 
      id="winamp-video"
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.cursor-move')) {
          e.stopPropagation();
        }
      }}
      className={`w-full h-full p-[4px] box-border select-none rounded-[3px] flex flex-col justify-between shadow-2xl relative ${theme.bg} winamp-border-outset overflow-hidden`}
    >
      {/* 1. Window Header */}
      <div className="h-[14px] flex items-center justify-between cursor-move bg-gradient-to-r from-[#111] via-[#2a2b30] to-[#111] border-b border-[#000] px-[4px] relative">
        <div className="absolute inset-y-1 left-2 right-12 flex flex-col justify-between pointer-events-none opacity-40">
          <div className="h-[1px] bg-[#666]"></div>
          <div className="h-[1px] bg-[#666]"></div>
          <div className="h-[1px] bg-[#333]"></div>
        </div>
        <span className="text-[9px] font-pixel text-slate-300 font-bold tracking-widest z-10 pointer-events-none uppercase flex items-center gap-1">
          <Tv size={8} /> Winamp Video
        </span>
        <button 
          id="close-video-btn"
          onClick={onClose}
          className="w-[9px] h-[9px] bg-[#900] border border-[#555] hover:border-red-400 cursor-pointer flex items-center justify-center rounded-[1px] text-[6px] text-white font-bold z-10"
        >
          X
        </button>
      </div>

      {/* 2. Video Monitor Screen (Clipped CRT display) */}
      <div className="flex-1 bg-black rounded-[2px] border-2 border-black overflow-hidden relative flex flex-col justify-center items-center scanlines winamp-border-inset mt-[3px]">
        {/* YT Player Embed Mount Point (hidden when not YouTube, but present) */}
        <div 
          id="yt-player-mount"
          className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${isYouTube && isPlaying ? 'opacity-100 z-10' : 'opacity-0 -z-10'}`}
        />

        {/* CRT/Analog Static Fallback when Stopped/No Signal */}
        {!isPlaying && (
          <div className="absolute inset-0 bg-[#07070a] flex flex-col justify-center items-center font-pixel z-0 select-none">
            {/* Animated CRT static overlay */}
            <div 
              className="absolute inset-0 opacity-[0.12] pointer-events-none"
              style={{
                backgroundImage: 'radial-gradient(circle, #fff 10%, transparent 11%)',
                backgroundSize: '3px 3px',
                animation: 'pulse 0.05s infinite alternate'
              }}
            />
            <Tv className="text-red-600 animate-bounce mb-1 opacity-80" size={20} />
            <div className="text-[8px] text-red-500 tracking-wider animate-pulse font-bold">NO SIGNAL</div>
            <div className="text-[7px] text-gray-600 mt-2">WINAMP v2.83</div>
          </div>
        )}

        {/* Retro Music Visualizer Simulation (MilkDrop style) for CORS audio and Spotify */}
        {isPlaying && !isYouTube && (
          <div 
            ref={visualizerRef}
            className="absolute inset-0 flex flex-col justify-center items-center overflow-hidden bg-gradient-to-tr from-purple-950 via-black to-slate-950"
          >
            {/* Pulsing psychedelic concentric glowing circles */}
            <div 
              className="absolute rounded-full border border-purple-500/40 animate-ping"
              style={{
                width: `${40 + volume * 100}px`,
                height: `${40 + volume * 100}px`,
                animationDuration: '1.2s'
              }}
            />
            <div 
              className="absolute rounded-full border border-sky-500/30 animate-pulse"
              style={{
                width: `${80 + volume * 120}px`,
                height: `${80 + volume * 120}px`,
                animationDuration: '0.8s'
              }}
            />
            <div 
              className="absolute rounded-full border border-emerald-500/20"
              style={{
                width: `${120 + volume * 150}px`,
                height: `${120 + volume * 150}px`,
                transform: 'rotate(45deg)',
              }}
            />

            {/* Glowing spinning media disk */}
            <div className="relative z-10 flex flex-col items-center">
              <MonitorPlay className="text-[#00e100] animate-spin mb-1 opacity-90" size={24} style={{ animationDuration: '3s' }} />
              <div className="text-[7px] text-[#00e100] font-pixel text-center tracking-widest scale-90 uppercase mt-1 leading-none">
                {currentTrack?.artist || 'Winamp'}
              </div>
              <div className="text-[6px] text-gray-500 font-pixel text-center scale-75 mt-1 leading-none">
                * MILKDROP ACTIVE *
              </div>
            </div>
          </div>
        )}

        {/* Pause Screen Overlay */}
        {playbackState === 'paused' && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center font-pixel z-20">
            <div className="text-[9px] text-amber-400 tracking-widest animate-pulse font-bold uppercase">PAUSADO</div>
          </div>
        )}
      </div>

      {/* 3. Footer Bar / Video Controls Description */}
      <div className="h-[12px] flex justify-between items-center text-[7px] font-pixel text-gray-500 select-none px-[2px] mt-[1px]">
        <span>TV MONITOR</span>
        <span className="scale-90 font-mono tracking-tighter">
          {isPlaying ? (isYouTube ? 'STREAM: YT_H264' : 'STREAM: MP3_CORS') : 'IDLE'}
        </span>
      </div>
    </div>
  );
}
