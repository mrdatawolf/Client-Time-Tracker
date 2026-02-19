'use client';

import { Loader2 } from 'lucide-react';

interface SyncOverlayProps {
  visible: boolean;
  message?: string;
}

export function SyncOverlay({ visible, message = 'Syncing...' }: SyncOverlayProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-sm font-medium text-gray-700">{message}</p>
      </div>
    </div>
  );
}
