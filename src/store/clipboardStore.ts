import { create } from 'zustand';

interface ClipboardState {
    paths: string[];
    action: 'copy' | 'cut' | null;
    setClipboard: (paths: string[], action: 'copy' | 'cut') => void;
    clearClipboard: () => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
    paths: [],
    action: null,
    setClipboard: (paths, action) => set({ paths, action }),
    clearClipboard: () => set({ paths: [], action: null }),
}));
