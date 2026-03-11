import { useState, useCallback } from 'react';
import { X, Monitor, Keyboard, Layout, Palette, Download } from 'lucide-react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useSettingsStore, ThemeName } from '../../store/settingsStore';
import './Settings.css';

interface Props { open: boolean; onClose: () => void; }

type Tab = 'appearance' | 'layout' | 'behavior' | 'hotkeys' | 'updates';

const THEMES: { id: ThemeName; label: string; preview: string; group: 'Dark' | 'Light' }[] = [
    { id: 'obsidian', label: 'Obsidian', preview: 'linear-gradient(145deg, #000000, #0a0a0a, #0d1b1e)', group: 'Dark' },
    { id: 'aurora', label: 'Aurora', preview: 'linear-gradient(145deg, #021a16, #06312a, #044b3f)', group: 'Dark' },
    { id: 'midnight-ocean', label: 'Midnight Ocean', preview: 'linear-gradient(155deg, #030b1c, #081636, #122c66)', group: 'Dark' },
    { id: 'ember', label: 'Ember', preview: 'linear-gradient(145deg, #1b0707, #3a100e, #681f13)', group: 'Dark' },
    { id: 'nebula', label: 'Nebula', preview: 'linear-gradient(145deg, #0f0518, #200f33, #3d1451)', group: 'Dark' },
    { id: 'graphite', label: 'Graphite', preview: 'linear-gradient(152deg, #18191a, #242526, #3a3b3c)', group: 'Dark' },
    { id: 'fjord', label: 'Fjord', preview: 'linear-gradient(150deg, #05161e, #0d2f3c, #155e6a)', group: 'Dark' },
    { id: 'arctic-frost', label: 'Arctic Frost', preview: 'linear-gradient(135deg, #e8f4fd, #c8e0f4, #f0f6fc)', group: 'Light' },
    { id: 'lavender-mist', label: 'Lavender Mist', preview: 'linear-gradient(135deg, #f3e8ff, #e8d8f5, #f8f2ff)', group: 'Light' },
    { id: 'sunset-glow', label: 'Sunset Glow', preview: 'linear-gradient(135deg, #fff5ee, #ffd4b8, #fff8f2)', group: 'Light' },
    { id: 'mint-breeze', label: 'Mint Breeze', preview: 'linear-gradient(135deg, #ecfdf5, #a7f3d0, #f0fdf8)', group: 'Light' },
    { id: 'peach-blossom', label: 'Peach Blossom', preview: 'linear-gradient(135deg, #fff0f0, #fbd5d5, #fff5f5)', group: 'Light' },
    { id: 'paper-ink', label: 'Paper Ink', preview: 'linear-gradient(135deg, #f7f7f5, #edede6, #deded7)', group: 'Light' },
    { id: 'sand-dune', label: 'Sand Dune', preview: 'linear-gradient(135deg, #f8f1e4, #f0e3cc, #e7d8bd)', group: 'Light' },
];

const FONT_FAMILIES = ['Space Grotesk', 'Manrope', 'JetBrains Mono', 'Segoe UI', 'Consolas'];
const FONT_SIZES = Array.from({ length: 15 }, (_, i) => i + 11);

const ACTION_LABELS: Record<string, string> = {
    'new-tab': 'New Tab',
    'close-tab': 'Close Tab',
    'go-back': 'Go Back',
    'go-forward': 'Go Forward',
    'go-up': 'Go Up',
    'goto': 'Go To...',
    'command-palette': 'Command Palette',
    'search': 'Search',
    'toggle-inspector': 'Toggle Inspector',
    'rename': 'Rename',
    'delete': 'Delete',
    'new-folder': 'New Folder',
    'copy': 'Copy',
    'cut': 'Cut',
    'paste': 'Paste',
    'select-all': 'Select All',
    'batch-rename': 'Batch Rename',
    'view-details': 'Details View',
    'view-grid': 'Grid View',
    'view-columns': 'Columns View',
    'toggle-hidden': 'Toggle Hidden Files',
    'settings': 'Settings',
    'split-h': 'Split Horizontal',
};

