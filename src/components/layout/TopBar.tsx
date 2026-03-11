import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { usePanelStore } from '../../store/panelStore';
import { useSettingsStore } from '../../store/settingsStore';
import {
    Minus, Square, X, ChevronLeft, ChevronRight,
    PanelLeft, Settings, Command, MonitorPlay, Eye, EyeOff
} from 'lucide-react';
import './TopBar.css';
import { TAG_COLORS } from '../../store/tagStore';

const appWindow = getCurrentWindow();

// Simple icon wrapper
function ToolbarIcon({ d, ...props }: any) {
    return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}><path d={d} /></svg>;
}

export function TopBar({ onOpenCommandPalette, onOpenSettings }: { onOpenCommandPalette?: () => void, onOpenSettings?: () => void }) {
    const sidebarOpen = useSettingsStore(s => s.sidebarOpen);
    const setSidebarOpen = useSettingsStore(s => s.setSidebarOpen);
    const setLayout = usePanelStore(s => s.setLayout);
    const inspectorOpen = useSettingsStore(s => s.inspectorOpen);
    const setInspectorOpen = useSettingsStore(s => s.setInspectorOpen);

    const showHidden = useSettingsStore(s => s.showHidden);
    const setShowHidden = useSettingsStore(s => s.setShowHidden);
    const backgroundImage = useSettingsStore(s => s.backgroundImage);

    const activeWs = usePanelStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId) || s.workspaces[0]);
    const panels = activeWs?.panels ?? [];
    const activePanelId = activeWs?.activePanelId || panels[0]?.id;
    const navigate = usePanelStore((s) => s.navigate);
    const goBack = usePanelStore((s) => s.goBack);
    const goForward = usePanelStore((s) => s.goForward);

    const layout = activeWs?.layout ?? '1';

    const activePanel = panels.find((p) => p.id === activePanelId) ?? panels[0];
    const activeTabId = activePanel?.activeTabId ?? '';
    const activeTab = activePanel?.tabs.find(t => t.id === activeTabId);

    // Breadcrumbs
    const currentPath = activeTab?.path ?? '';
    const isTagView = currentPath.startsWith('tag:');
    const tagId = isTagView ? currentPath.slice('tag:'.length).trim() : '';
    const tagLabel = isTagView ? (TAG_COLORS.find(t => t.id === (tagId as any))?.label ?? (tagId ? (tagId.charAt(0).toUpperCase() + tagId.slice(1)) : 'Tag')) : '';
    const parts = isTagView ? ['Tags', tagLabel] : currentPath.split('\\').filter(Boolean);
    const [pathInput, setPathInput] = useState(currentPath);
    const [isEditingPath, setIsEditingPath] = useState(false);

    useEffect(() => {
        setPathInput(currentPath);
    }, [currentPath]);

    const handlePathSubmit = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            const exists = await invoke<boolean>('path_exists', { path: pathInput }).catch(() => false);
            if (exists) {
                navigate(activePanelId, activeTabId, pathInput);
                setIsEditingPath(false);
            } else {
                setPathInput(currentPath); // revert
                setIsEditingPath(false);
                alert('Path does not exist');
            }
        } else if (e.key === 'Escape') {
            setPathInput(currentPath);
            setIsEditingPath(false);
        }
    };

    const handleBreadcrumbClick = (index: number) => {
        if (isTagView) {
            // Tags crumb goes "home" (This PC), tag crumb stays in tag view
            if (index === 0) navigate(activePanelId, activeTabId, '');
            else navigate(activePanelId, activeTabId, `tag:${tagId}`);
            return;
        }
        const newPath = parts.slice(0, index + 1).join('\\') + '\\';
        navigate(activePanelId, activeTabId, newPath);
    };

    return (
        <div className="topbar" data-tauri-drag-region data-transparent={!!backgroundImage}>
            <div className="topbar-section topbar-left">
                <button className="topbar-btn" title="Toggle Sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>
                    <PanelLeft size={16} />
                </button>
                <div className="topbar-divider" />
                <button className="topbar-btn" onClick={() => goBack(activePanelId, activeTabId)} title="Back (Alt+Left)">
                    <ChevronLeft size={18} />
                </button>
                <button className="topbar-btn" onClick={() => goForward(activePanelId, activeTabId)} title="Forward (Alt+Right)">
                    <ChevronRight size={18} />
                </button>
            </div>

            {/* Center: Centered Address Bar */}
            <div className="topbar-section topbar-center" data-tauri-drag-region>
                <div className="address-bar-container">
                    {isEditingPath ? (
                        <input
                            autoFocus
                            className="address-input"
                            value={pathInput}
                            onChange={(e) => setPathInput(e.target.value)}
                            onKeyDown={handlePathSubmit}
                            onBlur={() => setIsEditingPath(false)}
                        />
                    ) : (
                        <AnimatePresence mode="popLayout" initial={false}>
                            <motion.div
                                key={currentPath}
                                className="breadcrumbs"
                                onClick={() => setIsEditingPath(true)}
                                initial={{ opacity: 0, filter: 'blur(6px)' }}
                                animate={{ opacity: 1, filter: 'blur(0px)' }}
                                exit={{ opacity: 0, filter: 'blur(4px)' }}
                                transition={{
                                    duration: 0.7,
                                    ease: [0.22, 1, 0.36, 1]
                                }}
                            >
                                {parts.length === 0 ? (
                                    <motion.span layout className="breadcrumb-part">This PC</motion.span>
                                ) : (
                                    (() => {
                                        const MAX_VISIBLE = 4;
                                        if (parts.length <= MAX_VISIBLE) {
                                            return parts.map((p, i) => (
                                                <motion.div layout key={i} className="breadcrumb-item">
                                                    <span
                                                        className="breadcrumb-part"
                                                        onClick={(e) => { e.stopPropagation(); handleBreadcrumbClick(i); }}
                                                    >
                                                        {p}
                                                    </span>
                                                    {i < parts.length - 1 && <ChevronRight size={12} className="breadcrumb-sep" />}
                                                </motion.div>
                                            ));
                                        }

                                        // Fallback for long paths: Show first, ..., and last 2
                                        return (
                                            <>
                                                <motion.div layout key={0} className="breadcrumb-item">
                                                    <span
                                                        className="breadcrumb-part"
                                                        onClick={(e) => { e.stopPropagation(); handleBreadcrumbClick(0); }}
                                                    >
                                                        {parts[0]}
                                                    </span>
                                                    <ChevronRight size={12} className="breadcrumb-sep" />
                                                </motion.div>

                                                <motion.div layout key="ellipsis" className="breadcrumb-item">
                                                    <span className="breadcrumb-part ellipsis">...</span>
                                                    <ChevronRight size={12} className="breadcrumb-sep" />
                                                </motion.div>

                                                {[parts.length - 2, parts.length - 1].map((idx) => (
                                                    <motion.div layout key={idx} className="breadcrumb-item">
                                                        <span
                                                            className="breadcrumb-part"
                                                            onClick={(e) => { e.stopPropagation(); handleBreadcrumbClick(idx); }}
                                                        >
                                                            {parts[idx]}
                                                        </span>
                                                        {idx < parts.length - 1 && <ChevronRight size={12} className="breadcrumb-sep" />}
                                                    </motion.div>
                                                ))}
                                            </>
                                        );
                                    })()
                                )}
                            </motion.div>
                        </AnimatePresence>
                    )}
                </div>
            </div>

            {/* Right: Layouts, Utilities & Window Controls */}
            <div className="topbar-section topbar-right">
                <button className={`topbar-btn ${layout === '1' ? 'topbar-btn--active' : ''}`} title="Single Panel" onClick={() => setLayout('1')}>
                    <ToolbarIcon d="M3 3h18v18H3z" />
                </button>
                <button className={`topbar-btn ${layout === '2h' ? 'topbar-btn--active' : ''}`} title="Split Horizontal" onClick={() => setLayout('2h')}>
                    <ToolbarIcon d="M3 3h8v18H3zM13 3h8v18h-8z" />
                </button>
                <button className={`topbar-btn ${layout === '2v' ? 'topbar-btn--active' : ''}`} title="Split Vertical" onClick={() => setLayout('2v')}>
                    <ToolbarIcon d="M3 3h18v8H3zM3 13h18v8H3z" />
                </button>
                <button className={`topbar-btn ${layout === '3' ? 'topbar-btn--active' : ''}`} title="Triple View" onClick={() => setLayout('3')}>
                    <ToolbarIcon d="M3 3h8v18H3zM13 3h8v8h-8zM13 13h8v8h-8z" />
                </button>
                <button className={`topbar-btn ${layout === '4' ? 'topbar-btn--active' : ''}`} title="Quad View" onClick={() => setLayout('4')}>
                    <ToolbarIcon d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" />
                </button>

                <div className="topbar-divider" />

                <button className={`topbar-btn ${showHidden ? 'topbar-btn--active' : ''}`} title="Toggle Hidden Files" onClick={() => setShowHidden(!showHidden)}>
                    {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button className="topbar-btn" title="Command Palette (Ctrl+K)" onClick={() => onOpenCommandPalette?.()}>
                    <Command size={14} />
                </button>
                <button className={`topbar-btn ${inspectorOpen ? 'topbar-btn--active' : ''}`} title="Inspector (I)" onClick={() => setInspectorOpen(!inspectorOpen)}>
                    <MonitorPlay size={14} />
                </button>
                <button className="topbar-btn" title="Settings (Ctrl+,)" onClick={() => onOpenSettings?.()}>
                    <Settings size={14} />
                </button>

                <div className="topbar-divider" />

                <button className="topbar-btn window-btn" onClick={() => appWindow.minimize()} title="Minimize">
                    <Minus size={14} />
                </button>
                <button className="topbar-btn window-btn" onClick={() => appWindow.toggleMaximize()} title="Maximize">
                    <Square size={12} />
                </button>
                <button className="topbar-btn window-btn window-close" onClick={() => appWindow.close()} title="Close">
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}
