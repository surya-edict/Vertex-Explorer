import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useRecentStore } from './recentStore';

export type ViewMode = 'details' | 'grid' | 'columns';

export interface TabState {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
  viewMode: ViewMode;
  scrollY: number;
  selectionIds: string[];
  searchQuery?: string;
}

export interface PanelState {
  id: string;
  tabs: TabState[];
  activeTabId: string;
}

export type LayoutMode = '1' | '2h' | '2v' | '3' | '4';

export interface WorkspaceState {
  id: string;
  name: string;
  iconName: string;
  layout: LayoutMode;
  panels: PanelState[];
  activePanelId: string;
  panelSizes: { horizontal: number; vertical: number };
}

interface PanelStore {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string;

  addWorkspace: (name: string, iconName: string) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;

  setLayout: (layout: LayoutMode) => void;
  setPanelSizes: (sizes: { horizontal: number; vertical: number }) => void;
  setActivePanel: (panelId: string) => void;

  closePanel: (panelId: string) => void;
  addTab: (panelId: string, path: string) => void;
  closeTab: (panelId: string, tabId: string) => void;
  setActiveTab: (panelId: string, tabId: string) => void;
  reorderTabs: (panelId: string, fromIndex: number, toIndex: number) => void;
  updateTabs: (panelId: string, tabs: TabState[]) => void;
  updateTab: (panelId: string, tabId: string, patch: Partial<TabState>) => void;

  navigate: (panelId: string, tabId: string, path: string) => void;
  goBack: (panelId: string, tabId: string) => void;
  goForward: (panelId: string, tabId: string) => void;
  goUp: (panelId: string, tabId: string) => void;
  applyStartupMode: (mode: 'resume' | 'home') => void;
}

let counter = Date.now();
const newId = (prefix: string) => `${prefix}-${++counter}`;

const makeTab = (path: string, viewMode: ViewMode = 'details'): TabState => ({
  id: newId('tab'),
  path,
  history: [path],
  historyIndex: 0,
  viewMode,
  scrollY: 0,
  selectionIds: [],
  searchQuery: '',
});

const makePanel = (path = '', viewMode: ViewMode = 'details'): PanelState => {
  const tab = makeTab(path, viewMode);
  return { id: newId('panel'), tabs: [tab], activeTabId: tab.id };
};

const makeWorkspace = (name: string, iconName: string = 'Home'): WorkspaceState => {
  const panel = makePanel();
  return {
    id: newId('ws'),
    name,
    iconName,
    layout: '1',
    panels: [panel],
    activePanelId: panel.id,
    panelSizes: { horizontal: 0.5, vertical: 0.5 },
  };
};

const normalizeTab = (tab: Partial<TabState> | undefined): TabState => {
  const path = typeof tab?.path === 'string' ? tab.path : '';
  const history = Array.isArray(tab?.history) && tab!.history.length > 0
    ? tab!.history.filter((p): p is string => typeof p === 'string')
    : [path];

  const historyIndexRaw = typeof tab?.historyIndex === 'number' ? tab.historyIndex : history.length - 1;
  const historyIndex = Math.max(0, Math.min(historyIndexRaw, history.length - 1));

  return {
    id: typeof tab?.id === 'string' && tab.id ? tab.id : newId('tab'),
    path,
    history,
    historyIndex,
    viewMode: tab?.viewMode === 'grid' || tab?.viewMode === 'columns' ? tab.viewMode : 'details',
    scrollY: typeof tab?.scrollY === 'number' ? tab.scrollY : 0,
    selectionIds: Array.isArray(tab?.selectionIds) ? tab.selectionIds.filter((id): id is string => typeof id === 'string') : [],
    searchQuery: typeof tab?.searchQuery === 'string' ? tab.searchQuery : '',
  };
};

const normalizePanel = (panel: Partial<PanelState> | undefined): PanelState => {
  const tabs = Array.isArray(panel?.tabs) && panel!.tabs.length > 0
    ? panel!.tabs.map((t) => normalizeTab(t))
    : [makeTab('')];

  const activeTabId = tabs.some((t) => t.id === panel?.activeTabId)
    ? (panel!.activeTabId as string)
    : tabs[0].id;

  return {
    id: typeof panel?.id === 'string' && panel.id ? panel.id : newId('panel'),
    tabs,
    activeTabId,
  };
};

const normalizeWorkspace = (ws: Partial<WorkspaceState> | undefined): WorkspaceState => {
  const panels = Array.isArray(ws?.panels) && ws!.panels.length > 0
    ? ws!.panels.map((p) => normalizePanel(p))
    : [makePanel()];

  const activePanelId = panels.some((p) => p.id === ws?.activePanelId)
    ? (ws!.activePanelId as string)
    : panels[0].id;

  return {
    id: typeof ws?.id === 'string' && ws.id ? ws.id : newId('ws'),
    name: typeof ws?.name === 'string' && ws.name.trim() ? ws.name.trim() : 'General',
    iconName: typeof ws?.iconName === 'string' && ws.iconName.trim() ? ws.iconName : 'Home',
    layout: ws?.layout === '2h' || ws?.layout === '2v' || ws?.layout === '3' || ws?.layout === '4' ? ws.layout : '1',
    panels,
    activePanelId,
    panelSizes: {
      horizontal: typeof ws?.panelSizes?.horizontal === 'number' ? Math.max(0.15, Math.min(0.85, ws.panelSizes.horizontal)) : 0.5,
      vertical: typeof ws?.panelSizes?.vertical === 'number' ? Math.max(0.15, Math.min(0.85, ws.panelSizes.vertical)) : 0.5,
    },
  };
};

