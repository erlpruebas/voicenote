import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { FolderOpen, Mic, Pause, Play, Square } from 'lucide-react';
import { useStore } from '../store/useStore';
import { audioRecorder } from '../services/audioRecorder';
import { transcribe } from '../services/transcription';
import {
  saveAudio,
  saveCachedAudio,
  saveCachedSession,
  saveCachedTranscript,
  saveTranscript,
  saveSessionFile,
  pickProjectDir,
  generateTimestamp,
  formatDuration,
  isFileSystemSupported,
} from '../services/fileStorage';
import {
  convertBlobToLightMp3,
  convertToLightMp3,
  isMp3Blob,
  isMp3File,
  mediaBaseName,
} from '../services/mediaConversion';
import { estimateGeminiTranscriptionCostUsd, formatUsd } from '../services/cost';
import { Recording, VoiceNoteSession } from '../types';

const LARGE_AUDIO_WARNING_MB = 20;
const ACCEPTED_MEDIA =
  'audio/*,video/*,.mp3,.mp4,.m4a,.ogg,.opus,.wav,.webm,.aac,.3gp,.amr,.flac,.mov,.mkv';

export function RecorderScreen() {
  const {
    recordingStatus, setRecordingStatus,
    currentProject, setCurrentProject,
    currentName, setCurrentName,
    elapsedSeconds, setElapsedSeconds,
    autoStopEnabled, setAutoStopEnabled,
    autoStopMinutes, setAutoStopMinutes,
    recordingGain, setRecordingGain,
    autoGainEnabled,
    mediaServerUrl, mediaServerToken,
    activeProvider, providers, prompt,
    addRecording, updateRecording, rootFolderName,
    projectNames, recordings,
  } = useStore();

  const [statusMsg, setStatusMsg] = useState('');
  const [inputLevel, setInputLevel] = useState(0);
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
  const projectOptions = Array.from(new Set([
    'General',
    currentProject,
    ...projectNames,
    ...recordings.map((r) => r.project).filter(Boolean),
  ].filter(Boolean)));

  useEffect(() => {
    audioRecorder.setGain(recordingGain);
  }, [recordingGain]);

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
      setInputLevel(0);
      stoppingRef.current = false;
      audioRecorder.setGain(recordingGain);

      await audioRecorder.start({
        autoGain: autoGainEnabled,
        onDuration: (s) => setElapsedSeconds(s),
        onLevel: (level) => setInputLevel((prev) => prev * 0.65 + level * 0.35),
        onGain: (gain) => setRecordingGain(gain),
      });
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
    setStatusMsg('Preparando audio...');

    let blob: Blob;
    try {
      blob = await audioRecorder.stop();
    } catch (err) {
      setRecordingStatus('idle');
      setInputLevel(0);
      stoppingRef.current = false;
      setStatusMsg(`Error al detener: ${(err as Error).message}`);
      return;
    }

    const baseName = currentName || generateTimestamp();
    try {
      const mp3Blob = await prepareMp3Blob(blob, `${baseName}.webm`, 'Convirtiendo grabacion a MP3 ligero...');
      await processAudioBlob(mp3Blob, elapsedSeconds, baseName, true);
    } catch (err) {
      setRecordingStatus('idle');
      setInputLevel(0);
      stoppingRef.current = false;
      setStatusMsg(`No se pudo preparar la grabacion: ${(err as Error).message}`);
    }
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const baseName = mediaBaseName(file.name) || generateTimestamp();
    setCurrentName(baseName);
    setElapsedSeconds(0);
    setRecordingStatus('processing');
    setStatusMsg(isMp3File(file) ? 'Cargando MP3...' : 'Convirtiendo archivo a MP3 ligero...');

    try {
      const mp3Blob = isMp3File(file)
        ? file
        : await convertToLightMp3(file, mediaServerUrl, mediaServerToken);

      if (mp3Blob.size > LARGE_AUDIO_WARNING_MB * 1024 * 1024) {
        const ok = window.confirm(
          `El MP3 pesa ${(mp3Blob.size / (1024 * 1024)).toFixed(1)} MB. ` +
          `Algunos proveedores rechazan archivos de mas de ${LARGE_AUDIO_WARNING_MB} MB. ` +
          'Puedes guardarlo e intentar transcribirlo igualmente?'
        );
        if (!ok) {
          setRecordingStatus('idle');
          setStatusMsg('');
          return;
        }
      }

      const duration = await getAudioDuration(mp3Blob).catch(() => 0);
      await processAudioBlob(mp3Blob, duration, baseName, true);
    } catch (err) {
      setRecordingStatus('idle');
      stoppingRef.current = false;
      setStatusMsg(`No se pudo preparar el archivo: ${(err as Error).message}`);
    }
  }

  async function processAudioBlob(blob: Blob, duration: number, baseName: string, autoTranscribe: boolean) {
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

    if (autoTranscribe) {
      const provider = providers.find((p) => p.id === activeProvider);
      if (provider?.apiKey) {
        setStatusMsg('Transcribiendo...');
        try {
          const text = await transcribe(blob, provider, prompt);
          await saveTranscript(text, project, audioName);
          await saveCachedTranscript(id, text);
          const session: VoiceNoteSession = {
            version: 1,
            id,
            name: audioName.replace(/\.mp3$/i, ''),
            project,
            audioFile: audioName,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            duration,
            segments: [{
              id: 'seg_0001',
              start: 0,
              end: duration,
              rawText: text,
              editedText: text,
              highlighted: false,
              note: '',
              status: 'done',
            }],
          };
          const sessionJson = JSON.stringify(session, null, 2);
          const sessionName = await saveSessionFile(sessionJson, project, audioName);
          await saveCachedSession(id, sessionJson);
          const cost = provider.id === 'gemini'
            ? estimateGeminiTranscriptionCostUsd(duration, text)
            : undefined;
          updateRecording(id, {
            transcribed: true,
            sessionName,
            segmentCount: 1,
            transcriptionError: undefined,
            transcriptionCostUsd: cost,
          });
          setStatusMsg(cost
            ? `Transcripcion completada. Coste aprox. ${formatUsd(cost)}.`
            : 'Transcripcion completada.');
        } catch (err) {
          updateRecording(id, { transcriptionError: (err as Error).message });
          setStatusMsg(`Audio guardado. Transcripcion fallo: ${(err as Error).message}`);
        }
      } else {
        setStatusMsg('Audio guardado. Configura una API key para transcribir.');
      }
    }

    setRecordingStatus('idle');
    setCurrentName(generateTimestamp());
    setInputLevel(0);
    stoppingRef.current = false;
    setTimeout(() => setStatusMsg(''), 6000);
  }

  async function prepareMp3Blob(blob: Blob, fileName: string, message: string): Promise<Blob> {
    if (isMp3Blob(blob, fileName)) return blob;

    setStatusMsg(message);
    try {
      return await convertBlobToLightMp3(blob, fileName, mediaServerUrl, mediaServerToken);
    } catch (err) {
      const fallback = audioRecorder.getFallbackMp3Blob();
      if (fallback && fallback.size > 0) {
        setStatusMsg('Servidor no disponible. Usando MP3 local de respaldo...');
        return fallback;
      }
      throw err;
    }
  }

  function getAudioDuration(file: Blob): Promise<number> {
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
    <div className="screen flex flex-col gap-5 pb-4">
      <div className="card flex flex-col gap-3">
        <div>
          <label className="field-label">Proyecto / Carpeta</label>
          <div className="flex gap-2">
            <input
              list="project-options"
              className="field flex-1"
              placeholder="General"
              value={currentProject}
              onChange={(e) => setCurrentProject(e.target.value)}
              disabled={isRecording || isPaused || isProcessing}
            />
            <datalist id="project-options">
              {projectOptions.map((project) => (
                <option key={project} value={project} />
              ))}
            </datalist>
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

      {(isRecording || isPaused) && (
        <div className="px-2 flex flex-col gap-2">
          <div className="h-8 flex items-center gap-3">
            <div className="relative h-4 flex-1 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800">
              <div className="absolute inset-0 grid grid-cols-[1fr_0.45fr_0.28fr]">
                <div className="bg-green-500" />
                <div className="bg-yellow-400" />
                <div className="bg-red-500" />
              </div>
              <div
                className="absolute inset-y-0 right-0 bg-white/75 dark:bg-gray-950/75 transition-[width] duration-100"
                style={{ width: `${Math.max(0, 100 - inputLevel * 100)}%` }}
              />
              <div
                className="absolute top-0 h-full w-1 -ml-0.5 bg-white shadow transition-[left] duration-100"
                style={{ left: `${Math.min(100, inputLevel * 100)}%` }}
              />
            </div>
            <span className="w-9 text-right text-xs font-mono text-gray-400">
              {Math.round(inputLevel * 100)}
            </span>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
            <span>Ganancia {recordingGain.toFixed(1)}x</span>
            {autoGainEnabled && <span className="badge">Auto</span>}
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-6">
        {isIdle && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_MEDIA}
              className="hidden"
              onChange={handleFileSelected}
            />
            <button
              className="secondary-btn"
              title="Cargar audio o video"
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

      {statusMsg && !isProcessing && (
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 px-4">
          {statusMsg}
        </div>
      )}

      {!isRecording && !isPaused && (
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
      )}

      <div className="mt-auto text-center">
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
    </div>
  );
}
