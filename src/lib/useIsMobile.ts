'use client';

import { useSyncExternalStore } from 'react';

// SSR-safe mobile detection
export const MD_BREAKPOINT = 768;
const subscribe = (cb: () => void) => { window.addEventListener('resize', cb); return () => window.removeEventListener('resize', cb); };
const getIsMobile = () => window.innerWidth < MD_BREAKPOINT;
const getIsMobileServer = () => false;

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getIsMobile, getIsMobileServer);
}
