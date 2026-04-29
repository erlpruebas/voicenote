import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { FolderOpen, Mic, Pause, Play, Square } from 'lucide-react';
import { useStore } from '../store/useStore';
import { audioRecorder } from '../services/audioRecorder';
import {
  saveAudio,
  saveCachedAudio,
  pickProjectDir,
  generateTimestamp,
  formatDuration,
  isFileSystemSupported,
} from '../services/fileStorage';
import { Recording } from '../types';

const LARGE_AUDIO_WARNING_MB = 20;

export function RecorderScreen() {
  const {
    recordingStatus, setRecordingStatus,
    currentProject, setCurrentProject,
    currentName, setCurrentName,
    elapsedSeconds, setElapsedSeconds,
    autoStopEnabled, setAutoStopEnabled,
    autoStopMinutes, setAutoStopMinutes,
    activeProvider, providers,
    addRecording, updateRecording, rootFolderName,
  } = useStore();

  const [statusMsg, setStatusMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stoppingRef = useRef(false);

  useEffect(() => {
    if (!currentName) setCurrentName(generateTimestamp());
  }, []);

  const isIdle = recordingStatus === 'idle';
  const isRecording = recordingStatus === 'recording';
  const isPaused = recordingStatus === 'paused';
  const isProcessing = recordingStatus === 'processing';

  const remainingSec = autoStopEnabled
    ? Math.max(0, autoStopMinutes * 60 - elapsedSeconds)
    : elapsedSeconds;
  const timerLabel = formatDuration(remainingSec);

  useEffect(() => {
    if (
      isRecording &&
      autoStopEnabled &&
      elapsedSeconds >= autoStopMinutes * 60 &&
      !stoppingRef.current
    ) {
      void handleStop();
    }
  }, [isRecording, autoStopEnabled, autoStopMinutes, elapsedSeconds]);

  async function handleStart() {
    try {
      const name = currentName || generateTimestamp();
      setCurrentName(name);
      setElapsedSeconds(0);
      setRecordingStatus('recording');
      setStatusMsg('');
      stoppingRef.current = false;

      await audioRecorder.start((s) => setElapsedSeconds(s));
    } catch (err) {
      setRecordingStatus('idle');
      setStatusMsg(`Error al acceder al microfono: ${(err as Error).message}`);
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
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setRecordingStatus('processing');
    setStatusMsg('Guardando audio...');

    let blob: Blob;
    try {
      blob = await audioRecorder.stop();
    } catch (err) {
      setRecordingStatus('idle');
      stoppingRef.current = false;
      setStatusMsg(`Error al detener: ${(err as Error).message}`);
      return;
    }

    await processAudioBlob(blob, elapsedSeconds, currentName || generateTimestamp());
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!/\.mp3$/i.test(file.name) && file.type !== 'audio/mpeg') {
      setStatusMsg('Selecciona un archivo MP3.');
      return;
    }

    if (file.size > LARGE_AUDIO_WARNING_MB * 1024 * 1024) {
      const ok = window.confirm(
        `El MP3 pesa ${(file.size / (1024 * 1024)).toFixed(1)} MB. ` +
        `Algunos proveedores rechazan archivos de mas de ${LARGE_AUDIO_WARNING_MB} MB. ` +
        'Puedes guardarlo e intentar transcribirlo igualmente?'
      );
      if (!ok) return;
    }

    const baseName = file.name.replace(/\.mp3$/i, '') || generateTimestamp();
    setCurrentName(baseName);
    setElapsedSeconds(0);
    setRecordingStatus('processing');
    setStatusMsg('Cargando MP3...');

    const duration = await getAudioDuration(file).catch(() => 0);
    await processAudioBlob(file, duration, baseName);
  }

  async function processAudioBlob(blob: Blob, duration: number, baseName: string) {
    const project = currentProject || 'General';
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      await saveCachedAudio(id, blob);
    } catch {
      // Disk save below remains the primary user-visible copy.
    }

    let audioName = `${baseName}.mp3`;
    try {
      audioName = await saveAudio(blob, project, baseName);
      setStatusMsg('Audio guardado. Puedes transcribirlo desde Historial.');
    } catch (err) {
      setStatusMsg(`Audio guardado en la app. ${(err as Error).message}`);
    }

    const rec: Recording = {
      id,
      name: audioName.replace(/\.mp3$/i, ''),
      audioName,
      project,
      timestamp: Date.now(),
      duration,
      fileSize: blob.size,
      transcribed: false,
    };
    addRecording(rec);
    updateRecording(id, { audioName, name: audioName.replace(/\.mp3$/i, '') });

    setRecordingStatus('idle');
    setCurrentName(generateTimestamp());
    stoppingRef.current = false;
    setTimeout(() => setStatusMsg(''), 6000);
  }

  function getAudioDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const audio = document.createElement('audio');
      const url = URL.createObjectURL(file);
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo leer la duracion del audio'));
      };
      audio.src = url;
    });
  }

  async function handlePickProject() {
    try {
      const name = await pickProjectDir();
      setCurrentProject(name);
    } catch {
      // User cancelled.
    }
  }

  return (
    <div className="screen flex flex-col gap-6 pb-4">
      <div className="text-center pt-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">VoiceNote</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Grabadora con transcripcion IA
        </p>
      </div>

      <div className="card flex flex-col gap-3">
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
          <p className="text-xs text-brand-500 animate-pulse font-medium">
            {statusMsg || 'Procesando...'}
          </p>
        )}
      </div>

      {isRecording && (
        <div className="flex items-center justify-center gap-1 h-8">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="wave-bar" style={{ animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-6">
        {isIdle && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,.mp3"
              className="hidden"
              onChange={handleFileSelected}
            />
            <button
              className="secondary-btn"
              title="Cargar archivo MP3"
              onClick={() => fileInputRef.current?.click()}
            >
              <FolderOpen size={22} />
            </button>
          </>
        )}

        {(isRecording || isPaused) && (
          <button className="secondary-btn" onClick={handlePause}>
            {isRecording ? <Pause size={22} /> : <Play size={22} />}
          </button>
        )}

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

      <div className="text-center">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Proveedor:{' '}
          <span className="font-medium text-gray-600 dark:text-gray-300">
            {providers.find((p) => p.id === activeProvider)?.name ?? activeProvider}
          </span>
          {!rootFolderName && isFileSystemSupported() && (
            <span className="ml-2 text-amber-500">carpeta no configurada</span>
          )}
        </span>
      </div>

      {statusMsg && !isProcessing && (
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 px-4">
          {statusMsg}
        </div>
      )}

      <div className="card flex items-center justify-between gap-3">
        <label className="flex items-center gap-3 cursor-pointer min-w-0">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            checked={autoStopEnabled}
            onChange={(e) => setAutoStopEnabled(e.target.checked)}
            disabled={isRecording || isPaused || isProcessing}
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Parada automatica
          </span>
        </label>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="number"
            min={1}
            max={480}
            className="field w-20 text-center"
            value={autoStopMinutes}
            onChange={(e) => setAutoStopMinutes(Math.max(1, Number(e.target.value) || 1))}
            disabled={!autoStopEnabled || isRecording || isPaused || isProcessing}
          />
          <span className="text-sm text-gray-500 dark:text-gray-400">min</span>
        </div>
      </div>
    </div>
  );
}
