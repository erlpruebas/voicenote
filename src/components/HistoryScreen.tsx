import { useState } from 'react';
import { Mic2, FileText, Trash2, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatDuration, formatSize } from '../services/fileStorage';
import { formatUsd } from '../services/cost';

export function HistoryScreen() {
  const { recordings, removeRecording, setSelectedRecording, setActiveTab } = useStore();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Group by project
  const groups = recordings.reduce<Record<string, typeof recordings>>((acc, r) => {
    const p = r.project || 'General';
    if (!acc[p]) acc[p] = [];
    acc[p].push(r);
    return acc;
  }, {});

  if (recordings.length === 0) {
    return (
      <div className="screen flex flex-col items-center justify-center gap-4 text-center">
        <Mic2 size={48} className="text-gray-300 dark:text-gray-700" />
        <p className="text-gray-500 dark:text-gray-400">
          Aún no hay grabaciones.<br />
          Pulsa el micrófono para empezar.
        </p>
        <button className="btn-primary" onClick={() => setActiveTab('record')}>
          Ir a grabar
        </button>
      </div>
    );
  }

  return (
    <div className="screen flex flex-col gap-4 pb-4">
      <div className="flex items-baseline justify-between pt-2">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Historial</h2>
        <span className="text-sm text-gray-400">{recordings.length} grabaciones</span>
      </div>

      {Object.entries(groups).map(([project, recs]) => (
        <div key={project} className="flex flex-col gap-1">
          {/* Project header */}
          <button
            className="flex items-center gap-2 px-1 py-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300"
            onClick={() => setCollapsed((c) => ({ ...c, [project]: !c[project] }))}
          >
            {collapsed[project] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            <span>{project}</span>
            <span className="text-xs font-normal text-gray-400">({recs.length})</span>
          </button>

          {!collapsed[project] && (
            <div className="flex flex-col gap-2 ml-2">
              {recs.map((rec) => (
                <div
                  key={rec.id}
                  className="card flex items-start justify-between gap-3 cursor-pointer hover:ring-2 ring-brand-400 transition-all"
                  onClick={() => {
                    setSelectedRecording(rec);
                    setActiveTab('history');
                  }}
                >
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-gray-800 dark:text-gray-100 truncate text-sm">
                        {rec.name}
                      </span>
                      {rec.transcribed && (
                        <FileText size={12} className="text-brand-500 shrink-0" />
                      )}
                      {rec.transcriptionError && (
                        <AlertCircle size={12} className="text-amber-500 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{new Date(rec.timestamp).toLocaleDateString('es-ES', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}</span>
                      <span>·</span>
                      <span>{formatDuration(rec.duration)}</span>
                      <span>·</span>
                      <span>{formatSize(rec.fileSize)}</span>
                      {rec.transcriptionCostUsd !== undefined && (
                        <>
                          <span>Â·</span>
                          <span>{formatUsd(rec.transcriptionCostUsd)}</span>
                        </>
                      )}
                    </div>
                    {rec.transcriptionError && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 truncate">
                        Error: {rec.transcriptionError}
                      </p>
                    )}
                  </div>

                  {/* Delete button */}
                  <button
                    className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(rec.id);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/50">
          <div className="card w-full max-w-sm flex flex-col gap-4">
            <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">
              ¿Eliminar este registro del historial?
              <br />
              <span className="font-normal text-gray-500 text-xs">
                (El archivo de audio permanece en disco)
              </span>
            </p>
            <div className="flex gap-3">
              <button
                className="btn-secondary flex-1"
                onClick={() => setConfirmDelete(null)}
              >
                Cancelar
              </button>
              <button
                className="btn-danger flex-1"
                onClick={() => {
                  removeRecording(confirmDelete);
                  setConfirmDelete(null);
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Player modal */}
      <PlayerModal />
    </div>
  );
}

// ── Inline player modal ─────────────────────────────────────────────────────

import { PlayerModal } from './PlayerModal';
