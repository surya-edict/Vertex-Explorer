import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

type IconValue = string | null;

const CACHE_MAX = 2000;
const cache = new Map<string, IconValue>();
const extCache = new Map<string, IconValue>();
const listeners = new Map<string, Set<(v: IconValue) => void>>();

const PER_PATH_EXTS = new Set(['exe', 'lnk', 'url', 'appref-ms', 'msi', 'ico', '']);

function tier(size: number): number {
    return size <= 16 ? 16 : size <= 32 ? 32 : size <= 48 ? 48 : 256;
}

function cacheKey(path: string, size: number): string {
    return `${tier(size)}:${path}`;
}

function extFromPath(path: string): string {
    const dot = path.lastIndexOf('.');
    if (dot === -1 || dot === path.length - 1) return '';
    return path.slice(dot + 1).toLowerCase();
}

function getExtCacheKey(ext: string, size: number): string {
    return `${tier(size)}:.${ext}`;
}

let batchTimer: ReturnType<typeof setTimeout> | null = null;
let batchQueue = new Map<string, { size: number; keys: string[] }>();

function scheduleBatchFetch() {
    if (batchTimer) return;
    batchTimer = setTimeout(() => {
        batchTimer = null;
        const current = batchQueue;
        batchQueue = new Map();
        if (current.size === 0) return;

        const sizeGroups = new Map<number, string[]>();
        for (const [ext, { size }] of current) {
            const t = tier(size);
            if (!sizeGroups.has(t)) sizeGroups.set(t, []);
            sizeGroups.get(t)!.push(ext);
        }

        for (const [t, exts] of sizeGroups) {
            invoke<Record<string, string | null>>('get_file_icons_batch', { extensions: exts, size: t })
                .then(result => {
                    for (const [ext, icon] of Object.entries(result)) {
                        const extKey = getExtCacheKey(ext, t);
                        extCache.set(extKey, icon);
                        const entry = current.get(ext);
                        if (entry) {
                            for (const fullKey of entry.keys) {
                                cache.set(fullKey, icon);
                                listeners.get(fullKey)?.forEach(cb => cb(icon));
                                listeners.delete(fullKey);
                            }
                        }
                    }
                })
                .catch(() => {});
        }
    }, 16);
}

function fetch_icon(path: string, size: number): void {
    const key = cacheKey(path, size);
    if (cache.has(key) || listeners.has(key)) return;

    const ext = extFromPath(path);
    const isDir = path.endsWith('\\') || path.endsWith('/');

    if (!isDir && !PER_PATH_EXTS.has(ext)) {
        const extKey = getExtCacheKey(ext, size);
        const cached = extCache.get(extKey);
        if (cached !== undefined) {
            cache.set(key, cached);
            return;
        }

        listeners.set(key, new Set());
        if (!batchQueue.has(ext)) {
            batchQueue.set(ext, { size, keys: [] });
        }
        batchQueue.get(ext)!.keys.push(key);
        scheduleBatchFetch();
        return;
    }

    listeners.set(key, new Set());

    invoke<IconValue>('get_file_icon', { path, size: tier(size) })
        .then(data => {
            cache.set(key, data);
            if (cache.size > CACHE_MAX) {
                const oldest = cache.keys().next().value;
                if (oldest) cache.delete(oldest);
            }
            listeners.get(key)?.forEach(cb => cb(data));
        })
        .catch(() => {
            cache.set(key, null);
            listeners.get(key)?.forEach(cb => cb(null));
        })
        .finally(() => {
            listeners.delete(key);
        });
}

export function useFileIcon(path: string, size = 16): IconValue {
    const key = cacheKey(path, size);

    const [icon, setIcon] = useState<IconValue>(() => cache.get(key) ?? null);

    useEffect(() => {
        if (!path) return;

        const cached = cache.get(key);
        if (cached !== undefined) {
            setIcon(cached);
            return;
        }

        const ext = extFromPath(path);
        const extKey = getExtCacheKey(ext, size);
        const extCached = extCache.get(extKey);
        if (extCached !== undefined && !PER_PATH_EXTS.has(ext)) {
            cache.set(key, extCached);
            setIcon(extCached);
            return;
        }

        if (!listeners.has(key)) {
            fetch_icon(path, size);
        }
        const set = listeners.get(key);
        if (set) {
            set.add(setIcon);
            return () => { set.delete(setIcon); };
        }
    }, [key, path, size]);

    return icon;
}
