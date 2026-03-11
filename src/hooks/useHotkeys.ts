import { useEffect, useCallback, useRef } from 'react';
import { useSettingsStore } from '../store/settingsStore';

type HandlerFn = () => void;
const handlers = new Map<string, Set<HandlerFn>>();

function keyToString(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('meta');

    let key = e.key.toLowerCase();
    if (key === ' ') key = 'space';

    // If the key itself is a modifier, don't add it twice
    if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
        parts.push(key);
    }

    const combo = parts.join('+');
    if (combo === 'ctrl+z') {
        console.log('[Hotkey] Special Check: ctrl+z detected');
    }
    console.log('[Hotkey] Pressed:', combo);
    return combo;
}

let globalListenerAttached = false;
function ensureGlobalListener() {
    if (globalListenerAttached) return;
    globalListenerAttached = true;

    window.addEventListener('keydown', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

        const combo = keyToString(e);
        const set = handlers.get(combo);
        if (set && set.size > 0) {
            e.preventDefault();
            set.forEach((fn) => fn());
        }
    });
}

export function useHotkey(combo: string, handler: HandlerFn) {
    useEffect(() => {
        ensureGlobalListener();
        const normalised = combo.toLowerCase().trim();
        if (!normalised) return;

        if (!handlers.has(normalised)) handlers.set(normalised, new Set());
        handlers.get(normalised)!.add(handler);

        return () => {
            handlers.get(normalised)?.delete(handler);
            if (handlers.get(normalised)?.size === 0) handlers.delete(normalised);
        };
    }, [combo, handler]);
}

export function useActionHotkey(action: string, handler: HandlerFn) {
    const hotkeys = useSettingsStore((s) => s.hotkeys);
    const combo = hotkeys[action] ?? '';

    const handlerRef = useRef(handler);
    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    const wrapped = useCallback(() => {
        handlerRef.current();
    }, []);

    useHotkey(combo, wrapped);
}