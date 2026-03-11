import { convertFileSrc } from '@tauri-apps/api/core';
import { IMAGE_EXTS, VIDEO_EXTS } from './fileTypes';

const INTERNAL_DRAG_MIME_TYPES = [
    'application/explorer-files',
    'application/x-sleekexplorer-paths',
];

let lastDraggedPaths: string[] = [];
let dragPreviewEl: HTMLElement | null = null;

/**
 * Creates a custom drag preview image for media files (images/videos).
 * Call this BEFORE setDraggedPaths in your onDragStart handler.
 * Returns true if a custom preview was set, false if default should be used.
 */
export function createDragPreview(
    dataTransfer: DataTransfer,
    file: { path: string; name: string; extension?: string; is_dir: boolean },
    totalCount: number,
    sourceElement?: HTMLElement | null
): boolean {
    cleanupDragPreview();

    const ext = (file.extension ?? '').toLowerCase();
    const isImage = IMAGE_EXTS.has(ext);
    const isVideo = VIDEO_EXTS.has(ext);

    if (!isImage && !isVideo && totalCount <= 1) return false;

    // Create the floating preview container
    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed;
        top: -9999px;
        left: -9999px;
        width: 152px;
        height: 152px;
        padding: 6px;
        border-radius: 14px;
        overflow: visible;
        z-index: 999999;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Inner box for the actual preview content
    const inner = document.createElement('div');
    inner.style.cssText = `
        width: 140px;
        height: 140px;
        border-radius: 14px;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.1);
        background: #1a1a2e;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
    `;

    let contentAdded = false;

    // Try to clone the existing rendered preview to ensure instant synchronous visibility
    if (sourceElement) {
        let previewTarget = sourceElement.querySelector('.grid-card-preview-inner') ||
            sourceElement.querySelector('img.grid-card-thumb') ||
            sourceElement.querySelector('img');

        if (previewTarget) {
            const clone = previewTarget.cloneNode(true) as HTMLElement;
            clone.style.width = '100%';
            clone.style.height = '100%';
            clone.style.borderRadius = '14px';
            clone.style.objectFit = 'cover';
            inner.appendChild(clone);
            contentAdded = true;
        }
    }

    if (!contentAdded) {
        if (isImage) {
            const img = document.createElement('img');
            img.src = convertFileSrc(file.path);
            img.style.cssText = `
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
                border-radius: 14px;
            `;
            inner.appendChild(img);
        } else if (isVideo) {
            // For video, show a film-strip styled preview with the video icon
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                color: rgba(255,255,255,0.9);
                gap: 6px;
                border-radius: 14px;
            `;
            overlay.innerHTML = `
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(129,140,248,0.9)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <span style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.7);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;padding:0 8px;">${file.name}</span>
            `;
            inner.appendChild(overlay);
        } else {
            // Document, etc. with count > 1
            inner.style.background = 'var(--surface-raised, #242438)';
        }
    }

    container.appendChild(inner);

    // Badge for multiple files
    if (totalCount > 1) {
        const badge = document.createElement('div');
        badge.textContent = `${totalCount}`;
        badge.style.cssText = `
            position: absolute;
            top: 0;
            right: 0;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: #2dcdbf;
            color: #000;
            font-size: 13px;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            font-family: inherit;
            z-index: 10;
        `;
        container.appendChild(badge);
    }

    document.body.appendChild(container);
    dragPreviewEl = container;

    // Set as drag image — offset to center of the preview (76 = 6 padding + 70 half of 140)
    dataTransfer.setDragImage(container, 76, 76);

    return true;
}

/**
 * Cleans up any drag preview element from the DOM.
 * Call this in your onDragEnd handler.
 */
export function cleanupDragPreview() {
    if (dragPreviewEl) {
        dragPreviewEl.remove();
        dragPreviewEl = null;
    }
}

function parseJsonPaths(raw: string): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        }
    } catch {
        // Fallback parser handles non-JSON content.
    }
    return [];
}

function decodeFileUri(uri: string): string | null {
    if (!uri.startsWith('file://')) return null;
    try {
        const url = new URL(uri);
        let path = decodeURIComponent(url.pathname || '');
        if (/^\/[a-zA-Z]:\//.test(path)) {
            path = path.slice(1).replace(/\//g, '\\');
        }
        return path || null;
    } catch {
        return null;
    }
}

function parseLinePaths(raw: string): string[] {
    return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => decodeFileUri(line) ?? line)
        .filter((line): line is string => line.length > 0);
}

export function setDraggedPaths(dataTransfer: DataTransfer, paths: string[]) {
    const clean = Array.from(new Set(paths.filter((path) => path && path.trim().length > 0)));
    if (clean.length === 0) return;
    lastDraggedPaths = clean;
    (window as any).__explorerDraggedPaths = clean;
    const payload = JSON.stringify(clean);
    for (const mime of INTERNAL_DRAG_MIME_TYPES) {
        dataTransfer.setData(mime, payload);
    }
    dataTransfer.setData('text/plain', payload);
    dataTransfer.setData('text', payload);
}

export function getDraggedPaths(dataTransfer: DataTransfer): string[] {
    for (const mime of INTERNAL_DRAG_MIME_TYPES) {
        const raw = dataTransfer.getData(mime);
        const parsed = parseJsonPaths(raw);
        if (parsed.length > 0) return Array.from(new Set(parsed));
    }

    const plain = dataTransfer.getData('text/plain') || dataTransfer.getData('text');
    const fromPlainJson = parseJsonPaths(plain);
    if (fromPlainJson.length > 0) return Array.from(new Set(fromPlainJson));

    const fromUriList = parseLinePaths(dataTransfer.getData('text/uri-list'));
    if (fromUriList.length > 0) return Array.from(new Set(fromUriList));

    const fromPlainLines = parseLinePaths(plain);
    if (fromPlainLines.length > 0) return Array.from(new Set(fromPlainLines));

    const fileList = Array.from(dataTransfer.files ?? [])
        .map((file) => (file as File & { path?: string }).path || '')
        .filter((path): path is string => typeof path === 'string' && path.trim().length > 0);
    if (fileList.length > 0) return Array.from(new Set(fileList));

    const fromWindow = (window as any).__explorerDraggedPaths;
    if (Array.isArray(fromWindow) && fromWindow.length > 0) {
        return Array.from(new Set(fromWindow.filter((p: unknown) => typeof p === 'string' && p.trim().length > 0)));
    }

    return Array.from(new Set(lastDraggedPaths));
}

export function clearDraggedPaths() {
    lastDraggedPaths = [];
    (window as any).__explorerDraggedPaths = [];
}
