import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const TAG_COLORS = [
  { id: 'red',    label: 'Red',    hex: '#ef4444' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'yellow', label: 'Yellow', hex: '#eab308' },
  { id: 'green',  label: 'Green',  hex: '#22c55e' },
  { id: 'blue',   label: 'Blue',   hex: '#3b82f6' },
  { id: 'purple', label: 'Purple', hex: '#a855f7' },
  { id: 'pink',   label: 'Pink',   hex: '#ec4899' },
  { id: 'gray',   label: 'Gray',   hex: '#94a3b8' },
] as const;

export type TagColorId = (typeof TAG_COLORS)[number]['id'];

interface TagStore {
  /** Map from absolute file/folder path → tag color id */
  tags: Record<string, TagColorId>;
  setTag: (path: string, colorId: TagColorId) => void;
  removeTag: (path: string) => void;
  clearAllTags: () => void;
}

export const useTagStore = create<TagStore>()(
  persist(
    (set) => ({
      tags: {},
      setTag: (path, colorId) =>
        set((s) => ({ tags: { ...s.tags, [path]: colorId } })),
      removeTag: (path) =>
        set((s) => {
          const next = { ...s.tags };
          delete next[path];
          return { tags: next };
        }),
      clearAllTags: () => set({ tags: {} }),
    }),
    { name: 'explorer-tags' }
  )
);
