import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentEntry {
  path: string;
  visitedAt: number; // epoch ms
}

const MAX_RECENT = 20;

interface RecentStore {
  recents: RecentEntry[];
  addRecent: (path: string) => void;
  removeRecent: (path: string) => void;
  clearRecent: () => void;
}

export const useRecentStore = create<RecentStore>()(
  persist(
    (set) => ({
      recents: [],

      addRecent: (path) =>
        set((s) => {
          if (!path || path.trim() === '') return s;
          // Deduplicate: remove existing entry for this path, then prepend
          const filtered = s.recents.filter((r) => r.path !== path);
          const next = [{ path, visitedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
          return { recents: next };
        }),

      removeRecent: (path) =>
        set((s) => ({ recents: s.recents.filter((r) => r.path !== path) })),

      clearRecent: () => set({ recents: [] }),
    }),
    { name: 'explorer-recents' }
  )
);