const normalizeWorkspaceState = (workspaces: WorkspaceState[]) => {
  const first = workspaces.length > 0 ? normalizeWorkspace(workspaces[0]) : makeWorkspace('General');
  return { workspaces: [first], activeWorkspaceId: first.id };
};

const updateActiveWs = (state: PanelStore, updater: (ws: WorkspaceState) => Partial<WorkspaceState>) => {
  return {
    workspaces: state.workspaces.map((ws) =>
      ws.id === state.activeWorkspaceId ? { ...ws, ...updater(ws) } : ws
    ),
  };
};

export const usePanelStore = create<PanelStore>()(
  persist(
    (set, get) => {
      const initialWs = makeWorkspace('General');
      return {
        workspaces: [initialWs],
        activeWorkspaceId: initialWs.id,

        addWorkspace: (_name, _iconName) => set((s) => {
          const first = s.workspaces[0] ?? makeWorkspace('General');
          return { workspaces: [first], activeWorkspaceId: first.id };
        }),

        removeWorkspace: (_id) => set((s) => {
          const first = s.workspaces[0] ?? makeWorkspace('General');
          return { workspaces: [first], activeWorkspaceId: first.id };
        }),

        setActiveWorkspace: (_id) => set((s) => {
          const first = s.workspaces[0] ?? makeWorkspace('General');
          return { workspaces: [first], activeWorkspaceId: first.id };
        }),

        renameWorkspace: (_id, name) => set((s) => ({
          workspaces: [{ ...(s.workspaces[0] ?? makeWorkspace('General')), name: name.trim() || s.workspaces[0]?.name || 'General' }],
          activeWorkspaceId: (s.workspaces[0] ?? makeWorkspace('General')).id,
        })),

        setLayout: (layout) => set((s) => updateActiveWs(s, (ws) => {
          const panels = [...ws.panels];
          const required = layout === '1' ? 1 : layout === '3' ? 3 : layout === '4' ? 4 : 2;
          while (panels.length < required) {
            const seedPanel = panels[panels.length - 1];
            const seedTab = seedPanel?.tabs.find((t) => t.id === seedPanel.activeTabId);
            const seedPath = seedTab?.path ?? '';
            const seedView: ViewMode = seedTab?.viewMode ?? 'details';
            panels.push(makePanel(seedPath, seedView));
          }
          return { layout, panels, activePanelId: ws.activePanelId || panels[0].id };
        })),

        setPanelSizes: (sizes) => set((s) => updateActiveWs(s, () => ({
          panelSizes: {
            horizontal: Math.max(0.15, Math.min(0.85, sizes.horizontal)),
            vertical: Math.max(0.15, Math.min(0.85, sizes.vertical)),
          },
        }))),

        setActivePanel: (panelId) => set((s) => updateActiveWs(s, (ws) => ({
          activePanelId: ws.panels.some((p) => p.id === panelId) ? panelId : ws.activePanelId,
        }))),

        closePanel: (panelId) => set((s) => updateActiveWs(s, (ws) => {
          if (ws.panels.length <= 1) return {};
          const filtered = ws.panels.filter(p => p.id !== panelId);
          const newActive = ws.activePanelId === panelId ? filtered[0]?.id ?? '' : ws.activePanelId;
          const count = filtered.length;
          let newLayout: LayoutMode = ws.layout;
          if (count <= 1) newLayout = '1';
          else if (count === 2) newLayout = ws.layout === '2v' ? '2v' : '2h';
          else if (count === 3) newLayout = '3';
          return { panels: filtered, activePanelId: newActive, layout: newLayout };
        })),

        addTab: (panelId, path) => set((s) => updateActiveWs(s, (ws) => ({
          panels: ws.panels.map((p) => {
            if (p.id !== panelId) return p;
            const activeTab = p.tabs.find((t) => t.id === p.activeTabId);
            const viewMode: ViewMode = activeTab?.viewMode ?? 'details';
            const tab = makeTab(path, viewMode);
            return { ...p, tabs: [...p.tabs, tab], activeTabId: tab.id };
          }),
        }))),

        closeTab: (panelId, tabId) => set((s) => updateActiveWs(s, (ws) => ({
          panels: ws.panels.map((p) => {
            if (p.id !== panelId || p.tabs.length === 1) return p;
            const idx = p.tabs.findIndex((t) => t.id === tabId);
            const tabs = p.tabs.filter((t) => t.id !== tabId);
            const activeTabId = p.activeTabId === tabId ? tabs[Math.max(0, idx - 1)].id : p.activeTabId;
            return { ...p, tabs, activeTabId };
          }),
        }))),

        setActiveTab: (panelId, tabId) => set((s) => updateActiveWs(s, (ws) => ({
          panels: ws.panels.map((p) => p.id === panelId ? { ...p, activeTabId: p.tabs.some((t) => t.id === tabId) ? tabId : p.activeTabId } : p),
        }))),

        reorderTabs: (panelId, from, to) => set((s) => updateActiveWs(s, (ws) => ({
          panels: ws.panels.map((p) => {
            if (p.id !== panelId) return p;
            const tabs = [...p.tabs];
            if (from < 0 || from >= tabs.length || to < 0 || to >= tabs.length) return p;
            const [moved] = tabs.splice(from, 1);
            tabs.splice(to, 0, moved);
            return { ...p, tabs };
          }),
        }))),

        updateTabs: (panelId, tabs) => set((s) => updateActiveWs(s, (ws) => ({
          panels: ws.panels.map((p) => p.id === panelId ? normalizePanel({ ...p, tabs }) : p),
        }))),

        updateTab: (panelId, tabId, patch) => set((s) => updateActiveWs(s, (ws) => ({
          panels: ws.panels.map((p) => p.id !== panelId ? p : {
            ...p,
            tabs: p.tabs.map((t) => t.id !== tabId ? t : normalizeTab({ ...t, ...patch })),
          }),
        }))),

        navigate: (panelId, tabId, path) => {
          // Track in recents (only real directories, not empty home)
          if (path && path.trim()) {
            try { useRecentStore.getState().addRecent(path); } catch { }
          }
          return set((s) => updateActiveWs(s, (ws) => ({
            panels: ws.panels.map((p) => {
              if (p.id !== panelId) return p;
              return {
                ...p,
                tabs: p.tabs.map((t) => {
                  if (t.id !== tabId) return t;
                  const history = [...t.history.slice(0, t.historyIndex + 1), path];
                  return { ...t, path, history, historyIndex: history.length - 1, selectionIds: [], scrollY: 0 };
                }),
              };
            }),
          })));
        },

        goBack: (panelId, tabId) => set((s) => updateActiveWs(s, (ws) => ({
          panels: ws.panels.map((p) => {
            if (p.id !== panelId) return p;
            return {
              ...p,
              tabs: p.tabs.map((t) => {
                if (t.id !== tabId || t.historyIndex <= 0) return t;
                const historyIndex = t.historyIndex - 1;
                return { ...t, historyIndex, path: t.history[historyIndex] };
              }),
            };
          }),
        }))),

        goForward: (panelId, tabId) => set((s) => updateActiveWs(s, (ws) => ({
          panels: ws.panels.map((p) => {
            if (p.id !== panelId) return p;
            return {
              ...p,
              tabs: p.tabs.map((t) => {
                if (t.id !== tabId || t.historyIndex >= t.history.length - 1) return t;
                const historyIndex = t.historyIndex + 1;
                return { ...t, historyIndex, path: t.history[historyIndex] };
              }),
            };
          }),
        }))),

        goUp: (panelId, tabId) => {
          const state = get();
          const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
          if (!ws) return;
          const panel = ws.panels.find((p) => p.id === panelId);
          const tab = panel?.tabs.find((t) => t.id === tabId);
          if (!tab || !tab.path) return;

          const parts = tab.path.replace(/\\/g, '/').split('/').filter(Boolean);
          if (parts.length === 0) return;
          if (parts.length === 1) { // If at root of a drive, go to Home
            get().navigate(panelId, tabId, '');
            return;
          }

          parts.pop();
          const parent = parts.length === 1 && parts[0].endsWith(':') ? `${parts[0]}\\` : parts.join('\\');
          get().navigate(panelId, tabId, parent);
        },

        applyStartupMode: (mode) => {
          if (mode !== 'home') return;
          set((s) => ({
            workspaces: s.workspaces.map((ws) => ({
              ...ws,
              panels: ws.panels.map((p) => ({
                ...p,
                tabs: p.tabs.map((t) => ({
                  ...t,
                  path: '',
                  history: [''],
                  historyIndex: 0,
                  scrollY: 0,
                  selectionIds: [],
                  searchQuery: '',
                })),
              })),
            })),
          }));
        },
      };
    },
    {
      name: 'explorer-panels-v2',
      partialize: (s) => ({ workspaces: s.workspaces, activeWorkspaceId: s.activeWorkspaceId }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PanelStore> | undefined;
        const workspaces = Array.isArray(persisted?.workspaces) ? persisted.workspaces.map((ws) => normalizeWorkspace(ws)) : currentState.workspaces;
        const normalized = normalizeWorkspaceState(workspaces);
        return {
          ...currentState,
          workspaces: normalized.workspaces,
          activeWorkspaceId: normalized.activeWorkspaceId,
        };
      },
    }
  )
);
