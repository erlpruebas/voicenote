import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { FileText, FolderOpen, Loader2, Mic, Pause, Play, Square } from 'lucide-react';
import { useStore } from '../store/useStore';
import { audioRecorder } from '../services/audioRecorder';
import { transcribe } from '../services/transcription';
import {
  saveAudio,
  saveCachedAudio,
  saveCachedSegmentAudio,
  saveCachedSession,
  saveCachedTranscript,
  saveTranscript,
  saveSessionFile,
  pickProjectDir,
  generateTimestamp,
  formatDuration,
  isFileSystemSupported,
} from '../services/fileStorage';
import { estimateGeminiTranscriptionCostUsd, formatUsd } from '../services/cost';
import { Recording, TranscriptSegment, VoiceNoteSession } from '../types';

const LARGE_AUDIO_WARNING_MB = 20;

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
    activeProvider, providers, prompt,
    addRecording, updateRecording, rootFolderName,
    projectNames, recordings,
  } = useStore();

  const [statusMsg, setStatusMsg] = useState('');
  const [inputLevel, setInputLevel] = useState(0);
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stoppingRef = useRef(false);
  const activeIdRef = useRef('');
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);

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
    liveSegmentsRef.current = liveSegments;
  }, [liveSegments]);

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
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeIdRef.current = id;
      setCurrentName(name);
      setElapsedSeconds(0);
      setRecordingStatus('recording');
      setStatusMsg('');
      setInputLevel(0);
      setLiveSegments([]);
      stoppingRef.current = false;
      audioRecorder.setGain(recordingGain);

      await audioRecorder.start({
        autoGain: autoGainEnabled,
        silenceSeconds: 2.5,
        onDuration: (s) => setElapsedSeconds(s),
        onLevel: (level) => setInputLevel((prev) => prev * 0.65 + level * 0.35),
        onGain: (gain) => setRecordingGain(gain),
        onSegment: (segment) => void handleLiveSegment(id, segment),
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
    setStatusMsg('Guardando audio...');

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

    await processAudioBlob(blob, elapsedSeconds, currentName || generateTimestamp(), true, activeIdRef.current);
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
    await processAudioBlob(file, duration, baseName, false);
  }

  async function handleLiveSegment(
    recordingId: string,
    segment: { id: string; start: number; end: number; blob: Blob }
  ) {
    const item: TranscriptSegment = {
      id: segment.id,
      start: segment.start,
      end: segment.end,
      rawText: '',
      editedText: '',
      highlighted: false,
      note: '',
      status: 'pending',
    };

    setLiveSegments((items) => [...items, item]);
    await saveCachedSegmentAudio(recordingId, segment.id, segment.blob).catch(() => {});

    const provider = providers.find((p) => p.id === activeProvider);
    if (!provider?.apiKey) return;

    setLiveSegments((items) => items.map((s) => (
      s.id === segment.id ? { ...s, status: 'transcribing' } : s
    )));

    try {
      const context = liveSegmentsRef.current
        .slice(-4)
        .map((s) => s.editedText || s.rawText)
        .filter(Boolean)
        .join('\n');
      const livePrompt = context
        ? `${prompt}\n\nContexto anterior para mantener continuidad terminologica, sin inventar contenido:\n${context}`
        : prompt;
      const text = await transcribe(segment.blob, provider, livePrompt);
      setLiveSegments((items) => items.map((s) => (
        s.id === segment.id
          ? { ...s, rawText: text.trim(), editedText: text.trim(), status: 'done' }
          : s
      )));
    } catch (err) {
      setLiveSegments((items) => items.map((s) => (
        s.id === segment.id
          ? { ...s, status: 'error', error: (err as Error).message }
          : s
      )));
    }
  }

  async function processAudioBlob(blob: Blob, duration: number, baseName: string, autoTranscribe: boolean, existingId?: string) {
    const project = currentProject || 'General';
    const id = existingId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const segments = liveSegmentsRef.current;

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
      segmentCount: segments.length,
    };
    addRecording(rec);
    updateRecording(id, { audioName, name: audioName.replace(/\.mp3$/i, '') });

    let transcriptText = segments
      .map((s) => s.editedText || s.rawText)
      .filter(Boolean)
      .join('\n\n');
    const hasLiveTranscript = transcriptText.trim().length > 0;

    if (hasLiveTranscript) {
      await saveTranscript(transcriptText, project, audioName);
      await saveCachedTranscript(id, transcriptText);
      const session: VoiceNoteSession = {
        version: 1,
        id,
        name: audioName.replace(/\.mp3$/i, ''),
        project,
        audioFile: audioName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        duration,
        segments,
      };
      const sessionJson = JSON.stringify(session, null, 2);
      const sessionName = await saveSessionFile(sessionJson, project, audioName);
      await saveCachedSession(id, sessionJson);
      updateRecording(id, {
        transcribed: true,
        sessionName,
        segmentCount: segments.length,
      });
      setStatusMsg(`Guardado con ${segments.length} segmentos transcritos.`);
    } else if (autoTranscribe) {
      const provider = providers.find((p) => p.id === activeProvider);
      if (provider?.apiKey) {
        setStatusMsg('Transcribiendo...');
        try {
          const text = await transcribe(blob, provider, prompt);
          transcriptText = text;
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
    setLiveSegments([]);
    activeIdRef.current = '';
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

      {statusMsg && !isProcessing && (
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 px-4">
          {statusMsg}
        </div>
      )}

      {(isRecording || isPaused || liveSegments.length > 0) && (
        <div className="card flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="section-title flex items-center gap-2">
              <FileText size={14} /> Transcripcion en vivo
            </h3>
            <span className="text-xs text-gray-400">{liveSegments.length} segmentos</span>
          </div>
          {liveSegments.length === 0 ? (
            <p className="text-sm text-gray-400">Habla y hare cortes automaticos cuando haya pausas.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto flex flex-col gap-2 pr-1">
              {liveSegments.map((segment) => (
                <div key={segment.id} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400 mb-1">
                    <span>{formatDuration(segment.start)} - {formatDuration(segment.end)}</span>
                    {segment.status === 'transcribing' && (
                      <span className="flex items-center gap-1 text-brand-500">
                        <Loader2 size={11} className="animate-spin" /> transcribiendo
                      </span>
                    )}
                    {segment.status === 'error' && <span className="text-amber-500">error</span>}
                  </div>
                  <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {segment.editedText || segment.rawText || 'Pendiente de transcripcion...'}
                  </p>
                </div>
              ))}
            </div>
          )}
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
