import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { usePanelStore } from '../../store/panelStore';
import { useClipboardStore } from '../../store/clipboardStore';
import { useTagStore, TAG_COLORS } from '../../store/tagStore';
import { useSettingsStore } from '../../store/settingsStore';
import { FileEntry } from '../../hooks/useDirectory';
import { IMAGE_EXTS, VIDEO_EXTS, ARCHIVE_EXTS } from '../../utils/fileTypes';
import { pasteWithConflictCheck } from '../../utils/paste';
import {
    ExternalLink, Plus, Terminal, FolderOpen, AppWindow, FolderInput, FolderOutput,
    Link, Type, FolderPlus, FilePlus, Info, Trash2, X, Archive, PackageOpen, RotateCcw, RotateCw, Image,
    Scissors, ClipboardPaste, Pin, PinOff, Pencil, Monitor,
    RefreshCw, Play, List, ChevronRight, ArrowUpDown, LayoutGrid, Copy, Tag, Check
} from 'lucide-react';
import './ContextMenu.css';

// ─── Types ────────────────────────────────────────────────────────────────
export type ContextMenuType = 'file' | 'directory' | 'background' | 'sidebar-quick' | 'sidebar-drive' | 'sidebar-pinned' | 'sidebar-recycle' | 'recycle-bin-item';

export interface ContextMenuState {
    x: number;
    y: number;
    type: ContextMenuType;
    files: FileEntry[];
    currentDir: string;
    sidebarPath?: string;
    sidebarLabel?: string;
    sortKey?: string;
    sortDir?: 'asc' | 'desc';
}

interface MenuItem {
    id: string;
    label: string;
    shortcut?: string;
    icon?: React.ReactNode;
    divider?: boolean;
    danger?: boolean;
    disabled?: boolean;
    action?: () => void;
    submenu?: MenuItem[];
}

interface Props {
    menu: ContextMenuState | null;
    onClose: () => void;
    onRefresh: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma']);

function getFileCategory(file: FileEntry): string {
    const ext = file.extension?.toLowerCase() ?? '';
    if (file.is_dir) return 'folder';
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (ARCHIVE_EXTS.has(ext)) return 'archive';
    return 'generic';
}

// ─── Native Menu Mapping ──────────────────────────────────────────────────
type NativeMenuItem = {
    id: number;
    title: string;
    is_separator: boolean;
    subitems: NativeMenuItem[] | null;
    icon: string | null;
};

// Professional fallback icon mapping for native menu items
const getNativeFallbackIcon = (title: string): React.ReactNode | null => {
    const t = title.toLowerCase();
    if (t.includes('open in terminal') || t.includes('powershell') || t.includes('command')) return <Terminal size={14} />;
    if (t.includes('open with') || t === 'open') return <ExternalLink size={14} />;
    if (t.includes('copy as path') || t.includes('copy path')) return <Link size={14} />;
    if (t.includes('copy')) return <Copy size={14} />;
    if (t.includes('paste')) return <ClipboardPaste size={14} />;
    if (t.includes('cut')) return <Scissors size={14} />;
    if (t.includes('rename')) return <Pencil size={14} />;
    if (t.includes('delete')) return <Trash2 size={14} />;
    if (t.includes('share')) return <ExternalLink size={14} />;
    if (t.includes('pin')) return <Pin size={14} />;
    if (t.includes('properties')) return <Info size={14} />;
    if (t.includes('send to')) return <FolderOutput size={14} />;
    if (t.includes('compress')) return <Archive size={14} />;
    if (t.includes('extract')) return <PackageOpen size={14} />;
    return null;
};

// Native bitmap icon from Windows HBITMAP (base64 PNG)
const NativeBitmapIcon = ({ src }: { src: string }) => (
    <img src={src} alt="" style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }} draggable={false} />
);

const mapNativeItems = (items: NativeMenuItem[], basePath: string[], onRefresh: () => void, onClose: () => void): MenuItem[] => {
    return items.map(idx => {
        if (idx.is_separator) return { id: `native-d-${Math.random()}`, label: '', divider: true };

        // Use native Windows HBITMAP icon if available, otherwise keyword fallback
        const mappedIcon = getNativeFallbackIcon(idx.title);
        const icon = mappedIcon ?? (idx.icon ? <NativeBitmapIcon src={idx.icon} /> : <AppWindow size={14} />);

        return {
            id: `native-${idx.id}`,
            label: idx.title,
            icon,
            submenu: idx.subitems ? mapNativeItems(idx.subitems, basePath, onRefresh, onClose) : undefined,
            action: idx.subitems ? undefined : () => {
                invoke('invoke_native_context_command', { paths: basePath, id: idx.id })
                    .then(() => onRefresh?.())
                    .catch(e => console.error(e));
                onClose();
            }
        };
    });
};

