import { useEffect, useState, useCallback, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { Panel } from './components/layout/Panel';
import { Inspector } from './components/inspector/Inspector';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { CommandPalette } from './components/commandpalette/CommandPalette';
import { Settings } from './components/settings/Settings';
import { ContextMenu, ContextMenuState } from './components/contextmenu/ContextMenu';
import { GoTo } from './components/address/GoTo';
import { QuickLook } from './components/preview/QuickLook';
import { ClipboardBar } from './components/common/ClipboardBar';
import { InputDialog } from './components/common/InputDialog';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { RecycleBinModal } from './components/common/RecycleBinModal';
import { usePanelStore } from './store/panelStore';
import { useSettingsStore } from './store/settingsStore';
import { useClipboardStore } from './store/clipboardStore';
import { useUndoStore } from './store/undoStore';
import { useActionHotkey } from './hooks/useHotkeys';
import { FileEntry } from './hooks/useDirectory';
import { pasteWithConflictCheck } from './utils/paste';

import './App.css';

export default function App() {
  const activeWs = usePanelStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId) || s.workspaces[0]);
  if (!activeWs) return null;
  const panels = activeWs.panels;
  const layout = activeWs.layout;
  const activePanelId = activeWs.activePanelId;

  const setActivePanel = usePanelStore(s => s.setActivePanel);
  const addTab = usePanelStore(s => s.addTab);
  const setLayout = usePanelStore(s => s.setLayout);
  const applyStartupMode = usePanelStore(s => s.applyStartupMode);

  const theme = useSettingsStore(s => s.theme);
  const animations = useSettingsStore(s => s.animations);
  const sidebarOpen = useSettingsStore(s => s.sidebarOpen);
  const inspectorOpen = useSettingsStore(s => s.inspectorOpen);
  const setInspectorOpen = useSettingsStore(s => s.setInspectorOpen);
  const fontSize = useSettingsStore(s => s.fontSize);
  const fontFamily = useSettingsStore(s => s.fontFamily);
  const inspectorWidth = useSettingsStore(s => s.inspectorWidth);
  const backgroundImage = useSettingsStore(s => s.backgroundImage);
  const backgroundBlur = useSettingsStore(s => s.backgroundBlur);
  const backgroundOpacity = useSettingsStore(s => s.backgroundOpacity);
  const animationIntensity = useSettingsStore(s => s.animationIntensity);
  const startupMode = useSettingsStore(s => s.startupMode);
  const bgContrastRef = useRef<'light' | 'dark' | null>(null);
  const [animFallback, setAnimFallback] = useState(false);

  // Modal states
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inputDialog, setInputDialog] = useState<{ isOpen: boolean; title: string; type: 'folder' | 'file' | 'rename'; initialValue?: string; onSubmit: (val: string) => void }>({ isOpen: false, title: '', type: 'folder', onSubmit: () => { } });
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; type?: 'danger' | 'warning' | 'info'; confirmLabel?: string; onConfirm: () => void; onCancel?: () => void }>({ isOpen: false, title: '', message: '', onConfirm: () => { } });
  const [inspectedFile, setInspectedFile] = useState<FileEntry | null>(null);
  const [quickLookOpen, setQuickLookOpen] = useState(false);
  const [quickLookFile, setQuickLookFile] = useState<FileEntry | null>(null);
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  const startupAppliedRef = useRef(false);
  const inspectorAnimInitRef = useRef(true);

  useEffect(() => {
    if (inspectorAnimInitRef.current) {
      inspectorAnimInitRef.current = false;
      document.documentElement.setAttribute('data-inspector-animating', '0');
      return;
    }
    document.documentElement.setAttribute('data-inspector-animating', '1');
    window.dispatchEvent(new CustomEvent('explorer-inspector-animation-start'));
    const t = window.setTimeout(() => {
      document.documentElement.setAttribute('data-inspector-animating', '0');
      window.dispatchEvent(new CustomEvent('explorer-inspector-animation-end'));
    }, 340);
    return () => window.clearTimeout(t);
  }, [inspectorOpen]);

  useEffect(() => {
    if (startupAppliedRef.current) return;
    startupAppliedRef.current = true;
    applyStartupMode(startupMode);
  }, [startupMode, applyStartupMode]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const lowCore = ((navigator as any).hardwareConcurrency || 8) <= 4;
    const apply = () => setAnimFallback(lowCore || mq.matches);
    apply();
    const listener = () => apply();
    mq.addEventListener?.('change', listener);
    return () => mq.removeEventListener?.('change', listener);
  }, []);

  // CSS vars + theme
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    // 10 gradient themes: 5 dark + 5 light
    const themeMap: Record<string, { vars: Record<string, string>; gradient: string; mode: 'dark' | 'light' }> = {
      'obsidian': { // Pure Pitch Black + Neon Cyan (High Contrast)
        mode: 'dark',
        gradient: 'linear-gradient(145deg, #000000 0%, #0a0a0a 40%, #0d1b1e 100%)',
        vars: { '--bg-base': '#000000', '--bg-surface': 'rgba(10,10,10,0.85)', '--bg-elevated': 'rgba(18,18,18,0.95)', '--bg-hover': 'rgba(45,205,191,0.08)', '--bg-selected': 'rgba(45,205,191,0.15)', '--accent': '#2dcdbf', '--accent-hover': '#56e6da', '--accent-muted': 'rgba(45,205,195,0.16)', '--text-primary': '#ffffff', '--text-secondary': '#a1a1aa', '--border': 'rgba(255,255,255,0.08)', '--border-subtle': 'transparent' }
      },
      'fluent-light': {
        mode: 'light',
        gradient: 'linear-gradient(180deg, #eef3f9 0%, #dbe8fa 100%)',
        vars: {
          '--bg-base': '#eef3f9',
          '--bg-surface': 'rgba(255, 255, 255, 0.65)',
          '--bg-elevated': '#ffffff',
          '--bg-hover': 'rgba(0, 0, 0, 0.04)',
          '--bg-selected': '#e9f1fb',
          '--bg-selected-hover': '#dbe8fa',
          '--bg-active-panel': '#ffffff',
          '--text-primary': '#1A1A1A',
          '--text-secondary': '#5A6470',
          '--text-muted': '#8A94A0',
          '--accent': '#0067c0',
          '--accent-hover': '#005a9e',
          '--accent-muted': 'rgba(0, 103, 192, 0.1)',
          '--border': 'rgba(0,0,0,0.06)',
          '--border-subtle': 'transparent',
          '--shadow-sm': '0 2px 8px rgba(0,0,0,0.04)',
          '--shadow-md': '0 4px 16px rgba(0,0,0,0.06)',
          '--shadow-panel': 'none',
          '--radius-md': '10px',
          '--radius-lg': '14px',
        }
      },
      'aurora': { // Emerald Green & Matrix Dark
        mode: 'dark',
        gradient: 'linear-gradient(145deg, #021a16 0%, #06312a 40%, #044b3f 100%)',
        vars: { '--bg-base': '#01120f', '--bg-surface': 'rgba(6,35,30,0.72)', '--bg-elevated': 'rgba(9,45,39,0.82)', '--bg-hover': 'rgba(16,185,129,0.1)', '--bg-selected': 'rgba(16,185,129,0.2)', '--accent': '#10b981', '--accent-hover': '#34d399', '--accent-muted': 'rgba(16,185,129,0.15)', '--text-primary': '#ecfdf5', '--text-secondary': '#a7f3d0', '--border': 'rgba(16,185,129,0.15)', '--border-subtle': 'rgba(16,185,129,0.05)' }
      },
      'midnight-ocean': { // True Deep Navy & Indigo
        mode: 'dark',
        gradient: 'linear-gradient(155deg, #030b1c 0%, #081636 34%, #122c66 100%)',
        vars: { '--bg-base': '#020712', '--bg-surface': 'rgba(11,21,48,0.76)', '--bg-elevated': 'rgba(15,31,66,0.85)', '--bg-hover': 'rgba(56,189,248,0.1)', '--bg-selected': 'rgba(56,189,248,0.2)', '--accent': '#38bdf8', '--accent-hover': '#7dd3fc', '--accent-muted': 'rgba(56,189,248,0.15)', '--text-primary': '#f0f9ff', '--text-secondary': '#bae6fd', '--border': 'rgba(56,189,248,0.15)', '--border-subtle': 'transparent' }
      },
      'ember': { // Burnt Crimson & Fiery Orange
        mode: 'dark',
        gradient: 'linear-gradient(145deg, #1b0707 0%, #3a100e 40%, #681f13 100%)',
        vars: { '--bg-base': '#110404', '--bg-surface': 'rgba(38,15,14,0.78)', '--bg-elevated': 'rgba(54,22,20,0.88)', '--bg-hover': 'rgba(249,115,22,0.1)', '--bg-selected': 'rgba(239,68,68,0.2)', '--accent': '#ef4444', '--accent-hover': '#f87171', '--accent-muted': 'rgba(239,68,68,0.15)', '--text-primary': '#fef2f2', '--text-secondary': '#fecaca', '--border': 'rgba(239,68,68,0.15)', '--border-subtle': 'rgba(239,68,68,0.05)' }
      },
      'nebula': { // Deep Purple Space & Hot Pink
        mode: 'dark',
        gradient: 'linear-gradient(145deg, #0f0518 0%, #200f33 40%, #3d1451 100%)',
        vars: { '--bg-base': '#08020e', '--bg-surface': 'rgba(26,14,40,0.76)', '--bg-elevated': 'rgba(38,19,58,0.86)', '--bg-hover': 'rgba(217,70,239,0.1)', '--bg-selected': 'rgba(217,70,239,0.2)', '--accent': '#d946ef', '--accent-hover': '#e879f9', '--accent-muted': 'rgba(217,70,239,0.15)', '--text-primary': '#fdf4ff', '--text-secondary': '#f0abfc', '--border': 'rgba(217,70,239,0.15)', '--border-subtle': 'transparent' }
      },
      'graphite': { // Warm Grey & Amber
        mode: 'dark',
        gradient: 'linear-gradient(152deg, #18191a 0%, #242526 40%, #3a3b3c 100%)',
        vars: { '--bg-base': '#121212', '--bg-surface': 'rgba(30,31,34,0.8)', '--bg-elevated': 'rgba(43,45,49,0.9)', '--bg-hover': 'rgba(251,191,36,0.08)', '--bg-selected': 'rgba(251,191,36,0.15)', '--accent': '#fbbf24', '--accent-hover': '#fcd34d', '--accent-muted': 'rgba(251,191,36,0.15)', '--text-primary': '#f3f4f6', '--text-secondary': '#9ca3af', '--border': 'rgba(255,255,255,0.08)', '--border-subtle': 'transparent' }
      },
      'fjord': { // Deep Teal & Aqua
        mode: 'dark',
        gradient: 'linear-gradient(150deg, #05161e 0%, #0d2f3c 40%, #155e6a 100%)',
        vars: { '--bg-base': '#020b10', '--bg-surface': 'rgba(10,34,44,0.76)', '--bg-elevated': 'rgba(16,48,60,0.86)', '--bg-hover': 'rgba(45,212,191,0.1)', '--bg-selected': 'rgba(45,212,191,0.2)', '--accent': '#2dd4bf', '--accent-hover': '#5eead4', '--accent-muted': 'rgba(45,212,191,0.15)', '--text-primary': '#f0fdfa', '--text-secondary': '#99f6e4', '--border': 'rgba(45,212,191,0.15)', '--border-subtle': 'transparent' }
      },
      'arctic-frost': {
        mode: 'light',
        gradient: 'linear-gradient(135deg, #e8f4fd 0%, #d4e8f8 30%, #c8e0f4 50%, #e0eef8 80%, #f0f6fc 100%)',
        vars: { '--bg-base': '#ecf4fb', '--bg-surface': 'rgba(255,255,255,0.86)', '--bg-elevated': 'rgba(255,255,255,0.95)', '--bg-hover': 'rgba(10,82,128,0.08)', '--bg-selected': 'rgba(14,165,233,0.14)', '--bg-selected-hover': 'rgba(14,165,233,0.2)', '--text-primary': '#163046', '--text-secondary': '#47677f', '--text-muted': '#7f97a8', '--accent': '#0ea5e9', '--accent-hover': '#38bdf8', '--accent-muted': 'rgba(14,165,233,0.12)', '--border': 'rgba(20,76,114,0.15)', '--border-subtle': 'rgba(20,76,114,0.1)' }
      },
      'lavender-mist': {
        mode: 'light',
        gradient: 'linear-gradient(135deg, #f3e8ff 0%, #ede0fa 30%, #e8d8f5 50%, #f0e4ff 80%, #f8f2ff 100%)',
        vars: { '--bg-base': '#f5f0fc', '--bg-surface': 'rgba(255,255,255,0.86)', '--bg-elevated': 'rgba(255,255,255,0.95)', '--bg-hover': 'rgba(87,42,141,0.08)', '--bg-selected': 'rgba(139,92,246,0.14)', '--bg-selected-hover': 'rgba(139,92,246,0.2)', '--text-primary': '#2b1d42', '--text-secondary': '#5f4f78', '--text-muted': '#9486ab', '--accent': '#8b5cf6', '--accent-hover': '#a78bfa', '--accent-muted': 'rgba(139,92,246,0.13)', '--border': 'rgba(80,42,129,0.14)', '--border-subtle': 'rgba(80,42,129,0.1)' }
      },
      'sunset-glow': {
        mode: 'light',
        gradient: 'linear-gradient(135deg, #fff5ee 0%, #ffe8d6 25%, #ffd4b8 50%, #ffe0c8 75%, #fff8f2 100%)',
        vars: { '--bg-base': '#fff6ee', '--bg-surface': 'rgba(255,255,255,0.86)', '--bg-elevated': 'rgba(255,255,255,0.95)', '--bg-hover': 'rgba(176,85,24,0.08)', '--bg-selected': 'rgba(249,115,22,0.14)', '--bg-selected-hover': 'rgba(249,115,22,0.2)', '--text-primary': '#3c2414', '--text-secondary': '#6c4d36', '--text-muted': '#a6876f', '--accent': '#f97316', '--accent-hover': '#fb923c', '--accent-muted': 'rgba(249,115,22,0.14)', '--border': 'rgba(118,62,26,0.15)', '--border-subtle': 'rgba(118,62,26,0.1)' }
      },
      'mint-breeze': {
        mode: 'light',
        gradient: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 30%, #a7f3d0 50%, #d1fae5 80%, #f0fdf8 100%)',
        vars: { '--bg-base': '#edfdf5', '--bg-surface': 'rgba(255,255,255,0.86)', '--bg-elevated': 'rgba(255,255,255,0.95)', '--bg-hover': 'rgba(9,112,81,0.08)', '--bg-selected': 'rgba(16,185,129,0.14)', '--bg-selected-hover': 'rgba(16,185,129,0.2)', '--text-primary': '#133126', '--text-secondary': '#366350', '--text-muted': '#6e9988', '--accent': '#10b981', '--accent-hover': '#34d399', '--accent-muted': 'rgba(16,185,129,0.14)', '--border': 'rgba(17,95,70,0.15)', '--border-subtle': 'rgba(17,95,70,0.1)' }
      },
      'peach-blossom': {
        mode: 'light',
        gradient: 'linear-gradient(135deg, #fff0f0 0%, #fde8e8 25%, #fbd5d5 50%, #fde2e2 75%, #fff5f5 100%)',
        vars: { '--bg-base': '#fef3f3', '--bg-surface': 'rgba(255,255,255,0.86)', '--bg-elevated': 'rgba(255,255,255,0.95)', '--bg-hover': 'rgba(164,45,68,0.08)', '--bg-selected': 'rgba(244,63,94,0.14)', '--bg-selected-hover': 'rgba(244,63,94,0.2)', '--text-primary': '#3a1d27', '--text-secondary': '#6a4652', '--text-muted': '#9e7c88', '--accent': '#f43f5e', '--accent-hover': '#fb7185', '--accent-muted': 'rgba(244,63,94,0.14)', '--border': 'rgba(126,53,72,0.15)', '--border-subtle': 'rgba(126,53,72,0.1)' }
      },
      'paper-ink': {
        mode: 'light',
        gradient: 'linear-gradient(145deg, #f7f7f5 0%, #f0f0eb 40%, #e6e6df 100%)',
        vars: { '--bg-base': '#f5f5f2', '--bg-surface': 'rgba(255,255,255,0.88)', '--bg-elevated': 'rgba(255,255,255,0.96)', '--bg-hover': 'rgba(58,58,56,0.08)', '--bg-selected': 'rgba(58,58,56,0.12)', '--bg-selected-hover': 'rgba(58,58,56,0.18)', '--text-primary': '#202124', '--text-secondary': '#4d5057', '--text-muted': '#7d828b', '--accent': '#2f3640', '--accent-hover': '#4a5568', '--accent-muted': 'rgba(47,54,64,0.12)', '--border': 'rgba(70,74,82,0.16)', '--border-subtle': 'rgba(70,74,82,0.1)' }
      },
      'sand-dune': {
        mode: 'light',
        gradient: 'linear-gradient(145deg, #f8f1e4 0%, #f0e3cc 44%, #e7d8bd 100%)',
        vars: { '--bg-base': '#f6efdf', '--bg-surface': 'rgba(255,255,255,0.84)', '--bg-elevated': 'rgba(255,255,255,0.94)', '--bg-hover': 'rgba(132,94,49,0.08)', '--bg-selected': 'rgba(194,146,82,0.16)', '--bg-selected-hover': 'rgba(194,146,82,0.24)', '--text-primary': '#362a1d', '--text-secondary': '#6a5643', '--text-muted': '#927d68', '--accent': '#c29252', '--accent-hover': '#d8aa6b', '--accent-muted': 'rgba(194,146,82,0.14)', '--border': 'rgba(124,95,62,0.16)', '--border-subtle': 'rgba(124,95,62,0.1)' }
      },
    };

    const themeConfig = themeMap[theme] ?? themeMap.obsidian;
    const mode = themeConfig?.mode ?? 'dark';
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-no-animations', String(!animations));
    root.style.setProperty('--font-size', `${fontSize}px`);
    root.style.setProperty('--font-size-sm', `${Math.max(10, fontSize - 2)}px`);
    root.style.setProperty('--font-size-lg', `${fontSize + 2}px`);
    root.style.setProperty('--font-family', `'${fontFamily}', 'Space Grotesk', 'Manrope', system-ui, sans-serif`);

    // Apply gradient background
    body.style.background = themeConfig?.gradient ?? '#0e0e14';

    // Apply per-theme CSS variable overrides
    const allKeys = new Set<string>();
    Object.values(themeMap).forEach(t => Object.keys(t.vars).forEach(k => allKeys.add(k)));
    allKeys.forEach(k => root.style.removeProperty(k));
    const overrides = themeConfig?.vars ?? {};
    Object.entries(overrides).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [theme, animations, fontSize, fontFamily]);

  const applyBgContrast = useCallback((mode: 'light' | 'dark' | null) => {
    const root = document.documentElement;
    if (bgContrastRef.current === mode) return;
    bgContrastRef.current = mode;
    if (mode) root.setAttribute('data-bg-contrast', mode);
    else root.removeAttribute('data-bg-contrast');
  }, []);

  const computeImageContrast = useCallback((img: HTMLImageElement) => {
    try {
      const w = 32;
      const h = 32;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const a = data[i + 3] / 255;
        // ignore fully transparent pixels (rare)
        if (a < 0.05) continue;
        // relative luminance (sRGB)
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += lum;
        count++;
      }
      if (count === 0) return;
      const avg = sum / count;
      // If image is bright, use dark text/icons.
      applyBgContrast(avg > 0.56 ? 'light' : 'dark');
    } catch {
      // If canvas sampling fails (protocol / security), prefer dark UI text/icons.
      applyBgContrast('light');
    }
  }, [applyBgContrast]);

  useEffect(() => {
    // No custom background → let theme control contrast.
    if (!backgroundImage) applyBgContrast(null);
    // With custom background, we'll decide on image load; no forced default.
  }, [backgroundImage, applyBgContrast]);

  // Init first panel
  useEffect(() => {
    if (panels.length > 0 && !activePanelId) setActivePanel(panels[0].id);
  }, [panels, activePanelId, setActivePanel]);

  const activeId = activePanelId || panels[0]?.id;
  const activePanel = panels.find(p => p.id === activeId) ?? panels[0];

  // Global hotkeys
  useActionHotkey('command-palette', useCallback(() => setCommandPaletteOpen(true), []));
  useActionHotkey('settings', useCallback(() => setSettingsOpen(true), []));
  useActionHotkey('goto', useCallback(() => setGotoOpen(true), []));
  useActionHotkey('toggle-inspector', useCallback(() => setInspectorOpen(!inspectorOpen), [inspectorOpen]));
  useActionHotkey('new-tab', useCallback(() => {
    if (activePanel) {
      const t = activePanel.tabs.find(t => t.id === activePanel.activeTabId);
      addTab(activePanel.id, t?.path ?? 'C:\\');
    }
  }, [activePanel, addTab]));
  useActionHotkey('split-h', useCallback(() => {
    if (layout === '1') { setLayout('2h'); if (activePanel) addTab(activePanel.id, activePanel.tabs.find(t => t.id === activePanel.activeTabId)?.path ?? 'C:\\'); }
    else setLayout('1');
  }, [layout, activePanel, addTab, setLayout]));

  const activeTabId = activePanel?.activeTabId ?? '';
  const currentPath = activePanel?.tabs.find(t => t.id === activeTabId)?.path ?? '';

  useEffect(() => {
    const windowApi = getCurrentWindow();
    const unlistenPromise = windowApi.onDragDropEvent(async (event) => {
      if (event.payload.type !== 'drop') return;

      const droppedPaths = event.payload.paths ?? [];
      if (droppedPaths.length === 0) return;

      const state = usePanelStore.getState();
      const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId) ?? state.workspaces[0];
      const panel = ws?.panels.find(p => p.id === ws?.activePanelId) ?? ws?.panels[0];
      const tab = panel?.tabs.find(t => t.id === panel?.activeTabId);
      const destPath = tab?.path ?? '';
      if (!destPath) return;

      try {
        await invoke('copy_items', { sources: droppedPaths, dest: destPath });
        window.dispatchEvent(new CustomEvent('explorer-refresh'));
      } catch (err) {
        console.error('External drop failed:', err);
      }
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten()).catch(() => { });
    };
  }, []);

  useActionHotkey('delete', useCallback(async () => {
    if (!currentPath) return;
    try {
      const selectedStr = localStorage.getItem(`explorer-selected-${currentPath}`);
      if (!selectedStr) return;
      const filePaths: string[] = JSON.parse(selectedStr);
      if (filePaths.length === 0) return;

      const performTrash = async () => {
        await invoke('trash_items', { paths: filePaths });
        localStorage.removeItem(`explorer-selected-${currentPath}`);
        window.dispatchEvent(new CustomEvent('explorer-refresh'));
      };

      if (useSettingsStore.getState().confirmDelete) {
        (window as any).__explorerConfirmDialog?.({
          title: 'Delete Items',
          message: `Are you sure you want to move ${filePaths.length} item(s) to the Recycle Bin?`,
          type: 'warning',
          confirmLabel: 'Move to Bin',
          onConfirm: performTrash
        });
      } else {
        await performTrash();
      }
    } catch (e) { console.error('Trash failed:', e); }
  }, [currentPath]));

  useActionHotkey('permanent-delete', useCallback(async () => {
    if (!currentPath) return;
    try {
      const selectedStr = localStorage.getItem(`explorer-selected-${currentPath}`);
      if (!selectedStr) return;
      const filePaths: string[] = JSON.parse(selectedStr);
      if (filePaths.length === 0) return;

      const performDelete = async () => {
        await invoke('delete_items', { paths: filePaths });
        localStorage.removeItem(`explorer-selected-${currentPath}`);
        window.dispatchEvent(new CustomEvent('explorer-refresh'));
      };

      if (useSettingsStore.getState().confirmDelete) {
        (window as any).__explorerConfirmDialog?.({
          title: 'Permanently Delete Items',
          message: `Are you sure you want to permanently delete ${filePaths.length} item(s)? This action cannot be undone.`,
          type: 'danger',
          confirmLabel: 'Delete',
          onConfirm: performDelete
        });
      } else {
        await performDelete();
      }
    } catch (e) { console.error('Delete failed:', e); }
  }, [currentPath]));

  useActionHotkey('copy', useCallback(() => {
    if (!currentPath) return;
    const selectedStr = localStorage.getItem(`explorer-selected-${currentPath}`);
    if (!selectedStr) return;
    const filePaths: string[] = JSON.parse(selectedStr);
    if (filePaths.length === 0) return;
    useClipboardStore.getState().setClipboard(filePaths, 'copy');
  }, [currentPath]));

  useActionHotkey('cut', useCallback(() => {
    if (!currentPath) return;
    const selectedStr = localStorage.getItem(`explorer-selected-${currentPath}`);
    if (!selectedStr) return;
    const filePaths: string[] = JSON.parse(selectedStr);
    if (filePaths.length === 0) return;
    useClipboardStore.getState().setClipboard(filePaths, 'cut');
  }, [currentPath]));

  useActionHotkey('paste', useCallback(async () => {
    if (!currentPath) { console.warn('[Paste] No currentPath'); return; }
    const { paths: srcPaths, action, clearClipboard } = useClipboardStore.getState();
    if (srcPaths.length > 0 && action) {
      const destPaths = srcPaths.map(p => {
        const name = p.split('\\').pop() || '';
        return currentPath + '\\' + name;
      });
      useUndoStore.getState().setLastStep({
        type: action,
        sourcePaths: srcPaths,
        destPaths
      });
      await pasteWithConflictCheck(srcPaths, currentPath, action, {
        onSuccess: () => {
          window.dispatchEvent(new CustomEvent('explorer-refresh'));
        },
        onClearClipboard: () => clearClipboard()
      });
    }
  }, [currentPath]));

  useActionHotkey('undo', useCallback(async () => {
    const lastStep = useUndoStore.getState().lastStep;
    console.log('[Undo] Hotkey triggered. Last step:', lastStep);
    if (!lastStep) {
      console.warn('[Undo] No last step found in store.');
      return;
    }

    try {
      if (lastStep.type === 'copy') {
        // Remove confirm for testing/speed
        await invoke('delete_items', { paths: lastStep.destPaths });
        useUndoStore.getState().setLastStep(null);
        window.dispatchEvent(new CustomEvent('explorer-refresh'));
      } else if (lastStep.type === 'cut') {
        // We moved items. Undo is to move them back.
        // `move_items` backend takes { sources, dest (dir) }
        // BUT move_items places the *files* into the *dest dir*. 
        // We have destPaths (the exact files) and we need their original parent dir.
        if (lastStep.sourcePaths.length > 0) {
          const originalParentStr = await invoke<string | null>('get_parent_path', { path: lastStep.sourcePaths[0] });
          if (originalParentStr) {
            await invoke('move_items', { sources: lastStep.destPaths, dest: originalParentStr });
            useUndoStore.getState().setLastStep(null);
          }
        }
      }
    } catch (e) {
      console.error('Undo failed:', e);
    }
  }, []));

  const [displayLayout, setDisplayLayout] = useState(layout);
  const pendingLayoutRef = useRef(layout);
  const [layoutPhase, setLayoutPhase] = useState<'idle' | 'fade-out' | 'fade-in'>('idle');
  const animationsEnabled = animations && !animFallback;

  useEffect(() => {
    pendingLayoutRef.current = layout;
    if (!animationsEnabled) {
      setDisplayLayout(layout);
      setLayoutPhase('idle');
      return;
    }
    if (layout === displayLayout) return;
    if (layoutPhase === 'idle') setLayoutPhase('fade-out');
  }, [layout, displayLayout, layoutPhase, animationsEnabled]);

  useEffect(() => {
    if (!animationsEnabled || layoutPhase !== 'fade-out') return;
    const t = setTimeout(() => {
      setDisplayLayout(pendingLayoutRef.current);
      setLayoutPhase('fade-in');
    }, 120);
    return () => clearTimeout(t);
  }, [layoutPhase, animationsEnabled]);

  useEffect(() => {
    if (!animationsEnabled || layoutPhase !== 'fade-in') return;
    const t = setTimeout(() => {
      if (displayLayout !== pendingLayoutRef.current) {
        setLayoutPhase('fade-out');
        return;
      }
      setLayoutPhase('idle');
    }, 220);
    return () => clearTimeout(t);
  }, [layoutPhase, displayLayout, animationsEnabled]);

  const visiblePanels = displayLayout === '1' ? panels.slice(0, 1)
    : displayLayout === '3' ? panels.slice(0, Math.min(3, panels.length))
      : displayLayout === '2h' || displayLayout === '2v' ? panels.slice(0, Math.min(2, panels.length))
        : panels.slice(0, Math.min(4, panels.length));

  const effectivePerfMode =
    displayLayout === '4' ||
    animationIntensity === 'smooth' ||
    animFallback;
  const backgroundBlurPx = Math.max(0, backgroundBlur || 0);
  const panelSizes = activeWs.panelSizes;
  const setPanelSizes = usePanelStore(s => s.setPanelSizes);

  // ─── Grid helpers ──────────────────────────────────────────
  const h = panelSizes.horizontal;
  const v = panelSizes.vertical;
  const needCols = displayLayout === '2h' || displayLayout === '3' || displayLayout === '4';
  const needRows = displayLayout === '2v' || displayLayout === '3' || displayLayout === '4';
  const gridCols = needCols ? `${h}fr 6px ${1 - h}fr` : '1fr 0px 0fr';
  const gridRows = needRows ? `${v}fr 6px ${1 - v}fr` : '1fr 0px 0fr';

  const getPanelGridArea = (activeLayout: typeof layout, index: number): React.CSSProperties => {
    switch (activeLayout) {
      case '1': return { gridColumn: '1 / -1', gridRow: '1 / -1' };
      case '2h': return index === 0 ? { gridColumn: 1, gridRow: '1 / -1' } : { gridColumn: 3, gridRow: '1 / -1' };
      case '2v': return index === 0 ? { gridColumn: '1 / -1', gridRow: 1 } : { gridColumn: '1 / -1', gridRow: 3 };
      case '3': return index === 0 ? { gridColumn: 1, gridRow: '1 / -1' } : index === 1 ? { gridColumn: 3, gridRow: 1 } : { gridColumn: 3, gridRow: 3 };
      case '4': return index === 0 ? { gridColumn: 1, gridRow: 1 } : index === 1 ? { gridColumn: 3, gridRow: 1 } : index === 2 ? { gridColumn: 1, gridRow: 3 } : { gridColumn: 3, gridRow: 3 };
      default: return {};
    }
  };

  // ─── Resize handlers ───────────────────────────────────────
  const handleResizeH = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = (e.target as HTMLElement).parentElement!;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const ratio = (ev.clientX - rect.left) / rect.width;
      setPanelSizes({ ...usePanelStore.getState().workspaces[0].panelSizes, horizontal: ratio });
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [setPanelSizes]);

  const handleResizeV = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = (e.target as HTMLElement).parentElement!;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const ratio = (ev.clientY - rect.top) / rect.height;
      setPanelSizes({ ...usePanelStore.getState().workspaces[0].panelSizes, vertical: ratio });
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [setPanelSizes]);

  // Expose setInspectedFile and context menu via window (panels call this)
  useEffect(() => {
    (window as any).__explorerSetInspected = (f: FileEntry | null) => setInspectedFile(f);
    (window as any).__explorerContextMenu = (state: ContextMenuState) => {
      setContextMenu(state);
    };
    (window as any).__explorerInputDialog = (opts: { title: string; type: 'folder' | 'file' | 'rename'; initialValue?: string; onSubmit: (val: string) => void }) => {
      setInputDialog({
        isOpen: true,
        title: opts.title,
        type: opts.type,
        initialValue: opts.initialValue,
        onSubmit: (val) => {
          opts.onSubmit(val);
          setInputDialog(prev => ({ ...prev, isOpen: false }));
        }
      });
    };
    (window as any).__explorerConfirmDialog = (opts: { title: string; message: string; type?: 'danger' | 'warning' | 'info'; confirmLabel?: string; onConfirm: () => void; onCancel?: () => void }) => {
      setConfirmDialog({
        isOpen: true,
        title: opts.title,
        message: opts.message,
        type: opts.type ?? 'warning',
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        onConfirm: () => {
          opts.onConfirm();
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        },
        onCancel: opts.onCancel
      });
    };
    (window as any).__explorerQuickLook = (f: FileEntry) => {
      const state = useSettingsStore.getState();
      const mode = state.previewMode;
      if (mode === 'fullscreen') {
        setQuickLookFile(f);
        setQuickLookOpen(true);
      } else {
        setInspectedFile(f);
        state.setInspectorOpen(!state.inspectorOpen);
      }
    };
    (window as any).__explorerRecycleBin = () => {
      setRecycleBinOpen(true);
    };

    // Block WebView2 from natively navigating away (which causes a blank screen)
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handlePopState);

    // Mouse back/forward buttons (catch pointerdown to intercept early)
    const handlePointer = (e: PointerEvent | MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'pointerup' || e.type === 'mouseup') {
          const wId = usePanelStore.getState().activeWorkspaceId;
          const ws = usePanelStore.getState().workspaces.find(w => w.id === wId);
          if (!ws) return;
          const panel = ws.panels.find(p => p.id === ws.activePanelId);
          if (panel) {
            if (e.button === 3) usePanelStore.getState().goBack(panel.id, panel.activeTabId);
            if (e.button === 4) usePanelStore.getState().goForward(panel.id, panel.activeTabId);
          }
        }
      }
    };

    window.addEventListener('mousedown', handlePointer);
    window.addEventListener('mouseup', handlePointer);
    window.addEventListener('pointerdown', handlePointer);
    window.addEventListener('pointerup', handlePointer);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('mouseup', handlePointer);
      window.removeEventListener('pointerdown', handlePointer);
      window.removeEventListener('pointerup', handlePointer);
    };
  }, []);

  return (
    <div
      className="app-root"
      data-layout={displayLayout}
      data-layout-phase={animationsEnabled ? layoutPhase : 'idle'}
      data-perf={effectivePerfMode ? '1' : '0'}
      data-gpu-lite={effectivePerfMode || layoutPhase !== 'idle' ? '1' : '0'}
      data-anim-fallback={animFallback ? '1' : '0'}
      data-anim-intensity={animationIntensity}
      data-bg-blur={backgroundBlurPx > 0 ? '1' : '0'}
      style={{
        fontFamily: `var(--font-family)`,
        fontSize: `var(--font-size)`,
      }}
    >
      {backgroundImage && (
        <img
          className="app-custom-bg"
          src={convertFileSrc(backgroundImage)}
          crossOrigin="anonymous"
          alt=""
          onLoad={(e) => {
            const img = e.currentTarget;
            computeImageContrast(img);
          }}
          onError={(e) => console.error('Background Image failed to load:', e)}
          style={{
            opacity: backgroundOpacity / 100,
            filter: backgroundBlurPx > 0 ? `blur(${backgroundBlurPx}px)` : 'none'
          }}
        />
      )}
      {!backgroundImage && <div className="app-bg-glow" />}
      {!backgroundImage && <div className="app-bg-vignette" />}

      <TopBar onOpenCommandPalette={() => setCommandPaletteOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />

      <div className="app-body">
        <Sidebar collapsed={!sidebarOpen} />

        <div
          className={`app-panels ${layoutPhase === 'fade-out' ? 'app-panels--fade-out' : layoutPhase === 'fade-in' ? 'app-panels--fade-in' : ''}`}
          style={{
            gridTemplateColumns: gridCols,
            gridTemplateRows: gridRows,
          }}
        >
          {visiblePanels.map((p, i) => (
            <div
              key={p.id}
              className="app-panel-cell"
              style={getPanelGridArea(displayLayout, i)}
            >
              <Panel panelId={p.id} active={p.id === activePanelId} onFileSelect={setInspectedFile} />
            </div>
          ))}

          {needCols && (
            <div
              className="panel-resize-handle panel-resize-handle--vertical"
              style={{ gridColumn: 2, gridRow: '1 / -1' }}
              onMouseDown={handleResizeH}
            />
          )}
          {needRows && (
            <div
              className="panel-resize-handle panel-resize-handle--horizontal"
              style={{
                gridRow: 2,
                gridColumn: displayLayout === '3' ? 3 : '1 / -1',
              }}
              onMouseDown={handleResizeV}
            />
          )}
        </div>

        {/* Inspector wrapper: width animated via CSS so flex sibling (app-panels) expands smoothly */}
        {(() => {
          const ext = inspectedFile?.extension?.toLowerCase() ?? '';
          const richPreview = ['mp4', 'webm', 'mov', 'ogg', 'mkv', 'avi', 'wmv', 'flv', 'mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'pdf', 'docx', 'xlsx', 'xls'].includes(ext);
          const dynamicWidth = richPreview ? Math.max(inspectorWidth, 380) : inspectorWidth;
          return (
            <div
              className={`inspector-shell ${inspectorOpen ? 'inspector-shell--open' : ''}`}
              style={{ width: inspectorOpen ? dynamicWidth : 0 }}
            >
              <div className="inspector-shell-content" style={{ width: dynamicWidth, flexShrink: 0, height: '100%' }}>
                <Inspector file={inspectorOpen ? inspectedFile : null} width={dynamicWidth} />
              </div>
            </div>
          );
        })()}
      </div>

      <StatusBar layout={displayLayout} />

      {/* Overlays */}
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <GoTo open={gotoOpen} onClose={() => setGotoOpen(false)} panelId={activeId} />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onRefresh={() => { }} />
      <QuickLook file={quickLookFile} open={quickLookOpen} onClose={() => setQuickLookOpen(false)} />

      <InputDialog
        isOpen={inputDialog.isOpen}
        title={inputDialog.title}
        type={inputDialog.type}
        initialValue={inputDialog.initialValue}
        onClose={() => setInputDialog(prev => ({ ...prev, isOpen: false }))}
        onSubmit={inputDialog.onSubmit}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type={confirmDialog.type}
        confirmLabel={confirmDialog.confirmLabel}
        onClose={() => {
          confirmDialog.onCancel?.();
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }}
        onConfirm={confirmDialog.onConfirm}
      />
      <ClipboardBar currentDir={currentPath} onRefresh={() => window.dispatchEvent(new CustomEvent('explorer-refresh'))} />
      <RecycleBinModal open={recycleBinOpen} onClose={() => setRecycleBinOpen(false)} />
    </div>
  );

}



function StatusBar({ layout }: { layout: '1' | '2h' | '2v' | '3' | '4' }) {
  const activeWs = usePanelStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId) || s.workspaces[0]);
  const backgroundImage = useSettingsStore(s => s.backgroundImage);
  if (!activeWs) return null;
  const panels = activeWs.panels;
  const activePanelId = activeWs.activePanelId;
  const activePanel = panels.find(p => p.id === activePanelId) ?? panels[0];
  const tab = activePanel?.tabs.find(t => t.id === activePanel.activeTabId);
  const path = tab?.path ?? '';

  const [selInfo, setSelInfo] = useState<{ count: number; size: number } | null>(null);
  const clipboard = useClipboardStore(s => s.paths);
  const clipboardAction = useClipboardStore(s => s.action);

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ count: number; size: number; currentDir: string }>;
      if (ev.detail.count === 0) {
        setSelInfo(null);
      } else {
        setSelInfo({ count: ev.detail.count, size: ev.detail.size });
      }
    };
    window.addEventListener('explorer-selection-change', handler);
    return () => window.removeEventListener('explorer-selection-change', handler);
  }, []);

  // Clear selection info on navigation
  useEffect(() => { setSelInfo(null); }, [path]);

  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const handleSelectAll = () => {
    window.dispatchEvent(new CustomEvent('explorer-select-all'));
  };

  return (
    <div className="statusbar" data-transparent={!!backgroundImage}>
      <div className="statusbar-left">
        <span className="statusbar-path" title={path}>{path || 'This PC'}</span>
        {selInfo && selInfo.count > 0 && (
          <span className="statusbar-selection">
            {selInfo.count} selected{selInfo.size > 0 ? ` · ${fmtSize(selInfo.size)}` : ''}
          </span>
        )}
      </div>

      <div className="statusbar-center">
        <button className="select-all-btn" onClick={handleSelectAll}>
          <span>Select All</span>
        </button>
      </div>

      <div className="statusbar-right">
        {clipboard.length > 0 && (
          <span className="statusbar-clipboard" title={`${clipboard.length} item(s) in clipboard (${clipboardAction})`}>
            {clipboardAction === 'cut' ? '✂' : '⎘'} {clipboard.length}
          </span>
        )}
        <span className="statusbar-info">{layout === '1' ? '▣' : layout === '2h' ? '▥' : layout === '2v' ? '▤' : layout === '3' ? '◫' : '⊞'}</span>
        <span className="statusbar-info">Vertex Explorer</span>
      </div>
    </div>
  );
}
