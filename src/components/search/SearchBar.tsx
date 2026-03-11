import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, X, ChevronRight, HardDrive } from 'lucide-react';
import { FileEntry } from '../../hooks/useDirectory';
import './SearchBar.css';

interface Props {
    currentPath: string;
    onSearchResults: (results: FileEntry[] | null) => void;
}

const COMMON_EXTENSIONS = ['pdf', 'png', 'jpg', 'mp4', 'mp3', 'zip', 'txt', 'docx'];

export function SearchBar({ currentPath, onSearchResults }: Props) {
    const [query, setQuery] = useState('');
    const [recursive, setRecursive] = useState(false);
    const [wholeDrive, setWholeDrive] = useState(false);
    const [activeExt, setActiveExt] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const doSearch = async (q: string, ext: string | null, rec: boolean, mft: boolean) => {
        if (!q.trim()) { onSearchResults(null); return; }
        setLoading(true);
        try {
            if (mft) {
                const driveLetter = currentPath.length > 0 ? currentPath[0].toUpperCase() : 'C';
                const results = await invoke<any[]>('search_mft', {
                    driveLetter,
                    query: q,
                    limit: 300,
                });
                const mapped = results.map(r => ({
                    name: r.name,
                    path: r.path,
                    size: 0,
                    modified: 0,
                    created: 0,
                    is_dir: r.is_dir,
                    extension: r.is_dir ? '' : r.name.split('.').pop()?.toLowerCase() || '',
                    hidden: false,
                    symlink: false,
                }));
                // Try client side extension filtering for MFT since backend just does name match
                const finalResults = ext ? mapped.filter(x => x.extension === ext) : mapped;
                onSearchResults(finalResults);
            } else {
                const results = await invoke<FileEntry[]>('search_in_directory', {
                    root: currentPath,
                    query: q,
                    extensions: ext ? [ext] : [],
                    maxResults: 300,
                    recursive: rec,
                });
                onSearchResults(results);
            }
        } catch { onSearchResults(null); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => doSearch(query, activeExt, recursive, wholeDrive), 200);
        return () => clearTimeout(debounceRef.current);
    }, [query, activeExt, recursive, wholeDrive, currentPath]);

    const clear = () => { setQuery(''); setActiveExt(null); onSearchResults(null); inputRef.current?.focus(); };

    const name = currentPath.split('\\').filter(Boolean).pop() ?? currentPath;
    return (
        <div className="searchbar">
            <div className="searchbar-input-row">
                <Search size={13} className="searchbar-icon" />
                <input
                    ref={inputRef}
                    className="searchbar-input"
                    placeholder={`Search in ${name}…`}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    autoFocus
                />
                {loading && <div className="searchbar-spinner" />}
                {query && <button className="searchbar-clear" onClick={clear}><X size={12} /></button>}
            </div>
            <div className="searchbar-filters">
                <button
                    className={`searchbar-filter ${wholeDrive ? 'searchbar-filter--active' : ''}`}
                    onClick={() => { setWholeDrive(!wholeDrive); setRecursive(false); }}
                    title="Instant whole drive search (MFT Engine)"
                >
                    <HardDrive size={11} /> Whole Drive
                </button>
                <button
                    className={`searchbar-filter ${recursive ? 'searchbar-filter--active' : ''}`}
                    onClick={() => { setRecursive(!recursive); setWholeDrive(false); }}
                    title="Include subfolders"
                >
                    <ChevronRight size={11} /> Subfolders
                </button>
                {COMMON_EXTENSIONS.map(ext => (
                    <button
                        key={ext}
                        className={`searchbar-filter ${activeExt === ext ? 'searchbar-filter--active' : ''}`}
                        onClick={() => setActiveExt(activeExt === ext ? null : ext)}
                    >
                        .{ext}
                    </button>
                ))}
            </div>
        </div>
    );
}
