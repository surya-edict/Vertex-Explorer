import { type FileCategory, getFileType } from '../../utils/fileTypes';
import { useFileIcon } from '../../hooks/useFileIcon';
import { EyeOff } from 'lucide-react';

const CATEGORY_COLORS: Record<FileCategory, string> = {
    image: '#a78bfa',
    video: '#818cf8',
    audio: '#ec4899',
    document: '#94a3b8',
    code: '#38bdf8',
    archive: '#f59e0b',
    executable: '#10b981',
    system: '#64748b',
    font: '#e879f9',
    generic: '#6b7280',
};

interface FileTheme {
    bg: string;
    glyph: React.JSX.Element;
}

function matchSpecificFileTheme(ext: string): FileTheme | null {
    const e = ext.toLowerCase();

    // ─── DOCUMENTS ───
    if (['txt', 'log'].includes(e)) return {
        bg: '#64748b', // Slate
        glyph: <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round"><path d="M7 8h10M7 12h10M7 16h6" /></g>
    };
    if (e === 'md') return { // Markdown
        bg: '#0f172a',
        glyph: <path d="M5 8v8h3v-4.5L10 14l2-2.5V16h3V8h-3l-2 2.5L8 8H5z" fill="#fff" />
    };
    if (e === 'csv') return {
        bg: '#059669', // Green
        glyph: <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="none" /><path d="M6 10h12M10 6v12M6 14h12" /></g>
    };

    // ─── OFFICE / PDF ───
    if (['doc', 'docx'].includes(e)) return {
        bg: '#2563eb', // Blue
        glyph: <path d="M6 7l3 9 3-6 3 6 3-9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    };
    if (['xls', 'xlsx'].includes(e)) return {
        bg: '#10b981', // Emerald
        glyph: <g stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M7 7l10 10M17 7L7 17" /></g>
    };
    if (['ppt', 'pptx'].includes(e)) return {
        bg: '#ea580c', // Orange
        glyph: <g fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="5" /><path d="M12 7v5l4 3" strokeLinecap="round" strokeLinejoin="round" /></g>
    };
    if (e === 'pdf') return {
        bg: '#dc2626', // Red
        glyph: <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="M14 10v4h-4v-8h4a2 2 0 110 4z" />
            <path d="M10 14l3 4" />
        </g>
    };

    // ─── CODE / SCRIPT ───
    if (e === 'py') return {
        bg: '#1e293b',
        glyph: <g fill="#fff"><path d="M12 6c-2 0-3 .5-3 2v1h4v1h-4H7v3c0 1.5 1 2 3 2h1v-2c0-1.5 1-2 2-2h2V8a2 2 0 00-2-2h-1z" /><path d="M12 18c2 0 3-.5 3-2v-1h-4v-1h4h2v-3c0-1.5-1-2-3-2h-1v2c0 1.5-1 2-2 2h-2v3a2 2 0 002 2h1z" /><circle cx="10.5" cy="7.5" r="0.5" fill="#1e293b" /><circle cx="13.5" cy="16.5" r="0.5" fill="#1e293b" /></g>
    };
    if (['js', 'jsx'].includes(e)) return {
        bg: '#eab308',
        glyph: <path d="M11 11v3q0 2 -2 2H8M16 11c-1.5 0-1.5 2 0 2 1.5 0 1.5 2 0 2h-2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    };
    if (['ts', 'tsx'].includes(e)) return {
        bg: '#3b82f6',
        glyph: <path d="M8 11h4M10 11v6M17 11c-1.5 0-1.5 2 0 2 1.5 0 1.5 2 0 2h-2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    };
    if (e === 'html') return {
        bg: '#f97316',
        glyph: <g stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M7 9l-3 3 3 3M17 9l3 3-3 3M13 7l-2 10" /></g>
    };
    if (e === 'css') return {
        bg: '#2563eb',
        glyph: <g stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M10 8l-4 4 4 4M14 8l4 4-4 4M13 6l-2 12" /></g>
    };
    if (['c', 'cpp', 'cs'].includes(e)) return {
        bg: '#4338ca',
        glyph: <path d="M14 8a4 4 0 100 8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    };
    if (e === 'java') return {
        bg: '#ea580c',
        glyph: <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none"><path d="M7 11v3a4 4 0 008 0v-3H7z" /><path d="M15 12h1a2 2 0 000-4h-1" /><path d="M9 6v2M12 5v3M15 6v2" /></g>
    };
    if (e === 'rs') return {
        bg: '#1c1917',
        glyph: <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none" strokeLinejoin="round"><path d="M9 16V8h3a3 3 0 010 6H9M13 14l3 3" /></g> // "R"
    };

    // ─── ARCHIVES ───
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return {
        bg: '#d97706',
        glyph: <g><path d="M12 4v7" stroke="#fff" strokeWidth="1.5" strokeDasharray="2 2" /><rect x="10" y="11" width="4" height="6" rx="1" fill="#fff" /><path d="M12 11v3" stroke="#d97706" strokeWidth="1" strokeLinecap="round" /></g>
    };

    // ─── DATA & CONFIG ───
    if (['json', 'yaml', 'yml', 'toml', 'env', 'ini'].includes(e)) return {
        bg: '#64748b',
        glyph: <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M9 7a2 2 0 00-2 2v2a2 2 0 01-2 2 2 2 0 012 2v2a2 2 0 002 2M15 7a2 2 0 012 2v2a2 2 0 002 2 2 2 0 00-2 2v2a2 2 0 01-2 2" /></g>
    };

    // ─── DESIGN ───
    if (e === 'psd') return { bg: '#1d4ed8', glyph: <path d="M8 8v8h2v-3h1a2 2 0 100-4H8zm2 2h1a1 1 0 110 2h-1v-2zm4-2h1c2 0 3 1 3 3s-1 3-3 3h-1l-1-2h1c1 0 1-.5 1-1s0-1-1-1h-1V8z" fill="#fff" /> };
    if (e === 'ai') return { bg: '#c2410c', glyph: <path d="M9 8l-2 8h2l.5-2h3l.5 2h2L13 8H9zm1 4.5l1-4 1 4h-2z" fill="#fff" /> };

    // ─── SYSTEM / EXE ───
    if (['exe', 'msi'].includes(e)) return {
        bg: '#0f172a',
        glyph: <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><rect x="5" y="6" width="14" height="12" rx="2" /><path d="M5 10h14M8 14h2M14 14h2" /></g>
    };
    if (['dll', 'sys'].includes(e)) return {
        bg: '#475569',
        glyph: <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><circle cx="12" cy="12" r="3" /><path d="M12 7v-1M12 18v-1M7 12H6M18 12h-1M8.5 8.5L7.8 7.8M15.5 15.5l.7.7M8.5 15.5l-.7.7M15.5 8.5l.7-.7" /></g>
    };
    if (['bat', 'sh', 'ps1'].includes(e)) return {
        bg: '#022c22', // Very dark green
        glyph: <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M7 8l4 4-4 4M13 16h4" /></g>
    };

    // ─── FONT ───
    if (['ttf', 'otf', 'woff'].includes(e)) return {
        bg: '#c026d3', // Fuchsia
        glyph: <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M12 6l-4 12h2l1-3h2l1 3h2L12 6zm-1.5 7L12 8.5 13.5 13h-3z" /></g>
    };

    return null;
}

function CategoryGlyph({ category }: { category: FileCategory }) {
    switch (category) {
        case 'image':
            return <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><rect x="5" y="6" width="14" height="12" rx="2" /><path d="M5 13l4-4 7 7M14 9h.01" /></g>;
        case 'video':
            return <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><rect x="5" y="7" width="14" height="10" rx="2" /><path d="M10 10l4 2-4 2v-4z" fill="#fff" /></g>;
        case 'audio':
            return <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M9 14V6l6-2v10" /><circle cx="7" cy="14" r="2" fill="#fff" /><circle cx="13" cy="13" r="2" fill="#fff" /></g>;
        case 'document':
            return <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M7 6h10M7 10h10M7 14h6M7 18h4" /></g>;
        case 'code':
            return <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M10 8l-4 4 4 4M14 8l4 4-4 4M13 6l-2 12" /></g>;
        case 'archive':
            return <g><path d="M12 5v10" stroke="#fff" strokeWidth="1.5" strokeDasharray="2 2" /><rect x="10" y="11" width="4" height="6" rx="1" fill="#fff" /></g>;
        case 'executable':
            return <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><rect x="5" y="6" width="14" height="12" rx="2" /><path d="M5 10h14" /></g>;
        case 'system':
            return <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><circle cx="12" cy="12" r="3" /><path d="M12 7v-1M12 18v-1M7 12H6M18 12h-1M8.5 8.5L7.8 7.8M15.5 15.5l.7.7M8.5 15.5l-.7.7M15.5 8.5l.7-.7" /></g>;
        case 'font':
            return <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M12 6l-4 12h2l1-3h2l1 3h2L12 6zm-1.5 7L12 8.5 13.5 13h-3z" /></g>;
        default:
            return <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M7 6h10M7 10h10M7 14h6" /></g>;
    }
}

export function FileIcon({ size = 16, extension }: { size?: number; extension?: string }) {
    const ext = extension?.toLowerCase() || '';
    const specificTheme = matchSpecificFileTheme(ext);

    // If there is a specific theme mapped, use it, else fall back to generic categories
    if (specificTheme) {
        const radius = Math.round(size * 0.22);
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="app-file-icon">
                <rect x="1" y="1" width="22" height="22" rx={radius > 6 ? 6 : radius} fill={specificTheme.bg} />
                {specificTheme.glyph}
            </svg>
        );
    }

    const fileType = ext ? getFileType(ext) : null;
    const category = fileType?.category ?? 'generic';
    const bgColor = fileType?.color ?? CATEGORY_COLORS[category];

    // Reduced roundness: matching the folder scale precisely (22% up to 6px max)
    const radius = Math.round(size * 0.22);

    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="app-file-icon">
            <rect x="1" y="1" width="22" height="22" rx={radius > 6 ? 6 : radius} fill={bgColor} />
            <CategoryGlyph category={category} />
        </svg>
    );
}

/**
 * Shows the real Windows shell icon for a file/folder, with an instant
 * fallback to the generic SVG icons while the async fetch is in flight.
 */
export function SystemFileIcon({
    path,
    size = 16,
    extension,
    isDir = false,
    fill = false,
    forceNative = false,
    isHidden = false
}: {
    path: string;
    size?: number;
    extension?: string;
    isDir?: boolean;
    fill?: boolean;
    forceNative?: boolean;
    isHidden?: boolean;
}) {
    const src = useFileIcon(path, size);
    const fallbackSize = fill ? Math.min(size, 72) : size;
    const ext = (extension || '').toLowerCase();

    // ─── ICON PRIORITY LOGIC ───────────────────────────────────────────────
    // We want to avoid "flickering" from our sleek icons to the yellow Windows 
    // default folders/files. We only want native icons if they are "premium" 
    // content icons (like .exe branding, .lnk, etc) or if explicitly forced.

    const isStandardType = !ext || ['txt', 'md', 'json', 'pdf'].includes(ext);
    const category = ext ? getFileType(ext).category : 'generic';
    const isCategoryIcon = ['image', 'video', 'audio', 'code', 'archive', 'document'].includes(category);

    const shouldPreferSleek = !forceNative && (isDir || isStandardType || isCategoryIcon);
    const isNativeSpecific = ['exe', 'lnk', 'url', 'appref-ms', 'msi'].includes(ext);

    const renderInner = () => {
        // If it's a folder or a standard recognized type, we ALWAYS prefer 
        // our sleek SVG icons to maintain the premium look.
        if (shouldPreferSleek && !isNativeSpecific) {
            return isDir
                ? <FolderIcon size={fallbackSize} name={path.split(/[\\/]/).filter(Boolean).pop() ?? ''} />
                : <FileIcon size={fallbackSize} extension={ext} />;
        }

        const fallback = isDir
            ? <FolderIcon size={fallbackSize} name={path.split(/[\\/]/).filter(Boolean).pop() ?? ''} />
            : <FileIcon size={fallbackSize} extension={ext} />;

        if (!src) return fallback;

        if (fill) {
            return (
                <img
                    src={src}
                    style={{
                        display: 'block',
                        width: '100%',
                        height: '100%',
                        maxWidth: '85%',
                        maxHeight: '85%',
                        objectFit: 'contain',
                    }}
                    alt=""
                    draggable={false}
                />
            );
        }

        return (
            <img
                src={src}
                style={{
                    display: 'block',
                    flexShrink: 0,
                    width: size,
                    height: size,
                    objectFit: 'contain'
                }}
                alt=""
                draggable={false}
            />
        );
    };

    const content = renderInner();

    if (!isHidden) return content;

    return (
        <div style={{ position: 'relative', width: fill ? '100%' : size, height: fill ? '100%' : size, display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center' }}>
            <div style={{ opacity: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                {content}
            </div>
            <div style={{ position: 'absolute', bottom: fill ? '10%' : -3, right: fill ? '10%' : -3, background: 'var(--bg-surface)', borderRadius: '50%', padding: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                <EyeOff size={fill ? 18 : Math.max(10, size * 0.45)} color="var(--text-muted)" strokeWidth={2.5} />
            </div>
        </div>
    );
}

// ─── SMART FOLDER ICON SYSTEM ──────────────────────────────────────────────
// Maps folder names → PNG icon from the icon pack

function matchFolderIcon(name: string): string {
    const n = name.toLowerCase();

    // Games / Gaming
    if (n.includes('game')) return 'Games.png';

    // Music / Audio / Songs
    if (n.includes('music') || n.includes('audio') || n.includes('song')) return 'Music.png';

    // Pictures / Photos / Images / Screenshots / Wallpapers
    if (n.includes('picture') || n.includes('photo') || n.includes('image') || n.includes('screenshot')) return 'Photos.png';
    if (n.includes('wallpaper')) return 'Wallpapers.png';

    // Videos / Movies / TV
    if (n.includes('video') || n.includes('vid') || n.includes('movie') || n.includes('film')) return 'Videos.png';
    if (n.includes('tv') || n.includes('series') || n.includes('show')) return 'TV.png';

    // Downloads
    if (n.includes('download')) return 'Downloads.png';

    // Adobe / Creative
    if (n.includes('adobe') || n.includes('photoshop') || n.includes('premiere') || n.includes('illustrator')) return 'Adobe.png';

    // Software / Programs / Apps
    if (n.includes('software') || n.includes('program') || n.includes('app') || n.includes('tool')) return 'Softwares.png';

    // Workshop / Dev / Code / Projects
    if (n.includes('workshop') || n.includes('dev') || n.includes('code') || n.includes('project') || n.includes('src') || n.includes('build')) return 'Workshop.png';

    // Movies specifically
    if (n.includes('movie') || n.includes('film') || n.includes('cinema')) return 'Movies.png';

    // Documents / Docs / Work / Office
    if (n.includes('document') || n.includes('docs') || n.includes('work') || n.includes('office')) return 'Others.png';

    // Desktop / Windows / System
    if (n === 'desktop' || n.includes('windows') || n.includes('system')) return 'Others.png';

    // Logo / Design / Art
    if (n.includes('logo') || n.includes('design') || n.includes('art')) return 'Others.png';

    // Backup / Archive / Old
    if (n.includes('backup') || n.includes('archive') || n.includes('old')) return 'Default Grey.png';

    // No match — use default colorful folder
    return '';
}

export function FolderIcon({ size = 16, name = '' }: { size?: number; name?: string }) {
    const iconFile = matchFolderIcon(name);

    if (iconFile) {
        return (
            <img
                src={`/folder-icons/${iconFile}`}
                width={size}
                height={size}
                alt=""
                draggable={false}
                style={{ display: 'block', objectFit: 'contain' }}
            />
        );
    }

    // Default — use the icon pack's Default.png
    return (
        <img
            src="/folder-icons/Default.png"
            width={size}
            height={size}
            alt=""
            draggable={false}
            style={{ display: 'block', objectFit: 'contain' }}
        />
    );
}