import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, Download, FileText, Image, Music, Video, HardDrive, Star, Pin, Trash2, X, Clock, ChevronRight } from 'lucide-react';
import { usePanelStore } from '../../store/panelStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRecentStore } from '../../store/recentStore';
import { useTagStore, TAG_COLORS } from '../../store/tagStore';
import { formatBytes } from '../../utils/formatters';
import { getDraggedPaths, clearDraggedPaths } from '../../utils/dragDrop';
import './Sidebar.css';

interface DriveInfo {
    letter: string;
    label: string;
    total: number;
    free: number;
    drive_type: string;
}

interface SystemPaths {
    home: string;
    desktop: string;
    downloads: string;
    documents: string;
    pictures: string;
    music: string;
    videos: string;
}

const QUICK_ACCESS_ICONS: Record<string, React.ReactNode> = {
    home: <Home size={14} />,
    desktop: <Monitor size={14} />,
    downloads: <Download size={14} />,
    documents: <FileText size={14} />,
    pictures: <Image size={14} />,
    music: <Music size={14} />,
    videos: <Video size={14} />,
};

function Monitor({ size }: { size: number }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
}

const QUICK_ACCESS_LABELS: Record<string, string> = {
    home: 'Home',
    desktop: 'Desktop',
    downloads: 'Downloads',
    documents: 'Documents',
    pictures: 'Pictures',
    music: 'Music',
    videos: 'Videos',
};

interface SidebarItemProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    active?: boolean;
    onContextMenu?: (e: React.MouseEvent) => void;
    /** Path for drag-and-drop target */
    dropPath?: string;
}

function SidebarItem({ icon, label, onClick, active, onContextMenu, collapsed, dropPath }: SidebarItemProps & { collapsed: boolean }) {
    const [isDrop, setIsDrop] = useState(false);

    const handleDragOver = (e: React.DragEvent) => {
        if (!dropPath) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
        setIsDrop(true);
    };

    const handleDragLeave = () => setIsDrop(false);

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDrop(false);
        if (!dropPath) return;
        const paths = getDraggedPaths(e.dataTransfer);
        if (paths.length === 0) return;
        // Don't drop onto itself
        const normTarget = dropPath.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
        const isSelf = paths.some(p => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() === normTarget);
        if (isSelf) return;
        try {
            const cmd = e.ctrlKey ? 'copy_items' : 'move_items';
            await invoke(cmd, { sources: paths, dest: dropPath });
            window.dispatchEvent(new CustomEvent('explorer-refresh'));
        } catch (err) {
            console.error('[Sidebar Drop] failed:', err);
        } finally {
            clearDraggedPaths();
        }
    };

    return (
        <button
            className={`sidebar-item ${active ? 'sidebar-item--active' : ''} ${isDrop ? 'sidebar-item--droptarget' : ''}`}
            onClick={onClick}
            title={label}
            onContextMenu={onContextMenu}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <span className="sidebar-item-icon">{icon}</span>
            <span className="sidebar-item-label">
                {label}
            </span>
        </button>
    );
}

