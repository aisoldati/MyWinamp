import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, Square, SkipBack, SkipForward, FolderOpen, Shuffle, RotateCcw, Volume2, Activity } from 'lucide-react';
import { Track, VisualizerMode, PlaybackState, WinampSkin } from '../types';
import { audioManager } from '../utils/audio';

interface MainPlayerProps {
  currentTrack: Track | null;
  playbackState: PlaybackState;
  volume: number; // 0 to 1
  pan: number; // -1 to 1 (balance)
  currentTime: number; // in seconds
  duration: number; // in seconds
  shuffle: boolean;
  repeat: boolean;
  skin: WinampSkin;
  isEqOpen: boolean;
  isPlOpen: boolean;
  isVideoOpen: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
  onPanChange: (pan: number) => void;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onToggleEq: () => void;
  onTogglePl: () => void;
  onToggleVideo: () => void;
  onEject: () => void;
  onSkinChange: (skin: WinampSkin) => void;
}

function WinampDigit({ char }: { char: string }) {
  let offsetX = 90; // blank
  if (char >= '0' && char <= '9') {
    offsetX = parseInt(char, 10) * 9;
  } else if (char === '-') {
    offsetX = 99;
  }
  return (
    <div
      style={{
        width: 9,
        height: 13,
        backgroundImage: 'url(/skin/NUMBERS.png)',
        backgroundPosition: `-${offsetX}px 0px`,
        imageRendering: 'pixelated',
        flexShrink: 0,
      }}
    />
  );
}

