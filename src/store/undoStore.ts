import { create } from 'zustand';

export type UndoActionType = 'copy' | 'cut';

export interface UndoStep {
    type: UndoActionType;
    sourcePaths: string[];
    destPaths: string[];
}

interface UndoState {
    lastStep: UndoStep | null;
    setLastStep: (step: UndoStep | null) => void;
}

export const useUndoStore = create<UndoState>((set) => ({
    lastStep: null,
    setLastStep: (lastStep) => set({ lastStep }),
}));
