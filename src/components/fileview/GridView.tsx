import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { EyeOff, Play } from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePanelStore } from '../../store/panelStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useDirectory, FileEntry } from '../../hooks/useDirectory';
import { useClipboardStore } from '../../store/clipboardStore';
import { useTagStore, TAG_COLORS } from '../../store/tagStore';
import { SystemFileIcon } from '../common/Icons';
import { IMAGE_EXTS, VIDEO_EXTS } from '../../utils/fileTypes';
import { groupFilesByType } from '../../utils/groupFiles';
import { formatBytes } from '../../utils/formatters';
import { clearDraggedPaths, getDraggedPaths, setDraggedPaths, createDragPreview, cleanupDragPreview } from '../../utils/dragDrop';
import { pasteWithConflictCheck } from '../../utils/paste';
import { useVimHotkeys } from '../../hooks/useVimHotkeys';

import './GridView.css';
const observerMap = new Map<Element, () => void>();
let globalObserver: IntersectionObserver | null = null;
const THUMB_MEM_MAX = 2000;
const thumbMemoryCache = new Map<string, string>();
const thumbInFlight = new Map<string, Promise<string>>();

function thumbCacheGet(key: string): string | undefined {
    return thumbMemoryCache.get(key);
}

function thumbCacheSet(key: string, value: string) {
    if (thumbMemoryCache.has(key)) thumbMemoryCache.delete(key);
    thumbMemoryCache.set(key, value);
    if (thumbMemoryCache.size > THUMB_MEM_MAX) {
        const oldest = thumbMemoryCache.keys().next().value;
        if (oldest) thumbMemoryCache.delete(oldest);
    }
}

function resolveThumbnail(path: string, size: number): Promise<string> {
    const key = `${path}|${size}`;
    const cached = thumbCacheGet(key);
    if (cached) return Promise.resolve(cached);
    const pending = thumbInFlight.get(key);
    if (pending) return pending;
    const req = invoke<string>('get_image_thumbnail', { path, size })
        .then((uri) => {
            thumbCacheSet(key, uri);
            return uri;
        })
        .catch(() => convertFileSrc(path))
        .finally(() => {
            thumbInFlight.delete(key);
        });
    thumbInFlight.set(key, req);
    return req;
}

const thumbnailQueue = {
    tasks: [] as { id: string; priority: number; run: () => void }[],
    pending: new Set<string>(),
    active: 0,
    max: 12,
    push(id: string, run: () => void, priority = 0) {
        if (this.pending.has(id)) return;
        this.pending.add(id);
        this.tasks.push({ id, priority, run });
        this.tasks.sort((a, b) => b.priority - a.priority);
        this.drain();
    },
    drain() {
        while (this.active < this.max && this.tasks.length > 0) {
            this.active++;
            const task = this.tasks.shift()!;
            this.pending.delete(task.id);
            task.run();
        }
    },
    done() {
        this.active = Math.max(0, this.active - 1);
        this.drain();
    },
    updateMax() {
        const cores = Math.max(2, (navigator as any).hardwareConcurrency || 6);
        const appRoot = document.querySelector('.app-root');
        const layout = appRoot?.getAttribute('data-layout') || '1';
        const perf = appRoot?.getAttribute('data-perf') === '1';
        const phase = appRoot?.getAttribute('data-layout-phase') || 'idle';
        let suggested = cores >= 16 ? 16 : cores >= 12 ? 14 : cores >= 8 ? 12 : cores >= 6 ? 10 : 8;
        if (layout === '4') suggested -= 3;
        if (layout === '3' || layout === '2h' || layout === '2v') suggested -= 1;
        if (perf) suggested -= 2;
        if (phase !== 'idle') suggested -= 4;
        this.max = Math.max(4, Math.min(16, suggested));
    }
};

function getGlobalObserver() {
    if (!globalObserver) {
        globalObserver = new IntersectionObserver((entries) => {
            entries.forEach(ent => {
                if (ent.isIntersecting) {
                    const cb = observerMap.get(ent.target);
                    if (cb) {
                        cb();
                        globalObserver?.unobserve(ent.target);
                        observerMap.delete(ent.target);
                    }
                }
            });
        }, { rootMargin: '1200px' });
    }
    return globalObserver;
}

