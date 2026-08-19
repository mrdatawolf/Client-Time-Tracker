'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'ctt_last_tech';

interface LastTechContextValue {
  lastTechId: string;
  setLastTechId: (techId: string) => void;
}

const LastTechContext = createContext<LastTechContextValue>({
  lastTechId: '',
  setLastTechId: () => {},
});

export function useLastTech() {
  return useContext(LastTechContext);
}

export function LastTechProvider({ children }: { children: React.ReactNode }) {
  const [lastTechId, setLastTechIdState] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setLastTechIdState(stored);
  }, []);

  const setLastTechId = useCallback((techId: string) => {
    setLastTechIdState(techId);
    localStorage.setItem(STORAGE_KEY, techId);
  }, []);

  return (
    <LastTechContext.Provider value={{ lastTechId, setLastTechId }}>
      {children}
    </LastTechContext.Provider>
  );
}
