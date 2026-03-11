import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { usePanelStore } from '../../store/panelStore';
import { useSettingsStore } from '../../store/settingsStore';
import { SystemFileIcon } from '../common/Icons';
import { FileEntry } from '../../hooks/useDirectory';
import { formatBytes } from '../../utils/formatters';
import { clearDraggedPaths, getDraggedPaths, setDraggedPaths } from '../../utils/dragDrop';
import './MillerColumns.css';

interface Props {
    panelId: string;
    tabPath: string;
    tabId: string;
    onFileSelect?: (file: FileEntry | null) => void;
}

interface ColumnData {
    path: string;
    files: FileEntry[];
    selected: string | null;
}

export function MillerColumns({ panelId, tabPath, tabId, onFileSelect }: Props) {
    const [columns, setColumns] = useState<ColumnData[]>([]);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const navigate = usePanelStore(s => s.navigate);
    const showHidden = useSettingsStore(s => s.showHidden);
    const singleClickToOpen = useSettingsStore(s => s.singleClickToOpen);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Build initial column chain from root to current path
    useEffect(() => {
        buildColumns(tabPath);
    }, [tabPath]);

    // Scroll to the right when new columns appear
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [columns.length]);

    const loadDir = useCallback(async (path: string): Promise<FileEntry[]> => {
        try {
            return await invoke<FileEntry[]>('read_dir', { path });
        } catch {
            return [];
        }
    }, []);

    const buildColumns = useCallback(async (targetPath: string) => {
        // Split the path into segments and build columns from root
        const parts = targetPath.replace(/\//g, '\\').split('\\').filter(Boolean);
        const newColumns: ColumnData[] = [];

        // Load root column
        let currentPath = parts[0] + '\\';
        let files = await loadDir(currentPath);
        newColumns.push({ path: currentPath, files, selected: parts.length > 1 ? null : null });

        // Load each intermediate directory
        for (let i = 1; i < parts.length; i++) {
            const nextDir = currentPath + parts[i];
            const fullPath = nextDir + '\\';
            // Mark the selection in previous column
            newColumns[newColumns.length - 1].selected = nextDir;

            files = await loadDir(fullPath);
            currentPath = fullPath;
            newColumns.push({ path: fullPath, files, selected: null });
        }

        setColumns(newColumns);
    }, [loadDir]);

    const normalizePath = useCallback((path: string) => path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase(), []);

    const isInvalidDrop = useCallback((sourcePaths: string[], targetPath: string) => {
        const normalizedTarget = normalizePath(targetPath);
        return sourcePaths.some((sourcePath) => {
            const normalizedSource = normalizePath(sourcePath);
            return normalizedSource === normalizedTarget || normalizedTarget.startsWith(`${normalizedSource}\\`);
        });
    }, [normalizePath]);

    const handleDragStart = useCallback((e: React.DragEvent, file: FileEntry) => {
        setDraggedPaths(e.dataTransfer, [file.path]);
        e.dataTransfer.effectAllowed = 'copyMove';
    }, []);

    const handleDragOverToPath = useCallback((e: React.DragEvent, targetPath: string) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
        setDropTarget(targetPath);
    }, []);

    const clearDropTarget = useCallback(() => setDropTarget(null), []);

    const handleDropToPath = useCallback(async (e: React.DragEvent, targetPath: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(null);

        const sourcePaths = getDraggedPaths(e.dataTransfer);
        if (sourcePaths.length === 0) return;

        try {
            if (isInvalidDrop(sourcePaths, targetPath)) return;
            const cmd = e.ctrlKey ? 'copy_items' : 'move_items';
            await invoke(cmd, { sources: sourcePaths, dest: targetPath });
            await buildColumns(tabPath);
            window.dispatchEvent(new CustomEvent('explorer-refresh'));
        } catch (err) {
            console.error('Miller drop failed:', err);
        }
        finally {
            clearDraggedPaths();
        }
    }, [isInvalidDrop, buildColumns, tabPath]);

    const lastOpenedRef = useRef<{ path: string; time: number } | null>(null);

    const handleItemClick = useCallback(async (colIndex: number, file: FileEntry) => {
        if (file.is_dir) {
            // Truncate columns after this one and load new
            const newColumns = columns.slice(0, colIndex + 1);
            newColumns[colIndex] = { ...newColumns[colIndex], selected: file.path };

            const children = await loadDir(file.path + '\\');
            newColumns.push({ path: file.path + '\\', files: children, selected: null });
            setColumns(newColumns);

            // Navigate the tab to this folder
            navigate(panelId, tabId, file.path);
        } else {
            // Select the file, truncate any columns after
            const newColumns = columns.slice(0, colIndex + 1);
            newColumns[colIndex] = { ...newColumns[colIndex], selected: file.path };
            setColumns(newColumns);
            onFileSelect?.(file);

            localStorage.setItem(`explorer-selected-${tabPath}`, JSON.stringify([file.path]));
            window.dispatchEvent(new CustomEvent('explorer-selection-change', {
                detail: { count: 1, size: file.size, currentDir: newColumns[colIndex].path }
            }));

            // Trigger QuickLook on single click of a file
            (window as any).__explorerQuickLook?.(file);

            if (singleClickToOpen) {
                const now = Date.now();
                if (lastOpenedRef.current?.path === file.path && now - lastOpenedRef.current.time < 350) return;
                lastOpenedRef.current = { path: file.path, time: now };
                invoke('open_file', { path: file.path }).catch(console.error);
            }
        }
    }, [columns, loadDir, navigate, panelId, tabId, onFileSelect, singleClickToOpen, tabPath]);

    const handleDoubleClick = useCallback((file: FileEntry) => {
        if (!file.is_dir) {
            invoke('open_file', { path: file.path }).catch(console.error);
        }
    }, []);

    return (
        <div className="miller-columns" ref={scrollRef}>
            {columns.map((col, colIdx) => (
                <div key={col.path} className="miller-column">
                    <div className="miller-column-header">
                        {col.path.split('\\').filter(Boolean).pop() || col.path}
                    </div>
                    <div
                        className={`miller-column-list ${dropTarget === col.path ? 'miller-column-list--droptarget' : ''}`}
                        onDragOver={(e) => handleDragOverToPath(e, col.path)}
                        onDragLeave={clearDropTarget}
                        onDrop={(e) => handleDropToPath(e, col.path)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'background', files: [], currentDir: col.path });
                        }}
                    >
                        {col.files.length === 0 && (
                            <div className="miller-empty">Empty</div>
                        )}
                        <div className="miller-column-list-inner">
                            <AnimatePresence mode="popLayout">
                                {col.files.filter(f => !f.hidden).map((file, fileIdx) => (
                                    <motion.button
                                        key={file.path}
                                        className={`miller-item ${col.selected === file.path ? 'miller-item--active' : ''} ${dropTarget === file.path ? 'miller-item--droptarget' : ''}`}
                                        initial={{ opacity: 0, x: -5 }}
                                        animate={{ opacity: 1, x: 0, transition: { delay: Math.min(fileIdx, 40) * 0.015 } }}
                                        exit={{ opacity: 0, transition: { duration: 0.15 } }}
                                        onClick={() => handleItemClick(colIdx, file)}
                                        onDoubleClick={singleClickToOpen ? undefined : () => handleDoubleClick(file)}
                                        title={file.path}
                                        draggable
                                        onDragStart={(e: any) => handleDragStart(e, file)}
                                        onDragEnd={clearDraggedPaths}
                                        onDragOver={(e) => {
                                            if (!file.is_dir) return;
                                            handleDragOverToPath(e, file.path);
                                        }}
                                        onDragLeave={clearDropTarget}
                                        onDrop={(e) => {
                                            if (!file.is_dir) return;
                                            handleDropToPath(e, file.path);
                                        }}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'file', files: [file], currentDir: col.path });
                                        }}
                                    >
                                        <span className="miller-item-icon">
                                            <SystemFileIcon
                                                path={file.path}
                                                size={14}
                                                extension={file.extension ?? ''}
                                                isDir={file.is_dir}
                                                isHidden={file.hidden}
                                            />
                                        </span>
                                        <span className="miller-item-name">{file.name}</span>
                                        {file.is_dir && <span className="miller-item-chevron">{'>'}</span>}
                                        {!file.is_dir && <span className="miller-item-size">{formatBytes(file.size)}</span>}
                                    </motion.button>
                                ))}
                            </AnimatePresence>
                        </div>
                        <AnimatePresence mode="popLayout">
                            {showHidden && col.files.some(f => f.hidden) && col.files.some(f => !f.hidden) && (
                                <motion.div
                                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', userSelect: 'none' }}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                                >
                                    <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', opacity: 0.5 }} />
                                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hidden Items</span>
                                    <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', opacity: 0.5 }} />
                                </motion.div>
                            )}
                            {showHidden && col.files.filter(f => f.hidden).map((file, fileIdx) => (
                                <motion.button
                                    key={file.path}
                                    className={`miller-item ${col.selected === file.path ? 'miller-item--active' : ''} ${dropTarget === file.path ? 'miller-item--droptarget' : ''}`}
                                    initial={{ opacity: 0, x: -5 }}
                                    animate={{ opacity: 1, x: 0, transition: { delay: Math.min(fileIdx, 40) * 0.015 } }}
                                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                                    onClick={() => handleItemClick(colIdx, file)}
                                    onDoubleClick={singleClickToOpen ? undefined : () => handleDoubleClick(file)}
                                    title={file.path}
                                    draggable
                                    onDragStart={(e: any) => handleDragStart(e, file)}
                                    onDragEnd={clearDraggedPaths}
                                    onDragOver={(e) => {
                                        if (!file.is_dir) return;
                                        handleDragOverToPath(e, file.path);
                                    }}
                                    onDragLeave={clearDropTarget}
                                    onDrop={(e) => {
                                        if (!file.is_dir) return;
                                        handleDropToPath(e, file.path);
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        (window as any).__explorerContextMenu?.({ x: e.clientX, y: e.clientY, type: 'file', files: [file], currentDir: col.path });
                                    }}
                                >
                                    <span className="miller-item-icon">
                                        <SystemFileIcon
                                            path={file.path}
                                            size={14}
                                            extension={file.extension ?? ''}
                                            isDir={file.is_dir}
                                            isHidden={file.hidden}
                                        />
                                    </span>
                                    <span className="miller-item-name">{file.name}</span>
                                    {file.is_dir && <span className="miller-item-chevron">{'>'}</span>}
                                    {!file.is_dir && <span className="miller-item-size">{formatBytes(file.size)}</span>}
                                </motion.button>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            ))}
        </div>
    );
}
