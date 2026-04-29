import { useEffect, useRef, useState } from 'react';
import {
  X, Play, Pause, SkipBack, SkipForward, RefreshCw, ChevronLeft, ChevronRight,
  FileText, Volume2, Loader2,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  loadAudio,
  loadCachedAudio,
  loadTranscript,
  loadCachedTranscript,
  saveCachedTranscript,
  formatDuration,
} from '../services/fileStorage';
import { transcribe } from '../services/transcription';
import { saveTranscript } from '../services/fileStorage';
import { estimateGeminiTranscriptionCostUsd, formatUsd } from '../services/cost';

type Tab = 'audio' | 'transcript';

export function PlayerModal() {
  const { selectedRecording, setSelectedRecording, recordings, providers, activeProvider, prompt, updateRecording } =
    useStore();

  const [tab, setTab] = useState<Tab>('audio');
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [retranscribing, setRetranscribing] = useState(false);
  const [error, setError] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string>('');

  const rec = selectedRecording;
  const currentIndex = rec ? recordings.findIndex((r) => r.id === rec.id) : -1;
  const prevRecording = currentIndex > 0 ? recordings[currentIndex - 1] : null;
  const nextRecording = currentIndex >= 0 && currentIndex < recordings.length - 1
    ? recordings[currentIndex + 1]
    : null;

  useEffect(() => {
    if (!rec) return;
    setTab('audio');
    setPlaying(false);
    setCurrentTime(0);
    setTranscript(null);
    setError('');

    const audioName = rec.audioName ?? `${rec.name}.mp3`;
    loadAudio(rec.project, audioName).then((blob) => blob ?? loadCachedAudio(rec.id)).then((blob) => {
      if (!blob) return;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = blobUrlRef.current;
        audioRef.current.load();
      }
    });

    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [rec?.id]);

  useEffect(() => {
    if (tab === 'transcript' && rec && !transcript) {
      setLoadingTranscript(true);
      loadTranscript(rec.project, rec.audioName ?? `${rec.name}.mp3`)
        .then((t) => t ?? loadCachedTranscript(rec.id))
        .then((t) => setTranscript(t ?? ''))
        .finally(() => setLoadingTranscript(false));
    }
  }, [tab, rec?.id]);

  if (!rec) return null;

  // ── Audio events ──────────────────────────────────────────────────────────

  function onTimeUpdate() {
    setCurrentTime(audioRef.current?.currentTime ?? 0);
  }
  function onLoadedMetadata() {
    setDuration(audioRef.current?.duration ?? 0);
  }
  function onEnded() {
    setPlaying(false);
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  }

  function seek(delta: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + delta));
  }

  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  }

  // ── Retranscribe ──────────────────────────────────────────────────────────

  async function handleRetranscribe() {
    const provider = providers.find((p) => p.id === activeProvider);
    if (!provider?.apiKey) {
      setError('Configura una API key en Ajustes.');
      return;
    }

    if (!rec) return;
    const r = rec;
    setRetranscribing(true);
    setError('');
    try {
      const audioName = r.audioName ?? `${r.name}.mp3`;
      const blob = await loadAudio(r.project, audioName) ?? await loadCachedAudio(r.id);
      if (!blob) throw new Error('No se encontró el archivo de audio.');
      const text = await transcribe(blob, provider, prompt);
      await saveTranscript(text, r.project, audioName);
      await saveCachedTranscript(r.id, text);
      const cost = provider.id === 'gemini'
        ? estimateGeminiTranscriptionCostUsd(r.duration, text)
        : undefined;
      setTranscript(text);
      updateRecording(r.id, {
        transcribed: true,
        transcriptionError: undefined,
        transcriptionCostUsd: cost,
      });
      setSelectedRecording({ ...r, transcribed: true, transcriptionError: undefined, transcriptionCostUsd: cost });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetranscribing(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
      />

      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-safe pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
        <button
          className="icon-btn"
          onClick={() => { audioRef.current?.pause(); setSelectedRecording(null); }}
        >
          <X size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 dark:text-white truncate text-sm">{rec.name}</p>
          <p className="text-xs text-gray-400">{rec.project} · {new Date(rec.timestamp).toLocaleDateString('es-ES')}</p>
        </div>
        <button
          className="icon-btn disabled:opacity-30"
          title="Anterior"
          disabled={!prevRecording}
          onClick={() => prevRecording && setSelectedRecording(prevRecording)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="icon-btn disabled:opacity-30"
          title="Siguiente"
          disabled={!nextRecording}
          onClick={() => nextRecording && setSelectedRecording(nextRecording)}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 dark:border-gray-800">
        {(['audio', 'transcript'] as const).map((t) => (
          <button
            key={t}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors
              ${tab === t
                ? 'text-brand-600 border-b-2 border-brand-500'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
            onClick={() => setTab(t)}
          >
            {t === 'audio' ? 'Reproducción' : 'Transcripción'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'audio' && (
          <div className="flex flex-col items-center gap-8 px-6 py-10">
            {/* Album art placeholder */}
            <div className="w-44 h-44 rounded-3xl bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center shadow-xl">
              <Volume2 size={56} className="text-white/80" />
            </div>

            <div className="text-center">
              <p className="font-bold text-gray-900 dark:text-white text-lg">{rec.name}</p>
              <p className="text-gray-400 text-sm">{rec.project}</p>
              {rec.transcriptionCostUsd !== undefined && (
                <p className="text-xs text-gray-400 mt-1">
                  Coste aprox. {formatUsd(rec.transcriptionCostUsd)}
                </p>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-full flex flex-col gap-2">
              <input
                type="range"
                min={0}
                max={duration || rec.duration}
                step={0.1}
                value={currentTime}
                onChange={onSeek}
                className="progress-slider w-full"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>{formatDuration(currentTime)}</span>
                <span>{formatDuration(duration || rec.duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-8">
              <button className="icon-btn-lg" onClick={() => seek(-10)} title="−10s">
                <SkipBack size={26} />
              </button>
              <button className="play-btn" onClick={togglePlay}>
                {playing ? <Pause size={30} fill="white" /> : <Play size={30} fill="white" />}
              </button>
              <button className="icon-btn-lg" onClick={() => seek(10)} title="+10s">
                <SkipForward size={26} />
              </button>
            </div>

            <button
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
              onClick={async () => {
                await handleRetranscribe();
                setTab('transcript');
              }}
              disabled={retranscribing}
            >
              {retranscribing ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
              {rec.transcribed ? 'Transcribir de nuevo' : 'Transcribir'}
            </button>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl p-3 w-full">
                {error}
              </p>
            )}
          </div>
        )}

        {tab === 'transcript' && (
          <div className="flex flex-col gap-4 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <FileText size={16} /> Transcripción
              </h3>
              <button
                className="flex items-center gap-1.5 text-sm text-brand-500 font-medium disabled:opacity-50"
                onClick={handleRetranscribe}
                disabled={retranscribing}
              >
                {retranscribing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {rec.transcribed ? 'Reintentar' : 'Transcribir'}
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">{error}</p>
            )}

            {loadingTranscript ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-brand-400" />
              </div>
            ) : transcript ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                  {transcript}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <FileText size={36} className="text-gray-300 dark:text-gray-700" />
                <p className="text-sm text-gray-400">
                  {rec.transcriptionError
                    ? `Error previo: ${rec.transcriptionError}`
                    : 'Sin transcripción. Pulsa "Transcribir" para empezar.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
