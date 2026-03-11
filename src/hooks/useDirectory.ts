import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from '../store/settingsStore';
import { useTagStore } from '../store/tagStore';

export interface FileEntry {
    name: string;
    path: string;
    size: number;
    modified: number;
    created: number;
    is_dir: boolean;
    extension: string;
    hidden: boolean;
    symlink: boolean;
}

export type SortKey = 'name' | 'size' | 'modified' | 'created' | 'extension';
export type SortDir = 'asc' | 'desc';

interface DirChangedEntry {
    path: string;
    kind: string;
}

interface DirChangedPayload {
    path: string;
    kind: string;
    entries?: DirChangedEntry[];
}

interface FileMetadataPayload {
    name: string;
    path: string;
    size: number;
    modified: number;
    created: number;
    is_dir: boolean;
    extension: string;
    hidden: boolean;
    symlink: boolean;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortFiles(files: FileEntry[], key: SortKey, dir: SortDir): FileEntry[] {
    const dirs: FileEntry[] = [];
    const fls: FileEntry[] = [];
    for (let i = 0; i < files.length; i++) {
        if (files[i].is_dir) dirs.push(files[i]);
        else fls.push(files[i]);
    }
    const sorter = (a: FileEntry, b: FileEntry) => {
        let cmp = 0;
        if (key === 'name') cmp = collator.compare(a.name || '', b.name || '');
        else if (key === 'size') cmp = (a.size || 0) - (b.size || 0);
        else if (key === 'modified') cmp = (a.modified || 0) - (b.modified || 0);
        else if (key === 'created') cmp = (a.created || 0) - (b.created || 0);
        else if (key === 'extension') cmp = collator.compare(a.extension || '', b.extension || '');
        return dir === 'asc' ? cmp : -cmp;
    };
    return [...dirs.sort(sorter), ...fls.sort(sorter)];
}

export function useDirectory(path: string, searchQuery: string = '') {
    const [allFiles, setAllFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const showHidden = useSettingsStore(s => s.showHidden);
    const tagsMap = useTagStore(s => s.tags);
    const unlistenRef = useRef<(() => void) | null>(null);
    const allFilesRef = useRef<FileEntry[]>([]);
    const pendingEventMapRef = useRef<Map<string, string>>(new Map());
    const incrementalTimeoutRef = useRef<number | null>(null);

    const loadTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        allFilesRef.current = allFiles;
    }, [allFiles]);

    const isTagPath = useCallback((p: string) => p.startsWith('tag:'), []);
    const getTagId = useCallback((p: string) => p.slice('tag:'.length).trim(), []);