export default function MainPlayer({
  currentTrack,
  playbackState,
  volume,
  pan,
  currentTime,
  duration,
  shuffle,
  repeat,
  skin,
  isEqOpen,
  isPlOpen,
  isVideoOpen,
  onPlay,
  onPause,
  onStop,
  onPrev,
  onNext,
  onSeek,
  onVolumeChange,
  onPanChange,
  onToggleShuffle,
  onToggleRepeat,
  onToggleEq,
  onTogglePl,
  onToggleVideo,
  onEject,
  onSkinChange,
}: MainPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('spectrum');
  const [showRemainingTime, setShowRemainingTime] = useState<boolean>(false);
  const [isSkinMenuOpen, setIsSkinMenuOpen] = useState(false);

  // Peak tracking for spectrum analyzer
  const peaksRef = useRef<number[]>(new Array(16).fill(0));
  const peakHoldFramesRef = useRef<number[]>(new Array(16).fill(0));

  // Toggle visualizer mode on click
  const handleVisualizerClick = () => {
    if (visualizerMode === 'spectrum') setVisualizerMode('oscilloscope');
    else if (visualizerMode === 'oscilloscope') setVisualizerMode('off');
    else setVisualizerMode('spectrum');
  };

  // Drawing loop for visualizer
  useEffect(() => {
    let animationId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;

      // Clear with very dark background
      ctx.fillStyle = '#0a0a0d';
      ctx.fillRect(0, 0, width, height);

      if (visualizerMode === 'off') {
        return;
      }

      const isPlaying = playbackState === 'playing';
      let data: Uint8Array;

      // Determine if we have real Web Audio data
      const isRealAudio = currentTrack && (currentTrack.source === 'local' || (currentTrack.source === 'spotify' && currentTrack.url));

      if (isPlaying && isRealAudio) {
        // Fetch real spectrum or waveform
        if (visualizerMode === 'spectrum') {
          data = audioManager.getSpectrumData();
        } else {
          data = audioManager.getWaveformData();
        }
      } else {
        // Fallback or Simulated data for YouTube/Paused
        data = new Uint8Array(128);
        if (isPlaying) {
          const time = Date.now() * 0.004;
          for (let i = 0; i < data.length; i++) {
            if (visualizerMode === 'spectrum') {
              // Simulated frequency bands using sine waves + noise
              const base = Math.sin(i * 0.2 - time) * 30 + Math.cos(i * 0.05 + time * 1.5) * 20 + 40;
              const randomNoise = Math.random() * 15;
              const fade = Math.max(0, 1 - i / 40); // fade out higher frequencies
              data[i] = Math.max(0, (base + randomNoise) * fade * (volume * 1.2));
            } else {
              // Simulated oscilloscope sine wave
              const freq = 0.1 + (volume * 0.1);
              data[i] = 128 + Math.sin(i * freq - time * 2) * 40 * volume;
            }
          }
        } else {
          // Stopped/Paused flatlines
          for (let i = 0; i < data.length; i++) {
            data[i] = visualizerMode === 'spectrum' ? 0 : 128;
          }
        }
      }

      if (visualizerMode === 'spectrum') {
        // Draw Winamp style vertical bars
        const barCount = 16;
        const barWidth = Math.floor(width / barCount) - 1;
        const gravity = 0.5; // fall speed for peaks

        for (let i = 0; i < barCount; i++) {
          // Average some bins to get nice spacing
          const binStart = Math.floor((i * data.length) / (barCount * 1.5));
          const binEnd = Math.floor(((i + 1) * data.length) / (barCount * 1.5));
          let val = 0;
          for (let b = binStart; b < binEnd; b++) {
            val += data[b];
          }
          val = val / (binEnd - binStart || 1);

          // Scale value to canvas height
          // Analyser values are 0-255
          const percent = val / 255;
          const barHeight = percent * height * 0.95;

          // Update falling peaks
          if (barHeight >= peaksRef.current[i]) {
            peaksRef.current[i] = barHeight;
            peakHoldFramesRef.current[i] = 15; // hold for 15 frames
          } else {
            if (peakHoldFramesRef.current[i] > 0) {
              peakHoldFramesRef.current[i]--;
            } else {
              peaksRef.current[i] = Math.max(0, peaksRef.current[i] - gravity);
            }
          }

          const x = i * (barWidth + 1);

          // Draw the frequency bar with a nice green-yellow-red retro gradient
          const gradient = ctx.createLinearGradient(0, height, 0, 0);
          gradient.addColorStop(0, '#00ff00'); // green bottom
          gradient.addColorStop(0.6, '#ffff00'); // yellow middle
          gradient.addColorStop(1, '#ff0000'); // red top

          ctx.fillStyle = gradient;
          ctx.fillRect(x, height - barHeight, barWidth, barHeight);

          // Draw the peak indicator dot
          const peakY = height - peaksRef.current[i];
          if (peaksRef.current[i] > 2 && peakY < height - 1) {
            ctx.fillStyle = '#ff3b30'; // red peak dot
            ctx.fillRect(x, peakY, barWidth, 1.5);
          }
        }
      } else if (visualizerMode === 'oscilloscope') {
        // Draw glowing green oscilloscope line
        ctx.strokeStyle = '#39ff14'; // neon green
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 1;
        ctx.beginPath();

        const sliceWidth = width / data.length;
        let x = 0;

        for (let i = 0; i < data.length; i++) {
          const v = data[i] / 255;
          const y = v * height;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }

          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.shadowBlur = 0; // reset shadow
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [visualizerMode, playbackState, currentTrack, volume]);

  // Get time components for pixel-perfect Winamp NUMBERS.png digits
  const getTimeDigits = () => {
    let t = Math.floor(currentTime);
    let isNegative = false;
    if (showRemainingTime) {
      isNegative = true;
      t = Math.max(0, Math.floor(duration - currentTime));
    }
    const mins = Math.floor(t / 60);
    const secs = t % 60;

    const minStr = mins.toString().padStart(2, '0');
    const secStr = secs.toString().padStart(2, '0');

    return {
      isNegative,
      d1: minStr[0],
      d2: minStr[1],
      d3: secStr[0],
      d4: secStr[1],
    };
  };

  // Color theme mapper for skins
  const getSkinTheme = () => {
    switch (skin) {
      case 'slate':
        return {
          bg: 'bg-slate-900 border-slate-700 text-slate-100',
          lcdBg: 'bg-slate-950 border-slate-800',
          lcdText: 'text-sky-400',
          btnActive: 'bg-sky-500/20 text-sky-400 border-sky-500',
          accent: 'sky',
        };
      case 'llama':
        return {
          bg: 'bg-amber-950 border-amber-700 text-amber-100',
          lcdBg: 'bg-black border-amber-900',
          lcdText: 'text-amber-500',
          btnActive: 'bg-amber-500/20 text-amber-400 border-amber-500',
          accent: 'amber',
        };
      case 'classic':
      default:
        return {
          bg: 'winamp-metal text-[#b4b5b8] font-mono',
          lcdBg: 'winamp-lcd',
          lcdText: 'text-[#00e100]',
          btnActive: 'bg-green-500/10 text-green-400 border-green-500',
          accent: 'green',
        };
    }
  };

  const theme = getSkinTheme();

  return (
    <div 
      id="winamp-main"
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.cursor-move')) {
          e.stopPropagation();
        }
      }}
      className={`w-[275px] h-[116px] p-[3px] select-none rounded-[2px] flex flex-col justify-between shadow-2xl relative ${theme.bg} winamp-border-outset`}
    >
      {/* 1. Classic Winamp Titlebar with Dual Brass Lines */}
      <div className="h-[14px] flex items-center justify-between cursor-move winamp-titlebar-classic px-[3px] relative overflow-hidden">
        {/* Double brass stripes behind title */}
        <div className="absolute inset-y-[3px] left-5 right-14 winamp-titlebar-stripes opacity-70 pointer-events-none" />

        {/* Left: Winamp Menu / Skin Switcher */}
        <div className="relative z-10 flex items-center gap-[3px]">
          <button 
            id="skin-menu-btn"
            onClick={() => setIsSkinMenuOpen(!isSkinMenuOpen)}
            className="w-[11px] h-[10px] winamp-btn-silver text-[7px] font-pixel font-bold flex items-center justify-center p-0"
            title="Menu de Skins"
          >
            ~
          </button>
          
          {/* Skin Selection Menu */}
          {isSkinMenuOpen && (
            <div className="absolute left-0 top-[12px] w-[105px] bg-[#222230] border-2 border-[#666680] shadow-2xl z-50 text-xs py-1 text-white font-sans">
              <div className="px-2 py-0.5 border-b border-[#444] text-[8px] text-[#aaa] uppercase tracking-wider font-bold font-pixel">Skins</div>
              <button 
                id="skin-classic-btn"
                onClick={() => { onSkinChange('classic'); setIsSkinMenuOpen(false); }}
                className={`w-full text-left px-2 py-1 hover:bg-[#00e100]/20 flex items-center justify-between text-[9px] font-pixel ${skin === 'classic' ? 'text-[#00e100]' : ''}`}
              >
                Classic <span>2.9</span>
              </button>
              <button 
                id="skin-slate-btn"
                onClick={() => { onSkinChange('slate'); setIsSkinMenuOpen(false); }}
                className={`w-full text-left px-2 py-1 hover:bg-[#38bdf8]/20 flex items-center justify-between text-[9px] font-pixel ${skin === 'slate' ? 'text-[#38bdf8]' : ''}`}
              >
                Slate <span>Dark</span>
              </button>
              <button 
                id="skin-llama-btn"
                onClick={() => { onSkinChange('llama'); setIsSkinMenuOpen(false); }}
                className={`w-full text-left px-2 py-1 hover:bg-[#f59e0b]/20 flex items-center justify-between text-[9px] font-pixel ${skin === 'llama' ? 'text-[#f59e0b]' : ''}`}
              >
                Llama <span>Gold</span>
              </button>
            </div>
          )}
        </div>

        {/* Center: Title */}
        <span className="text-[8px] font-pixel text-[#e0e0ea] font-bold tracking-[0.2em] z-10 pointer-events-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] px-1 bg-[#242438]/80">
          WINAMP
        </span>

        {/* Right: Window Controls */}
        <div className="flex items-center gap-[2px] z-10">
          <button 
            id="toggle-video-window"
            onClick={onToggleVideo}
            title="Video Window"
            className={`w-[10px] h-[9px] text-[7px] font-pixel flex items-center justify-center rounded-[1px] p-0 ${isVideoOpen ? 'winamp-btn-silver-active text-[#00ff00]' : 'winamp-btn-silver'}`}
          >
            V
          </button>
          <button 
            onClick={() => fetch('/api/window/minimize', { method: 'POST' }).catch(() => {})} 
            className="w-[10px] h-[9px] winamp-btn-silver text-[6px] font-bold flex items-center justify-center p-0" 
            title="Minimizar"
          >
            _
          </button>
          <button 
            onClick={() => fetch('/api/window/close', { method: 'POST' }).catch(() => {})} 
            className="w-[10px] h-[9px] winamp-btn-silver text-[7px] font-bold text-[#b00] hover:text-red-600 flex items-center justify-center p-0" 
            title="Cerrar Winamp"
          >
            ×
          </button>
        </div>
      </div>

      {/* 2. Main LCD Panel & Visualizer Row */}
      {(() => {
        const digits = getTimeDigits();
        return (
          <div className={`h-[48px] p-[2px] rounded-[1px] flex gap-[4px] ${theme.lcdBg} scanlines winamp-border-inset relative`}>
            {/* Left Side: OSD Status, Clock & Visualizer (width ~80px) */}
            <div className="w-[80px] flex flex-col justify-between shrink-0 overflow-hidden">
              {/* Top: Status OSD & Clock */}
              <div className="flex items-center gap-[2px]">
                {/* Play/Pause/Stop Indicator from PLAYPAUS.png */}
                <div 
                  style={{
                    width: 9,
                    height: 9,
                    backgroundImage: 'url(/skin/PLAYPAUS.png)',
                    backgroundPosition: playbackState === 'playing' ? '0px 0px' : playbackState === 'paused' ? '-9px 0px' : '-18px 0px',
                    imageRendering: 'pixelated',
                    flexShrink: 0
                  }}
                  title={playbackState}
                />

                {/* Digital Clock with NUMBERS.png */}
                <div 
                  id="clock-display"
                  onClick={() => setShowRemainingTime(!showRemainingTime)}
                  className="flex items-center gap-[0px] select-none cursor-pointer bg-black px-[2px] py-[1px] border border-[#1a1a24] rounded-[1px]"
                  title={showRemainingTime ? "Click para tiempo transcurrido" : "Click para tiempo restante"}
                >
                  <WinampDigit char={digits.isNegative ? '-' : ' '} />
                  <WinampDigit char={digits.d1} />
                  <WinampDigit char={digits.d2} />
                  <div className="w-[3px] h-[13px] flex flex-col justify-center items-center gap-[3px] shrink-0">
                    <div className="w-[2px] h-[2px] bg-[#00ff00]" />
                    <div className="w-[2px] h-[2px] bg-[#00ff00]" />
                  </div>
                  <WinampDigit char={digits.d3} />
                  <WinampDigit char={digits.d4} />
                </div>
              </div>

              {/* Spectrum / Oscilloscope Visualizer */}
              <div className="h-[20px] w-[78px] bg-black rounded-[1px] border border-[#222] overflow-hidden relative cursor-pointer" onClick={handleVisualizerClick} title="Click to toggle visualizer mode">
                <canvas 
                  ref={canvasRef} 
                  width={78} 
                  height={18} 
                  className="w-full h-full visualizer-grid"
                />
              </div>
            </div>

            {/* Right Side: Track Marquee, Format Specs, Vol/Bal/EQ/PL */}
            <div className="flex-1 flex flex-col justify-between min-w-0 pr-[1px]">
              {/* Row 1: Marquee Title */}
              <div className="h-[13px] px-[3px] bg-black border border-[#1a1a24] flex items-center overflow-hidden w-full select-none">
                <div className="winamp-marquee-container w-full">
                  <span className="winamp-marquee-content inline-block text-[9px] font-pixel text-[#00ff00] uppercase tracking-wider">
                    {currentTrack ? `${currentTrack.artist} - ${currentTrack.title}` : "WINAMP - IT REALLY WHIPS THE LLAMA'S ASS"}
                  </span>
                </div>
              </div>

              {/* Row 2: Bitrate, Khz, Mono/Stereo */}
              <div className="flex justify-between items-center px-[2px] text-[7px] font-pixel leading-none">
                <div className="flex gap-[3px] items-center text-[#00ff00]">
                  <span className="bg-black px-[2px] py-[0.5px] border border-[#222]">
                    {currentTrack ? (currentTrack.source === 'spotify' ? '128' : '320') : '128'}
                  </span>
                  <span>kbps</span>
                  <span className="bg-black px-[2px] py-[0.5px] border border-[#222]">44</span>
                  <span>kHz</span>
                </div>
                <div className="flex gap-[1px]">
                  <div 
                    style={{
                      width: 27,
                      height: 12,
                      backgroundImage: 'url(/skin/MONOSTER.png)',
                      backgroundPosition: '-29px -12px',
                      imageRendering: 'pixelated'
                    }}
                  />
                  <div 
                    style={{
                      width: 29,
                      height: 12,
                      backgroundImage: 'url(/skin/MONOSTER.png)',
                      backgroundPosition: currentTrack ? '0px 0px' : '0px -12px',
                      imageRendering: 'pixelated'
                    }}
                  />
                </div>
              </div>

              {/* Row 3: Volume, Balance, EQ and PL Buttons */}
              <div className="flex items-center justify-between gap-[3px]">
                {/* Volume slider */}
                <div className="flex-1 flex items-center" title={`Volume: ${Math.round(volume * 100)}%`}>
                  <input 
                    id="volume-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                    className="w-full winamp-slider-volume"
                  />
                </div>

                {/* Balance slider */}
                <div className="w-[36px] flex items-center" title={`Balance: ${pan === 0 ? 'Center' : pan < 0 ? 'L' + Math.abs(Math.round(pan*100)) : 'R' + Math.round(pan*100)}`}>
                  <input 
                    id="pan-slider"
                    type="range"
                    min="-1"
                    max="1"
                    step="0.1"
                    value={pan}
                    onChange={(e) => onPanChange(parseFloat(e.target.value))}
                    className="w-full winamp-slider-balance"
                  />
                </div>

                {/* EQ Toggle Button */}
                <button 
                  id="toggle-eq"
                  onClick={onToggleEq}
                  title="Toggle Equalizer"
                  className={`winamp-sprite-shufrep winamp-sprite-eq ${isEqOpen ? 'active' : ''}`}
                />

                {/* PL Toggle Button */}
                <button 
                  id="toggle-pl"
                  onClick={onTogglePl}
                  title="Toggle Playlist Editor"
                  className={`winamp-sprite-shufrep winamp-sprite-pl ${isPlOpen ? 'active' : ''}`}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* 3. Seeker / Song Position slider from POSBAR.png */}
      <div className="h-[10px] flex items-center px-[2px]" title="Seek position">
        <input 
          id="seek-slider"
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          disabled={!currentTrack}
          className="w-full winamp-slider-posbar"
        />
      </div>

      {/* 4. Controls Row: Transport Buttons + Shuffle/Repeat */}
      <div className="h-[22px] flex items-center justify-between px-[1px]">
        {/* Main 6 Transport Buttons from CBUTTONS.png (No persistent pressed state!) */}
        <div className="flex items-center gap-[0px]">
          <button id="prev-track-btn" onClick={onPrev} title="Previous track" className="winamp-cbtn winamp-cbtn-prev" />
          <button id="play-track-btn" onClick={onPlay} title="Play" className="winamp-cbtn winamp-cbtn-play" />
          <button id="pause-track-btn" onClick={onPause} title="Pause" className="winamp-cbtn winamp-cbtn-pause" />
          <button id="stop-track-btn" onClick={onStop} title="Stop" className="winamp-cbtn winamp-cbtn-stop" />
          <button id="next-track-btn" onClick={onNext} title="Next track" className="winamp-cbtn winamp-cbtn-next" />
          <button id="eject-track-btn" onClick={onEject} title="Open URL or search" className="winamp-cbtn winamp-cbtn-eject" />
        </div>

        {/* Shuffle & Repeat Buttons from SHUFREP.png */}
        <div className="flex items-center gap-[2px]">
          <button 
            id="toggle-shuffle"
            onClick={onToggleShuffle}
            title="Toggle Shuffle"
            className={`winamp-sprite-shufrep winamp-sprite-shuffle ${shuffle ? 'active' : ''}`}
          />
          <button 
            id="toggle-repeat"
            onClick={onToggleRepeat}
            title="Toggle Repeat"
            className={`winamp-sprite-shufrep winamp-sprite-repeat ${repeat ? 'active' : ''}`}
          />
          <div className="w-[14px] h-[14px] flex items-center justify-center text-[#c8b874] text-[10px] font-bold opacity-90 select-none" title="Winamp 2.91">
            ⚡
          </div>
        </div>
      </div>
    </div>
  );
}
