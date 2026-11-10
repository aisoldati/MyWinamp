import React, { useState, useRef, useEffect } from 'react';
import { EQ_PRESETS, audioManager } from '../utils/audio';
import { EqualizerPreset, WinampSkin } from '../types';

interface VerticalSliderProps {
  key?: any;
  value: number;
  onChange: (val: number) => void;
  label: string;
  min?: number;
  max?: number;
  color?: string;
}

// Separate component to prevent unnecessary re-renders/unmounts during mouse drag
function VerticalSlider({ 
  value, 
  onChange, 
  label,
  min = -12,
  max = 12,
  color = 'green'
}: VerticalSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    handlePointerMove(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging && e.buttons !== 1) return;
    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    // Calculate position from bottom
    const y = Math.max(0, Math.min(rect.height, rect.bottom - e.clientY));
    const percentage = y / rect.height;
    const val = min + percentage * (max - min);
    onChange(val);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Calculate slider thumb offset (percentage from bottom)
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col items-center select-none w-[17px]">
      {/* Value tooltip on hover/drag */}
      <div className={`text-[6px] h-[8px] font-mono text-center transition-colors duration-100 ${isDragging ? 'text-[#00ff00] font-bold' : 'text-gray-500'}`}>
        {value > 0 ? `+${value}` : value}
      </div>

      {/* Track */}
      <div 
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="h-[46px] w-[5px] bg-[#000000] border border-[#1c1c28] rounded-[1px] relative cursor-row-resize flex justify-center shadow-inner"
      >
        {/* Authentic Winamp colored groove inside the track */}
        <div 
          className={`absolute inset-y-[2px] w-[2px] rounded-[0.5px] ${color === 'orange' ? 'winamp-groove-orange' : 'winamp-groove-green'} opacity-90`}
        />

        {/* Winamp Classic Silver Slider Knob */}
        <div 
          className="absolute w-[14px] h-[9px] winamp-btn-silver rounded-[1px] shadow-md flex items-center justify-center p-0 pointer-events-none z-10"
          style={{ 
            bottom: `calc(${percentage}% - 4.5px)`,
            left: '-4.5px'
          }}
        >
          {/* Horizontal center notch */}
          <div className="w-[8px] h-[1px] bg-[#14141c]" />
        </div>
      </div>

      {/* Frequency / Preamp Label */}
      <div className="text-[6px] font-pixel text-gray-300 mt-[2px] tracking-tighter truncate max-w-full">
        {label}
      </div>
    </div>
  );
}

interface EqualizerProps {
  skin: WinampSkin;
  onClose: () => void;
}

