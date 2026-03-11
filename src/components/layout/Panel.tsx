import { useEffect, useRef, useCallback } from 'react';
import { TabStrip } from '../tabs/TabStrip';
import { DetailsView } from '../fileview/DetailsView';
import { GridView } from '../fileview/GridView';
import { MillerColumns } from '../fileview/MillerColumns';
import { HomeView } from '../fileview/HomeView';
import { usePanelStore } from '../../store/panelStore';
import { useActionHotkey, useHotkey } from '../../hooks/useHotkeys';
import { invoke } from '@tauri-apps/api/core';
import { FileEntry } from '../../hooks/useDirectory';
import { useSettingsStore } from '../../store/settingsStore';
import './Panel.css';

interface Props {
    panelId: string;
    active: boolean;
    onFileSelect?: (file: FileEntry | null) => void;
}

const ZOOM_MIN = 0.75;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;

export function Panel({ panelId, active, onFileSelect }: Props) {
    // ─── All hooks MUST come before any conditional return ────
    const activeWs = usePanelStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId) || s.workspaces[0]);
    const setActivePanel = usePanelStore((s) => s.setActivePanel);
    const closePanel = usePanelStore((s) => s.closePanel);
    const addTab = usePanelStore((s) => s.addTab);
    const goBack = usePanelStore((s) => s.goBack);
    const goForward = usePanelStore((s) => s.goForward);
    const goUp = usePanelStore((s) => s.goUp);
    const updateTab = usePanelStore((s) => s.updateTab);
    const navigate = usePanelStore((s) => s.navigate);
    const iconScale = useSettingsStore(s => s.iconScale);
    const setIconScale = useSettingsStore(s => s.setIconScale);
    const backgroundImage = useSettingsStore(s => s.backgroundImage);
    const panelRef = useRef<HTMLDivElement>(null);

    // Derived (not hooks)
    const panels = activeWs.panels;
    const layout = activeWs.layout;
    const panel = panels.find((p) => p.id === panelId);
    const activeTab = panel?.tabs.find((t) => t.id === panel.activeTabId);

    // Hotkeys — null-guarded so they're safe even when panel is gone
    useActionHotkey('new-tab', () => { if (active && activeTab) addTab(panelId, activeTab.path); });
    useActionHotkey('go-back', () => { if (active && panel) goBack(panelId, panel.activeTabId); });
    useActionHotkey('go-forward', () => { if (active && panel) goForward(panelId, panel.activeTabId); });
    useActionHotkey('go-up', () => { if (active && panel) goUp(panelId, panel.activeTabId); });
    useActionHotkey('view-details', () => { if (active && activeTab) updateTab(panelId, activeTab.id, { viewMode: 'details' }); });
    useActionHotkey('view-grid', () => { if (active && activeTab) updateTab(panelId, activeTab.id, { viewMode: 'grid' }); });
    useActionHotkey('view-columns', () => { if (active && activeTab) updateTab(panelId, activeTab.id, { viewMode: 'columns' }); });

    const handleNewFolder = useCallback(async () => {
        if (!active || !activeTab) return;
        (window as any).__explorerInputDialog?.({
            title: 'New Folder',
            type: 'folder',
            onSubmit: async (name: string) => {
                await invoke('create_folder', { path: `${activeTab.path}\\${name}` });
                window.dispatchEvent(new Event('explorer-refresh'));
            }
        });
    }, [active, activeTab?.path]);

    useActionHotkey('new-folder', handleNewFolder);
    useHotkey('ctrl+n', handleNewFolder);

    const iconScaleRef = useRef(iconScale);
    iconScaleRef.current = iconScale;

    useEffect(() => {
        const el = panelRef.current;
        if (!el) return;
        const handler = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            e.stopPropagation();
            setIconScale(Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, iconScaleRef.current + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))) * 100) / 100);
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, [setIconScale]);

    const handleHomeNavigate = useCallback((path: string) => {
        if (path && activeTab) navigate(panelId, activeTab.id, path);
    }, [panelId, activeTab?.id, navigate]);

    // ─── Conditional return AFTER all hooks ───────────────────
    if (!panel || !activeTab) return null;

    const focusPanel = () => setActivePanel(panelId);

    const renderView = () => {
        if (!activeTab.path) {
            return <HomeView onNavigate={handleHomeNavigate} />;
        }
        switch (activeTab.viewMode) {
            case 'grid':
                return <GridView panelId={panelId} tabPath={activeTab.path} tabId={activeTab.id} onFileSelect={onFileSelect} iconScale={iconScale} />;
            case 'columns':
                return <MillerColumns panelId={panelId} tabPath={activeTab.path} tabId={activeTab.id} onFileSelect={onFileSelect} />;
            default:
                return <DetailsView panelId={panelId} tab={activeTab} onFileSelect={onFileSelect} iconScale={iconScale} />;
        }
    };

    const isSplitLayout = layout !== '1';

    return (
        <div
            className={`panel ${active ? 'panel--active' : ''} ${isSplitLayout ? 'panel--split' : ''}`}
            onClick={focusPanel}
            ref={panelRef}
            data-transparent={!!backgroundImage}
        >
            {isSplitLayout && (
                <button
                    className="panel-close-btn"
                    onClick={(e) => { e.stopPropagation(); closePanel(panelId); }}
                    title="Close panel"
                >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
            )}
            <TabStrip panelId={panelId} iconScale={iconScale} setIconScale={setIconScale} />
            <div className="panel-content">
                {renderView()}
            </div>
        </div>
    );
}