    const load = useCallback(async (p: string, q: string, backgroundRefresh = false) => {
        if (!p) return;

        // Clear any pending load
        if (loadTimeoutRef.current) {
            window.clearTimeout(loadTimeoutRef.current);
        }

        const executeLoad = async () => {
            if (!backgroundRefresh) setLoading(true);
            setError(null);
            try {
                let result: FileEntry[];
                // Virtual folder: tag:<id>
                if (isTagPath(p)) {
                    const tagId = getTagId(p);
                    const currentTags = useTagStore.getState().tags;
                    const taggedPaths = Object.entries(currentTags)
                        .filter(([, c]) => c === tagId)
                        .map(([fp]) => fp);

                    const query = (q ?? '').trim().toLowerCase();
                    const pathsToShow = query.length
                        ? taggedPaths.filter(fp => fp.toLowerCase().includes(query))
                        : taggedPaths;

                    // Fetch metadata in parallel (bounded)
                    const concurrency = 24;
                    const out: FileEntry[] = [];
                    const missing: string[] = [];
                    let idx = 0;
                    const worker = async () => {
                        while (idx < pathsToShow.length) {
                            const my = idx++;
                            const fp = pathsToShow[my];
                            try {
                                const meta = await invoke<any>('get_file_metadata', { path: fp });
                                out.push({
                                    name: meta.name ?? fp.split('\\').pop() ?? fp,
                                    path: fp,
                                    size: meta.size ?? 0,
                                    modified: meta.modified ?? 0,
                                    created: meta.created ?? 0,
                                    is_dir: !!meta.is_dir,
                                    extension: meta.extension ?? '',
                                    hidden: !!meta.hidden,
                                    symlink: !!meta.symlink,
                                });
                            } catch {
                                // If it's actually missing, clean up stale tag entries
                                const exists = await invoke<boolean>('path_exists', { path: fp }).catch(() => true);
                                if (!exists) {
                                    missing.push(fp);
                                } else {
                                    // Still show the entry even if metadata fetch fails (permission/edge cases)
                                    const name = fp.split('\\').pop() ?? fp;
                                    const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
                                    out.push({
                                        name,
                                        path: fp,
                                        size: 0,
                                        modified: 0,
                                        created: 0,
                                        is_dir: false,
                                        extension: ext,
                                        hidden: false,
                                        symlink: false,
                                    });
                                }
                            }
                        }
                    };
                    await Promise.all(Array.from({ length: Math.min(concurrency, pathsToShow.length || 1) }, worker));
                    if (missing.length > 0) {
                        const { removeTag } = useTagStore.getState();
                        missing.forEach((fp) => removeTag(fp));
                        window.dispatchEvent(new CustomEvent('explorer-refresh'));
                    }
                    result = out;
                } else if (q && q.trim().length > 0) {
                    result = await invoke<FileEntry[]>('search_in_directory', {
                        root: p,
                        query: q.trim(),
                        extensions: [],
                        maxResults: 200,
                        // Tab-strip search should stay scoped to current directory.
                        recursive: false
                    });
                } else {
                    result = await invoke<FileEntry[]>('read_dir', { path: p });
                }
                setAllFiles(result);

                if (!isTagPath(p) && (!q || q.trim().length === 0)) {
                    const subdirs = result
                        .filter(f => f.is_dir && !f.hidden)
                        .slice(0, 3);
                    for (const dir of subdirs) {
                        invoke('prefetch_directory', { path: dir.path }).catch(() => {});
                    }
                }
            } catch (e: any) {
                console.error("Directory load failed:", e);
            } finally {
                setLoading(false);
            }
        };

        // If it's a background refresh, debounce it by 150ms to prevent spamming from file watchers
        if (backgroundRefresh) {
            loadTimeoutRef.current = window.setTimeout(executeLoad, 150);
        } else {
            executeLoad();
        }
    }, [getTagId, isTagPath]);

    const applyIncrementalRefresh = useCallback(async (basePath: string, entries: DirChangedEntry[]) => {
        if (!basePath || entries.length === 0) return;
        const current = allFilesRef.current;
        const nextMap = new Map<string, FileEntry>(current.map(f => [f.path, f]));
        const uniquePaths = [...new Set(entries.map(e => e.path).filter(Boolean))];
        const baseLower = basePath.toLowerCase();
        const candidates = uniquePaths.filter((changedPath) => {
            const pLower = changedPath.toLowerCase();
            return pLower !== baseLower && pLower.startsWith(baseLower);
        });

        if (candidates.length > 32) {
            load(basePath, searchQuery, true);
            return;
        }

        await Promise.all(candidates.map(async (changedPath) => {
            try {
                const meta = await invoke<FileMetadataPayload>('get_file_metadata', { path: changedPath });
                nextMap.set(changedPath, {
                    name: meta.name,
                    path: meta.path,
                    size: meta.size,
                    modified: meta.modified,
                    created: meta.created,
                    is_dir: meta.is_dir,
                    extension: meta.extension,
                    hidden: meta.hidden,
                    symlink: meta.symlink,
                });
            } catch {
                nextMap.delete(changedPath);
            }
        }));

        setAllFiles(Array.from(nextMap.values()));
    }, [load, searchQuery]);

