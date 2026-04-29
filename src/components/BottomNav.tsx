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
    <nav className="bottom-nav">
      {TABS.map(({ id, label, Icon }) => {
        const active = activeTab === id;
        const recording = id === 'record' && (recordingStatus === 'recording' || recordingStatus === 'paused');
        return (
          <button
            key={id}
            className={`nav-btn ${active ? 'nav-btn-active' : 'nav-btn-idle'}`}
            onClick={() => setActiveTab(id)}
          >
            <div className="relative">
              <Icon size={22} />
              {recording && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
            </div>
            <span className="text-xs mt-0.5">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
