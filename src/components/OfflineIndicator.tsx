import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+68px)] lg:bottom-4 left-1/2 -translate-x-1/2 z-[60] max-w-[calc(100vw-24px)] rounded-xl bg-[#1F1510] border border-amber-400/50 px-3.5 py-2 shadow-2xl flex items-center gap-2 text-xs font-semibold text-amber-200"
    >
      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
      <span className="truncate">Offline — Waiting to reconnect to SW88 server</span>
    </div>
  );
}
