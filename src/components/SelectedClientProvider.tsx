'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'ctt_selected_client';

interface SelectedClientContextValue {
  selectedClientId: string;
  setSelectedClientId: (clientId: string) => void;
}

const SelectedClientContext = createContext<SelectedClientContextValue>({
  selectedClientId: '',
  setSelectedClientId: () => {},
});

export function useSelectedClient() {
  return useContext(SelectedClientContext);
}

export function SelectedClientProvider({ children }: { children: React.ReactNode }) {
  const [selectedClientId, setSelectedClientIdState] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setSelectedClientIdState(stored);
  }, []);

  const setSelectedClientId = useCallback((clientId: string) => {
    setSelectedClientIdState(clientId);
    localStorage.setItem(STORAGE_KEY, clientId);
  }, []);

  return (
    <SelectedClientContext.Provider value={{ selectedClientId, setSelectedClientId }}>
      {children}
    </SelectedClientContext.Provider>
  );
}