export function Settings({ open, onClose }: Props) {
    const [tab, setTab] = useState<Tab>('appearance');
    const [rebinding, setRebinding] = useState<string | null>(null);
    const s = useSettingsStore();

    // Update state
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'latest'>('idle');
    const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [updateError, setUpdateError] = useState<string | null>(null);

    const handleCheckUpdate = useCallback(async () => {
        setUpdateStatus('checking');
        setUpdateError(null);
        try {
            const update = await check();
            if (update) {
                setUpdateInfo(update);
                setUpdateStatus('available');
            } else {
                setUpdateStatus('latest');
            }
        } catch (e: any) {
            setUpdateError(e?.message || 'Failed to check for updates');
            setUpdateStatus('error');
        }
    }, []);

    const handleDownloadAndInstall = useCallback(async () => {
        if (!updateInfo) return;
        setUpdateStatus('downloading');
        setDownloadProgress(0);
        try {
            let totalLen = 0;
            let downloaded = 0;
            await updateInfo.downloadAndInstall((event) => {
                if (event.event === 'Started') {
                    totalLen = (event.data as any)?.contentLength ?? 0;
                } else if (event.event === 'Progress') {
                    downloaded += (event.data as any)?.chunkLength ?? 0;
                    if (totalLen > 0) {
                        setDownloadProgress(Math.min(100, Math.round((downloaded / totalLen) * 100)));
                    }
                } else if (event.event === 'Finished') {
                    setDownloadProgress(100);
                }
            });
            setUpdateStatus('ready');
        } catch (e: any) {
            setUpdateError(e?.message || 'Download failed');
            setUpdateStatus('error');
        }
    }, [updateInfo]);

    const handleRelaunch = useCallback(async () => {
        await relaunch();
    }, []);

    const handleSelectBackground = async () => {
        const file = await openDialog({
            multiple: false,
            filters: [{
                name: 'Image',
                extensions: ['png', 'jpeg', 'jpg', 'webp']
            }]
        });
        if (file && typeof file === 'string') {
            s.setBackgroundImage(file);
        }
    };

    if (!open) return null;

    const handleHotkeyCapture = (action: string, e: React.KeyboardEvent) => {
        e.preventDefault();
        const parts: string[] = [];
        if (e.ctrlKey) parts.push('ctrl');
        if (e.altKey) parts.push('alt');
        if (e.shiftKey) parts.push('shift');
        const key = e.key.toLowerCase();
        if (!['control', 'alt', 'shift', 'meta'].includes(key)) parts.push(key);
        if (parts.length) {
            s.setHotkey(action, parts.join('+'));
            setRebinding(null);
        }
        if (e.key === 'Escape') setRebinding(null);
    };

    const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
        { id: 'appearance', label: 'Appearance', icon: <Palette size={13} /> },
        { id: 'layout', label: 'Layout', icon: <Layout size={13} /> },
        { id: 'behavior', label: 'Behavior', icon: <Monitor size={13} /> },
        { id: 'hotkeys', label: 'Hotkeys', icon: <Keyboard size={13} /> },
        { id: 'updates', label: 'Updates', icon: <Download size={13} /> },
    ];

    return (
        <div className="settings-overlay" onMouseDown={onClose}>
            <div className="settings anim-scale" onMouseDown={e => e.stopPropagation()}>
                <div className="settings-header">
                    <span className="settings-title">Settings</span>
                    <button className="settings-close" onClick={onClose}><X size={14} /></button>
                </div>

                <div className="settings-body">
                    <div className="settings-tabs">
                        {tabs.map(t => (
                            <button key={t.id} className={`settings-tab ${tab === t.id ? 'settings-tab--active' : ''}`}
                                onClick={() => setTab(t.id)}>
                                {t.icon}
                                <span>{t.label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="settings-content">
                        {tab === 'appearance' && (
                            <>
                                <div className="settings-section-title">Dark Themes</div>
                                <div className="settings-themes">
                                    {THEMES.filter(t => t.group === 'Dark').map(theme => (
                                        <button
                                            key={theme.id}
                                            className={`settings-theme ${s.theme === theme.id ? 'settings-theme--active' : ''}`}
                                            onClick={() => s.setTheme(theme.id)}
                                        >
                                            <span className="settings-theme-swatch" style={{ background: theme.preview }} />
                                            <span>{theme.label}</span>
                                            {s.theme === theme.id && <span className="settings-theme-check">OK</span>}
                                        </button>
                                    ))}
                                </div>

                                <div className="settings-section-title">Light Themes</div>
                                <div className="settings-themes">
                                    <button
                                        className="settings-theme settings-theme--disabled"
                                        type="button"
                                        disabled
                                    >
                                        <span className="settings-theme-swatch" style={{ background: 'linear-gradient(135deg, #eef3f9, #dbe8fa, #f7fbff)' }} />
                                        <span>Light Theme</span>
                                        <span className="settings-theme-check">Coming Soon</span>
                                    </button>
                                </div>

                                <div className="settings-section-title">Font Family</div>
                                <div className="settings-font-grid">
                                    {FONT_FAMILIES.map(f => (
                                        <button key={f} className={`settings-font-btn ${s.fontFamily === f ? 'settings-font-btn--active' : ''}`}
                                            onClick={() => s.setFontFamily(f)} style={{ fontFamily: f }}>
                                            {f}
                                        </button>
                                    ))}
                                </div>

                                <div className="settings-section-title">Font Size</div>
                                <div className="settings-row">
                                    {FONT_SIZES.map(sz => (
                                        <button key={sz} className={`settings-size-btn ${s.fontSize === sz ? 'settings-size-btn--active' : ''}`}
                                            onClick={() => s.setFontSize(sz)}>{sz}px</button>
                                    ))}
                                </div>

                                <div className="settings-section-title">Row Spacing</div>
                                <div className="settings-row">
                                    {(['compact', 'default', 'relaxed'] as const).map(sp => (
                                        <button key={sp} className={`settings-toggle ${s.rowSpacing === sp ? 'settings-toggle--active' : ''}`}
                                            onClick={() => s.setRowSpacing(sp)}>{sp.charAt(0).toUpperCase() + sp.slice(1)}</button>
                                    ))}
                                </div>

                                <div className="settings-section-title">Animations</div>
                                <div className="settings-row">
                                    <button className={`settings-toggle ${s.animations ? 'settings-toggle--active' : ''}`}
                                        onClick={() => s.setAnimations(!s.animations)}>
                                        {s.animations ? 'Enabled' : 'Disabled'}
                                    </button>
                                </div>
                                <div className="settings-section-title">Animation Intensity</div>
                                <div className="settings-row">
                                    {(['full', 'balanced', 'smooth'] as const).map(level => (
                                        <button
                                            key={level}
                                            className={`settings-toggle ${s.animationIntensity === level ? 'settings-toggle--active' : ''}`}
                                            onClick={() => s.setAnimationIntensity(level)}
                                        >
                                            {level.charAt(0).toUpperCase() + level.slice(1)}
                                        </button>
                                    ))}
                                </div>

                                <div className="settings-section-title">Background Image</div>
                                <div className="settings-row" style={{ marginBottom: s.backgroundImage ? '10px' : '0' }}>
                                    <button className="settings-toggle" onClick={handleSelectBackground}>Select Image...</button>
                                    {s.backgroundImage && (
                                        <button className="settings-toggle" onClick={() => s.setBackgroundImage(null)}>Clear Image</button>
                                    )}
                                </div>
                                {s.backgroundImage && (
                                    <>
                                        <div className="settings-section-title">Background Blur: {s.backgroundBlur}px</div>
                                        <input
                                            type="range"
                                            min="0" max="60"
                                            value={s.backgroundBlur}
                                            onChange={e => s.setBackgroundBlur(Number(e.target.value))}
                                            className="settings-slider"
                                        />

                                        <div className="settings-section-title">Background Opacity: {s.backgroundOpacity}%</div>
                                        <input
                                            type="range"
                                            min="0" max="100"
                                            value={s.backgroundOpacity}
                                            onChange={e => s.setBackgroundOpacity(Number(e.target.value))}
                                            className="settings-slider"
                                        />
                                    </>
                                )}
                            </>
                        )}

                        {tab === 'behavior' && (
                            <>
                                <SettingsToggle label="Show Hidden Files" value={s.showHidden} onChange={s.setShowHidden} />
                                <SettingsToggle label="Show File Extensions" value={s.showExtensions} onChange={s.setShowExtensions} />
                                <SettingsToggle label="Single Click to Open" value={s.singleClickToOpen} onChange={s.setSingleClickToOpen} />
                                <SettingsToggle label="Confirm Before Delete" value={s.confirmDelete} onChange={s.setConfirmDelete} />
                                <SettingsToggle
                                    label="Disable expensive effects in large folders"
                                    value={s.disableExpensiveEffectsInLargeFolders}
                                    onChange={s.setDisableExpensiveEffectsInLargeFolders}
                                />
                                <div className="settings-section-title">Startup</div>
                                <div className="settings-row">
                                    <button
                                        className={`settings-toggle ${s.startupMode === 'resume' ? 'settings-toggle--active' : ''}`}
                                        onClick={() => s.setStartupMode('resume')}
                                    >
                                        Resume last location
                                    </button>
                                    <button
                                        className={`settings-toggle ${s.startupMode === 'home' ? 'settings-toggle--active' : ''}`}
                                        onClick={() => s.setStartupMode('home')}
                                    >
                                        Always open Home
                                    </button>
                                </div>
                                <div className="settings-section-title">Date Format</div>
                                <div className="settings-row">
                                    <button className={`settings-toggle ${s.dateFormat === 'relative' ? 'settings-toggle--active' : ''}`} onClick={() => s.setDateFormat('relative')}>Relative</button>
                                    <button className={`settings-toggle ${s.dateFormat === 'absolute' ? 'settings-toggle--active' : ''}`} onClick={() => s.setDateFormat('absolute')}>Absolute</button>
                                </div>
                            </>
                        )}

                        {tab === 'layout' && (
                            <>
                                <SettingsToggle label="Show Sidebar" value={s.sidebarOpen} onChange={s.setSidebarOpen} />
                                <SettingsToggle label="Show Recent in Sidebar" value={s.showRecentInSidebar} onChange={s.setShowRecentInSidebar} />
                                <SettingsToggle label="Show Pinned in Sidebar" value={s.showPinnedInSidebar} onChange={s.setShowPinnedInSidebar} />
                                <SettingsToggle label="Show Tags in Sidebar" value={s.showTagsInSidebar} onChange={s.setShowTagsInSidebar} />
                                <SettingsToggle label="Show Recent in Home" value={s.showRecentHome} onChange={s.setShowRecentHome} />
                                <SettingsToggle label="Show Inspector" value={s.inspectorOpen} onChange={s.setInspectorOpen} />
                                <SettingsToggle label="Group by Type" value={s.groupByType} onChange={s.setGroupByType} />
                                <div className="settings-section-title">Preview Mode</div>
                                <div className="settings-row">
                                    <button className={`settings-toggle ${s.previewMode === 'side-panel' ? 'settings-toggle--active' : ''}`} onClick={() => s.setPreviewMode('side-panel')}>Side Panel</button>
                                    <button className={`settings-toggle ${s.previewMode === 'fullscreen' ? 'settings-toggle--active' : ''}`} onClick={() => s.setPreviewMode('fullscreen')}>Full Screen</button>
                                </div>
                                <div className="settings-section-title">QuickLook Window Size: {s.quickLookSize}%</div>
                                <input
                                    type="range"
                                    min="40" max="100"
                                    value={s.quickLookSize ?? 85}
                                    onChange={e => s.setQuickLookSize(Number(e.target.value))}
                                    className="settings-slider"
                                />
                            </>
                        )}

                        {tab === 'hotkeys' && (
                            <div className="settings-hotkeys">
                                {Object.entries(ACTION_LABELS).map(([action, label]) => (
                                    <div key={action} className="settings-hotkey-row">
                                        <span className="settings-hotkey-label">{label}</span>
                                        <button
                                            className={`settings-hotkey-value ${rebinding === action ? 'settings-hotkey-value--recording' : ''}`}
                                            onClick={() => setRebinding(action)}
                                            onKeyDown={rebinding === action ? e => handleHotkeyCapture(action, e) : undefined}
                                        >
                                            {rebinding === action ? 'Press keys...' : (s.hotkeys[action] ?? '--')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {tab === 'updates' && (
                            <>
                                <div className="settings-section-title">Current Version</div>
                                <div className="settings-update-version">v0.1.0</div>

                                <div className="settings-section-title">Check for Updates</div>
                                <div className="settings-update-card">
                                    {updateStatus === 'idle' && (
                                        <button className="settings-update-btn" onClick={handleCheckUpdate}>
                                            <Download size={14} />
                                            Check for Updates
                                        </button>
                                    )}

                                    {updateStatus === 'checking' && (
                                        <div className="settings-update-status">
                                            <span className="settings-update-spinner" />
                                            Checking for updates...
                                        </div>
                                    )}

                                    {updateStatus === 'latest' && (
                                        <div className="settings-update-status settings-update-status--success">
                                            ✅ You're on the latest version!
                                            <button className="settings-update-btn-sm" onClick={() => { setUpdateStatus('idle'); }}>Check Again</button>
                                        </div>
                                    )}

                                    {updateStatus === 'available' && updateInfo && (
                                        <div className="settings-update-available">
                                            <div className="settings-update-new-ver">
                                                 New version available: <strong>v{(updateInfo as any).version}</strong>
                                            </div>
                                            <button className="settings-update-btn settings-update-btn--accent" onClick={handleDownloadAndInstall}>
                                                <Download size={14} />
                                                Download & Install
                                            </button>
                                        </div>
                                    )}

                                    {updateStatus === 'downloading' && (
                                        <div className="settings-update-downloading">
                                            <div className="settings-update-status">Downloading update... {downloadProgress}%</div>
                                            <div className="settings-update-progress">
                                                <div className="settings-update-progress-bar" style={{ width: `${downloadProgress}%` }} />
                                            </div>
                                        </div>
                                    )}

                                    {updateStatus === 'ready' && (
                                        <div className="settings-update-status settings-update-status--success">
                                            ✅ Update installed! Restart to apply.
                                            <button className="settings-update-btn settings-update-btn--accent" onClick={handleRelaunch}>
                                                Restart Now
                                            </button>
                                        </div>
                                    )}

                                    {updateStatus === 'error' && (
                                        <div className="settings-update-status settings-update-status--error">
                                            ❌ {updateError}
                                            <button className="settings-update-btn-sm" onClick={() => { setUpdateStatus('idle'); }}>Try Again</button>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function SettingsToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="settings-toggle-row">
            <span className="settings-toggle-label">{label}</span>
            <button className={`settings-toggle-switch ${value ? 'settings-toggle-switch--on' : ''}`} onClick={() => onChange(!value)}>
                <span className="settings-toggle-knob" />
            </button>
        </div>
    );
}
