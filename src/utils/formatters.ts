/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals = 1): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Format a unix timestamp (ms) to a readable date string
 */
export function formatDate(ts: number, mode: 'relative' | 'absolute'): string {
    if (!ts) return '';
    const date = new Date(ts);
    if (mode === 'absolute') {
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' +
            date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    const now = Date.now();
    const diff = now - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Get just the filename from a full path
 */
export function basename(path: string): string {
    return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path;
}

/**
 * Get the parent directory of a path
 */
export function dirname(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 1) return path;
    parts.pop();
    return parts.length === 1 && parts[0].endsWith(':') ? parts[0] + '\\' : parts.join('\\');
}

/**
 * Get breadcrumb segments from a path
 */
export function getBreadcrumbs(path: string): { label: string; path: string }[] {
    // Virtual folders
    // - tag:<id> : shows as Tags > <Label>
    if (path.startsWith('tag:')) {
        const tagId = path.slice('tag:'.length).trim();
        const nice = tagId.length ? (tagId.charAt(0).toUpperCase() + tagId.slice(1)) : 'Tag';
        return [
            { label: 'Tags', path: '' },
            { label: nice, path },
        ];
    }

    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    const crumbs: { label: string; path: string }[] = [];

    let cumulative = '';
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === 0 && part.endsWith(':')) {
            cumulative = part + '\\';
        } else {
            cumulative = cumulative.replace(/\\$/, '') + '\\' + part;
        }
        crumbs.push({ label: i === 0 ? part + '\\' : part, path: cumulative });
    }
    return crumbs;
}

/**
 * Join path segments
 */
export function joinPath(base: string, ...parts: string[]): string {
    let result = base.endsWith('\\') || base.endsWith('/') ? base : base + '\\';
    for (const part of parts) {
        result = result.endsWith('\\') ? result + part : result + '\\' + part;
    }
    return result;
}