    // Load on path or query change and set up watcher
    useEffect(() => {
        if (!path) return;
        load(path, searchQuery);

        // No directory watcher for virtual tag folders
        if (isTagPath(path)) {
            if (unlistenRef.current) {
                unlistenRef.current();
                unlistenRef.current = null;
            }
            return;
        }

        // Don't setup watcher if we are searching (results are static snapshot)
        if (searchQuery && searchQuery.trim().length > 0) {
            if (unlistenRef.current) {
                unlistenRef.current();
                unlistenRef.current = null;
                invoke('stop_watching', { path }).catch(() => { });
            }
            return;
        }

        // Stop old watcher
        if (unlistenRef.current) {
            unlistenRef.current();
            invoke('stop_watching', { path }).catch(() => { });
        }

        // Start new directory watcher
        invoke('watch_directory', { path }).catch(() => { });
        listen<DirChangedPayload>('dir-changed', (event) => {
            if (event.payload.path !== path) return;
            if (searchQuery && searchQuery.trim().length > 0) {
                load(path, searchQuery, true);
                return;
            }

            const entries = event.payload.entries ?? [];
            if (entries.length === 0) {
                load(path, searchQuery, true);
                return;
            }

            for (const entry of entries) {
                if (entry.path) pendingEventMapRef.current.set(entry.path, entry.kind);
            }
            if (incrementalTimeoutRef.current) {
                window.clearTimeout(incrementalTimeoutRef.current);
            }
            incrementalTimeoutRef.current = window.setTimeout(() => {
                const pending = [...pendingEventMapRef.current.entries()].map(([path, kind]) => ({ path, kind }));
                pendingEventMapRef.current.clear();
                if (pending.length === 0) return;
                applyIncrementalRefresh(path, pending);
            }, 90);
        }).then(unlisten => {
            unlistenRef.current = unlisten;
        });

        return () => {
            if (unlistenRef.current) {
                unlistenRef.current();
                unlistenRef.current = null;
            }
            if (incrementalTimeoutRef.current) {
                window.clearTimeout(incrementalTimeoutRef.current);
                incrementalTimeoutRef.current = null;
            }
            invoke('stop_watching', { path }).catch(() => { });
        };
    }, [path, searchQuery, load, applyIncrementalRefresh]);

    // Refresh tag view when tags change
    useEffect(() => {
        if (!path || !isTagPath(path)) return;
        load(path, searchQuery, true);
    }, [tagsMap, path, searchQuery, load, isTagPath]);

    useEffect(() => {
        const handleRefresh = () => {
            if (!path) return;
            load(path, searchQuery, true);
        };
        window.addEventListener('explorer-refresh', handleRefresh);
        return () => window.removeEventListener('explorer-refresh', handleRefresh);
    }, [path, searchQuery, load]);

    useEffect(() => {
        const handleSort = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail || !detail.key) return;
            const nextKey = detail.key as SortKey;

            setSortKey(currentKey => {
                if (currentKey === nextKey) {
                    setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                    return currentKey;
                }
                setSortDir('asc');
                return nextKey;
            });
        };
        const handleSortDir = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail || !detail.dir) return;
            setSortDir(detail.dir as SortDir);
        };
        window.addEventListener('explorer-sort', handleSort);
        window.addEventListener('explorer-sort-dir', handleSortDir);
        return () => {
            window.removeEventListener('explorer-sort', handleSort);
            window.removeEventListener('explorer-sort-dir', handleSortDir);
        };
    }, []);

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('asc'); }
    };

    const filtered = useMemo(() => showHidden ? allFiles : allFiles.filter(f => !f.hidden), [allFiles, showHidden]);
    const sorted = useMemo(() => sortFiles(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

    return { files: sorted, allFiles: filtered, loading, error, sortKey, sortDir, toggleSort, reload: (backgroundRefresh = false) => load(path, searchQuery, backgroundRefresh) };
}