function LazyThumbnail({ path, name, isHidden, enabled }: { path: string; name: string; isHidden?: boolean; enabled: boolean }) {
    const imgRef = useRef<HTMLImageElement>(null);
    const key = `${path}|256`;
    const initialCached = thumbCacheGet(key);
    const [src, setSrc] = useState<string | undefined>(initialCached);
    const [loaded, setLoaded] = useState(!!initialCached);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        const cached = thumbCacheGet(key);
        if (cached) {
            setSrc(cached);
            setLoaded(true);
        }
    }, [key]);

    useEffect(() => {
        if (!enabled) return;
        if (thumbCacheGet(key)) return;
        const el = imgRef.current;
        if (!el) return;

        observerMap.set(el, () => {
            thumbnailQueue.updateMax();
            thumbnailQueue.push(key, () => {
                resolveThumbnail(path, 256)
                    .then((uri) => {
                        if (mountedRef.current) setSrc(uri);
                    })
                    .finally(() => {
                        thumbnailQueue.done();
                    });
            }, 10);
        });
        getGlobalObserver().observe(el);

        return () => {
            observerMap.delete(el);
            globalObserver?.unobserve(el);
        };
    }, [path, enabled, key]);

    return (
        <img
            ref={imgRef}
            src={src}
            alt={name}
            className="grid-card-thumb"
            loading="lazy"
            decoding="async"
            onLoad={() => {
                setLoaded(true);
            }}
            style={{ opacity: isHidden ? 0.35 : (loaded ? 1 : 0), transition: 'opacity 0.18s ease-out' }}
        />
    );
}

interface Props {
    panelId: string;
    tabPath: string;
    tabId: string;
    onFileSelect?: (file: FileEntry | null) => void;
    iconScale?: number;
}

interface MarqueeRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export function GridView({ panelId, tabPath, tabId, onFileSelect, iconScale = 1 }: Props) {
    const tabStore = usePanelStore(s => {
        const ws = s.workspaces.find(w => w.id === s.activeWorkspaceId);
        if (!ws) return undefined;
        for (const p of ws.panels) {
            const t = p.tabs.find(t => t.id === tabId);
            if (t) return t;
        }
        return undefined;
    });
    const searchQuery = tabStore?.searchQuery?.toLowerCase() || '';
    const { files, loading, error, sortKey, sortDir } = useDirectory(tabPath, searchQuery);

    const navigate = usePanelStore(s => s.navigate);
    const groupByType = useSettingsStore(s => s.groupByType);
    const showHidden = useSettingsStore(s => s.showHidden);
    const singleClickToOpen = useSettingsStore(s => s.singleClickToOpen);
    const animationIntensity = useSettingsStore(s => s.animationIntensity);
    const disableExpensiveLargeFolders = useSettingsStore(s => s.disableExpensiveEffectsInLargeFolders);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [lastSelected, setLastSelected] = useState<string | null>(null);
    const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
    const [activeGroupTab, setActiveGroupTab] = useState('All');
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const fileTags = useTagStore(s => s.tags);

