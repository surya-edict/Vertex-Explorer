import { useEffect, useRef } from 'react';

export function useVimHotkeys(isActive: boolean, handlers: {
    onNext: () => void;
    onPrev: () => void;
    onFirst: () => void;
    onLast: () => void;
    onParent: () => void;
    onOpen: () => void;
    onCenter: () => void;
}) {
    const leaderRef = useRef<string | null>(null);
    const timerRef = useRef<any>(null);

    useEffect(() => {
        if (!isActive) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            const key = e.key.toLowerCase();

            // Handle "gg"
            if (leaderRef.current === 'g' && key === 'g') {
                e.preventDefault();
                handlers.onFirst();
                leaderRef.current = null;
                return;
            }

            // Handle "zz"
            if (leaderRef.current === 'z' && key === 'z') {
                e.preventDefault();
                handlers.onCenter();
                leaderRef.current = null;
                return;
            }

            leaderRef.current = null;
            if (timerRef.current) clearTimeout(timerRef.current);

            switch (key) {
                case 'j':
                    e.preventDefault();
                    handlers.onNext();
                    break;
                case 'k':
                    e.preventDefault();
                    handlers.onPrev();
                    break;
                case 'h':
                    e.preventDefault();
                    handlers.onParent();
                    break;
                case 'l':
                    e.preventDefault();
                    handlers.onOpen();
                    break;
                case 'g':
                    leaderRef.current = 'g';
                    timerRef.current = setTimeout(() => leaderRef.current = null, 500);
                    break;
                case 'z':
                    leaderRef.current = 'z';
                    timerRef.current = setTimeout(() => leaderRef.current = null, 500);
                    break;
                case 'shift':
                    // Just catch for G
                    break;
            }

            if (e.key === 'G') {
                e.preventDefault();
                handlers.onLast();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isActive, handlers]);
}