// ─── Quick Action Strip ──────────────────────────────────────────────────
function QuickActionStrip({ files, currentDir, onClose, onRefresh }: {
    files: FileEntry[];
    currentDir: string;
    onClose: () => void;
    onRefresh: () => void;
}) {
    const paths = files.map(f => f.path);
    const single = files.length === 1 ? files[0] : null;

    const actions = [
        { id: 'cut', icon: <Scissors size={15} />, title: 'Cut', action: () => { useClipboardStore.getState().setClipboard(paths, 'cut'); onClose(); } },
        { id: 'copy', icon: <Copy size={15} />, title: 'Copy', action: () => { useClipboardStore.getState().setClipboard(paths, 'copy'); onClose(); } },
        {
            id: 'paste', icon: <ClipboardPaste size={15} />, title: 'Paste', action: async () => {
                const { paths: srcPaths, action, clearClipboard } = useClipboardStore.getState();
                if (srcPaths.length > 0 && action) {
                    onClose();
                    await pasteWithConflictCheck(srcPaths, currentDir, action, {
                        onSuccess: () => onRefresh(),
                        onClearClipboard: () => clearClipboard()
                    });
                } else {
                    onClose();
                }
            }
        },
        {
            id: 'rename', icon: <Pencil size={15} />, title: 'Rename', disabled: !single, action: () => {
                if (single) {
                    window.dispatchEvent(new CustomEvent('explorer-rename', { detail: single.path }));
                }
                onClose();
            }
        },
        {
            id: 'pin', icon: <Pin size={15} />, title: 'Pin', action: () => {
                const p = single?.path ?? currentDir;
                try {
                    const pinned: string[] = JSON.parse(localStorage.getItem('explorer-pinned') ?? '[]');
                    if (!pinned.includes(p)) {
                        pinned.push(p);
                        localStorage.setItem('explorer-pinned', JSON.stringify(pinned));
                    }
                } catch { }
                window.dispatchEvent(new CustomEvent('explorer-pins-changed'));
                onClose();
            }
        },
        {
            id: 'trash', icon: <Trash2 size={15} />, title: 'Delete', danger: true, action: async () => {
                const perform = async () => { await invoke('trash_items', { paths }); onRefresh(); };
                if (useSettingsStore.getState().confirmDelete) {
                    (window as any).__explorerConfirmDialog?.({
                        title: 'Delete Items',
                        message: `Are you sure you want to move ${paths.length} item(s) to the Recycle Bin?`,
                        type: 'warning',
                        confirmLabel: 'Move to Bin',
                        onConfirm: perform
                    });
                } else {
                    await perform();
                }
                onClose();
            }
        },
    ];

    return (
        <div className="ctx-quick-strip">
            {actions.map(a => (
                <button
                    key={a.id}
                    className={`ctx-quick-btn ${a.danger ? 'ctx-quick-btn--danger' : ''}`}
                    title={a.title}
                    disabled={a.disabled}
                    onClick={a.action}
                >
                    {a.icon}
                </button>
            ))}
        </div>
    );
}

// ─── Image Preview Component ─────────────────────────────────────────────
function InlineImagePreview({ file, onClose }: { file: FileEntry; onClose: () => void }) {
    return (
        <button
            className="ctx-preview ctx-preview--image"
            onClick={(e) => {
                e.stopPropagation();
                (window as any).__explorerQuickLook?.(file);
                onClose();
            }}
            title="Open preview"
        >
            <img src={convertFileSrc(file.path)} alt={file.name} />
        </button>
    );
}

// ─── Video Preview Component ─────────────────────────────────────────────
function InlineVideoPreview({ file, onClose }: { file: FileEntry; onClose: () => void }) {
    return (
        <button
            className="ctx-preview ctx-preview--video"
            onClick={(e) => {
                e.stopPropagation();
                (window as any).__explorerQuickLook?.(file);
                onClose();
            }}
            title="Open preview"
        >
            <video src={convertFileSrc(file.path)} muted preload="metadata" />
            <div className="ctx-preview-play"><Play size={20} /></div>
        </button>
    );
}

// ─── Audio Mini Player ───────────────────────────────────────────────────
function InlineAudioPreview({ file, onClose }: { file: FileEntry; onClose: () => void }) {
    return (
        <button
            className="ctx-preview ctx-preview--audio"
            onClick={(e) => {
                e.stopPropagation();
                (window as any).__explorerQuickLook?.(file);
                onClose();
            }}
            title="Open preview"
        >
            <span className="ctx-audio-play-btn" aria-hidden="true">
                <Play size={14} />
            </span>
            <div className="ctx-audio-info">
                <span className="ctx-audio-name">{file.name}</span>
                <span className="ctx-audio-hint">Open in preview</span>
            </div>
        </button>
    );
}