function SidebarDropdown({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
    return (
        <AnimatePresence initial={false}>
            {isOpen && (
                <motion.div
                    key="dropdown"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="sidebar-dropdown"
                    style={{ overflow: 'hidden' }}
                >
                    {children}
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export interface SidebarProps {
    collapsed?: boolean;
}

export function Sidebar({ collapsed }: SidebarProps) {
    const [drives, setDrives] = useState<DriveInfo[]>([]);
    const [sysPaths, setSysPaths] = useState<SystemPaths | null>(null);
    const [pinned, setPinned] = useState<string[]>([]);
    const [quickOpen, setQuickOpen] = useState(true);
    const [pinnedOpen, setPinnedOpen] = useState(true);
    const [drivesOpen, setDrivesOpen] = useState(true);
    const [recentsOpen, setRecentsOpen] = useState(true);
    const [tagsOpen, setTagsOpen] = useState(() => {
        try { return JSON.parse(localStorage.getItem('explorer-tags-open') ?? 'true'); } catch { return true; }
    });
    const [driveDropTarget, setDriveDropTarget] = useState<string | null>(null);
    const [tagDropTarget, setTagDropTarget] = useState<string | null>(null);
    const [isCollapsingAnim, setIsCollapsingAnim] = useState(false);
    const recents = useRecentStore(s => s.recents);
    const removeRecent = useRecentStore(s => s.removeRecent);
    const showRecent = useSettingsStore(s => s.showRecentInSidebar);
    const showPinned = useSettingsStore(s => s.showPinnedInSidebar);
    const showTags = useSettingsStore(s => s.showTagsInSidebar);
    const fileTags = useTagStore(s => s.tags);
    const setTag = useTagStore(s => s.setTag);

    const activeWs = usePanelStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId) || s.workspaces[0]);
    if (!activeWs) return null;

    const panels = activeWs.panels;
    const activePanelId = activeWs.activePanelId || panels[0]?.id;
    const navigate = usePanelStore((s) => s.navigate);
    const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
    const backgroundImage = useSettingsStore((s) => s.backgroundImage);

    useEffect(() => {
        const effectiveWidth = collapsed ? 64 : sidebarWidth;
        document.documentElement.style.setProperty('--sidebar-live-width', `${effectiveWidth}px`);
    }, [collapsed, sidebarWidth]);

    useEffect(() => {
        setIsCollapsingAnim(true);
        document.documentElement.setAttribute('data-sidebar-animating', '1');
        window.dispatchEvent(new CustomEvent('explorer-sidebar-animation-start'));
        const t = window.setTimeout(() => setIsCollapsingAnim(false), 340);
        return () => {
            window.clearTimeout(t);
        };
    }, [collapsed]);

    useEffect(() => {
        if (isCollapsingAnim) return;
        document.documentElement.setAttribute('data-sidebar-animating', '0');
        window.dispatchEvent(new CustomEvent('explorer-sidebar-animation-end'));
    }, [isCollapsingAnim]);

    useEffect(() => {
        invoke<DriveInfo[]>('get_drives').then((nextDrives) => {
            setDrives(nextDrives);
            nextDrives.forEach((d) => {
                if (d.drive_type === 'fixed') {
                    invoke('build_mft_index', { driveLetter: d.letter[0] }).catch(console.error);
                }
            });
        }).catch(() => { });

        invoke<SystemPaths>('get_system_paths').then(setSysPaths).catch(() => { });

        const loadPinned = () => {
            try { setPinned(JSON.parse(localStorage.getItem('explorer-pinned') ?? '[]')); }
            catch { setPinned([]); }
        };
        loadPinned();
        const onPins = () => loadPinned();
        window.addEventListener('explorer-pins-changed', onPins as any);
        window.addEventListener('storage', onPins as any);
        return () => {
            window.removeEventListener('explorer-pins-changed', onPins as any);
            window.removeEventListener('storage', onPins as any);
        };
    }, []);

    const activePanel = panels.find((p) => p.id === activePanelId) ?? panels[0];
    const activeTab = activePanel?.tabs.find((t) => t.id === activePanel?.activeTabId);
    const currentPath = activeTab?.path ?? '';

    const goTo = (path: string) => {
        if (!activePanel) return;
        navigate(activePanel.id, activePanel.activeTabId, path);
    };

    const goToTag = (tagId: string) => {
        if (!activePanel) return;
        navigate(activePanel.id, activePanel.activeTabId, `tag:${tagId}`);
    };

    const openPinned = async (path: string) => {
        try {
            const meta = await invoke<{ is_dir: boolean }>('get_file_metadata', { path });
            if (meta?.is_dir) goTo(path);
            else await invoke('open_file', { path });
        } catch {
            // Fallback: try navigate (folders) then open
            try { goTo(path); } catch { }
            try { await invoke('open_file', { path }); } catch { }
        }
    };

    const removePin = (path: string) => {
        const next = pinned.filter((p) => p !== path);
        setPinned(next);
        localStorage.setItem('explorer-pinned', JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('explorer-pins-changed'));
    };

    const setSidebarWidth = useSettingsStore((s) => s.setSidebarWidth);

    const handleResizeMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = sidebarWidth;

        const onMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            const newWidth = Math.max(140, Math.min(400, startWidth + delta));
            setSidebarWidth(newWidth);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const handleDriveDragOver = (e: React.DragEvent, letter: string) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
        setDriveDropTarget(letter);
    };

    const handleDriveDrop = async (e: React.DragEvent, drivePath: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDriveDropTarget(null);
        const paths = getDraggedPaths(e.dataTransfer);
        if (paths.length === 0) return;
        try {
            const cmd = e.ctrlKey ? 'copy_items' : 'move_items';
            await invoke(cmd, { sources: paths, dest: drivePath });
            window.dispatchEvent(new CustomEvent('explorer-refresh'));
        } catch (err) {
            console.error('[Sidebar Drive Drop] failed:', err);
        } finally {
            clearDraggedPaths();
        }
    };

    const targetSidebarWidth = collapsed ? 64 : sidebarWidth;

    return (
        <motion.aside
            className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}
            initial={false}
            animate={{ width: targetSidebarWidth }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
            data-transparent={!!backgroundImage}
            data-collapsing={isCollapsingAnim ? '1' : '0'}
        >
            <div className="sidebar-inner">
            <div className="sidebar-content">
                <div className="sidebar-section">
                    <button
                        className="sidebar-section-header"
                        onClick={() => setQuickOpen((o) => !o)}
                    >
                        {!collapsed && <ChevronRight size={12} className={`chevron ${quickOpen ? 'chevron--open' : ''}`} />}
                        <span className="sidebar-section-title">Quick Access</span>
                    </button>
                    <SidebarDropdown isOpen={quickOpen && !!sysPaths}>
                        {sysPaths && Object.entries(sysPaths).map(([key, path]) => {
                            const targetPath = key === 'home' ? '' : path;
                            return (
                                <SidebarItem
                                    key={key}
                                    collapsed={!!collapsed}
                                    icon={QUICK_ACCESS_ICONS[key] ?? <FileText size={14} />}
                                    label={QUICK_ACCESS_LABELS[key] ?? key}
                                    onClick={() => goTo(targetPath)}
                                    active={currentPath === targetPath || (key === 'home' && currentPath === '')}
                                    dropPath={key === 'home' ? undefined : path}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'sidebar-quick', files: [], currentDir: targetPath, sidebarPath: targetPath, sidebarLabel: QUICK_ACCESS_LABELS[key] ?? key });
                                    }}
                                />
                            );
                        })}
                    </SidebarDropdown>
                </div>

                {showRecent && recents.length > 0 && (
                    <div className="sidebar-section">
                        <button
                            className="sidebar-section-header"
                            onClick={() => setRecentsOpen((o) => !o)}
                        >
                            {!collapsed && <ChevronRight size={12} className={`chevron ${recentsOpen ? 'chevron--open' : ''}`} />}
                            <span className="sidebar-section-title">Recent</span>
                        </button>
                        <SidebarDropdown isOpen={recentsOpen}>
                            {recents.slice(0, 10).map((r) => {
                                const parts = r.path.replace(/\\/g, '/').split('/').filter(Boolean);
                                const name = parts[parts.length - 1] ?? r.path;
                                return (
                                    <div key={r.path} className="sidebar-item-row">
                                        <SidebarItem
                                            collapsed={!!collapsed}
                                            icon={<Clock size={13} />}
                                            label={name}
                                            onClick={() => goTo(r.path)}
                                            active={currentPath === r.path}
                                            dropPath={r.path}
                                        />
                                        {!collapsed && (
                                            <button
                                                className="sidebar-pin-remove"
                                                title="Remove from recent"
                                                onClick={() => removeRecent(r.path)}
                                            >
                                                <X size={10} />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </SidebarDropdown>
                    </div>
                )}

                <div className="sidebar-section">
                    <button
                        className="sidebar-section-header"
                        onClick={() => setDrivesOpen((o) => !o)}
                    >
                        {!collapsed && <ChevronRight size={12} className={`chevron ${drivesOpen ? 'chevron--open' : ''}`} />}
                        <span className="sidebar-section-title">Drives</span>
                    </button>
                    <SidebarDropdown isOpen={drivesOpen}>
                        {drives.map((d) => {
                            const usedPct = d.total > 0 ? ((d.total - d.free) / d.total) * 100 : 0;
                            const drivePath = `${d.letter}\\`;
                            const isDropping = driveDropTarget === d.letter;
                            return (
                                <div
                                    key={d.letter}
                                    className={`sidebar-drive ${isDropping ? 'sidebar-drive--droptarget' : ''}`}
                                    onClick={() => goTo(drivePath)}
                                    onDragOver={(e) => handleDriveDragOver(e, d.letter)}
                                    onDragLeave={() => setDriveDropTarget(null)}
                                    onDrop={(e) => handleDriveDrop(e, drivePath)}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'sidebar-drive', files: [], currentDir: drivePath, sidebarPath: drivePath, sidebarLabel: `${d.letter} ${d.label && `(${d.label})`}` });
                                    }}
                                >
                                    <div className="sidebar-drive-header">
                                        <HardDrive size={13} />
                                        {!collapsed && (
                                            <>
                                                <span className="sidebar-drive-label">{d.letter} {d.label && `(${d.label})`}</span>
                                                <span className="sidebar-drive-free">{formatBytes(d.free)} free</span>
                                            </>
                                        )}
                                    </div>
                                    {!collapsed && (
                                        <div className="sidebar-drive-bar">
                                            <div className="sidebar-drive-bar-fill" style={{ width: `${Math.min(100, usedPct)}%`, background: usedPct > 90 ? 'var(--error)' : 'var(--accent)' }} />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </SidebarDropdown>
                </div>

                {/* ─── Tags Section ──────────────────────────────── */}
                {showTags && <div className="sidebar-section">
                    <button
                        className="sidebar-section-header"
onClick={() => setTagsOpen((o: boolean) => { const next = !o; localStorage.setItem('explorer-tags-open', JSON.stringify(next)); return next; })}
                    >
                        {!collapsed && <ChevronRight size={12} className={`chevron ${tagsOpen ? 'chevron--open' : ''}`} />}
                        <span className="sidebar-section-title">Tags</span>
                    </button>
                    <SidebarDropdown isOpen={tagsOpen}>
                        {(() => {
                            const counts: Record<string, number> = {};
                            Object.values(fileTags).forEach(colorId => {
                                counts[colorId] = (counts[colorId] || 0) + 1;
                            });
                            return TAG_COLORS.map(tc => {
                                const count = counts[tc.id] || 0;
                                return (
                                    <button
                                        key={tc.id}
                                        className={`sidebar-item sidebar-tag-item ${tagDropTarget === tc.id ? 'sidebar-item--droptarget' : ''}`}
                                        title={tc.label}
                                        onClick={() => {
                                            goToTag(tc.id);
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
                                            setTagDropTarget(tc.id);
                                        }}
                                        onDragLeave={() => setTagDropTarget(null)}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setTagDropTarget(null);
                                            const paths = getDraggedPaths(e.dataTransfer);
                                            if (paths.length === 0) return;
                                            paths.forEach(p => setTag(p, tc.id));
                                            clearDraggedPaths();
                                        }}
                                    >
                                        <span className="sidebar-tag-dot" style={{ background: tc.hex }} />
                                        {!collapsed && (
                                            <>
                                                <span className="sidebar-item-label">
                                                    {tc.label}
                                                </span>
                                                {count > 0 && <span className="sidebar-tag-count">{count}</span>}
                                            </>
                                        )}
                                    </button>
                                );
                            });
                        })()}
                    </SidebarDropdown>
                </div>}

                {showPinned && (
                    <div className="sidebar-section">
                        <button
                            className="sidebar-section-header"
                            onClick={() => setPinnedOpen((o) => !o)}
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'; }}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const paths = getDraggedPaths(e.dataTransfer);
                                if (paths.length === 0) return;
                                try {
                                    const existing: string[] = JSON.parse(localStorage.getItem('explorer-pinned') ?? '[]');
                                    const next = [...existing];
                                    paths.forEach(p => { if (!next.includes(p)) next.push(p); });
                                    localStorage.setItem('explorer-pinned', JSON.stringify(next));
                                } catch { }
                                window.dispatchEvent(new CustomEvent('explorer-pins-changed'));
                                clearDraggedPaths();
                            }}
                        >
                            {!collapsed && <ChevronRight size={12} className={`chevron ${pinnedOpen ? 'chevron--open' : ''}`} />}
                            <Pin size={11} />
                            <span className="sidebar-section-title">Pinned</span>
                        </button>
                        <SidebarDropdown isOpen={pinnedOpen}>
                            {pinned.length === 0 && !collapsed && (
                                <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                                    Right-click a file/folder and Pin it, or drag here.
                                </div>
                            )}
                            {pinned.map((p) => (
                                <div key={p} className="sidebar-item-row">
                                    <SidebarItem
                                        collapsed={!!collapsed}
                                        icon={<Star size={13} />}
                                        label={p.split('\\').pop() ?? p}
                                        onClick={() => openPinned(p)}
                                        active={currentPath === p}
                                        dropPath={p}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'sidebar-pinned', files: [], currentDir: p, sidebarPath: p, sidebarLabel: p.split('\\').pop() ?? p });
                                        }}
                                    />
                                    {!collapsed && (
                                        <button
                                            className="sidebar-pin-remove"
                                            onClick={() => removePin(p)}
                                            title="Unpin"
                                        >
                                            <X size={10} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </SidebarDropdown>
                    </div>
                )}

            </div>
            <div className="sidebar-footer">
                <SidebarItem
                    collapsed={!!collapsed}
                    active={currentPath === 'shell:RecycleBinFolder'}
                    icon={<Trash2 size={14} />}
                    label="Recycle Bin"
                    onClick={() => (window as any).__explorerRecycleBin?.()}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'sidebar-recycle', files: [], currentDir: 'shell:RecycleBinFolder' });
                    }}
                />
            </div>
            </div>
            {!collapsed && <div className="sidebar-resize-handle" onMouseDown={handleResizeMouseDown} />}
        </motion.aside>
    );
}
