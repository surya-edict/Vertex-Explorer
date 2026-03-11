/**
 * Maps file extensions to display info
 */

export type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'code' | 'archive' | 'executable' | 'system' | 'font' | 'generic';

export interface FileTypeInfo {
    label: string;
    color: string;
    icon: string; // emoji fallback
    category: FileCategory;
}

const TYPE_MAP: Record<string, FileTypeInfo> = {
    // Images
    png: { label: 'PNG Image', color: '#a78bfa', icon: '🖼', category: 'image' },
    jpg: { label: 'JPEG Image', color: '#f472b6', icon: '🖼', category: 'image' },
    jpeg: { label: 'JPEG Image', color: '#f472b6', icon: '🖼', category: 'image' },
    gif: { label: 'GIF Image', color: '#fb7185', icon: '🖼', category: 'image' },
    webp: { label: 'WebP Image', color: '#8b5cf6', icon: '🖼', category: 'image' },
    svg: { label: 'SVG Image', color: '#2dd4bf', icon: '🖼', category: 'image' },
    ico: { label: 'Icon', color: '#f43f5e', icon: '🖼', category: 'image' },
    bmp: { label: 'Bitmap', color: '#ec4899', icon: '🖼', category: 'image' },

    // Documents
    pdf: { label: 'PDF', color: '#ef4444', icon: '📄', category: 'document' },
    doc: { label: 'Word Document', color: '#3b82f6', icon: '📝', category: 'document' },
    docx: { label: 'Word Document', color: '#3b82f6', icon: '📝', category: 'document' },
    xls: { label: 'Excel', color: '#10b981', icon: '📊', category: 'document' },
    xlsx: { label: 'Excel', color: '#10b981', icon: '📊', category: 'document' },
    ppt: { label: 'PowerPoint', color: '#f97316', icon: '📊', category: 'document' },
    pptx: { label: 'PowerPoint', color: '#f97316', icon: '📊', category: 'document' },
    txt: { label: 'Text File', color: '#94a3b8', icon: '📄', category: 'document' },
    md: { label: 'Markdown', color: '#475569', icon: '📝', category: 'document' },
    rtf: { label: 'Rich Text', color: '#64748b', icon: '�', category: 'document' },
    csv: { label: 'CSV File', color: '#059669', icon: '📊', category: 'document' },

    // Code
    json: { label: 'JSON', color: '#fbbf24', icon: '📄', category: 'code' },
    xml: { label: 'XML', color: '#fbbf24', icon: '📄', category: 'code' },
    yaml: { label: 'YAML', color: '#fbbf24', icon: '📄', category: 'code' },
    yml: { label: 'YAML', color: '#fbbf24', icon: '📄', category: 'code' },
    ts: { label: 'TypeScript', color: '#3b82f6', icon: '📄', category: 'code' },
    tsx: { label: 'TypeScript/React', color: '#2563eb', icon: '📄', category: 'code' },
    js: { label: 'JavaScript', color: '#fbbf24', icon: '📄', category: 'code' },
    jsx: { label: 'JSX', color: '#60a5fa', icon: '📄', category: 'code' },
    css: { label: 'CSS', color: '#6366f1', icon: '📄', category: 'code' },
    html: { label: 'HTML', color: '#f97316', icon: '📄', category: 'code' },
    rs: { label: 'Rust', color: '#dea584', icon: '📄', category: 'code' },
    py: { label: 'Python', color: '#3776ab', icon: '📄', category: 'code' },
    go: { label: 'Go', color: '#00add8', icon: '📄', category: 'code' },
    java: { label: 'Java', color: '#007396', icon: '📄', category: 'code' },
    cpp: { label: 'C++', color: '#00599c', icon: '📄', category: 'code' },
    c: { label: 'C', color: '#a8b9cc', icon: '📄', category: 'code' },
    toml: { label: 'TOML', color: '#9ca3af', icon: '📄', category: 'code' },

    // Archives
    zip: { label: 'ZIP Archive', color: '#f59e0b', icon: '🗜', category: 'archive' },
    rar: { label: 'RAR Archive', color: '#d97706', icon: '🗜', category: 'archive' },
    '7z': { label: '7-Zip Archive', color: '#b45309', icon: '🗜', category: 'archive' },
    tar: { label: 'TAR Archive', color: '#92400e', icon: '🗜', category: 'archive' },
    gz: { label: 'GZip Archive', color: '#78350f', icon: '🗜', category: 'archive' },

    // Video
    mp4: { label: 'MP4 Video', color: '#818cf8', icon: '🎬', category: 'video' },
    mkv: { label: 'MKV Video', color: '#6366f1', icon: '🎬', category: 'video' },
    avi: { label: 'AVI Video', color: '#4f46e5', icon: '🎬', category: 'video' },
    mov: { label: 'MOV Video', color: '#4338ca', icon: '🎬', category: 'video' },
    webm: { label: 'WebM Video', color: '#3730a3', icon: '🎬', category: 'video' },

    // Audio
    mp3: { label: 'MP3 Audio', color: '#ec4899', icon: '🎵', category: 'audio' },
    wav: { label: 'WAV Audio', color: '#db2777', icon: '🎵', category: 'audio' },
    flac: { label: 'FLAC Audio', color: '#be185d', icon: '🎵', category: 'audio' },
    ogg: { label: 'OGG Audio', color: '#9d174d', icon: '🎵', category: 'audio' },
    m4a: { label: 'M4A Audio', color: '#831843', icon: '🎵', category: 'audio' },

    // Executables
    exe: { label: 'Application', color: '#10b981', icon: '⚙', category: 'executable' },
    msi: { label: 'Installer', color: '#059669', icon: '⚙', category: 'executable' },
    sh: { label: 'Shell Script', color: '#4ade80', icon: '🐚', category: 'executable' },
    bat: { label: 'Batch File', color: '#4ade80', icon: '🐚', category: 'executable' },
    ps1: { label: 'PowerShell', color: '#60a5fa', icon: '🐚', category: 'executable' },

    // System
    dll: { label: 'DLL Library', color: '#64748b', icon: '⚙', category: 'system' },
    sys: { label: 'System File', color: '#475569', icon: '🛠', category: 'system' },
    ini: { label: 'Config File', color: '#334155', icon: '🛠', category: 'system' },
    log: { label: 'Log File', color: '#94a3b8', icon: '📝', category: 'system' },

    // Fonts
    ttf: { label: 'Font', color: '#e879f9', icon: '🅰', category: 'font' },
    otf: { label: 'Font', color: '#e879f9', icon: '🅰', category: 'font' },
    woff: { label: 'Web Font', color: '#e879f9', icon: '🅰', category: 'font' },
};

export function getFileType(extension: string): FileTypeInfo {
    return TYPE_MAP[extension.toLowerCase()] ?? { label: extension.toUpperCase() + ' File', color: '#6b7280', icon: '📄', category: 'generic' };
}

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
export const TEXT_EXTS = new Set(['txt', 'md', 'json', 'xml', 'yaml', 'yml', 'ts', 'tsx', 'js', 'jsx', 'css', 'html', 'rs', 'py', 'go', 'java', 'cpp', 'c', 'sh', 'bat', 'ps1', 'toml', 'ini', 'env', 'log', 'gitignore', 'lock']);
export const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm']);
export const NATIVE_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'ogg']);
export const CONVERT_VIDEO_EXTS = new Set(['mkv', 'avi', 'wmv', 'flv', 'ts', 'mts', 'm2ts']);
export const PDF_EXTS = new Set(['pdf']);
export const DOCX_EXTS = new Set(['docx']);
export const XLSX_EXTS = new Set(['xlsx', 'xls']);
export const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2']);
