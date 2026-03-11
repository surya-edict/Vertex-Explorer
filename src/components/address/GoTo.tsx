import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Home, Download, FileText, Image, Music, Video, HardDrive, Clock } from 'lucide-react';
import { usePanelStore } from '../../store/panelStore';
import './GoTo.css';

interface SystemPaths { home: string; desktop: string; downloads: string; documents: string; pictures: string; music: string; videos: string; }
interface DriveInfo { letter: string; label: string; total: number; free: number; drive_type: string; }

interface Suggestion { label: string; path: string; icon: React.ReactNode; group: string; }

interface Props { open: boolean; onClose: () => void; panelId: string; }

const ICONS: Record<string, React.ReactNode> = {
    home: <Home size={13} />, desktop: <Monitor size={13} />, downloads: <Download size={13} />,
    documents: <FileText size={13} />, pictures: <Image size={13} />, music: <Music size={13} />, videos: <Video size={13} />,
};
function Monitor({ size }: { size: number }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
}

function FolderIcon({ size }: { size: number }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z" /></svg>;
}

function FileIcon({ size }: { size: number }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M13 2v7h7" /></svg>;
}

export function GoTo({ open, onClose, panelId }: Props) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(0);
    const [sysPaths, setSysPaths] = useState<SystemPaths | null>(null);
    const [drives, setDrives] = useState<DriveInfo[]>([]);
    const [recents, setRecents] = useState<string[]>([]);
    const [mftResults, setMftResults] = useState<any[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const activeWs = usePanelStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId) || s.workspaces[0]);
    const panels = activeWs.panels;
    const navigate = usePanelStore(s => s.navigate);
    const panel = panels.find(p => p.id === panelId) ?? panels[0];

    useEffect(() => {
        if (!open) { setQuery(''); setSelected(0); setMftResults([]); return; }
        invoke<SystemPaths>('get_system_paths').then(setSysPaths).catch(() => { });
        invoke<DriveInfo[]>('get_drives').then(setDrives).catch(() => { });
        try { setRecents(JSON.parse(localStorage.getItem('explorer-recents') ?? '[]')); } catch { }

        // Build MFT index for the current system drive (usually C)
        invoke('build_mft_index', { driveLetter: 'C' }).catch(console.error);

        setTimeout(() => inputRef.current?.focus(), 30);
    }, [open]);

    useEffect(() => {
        if (!query || query.length < 2) {
            setMftResults([]);
            return;
        }
        const timer = setTimeout(() => {
            invoke<any[]>('search_mft', { driveLetter: 'C', query, limit: 12 })
                .then(setMftResults)
                .catch(console.error);
        }, 80);
        return () => clearTimeout(timer);
    }, [query]);

    const suggestions: Suggestion[] = [
        ...Object.entries(sysPaths ?? {}).map(([k, p]) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), path: p, icon: ICONS[k] ?? <FileText size={13} />, group: 'Quick Access' })),
        ...drives.map(d => ({ label: `${d.letter} ${d.label ? `(${d.label})` : ''}`, path: d.letter + '\\', icon: <HardDrive size={13} />, group: 'Drives' })),
        ...recents.slice(0, 8).map(p => ({ label: p.split('\\').pop() ?? p, path: p, icon: <Clock size={13} />, group: 'Recent' })),
        ...mftResults.map(r => ({ label: r.name, path: r.path, icon: r.is_dir ? <FolderIcon size={13} /> : <FileIcon size={13} />, group: 'Search Results' })),
    ];

    const filtered = query
        ? suggestions.filter(s => s.label.toLowerCase().includes(query.toLowerCase()) || s.path.toLowerCase().includes(query.toLowerCase()))
        : suggestions;

    const go = (path: string) => {
        if (!panel) return;
        invoke('increment_score', { path });
        navigate(panel.id, panel.activeTabId, path);
        // Save to recents
        const updated = [path, ...recents.filter(r => r !== path)].slice(0, 20);
        setRecents(updated);
        localStorage.setItem('explorer-recents', JSON.stringify(updated));
        onClose();
    };

    const handleKey = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
        if (e.key === 'Enter') {
            const item = filtered[selected];
            if (item) go(item.path);
            else if (query.includes('\\') || query.includes('/')) go(query);
        }
        if (e.key === 'Escape') {
            const hasPriorityPopup = document.querySelector('.confirm-dialog-overlay, .input-dialog-overlay, .ctx-menu');
            if (!hasPriorityPopup) onClose();
        }
    }, [filtered, selected, query, onClose]);

    if (!open) return null;

    const groups = [...new Set(filtered.map(s => s.group))];

    return (
        <div className="goto-overlay" onMouseDown={onClose}>
            <div className="goto anim-scale" onMouseDown={e => e.stopPropagation()}>
                <div className="goto-header">
                    <svg className="goto-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                    <input
                        ref={inputRef}
                        className="goto-input"
                        placeholder="Go to folder, drive, or type a path…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKey}
                    />
                </div>
                <div className="goto-list">
                    {groups.map(group => (
                        <div key={group}>
                            <div className="goto-group-label">{group}</div>
                            {filtered.filter(s => s.group === group).map(item => {
                                const idx = filtered.indexOf(item);
                                return (
                                    <button key={item.path} className={`goto-item ${idx === selected ? 'goto-item--selected' : ''}`}
                                        onClick={() => go(item.path)} onMouseEnter={() => setSelected(idx)}>
                                        <span className="goto-item-icon">{item.icon}</span>
                                        <div className="goto-item-text">
                                            <span className="goto-item-label">{item.label}</span>
                                            <span className="goto-item-path">{item.path}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