export default function Equalizer({ skin, onClose }: EqualizerProps) {
  const [eqOn, setEqOn] = useState(true);
  const [autoOn, setAutoOn] = useState(false);
  const [preamp, setPreamp] = useState(0); // -12 to +12 dB
  const [bandGains, setBandGains] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const bands = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];

  // Apply preamp gain
  useEffect(() => {
    if (eqOn) {
      audioManager.setPreamp(preamp);
    } else {
      audioManager.setPreamp(0); // Bypass: flat
    }
  }, [preamp, eqOn]);

  // Apply band gains
  useEffect(() => {
    bandGains.forEach((gain, index) => {
      if (eqOn) {
        audioManager.setBandGain(index, gain);
      } else {
        audioManager.setBandGain(index, 0); // Bypass: flat
      }
    });
  }, [bandGains, eqOn]);

  // Draw the EQ curve
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Draw horizontal grid lines (dB markers: +12, 0, -12)
    ctx.strokeStyle = '#222230';
    ctx.lineWidth = 0.5;
    
    // +12dB, 0dB, -12dB lines
    const yMax = 2;
    const yMid = height / 2;
    const yMin = height - 2;
    
    ctx.beginPath();
    ctx.moveTo(0, yMax); ctx.lineTo(width, yMax);
    ctx.moveTo(0, yMid); ctx.lineTo(width, yMid);
    ctx.moveTo(0, yMin); ctx.lineTo(width, yMin);
    ctx.stroke();

    // Draw curves in classic orange/yellow gradient
    ctx.strokeStyle = eqOn ? '#ffaa00' : '#444455';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const padding = 8;
    const plotWidth = width - padding * 2;
    const pointsCount = bandGains.length;

    // We will draw a smooth spline or a series of lines representing the gains
    for (let i = 0; i < pointsCount; i++) {
      const gain = eqOn ? bandGains[i] : 0;
      // Map gain (-12 to +12) to canvas coordinates (height - 3 to 3)
      const percent = (gain + 12) / 24; // 0 to 1
      const y = height - 3 - percent * (height - 6);
      const x = padding + (i / (pointsCount - 1)) * plotWidth;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        // Curve approximation
        const prevGain = eqOn ? bandGains[i-1] : 0;
        const prevPercent = (prevGain + 12) / 24;
        const prevY = height - 3 - prevPercent * (height - 6);
        const prevX = padding + ((i - 1) / (pointsCount - 1)) * plotWidth;

        const cpX1 = prevX + (x - prevX) / 2;
        const cpY1 = prevY;
        const cpX2 = prevX + (x - prevX) / 2;
        const cpY2 = y;

        ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, x, y);
      }
    }
    ctx.stroke();

    // Draw nodes / dots in yellow/green
    ctx.fillStyle = eqOn ? '#ffff00' : '#3c3e45';
    for (let i = 0; i < pointsCount; i++) {
      const gain = eqOn ? bandGains[i] : 0;
      const percent = (gain + 12) / 24;
      const y = height - 3 - percent * (height - 6);
      const x = padding + (i / (pointsCount - 1)) * plotWidth;

      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

  }, [bandGains, eqOn]);

  // Handle preamp slider
  const handlePreampChange = (val: number) => {
    setPreamp(Math.round(val));
  };

  // Handle band slider
  const handleBandGainChange = (index: number, val: number) => {
    const updated = [...bandGains];
    updated[index] = Math.round(val);
    setBandGains(updated);
  };

  // Handle preset application
  const handlePresetSelect = (preset: EqualizerPreset) => {
    setPreamp(preset.preamp);
    setBandGains([...preset.gains]);
    setIsPresetsOpen(false);
  };

  const getSkinTheme = () => {
    switch (skin) {
      case 'slate':
        return {
          bg: 'bg-slate-900 border-slate-700 text-slate-100',
          lcdBg: 'bg-slate-950 border-slate-800',
        };
      case 'llama':
        return {
          bg: 'bg-amber-950 border-amber-700 text-amber-100',
          lcdBg: 'bg-black border-amber-900',
        };
      case 'classic':
      default:
        return {
          bg: 'winamp-metal text-[#b4b5b8] font-mono',
          lcdBg: 'winamp-lcd',
        };
    }
  };

  const theme = getSkinTheme();

  return (
    <div 
      id="winamp-equalizer"
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.cursor-move')) {
          e.stopPropagation();
        }
      }}
      className={`w-full h-full p-[3px] box-border select-none rounded-[2px] flex flex-col justify-between shadow-2xl relative ${theme.bg} winamp-border-outset overflow-hidden`}
    >
      {/* 1. Classic Title Bar with Dual Brass Stripes */}
      <div className="h-[14px] flex items-center justify-between cursor-move winamp-titlebar-classic px-[3px] relative overflow-hidden">
        <div className="absolute inset-y-[3px] left-4 right-8 winamp-titlebar-stripes opacity-70 pointer-events-none" />
        <span className="text-[8px] font-pixel text-[#e0e0ea] font-bold tracking-[0.15em] z-10 pointer-events-none uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] px-1 bg-[#242438]/80">
          WINAMP EQUALIZER
        </span>
        <button 
          id="close-eq-btn"
          onClick={onClose}
          className="w-[10px] h-[9px] winamp-btn-silver text-[7px] font-bold text-[#b00] hover:text-red-600 flex items-center justify-center p-0 z-10"
        >
          ×
        </button>
      </div>

      {/* 2. Top Controls: ON, AUTO, Spline Curve Display, PRESETS */}
      <div className="h-[20px] flex items-center justify-between px-[2px] mt-[1px] gap-[4px]">
        {/* Toggle On & Auto Buttons */}
        <div className="flex items-center gap-[2px]">
          <button 
            id="toggle-eq-active"
            onClick={() => setEqOn(!eqOn)}
            className={`winamp-sprite-eqbtn winamp-sprite-eq-on ${eqOn ? 'active' : ''}`}
            title="Toggle EQ On/Off"
          />
          <button 
            id="toggle-eq-auto"
            onClick={() => setAutoOn(!autoOn)}
            className={`winamp-sprite-eqbtn winamp-sprite-eq-auto ${autoOn ? 'active' : ''}`}
            title="Toggle EQ Auto"
          />
        </div>

        {/* Small Spline Curve Canvas */}
        <div className={`flex-1 h-[15px] rounded-[1px] border border-[#222] overflow-hidden ${theme.lcdBg}`}>
          <canvas 
            ref={canvasRef} 
            width={110} 
            height={13} 
            className="w-full h-full"
          />
        </div>

        {/* Presets Button & Dropdown */}
        <div className="relative flex items-center">
          <button 
            id="presets-menu-btn"
            onClick={() => setIsPresetsOpen(!isPresetsOpen)}
            className="winamp-sprite-eqbtn winamp-sprite-eq-presets"
            title="Equalizer Presets"
          />

          {isPresetsOpen && (
            <div className="absolute right-0 top-[16px] w-[115px] max-h-[85px] overflow-y-auto winamp-scrollbar bg-[#202124] border-2 border-[#555] shadow-2xl z-50 text-[10px] text-white font-sans">
              {EQ_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => handlePresetSelect(p)}
                  className="w-full text-left px-2 py-1 hover:bg-green-500/20 hover:text-green-400 font-medium border-b border-[#333] last:border-0"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. Equalizer Sliders Area: dB labels + 1 preamp slider + 10 band sliders */}
      <div className="flex-1 flex justify-between items-center bg-[#0d0e12] p-[2px] border border-[#1a1a24] rounded-[2px] mt-[1px] gap-[2px]">
        {/* dB Scale Labels */}
        <div className="flex flex-col justify-between h-[46px] py-[2px] text-[6px] font-pixel text-[#d4af37] leading-none select-none text-right pr-0.5">
          <span>+12 db</span>
          <span>0 db</span>
          <span>-12 db</span>
        </div>

        {/* Preamp Column */}
        <VerticalSlider 
          value={preamp} 
          onChange={handlePreampChange} 
          label="PREAMP" 
          color="orange"
        />

        {/* Vertical Separator Line */}
        <div className="h-[46px] w-[1px] bg-[#222232]" />

        {/* 10 Band Sliders */}
        <div className="flex justify-between flex-1 pl-[1px]">
          {bandGains.map((gain, index) => (
            <VerticalSlider 
              key={index}
              value={gain} 
              onChange={(val) => handleBandGainChange(index, val)} 
              label={bands[index]} 
              color={index < 4 ? 'orange' : 'green'}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
