import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { RecorderScreen } from './components/RecorderScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { BottomNav } from './components/BottomNav';

export default function App() {
  const activeTab = useStore((s) => s.activeTab);

  // Apply dark mode based on system preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (dark: boolean) =>
      document.documentElement.classList.toggle('dark', dark);
    apply(mq.matches);
    mq.addEventListener('change', (e) => apply(e.matches));
    return () => mq.removeEventListener('change', () => {});
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col max-w-lg mx-auto relative">
      <main className="flex-1 overflow-y-auto px-4">
        {activeTab === 'record'   && <RecorderScreen />}
        {activeTab === 'history'  && <HistoryScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>
      <BottomNav />
    </div>
  );
}
