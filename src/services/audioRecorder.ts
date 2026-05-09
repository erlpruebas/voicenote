// Voice-optimised settings: 16 kHz mono 32 kbps ≈ 13.7 MB/hr
// (stays under Gemini's 20 MB inline limit for recordings up to ~85 min)
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
  private encoder: Mp3Encoder | null = null;
  private mp3Chunks: Int8Array[] = [];
  private startTime = 0;
  private pausedAt = 0;
  private totalPausedMs = 0;
  private _paused = false;
  private wakeLock: WakeLockSentinel | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private onDuration: DurationCallback | null = null;
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

  async start(options: RecorderOptions): Promise<void> {
    this.onDuration = options.onDuration;
    this.onLevel = options.onLevel ?? null;
    this.onGain = options.onGain ?? null;
    this.onSegment = options.onSegment ?? null;
    this.autoGain = options.autoGain ?? false;
    this.silenceSeconds = options.silenceSeconds ?? 2.5;
    this.maxSegmentSeconds = options.maxSegmentSeconds ?? 8;
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
      const int16 = this.toInt16(pcm);
      const chunk = this.encoder!.encodeBuffer(int16);
      if (chunk.length > 0) this.mp3Chunks.push(new Int8Array(chunk));
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.timerInterval = setInterval(() => {
      if (!this._paused) options.onDuration(this.elapsed());
    }, 500);

    // Wake Lock — keep screen on; if denied, recording still continues
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen') ?? null;
    } catch {
      this.wakeLock = null;
    }

    this.setupMediaSession();
  }

  pause(): void {
    this._paused = true;
    this.pausedAt = Date.now();
    if ('mediaSession' in navigator)
      navigator.mediaSession.playbackState = 'paused';
  }

  resume(): void {
    if (this.pausedAt) this.totalPausedMs += Date.now() - this.pausedAt;
    this._paused = false;
    this.pausedAt = 0;
    if ('mediaSession' in navigator)
      navigator.mediaSession.playbackState = 'playing';
  }

  async stop(): Promise<Blob> {
    clearInterval(this.timerInterval!);
    this.timerInterval = null;

    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());

    const tail = this.encoder?.flush();
    if (tail && tail.length > 0) this.mp3Chunks.push(new Int8Array(tail));
    this.finalizeSegment(this.elapsed());

    await this.audioContext?.close();
    this.wakeLock?.release().catch(() => {});

    if ('mediaSession' in navigator)
      navigator.mediaSession.playbackState = 'none';

    const blob = new Blob(this.mp3Chunks as unknown as BlobPart[], { type: 'audio/mpeg' });

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
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
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
      title: 'Grabando…',
      artist: 'VoiceNote',
    });
    navigator.mediaSession.playbackState = 'playing';
  }
}

export const audioRecorder = new AudioRecorder();
