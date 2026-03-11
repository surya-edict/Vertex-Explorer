import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeName =
    | 'obsidian'
    | 'aurora'
    | 'midnight-ocean'
    | 'ember'
    | 'nebula'
    | 'graphite'
    | 'fjord'
    | 'arctic-frost'
    | 'lavender-mist'
    | 'sunset-glow'
    | 'mint-breeze'
    | 'peach-blossom'
    | 'paper-ink'
    | 'sand-dune'
    | 'fluent-light';

export interface HotkeyMap {
    [action: string]: string;
}

interface SettingsStore {
    theme: ThemeName;
    fontSize: number;       // 11-18
    fontFamily: string;
    rowSpacing: 'compact' | 'default' | 'relaxed';
    radius: 'sharp' | 'rounded' | 'more-rounded';
    animations: boolean;
    showHidden: boolean;
    showExtensions: boolean;
    confirmDelete: boolean;
    singleClickToOpen: boolean;
    dateFormat: 'relative' | 'absolute';
    sidebarWidth: number;
    inspectorWidth: number;
    inspectorOpen: boolean;
    sidebarOpen: boolean;
    showRecentInSidebar: boolean;
    showPinnedInSidebar: boolean;
    showTagsInSidebar: boolean;
    globalVolume: number;
    globalMuted: boolean;
    previewMode: 'fullscreen' | 'side-panel';
    groupByType: boolean;
    showRecentHome: boolean;
    quickLookSize: number;
    audioVisualStyle: number;
    hotkeys: HotkeyMap;
    viewMode: 'details' | 'grid' | 'columns';
    iconScale: number;
    animationIntensity: 'full' | 'balanced' | 'smooth';
    disableExpensiveEffectsInLargeFolders: boolean;
    startupMode: 'resume' | 'home';

    backgroundImage: string | null;
    backgroundBlur: number;
    backgroundOpacity: number;

    setTheme: (t: ThemeName) => void;
    setFontSize: (s: number) => void;
    setFontFamily: (f: string) => void;
    setRowSpacing: (s: 'compact' | 'default' | 'relaxed') => void;
    setRadius: (r: 'sharp' | 'rounded' | 'more-rounded') => void;
    setAnimations: (v: boolean) => void;
    setShowHidden: (v: boolean) => void;
    setShowExtensions: (v: boolean) => void;
    setConfirmDelete: (v: boolean) => void;
    setSingleClickToOpen: (v: boolean) => void;
    setDateFormat: (v: 'relative' | 'absolute') => void;
    setSidebarWidth: (w: number) => void;
    setInspectorWidth: (w: number) => void;
    setInspectorOpen: (v: boolean) => void;
    setSidebarOpen: (v: boolean) => void;
    setShowRecentInSidebar: (v: boolean) => void;
    setShowPinnedInSidebar: (v: boolean) => void;
    setShowTagsInSidebar: (v: boolean) => void;
    setGlobalVolume: (v: number) => void;
    setGlobalMuted: (v: boolean) => void;
    setPreviewMode: (v: 'fullscreen' | 'side-panel') => void;
    setGroupByType: (v: boolean) => void;
    setShowRecentHome: (v: boolean) => void;
    setQuickLookSize: (v: number) => void;
    setAudioVisualStyle: (v: number) => void;
    setBackgroundImage: (v: string | null) => void;
    setBackgroundBlur: (v: number) => void;
    setBackgroundOpacity: (v: number) => void;
    setHotkey: (action: string, key: string) => void;
    setViewMode: (v: 'details' | 'grid' | 'columns') => void;
    setIconScale: (s: number) => void;
    setAnimationIntensity: (v: 'full' | 'balanced' | 'smooth') => void;
    setDisableExpensiveEffectsInLargeFolders: (v: boolean) => void;
    setStartupMode: (v: 'resume' | 'home') => void;
}

