import { EqualizerPreset } from '../types';

class AudioManager {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private preampNode: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private isInitialized = false;

  // Track frequencies for the 10 bands in Winamp
  public readonly frequencies = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];

  constructor() {
    // Audio elements will be lazy-initialized on first user interaction
  }

  public init() {
    if (this.isInitialized) return;

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtxClass();

      // Create audio element with anonymous CORS
      this.audioElement = new Audio();
      this.audioElement.crossOrigin = 'anonymous';

      // Create nodes
      this.source = this.ctx.createMediaElementSource(this.audioElement);
      this.preampNode = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256; // 128 frequency bars

      // Set up 10-band EQ in series
      let lastNode: AudioNode = this.preampNode;

      this.filters = this.frequencies.map((freq) => {
        if (!this.ctx) throw new Error('No AudioContext');
        const filter = this.ctx.createBiquadFilter();
        // Use peaking filter for bands
        filter.type = 'peaking';
        filter.frequency.value = freq;
        // Q factor represents band width (approx 1.0 is decent for 1-octave spacing)
        filter.Q.value = 1.0;
        filter.gain.value = 0; // default to flat (0dB)

        // Connect in series
        lastNode.connect(filter);
        lastNode = filter;
        return filter;
      });

      // Connect source to preamp
      this.source.connect(this.preampNode);

      // Connect last filter to analyser, and analyser to destination
      lastNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      this.isInitialized = true;
      console.log('Web Audio API graph initialized successfully');
    } catch (err) {
      console.error('Failed to initialize Web Audio API:', err);
    }
  }

  public getAudioElement(): HTMLAudioElement {
    this.init();
    if (!this.audioElement) {
      throw new Error('Audio element not initialized');
    }
    return this.audioElement;
  }

  public getAnalyser(): AnalyserNode | null {
    this.init();
    return this.analyser;
  }

  public resumeContext() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // EQ Controls
  public setPreamp(dB: number) {
    this.init();
    if (!this.preampNode) return;
    // Preamp: convert dB to linear gain: multiplier = 10^(dB/20)
    const gainValue = Math.pow(10, dB / 20);
    this.preampNode.gain.setValueAtTime(gainValue, this.ctx?.currentTime || 0);
  }

  public setBandGain(index: number, dB: number) {
    this.init();
    if (index < 0 || index >= this.filters.length) return;
    const clampedGain = Math.max(-12, Math.min(12, dB));
    this.filters[index].gain.setValueAtTime(clampedGain, this.ctx?.currentTime || 0);
  }

  public applyPreset(preset: EqualizerPreset) {
    this.init();
    this.setPreamp(preset.preamp);
    preset.gains.forEach((gain, index) => {
      this.setBandGain(index, gain);
    });
  }

  // Helper to extract frequency spectrum data
  public getSpectrumData(): Uint8Array {
    if (!this.analyser) return new Uint8Array(0);
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  // Helper to extract waveform/oscilloscope data
  public getWaveformData(): Uint8Array {
    if (!this.analyser) return new Uint8Array(0);
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteTimeDomainData(dataArray);
    return dataArray;
  }
}

export const audioManager = new AudioManager();

export const EQ_PRESETS: EqualizerPreset[] = [
  { name: 'Flat', preamp: 0, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Classical', preamp: 0, gains: [5, 4, 3, 3, -1, -1, 0, 2, 4, 4] },
  { name: 'Club', preamp: 0, gains: [0, 0, 2, 4, 4, 3, 2, 0, 0, 0] },
  { name: 'Dance', preamp: 0, gains: [4, 6, 5, 0, 0, -2, -4, -4, 0, 0] },
  { name: 'Full Bass', preamp: 0, gains: [6, 5, 5, 3, 0, -3, -5, -6, -6, -6] },
  { name: 'Full Treble', preamp: 0, gains: [-6, -6, -6, -4, -1, 3, 6, 8, 8, 8] },
  { name: 'Laptop', preamp: 0, gains: [3, 5, -1, -4, -2, 1, 3, 5, 7, 7] },
  { name: 'Metal', preamp: 0, gains: [3, 4, 2, 3, -1, -2, 2, 0, 4, 3] },
  { name: 'Pop', preamp: 0, gains: [-2, -1, 2, 4, 4, 3, 0, -1, -2, -2] },
  { name: 'Rock', preamp: 0, gains: [4, 3, -3, -5, -2, 2, 4, 6, 6, 6] },
  { name: 'Soft', preamp: 0, gains: [2, 1, 0, -1, -1, 1, 3, 4, 4, 5] },
  { name: 'Techno', preamp: 0, gains: [4, 3, 0, -3, -2, 0, 4, 4, 4, 3] },
];
