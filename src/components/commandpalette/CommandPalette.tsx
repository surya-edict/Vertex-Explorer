import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { motion, AnimatePresence } from 'framer-motion';
import { usePanelStore } from '../../store/panelStore';
import { useSettingsStore } from '../../store/settingsStore';
import './CommandPalette.css';

interface Command {
    id: string;
    label: string;
    group: string;
    shortcut?: string;
    aliases?: string[];
    action: () => void;
}

interface Props {
    open: boolean;
    onClose: () => void;
}

function fuzzy(query: string, target: string): boolean {
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    let qi = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) {
        if (t[i] === q[qi]) qi++;
    }
    return qi === q.length;
}

export function CommandPalette({ open, onClose }: Props) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const activeWsId = usePanelStore(s => s.activeWorkspaceId);
    const workspaces = usePanelStore(s => s.workspaces);
    const activeWs = workspaces.find(w => w.id === activeWsId) || workspaces[0];
    if (!activeWs) return null;

    const panels = activeWs.panels ?? [];
    const activePanelId = activeWs.activePanelId;
    const addTab = usePanelStore(s => s.addTab);
    const setLayout = usePanelStore(s => s.setLayout);
    const goBack = usePanelStore(s => s.goBack);
    const goUp = usePanelStore(s => s.goUp);
    const setSidebarOpen = useSettingsStore(s => s.setSidebarOpen);
    const setInspectorOpen = useSettingsStore(s => s.setInspectorOpen);
    const setTheme = useSettingsStore(s => s.setTheme);
    const setAnimations = useSettingsStore(s => s.setAnimations);
    const animations = useSettingsStore(s => s.animations);
    const sidebarOpen = useSettingsStore(s => s.sidebarOpen);
    const inspectorOpen = useSettingsStore(s => s.inspectorOpen);

    const activePanel = panels.find(p => p.id === activePanelId) ?? panels[0];
    const activeTab = activePanel?.tabs.find(t => t.id === activePanel.activeTabId) ?? activePanel?.tabs[0];
    const activePath = activeTab?.path ?? 'C:\\';
    const activePanelIdSafe = activePanel?.id;
    const activeTabIdSafe = activeTab?.id;

    const exec = (fn: () => void) => { fn(); onClose(); };

    const commands: Command[] = [
        { id: 'new-tab', label: 'New Tab', group: 'Navigation', shortcut: 'Ctrl+T', action: () => exec(() => { if (activePanelIdSafe) addTab(activePanelIdSafe, activePath); }) },
        { id: 'go-back', label: 'Go Back', group: 'Navigation', shortcut: 'Alt+Left', action: () => exec(() => { if (activePanelIdSafe && activeTabIdSafe) goBack(activePanelIdSafe, activeTabIdSafe); }) },
        { id: 'go-up', label: 'Go Up', group: 'Navigation', shortcut: 'Alt+Up', action: () => exec(() => { if (activePanelIdSafe && activeTabIdSafe) goUp(activePanelIdSafe, activeTabIdSafe); }) },

        { id: 'copy-path', label: 'Copy Current Path', group: 'Actions', shortcut: 'Ctrl+Shift+C', action: () => exec(() => navigator.clipboard.writeText(activePath)) },
        {
            id: 'new-folder', label: 'Create New Folder', group: 'Actions', shortcut: 'Ctrl+Shift+N', action: () => exec(() => {
                const name = prompt('Folder name:');
                if (name) invoke('create_folder', { path: activePath + '\\' + name }).catch(console.error);
            })
        },
        {
            id: 'empty-trash', label: 'Empty System Trash', group: 'Actions', action: () => exec(() => {
                if (confirm('Are you sure you want to empty the system trash?')) {
                    invoke('empty_trash').catch(console.error);
                }
            })
        },

        { id: 'layout-1', label: 'Single Panel', group: 'Layout', action: () => exec(() => setLayout('1')) },
        { id: 'layout-2h', label: 'Split Horizontal', group: 'Layout', shortcut: 'Ctrl+\\', action: () => exec(() => setLayout('2h')) },
        { id: 'layout-2v', label: 'Split Vertical', group: 'Layout', action: () => exec(() => setLayout('2v')) },
        { id: 'layout-4', label: 'Quad View', group: 'Layout', action: () => exec(() => setLayout('4')) },

        { id: 'toggle-sidebar', label: sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar', group: 'View', action: () => exec(() => setSidebarOpen(!sidebarOpen)) },
        { id: 'toggle-inspector', label: inspectorOpen ? 'Hide Inspector' : 'Show Inspector', group: 'View', shortcut: 'I', action: () => exec(() => setInspectorOpen(!inspectorOpen)) },
        { id: 'toggle-animations', label: animations ? 'Disable Animations' : 'Enable Animations', group: 'View', action: () => exec(() => setAnimations(!animations)) },

        { id: 'theme-obsidian', label: 'Theme: Obsidian', group: 'Appearance', action: () => exec(() => setTheme('obsidian')) },
        { id: 'theme-aurora', label: 'Theme: Aurora', group: 'Appearance', action: () => exec(() => setTheme('aurora')) },
        { id: 'theme-midnight', label: 'Theme: Midnight Ocean', group: 'Appearance', action: () => exec(() => setTheme('midnight-ocean')) },
        { id: 'theme-ember', label: 'Theme: Ember', group: 'Appearance', action: () => exec(() => setTheme('ember')) },
        { id: 'theme-nebula', label: 'Theme: Nebula', group: 'Appearance', action: () => exec(() => setTheme('nebula')) },
        { id: 'theme-graphite', label: 'Theme: Graphite', group: 'Appearance', action: () => exec(() => setTheme('graphite')) },
        { id: 'theme-fjord', label: 'Theme: Fjord', group: 'Appearance', action: () => exec(() => setTheme('fjord')) },
        { id: 'theme-arctic', label: 'Theme: Arctic Frost', group: 'Appearance', aliases: ['light'], action: () => exec(() => setTheme('arctic-frost')) },
        { id: 'theme-lavender', label: 'Theme: Lavender Mist', group: 'Appearance', aliases: ['light'], action: () => exec(() => setTheme('lavender-mist')) },
        { id: 'theme-sunset', label: 'Theme: Sunset Glow', group: 'Appearance', aliases: ['light'], action: () => exec(() => setTheme('sunset-glow')) },
        { id: 'theme-mint', label: 'Theme: Mint Breeze', group: 'Appearance', aliases: ['light'], action: () => exec(() => setTheme('mint-breeze')) },
        { id: 'theme-peach', label: 'Theme: Peach Blossom', group: 'Appearance', aliases: ['light'], action: () => exec(() => setTheme('peach-blossom')) },
        { id: 'theme-paper', label: 'Theme: Paper Ink', group: 'Appearance', aliases: ['minimal', 'light'], action: () => exec(() => setTheme('paper-ink')) },
        { id: 'theme-sand', label: 'Theme: Sand Dune', group: 'Appearance', aliases: ['warm', 'light'], action: () => exec(() => setTheme('sand-dune')) },
    ];

    const filtered = query
        ? commands.filter(c => fuzzy(query, c.label) || c.aliases?.some(a => fuzzy(query, a)))
        : commands;

    useEffect(() => {
        if (open) {
            setQuery('');
            setSelected(0);
            setTimeout(() => inputRef.current?.focus(), 30);

            const handleEscapeGlobal = (e: KeyboardEvent) => {
                const hasPriorityPopup = document.querySelector('.confirm-dialog-overlay, .input-dialog-overlay, .ctx-menu');
                if (hasPriorityPopup) return;

                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose();
                }
            };
            window.addEventListener('keydown', handleEscapeGlobal);
            return () => window.removeEventListener('keydown', handleEscapeGlobal);
        }
    }, [open, onClose]);

    useEffect(() => { setSelected(0); }, [query]);

    const handleKey = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
        if (e.key === 'Enter') { filtered[selected]?.action(); }
        if (e.key === 'Escape') {
            const hasPriorityPopup = document.querySelector('.confirm-dialog-overlay, .input-dialog-overlay, .ctx-menu');
            if (!hasPriorityPopup) onClose();
        }
    }, [filtered, selected, onClose]);

    useEffect(() => {
        const el = listRef.current?.children[selected] as HTMLElement;
        el?.scrollIntoView({ block: 'nearest' });
    }, [selected]);

    const groups = [...new Set(filtered.map(c => c.group))];

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="command-palette-overlay"
                    onMouseDown={onClose}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                >
                    <motion.div
                        className="command-palette"
                        onMouseDown={e => e.stopPropagation()}
                        initial={{ opacity: 0, scale: 0.95, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -20 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    >
                        <div className="command-palette-header">
                            <span className="command-palette-icon">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                            </span>
                            <input
                                ref={inputRef}
                                className="command-palette-input"
                                placeholder="Type a command or search..."
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={handleKey}
                            />
                        </div>
                        <div className="command-palette-list" ref={listRef}>
                            {filtered.length === 0 && (
                                <div className="command-palette-empty">No commands found for "{query}"</div>
                            )}
                            {groups.map(group => (
                                <div key={group}>
                                    <div className="command-palette-group-label">{group}</div>
                                    {filtered.filter(c => c.group === group).map(cmd => {
                                        const idx = filtered.indexOf(cmd);
                                        return (
                                            <button
                                                key={cmd.id}
                                                className={`command-palette-item ${idx === selected ? 'command-palette-item--selected' : ''}`}
                                                onClick={cmd.action}
                                                onMouseEnter={() => setSelected(idx)}
                                            >
                                                <span className="command-palette-item-label">{cmd.label}</span>
                                                {cmd.shortcut && <span className="command-palette-item-shortcut">{cmd.shortcut}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                        <div className="command-palette-footer">
                            <span>UP/DOWN navigate</span>
                            <span>ENTER select</span>
                            <span>ESC close</span>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
