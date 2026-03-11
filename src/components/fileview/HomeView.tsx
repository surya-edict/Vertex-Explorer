import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Monitor, Download, FileText, Image, Music, Video, HardDrive, X, Clock, ChevronRight } from 'lucide-react';
import { useRecentStore } from '../../store/recentStore';
import { useSettingsStore } from '../../store/settingsStore';
import { motion, AnimatePresence } from 'framer-motion';
import { TiltCard } from '../common/TiltCard';
import './HomeView.css';

interface DriveInfo {
    letter: string;
    label: string;
    total: number;
    free: number;
    drive_type: string;
}

interface SystemPaths {
    home: string;
    desktop: string;
    downloads: string;
    documents: string;
    pictures: string;
    music: string;
    videos: string;
}

interface Props {
    onNavigate: (path: string) => void;
}

const folderItems = [
    { label: 'Desktop', icon: Monitor },
    { label: 'Documents', icon: FileText },
    { label: 'Downloads', icon: Download },
    { label: 'Music', icon: Music },
    { label: 'Pictures', icon: Image },
    { label: 'Videos', icon: Video },
];

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function HomeView({ onNavigate }: Props) {
    const [drives, setDrives] = useState<DriveInfo[]>([]);
    const [sysPaths, setSysPaths] = useState<SystemPaths | null>(null);
    const recents = useRecentStore(s => s.recents);
    const removeRecent = useRecentStore(s => s.removeRecent);
    const showRecentHome = useSettingsStore(s => s.showRecentHome);

    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
        const saved = localStorage.getItem('explorer-home-sections-collapsed');
        return saved ? JSON.parse(saved) : {};
    });

    const toggleSection = (id: string) => {
        setCollapsed(prev => {
            const next = { ...prev, [id]: !prev[id] };
            localStorage.setItem('explorer-home-sections-collapsed', JSON.stringify(next));
            return next;
        });
    };

    useEffect(() => {
        invoke<DriveInfo[]>('get_drives').then(setDrives).catch(() => { });
        invoke<SystemPaths>('get_system_paths').then(setSysPaths).catch(() => { });
    }, []);

    const getPath = (label: string): string => {
        if (!sysPaths) return '';
        const map: Record<string, string> = {
            Desktop: sysPaths.desktop,
            Downloads: sysPaths.downloads,
            Documents: sysPaths.documents,
            Pictures: sysPaths.pictures,
            Music: sysPaths.music,
            Videos: sysPaths.videos,
        };
        return map[label] ?? '';
    };

    const container: import('framer-motion').Variants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.03, delayChildren: 0.05 }
        },
        exit: {
            opacity: 0,
            transition: { duration: 0.12, ease: 'easeOut' }
        }
    };

    const itemAnim: import('framer-motion').Variants = {
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
        exit: { opacity: 0, transition: { duration: 0.1 } }
    };

    return (
        <motion.div
            className="homeview"
            variants={container}
            initial="hidden"
            animate="show"
            exit="exit"
        >
            <div className="homeview-content-wrapper">
                {/* Libraries */}
                <motion.section className="homeview-section" variants={itemAnim}>
                    <button
                        className="homeview-section-header"
                        onClick={() => toggleSection('libraries')}
                    >
                        <motion.span
                            animate={{ rotate: collapsed['libraries'] ? 0 : 90 }}
                            className="homeview-chevron"
                        >
                            <ChevronRight size={14} />
                        </motion.span>
                        <h2 className="homeview-heading">Libraries</h2>
                    </button>
                    <AnimatePresence>
                        {!collapsed['libraries'] && (
                            <motion.div
                                className="homeview-section-content"
                                initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                            >
                                <div className="homeview-folders-grid">
                                    {folderItems.map(item => (
                                        <TiltCard
                                            as="button"
                                            key={item.label}
                                            className="homeview-folder-card"
                                            onClick={() => onNavigate(getPath(item.label))}
                                        >
                                            <span className="parallax-icon"><item.icon size={24} strokeWidth={2.2} /></span>
                                            <span className="homeview-folder-name parallax-text">{item.label}</span>
                                        </TiltCard>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.section>

                {/* Devices and drives */}
                <motion.section className="homeview-section" variants={itemAnim}>
                    <button
                        className="homeview-section-header"
                        onClick={() => toggleSection('drives')}
                    >
                        <motion.span
                            animate={{ rotate: collapsed['drives'] ? 0 : 90 }}
                            className="homeview-chevron"
                        >
                            <ChevronRight size={14} />
                        </motion.span>
                        <h2 className="homeview-heading">Devices and drives</h2>
                    </button>
                    <AnimatePresence>
                        {!collapsed['drives'] && (
                            <motion.div
                                className="homeview-section-content"
                                initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                            >
                                <div className="homeview-drives-grid">
                                    {drives.map(drive => {
                                        const used = drive.total - drive.free;
                                        const pct = drive.total > 0 ? (used / drive.total) * 100 : 0;

                                        return (
                                            <TiltCard
                                                as="button"
                                                key={drive.letter}
                                                className="homeview-drive-card"
                                                onClick={() => onNavigate(`${drive.letter}\\`)}
                                            >
                                                <span className="parallax-icon"><HardDrive size={24} strokeWidth={2.2} /></span>
                                                <div className="homeview-drive-info parallax-text">
                                                    <span className="homeview-drive-label">
                                                        {drive.label || 'Local Disk'} ({drive.letter})
                                                    </span>
                                                    <div className="homeview-drive-bar">
                                                        <motion.div
                                                            className={`homeview-drive-bar-fill ${pct > 90 ? 'critical' : ''}`}
                                                            initial={{ width: 0 }}
                                                            animate={{ width: `${pct}%` }}
                                                            transition={{ duration: 0.8, delay: 0.15, ease: "easeOut" }}
                                                        />
                                                    </div>
                                                    <span className="homeview-drive-space">
                                                        {formatBytes(drive.free)} free of {formatBytes(drive.total)}
                                                    </span>
                                                </div>
                                            </TiltCard>
                                        );
                                    })}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.section>

                {/* Recent Places */}
                {showRecentHome && recents.length > 0 && (
                    <motion.section className="homeview-section" variants={itemAnim}>
                        <div className="homeview-heading-row">
                            <button
                                className="homeview-section-header"
                                onClick={() => toggleSection('recent')}
                            >
                                <motion.span
                                    animate={{ rotate: collapsed['recent'] ? 0 : 90 }}
                                    className="homeview-chevron"
                                >
                                    <ChevronRight size={14} />
                                </motion.span>
                                <h2 className="homeview-heading">Recent</h2>
                            </button>
                            {!collapsed['recent'] && (
                                <button className="homeview-clear-btn" onClick={() => useRecentStore.getState().clearRecent()} title="Clear recents">
                                    Clear all
                                </button>
                            )}
                        </div>
                        <AnimatePresence>
                            {!collapsed['recent'] && (
                                <motion.div
                                    className="homeview-section-content"
                                    initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                                >
                                    <div className="homeview-recents-list">
                                        {recents.slice(0, 8).map(r => {
                                            const parts = r.path.replace(/\\/g, '/').split('/').filter(Boolean);
                                            const name = parts[parts.length - 1] ?? r.path;
                                            const parent = parts.slice(0, -1).join('\\') || r.path;
                                            return (
                                                <TiltCard
                                                    as="button"
                                                    key={r.path}
                                                    className="homeview-recent-item"
                                                    onClick={() => onNavigate(r.path)}
                                                    title={r.path}
                                                    tiltAmount={5}
                                                >
                                                    <Clock size={14} className="homeview-recent-icon" />
                                                    <div className="homeview-recent-info">
                                                        <span className="homeview-recent-name">{name}</span>
                                                        <span className="homeview-recent-path">{parent}</span>
                                                    </div>
                                                    <button
                                                        className="homeview-recent-remove"
                                                        title="Remove"
                                                        onClick={e => { e.stopPropagation(); removeRecent(r.path); }}
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </TiltCard>
                                            );
                                        })}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.section>
                )}
            </div>
        </motion.div>
    );
}