// ─── Submenu Item Component ──────────────────────────────────────────────
function SubMenuItem({ item }: { item: MenuItem }) {
    const [open, setOpen] = useState(false);
    const subRef = useRef<HTMLDivElement>(null);
    const btnRef = useRef<HTMLButtonElement>(null);

    // Position submenu
    const [subPos, setSubPos] = useState<{ left: number; top: number; maxHeight: number }>({ left: 0, top: 0, maxHeight: 400 });

    useEffect(() => {
        if (open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const subW = 220;
            const subH = (item.submenu?.length ?? 0) * 30 + 10;

            let left = rect.right + 2;
            let top = rect.top;
            if (left + subW > vw) left = rect.left - subW - 2;

            if (top + subH > vh - 10) {
                top = Math.max(10, vh - subH - 10);
            }

            const maxHeight = Math.max(100, vh - top - 10);

            setSubPos({ left, top, maxHeight });
        }
    }, [open, item.submenu]);

    return (
        <div
            className="ctx-submenu-wrapper"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <button ref={btnRef} className="ctx-item ctx-item--submenu">
                <span className="ctx-item-icon">{item.icon}</span>
                <span className="ctx-item-label">{item.label}</span>
                <ChevronRight size={12} className="ctx-item-chevron" />
            </button>
            {open && item.submenu && createPortal(
                <div
                    ref={subRef}
                    className="ctx-submenu anim-scale"
                    style={{ left: subPos.left, top: subPos.top, maxHeight: subPos.maxHeight }}
                    onMouseEnter={() => setOpen(true)}
                    onMouseLeave={() => setOpen(false)}
                >
                    {item.submenu.map(sub => sub.divider
                        ? <div key={sub.id} className="ctx-divider" />
                        : sub.submenu ? (
                            <SubMenuItem key={sub.id} item={sub} />
                        ) : (
                            <button key={sub.id} className={`ctx-item ${sub.danger ? 'ctx-item--danger' : ''}`} onClick={sub.action} disabled={sub.disabled}>
                                <span className="ctx-item-icon">{sub.icon}</span>
                                <span className="ctx-item-label">{sub.label}</span>
                                {sub.shortcut && <span className="ctx-item-shortcut">{sub.shortcut}</span>}
                            </button>
                        )
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}

// ─── Main Context Menu ───────────────────────────────────────────────────
export function ContextMenu({ menu, onClose, onRefresh }: Props) {
    const menuRef = useRef<HTMLDivElement>(null);
    const { setTag, removeTag } = useTagStore();

    const activeWs = usePanelStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId) || s.workspaces[0]);
    const panels = activeWs.panels;
    const activePanelId = activeWs.activePanelId || panels[0]?.id;
    const addTab = usePanelStore(s => s.addTab);
    const navigate = usePanelStore(s => s.navigate);
    const updateTab = usePanelStore(s => s.updateTab);
    const activePanel = panels.find(p => p.id === activePanelId) ?? panels[0];
    const backgroundImage = useSettingsStore(s => s.backgroundImage);

    const [nativeItems, setNativeItems] = useState<MenuItem[]>([]);
    const [loadingNative, setLoadingNative] = useState(false);

    useEffect(() => {
        if (!menu) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.ctx-submenu')) return;
            if (menuRef.current && !menuRef.current.contains(target)) onClose();
        };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc); };
    }, [menu, onClose]);

    useEffect(() => {
        if (!menu) {
            setNativeItems([]);
            return;
        }
        if (menu.type === 'file' || menu.type === 'directory' || menu.type === 'background') {
            setLoadingNative(true);
            const pathsToPass = menu.type === 'background' ? [menu.currentDir] : menu.files.map(f => f.path);

            invoke<NativeMenuItem[]>('get_native_context_menu_items', { paths: pathsToPass })
                .then(res => {
                    setNativeItems(mapNativeItems(res, pathsToPass, onRefresh, onClose));
                    setLoadingNative(false);
                })
                .catch(e => {
                    console.error(e);
                    setLoadingNative(false);
                });
        } else {
            setNativeItems([]);
        }
    }, [menu]);

    if (!menu) return null;

    const { files, currentDir, type } = menu;
    const single = files.length === 1 ? files[0] : null;
    const paths = files.map(f => f.path);
    const category = single ? getFileCategory(single) : 'generic';

    // ─── Build menu items based on type ──────────────────────────────
    const buildFileMenuItems = (): MenuItem[] => {
        const items: MenuItem[] = [];
        const tagPaths = files.map(f => f.path);

        // Inline Preview for media
        // (handled separately in render)

        // Open
        if (single) {
            items.push({
                id: 'open', label: single.is_dir ? 'Open' : 'Open', icon: <ExternalLink size={14} />,
                action: () => {
                    if (single.is_dir) navigate(activePanel.id, activePanel.activeTabId, single.path);
                    else invoke('open_file', { path: single.path });
                    onClose();
                }
            });
            items.push({
                id: 'open-tab', label: 'Open in New Tab', shortcut: 'Ctrl+T', icon: <Plus size={14} />,
                action: () => { addTab(activePanel.id, single.is_dir ? single.path : currentDir); onClose(); }
            });
            if (single.is_dir) {
                items.push({
                    id: 'terminal', label: 'Open in Terminal', icon: <Terminal size={14} />,
                    action: () => { invoke('open_in_terminal', { path: single.path }); onClose(); }
                });
            }

            // Pin / Unpin
            items.push({ id: 'd-pin', label: '', divider: true });
            const isPinned = (() => {
                try {
                    const pinned: string[] = JSON.parse(localStorage.getItem('explorer-pinned') ?? '[]');
                    return pinned.includes(single.path);
                } catch {
                    return false;
                }
            })();
            items.push({
                id: isPinned ? 'unpin' : 'pin',
                label: isPinned ? 'Unpin' : 'Pin',
                icon: isPinned ? <PinOff size={14} /> : <Pin size={14} />,
                action: () => {
                    try {
                        const pinned: string[] = JSON.parse(localStorage.getItem('explorer-pinned') ?? '[]');
                        const next = isPinned ? pinned.filter(p => p !== single.path) : (pinned.includes(single.path) ? pinned : [...pinned, single.path]);
                        localStorage.setItem('explorer-pinned', JSON.stringify(next));
                    } catch { }
                    window.dispatchEvent(new CustomEvent('explorer-pins-changed'));
                    onClose();
                }
            });
        }

        items.push({ id: 'd-tag-top', label: '', divider: true });
        items.push({
            id: 'tags', label: 'Tag', icon: <Tag size={14} />,
            submenu: [
                ...TAG_COLORS.map(tc => ({
                    id: `tag-${tc.id}`,
                    label: tc.label,
                    icon: <span style={{ width: 12, height: 12, borderRadius: '50%', background: tc.hex, display: 'inline-block', flexShrink: 0 }} />,
                    action: () => { tagPaths.forEach(p => setTag(p, tc.id)); onClose(); }
                })),
                { id: 'tag-divider', label: '', divider: true },
                {
                    id: 'tag-remove', label: 'Remove Tag', icon: <X size={14} />,
                    action: () => { tagPaths.forEach(p => removeTag(p)); onClose(); }
                }
            ]
        });

        // Open With submenu
        if (single && !single.is_dir) {
            items.push({
                id: 'open-with', label: 'Open With', icon: <AppWindow size={14} />,
                submenu: [
                    { id: 'ow-default', label: 'Default App', icon: <ExternalLink size={14} />, action: () => { invoke('open_file', { path: single.path }); onClose(); } },
                    ...(category === 'video' ? [
                        { id: 'ow-mpv', label: 'MPV Player', icon: <Play size={14} />, action: () => { invoke('open_with_mpv', { path: single.path }); onClose(); } },
                    ] : []),
                ]
            });
        }

        items.push({ id: 'd1', label: '', divider: true });

        // Copy To / Move To submenus
        items.push({
            id: 'copy-to', label: 'Copy To', icon: <FolderInput size={14} />,
            submenu: [
                { id: 'ct-desktop', label: 'Desktop', icon: <Monitor size={14} />, action: async () => { try { const sp = await invoke<any>('get_system_paths'); await invoke('copy_items', { sources: paths, dest: sp.desktop }); } catch { } onClose(); } },
                { id: 'ct-downloads', label: 'Downloads', icon: <FolderOpen size={14} />, action: async () => { try { const sp = await invoke<any>('get_system_paths'); await invoke('copy_items', { sources: paths, dest: sp.downloads }); } catch { } onClose(); } },
                { id: 'ct-documents', label: 'Documents', icon: <FolderOpen size={14} />, action: async () => { try { const sp = await invoke<any>('get_system_paths'); await invoke('copy_items', { sources: paths, dest: sp.documents }); } catch { } onClose(); } },
            ]
        });
        items.push({
            id: 'move-to', label: 'Move To', icon: <FolderOutput size={14} />,
            submenu: [
                { id: 'mt-desktop', label: 'Desktop', icon: <Monitor size={14} />, action: async () => { try { const sp = await invoke<any>('get_system_paths'); await invoke('move_items', { sources: paths, dest: sp.desktop }); onRefresh(); } catch { } onClose(); } },
                { id: 'mt-downloads', label: 'Downloads', icon: <FolderOpen size={14} />, action: async () => { try { const sp = await invoke<any>('get_system_paths'); await invoke('move_items', { sources: paths, dest: sp.downloads }); onRefresh(); } catch { } onClose(); } },
                { id: 'mt-documents', label: 'Documents', icon: <FolderOpen size={14} />, action: async () => { try { const sp = await invoke<any>('get_system_paths'); await invoke('move_items', { sources: paths, dest: sp.documents }); onRefresh(); } catch { } onClose(); } },
            ]
        });

        items.push({ id: 'd2', label: '', divider: true });

        // Path actions
        items.push({
            id: 'copy-path', label: 'Copy Path', shortcut: 'Ctrl+Shift+C', icon: <Link size={14} />,
            action: () => { navigator.clipboard.writeText(paths.join('\n')); onClose(); }
        });
        if (single) {
            items.push({
                id: 'copy-name', label: 'Copy Name', icon: <Type size={14} />,
                action: () => { navigator.clipboard.writeText(single.name); onClose(); }
            });
        }

        items.push({ id: 'd3', label: '', divider: true });

        // ─── Media-specific actions ──────────────────────────────────
        if (single && category === 'image') {
            items.push({
                id: 'set-wallpaper', label: 'Set as Wallpaper', icon: <Monitor size={14} />,
                action: async () => {
                    try { await invoke('set_wallpaper', { path: single.path }); }
                    catch (e) { console.error('Set wallpaper failed:', e); }
                    onClose();
                }
            });
            items.push({
                id: 'rotate', label: 'Rotate Image', icon: <RotateCw size={14} />,
                submenu: [
                    { id: 'rot-left', label: 'Rotate Left 90°', icon: <RotateCcw size={14} />, action: async () => { try { await invoke('rotate_image', { path: single.path, direction: 'left' }); onRefresh(); } catch (e) { console.error('Rotate failed:', e); } onClose(); } },
                    { id: 'rot-right', label: 'Rotate Right 90°', icon: <RotateCw size={14} />, action: async () => { try { await invoke('rotate_image', { path: single.path, direction: 'right' }); onRefresh(); } catch (e) { console.error('Rotate failed:', e); } onClose(); } },
                ]
            });
            items.push({
                id: 'convert-img', label: 'Convert Format', icon: <RefreshCw size={14} />,
                submenu: [
                    { id: 'conv-png', label: 'To PNG', icon: <Image size={14} />, action: async () => { try { await invoke('convert_image', { path: single.path, format: 'png' }); onRefresh(); } catch (e) { console.error('Convert failed:', e); } onClose(); } },
                    { id: 'conv-jpg', label: 'To JPG', icon: <Image size={14} />, action: async () => { try { await invoke('convert_image', { path: single.path, format: 'jpg' }); onRefresh(); } catch (e) { console.error('Convert failed:', e); } onClose(); } },
                    { id: 'conv-webp', label: 'To WebP', icon: <Image size={14} />, action: async () => { try { await invoke('convert_image', { path: single.path, format: 'webp' }); onRefresh(); } catch (e) { console.error('Convert failed:', e); } onClose(); } },
                ]
            });
            items.push({ id: 'd-img', label: '', divider: true });
        }

        if (single && category === 'video') {
            items.push({
                id: 'play-mpv', label: 'Play with MPV', icon: <Play size={14} />,
                action: () => { invoke('open_with_mpv', { path: single.path }); onClose(); }
            });
            items.push({ id: 'd-vid', label: '', divider: true });
        }

        if (single && category === 'audio') {
            // Audio preview is inline, handled in render
            items.push({ id: 'd-aud', label: '', divider: true });
        }

        if (single && category === 'archive') {
            items.push({
                id: 'extract-here', label: 'Extract Here', icon: <PackageOpen size={14} />,
                action: async () => {
                    await invoke('extract_archive', { path: single.path, dest: currentDir }).catch(e => console.error(e));
                    onRefresh();
                    onClose();
                }
            });
            items.push({ id: 'd-arc', label: '', divider: true });
        }

        // Compress
        if (category !== 'archive' && files.length > 0) {
            items.push({
                id: 'compress', label: 'Compress', icon: <Archive size={14} />,
                submenu: [
                    { id: 'cmp-zip', label: 'ZIP Archive', icon: <Archive size={14} />, action: async () => { await invoke('compress_items', { paths, format: 'zip' }).catch(e => console.error(e)); onRefresh(); onClose(); } },
                    { id: 'cmp-tar', label: 'TAR.GZ Archive', icon: <Archive size={14} />, action: async () => { await invoke('compress_items', { paths, format: 'tar.gz' }).catch(e => console.error(e)); onRefresh(); onClose(); } },
                ]
            });
        }

        items.push({ id: 'd4', label: '', divider: true });

        // New
        items.push({
            id: 'new-folder', label: 'New Folder', shortcut: 'Ctrl+Shift+N', icon: <FolderPlus size={14} />,
            action: async () => {
                const name = prompt('Folder name:');
                if (name) { await invoke('create_folder', { path: currentDir + '\\' + name }); onRefresh(); }
                onClose();
            }
        });
        items.push({
            id: 'new-file', label: 'New File', icon: <FilePlus size={14} />,
            action: async () => {
                const name = prompt('File name:');
                if (name) { await invoke('create_file', { path: currentDir + '\\' + name }); onRefresh(); }
                onClose();
            }
        });

        items.push({ id: 'd5', label: '', divider: true });

        items.push({ id: 'd5b', label: '', divider: true });

        // Properties
        items.push({
            id: 'properties', label: 'Properties', shortcut: 'Alt+Enter', icon: <Info size={14} />,
            action: () => {
                if (single) {
                    (window as any).__explorerSetInspected?.(single);
                }
                onClose();
            }
        });

        items.push({ id: 'd6', label: '', divider: true });

        // Danger zone
        items.push({
            id: 'trash', label: 'Move to Trash', shortcut: 'Del', icon: <Trash2 size={14} />, danger: true,
            action: async () => {
                const perform = async () => { await invoke('trash_items', { paths }); onRefresh(); };
                if (useSettingsStore.getState().confirmDelete) {
                    (window as any).__explorerConfirmDialog?.({
                        title: 'Delete Items',
                        message: `Are you sure you want to move ${paths.length} item(s) to the Recycle Bin?`,
                        type: 'warning',
                        confirmLabel: 'Move to Bin',
                        onConfirm: perform
                    });
                } else {
                    await perform();
                }
                onClose();
            }
        });
        items.push({
            id: 'delete', label: 'Delete Permanently', shortcut: 'Shift+Del', icon: <X size={14} />, danger: true,
            action: async () => {
                const perform = async () => { await invoke('delete_items', { paths }); onRefresh(); };
                if (useSettingsStore.getState().confirmDelete) {
                    (window as any).__explorerConfirmDialog?.({
                        title: 'Permanently Delete Items',
                        message: `Are you sure you want to permanently delete ${paths.length} item(s)? This action cannot be undone.`,
                        type: 'danger',
                        confirmLabel: 'Delete',
                        onConfirm: perform
                    });
                } else {
                    await perform();
                }
                onClose();
            }
        });

        if (loadingNative) {
            items.push({ id: 'native-loading', label: 'Loading Windows menu...', disabled: true });
        } else if (nativeItems.length > 0) {
            items.push({ id: 'd7', label: '', divider: true });
            items.push(...nativeItems);
        }

        return items;
    };

    const buildBackgroundMenuItems = (): MenuItem[] => [
        {
            id: 'new-folder', label: 'New Folder', shortcut: 'Ctrl+Shift+N', icon: <FolderPlus size={14} />,
            action: async () => {
                onClose();
                (window as any).__explorerInputDialog({
                    title: 'New Folder',
                    type: 'folder',
                    onSubmit: async (name: string) => {
                        await invoke('create_folder', { path: currentDir + '\\' + name });
                        onRefresh();
                    }
                });
            }
        },
        {
            id: 'new-file', label: 'New File', icon: <FilePlus size={14} />,
            action: async () => {
                onClose();
                (window as any).__explorerInputDialog({
                    title: 'New File',
                    type: 'file',
                    onSubmit: async (name: string) => {
                        await invoke('create_file', { path: currentDir + '\\' + name });
                        onRefresh();
                    }
                });
            }
        },
        { id: 'd1', label: '', divider: true },
        {
            id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', icon: <ClipboardPaste size={14} />,
            action: async () => {
                const { paths: srcPaths, action, clearClipboard } = useClipboardStore.getState();
                if (srcPaths.length > 0 && action) {
                    onClose();
                    await pasteWithConflictCheck(srcPaths, currentDir, action, {
                        onSuccess: () => onRefresh(),
                        onClearClipboard: () => clearClipboard()
                    });
                } else {
                    onClose();
                }
            }
        },
        { id: 'd2', label: '', divider: true },
        {
            id: 'sort-by', label: 'Sort By', icon: <ArrowUpDown size={14} />,
            submenu: [
                { id: 'sort-name', label: 'Name', icon: menu.sortKey === 'name' ? <Check size={12} /> : null, action: () => { window.dispatchEvent(new CustomEvent('explorer-sort', { detail: { key: 'name' } })); onClose(); } },
                { id: 'sort-size', label: 'Size', icon: menu.sortKey === 'size' ? <Check size={12} /> : null, action: () => { window.dispatchEvent(new CustomEvent('explorer-sort', { detail: { key: 'size' } })); onClose(); } },
                { id: 'sort-date', label: 'Date Modified', icon: menu.sortKey === 'modified' ? <Check size={12} /> : null, action: () => { window.dispatchEvent(new CustomEvent('explorer-sort', { detail: { key: 'modified' } })); onClose(); } },
                { id: 'sort-type', label: 'Type', icon: menu.sortKey === 'extension' ? <Check size={12} /> : null, action: () => { window.dispatchEvent(new CustomEvent('explorer-sort', { detail: { key: 'extension' } })); onClose(); } },
                { id: 'd-sort', label: '', divider: true },
                { id: 'sort-asc', label: 'Ascending', icon: menu.sortDir === 'asc' ? <Check size={12} /> : null, action: () => { window.dispatchEvent(new CustomEvent('explorer-sort-dir', { detail: { dir: 'asc' } })); onClose(); } },
                { id: 'sort-desc', label: 'Descending', icon: menu.sortDir === 'desc' ? <Check size={12} /> : null, action: () => { window.dispatchEvent(new CustomEvent('explorer-sort-dir', { detail: { dir: 'desc' } })); onClose(); } },
            ]
        },
        {
            id: 'view', label: 'View', icon: <LayoutGrid size={14} />,
            submenu: [
                { id: 'view-grid', label: 'Grid', icon: <LayoutGrid size={14} />, action: () => { updateTab(activePanel.id, activePanel.activeTabId, { viewMode: 'grid' }); onClose(); } },
                { id: 'view-details', label: 'Details', icon: <List size={14} />, action: () => { updateTab(activePanel.id, activePanel.activeTabId, { viewMode: 'details' }); onClose(); } },
            ]
        },
        { id: 'd3', label: '', divider: true },
        {
            id: 'refresh', label: 'Refresh', shortcut: 'F5', icon: <RefreshCw size={14} />,
            action: () => { onRefresh(); onClose(); }
        },
        { id: 'd4', label: '', divider: true },
        {
            id: 'terminal', label: 'Open in Terminal', icon: <Terminal size={14} />,
            action: () => { invoke('open_in_terminal', { path: currentDir }); onClose(); }
        },
        {
            id: 'copy-path', label: 'Copy Path', icon: <Link size={14} />,
            action: () => { navigator.clipboard.writeText(currentDir); onClose(); }
        },
        ...(loadingNative
            ? [{ id: 'native-loading', label: 'Loading Windows menu...', disabled: true }]
            : nativeItems.length > 0
                ? [{ id: 'd7', label: '', divider: true }, ...nativeItems]
                : [])
    ];

    const buildSidebarMenuItems = (): MenuItem[] => {
        const path = menu.sidebarPath ?? '';
        const items: MenuItem[] = [
            {
                id: 'open', label: 'Open', icon: <FolderOpen size={14} />,
                action: () => { navigate(activePanel.id, activePanel.activeTabId, path); onClose(); }
            },
            {
                id: 'open-tab', label: 'Open in New Tab', icon: <Plus size={14} />,
                action: () => { addTab(activePanel.id, path); onClose(); }
            },
            { id: 'd1', label: '', divider: true },
            {
                id: 'terminal', label: 'Open in Terminal', icon: <Terminal size={14} />,
                action: () => { invoke('open_in_terminal', { path }); onClose(); }
            },
            {
                id: 'copy-path', label: 'Copy Path', icon: <Link size={14} />,
                action: () => { navigator.clipboard.writeText(path); onClose(); }
            },
        ];

        if (type === 'sidebar-recycle') {
            return [
                {
                    id: 'open', label: 'Open', icon: <FolderOpen size={14} />,
                    action: () => { (window as any).__explorerRecycleBin?.(); onClose(); }
                },
                { id: 'd1', label: '', divider: true },
                {
                    id: 'empty', label: 'Empty Trash', icon: <Trash2 size={14} />, danger: true,
                    action: () => {
                        const perform = async () => { await invoke('empty_trash'); onRefresh(); };
                        if (useSettingsStore.getState().confirmDelete) {
                            (window as any).__explorerConfirmDialog?.({
                                title: 'Empty Trash',
                                message: 'Are you sure you want to permanently empty the Recycle Bin? This cannot be undone.',
                                type: 'danger',
                                confirmLabel: 'Empty',
                                onConfirm: perform
                            });
                        } else {
                            perform();
                        }
                        onClose();
                    }
                }
            ];
        }

        if (type === 'sidebar-pinned') {
            items.push({ id: 'd2', label: '', divider: true });
            items.push({
                id: 'unpin', label: 'Remove from Pinned', icon: <PinOff size={14} />, danger: true,
                action: () => {
                    try {
                        const pinned: string[] = JSON.parse(localStorage.getItem('explorer-pinned') ?? '[]');
                        const next = pinned.filter(p => p !== path);
                        localStorage.setItem('explorer-pinned', JSON.stringify(next));
                    } catch { }
                    window.dispatchEvent(new CustomEvent('explorer-pins-changed'));
                    onClose();
                }
            });
        }

        if (type === 'sidebar-quick') {
            items.push({ id: 'd2', label: '', divider: true });
            items.push({
                id: 'pin', label: 'Pin to Quick Access', icon: <Pin size={14} />,
                action: () => {
                    try {
                        const pinned: string[] = JSON.parse(localStorage.getItem('explorer-pinned') ?? '[]');
                        if (!pinned.includes(path)) {
                            pinned.push(path);
                            localStorage.setItem('explorer-pinned', JSON.stringify(pinned));
                        }
                    } catch { }
                    window.dispatchEvent(new CustomEvent('explorer-pins-changed'));
                    onClose();
                }
            });
        }

        if (type === 'sidebar-drive') {
            items.push({ id: 'd2', label: '', divider: true });
            items.push({
                id: 'properties', label: 'Drive Properties', icon: <Info size={14} />,
                action: () => onClose()
            });
        }

        return items;
    };

    // Select builder
    let items: MenuItem[];
    let showQuickStrip = false;
    let showPreview = false;

    if ((type as string) === 'file' || (type as string) === 'directory') {
        items = buildFileMenuItems();
        showQuickStrip = true;
        showPreview = !!single && ['image', 'video', 'audio'].includes(category);
    } else if (type === 'recycle-bin-item') {
        items = [
            {
                id: 'restore', label: 'Restore', icon: <RotateCcw size={14} />,
                action: async () => {
                    try {
                        await invoke('restore_trash_items', { paths });
                        onRefresh();
                        window.dispatchEvent(new CustomEvent('explorer-recycle-bin-refresh'));
                    } catch (e) { console.error('Restore failed:', e); }
                    onClose();
                }
            },
            { id: 'd-rb', label: '', divider: true },
            {
                id: 'delete-permanent', label: 'Delete Permanently', icon: <X size={14} />, danger: true,
                action: async () => {
                    const perform = async () => {
                        await invoke('delete_items', { paths });
                        onRefresh();
                        window.dispatchEvent(new CustomEvent('explorer-recycle-bin-refresh'));
                    };
                    if (useSettingsStore.getState().confirmDelete) {
                        (window as any).__explorerConfirmDialog?.({
                            title: 'Delete Permanently',
                            message: `Are you sure you want to permanently delete ${paths.length} item(s)? This cannot be undone.`,
                            type: 'danger',
                            confirmLabel: 'Delete',
                            onConfirm: perform
                        });
                    } else {
                        await perform();
                    }
                    onClose();
                }
            }
        ];
    } else if ((type as string) === 'background') {
        items = buildBackgroundMenuItems();
    } else {
        items = buildSidebarMenuItems();
    }

    // Filter overlaps with Native items
    if (nativeItems.length > 0) {
        // Labels that are already handled by the quick action strip or custom menu
        const quickStripLabels = new Set(['cut', 'copy', 'paste', 'delete', 'rename', 'properties']);

        // First, filter native items that are already in quick strip
        const filteredNativeLabels = new Set<string>();
        const filteredNativeItems = nativeItems.filter(ni => {
            if (ni.divider) return true;
            const l = (ni.label || '').toLowerCase().trim();
            if (quickStripLabels.has(l)) return false; // already in quick strip
            filteredNativeLabels.add(l);
            return true;
        });

        // Replace nativeItems references in the items array
        // Remove any existing native items and re-append filtered ones
        items = items.filter(item => !item.id.toString().startsWith('native-'));
        if (filteredNativeItems.length > 0) {
            items.push({ id: 'native-divider-top', label: '', divider: true });
            items.push(...filteredNativeItems);
        }

        // Now remove custom items that overlap with native labels
        items = items.filter(item => {
            if (item.divider || item.id.toString().startsWith('native-') || item.id === 'native-loading') return true;

            const customLabel = (item.label || '').toLowerCase().trim();
            if (filteredNativeLabels.has(customLabel)) return false;

            // Handle slight phrasing differences
            if ((customLabel === 'move to trash' || customLabel === 'delete permanently') && filteredNativeLabels.has('delete')) {
                return false;
            }
            if (customLabel === 'copy path' && (filteredNativeLabels.has('copy as path') || filteredNativeLabels.has('copy path'))) {
                return false;
            }
            if (customLabel === 'open in terminal' && (filteredNativeLabels.has('open in terminal') || filteredNativeLabels.has('open powershell window here') || filteredNativeLabels.has('open command window here'))) {
                return false;
            }

            return true;
        });

        // Clean redundant dividers
        items = items.filter((item, i, arr) => {
            if (item.divider) {
                if (i === 0) return false;
                if (arr[i - 1].divider) return false;
                if (i === arr.length - 1) return false;
            }
            return true;
        });
    }

    // Position
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Rough menu size used for clamping; never exceed viewport.
    const mw = 280;
    const mh = Math.min(
        (items.length * 34)
        + (showQuickStrip ? 52 : 0)
        + (showPreview ? 120 : 0)
        + 16,
        Math.max(120, vh - 8)
    );

    // Clamp menu so it always stays fully within the viewport bounds.
    const left = Math.min(Math.max(4, menu.x), Math.max(4, vw - mw - 4));
    const top = Math.min(Math.max(4, menu.y), Math.max(4, vh - mh - 4));


    return (
        <motion.div
            ref={menuRef}
            className="ctx-menu"
            data-transparent={!!backgroundImage}
            style={{ left, top }}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
        >
            {/* Quick Action Strip */}
            {showQuickStrip && (
                <>
                    <QuickActionStrip files={files} currentDir={currentDir} onClose={onClose} onRefresh={onRefresh} />
                    <div className="ctx-divider" />
                </>
            )}

            {/* Inline Preview */}
            {showPreview && single && category === 'image' && <InlineImagePreview file={single} onClose={onClose} />}
            {showPreview && single && category === 'video' && <InlineVideoPreview file={single} onClose={onClose} />}
            {showPreview && single && category === 'audio' && <InlineAudioPreview file={single} onClose={onClose} />}

            {/* Menu Items */}
            <div className="ctx-items">
                {items.map(item => {
                    if (item.divider) return <div key={item.id} className="ctx-divider" />;
                    if (item.submenu) return <SubMenuItem key={item.id} item={item} />;
                    return (
                        <button
                            key={item.id}
                            className={`ctx-item ${item.danger ? 'ctx-item--danger' : ''}`}
                            onClick={item.action}
                            disabled={item.disabled}
                        >
                            <span className="ctx-item-icon">{item.icon}</span>
                            <span className="ctx-item-label">{item.label}</span>
                            {item.shortcut && <span className="ctx-item-shortcut">{item.shortcut}</span>}
                        </button>
                    );
                })}
            </div>
        </motion.div>
    );
}
