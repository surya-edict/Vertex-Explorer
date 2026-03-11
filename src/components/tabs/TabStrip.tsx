import { useState, useEffect, useRef } from 'react';
import { X, Plus, FolderClosed, Search, SlidersHorizontal } from 'lucide-react';
import { motion, Reorder, AnimatePresence } from 'framer-motion';
import { usePanelStore } from '../../store/panelStore';
import { useSettingsStore } from '../../store/settingsStore';
import { basename } from '../../utils/formatters';
import './TabStrip.css';

interface Props {
    panelId: string;
    iconScale: number;
    setIconScale: (s: number) => void;
}

export function TabStrip({ panelId, iconScale, setIconScale }: Props) {
    const activeWs = usePanelStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId) || s.workspaces[0]);
    const panels = activeWs.panels;
    const addTab = usePanelStore(s => s.addTab);
    const closeTab = usePanelStore(s => s.closeTab);
    const setActiveTab = usePanelStore(s => s.setActiveTab);
    const updateTabs = usePanelStore(s => s.updateTabs);
    const updateTab = usePanelStore(s => s.updateTab);

    const panel = panels.find(p => p.id === panelId);
    if (!panel) return null;

    const { tabs, activeTabId } = panel;
    if (!tabs) return null;

    const activeTab = tabs.find(t => t.id === activeTabId);

    const { viewMode: _unused, setViewMode: _unused2 } = useSettingsStore();

    // Search ref for click-outside
    const searchRef = useRef<HTMLDivElement>(null);
    const zoomRef = useRef<HTMLDivElement>(null);

    // Zoom helpers (re-implemented here)
    const ZOOM_MIN = 0.75;
    const ZOOM_MAX = 2.0;

    const getZoomLabel = () => {
        if (iconScale <= 0.7) return 'XS';
        if (iconScale <= 0.9) return 'S';
        if (iconScale <= 1.1) return 'M';
        if (iconScale <= 1.5) return 'L';
        if (iconScale <= 2.0) return 'XL';
        return 'XXL';
    };

    // Search
    const searchQuery = activeTab?.searchQuery ?? '';
    const [localSearch, setLocalSearch] = useState(searchQuery);
    const [isSearching, setIsSearching] = useState(!!searchQuery);
    const [isZoomOpen, setIsZoomOpen] = useState(false);

    useEffect(() => {
        setLocalSearch(searchQuery);
        setIsSearching(!!searchQuery);
    }, [searchQuery, activeTabId]);

    // Handle click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                if (!localSearch) {
                    setIsSearching(false);
                }
            }
        };

        if (isSearching) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isSearching, localSearch]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (zoomRef.current && !zoomRef.current.contains(event.target as Node)) {
                setIsZoomOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsZoomOpen(false);
            }
        };

        if (isZoomOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleEscape);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isZoomOpen]);

    useEffect(() => {
        setIsZoomOpen(false);
    }, [activeTabId, panelId]);

    useEffect(() => {
        const onEsc = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (!isSearching && !localSearch) return;
            setLocalSearch('');
            updateTab(panelId, activeTabId, { searchQuery: '' });
            setIsSearching(false);
        };
        document.addEventListener('keydown', onEsc);
        return () => document.removeEventListener('keydown', onEsc);
    }, [isSearching, localSearch, panelId, activeTabId, updateTab]);

    // Cleanup when searching finishes
    useEffect(() => {
        if (!isSearching && localSearch === '' && searchQuery !== '') {
            updateTab(panelId, activeTabId, { searchQuery: '' });
        }
    }, [isSearching, localSearch, searchQuery, panelId, activeTabId, updateTab]);

    const handleTabClick = (tabId: string) => setActiveTab(panelId, tabId);
    const handleClose = (e: React.MouseEvent, tabId: string) => {
        e.stopPropagation();
        closeTab(panelId, tabId);
    };

    const handleNewTab = () => {
        addTab(panelId, '');
    };

    const handleDuplicate = (tabId: string) => {
        const tab = tabs.find(t => t.id === tabId);
        if (tab) addTab(panelId, tab.path);
    };

    return (
        <div className="tabstrip">
            <button className="tabstrip-newtab" onClick={handleNewTab} title="New Tab (Ctrl+T)">
                <Plus size={13} />
            </button>
            <Reorder.Group axis="x" values={tabs} onReorder={(newTabs) => updateTabs(panelId, newTabs)} className="tabstrip-tabs">
                <AnimatePresence initial={false}>
                    {tabs.map(tab => {
                        const isActive = tab.id === activeTabId;
                        const label = basename(tab.path) || tab.path;
                        return (
                            <Reorder.Item
                                key={tab.id}
                                value={tab}
                                className={`tabstrip-tab ${isActive ? 'tabstrip-tab--active' : ''}`}
                                onPointerDown={() => handleTabClick(tab.id)}
                                onAuxClick={(e: any) => { if (e.button === 1) handleClose(e, tab.id); }}
                                title={tab.path}
                                onDoubleClick={() => handleDuplicate(tab.id)}
                                initial={{ opacity: 0, scaleX: 0.92 }}
                                animate={{ opacity: 1, scaleX: 1 }}
                                exit={{ opacity: 0, scaleX: 0.88, transition: { duration: 0.12, ease: [0.4, 0, 0.7, 1] } }}
                                transition={{
                                    duration: 0.18,
                                    ease: [0.25, 0.1, 0.25, 1],
                                }}
                                layout
                                dragMomentum={false}
                                dragTransition={{ bounceStiffness: 0, bounceDamping: 0 }}
                            >
                                <span className="tabstrip-tab-icon"><FolderClosed size={13} /></span>
                                <span className="tabstrip-tab-label">{label}</span>
                                {tabs.length > 1 && (
                                    <button className="tabstrip-tab-close" onClick={(e) => handleClose(e, tab.id)} title="Close tab">
                                        <X size={10} />
                                    </button>
                                )}
                            </Reorder.Item>
                        );
                    })}
                </AnimatePresence>
            </Reorder.Group>

            <div className="tabstrip-panel-actions">
                <div
                    ref={searchRef}
                    className={`search-container ${isSearching || localSearch ? 'search-container--active' : ''}`}
                >
                    <Search
                        size={13}
                        className="search-toggle-icon"
                        onClick={() => {
                            if (isSearching && !localSearch) {
                                setIsSearching(false);
                            } else {
                                setIsSearching(true);
                                setTimeout(() => document.querySelector<HTMLInputElement>('.tab-search-input')?.focus(), 60);
                            }
                        }}
                    />
                    <AnimatePresence>
                        {(isSearching || !!localSearch) && (
                            <motion.div
                                className="search-input-wrapper"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                            >
                                <input
                                    autoFocus
                                    className="tab-search-input"
                                    placeholder="Search in current folder..."
                                    value={localSearch}
                                    onChange={(e) => {
                                        setLocalSearch(e.target.value);
                                        updateTab(panelId, activeTabId, { searchQuery: e.target.value });
                                    }}
                                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                        if (e.key === 'Escape') {
                                            setLocalSearch('');
                                            updateTab(panelId, activeTabId, { searchQuery: '' });
                                            setIsSearching(false);
                                        }
                                    }}
                                />
                                {localSearch && (
                                    <button
                                        className="search-clear-btn"
                                        title="Clear search"
                                        onClick={() => {
                                            setLocalSearch('');
                                            updateTab(panelId, activeTabId, { searchQuery: '' });
                                            setIsSearching(false);
                                        }}
                                    >
                                        <X size={11} />
                                    </button>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="tabstrip-divider" />

                <div className="panel-viewmode">
                    <button
                        className={`panel-viewmode-btn ${activeTab?.viewMode === 'details' ? 'panel-viewmode-btn--active' : ''}`}
                        onClick={() => updateTab(panelId, activeTabId, { viewMode: 'details' })}
                        title="Details View"
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="0.5" /><rect x="1" y="7" width="14" height="2" rx="0.5" /><rect x="1" y="12" width="14" height="2" rx="0.5" /></svg>
                    </button>
                    <button
                        className={`panel-viewmode-btn ${activeTab?.viewMode === 'grid' ? 'panel-viewmode-btn--active' : ''}`}
                        onClick={() => updateTab(panelId, activeTabId, { viewMode: 'grid' })}
                        title="Grid View"
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="5" height="5" rx="1" /><rect x="10" y="1" width="5" height="5" rx="1" /><rect x="1" y="10" width="5" height="5" rx="1" /><rect x="10" y="10" width="5" height="5" rx="1" /></svg>
                    </button>
                    <button
                        className={`panel-viewmode-btn ${activeTab?.viewMode === 'columns' ? 'panel-viewmode-btn--active' : ''}`}
                        onClick={() => updateTab(panelId, activeTabId, { viewMode: 'columns' })}
                        title="Columns View"
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="4" height="12" rx="1" /><rect x="6" y="2" width="4" height="12" rx="1" /><rect x="11" y="2" width="4" height="12" rx="1" /></svg>
                    </button>
                </div>

                <div className="panel-zoom-wrapper" ref={zoomRef}>
                    <button
                        className={`panel-zoom-btn ${isZoomOpen ? 'panel-zoom-btn--active' : ''}`}
                        title={`Icon Size: ${getZoomLabel()}`}
                        onClick={() => setIsZoomOpen(prev => !prev)}
                    >
                        <SlidersHorizontal size={12} />
                    </button>
                    <AnimatePresence>
                        {isZoomOpen && (
                            <motion.div
                                className="panel-zoom-popup"
                                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                                transition={{ duration: 0.14, ease: [0.2, 0, 0.2, 1] }}
                            >
                                <input
                                    type="range"
                                    className="panel-zoom-slider"
                                    min={ZOOM_MIN}
                                    max={ZOOM_MAX}
                                    step={0.05}
                                    value={iconScale}
                                    onChange={(e) => setIconScale(parseFloat(e.target.value))}
                                    title={`Icon Size: ${getZoomLabel()}`}
                                />
                                <span className="panel-zoom-pct">{Math.round(iconScale * 100)}%</span>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
