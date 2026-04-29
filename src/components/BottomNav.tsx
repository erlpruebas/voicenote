import { Mic, List, Settings } from 'lucide-react';
import { useStore } from '../store/useStore';
import { Tab } from '../types';

const TABS: { id: Tab; label: string; Icon: typeof Mic }[] = [
  { id: 'record',  label: 'Grabar',    Icon: Mic },
  { id: 'history', label: 'Historial', Icon: List },
  { id: 'settings',label: 'Ajustes',   Icon: Settings },
];

export function BottomNav() {
  const { activeTab, setActiveTab, recordingStatus } = useStore();

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-b border-gray-200 dark:border-gray-800 pt-safe">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="leading-none">
          <div className="text-lg font-black tracking-wide text-gray-900 dark:text-white">voice</div>
          <div className="text-lg font-black tracking-wide text-brand-500 -mt-0.5">note</div>
        </div>
        <nav className="flex items-center gap-1">
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            const recording = id === 'record' && (recordingStatus === 'recording' || recordingStatus === 'paused');
            return (
              <button
                key={id}
                className={`relative w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                  active
                    ? 'bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300'
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                title={label}
                onClick={() => setActiveTab(id)}
              >
                <Icon size={22} />
                {recording && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
