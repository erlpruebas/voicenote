import { useEffect, useRef, useState } from 'react';
import {
  Mic, Square, Pause, Play, FolderOpen, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { audioRecorder } from '../services/audioRecorder';
import { transcribe } from '../services/transcription';
import {
  saveAudio, saveTranscript, pickProjectDir,
  generateTimestamp, formatDuration, isFileSystemSupported,
} from '../services/fileStorage';
import { Recording } from '../types';

export function RecorderScreen() {
  const {
    recordingStatus, setRecordingStatus,
    currentProject, setCurrentProject,
    currentName, setCurrentName,
    elapsedSeconds, setElapsedSeconds,
    autoStopEnabled, setAutoStopEnabled,
    autoStopMinutes, setAutoStopMinutes,
    activeProvider, providers, prompt,
    addRecording, updateRecording, rootFolderName,
  } = useStore();

  const [showSettings, setShowSettings] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingIdRef = useRef<string>('');

  // Initialise name once on mount
  useEffect(() => {
    if (!currentName) setCurrentName(generateTimestamp());
  }, []);

  const isIdle = recordingStatus === 'idle';
  const isRecording = recordingStatus === 'recording';
  const isPaused = recordingStatus === 'paused';
  const isProcessing = recordingStatus === 'processing';

  // ── Timer display ─────────────────────────────────────────────────────────
  const remainingSec = autoStopEnabled
    ? Math.max(0, autoStopMinutes * 60 - elapsedSeconds)
    : elapsedSeconds;

  const timerLabel = formatDuration(remainingSec);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleStart() {
    try {
      const name = currentName || generateTimestamp();
      setCurrentName(name);
      setElapsedSeconds(0);
      setRecordingStatus('recording');
      setStatusMsg('');

      await audioRecorder.start((s) => setElapsedSeconds(s));

      if (autoStopEnabled) {
        autoStopRef.current = setTimeout(handleStop, autoStopMinutes * 60 * 1000);
      }
    } catch (err) {
      setRecordingStatus('idle');
      setStatusMsg(`Error al acceder al micrófono: ${(err as Error).message}`);
    }
  }

  function handlePause() {
    if (isRecording) {
      audioRecorder.pause();
      setRecordingStatus('paused');
    } else if (isPaused) {
      audioRecorder.resume();
      setRecordingStatus('recording');
    }
  }

  async function handleStop() {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    setRecordingStatus('processing');
    setStatusMsg('Guardando audio…');

    let blob: Blob;
    try {
      blob = await audioRecorder.stop();
    } catch (err) {
      setRecordingStatus('idle');
      setStatusMsg(`Error al detener: ${(err as Error).message}`);
      return;
    }

    const duration = elapsedSeconds;
    const project = currentProject || 'General';
    const baseName = currentName || generateTimestamp();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    recordingIdRef.current = id;

    const rec: Recording = {
      id, name: baseName, project,
      timestamp: Date.now(), duration,
      fileSize: blob.size, transcribed: false,
    };
    addRecording(rec);

    // Save MP3
    let audioName = `${baseName}.mp3`;
    try {
      audioName = await saveAudio(blob, project, baseName);
      setStatusMsg('Transcribiendo…');
    } catch (err) {
      setStatusMsg(`Audio guardado localmente. ${(err as Error).message}`);
    }

    // Transcribe
    const provider = providers.find((p) => p.id === activeProvider);
    if (provider?.apiKey) {
      try {
        const text = await transcribe(blob, provider, prompt);
        await saveTranscript(text, project, audioName);
        updateRecording(id, { transcribed: true, name: audioName.replace('.mp3', '') });
        setStatusMsg('¡Transcripción completada!');
      } catch (err) {
        updateRecording(id, {
          transcriptionError: (err as Error).message,
          name: audioName.replace('.mp3', ''),
        });
        setStatusMsg(`Audio guardado. Transcripción falló: ${(err as Error).message}`);
      }
    } else {
      updateRecording(id, { name: audioName.replace('.mp3', '') });
      setStatusMsg('Audio guardado. Configura una API key para transcribir.');
    }

    setRecordingStatus('idle');
    setCurrentName(generateTimestamp());
    setTimeout(() => setStatusMsg(''), 6000);
  }

  async function handlePickProject() {
    try {
      const name = await pickProjectDir();
      setCurrentProject(name);
    } catch { /* user cancelled */ }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="screen flex flex-col gap-6 pb-4">
      {/* Header */}
      <div className="text-center pt-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">VoiceNote</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Grabadora con transcripción IA</p>
      </div>

      {/* Project + Name */}
      <div className="card flex flex-col gap-3">
        {/* Project row */}
        <div>
          <label className="field-label">Proyecto / Carpeta</label>
          <div className="flex gap-2">
            <input
              className="field flex-1"
              placeholder="General"
              value={currentProject}
              onChange={(e) => setCurrentProject(e.target.value)}
              disabled={isRecording || isPaused || isProcessing}
            />
            {isFileSystemSupported() && (
              <button
                className="icon-btn"
                title="Seleccionar carpeta existente"
                onClick={handlePickProject}
                disabled={isRecording || isPaused || isProcessing}
              >
                <FolderOpen size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Name row */}
        <div>
          <label className="field-label">Nombre del archivo</label>
          <input
            className="field"
            placeholder={generateTimestamp()}
            value={currentName}
            onChange={(e) => setCurrentName(e.target.value)}
            disabled={isRecording || isPaused || isProcessing}
          />
        </div>
      </div>

      {/* Timer display */}
      <div className="flex flex-col items-center gap-1">
        <div className={`timer-display ${isRecording ? 'text-brand-500' : isPaused ? 'text-amber-500' : 'text-gray-400 dark:text-gray-600'}`}>
          {timerLabel}
        </div>
        {autoStopEnabled && isRecording && (
          <p className="text-xs text-gray-400">tiempo restante</p>
        )}
        {isPaused && (
          <p className="text-xs text-amber-500 font-medium">PAUSADO</p>
        )}
        {isProcessing && (
          <p className="text-xs text-brand-500 animate-pulse font-medium">{statusMsg || 'Procesando…'}</p>
        )}
      </div>

      {/* Waveform indicator */}
      {isRecording && (
        <div className="flex items-center justify-center gap-1 h-8">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="wave-bar" style={{ animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
      )}

      {/* Main buttons */}
      <div className="flex items-center justify-center gap-6">
        {/* Pause/Resume — only when recording/paused */}
        {(isRecording || isPaused) && (
          <button className="secondary-btn" onClick={handlePause}>
            {isRecording ? <Pause size={22} /> : <Play size={22} />}
          </button>
        )}

        {/* REC / STOP */}
        {isIdle ? (
          <button className="rec-btn" onClick={handleStart}>
            <Mic size={32} />
          </button>
        ) : isProcessing ? (
          <div className="rec-btn opacity-40 cursor-not-allowed">
            <div className="w-8 h-8 border-4 border-white/40 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          <button className="stop-btn" onClick={handleStop}>
            <Square size={28} fill="white" />
          </button>
        )}
      </div>

      {/* Provider indicator */}
      <div className="text-center">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Proveedor: <span className="font-medium text-gray-600 dark:text-gray-300">
            {providers.find((p) => p.id === activeProvider)?.name ?? activeProvider}
          </span>
          {!rootFolderName && isFileSystemSupported() && (
            <span className="ml-2 text-amber-500">· carpeta no configurada</span>
          )}
        </span>
      </div>

      {/* Status message (success/error) */}
      {statusMsg && !isProcessing && (
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 px-4">
          {statusMsg}
        </div>
      )}

      {/* Auto-stop settings */}
      <div className="card">
        <button
          className="flex items-center justify-between w-full text-sm font-medium text-gray-700 dark:text-gray-300"
          onClick={() => setShowSettings((v) => !v)}
        >
          <span className="flex items-center gap-2">
            <Clock size={16} />
            Parada automática
            {autoStopEnabled && (
              <span className="badge">{autoStopMinutes} min</span>
            )}
          </span>
          {showSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showSettings && (
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className={`toggle ${autoStopEnabled ? 'toggle-on' : 'toggle-off'}`}
                onClick={() => setAutoStopEnabled(!autoStopEnabled)}
              >
                <div className="toggle-thumb" />
              </div>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {autoStopEnabled ? 'Activada' : 'Desactivada'}
              </span>
            </label>

            {autoStopEnabled && (
              <div>
                <label className="field-label">Minutos</label>
                <input
                  type="number"
                  min={1}
                  max={480}
                  className="field w-28"
                  value={autoStopMinutes}
                  onChange={(e) => setAutoStopMinutes(Number(e.target.value))}
                  disabled={isRecording || isPaused}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
