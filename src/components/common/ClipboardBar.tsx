import { useState, useRef, useEffect } from 'react';
import { Copy, Scissors, Eye, ClipboardPaste, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useClipboardStore } from '../../store/clipboardStore';
import { pasteWithConflictCheck } from '../../utils/paste';
import './ClipboardBar.css';

interface ClipboardBarProps {
    currentDir: string;
    onRefresh: () => void;
}

export function ClipboardBar({ currentDir, onRefresh }: ClipboardBarProps) {
    const clipboard = useClipboardStore(s => s.paths);
    const clipboardAction = useClipboardStore(s => s.action);
    const clearClipboard = useClipboardStore(s => s.clearClipboard);
    const [showItems, setShowItems] = useState(false);

    const isVisible = clipboard.length > 0 && !!clipboardAction;

    // Manual exit animation state
    const [shouldRender, setShouldRender] = useState(false);
    const [animClass, setAnimClass] = useState('');
    const prevVisible = useRef(false);

    // Preserve last valid state for exit animation
    const lastClipboard = useRef(clipboard);
    const lastAction = useRef(clipboardAction);
    if (isVisible) {
        lastClipboard.current = clipboard;
        lastAction.current = clipboardAction;
    }

    useEffect(() => {
        if (isVisible && !prevVisible.current) {
            // Entering
            setShouldRender(true);
            setAnimClass('clipboard-bar--entering');
        } else if (!isVisible && prevVisible.current) {
            // Exiting
            setAnimClass('clipboard-bar--exiting');
            const timer = setTimeout(() => {
                setShouldRender(false);
                setAnimClass('');
            }, 300);
            prevVisible.current = isVisible;
            return () => clearTimeout(timer);
        }
        prevVisible.current = isVisible;
    }, [isVisible]);

    const displayClipboard = isVisible ? clipboard : lastClipboard.current;
    const displayAction = isVisible ? clipboardAction : lastAction.current;
    const Icon = displayAction === 'cut' ? Scissors : Copy;
    const actionText = displayAction === 'cut' ? 'cutting' : 'copying';

    const handlePaste = async () => {
        if (!clipboardAction) return;
        await pasteWithConflictCheck(clipboard, currentDir, clipboardAction, {
            onSuccess: () => {
                onRefresh();
                clearClipboard(); // Close the bar unconditionally when explicitly clicked
            }
        });
    };

    if (!shouldRender) return null;

    return (
        <div className={`clipboard-bar ${animClass}`}>
            <div className="clipboard-bar-left">
                <Icon size={16} className="clipboard-bar-icon" />
                <span className="clipboard-bar-text">Prepared for {actionText}</span>
                <span className="clipboard-bar-badge">{displayClipboard.length} items</span>
            </div>

            <div className="clipboard-bar-right" style={{ position: 'relative' }}>
                <AnimatePresence>
                    {showItems && (
                        <motion.div
                            className="clipboard-items-popover"
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                        >
                            <div className="clipboard-items-header">Clipboard Items</div>
                            <div className="clipboard-items-list">
                                {displayClipboard.map(p => {
                                    const name = p.split('\\').pop() || p;
                                    return (
                                        <div key={p} className="clipboard-item-row" title={p}>
                                            <span className="clipboard-item-name">{name}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
                <button
                    className={`clipboard-bar-btn ${showItems ? 'active' : ''}`}
                    onClick={() => setShowItems(!showItems)}
                >
                    <Eye size={14} />
                    <span>Show items</span>
                </button>
                <button className="clipboard-bar-btn clipboard-bar-btn-paste" onClick={handlePaste}>
                    <ClipboardPaste size={14} />
                    <span>Paste</span>
                </button>
                <button className="clipboard-bar-btn clipboard-bar-btn-discard" onClick={clearClipboard}>
                    <X size={14} />
                    <span>Discard</span>
                </button>
            </div>
        </div>
    );
}
