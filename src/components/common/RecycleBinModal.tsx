import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Trash2, RefreshCw, X, LayoutGrid, List, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatBytes } from '../../utils/formatters';
import { FileEntry } from '../../hooks/useDirectory';
import { SystemFileIcon } from './Icons';
import { IMAGE_EXTS } from '../../utils/fileTypes';
import { useSettingsStore } from '../../store/settingsStore';
import { QuickLook } from '../preview/QuickLook';
import './RecycleBinModal.css';

interface MarqueeRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface Props {
    open: boolean;
    onClose: () => void;
}

export function RecycleBinModal({ open, onClose }: Props) {
    const [items, setItems] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [lastSelected, setLastSelected] = useState<string | null>(null);
    const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
    const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
    const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
    const [entryRevealing, setEntryRevealing] = useState(false);
    const hasRevealedThisOpenRef = useRef(false);
    const bodyRef = useRef<HTMLDivElement>(null);
    const marqueeRef = useRef<{ active: boolean; moved: boolean; additive: boolean; startX: number; startY: number; baseSelection: Set<string> }>({
        active: false,
        moved: false,
        additive: false,
        startX: 0,
        startY: 0,
        baseSelection: new Set()
    });

    const { viewMode: globalViewMode, setViewMode: setGlobalViewMode, iconScale, setIconScale } = useSettingsStore();
    const actualViewMode = globalViewMode === 'grid' ? 'grid' : 'list';

    const handleViewModeToggle = (mode: 'list' | 'grid') => {
        setGlobalViewMode(mode === 'list' ? 'details' : 'grid');
    };

    const loadItems = useCallback(async () => {
        if (!open) return;
        setLoading(true);
        try {
            const result = await invoke<FileEntry[]>('read_dir', { path: 'shell:RecycleBinFolder' });
            setItems(result);
        } catch (e) {
            console.error('Failed to load recycle bin:', e);
        }
        setLoading(false);
    }, [open]);

    useEffect(() => {
        if (!open) {
            setSelectedPaths(new Set());
            setLastSelected(null);
            setSelectionAnchor(null);
            setPreviewFile(null);
            setEntryRevealing(false);
            hasRevealedThisOpenRef.current = false;
        } else {
            loadItems();
        }
    }, [open, loadItems]);

    useEffect(() => {
        if (!open || loading || items.length === 0 || hasRevealedThisOpenRef.current) return;
        hasRevealedThisOpenRef.current = true;
        const start = setTimeout(() => setEntryRevealing(true), 150);
        const stop = setTimeout(() => setEntryRevealing(false), 620);
        return () => {
            clearTimeout(start);
            clearTimeout(stop);
        };
    }, [open, loading, items.length]);

    // Listen for custom event to refresh RB
    useEffect(() => {
        const handleRefresh = () => {
            if (open) loadItems();
        };
        window.addEventListener('explorer-recycle-bin-refresh', handleRefresh);
        return () => window.removeEventListener('explorer-recycle-bin-refresh', handleRefresh);
    }, [open, loadItems]);

    const handleEmptyTrash = async () => {
        (window as any).__explorerConfirmDialog?.({
            title: 'Empty Trash',
            message: 'Are you sure you want to permanently empty the Recycle Bin? This cannot be undone.',
            type: 'danger',
            confirmLabel: 'Empty',
            onConfirm: async () => {
                try {
                    await invoke('empty_trash');
                    loadItems();
                } catch (e) {
                    console.error('Failed to empty trash:', e);
                }
            }
        });
    };

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            // Prevent closing if a higher-priority popup is currently open
            const hasPriorityPopup = document.querySelector('.confirm-dialog-overlay, .input-dialog-overlay, .ctx-menu');
            if (hasPriorityPopup) return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            onClose();
        } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            setSelectedPaths(new Set(items.map(i => i.path)));
        } else if (e.key === ' ' || e.code === 'Space') {
            if (selectedPaths.size === 0) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            const first = items.find(i => selectedPaths.has(i.path));
            if (first && !first.is_dir) setPreviewFile(first);
        } else if (e.key === 'Delete') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            if (selectedPaths.size === 0) return;
            (window as any).__explorerConfirmDialog?.({
                title: 'Delete Permanently',
                message: `Are you sure you want to permanently delete ${selectedPaths.size} item(s)? This cannot be undone.`,
                type: 'danger',
                confirmLabel: 'Delete',
                onConfirm: async () => {
                    try {
                        await invoke('delete_items', { paths: Array.from(selectedPaths) });
                        setSelectedPaths(new Set());
                        loadItems();
                    } catch (err) {
                        console.error('Failed to permanently delete items:', err);
                    }
                }
            });
        }
    }, [onClose, items, selectedPaths, loadItems]);

    useEffect(() => {
        if (open) {
            window.addEventListener('keydown', handleKeyDown, { capture: true });
            return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
        }
    }, [open, handleKeyDown]);

    useEffect(() => {
        const handler = (e: WheelEvent) => {
            if (!open || !e.ctrlKey) return;
            e.preventDefault();
            setIconScale(Math.round(Math.max(0.75, Math.min(2.0, iconScale + (e.deltaY < 0 ? 0.1 : -0.1))) * 100) / 100);
        };
        window.addEventListener('wheel', handler, { passive: false });
        return () => window.removeEventListener('wheel', handler);
    }, [open, iconScale, setIconScale]);

    const totalSize = items.reduce((acc, it) => acc + (it.size || 0), 0);

    const handleClick = (e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        const newSet = new Set(selectedPaths);
        if (e.ctrlKey || e.metaKey) {
            if (newSet.has(path)) newSet.delete(path);
            else newSet.add(path);
            setLastSelected(path);
        } else if (e.shiftKey && selectionAnchor !== null) {
            const idx1 = items.findIndex(i => i.path === selectionAnchor);
            const idx2 = items.findIndex(i => i.path === path);
            const start = Math.min(idx1 >= 0 ? idx1 : idx2, idx2);
            const end = Math.max(idx1 >= 0 ? idx1 : idx2, idx2);
            newSet.clear();
            for (let i = start; i <= end; i++) {
                newSet.add(items[i].path);
            }
        } else {
            newSet.clear();
            newSet.add(path);
            setSelectionAnchor(path);
            setLastSelected(path);
        }
        setLastSelected(path);
        setSelectedPaths(newSet);
    };

    const handleContextMenu = (e: React.MouseEvent, path: string) => {
        e.preventDefault();
        e.stopPropagation();
        let currentSelection = new Set(selectedPaths);
        if (!currentSelection.has(path)) {
            currentSelection = new Set([path]);
            setSelectedPaths(currentSelection);
            setLastSelected(path);
        }
        const selectedFiles = items.filter(i => currentSelection.has(i.path));
        (window as any).__explorerContextMenu?.({
            x: e.clientX,
            y: e.clientY,
            type: 'recycle-bin-item',
            files: selectedFiles,
            currentDir: 'shell:RecycleBinFolder'
        });
    };

    const handleContainerClick = () => {
        (window as any).__explorerContextMenu?.(null);
        if (!marqueeRef.current.active) {
            setSelectedPaths(new Set());
            setLastSelected(null);
            setSelectionAnchor(null);
        }
    };

    const beginMarqueeSelection = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const host = bodyRef.current;
        if (!host) return;
        const target = e.target as HTMLElement;
        if (target.closest('.rb-grid-item') || target.closest('.rb-list-item') || target.closest('.rb-header') || target.closest('button')) return;

        const hostRect = host.getBoundingClientRect();
        const startX = Math.max(0, Math.min(hostRect.width, e.clientX - hostRect.left));
        const startY = Math.max(0, Math.min(hostRect.height, e.clientY - hostRect.top));
        const additive = e.ctrlKey || e.metaKey;
        const baseSelection = additive ? new Set(selectedPaths) : new Set<string>();

        marqueeRef.current = {
            active: true,
            moved: false,
            additive,
            startX,
            startY,
            baseSelection
        };
        setMarqueeRect({ left: startX, top: startY, width: 0, height: 0 });
        if (!additive) {
            setSelectedPaths(new Set());
            setLastSelected(null);
            setSelectionAnchor(null);
        }
        document.body.style.userSelect = 'none';

        const onMove = (ev: MouseEvent) => {
            const state = marqueeRef.current;
            if (!state.active) return;
            const currentX = Math.max(0, Math.min(hostRect.width, ev.clientX - hostRect.left));
            const currentY = Math.max(0, Math.min(hostRect.height, ev.clientY - hostRect.top));
            const left = Math.min(state.startX, currentX);
            const top = Math.min(state.startY, currentY);
            const width = Math.abs(currentX - state.startX);
            const height = Math.abs(currentY - state.startY);
            if (width > 3 || height > 3) state.moved = true;
            setMarqueeRect({ left, top, width, height });

            const marqueeLeft = hostRect.left + left;
            const marqueeTop = hostRect.top + top;
            const marqueeRight = marqueeLeft + width;
            const marqueeBottom = marqueeTop + height;
            const next = new Set(state.baseSelection);
            host.querySelectorAll<HTMLElement>('[data-rb-path]').forEach((el) => {
                const rect = el.getBoundingClientRect();
                const ok = rect.left < marqueeRight && rect.right > marqueeLeft && rect.top < marqueeBottom && rect.bottom > marqueeTop;
                if (ok) {
                    const path = el.getAttribute('data-rb-path');
                    if (path) next.add(path);
                }
            });
            setSelectedPaths(next);
        };

        const onUp = () => {
            const state = marqueeRef.current;
            if (!state.active) return;
            state.active = false;
            setMarqueeRect(null);
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (!state.moved && !state.additive) {
                setSelectedPaths(new Set());
                setLastSelected(null);
                setSelectionAnchor(null);
            }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [selectedPaths]);

    const openPreview = () => {
        const first = items.find(i => selectedPaths.has(i.path));
        if (first) setPreviewFile(first);
    };

    return (
        <AnimatePresence initial={false} mode="wait">
            {open && (
                <motion.div
                    key="rb-overlay"
                    className="rb-overlay"
                    onMouseDown={onClose}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{
                        opacity: 0,
                        transition: { duration: 0.34, ease: [0.4, 0, 1, 1] }
                    }}
                    transition={{
                        opacity: { duration: 0.14, ease: [0.22, 1, 0.36, 1] }
                    }}
                >
                    <motion.div
                        key="rb-container"
                        className="rb-container"
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            (window as any).__explorerContextMenu?.(null);
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        initial={{ scale: 0.995, opacity: 0, y: 4 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{
                            scale: 0.9,
                            opacity: 0,
                            y: 42,
                            transition: {
                                opacity: { duration: 0.28, ease: [0.4, 0, 1, 1] },
                                y: { duration: 0.34, ease: [0.4, 0, 1, 1] },
                                scale: { duration: 0.34, ease: [0.4, 0, 1, 1] }
                            }
                        }}
                        transition={{
                            opacity: { duration: 0.14, ease: [0.22, 1, 0.36, 1] },
                            y: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
                            scale: { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
                        }}
                    >
                        <div className="rb-header">
                            <Trash2 size={16} className="rb-header-icon" />
                            <span className="rb-title">Recycle Bin</span>
                            <span className="rb-meta">{items.length} items • {formatBytes(totalSize)}</span>
                            <div style={{ flex: 1 }} />
                            <div className="rb-view-toggles">
                                <button className="rb-view-btn" data-active={actualViewMode === 'list'} onClick={() => handleViewModeToggle('list')} title="List View"><List size={14} /></button>
                                <button className="rb-view-btn" data-active={actualViewMode === 'grid'} onClick={() => handleViewModeToggle('grid')} title="Grid View"><LayoutGrid size={14} /></button>
                            </div>
                            <button className="rb-btn rb-btn-outline" onClick={(e) => { e.stopPropagation(); openPreview(); }} disabled={selectedPaths.size === 0} title="Preview">
                                <Eye size={14} />
                            </button>
                            <button className="rb-btn rb-btn-outline" style={{ marginLeft: '4px' }} onClick={(e) => { e.stopPropagation(); loadItems(); }} title="Refresh">
                                <RefreshCw size={14} />
                            </button>
                            <button className="rb-btn rb-btn-danger" onClick={(e) => { e.stopPropagation(); handleEmptyTrash(); }} disabled={items.length === 0}>
                                Empty Trash
                            </button>
                            <button className="rb-close" onClick={onClose} title="Close (Esc)">
                                <X size={14} />
                            </button>
                        </div>

                        <div
                            ref={bodyRef}
                            className="rb-body rb-body--marquee"
                            onMouseDown={(e) => {
                                if (!(e.target as HTMLElement).closest?.('.rb-grid-item') && !(e.target as HTMLElement).closest?.('.rb-list-item')) {
                                    beginMarqueeSelection(e);
                                }
                            }}
                            onContextMenu={(e) => e.preventDefault()}
                        >
                            {marqueeRect && (
                                <div
                                    className="rb-marquee"
                                    style={{
                                        left: marqueeRect.left,
                                        top: marqueeRect.top,
                                        width: Math.max(1, marqueeRect.width),
                                        height: Math.max(1, marqueeRect.height)
                                    }}
                                />
                            )}
                            {loading ? (
                                <div className="rb-empty">Loading...</div>
                            ) : items.length === 0 ? (
                                <div className="rb-empty">
                                    <Trash2 size={36} opacity={0.3} />
                                    <div style={{ marginTop: 12 }}>Recycle Bin is empty</div>
                                </div>
                            ) : actualViewMode === 'grid' ? (() => {
                                const cardMin = Math.max(90, Math.min(260, Math.round(130 * iconScale)));
                                const previewH = Math.max(60, Math.min(200, Math.round(92 * iconScale)));
                                const iconSz = Math.max(44, Math.min(140, Math.round(72 * iconScale)));

                                return (
                                    <div className={`rb-grid ${entryRevealing ? 'is-revealing' : ''}`} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardMin}px, 1fr))` }}>
                                        {items.map((it, idx) => {
                                            const ext = it.extension?.toLowerCase() || '';
                                            const isImage = IMAGE_EXTS.has(ext);
                                            return (
                                                <div
                                                    key={idx}
                                                    className="rb-grid-item"
                                                    style={{ '--rb-reveal-delay': `${Math.min(idx, 18) * 18}ms` } as React.CSSProperties}
                                                    data-rb-path={it.path}
                                                    data-selected={selectedPaths.has(it.path)}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => handleClick(e, it.path)}
                                                    onDoubleClick={(e) => { e.stopPropagation(); if (!it.is_dir) setPreviewFile(it); }}
                                                    onContextMenu={(e) => handleContextMenu(e, it.path)}
                                                >
                                                    <div className="rb-grid-preview" style={{ height: `${previewH}px` }}>
                                                        {isImage ? (
                                                            <img src={convertFileSrc(it.path)} alt={it.name} className="rb-grid-thumb" loading="lazy" decoding="async" />
                                                        ) : (
                                                            <div className="rb-grid-icon-wrap">
                                                                <SystemFileIcon path={it.path} size={iconSz} extension={ext} isDir={it.is_dir} />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="rb-grid-info">
                                                        <span className="rb-grid-name" title={it.name}>{it.name}</span>
                                                        <span className="rb-grid-size">{it.is_dir ? 'Folder' : formatBytes(it.size)}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )
                            })() : (
                                <div className={`rb-list ${entryRevealing ? 'is-revealing' : ''}`}>
                                    {items.map((it, idx) => {
                                        const ext = it.extension?.toLowerCase() || '';
                                        const iconSz = Math.max(16, Math.min(32, Math.round(16 * iconScale)));
                                        return (
                                            <div
                                                key={idx}
                                                className="rb-list-item"
                                                style={{ '--rb-reveal-delay': `${Math.min(idx, 18) * 16}ms` } as React.CSSProperties}
                                                data-rb-path={it.path}
                                                data-selected={selectedPaths.has(it.path)}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onClick={(e) => handleClick(e, it.path)}
                                                onDoubleClick={(e) => { e.stopPropagation(); if (!it.is_dir) setPreviewFile(it); }}
                                                onContextMenu={(e) => handleContextMenu(e, it.path)}
                                            >
                                                <div className="rb-item-icon">
                                                    <SystemFileIcon path={it.path} size={iconSz} extension={ext} isDir={it.is_dir} />
                                                </div>
                                                <div className="rb-item-info">
                                                    <div className="rb-item-name">{it.name}</div>
                                                    <div className="rb-item-path" title={it.path}>{it.path}</div>
                                                </div>
                                                <div className="rb-item-size">
                                                    {!it.is_dir && formatBytes(it.size)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
            <QuickLook file={previewFile} open={!!previewFile} onClose={() => setPreviewFile(null)} />
        </AnimatePresence>
    );
}
