// Voice-optimised settings: 16 kHz mono 32 kbps, about 13.7 MB/hour.
// MediaRecorder keeps the primary capture alive better when mobile browsers throttle Web Audio.
const SAMPLE_RATE = 16000;
const BIT_RATE = 32;
const BUFFER_SIZE = 4096;

type Mp3Encoder = {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
};

declare global {
  interface Window {
    lamejs?: {
      Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => Mp3Encoder;
    };
  }
}

type DurationCallback = (seconds: number) => void;
type LevelCallback = (level: number) => void;
type GainCallback = (gain: number) => void;
export type RecordedSegment = {
  id: string;
  start: number;
  end: number;
  blob: Blob;
};
type SegmentCallback = (segment: RecordedSegment) => void;

type RecorderOptions = {
  autoGain?: boolean;
  silenceSeconds?: number;
  maxSegmentSeconds?: number;
  onDuration: DurationCallback;
  onLevel?: LevelCallback;
  onGain?: GainCallback;
  onSegment?: SegmentCallback;
};

class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private mediaChunks: Blob[] = [];
  private mediaMimeType = '';
  private encoder: Mp3Encoder | null = null;
  private mp3Chunks: Int8Array[] = [];
  private fallbackMp3Blob: Blob | null = null;
  private startTime = 0;
  private pausedAt = 0;
  private totalPausedMs = 0;
  private _paused = false;
  private wakeLock: WakeLockSentinel | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private onLevel: LevelCallback | null = null;
  private onGain: GainCallback | null = null;
  private onSegment: SegmentCallback | null = null;
  private lastLevelAt = 0;
  private lastGainAt = 0;
  private inputGain = 1;
  private autoGain = false;
  private silenceSeconds = 2.5;
  private maxSegmentSeconds = 8;
  private segmentEncoder: Mp3Encoder | null = null;
  private segmentChunks: Int8Array[] = [];
  private segmentStart = 0;
  private segmentHasVoice = false;
  private lastVoiceAt = 0;
  private segmentIndex = 0;
  private visibilityHandler: (() => void) | null = null;

  async start(options: RecorderOptions): Promise<void> {
    this.onLevel = options.onLevel ?? null;
    this.onGain = options.onGain ?? null;
    this.onSegment = options.onSegment ?? null;
    this.autoGain = options.autoGain ?? false;
    this.silenceSeconds = options.silenceSeconds ?? 2.5;
    this.maxSegmentSeconds = options.maxSegmentSeconds ?? 8;
    this.fallbackMp3Blob = null;

    const Mp3Encoder = window.lamejs?.Mp3Encoder;
    if (!Mp3Encoder) throw new Error('No se pudo cargar el codificador MP3');

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.startNativeCapture();

    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.encoder = new Mp3Encoder(1, this.audioContext.sampleRate, BIT_RATE);
    this.mp3Chunks = [];
    this.segmentChunks = [];
    this.segmentEncoder = null;
    this.segmentHasVoice = false;
    this.segmentIndex = 0;
    this.lastVoiceAt = 0;
    this.segmentStart = 0;
    this.startTime = Date.now();
    this.totalPausedMs = 0;
    this._paused = false;

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (this._paused) return;
      const raw = e.inputBuffer.getChannelData(0);
      this.updateAutoGain(raw);
      const pcm = this.applyGain(raw);
      const stats = this.measure(pcm);
      this.emitLevelFromStats(stats.level);
      this.handleSegment(pcm, stats);
      const chunk = this.encoder!.encodeBuffer(this.toInt16(pcm));
      if (chunk.length > 0) this.mp3Chunks.push(new Int8Array(chunk));
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.timerInterval = setInterval(() => {
      if (!this._paused) options.onDuration(this.elapsed());
    }, 500);

    await this.requestWakeLock();
    this.setupVisibilityProtection();
    this.setupMediaSession();
  }

  pause(): void {
    this._paused = true;
    this.pausedAt = Date.now();
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  }

  resume(): void {
    if (this.pausedAt) this.totalPausedMs += Date.now() - this.pausedAt;
    this._paused = false;
    this.pausedAt = 0;
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
    }
    void this.requestWakeLock();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  }

  async stop(): Promise<Blob> {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = null;

    const nativeBlob = await this.stopNativeCapture();

    this.processor?.disconnect();
    this.source?.disconnect();
    const tail = this.encoder?.flush();
    if (tail && tail.length > 0) this.mp3Chunks.push(new Int8Array(tail));
    this.finalizeSegment(this.elapsed());
    this.fallbackMp3Blob = new Blob(this.mp3Chunks as unknown as BlobPart[], { type: 'audio/mpeg' });

    await this.audioContext?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.releaseWakeLock();
    this.removeVisibilityProtection();

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
    }

    const blob = nativeBlob && nativeBlob.size > 0 ? nativeBlob : this.fallbackMp3Blob;

    this.audioContext = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.encoder = null;
    this.onLevel = null;
    this.onGain = null;
    this.onSegment = null;
    this.lastLevelAt = 0;
    this.lastGainAt = 0;
    this.mp3Chunks = [];
    this.mediaChunks = [];
    this.mediaRecorder = null;
    this.mediaMimeType = '';
    this.segmentChunks = [];
    this.segmentEncoder = null;

    return blob;
  }

  elapsed(): number {
    if (!this.startTime) return 0;
    const raw = (Date.now() - this.startTime - this.totalPausedMs) / 1000;
    return Math.max(0, raw);
  }

  get paused() {
    return this._paused;
  }

  getFallbackMp3Blob(): Blob | null {
    return this.fallbackMp3Blob;
  }

  setGain(gain: number) {
    this.inputGain = Math.max(0.1, Math.min(10, gain));
  }

  private applyGain(pcm: Float32Array): Float32Array {
    if (this.inputGain === 1) return pcm;
    const out = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      out[i] = Math.max(-1, Math.min(1, pcm[i] * this.inputGain));
    }
    return out;
  }

  private updateAutoGain(raw: Float32Array) {
    if (!this.autoGain) return;
    const stats = this.measure(raw);
    if (!stats.hasVoice) return;

    const now = performance.now();
    if (now - this.lastGainAt < 350) return;
    this.lastGainAt = now;

    const targetPeak = 0.85;
    const observedPeak = Math.max(0.02, stats.peak * this.inputGain);
    const desired = this.inputGain * (targetPeak / observedPeak);
    const limited = Math.max(0.1, Math.min(10, desired));
    const smoothing = limited < this.inputGain ? 0.45 : 0.18;
    this.inputGain = Number((this.inputGain + (limited - this.inputGain) * smoothing).toFixed(2));
    this.onGain?.(this.inputGain);
  }

  private toInt16(f32: Float32Array): Int16Array {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const sample = Math.max(-1, Math.min(1, f32[i]));
      out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return out;
  }

  private measure(pcm: Float32Array) {
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) {
      const sample = Math.abs(pcm[i]);
      sum += sample * sample;
      if (sample > peak) peak = sample;
    }

    const rms = Math.sqrt(sum / pcm.length);
    const level = Math.min(1, Math.max(peak, rms * 3.5));
    return {
      peak,
      rms,
      level,
      hasVoice: peak > 0.025 || rms > 0.012,
    };
  }

  private emitLevelFromStats(level: number) {
    if (!this.onLevel) return;
    const now = performance.now();
    if (now - this.lastLevelAt < 80) return;
    this.lastLevelAt = now;
    this.onLevel(level);
  }

  private handleSegment(pcm: Float32Array, stats: ReturnType<AudioRecorder['measure']>) {
    if (!this.onSegment) return;

    const now = this.elapsed();
    const bufferSeconds = pcm.length / (this.audioContext?.sampleRate ?? SAMPLE_RATE);

    if (stats.hasVoice && !this.segmentEncoder) {
      this.segmentEncoder = new window.lamejs!.Mp3Encoder(1, this.audioContext?.sampleRate ?? SAMPLE_RATE, BIT_RATE);
      this.segmentChunks = [];
      this.segmentHasVoice = false;
      this.segmentStart = Math.max(0, now - bufferSeconds);
    }

    if (!this.segmentEncoder) return;

    const chunk = this.segmentEncoder.encodeBuffer(this.toInt16(pcm));
    if (chunk.length > 0) this.segmentChunks.push(new Int8Array(chunk));

    if (stats.hasVoice) {
      this.segmentHasVoice = true;
      this.lastVoiceAt = now;
    }

    if (this.segmentHasVoice && now - this.lastVoiceAt >= this.silenceSeconds) {
      this.finalizeSegment(Math.max(this.segmentStart, this.lastVoiceAt));
      return;
    }

    if (this.segmentHasVoice && now - this.segmentStart >= this.maxSegmentSeconds) {
      this.finalizeSegment(now);
    }
  }

  private finalizeSegment(end: number) {
    if (!this.segmentEncoder || !this.segmentHasVoice) {
      this.segmentEncoder = null;
      this.segmentChunks = [];
      return;
    }

    const tail = this.segmentEncoder.flush();
    if (tail.length > 0) this.segmentChunks.push(new Int8Array(tail));

    const blob = new Blob(this.segmentChunks as unknown as BlobPart[], { type: 'audio/mpeg' });
    if (blob.size > 512) {
      this.onSegment?.({
        id: `seg_${String(++this.segmentIndex).padStart(4, '0')}`,
        start: this.segmentStart,
        end,
        blob,
      });
    }

    this.segmentEncoder = null;
    this.segmentChunks = [];
    this.segmentHasVoice = false;
  }

  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Grabando...',
      artist: 'VoiceNote',
    });
    navigator.mediaSession.playbackState = 'playing';
    try {
      navigator.mediaSession.setActionHandler('pause', () => {});
      navigator.mediaSession.setActionHandler('play', () => {});
      navigator.mediaSession.setActionHandler('stop', () => {});
    } catch {
      // Some browsers expose Media Session only partially.
    }
  }

  private startNativeCapture() {
    if (!this.stream || typeof MediaRecorder === 'undefined') return;

    const mimeType = this.pickMediaRecorderMimeType();
    try {
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);
      this.mediaMimeType = this.mediaRecorder.mimeType || mimeType || 'audio/webm';
      this.mediaChunks = [];
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.mediaChunks.push(event.data);
      };
      this.mediaRecorder.start(1000);
    } catch {
      this.mediaRecorder = null;
      this.mediaChunks = [];
      this.mediaMimeType = '';
    }
  }

  private stopNativeCapture(): Promise<Blob | null> {
    const recorder = this.mediaRecorder;
    if (!recorder) return Promise.resolve(null);

    if (recorder.state === 'inactive') {
      return Promise.resolve(this.buildNativeBlob());
    }

    return new Promise((resolve) => {
      const finish = () => resolve(this.buildNativeBlob());
      recorder.addEventListener('stop', finish, { once: true });
      recorder.addEventListener('error', () => resolve(this.buildNativeBlob()), { once: true });
      try {
        recorder.requestData();
      } catch {
        // The final stop event should still flush what the browser has buffered.
      }
      try {
        recorder.stop();
      } catch {
        resolve(this.buildNativeBlob());
      }
    });
  }

  private buildNativeBlob(): Blob | null {
    if (this.mediaChunks.length === 0) return null;
    return new Blob(this.mediaChunks, { type: this.mediaMimeType || this.mediaChunks[0]?.type || 'audio/webm' });
  }

  private pickMediaRecorderMimeType(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
  }

  private async requestWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen') ?? null;
    } catch {
      this.wakeLock = null;
    }
  }

  private releaseWakeLock() {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  private setupVisibilityProtection() {
    this.removeVisibilityProtection();
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && !this._paused && this.stream) {
        void this.requestWakeLock();
      }
      if (this.mediaRecorder?.state === 'recording') {
        try {
          this.mediaRecorder.requestData();
        } catch {
          // Best effort flush before the OS throttles the tab.
        }
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener('pagehide', this.visibilityHandler);
  }

  private removeVisibilityProtection() {
    if (!this.visibilityHandler) return;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    window.removeEventListener('pagehide', this.visibilityHandler);
    this.visibilityHandler = null;
  }
}

export const audioRecorder = new AudioRecorder();