const DEFAULT_HOTKEYS: HotkeyMap = {
    'new-tab': 'ctrl+t',
    'close-tab': 'ctrl+w',
    'next-tab': 'ctrl+tab',
    'prev-tab': 'ctrl+shift+tab',
    'go-back': 'alt+arrowleft',
    'go-forward': 'alt+arrowright',
    'go-up': 'alt+arrowup',
    'goto': 'ctrl+g',
    'command-palette': 'ctrl+k',
    'search': 'ctrl+f',
    'toggle-inspector': 'i',
    'rename': 'f2',
    'delete': 'delete',
    'permanent-delete': 'shift+delete',
    'undo': 'ctrl+z',
    'new-folder': 'ctrl+shift+n',
    'copy': 'ctrl+c',
    'cut': 'ctrl+x',
    'paste': 'ctrl+v',
    'select-all': 'ctrl+a',
    'batch-rename': 'f6',
    'view-details': 'ctrl+1',
    'view-grid': 'ctrl+2',
    'view-columns': 'ctrl+3',
    'toggle-hidden': 'ctrl+h',
    'settings': 'ctrl+,',
    'split-h': 'ctrl+\\',
};

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set) => ({
            theme: 'obsidian',
            fontSize: 13,
            fontFamily: 'Space Grotesk',
            rowSpacing: 'default',
            radius: 'rounded',
            animations: true,
            showHidden: false,
            showExtensions: true,
            confirmDelete: true,
            singleClickToOpen: false,
            dateFormat: 'relative',
            sidebarWidth: 220,
            inspectorWidth: 380,
            inspectorOpen: false,
            sidebarOpen: true,
            showRecentInSidebar: true,
            showPinnedInSidebar: true,
            showTagsInSidebar: true,
            globalVolume: 0.8,
            globalMuted: false,
            previewMode: 'side-panel',
            groupByType: true,
            showRecentHome: false,
            quickLookSize: 85,
            audioVisualStyle: 0,
            viewMode: 'details',
            iconScale: 1.0,
            animationIntensity: 'balanced',
            disableExpensiveEffectsInLargeFolders: true,
            startupMode: 'resume',
            backgroundImage: null,
            backgroundBlur: 30,
            backgroundOpacity: 85,
            hotkeys: DEFAULT_HOTKEYS,

            setTheme: (t) => set({ theme: t }),
            setFontSize: (s) => set({ fontSize: s }),
            setFontFamily: (f) => set({ fontFamily: f }),
            setRowSpacing: (s) => set({ rowSpacing: s }),
            setRadius: (r) => set({ radius: r }),
            setAnimations: (v) => set({ animations: v }),
            setShowHidden: (v) => set({ showHidden: v }),
            setShowExtensions: (v) => set({ showExtensions: v }),
            setConfirmDelete: (v) => set({ confirmDelete: v }),
            setSingleClickToOpen: (v) => set({ singleClickToOpen: v }),
            setDateFormat: (v) => set({ dateFormat: v }),
            setSidebarWidth: (w) => set({ sidebarWidth: w }),
            setInspectorWidth: (w) => set({ inspectorWidth: w }),
            setInspectorOpen: (v) => set({ inspectorOpen: v }),
            setSidebarOpen: (v) => set({ sidebarOpen: v }),
            setShowRecentInSidebar: (v) => set({ showRecentInSidebar: v }),
            setShowPinnedInSidebar: (v) => set({ showPinnedInSidebar: v }),
            setShowTagsInSidebar: (v) => set({ showTagsInSidebar: v }),
            setGlobalVolume: (v) => set({ globalVolume: v }),
            setGlobalMuted: (v) => set({ globalMuted: v }),
            setPreviewMode: (v) => set({ previewMode: v }),
            setGroupByType: (v) => set({ groupByType: v }),
            setShowRecentHome: (v) => set({ showRecentHome: v }),
            setQuickLookSize: (v) => set({ quickLookSize: v }),
            setAudioVisualStyle: (v) => set({ audioVisualStyle: v }),
            setBackgroundImage: (v) => set({ backgroundImage: v }),
            setBackgroundBlur: (v) => set({ backgroundBlur: v }),
            setBackgroundOpacity: (v) => set({ backgroundOpacity: v }),
            setHotkey: (action, key) => set(s => ({ hotkeys: { ...s.hotkeys, [action]: key } })),
            setViewMode: (v) => set({ viewMode: v }),
            setIconScale: (s) => set({ iconScale: s }),
            setAnimationIntensity: (v) => set({ animationIntensity: v }),
            setDisableExpensiveEffectsInLargeFolders: (v) => set({ disableExpensiveEffectsInLargeFolders: v }),
            setStartupMode: (v) => set({ startupMode: v }),
        }),
        {
            name: 'explorer-settings',
            merge: (persistedState, currentState) => {
                const persisted = persistedState as Partial<SettingsStore>;
                return {
                    ...currentState,
                    ...persisted,
                    // Deep-merge hotkeys so newly added DEFAULT_HOTKEYS are never lost
                    hotkeys: {
                        ...currentState.hotkeys,        // defaults (includes new keys)
                        ...(persisted.hotkeys || {}),    // user overrides
                    },
                };
            },
        }
    )
);