    const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const selectedRef = useRef<Set<string>>(new Set());
    const suppressBackgroundClickRef = useRef(false);
    const lastOpenedRef = useRef<{ path: string; time: number } | null>(null);
    const openTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hoverSelectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const widthSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [gridWidth, setGridWidth] = useState(0);
    const [stableColumnCount, setStableColumnCount] = useState(1);
    const [contentReady, setContentReady] = useState(false);
    const [widthSettled, setWidthSettled] = useState(false);
    const [reflowAnimating, setReflowAnimating] = useState(false);
    const [entryRevealing, setEntryRevealing] = useState(false);
    const prevPathRef = useRef(tabPath);
    const pendingRevealRef = useRef(false);
    const activeWs = usePanelStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId));
    const isPanelActive = activeWs?.activePanelId === panelId;
    const currentLayout = activeWs?.layout ?? '1';
    const appRootEl = typeof document !== 'undefined' ? document.querySelector('.app-root') : null;
    const layoutPhase = appRootEl?.getAttribute('data-layout-phase') ?? 'idle';
    const visualLayout = (appRootEl?.getAttribute('data-layout') || currentLayout) as typeof currentLayout;

    useEffect(() => {
        setSelectionAnchor(null);
    }, [tabPath]);

    // Track whether we navigated to a new path — mark a pending reveal
    useEffect(() => {
        if (prevPathRef.current !== tabPath) {
            pendingRevealRef.current = true;
            prevPathRef.current = tabPath;
        }
    }, [tabPath]);

    // When search or grouping changes, mark pending reveal but DON'T hide current content
    useEffect(() => {
        pendingRevealRef.current = true;
    }, [searchQuery, activeGroupTab, groupByType]);

    // Once data is loaded + width settled, mark content ready and trigger reveal
    useEffect(() => {
        if (loading || !widthSettled || layoutPhase === 'fade-out') return;
        const raf = requestAnimationFrame(() => {
            setContentReady(true);
            // Only play reveal animation when we navigated somewhere new
            if (pendingRevealRef.current) {
                pendingRevealRef.current = false;
                setEntryRevealing(true);
            }
        });
        return () => cancelAnimationFrame(raf);
    }, [loading, widthSettled, layoutPhase, tabPath, searchQuery, activeGroupTab, groupByType]);

    useEffect(() => {
        if (!entryRevealing) return;
        const t = window.setTimeout(() => setEntryRevealing(false), 420);
        return () => window.clearTimeout(t);
    }, [entryRevealing]);

    useEffect(() => {
        const host = gridRef.current;
        if (!host) return;
        const isLayoutAnimating = () =>
            document.documentElement.getAttribute('data-sidebar-animating') === '1' ||
            document.documentElement.getAttribute('data-inspector-animating') === '1';
        const updateWidth = () => {
            if (isLayoutAnimating()) return;
            setGridWidth(host.clientWidth);
            setWidthSettled(false);
            if (widthSettleTimeoutRef.current) clearTimeout(widthSettleTimeoutRef.current);
            widthSettleTimeoutRef.current = setTimeout(() => setWidthSettled(true), 90);
        };
        updateWidth();
        const ro = new ResizeObserver(updateWidth);
        ro.observe(host);
        const onLayoutAnimEnd = () => updateWidth();
        window.addEventListener('explorer-sidebar-animation-end', onLayoutAnimEnd);
        window.addEventListener('explorer-inspector-animation-end', onLayoutAnimEnd);
        return () => {
            ro.disconnect();
            window.removeEventListener('explorer-sidebar-animation-end', onLayoutAnimEnd);
            window.removeEventListener('explorer-inspector-animation-end', onLayoutAnimEnd);
            if (widthSettleTimeoutRef.current) {
                clearTimeout(widthSettleTimeoutRef.current);
                widthSettleTimeoutRef.current = null;
            }
        };
    }, [groupByType, activeGroupTab]);

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
    const clipboardPaths = useClipboardStore(s => s.paths);
    const clipboardAction = useClipboardStore(s => s.action);
    const filteredFiles = files; // Search filtering is now handled natively by the Rust backend

    const persistSelection = useCallback((next: Set<string>) => {
        const selPaths = [...next];
        if (selPaths.length > 0) {
            localStorage.setItem(`explorer-selected-${tabPath}`, JSON.stringify(selPaths));
        } else {
            localStorage.removeItem(`explorer-selected-${tabPath}`);
        }

        const selSize = files
            .filter((f) => next.has(f.path))
            .reduce((sum, f) => sum + (f.is_dir ? 0 : f.size), 0);

        window.dispatchEvent(new CustomEvent('explorer-selection-change', {
            detail: { count: next.size, size: selSize, currentDir: tabPath }
        }));
    }, [files, tabPath]);

    useEffect(() => {
        selectedRef.current = selected;
    }, [selected]);

    // Keyboard interaction
    useEffect(() => {
        const handler = async (e: KeyboardEvent) => {
            const state = usePanelStore.getState();
            const activeWs = state.workspaces.find(w => w.id === state.activeWorkspaceId);
            if (!activeWs || activeWs.activePanelId !== panelId) return;

            if (e.key === ' ' && selected.size > 0) {
                e.preventDefault();
                const file = files.find(f => selected.has(f.path));
                if (file && !file.is_dir) {
                    (window as any).__explorerQuickLook?.(file);
                }
            }

            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                if (key === 'c' && selected.size > 0) {
                    e.preventDefault();
                    useClipboardStore.getState().setClipboard(Array.from(selected), 'copy');
                } else if (key === 'x' && selected.size > 0) {
                    e.preventDefault();
                    useClipboardStore.getState().setClipboard(Array.from(selected), 'cut');
                } else if (key === 'a') {
                    e.preventDefault();
                    const allPaths = new Set(files.map(f => f.path));
                    setSelected(allPaths);
                    window.dispatchEvent(new CustomEvent('explorer-selection-change', {
                        detail: { count: allPaths.size, size: files.reduce((s, f) => s + (f.is_dir ? 0 : f.size), 0), currentDir: tabPath }
                    }));
                } else if (key === 'v') {
                    e.preventDefault();
                    const clip = useClipboardStore.getState();
                    if (clip.paths.length > 0 && clip.action) {
                        await pasteWithConflictCheck(clip.paths, tabPath, clip.action, {
                            onSuccess: () => window.dispatchEvent(new CustomEvent('explorer-refresh')),
                            onClearClipboard: () => clip.clearClipboard()
                        });
                    }
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selected, files, panelId, tabPath]);

    const perfForContext = useMemo(() => {
        const manyItems = files.length > 700;
        const denseLayout = currentLayout === '4' || currentLayout === '3';
        return animationIntensity === 'smooth' || denseLayout || (disableExpensiveLargeFolders && manyItems);
    }, [animationIntensity, currentLayout, disableExpensiveLargeFolders, files.length]);

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('explorer-perf-hint', {
            detail: { source: tabId, active: Boolean(isPanelActive && perfForContext) }
        }));
        return () => {
            window.dispatchEvent(new CustomEvent('explorer-perf-hint', {
                detail: { source: tabId, active: false }
            }));
        };
    }, [tabId, isPanelActive, perfForContext]);

    useVimHotkeys(isPanelActive && document.activeElement?.tagName !== 'INPUT', {
        onNext: () => {
            const idx = lastSelected ? files.findIndex(f => f.path === lastSelected) : -1;
            const next = files[Math.min(idx + 1, files.length - 1)];
            if (next) {
                setSelected(new Set([next.path]));
                setLastSelected(next.path);
                onFileSelect?.(next);
                persistSelection(new Set([next.path]));
            }
        },
        onPrev: () => {
            const idx = lastSelected ? files.findIndex(f => f.path === lastSelected) : 1;
            const prev = files[Math.max(idx - 1, 0)];
            if (prev) {
                setSelected(new Set([prev.path]));
                setLastSelected(prev.path);
                onFileSelect?.(prev);
                persistSelection(new Set([prev.path]));
            }
        },
        onFirst: () => {
            const first = files[0];
            if (first) {
                setSelected(new Set([first.path]));
                setLastSelected(first.path);
                onFileSelect?.(first);
                persistSelection(new Set([first.path]));
            }
        },
        onLast: () => {
            const last = files[files.length - 1];
            if (last) {
                setSelected(new Set([last.path]));
                setLastSelected(last.path);
                onFileSelect?.(last);
                persistSelection(new Set([last.path]));
            }
        },
        onParent: () => {
            invoke<string | null>('get_parent_path', { path: tabPath }).then(p => {
                if (p) navigate(panelId, tabId, p);
            });
        },
        onOpen: () => {
            const sel = [...selected][0];
            const file = files.find(f => f.path === sel);
            if (file) handleDoubleClick(file);
        },
        onCenter: () => {
            // Grid centering is tougher, but we can ensure it's in view
            const sel = [...selected][0];
            const el = gridRef.current?.querySelector(`[data-file-path="${sel}"]`);
            if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    });

    const selectionAnchorRef = useRef<string | null>(null);
    selectionAnchorRef.current = selectionAnchor;
    const filesRef = useRef(files);
    filesRef.current = files;

    const handleClick = useCallback((e: React.MouseEvent, file: FileEntry) => {
        let next: Set<string>;
        const currentSelected = selectedRef.current;
        const currentAnchor = selectionAnchorRef.current;
        const currentFiles = filesRef.current;
        if (e.ctrlKey || e.metaKey) {
            next = new Set(currentSelected);
            if (next.has(file.path)) next.delete(file.path); else next.add(file.path);
        } else if (e.shiftKey && currentAnchor !== null) {
            const anchorIdx = currentFiles.findIndex(f => f.path === currentAnchor);
            const thisIdx = currentFiles.findIndex(f => f.path === file.path);
            const [lo, hi] = [Math.min(anchorIdx >= 0 ? anchorIdx : thisIdx, thisIdx), Math.max(anchorIdx >= 0 ? anchorIdx : thisIdx, thisIdx)];
            next = new Set(currentFiles.slice(lo, hi + 1).map(f => f.path));
        } else {
            next = new Set([file.path]);
            setSelectionAnchor(file.path);
        }
        setSelected(next);
        setLastSelected(file.path);
        onFileSelect?.(file);
        persistSelection(next);

        if (singleClickToOpen && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            const now = Date.now();
            if (lastOpenedRef.current?.path === file.path && now - lastOpenedRef.current.time < 500) return;
            lastOpenedRef.current = { path: file.path, time: now };
            if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
            openTimeoutRef.current = setTimeout(() => {
                openTimeoutRef.current = null;
                if (file.is_dir) {
                    navigate(panelId, tabId, file.path);
                } else {
                    invoke('open_file', { path: file.path }).catch(console.error);
                }
            }, 450);
        }
    }, [onFileSelect, persistSelection, singleClickToOpen, navigate, panelId, tabId]);

    const HOVER_SELECT_DELAY_MS = 280;

    const handleMouseEnter = useCallback((e: React.MouseEvent, file: FileEntry) => {
        if (!singleClickToOpen) return;
        if (hoverSelectTimeoutRef.current) {
            clearTimeout(hoverSelectTimeoutRef.current);
            hoverSelectTimeoutRef.current = null;
        }
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        hoverSelectTimeoutRef.current = setTimeout(() => {
            hoverSelectTimeoutRef.current = null;
            let next: Set<string>;
            if (ctrl) {
                next = new Set(selected);
                if (next.has(file.path)) next.delete(file.path);
                else next.add(file.path);
            } else if (shift && selectionAnchor !== null) {
                const anchorIdx = files.findIndex(f => f.path === selectionAnchor);
                const thisIdx = files.findIndex(f => f.path === file.path);
                const [lo, hi] = [Math.min(anchorIdx >= 0 ? anchorIdx : thisIdx, thisIdx), Math.max(anchorIdx >= 0 ? anchorIdx : thisIdx, thisIdx)];
                next = new Set(files.slice(lo, hi + 1).map(f => f.path));
            } else {
                next = new Set([file.path]);
                setSelectionAnchor(file.path);
            }
            setSelected(next);
            setLastSelected(file.path);
            const selFiles = files.filter(f => next.has(f.path));
            onFileSelect?.(selFiles.length === 1 ? selFiles[0] : null);
            persistSelection(next);
        }, HOVER_SELECT_DELAY_MS);
    }, [singleClickToOpen, selected, files, selectionAnchor, onFileSelect, persistSelection]);

    const handleMouseLeave = useCallback(() => {
        if (hoverSelectTimeoutRef.current) {
            clearTimeout(hoverSelectTimeoutRef.current);
            hoverSelectTimeoutRef.current = null;
        }
    }, []);

    useEffect(() => {
        return () => {
            if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
            if (hoverSelectTimeoutRef.current) clearTimeout(hoverSelectTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        const handler = () => {
            const allFiles = files.map(f => f.path);
            const all = new Set(allFiles);
            setSelected(all);
            persistSelection(all);
        };
        window.addEventListener('explorer-select-all', handler);
        return () => window.removeEventListener('explorer-select-all', handler);
    }, [files, persistSelection]);

    useEffect(() => {
        const handler = (e: Event) => {
            const ce = e as CustomEvent<string>;
            const path = ce.detail;
            const file = files.find(f => f.path === path);
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
    }, [files]);

    const handleDoubleClick = useCallback((file: FileEntry) => {
        if (file.is_dir) {
            navigate(panelId, tabId, file.path);
        } else {
            invoke('open_file', { path: file.path }).catch(console.error);
        }
    }, [navigate, panelId, tabId]);

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
        e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
        setDropTarget(file.path);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent, targetFolder: FileEntry) => {
        e.preventDefault();
        setDropTarget(null);
        if (!targetFolder.is_dir) return;
        const paths = getDraggedPaths(e.dataTransfer);
        if (paths.length === 0) return;
        try {
            if (isInvalidDrop(paths, targetFolder.path)) return;
            await invoke(e.ctrlKey ? 'copy_items' : 'move_items', { sources: paths, dest: targetFolder.path });
            window.dispatchEvent(new CustomEvent('explorer-refresh'));
        } catch (err) { console.error('Drop failed:', err); }
        finally { clearDraggedPaths(); }
    }, [isInvalidDrop]);

    const handleBgDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setDropTarget(null);
        const paths = getDraggedPaths(e.dataTransfer);
        if (paths.length === 0) return;
        try {
            if (isInvalidDrop(paths, tabPath)) return;
            await invoke(e.ctrlKey ? 'copy_items' : 'move_items', { sources: paths, dest: tabPath });
            window.dispatchEvent(new CustomEvent('explorer-refresh'));
        } catch (err) { console.error('Background drop failed:', err); }
        finally { clearDraggedPaths(); }
    }, [isInvalidDrop, tabPath]);

    const handleBackgroundClick = useCallback(() => {
        if (suppressBackgroundClickRef.current) {
            suppressBackgroundClickRef.current = false;
            return;
        }

        const next = new Set<string>();
        setSelected(next);
        setLastSelected(null);
        setSelectionAnchor(null);
        onFileSelect?.(null);
        persistSelection(next);
    }, [onFileSelect, persistSelection]);

    const beginMarqueeSelection = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const host = gridRef.current;
        if (!host) return;

        const target = e.target as HTMLElement;
        if (target.closest('.group-tabs') || target.closest('.group-tab') || target.closest('.grid-card')) {
            return;
        }

        const hostRect = host.getBoundingClientRect();
        const style = window.getComputedStyle(host);
        const padLeft = parseFloat(style.paddingLeft) || 0;
        const padRight = parseFloat(style.paddingRight) || 0;
        const padTop = parseFloat(style.paddingTop) || 0;
        const padBottom = parseFloat(style.paddingBottom) || 0;
        const contentWidth = Math.max(0, hostRect.width - padLeft - padRight);
        const contentHeight = Math.max(0, hostRect.height - padTop - padBottom);

        const startX = Math.max(0, Math.min(contentWidth, e.clientX - (hostRect.left + padLeft)));
        const startY = Math.max(0, Math.min(contentHeight, e.clientY - (hostRect.top + padTop))) + host.scrollTop;
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

            const currentX = Math.max(0, Math.min(contentWidth, ev.clientX - (hostRect.left + padLeft)));
            const currentY = Math.max(0, Math.min(contentHeight, ev.clientY - (hostRect.top + padTop))) + host.scrollTop;
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

            // Convert marquee coords back to viewport-relative for intersection with getBoundingClientRect
            const scrollTop = host.scrollTop;
            const marqueeLeft = hostRect.left + padLeft + left;
            const marqueeTop = hostRect.top + padTop + (top - scrollTop);
            const marqueeRight = marqueeLeft + width;
            const marqueeBottom = marqueeTop + height;

            const next = new Set(state.baseSelection);
            host.querySelectorAll<HTMLElement>('.grid-card[data-file-path]').forEach((card) => {
                const cardRect = card.getBoundingClientRect();
                const intersects =
                    cardRect.left < marqueeRight &&
                    cardRect.right > marqueeLeft &&
                    cardRect.top < marqueeBottom &&
                    cardRect.bottom > marqueeTop;

                if (!intersects) return;
                const filePath = card.dataset.filePath;
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

            const next = new Set<string>();
            setSelected(next);
            setLastSelected(null);
            setSelectionAnchor(null);
            onFileSelect?.(null);
            persistSelection(next);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [onFileSelect, persistSelection]);

    useEffect(() => {
        return () => {
            document.body.style.userSelect = '';
        };
    }, []);

    // The Ultimate Rigid Grid Logic
    const scale = Math.max(0.4, Math.min(iconScale, 4.0));
    const iconSz = Math.round(74 * scale);
    const baseCardWidth = Math.round(96 * scale) + 16;
    const previewH = Math.round(iconSz * 1.1) + 6;
    const cardGap = visualLayout === '4' ? 6 : 8;

    // Keep text area height somewhat stable, scaling it less aggressively
    const estimatedCardHeight = previewH + Math.round(42 + 8 * scale);

    // Always subtract fixed grid paddings (this gives us the usable width)
    const paddingX = 16;
    const effectiveGridWidth = Math.max(1, gridWidth - (paddingX * 2));

    // Calculate how many ideal columns could fit
    const rawColumnCount = Math.max(1, Math.floor((effectiveGridWidth + cardGap) / (baseCardWidth + cardGap)));
    const shouldFreezeColumns = layoutPhase === 'fade-out';
    useEffect(() => {
        if (!shouldFreezeColumns) {
            setStableColumnCount(rawColumnCount);
        }
    }, [shouldFreezeColumns, rawColumnCount]);
    const columnCount = shouldFreezeColumns ? stableColumnCount : rawColumnCount;

    // Outer box size – stretch cards to fill available space (like CSS auto-fill + 1fr)
    const cardTrackWidth = columnCount > 0
        ? Math.floor((effectiveGridWidth - (columnCount - 1) * cardGap) / columnCount)
        : baseCardWidth;
    const rowHeight = estimatedCardHeight + cardGap;
    const reflowSig = `${columnCount}|${cardTrackWidth}|${cardGap}`;
    const prevReflowSigRef = useRef(reflowSig);
    const reflowNow = contentReady && prevReflowSigRef.current !== reflowSig;
    useEffect(() => {
        if (!contentReady) {
            prevReflowSigRef.current = reflowSig;
            return;
        }
        if (prevReflowSigRef.current === reflowSig) return;
        prevReflowSigRef.current = reflowSig;
        setReflowAnimating(true);
        const t = window.setTimeout(() => setReflowAnimating(false), 220);
        return () => window.clearTimeout(t);
    }, [reflowSig, contentReady]);
    if (error) return <div className="grid-error">Error: {error}</div>;

    const renderCard = (file: FileEntry) => {
        const ext = file.extension?.toLowerCase() ?? '';
        const isImage = IMAGE_EXTS.has(ext);
        const isVideo = VIDEO_EXTS.has(ext);
        const hasThumbnail = isImage || isVideo;
        const isCut = clipboardAction === 'cut' && clipboardPaths.includes(file.path);
        const isCopy = clipboardAction === 'copy' && clipboardPaths.includes(file.path);

        const isNativeIcon = ['exe', 'lnk', 'url', 'appref-ms', 'msi'].includes(ext);

        return (
            <div
                className={`grid-card ${selected.has(file.path) ? 'grid-card--selected' : ''} ${isCut ? 'grid-card--cut' : ''} ${isCopy ? 'grid-card--copy' : ''} ${dropTarget === file.path ? 'grid-card--droptarget' : ''}`}
                data-file-path={file.path}
                onClick={(e: any) => { e.stopPropagation(); handleClick(e, file); }}
                onDoubleClick={singleClickToOpen ? undefined : () => handleDoubleClick(file)}
                onMouseEnter={singleClickToOpen ? (e) => handleMouseEnter(e, file) : undefined}
                onMouseLeave={singleClickToOpen ? handleMouseLeave : undefined}
                title={file.path}
                draggable
                onDragStart={(e: any) => handleDragStart(e, file)}
                onDragEnd={() => { clearDraggedPaths(); cleanupDragPreview(); }}
                onDragOver={(e: any) => handleDragOver(e, file)}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e: any) => handleDrop(e, file)}
                onContextMenu={(e: any) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!selected.has(file.path)) {
                        setSelected(new Set([file.path]));
                        onFileSelect?.(file);
                    }
                    (window as any).__explorerContextMenu?.({
                        x: e.clientX,
                        y: e.clientY,
                        type: file.is_dir ? 'directory' : 'file',
                        files: selected.has(file.path) ? files.filter(f => selected.has(f.path)) : [file],
                        currentDir: tabPath,
                        sortKey,
                        sortDir
                    });
                }}
            >
                <div className={`grid-card-preview ${isNativeIcon ? 'grid-card-preview--native' : ''}`} style={{ height: `${previewH}px`, minHeight: `${previewH}px`, flexBasis: `${previewH}px`, flexShrink: 0 }}>
                    <div className="grid-card-preview-inner">
                        {hasThumbnail ? (
                            <>
                                <LazyThumbnail path={file.path} name={file.name} isHidden={file.hidden} enabled={isPanelActive} />
                                {isVideo && (
                                    <div className="grid-card-video-badge">
                                        <Play size={14} fill="white" color="white" />
                                    </div>
                                )}
                                {file.hidden && (
                                    <div style={{ position: 'absolute', bottom: -1, right: -1, background: 'var(--bg-surface)', borderRadius: '50%', padding: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.5)', zIndex: 10 }}>
                                        <EyeOff size={16} color="var(--text-muted)" strokeWidth={2.5} />
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="grid-card-icon">
                                <SystemFileIcon
                                    path={file.path}
                                    size={isNativeIcon ? Math.round(iconSz * 1.15) : iconSz}
                                    extension={ext}
                                    isDir={file.is_dir}
                                    isHidden={file.hidden}
                                    fill={!isNativeIcon}
                                />
                            </div>
                        )}
                    </div>
                    <div className="grid-card-preview-details">
                        <span className="grid-card-detail-name">{file.name}</span>
                        <span className="grid-card-detail-info">{file.is_dir ? 'Folder' : formatBytes(file.size)}</span>
                    </div>
                </div>
                {fileTags[file.path] && (
                    <span
                        className="grid-card-tag-dot"
                        style={{ background: TAG_COLORS.find(c => c.id === fileTags[file.path])?.hex ?? 'transparent' }}
                        title={TAG_COLORS.find(c => c.id === fileTags[file.path])?.label}
                    />
                )}
                <div className="grid-card-info">
                    <span className="grid-card-name">{file.name}</span>
                    <span className="grid-card-meta">
                        {file.is_dir ? 'Folder' : formatBytes(file.size)}
                    </span>
                </div>
            </div>
        );
    };

    const groups = useMemo(() => groupByType ? groupFilesByType(filteredFiles) : [], [groupByType, filteredFiles]);
    const activeGroup = groupByType ? groups.find(g => g.label === activeGroupTab) : null;
    const displayFiles = (groupByType ? (activeGroup ? activeGroup.files : filteredFiles) : filteredFiles)
        .filter(file => showHidden || !file.hidden);

    const rowCount = Math.ceil(displayFiles.length / columnCount);
    const rowVirtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => gridRef.current,
        estimateSize: () => rowHeight,
        overscan: 4,
    });

    const totalTrackWidth = columnCount * cardTrackWidth + Math.max(0, columnCount - 1) * cardGap;
    // Now that cardTrackWidth absorbs almost all the flex space, leftBase will be at most 0-4 pixels.
    // This guarantees an ultra-stable gutter behavior on zoom!
    const leftBase = Math.max(0, Math.floor((effectiveGridWidth - totalTrackWidth) / 2));

    const renderVirtualRows = () => (
        <div
            className={`grid-virtual-content ${contentReady ? 'is-ready' : 'is-loading'} ${entryRevealing ? 'is-revealing' : ''} ${(reflowAnimating || reflowNow) ? 'is-reflowing' : ''}`}
            style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}
        >
            {!loading && contentReady && rowVirtualizer.getVirtualItems().map((vRow) => {
                const rowIndex = vRow.index;
                const start = rowIndex * columnCount;
                const rowFiles = displayFiles.slice(start, start + columnCount);
                if (rowFiles.length === 0) return null;
                return (
                    rowFiles.map((file, colIndex) => {
                        const x = leftBase + colIndex * (cardTrackWidth + cardGap);
                        const y = Math.round(vRow.start);
                        return (
                            <div
                                key={file.path}
                                className="grid-virtual-card-wrap"
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: `${cardTrackWidth}px`,
                                    transform: `translate3d(${x}px, ${y}px, 0)`,
                                    ['--reveal-delay' as any]: `${Math.min(rowIndex, 10) * 16}ms`
                                }}
                            >
                                {renderCard(file)}
                            </div>
                        );
                    })
                );
            })}
            {marqueeRect && (
                <div
                    className="grid-view-marquee"
                    style={{
                        left: marqueeRect.left,
                        top: marqueeRect.top,
                        width: marqueeRect.width,
                        height: marqueeRect.height
                    }}
                />
            )}
        </div>
    );

    if (groupByType) {
        return (
            <div className="grid-view-grouped"
                onClick={handleBackgroundClick}
                onDragOver={(e: React.DragEvent) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
                }}
                onDrop={handleBgDrop}
                onContextMenu={(e: React.MouseEvent) => {
                    e.preventDefault();
                    (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'background', files: [], currentDir: tabPath, sortKey, sortDir });
                }}
            >
                <div className="group-tabs" onClick={e => e.stopPropagation()}>
                    <button
                        className={`group-tab ${activeGroupTab === 'All' ? 'group-tab--active' : ''}`}
                        onClick={() => setActiveGroupTab('All')}
                    >
                        All <span className="group-tab-count">{filteredFiles.length}</span>
                    </button>
                    {groups.map(group => (
                        <button
                            key={group.label}
                            className={`group-tab ${activeGroupTab === group.label ? 'group-tab--active' : ''}`}
                            onClick={() => setActiveGroupTab(group.label)}
                        >
                            {group.label} <span className="group-tab-count">{group.files.length}</span>
                        </button>
                    ))}
                </div>
                <div
                    className="grid-view"
                    ref={gridRef}
                    style={{ display: 'block', padding: '10px', overflowY: 'auto' }}
                    onDragOver={(e: React.DragEvent) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
                    }}
                    onDrop={handleBgDrop}
                    onMouseDown={beginMarqueeSelection}
                >
                    {renderVirtualRows()}
                </div>
            </div>
        );
    }

    return (
        <div
            className="grid-view"
            ref={gridRef}
            tabIndex={0}
            style={{ display: 'block', padding: '16px', overflowY: 'auto' }}
            onDragOver={(e: React.DragEvent) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
            }}
            onDrop={handleBgDrop}
            onClick={handleBackgroundClick}
            onMouseDown={beginMarqueeSelection}
            onContextMenu={(e: React.MouseEvent) => {
                e.preventDefault();
                (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'background', files: [], currentDir: tabPath, sortKey, sortDir });
            }}
        >
            {renderVirtualRows()}
        </div>
    );
}
