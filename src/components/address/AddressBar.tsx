import { useState, useRef } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePanelStore } from '../../store/panelStore';
import { getBreadcrumbs } from '../../utils/formatters';
import './AddressBar.css';

interface Props { panelId: string; tabId: string; }

export function AddressBar({ panelId, tabId }: Props) {
    const activeWs = usePanelStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId) || s.workspaces[0]);
    const panels = activeWs.panels;
    const navigate = usePanelStore(s => s.navigate);
    const goBack = usePanelStore(s => s.goBack);
    const goForward = usePanelStore(s => s.goForward);
    const goUp = usePanelStore(s => s.goUp);

    const panel = panels.find(p => p.id === panelId);
    const tab = panel?.tabs.find(t => t.id === tabId);

    if (!panel || !tab) return null;

    const path = tab.path;
    const canBack = tab.historyIndex > 0;
    const canForward = tab.historyIndex < tab.history.length - 1;

    const [editMode, setEditMode] = useState(false);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const crumbs = getBreadcrumbs(path);

    const enterEdit = () => {
        setEditValue(path);
        setEditMode(true);
        setTimeout(() => { inputRef.current?.select(); }, 10);
    };

    const commitEdit = () => {
        const val = editValue.trim();
        if (val && val !== path) navigate(panelId, tabId, val);
        setEditMode(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') commitEdit();
        if (e.key === 'Escape') setEditMode(false);
    };

    return (
        <div className="addressbar">
            <button className="addressbar-nav-btn" onClick={() => goBack(panelId, tabId)} disabled={!canBack} title="Back (Alt+Left)">
                <ChevronLeft size={14} />
            </button>
            <button className="addressbar-nav-btn" onClick={() => goForward(panelId, tabId)} disabled={!canForward} title="Forward (Alt+Right)">
                <ChevronRight size={14} />
            </button>
            <button className="addressbar-nav-btn" onClick={() => goUp(panelId, tabId)} title="Up (Alt+Up)">
                <ChevronUp size={14} />
            </button>

            <div className="addressbar-path" onClick={enterEdit}>
                {editMode ? (
                    <input
                        ref={inputRef}
                        className="addressbar-input"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={handleKeyDown}
                        autoFocus
                    />
                ) : (
                    <AnimatePresence mode="popLayout" initial={false}>
                        <motion.div
                            key={path}
                            className="addressbar-crumbs"
                            initial={{ opacity: 0, y: 12, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -12, scale: 0.95 }}
                            transition={{
                                type: "spring",
                                stiffness: 450,
                                damping: 15,
                                mass: 0.8
                            }}
                        >
                            {crumbs.map((crumb, i) => (
                                <motion.span
                                    layout
                                    key={crumb.path}
                                    className="addressbar-crumb-group"
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{
                                        type: "spring",
                                        stiffness: 500,
                                        damping: 20,
                                        delay: i * 0.02
                                    }}
                                >
                                    <button
                                        className="addressbar-crumb"
                                        onClick={(e) => { e.stopPropagation(); navigate(panelId, tabId, crumb.path); }}
                                    >
                                        {crumb.label}
                                    </button>
                                    {i < crumbs.length - 1 && <span className="addressbar-sep">&gt;</span>}
                                </motion.span>
                            ))}
                        </motion.div>
                    </AnimatePresence>
                )}
            </div>
        </div>
    );
}

function ChevronUp({ size }: { size: number }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15" /></svg>;
}