export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number; // in seconds
  url: string; // MP3 source URL or YouTube Video ID or Spotify preview URL
  source: 'local' | 'youtube';
  thumbnail?: string;
}

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  thumbnail?: string;
  itemCount?: number;
}

export type WinampSkin = 'classic' | 'slate' | 'llama';

export type VisualizerMode = 'spectrum' | 'oscilloscope' | 'off';

export type PlaybackState = 'playing' | 'paused' | 'stopped';

export interface WindowConfig {
  id: string;
  title: string;
  x: number;
  y: number;
  isOpen: boolean;
  isShaded: boolean;
  width: number;
  height: number;
}

export interface EqualizerPreset {
  name: string;
  gains: number[]; // 10 values, -12 to +12 dB
  preamp: number;  // -12 to +12 dB
}
