import { useRef, useState, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { SystemFileIcon } from '../common/Icons';
import { FileEntry, useDirectory, SortKey } from '../../hooks/useDirectory';
import { usePanelStore } from '../../store/panelStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTagStore, TAG_COLORS } from '../../store/tagStore';
import { useClipboardStore } from '../../store/clipboardStore';
import { groupFilesByType } from '../../utils/groupFiles';
import type { TabState } from '../../store/panelStore';
import { formatBytes, formatDate } from '../../utils/formatters';
import { getFileType } from '../../utils/fileTypes';
import { clearDraggedPaths, getDraggedPaths, setDraggedPaths, createDragPreview, cleanupDragPreview } from '../../utils/dragDrop';
import { pasteWithConflictCheck } from '../../utils/paste';
import { useVimHotkeys } from '../../hooks/useVimHotkeys';

import './DetailsView.css';

interface Props {
    panelId: string;
    tab: TabState;
    onFileSelect?: (file: FileEntry | null) => void;
    iconScale?: number;
}

interface Column { key: SortKey | 'name'; label: string; width: number; }
const COLUMNS: Column[] = [
    { key: 'name', label: 'Name', width: 280 },
    { key: 'size', label: 'Size', width: 90 },
    { key: 'modified', label: 'Date Modified', width: 140 },
    { key: 'extension', label: 'Type', width: 100 },
];

interface MarqueeRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export function DetailsView({ panelId, tab, onFileSelect, iconScale = 1 }: Props) {
    const { files, loading, error, sortKey, sortDir, toggleSort } = useDirectory(tab.path, tab.searchQuery);
    const navigate = usePanelStore(s => s.navigate);
    const dateFormat = useSettingsStore(s => s.dateFormat);
    const showExtensions = useSettingsStore(s => s.showExtensions);
    const rowSpacing = useSettingsStore(s => s.rowSpacing);
    const singleClickToOpen = useSettingsStore(s => s.singleClickToOpen);
    const fileTags = useTagStore(s => s.tags);
    const groupByType = useSettingsStore(s => s.groupByType);
    const showHidden = useSettingsStore(s => s.showHidden);

    const filteredFiles = files;

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [lastSelected, setLastSelected] = useState<string | null>(null);
    const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [activeGroupTab, setActiveGroupTab] = useState('All');
    const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
    const clipboardPaths = useClipboardStore(s => s.paths);
    const clipboardAction = useClipboardStore(s => s.action);
    const selectedRef = useRef<Set<string>>(new Set());
    const suppressBackgroundClickRef = useRef(false);
    const lastOpenedRef = useRef<{ path: string; time: number } | null>(null);
    const marqueeRef = useRef<{
        active: boolean;
        moved: boolean;
        additive: boolean;
        startX: number;
        startY: number;
        baseSelection: Set<string>;
    }>({
        active: false,
        moved: false,
        additive: false,
        startX: 0,
        startY: 0,
        baseSelection: new Set<string>()
    });

    const containerRef = useRef<HTMLDivElement>(null);
    const baseRowHeight = rowSpacing === 'compact' ? 24 : rowSpacing === 'relaxed' ? 36 : 28;
    const rowHeight = Math.max(22, Math.min(80, Math.round(baseRowHeight * iconScale)));
    const iconSize = Math.max(14, Math.min(56, Math.round(18 * iconScale)));
    const fontSize = Math.max(10, Math.min(20, Math.round(13 * Math.sqrt(iconScale))));

    const virtualizer = useVirtualizer({
        count: filteredFiles.length,
        getScrollElement: () => containerRef.current,
        estimateSize: () => rowHeight,
        overscan: 20,
    });

    const persistSelection = useCallback((next: Set<string>) => {
        requestAnimationFrame(() => {
            const selPaths = [...next];
            if (selPaths.length > 0) {
                localStorage.setItem(`explorer-selected-${tab.path}`, JSON.stringify(selPaths));
            } else {
                localStorage.removeItem(`explorer-selected-${tab.path}`);
            }

            const selFiles = filteredFiles.filter((f) => next.has(f.path));
            const selSize = selFiles.reduce((sum, f) => sum + (f.is_dir ? 0 : f.size), 0);

            window.dispatchEvent(new CustomEvent('explorer-selection-change', {
                detail: { count: next.size, size: selSize, currentDir: tab.path }
            }));
        });
    }, [filteredFiles, tab.path]);

    useEffect(() => {
        selectedRef.current = selected;
    }, [selected]);

    useEffect(() => {
        setSelectionAnchor(null);
    }, [tab.path]);

    const handleClick = useCallback((e: React.MouseEvent, file: FileEntry) => {
        let nextSelected: Set<string>;
        if (e.ctrlKey || e.metaKey) {
            nextSelected = new Set(selected);
            if (nextSelected.has(file.path)) nextSelected.delete(file.path); else nextSelected.add(file.path);
        } else if (e.shiftKey && selectionAnchor !== null) {
            const anchorIdx = filteredFiles.findIndex(f => f.path === selectionAnchor);
            const thisIdx = filteredFiles.findIndex(f => f.path === file.path);
            const [lo, hi] = [Math.min(anchorIdx >= 0 ? anchorIdx : thisIdx, thisIdx), Math.max(anchorIdx >= 0 ? anchorIdx : thisIdx, thisIdx)];
            nextSelected = new Set(filteredFiles.slice(lo, hi + 1).map(f => f.path));
        } else {
            nextSelected = new Set([file.path]);
            setSelectionAnchor(file.path);
        }
        setSelected(nextSelected);
        setLastSelected(file.path);
        onFileSelect?.(file);
        persistSelection(nextSelected);

        if (singleClickToOpen && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            const now = Date.now();
            if (lastOpenedRef.current?.path === file.path && now - lastOpenedRef.current.time < 350) return;
            lastOpenedRef.current = { path: file.path, time: now };
            if (file.is_dir) {
                navigate(panelId, tab.id, file.path);
            } else {
                invoke('increment_score', { path: file.path });
                invoke('open_file', { path: file.path }).catch(console.error);
            }
        }
    }, [selected, filteredFiles, selectionAnchor, onFileSelect, persistSelection, singleClickToOpen, navigate, panelId, tab.id]);

    useEffect(() => {
        const handler = () => {
            const allFiles = filteredFiles.map(f => f.path);
            const all = new Set(allFiles);
            setSelected(all);
            persistSelection(all);
        };
        window.addEventListener('explorer-select-all', handler);
        return () => window.removeEventListener('explorer-select-all', handler);
    }, [filteredFiles, persistSelection]);

    useEffect(() => {
        const handler = (e: Event) => {
            const ce = e as CustomEvent<string>;
            const path = ce.detail;
            const file = filteredFiles.find(f => f.path === path);
            if (file) {
                const nameNoExt = (file.is_dir || !file.extension) ? file.name : file.name.replace(new RegExp(`\\.${file.extension}$`), '');
                const ext = !file.is_dir && file.extension ? `.${file.extension}` : '';
                (window as any).__explorerInputDialog?.({
                    title: 'Rename Item',
                    type: 'rename',
                    initialValue: nameNoExt,
                    onSubmit: async (val: string) => {
                        if (!val.trim() || val === nameNoExt) return;
                        const newName = val.trim() + ext;
                        try {
                            await invoke('rename_item', { oldPath: file.path, newName });
                            window.dispatchEvent(new CustomEvent('explorer-refresh'));
                        } catch (err) { console.error(err); }
                    }
                });
            }
        };
        window.addEventListener('explorer-rename', handler);
        return () => window.removeEventListener('explorer-rename', handler);
    }, [filteredFiles]);

    const handleDoubleClick = useCallback((file: FileEntry) => {
        if (file.is_dir) {
            navigate(panelId, tab.id, file.path);
        } else {
            invoke('increment_score', { path: file.path });
            invoke('open_file', { path: file.path }).catch(console.error);
        }
    }, [panelId, tab.id, navigate]);



    const handleDragStart = useCallback((e: React.DragEvent, file: FileEntry) => {
        const paths = selected.has(file.path) ? [...selected] : [file.path];
        createDragPreview(e.dataTransfer, file, paths.length, e.currentTarget as HTMLElement);
        setDraggedPaths(e.dataTransfer, paths);
        e.dataTransfer.effectAllowed = 'copyMove';
    }, [selected]);

    const normalizePath = useCallback((path: string) => path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase(), []);

    const isInvalidDrop = useCallback((sourcePaths: string[], targetPath: string) => {
        const normalizedTarget = normalizePath(targetPath);
        return sourcePaths.some((sourcePath) => {
            const normalizedSource = normalizePath(sourcePath);
            return normalizedSource === normalizedTarget || normalizedTarget.startsWith(`${normalizedSource}\\`);
        });
    }, [normalizePath]);

    const handleDragOver = useCallback((e: React.DragEvent, file: FileEntry) => {
        if (!file.is_dir) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
        setDropTarget(file.path);
    }, []);

    const handleDragLeave = useCallback(() => {
        setDropTarget(null);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent, targetFolder: FileEntry) => {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(null);
        if (!targetFolder.is_dir) return;

        const sourcePaths = getDraggedPaths(e.dataTransfer);
        if (sourcePaths.length === 0) return;
        try {
            if (isInvalidDrop(sourcePaths, targetFolder.path)) return;
            const cmd = e.ctrlKey ? 'copy_items' : 'move_items';
            await invoke(cmd, { sources: sourcePaths, dest: targetFolder.path });
            window.dispatchEvent(new CustomEvent('explorer-refresh'));
        } catch (err) { console.error('Drop failed:', err); }
        finally { clearDraggedPaths(); }
    }, [isInvalidDrop]);

    const handleBgDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setDropTarget(null);
        const sourcePaths = getDraggedPaths(e.dataTransfer);
        if (sourcePaths.length === 0) return;
        try {
            if (isInvalidDrop(sourcePaths, tab.path)) return;
            const cmd = e.ctrlKey ? 'copy_items' : 'move_items';
            await invoke(cmd, { sources: sourcePaths, dest: tab.path });
            window.dispatchEvent(new CustomEvent('explorer-refresh'));
        } catch (err) { console.error('Drop failed:', err); }
        finally { clearDraggedPaths(); }
    }, [isInvalidDrop, tab.path]);

    useEffect(() => {
        const handler = async (e: KeyboardEvent) => {
            if (document.activeElement?.tagName === 'INPUT') return;
            const state = usePanelStore.getState();
            const activeWs = state.workspaces.find(w => w.id === state.activeWorkspaceId);
            if (!activeWs || activeWs.activePanelId !== panelId) return;

            if (e.key === ' ' && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                const selectedPath = [...selected][0];
                if (selectedPath) {
                    const file = files.find(f => f.path === selectedPath);
                    if (file && !file.is_dir) (window as any).__explorerQuickLook?.(file);
                }
            }

            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                if (key === 'c' && selected.size > 0) {
                    e.preventDefault();
                    useClipboardStore.getState().setClipboard([...selected], 'copy');
                } else if (key === 'x' && selected.size > 0) {
                    e.preventDefault();
                    useClipboardStore.getState().setClipboard([...selected], 'cut');
                } else if (key === 'v') {
                    e.preventDefault();
                    const clip = useClipboardStore.getState();
                    if (clip.paths.length > 0 && clip.action) {
                        await pasteWithConflictCheck(clip.paths, tab.path, clip.action, {
                            onSuccess: () => window.dispatchEvent(new CustomEvent('explorer-refresh')),
                            onClearClipboard: () => clip.clearClipboard()
                        });
                    }
                }
            }

            if (e.key === 'ArrowDown' && !e.ctrlKey) {
                e.preventDefault();
                const idx = lastSelected ? files.findIndex(f => f.path === lastSelected) : -1;
                const next = files[Math.min(idx + 1, files.length - 1)];
                if (next) { setSelected(new Set([next.path])); setLastSelected(next.path); onFileSelect?.(next); }
            }
            if (e.key === 'ArrowUp' && !e.ctrlKey) {
                e.preventDefault();
                const idx = lastSelected ? files.findIndex(f => f.path === lastSelected) : 1;
                const prev = files[Math.max(idx - 1, 0)];
                if (prev) { setSelected(new Set([prev.path])); setLastSelected(prev.path); onFileSelect?.(prev); }
            }
            if (e.key === 'Enter') {
                const selectedPath = [...selected][0];
                if (selectedPath) {
                    const file = files.find(f => f.path === selectedPath);
                    if (file) handleDoubleClick(file);
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [files, selected, lastSelected, panelId, handleDoubleClick, onFileSelect, tab.path]);

    const activeWs = usePanelStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId));
    const isPanelActive = activeWs?.activePanelId === panelId;

    useVimHotkeys(isPanelActive && document.activeElement?.tagName !== 'INPUT', {
        onNext: () => {
            const idx = lastSelected ? files.findIndex(f => f.path === lastSelected) : -1;
            const nextIdx = Math.min(idx + 1, files.length - 1);
            const next = files[nextIdx];
            if (next) {
                setSelected(new Set([next.path]));
                setLastSelected(next.path);
                onFileSelect?.(next);
                persistSelection(new Set([next.path]));
                virtualizer.scrollToIndex(nextIdx, { align: 'auto' });
            }
        },
        onPrev: () => {
            const idx = lastSelected ? files.findIndex(f => f.path === lastSelected) : 1;
            const prevIdx = Math.max(idx - 1, 0);
            const prev = files[prevIdx];
            if (prev) {
                setSelected(new Set([prev.path]));
                setLastSelected(prev.path);
                onFileSelect?.(prev);
                persistSelection(new Set([prev.path]));
                virtualizer.scrollToIndex(prevIdx, { align: 'auto' });
            }
        },
        onFirst: () => {
            const first = files[0];
            if (first) {
                setSelected(new Set([first.path]));
                setLastSelected(first.path);
                onFileSelect?.(first);
                persistSelection(new Set([first.path]));
                virtualizer.scrollToIndex(0, { align: 'start' });
            }
        },
        onLast: () => {
            const last = files[files.length - 1];
            if (last) {
                setSelected(new Set([last.path]));
                setLastSelected(last.path);
                onFileSelect?.(last);
                persistSelection(new Set([last.path]));
                virtualizer.scrollToIndex(files.length - 1, { align: 'end' });
            }
        },
        onParent: () => {
            invoke<string | null>('get_parent_path', { path: tab.path }).then(p => {
                if (p) navigate(panelId, tab.id, p);
            });
        },
        onOpen: () => {
            const sel = [...selected][0];
            const file = files.find(f => f.path === sel);
            if (file) handleDoubleClick(file);
        },
        onCenter: () => {
            const idx = lastSelected ? files.findIndex(f => f.path === lastSelected) : -1;
            if (idx !== -1) virtualizer.scrollToIndex(idx, { align: 'center' });
        }
    });

    const deselectGlobal = useCallback(() => {
        const next = new Set<string>();
        setSelected(next);
        setLastSelected(null);
        setSelectionAnchor(null);
        onFileSelect?.(null);
        persistSelection(next);
    }, [onFileSelect, persistSelection]);

    const handleBackgroundClick = useCallback(() => {
        if (suppressBackgroundClickRef.current) {
            suppressBackgroundClickRef.current = false;
            return;
        }
        deselectGlobal();
    }, [deselectGlobal]);

    const beginMarqueeSelection = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const host = containerRef.current;
        if (!host) return;

        const target = e.target as HTMLElement;
        if (target.closest('.details-row')) return;

        const hostRect = host.getBoundingClientRect();
        const startX = Math.max(0, Math.min(hostRect.width, e.clientX - hostRect.left)) + host.scrollLeft;
        const startY = Math.max(0, Math.min(hostRect.height, e.clientY - hostRect.top)) + host.scrollTop;
        const additive = e.ctrlKey || e.metaKey;
        const baseSelection = additive ? new Set(selectedRef.current) : new Set<string>();

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
            setSelected(new Set<string>());
            setLastSelected(null);
            setSelectionAnchor(null);
            onFileSelect?.(null);
        }
        document.body.style.userSelect = 'none';

        const onMove = (ev: MouseEvent) => {
            const state = marqueeRef.current;
            if (!state.active) return;

            const currentX = Math.max(0, Math.min(hostRect.width, ev.clientX - hostRect.left)) + host.scrollLeft;
            const currentY = Math.max(0, Math.min(hostRect.height, ev.clientY - hostRect.top)) + host.scrollTop;
            const left = Math.min(state.startX, currentX);
            const top = Math.min(state.startY, currentY);
            const width = Math.abs(currentX - state.startX);
            const height = Math.abs(currentY - state.startY);
            const rect = { left, top, width, height };

            if (width > 3 || height > 3) {
                state.moved = true;
            }

            setMarqueeRect(rect);
            if (!state.moved) return;

            const marqueeLeft = hostRect.left - host.scrollLeft + left;
            const marqueeTop = hostRect.top - host.scrollTop + top;
            const marqueeRight = marqueeLeft + width;
            const marqueeBottom = marqueeTop + height;

            const next = new Set(state.baseSelection);
            host.querySelectorAll<HTMLElement>('.details-row[data-file-path]').forEach((row) => {
                const rowRect = row.getBoundingClientRect();
                const intersects =
                    rowRect.left < marqueeRight &&
                    rowRect.right > marqueeLeft &&
                    rowRect.top < marqueeBottom &&
                    rowRect.bottom > marqueeTop;

                if (!intersects) return;
                const filePath = row.dataset.filePath;
                if (filePath) next.add(filePath);
            });

            setSelected(next);
        };

        const onUp = () => {
            const state = marqueeRef.current;
            if (!state.active) return;

            state.active = false;
            setMarqueeRect(null);
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);

            suppressBackgroundClickRef.current = true;

            if (state.moved) {
                persistSelection(selectedRef.current);
                return;
            }

            if (state.additive) {
                setSelected(state.baseSelection);
                persistSelection(state.baseSelection);
                return;
            }

            deselectGlobal();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [deselectGlobal, onFileSelect, persistSelection]);

    useEffect(() => {
        return () => {
            document.body.style.userSelect = '';
        };
    }, []);

    const renderRow = (file: FileEntry, _idx: number, isVirtualized: boolean = false, vRow?: any) => {
        const isSelected = selected.has(file.path);
        const isCut = clipboardAction === 'cut' && clipboardPaths.includes(file.path);
        const isCopy = clipboardAction === 'copy' && clipboardPaths.includes(file.path);
        const typeInfo = !file.is_dir ? getFileType(file.extension) : null;
        const displayName = showExtensions ? file.name : (file.is_dir ? file.name : (file.extension ? file.name.slice(0, -(file.extension.length + 1)) : file.name));

        const style: React.CSSProperties = isVirtualized ? {
            position: 'absolute',
            top: Math.round(vRow.start),
            left: 8,
            width: 'max-content',
            height: rowHeight,
            fontSize: `${fontSize}px`
        } : {
            height: rowHeight,
            fontSize: `${fontSize}px`
        };

        if (isVirtualized) {
            return (
                <div
                    key={`${tab.path}-${file.path}`}
                    className={`details-row ${isSelected ? 'details-row--selected' : ''} ${isCut ? 'details-row--cut' : ''} ${isCopy ? 'details-row--copy' : ''} ${file.hidden ? 'details-row--hidden' : ''} ${dropTarget === file.path ? 'details-row--droptarget' : ''}`}
                    data-file-path={file.path}
                    style={style}
                    onClick={(e: any) => { e.stopPropagation(); handleClick(e, file); }}
                    onDoubleClick={singleClickToOpen ? undefined : () => handleDoubleClick(file)}
                    draggable
                    onDragStart={(e: any) => handleDragStart(e, file)}
                    onDragEnd={() => { clearDraggedPaths(); cleanupDragPreview(); }}
                    onDragOver={(e: any) => handleDragOver(e, file)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e: any) => handleDrop(e, file)}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const nextSelected = isSelected ? selected : new Set<string>([file.path]);
                        if (!isSelected) {
                            setSelected(nextSelected);
                            setLastSelected(file.path);
                            onFileSelect?.(file);
                        }
                        const selectedPaths = Array.from(nextSelected);
                        const selectedFiles = files.filter(f => selectedPaths.includes(f.path));
                        (window as any).__explorerContextMenu?.({
                            x: e.clientX, y: e.clientY, type: 'file', files: selectedFiles, currentDir: tab.path, sortKey, sortDir
                        });
                    }}
                >
                    <div className="details-cell details-cell--name" style={{ width: COLUMNS[0].width }}>
                        {fileTags[file.path] && (
                            <span className="details-tag-dot" style={{ background: TAG_COLORS.find(c => c.id === fileTags[file.path])?.hex ?? 'transparent' }} title={TAG_COLORS.find(c => c.id === fileTags[file.path])?.label} />
                        )}
                        <SystemFileIcon path={file.path} size={iconSize} extension={file.extension ?? ''} isDir={file.is_dir} isHidden={file.hidden} />
                        <span className="details-name">{displayName}</span>
                    </div>
                    <div className="details-cell" style={{ width: COLUMNS[1].width }}>{file.is_dir ? '' : formatBytes(file.size)}</div>
                    <div className="details-cell" style={{ width: COLUMNS[2].width }}>{formatDate(file.modified, dateFormat)}</div>
                    <div className="details-cell" style={{ width: COLUMNS[3].width, color: typeInfo?.color ?? 'var(--text-muted)' }}>{file.is_dir ? 'Folder' : typeInfo?.label ?? file.extension.toUpperCase()}</div>
                </div>
            );
        }

        return (
            <div
                key={`${tab.path}-${file.path}`}
                className={`details-row ${isSelected ? 'details-row--selected' : ''} ${isCut ? 'details-row--cut' : ''} ${isCopy ? 'details-row--copy' : ''} ${file.hidden ? 'details-row--hidden' : ''} ${dropTarget === file.path ? 'details-row--droptarget' : ''}`}
                data-file-path={file.path}
                style={style}
                onClick={(e: any) => { e.stopPropagation(); handleClick(e, file); }}
                onDoubleClick={singleClickToOpen ? undefined : () => handleDoubleClick(file)}
                draggable
                onDragStart={(e: any) => handleDragStart(e, file)}
                onDragEnd={() => { clearDraggedPaths(); cleanupDragPreview(); }}
                onDragOver={(e: any) => handleDragOver(e, file)}
                onDragLeave={handleDragLeave}
                onDrop={(e: any) => handleDrop(e, file)}
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const nextSelected = isSelected ? selected : new Set<string>([file.path]);
                    if (!isSelected) {
                        setSelected(nextSelected);
                        setLastSelected(file.path);
                        onFileSelect?.(file);
                    }
                    const selectedPaths = Array.from(nextSelected);
                    const selectedFiles = files.filter(f => selectedPaths.includes(f.path));
                    (window as any).__explorerContextMenu?.({
                        x: e.clientX, y: e.clientY, type: 'file', files: selectedFiles, currentDir: tab.path, sortKey, sortDir
                    });
                }}
            >
                <div className="details-cell details-cell--name" style={{ width: COLUMNS[0].width }}>
                    {fileTags[file.path] && (
                        <span className="details-tag-dot" style={{ background: TAG_COLORS.find(c => c.id === fileTags[file.path])?.hex ?? 'transparent' }} title={TAG_COLORS.find(c => c.id === fileTags[file.path])?.label} />
                    )}
                    <SystemFileIcon path={file.path} size={iconSize} extension={file.extension ?? ''} isDir={file.is_dir} isHidden={file.hidden} />
                    <span className="details-name">{displayName}</span>
                </div>
                <div className="details-cell" style={{ width: COLUMNS[1].width }}>{file.is_dir ? '' : formatBytes(file.size)}</div>
                <div className="details-cell" style={{ width: COLUMNS[2].width }}>{formatDate(file.modified, dateFormat)}</div>
                <div className="details-cell" style={{ width: COLUMNS[3].width, color: typeInfo?.color ?? 'var(--text-muted)' }}>{file.is_dir ? 'Folder' : typeInfo?.label ?? file.extension.toUpperCase()}</div>
            </div>
        );
    };

    if (loading) return null;
    if (error) return <div className="details-error">Error: {error}</div>;

    if (groupByType) {
        const groups = groupFilesByType(filteredFiles);
        const activeGroup = groups.find(g => g.label === activeGroupTab);
        const displayFiles = activeGroup ? activeGroup.files : filteredFiles;

        return (
            <div
                className="details-view"
                onClick={handleBackgroundClick}
            >
                <div className="group-tabs" onClick={e => e.stopPropagation()}>
                    <button className={`group-tab ${activeGroupTab === 'All' ? 'group-tab--active' : ''}`} onClick={() => setActiveGroupTab('All')}>
                        All <span className="group-tab-count">{filteredFiles.length}</span>
                    </button>
                    {groups.map(group => (
                        <button key={group.label} className={`group-tab ${activeGroupTab === group.label ? 'group-tab--active' : ''}`} onClick={() => setActiveGroupTab(group.label)}>
                            {group.label} <span className="group-tab-count">{group.files.length}</span>
                        </button>
                    ))}
                </div>
                <div className="details-header" onClick={e => e.stopPropagation()}>
                    {COLUMNS.map(col => (
                        <div
                            key={col.key}
                            className={`details-header-cell ${sortKey === col.key ? 'details-header-cell--sorted' : ''}`}
                            style={{ width: col.width }}
                            onClick={() => toggleSort(col.key as SortKey)}
                        >
                            {col.label}
                            {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                        </div>
                    ))}
                </div>
                <div
                    ref={containerRef}
                    className="details-body details-body--grouped"
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleBgDrop}
                    onMouseDown={beginMarqueeSelection}
                    onContextMenu={(e) => { e.preventDefault(); (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'background', files: [], currentDir: tab.path, sortKey, sortDir }); }}
                >
                    <div>
                        {displayFiles.filter(f => !f.hidden).map((file, i) => renderRow(file, i, false))}
                        {showHidden && displayFiles.some(f => f.hidden) && displayFiles.some(f => !f.hidden) && (
                            <div
                                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', userSelect: 'none', animation: 'fadeIn 0.2s ease-out' }}
                            >
                                <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', opacity: 0.5 }} />
                                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hidden Items</span>
                                <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', opacity: 0.5 }} />
                            </div>
                        )}
                        {showHidden && displayFiles.filter(f => f.hidden).map((file, i) => renderRow(file, i, false))}
                    </div>
                    {marqueeRect && (
                        <div
                            className="details-marquee"
                            style={{
                                left: marqueeRect.left,
                                top: marqueeRect.top,
                                width: marqueeRect.width,
                                height: marqueeRect.height
                            }}
                        />
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            className="details-view"
            onClick={handleBackgroundClick}
        >
            <div className="details-header" onClick={e => e.stopPropagation()}>
                {COLUMNS.map(col => (
                    <div
                        key={col.key}
                        className={`details-header-cell ${sortKey === col.key ? 'details-header-cell--sorted' : ''}`}
                        style={{ width: col.width }}
                        onClick={() => toggleSort(col.key as SortKey)}
                    >
                        {col.label}
                        {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                    </div>
                ))}
            </div>

            <div
                ref={containerRef}
                className="details-body"
                onDragOver={e => e.preventDefault()}
                onDrop={handleBgDrop}
                onMouseDown={beginMarqueeSelection}
                onContextMenu={(e) => {
                    e.preventDefault();
                    (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'background', files: [], currentDir: tab.path, sortKey, sortDir });
                }}
            >
                <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                    {virtualizer.getVirtualItems().filter(v => !filteredFiles[v.index].hidden).map((vRow) => {
                        const file = filteredFiles[vRow.index];
                        if (!file) return null;
                        return renderRow(file, vRow.index, true, vRow);
                    })}

                    {showHidden && filteredFiles.some(f => f.hidden) && filteredFiles.some(f => !f.hidden) && (
                        <div
                            style={{ position: 'absolute', top: virtualizer.getVirtualItems().find(v => filteredFiles[v.index].hidden)?.start ? virtualizer.getVirtualItems().find(v => filteredFiles[v.index].hidden)!.start - 40 : 0, width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', userSelect: 'none', animation: 'fadeIn 0.2s ease-out' }}
                        >
                            <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', opacity: 0.5 }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hidden Items</span>
                            <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', opacity: 0.5 }} />
                        </div>
                    )}

                    {showHidden && virtualizer.getVirtualItems().filter(v => filteredFiles[v.index].hidden).map((vRow) => {
                        const file = filteredFiles[vRow.index];
                        if (!file) return null;
                        return renderRow(file, vRow.index, true, vRow);
                    })}
                </div>
                {marqueeRect && (
                    <div
                        className="details-marquee"
                        style={{
                            left: marqueeRect.left,
                            top: marqueeRect.top,
                            width: marqueeRect.width,
                            height: marqueeRect.height
                        }}
                    />
                )}
            </div>
        </div>
    );
}
