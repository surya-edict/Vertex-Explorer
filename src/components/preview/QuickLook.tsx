import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { ExternalLink, Monitor, Image as ImageIcon, MapPin, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, PictureInPicture, Expand } from 'lucide-react';
import { motion, AnimatePresence, useDragControls, useMotionValue, animate } from 'framer-motion';
import { useSettingsStore } from '../../store/settingsStore';
import { IMAGE_EXTS, TEXT_EXTS, NATIVE_VIDEO_EXTS, CONVERT_VIDEO_EXTS, PDF_EXTS, DOCX_EXTS, XLSX_EXTS } from '../../utils/fileTypes';
import { formatBytes } from '../../utils/formatters';
import { FileEntry } from '../../hooks/useDirectory';
import { VideoPlayer } from '../common/VideoPlayer';
import { AudioPlayer } from '../common/AudioPlayer';
import { PdfPreview } from './PdfPreview';
import { DocxPreview } from './DocxPreview';
import { XlsxPreview } from './XlsxPreview';
import './QuickLook.css';

interface Props {
    file: FileEntry | null;
    open: boolean;
    onClose: () => void;
}

const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a']);
const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown']);
const requestIdle = (cb: () => void) => {
    const w = globalThis as any;
    if (typeof w.requestIdleCallback === 'function') {
        const id = w.requestIdleCallback(cb, { timeout: 500 });
        return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(cb, 32);
    return () => clearTimeout(t);
};

export function QuickLook({ file, open, onClose }: Props) {
    const [textContent, setTextContent] = useState<string | null>(null);
    const [mediaSrc, setMediaSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [convertError, setConvertError] = useState<string | null>(null);
    const [ctx, setCtx] = useState<{ x: number, y: number } | null>(null);
    const [zoom, setZoom] = useState(1);
    const imageWrapRef = useRef<HTMLDivElement>(null);
    const zoomOriginRef = useRef<{ scrollLeft: number, scrollTop: number } | null>(null);
    const zoomRef = useRef(1);
    const zoomRafRef = useRef<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
    const [mediaMountReady, setMediaMountReady] = useState(false);

    const [isPip, setIsPip] = useState(false);
    const [pipSize, setPipSize] = useState({ w: 400, h: 280 });
    const [isClosingPip, setIsClosingPip] = useState(false);
    const dragControls = useDragControls();
    const pipX = useMotionValue(0);
    const pipY = useMotionValue(0);

    const handleResizePointerDown = (e: React.PointerEvent, corner: 'tl' | 'tr' | 'bl' | 'br') => {
        if (!isPip) return;
        e.stopPropagation();
        e.preventDefault();

        const startX = e.clientX;
        const startY = e.clientY;
        const startW = pipSize.w;
        const startH = pipSize.h;
        const startPipX = pipX.get();
        const startPipY = pipY.get();

        const onMove = (ev: PointerEvent) => {
            let newW = startW;
            let newH = startH;

            if (corner === 'tr' || corner === 'br') {
                newW = Math.max(250, startW + (ev.clientX - startX));
                pipX.set(startPipX + (newW - startW) / 2);
            } else {
                newW = Math.max(250, startW - (ev.clientX - startX));
                pipX.set(startPipX - (newW - startW) / 2);
            }

            if (corner === 'br' || corner === 'bl') {
                newH = Math.max(150, startH + (ev.clientY - startY));
                pipY.set(startPipY + (newH - startH) / 2);
            } else {
                newH = Math.max(150, startH - (ev.clientY - startY));
                pipY.set(startPipY - (newH - startH) / 2);
            }

            setPipSize({ w: newW, h: newH });
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    const handleClose = useCallback(() => {
        if (isPip && !isClosingPip) {
            setIsClosingPip(true);
            setTimeout(() => {
                setIsClosingPip(false);
                onClose();
            }, 350);
        } else {
            onClose();
        }
    }, [isPip, isClosingPip, onClose]);

    useEffect(() => {
        if (!open) {
            setIsPip(false);
            setIsClosingPip(false);
            pipX.set(0);
            pipY.set(0);
            setPipSize({ w: 400, h: 280 });
        }
    }, [open, pipX, pipY]);

    // Prevent first-frame jitter: let overlay/container animate in,
    // then mount heavy media (video/audio) on the next frame.
    useEffect(() => {
        if (!open || !file) {
            setMediaMountReady(false);
            return;
        }
        setMediaMountReady(false);
        const raf = requestAnimationFrame(() => setMediaMountReady(true));
        return () => cancelAnimationFrame(raf);
    }, [open, file?.path]);

    useEffect(() => {
        if (!isPip) {
            animate(pipX, 0, { type: "spring", bounce: 0, duration: 0.4 });
            animate(pipY, 0, { type: "spring", bounce: 0, duration: 0.4 });
        } else {
            const ww = window.innerWidth;
            const wh = window.innerHeight;
            const targetX = -(ww / 2) + (pipSize.w / 2) + 24;
            const targetY = (wh / 2) - (pipSize.h / 2) - 24;

            animate(pipX, targetX, { type: "spring", bounce: 0, duration: 0.4 });
            animate(pipY, targetY, { type: "spring", bounce: 0, duration: 0.4 });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPip]);

    const setAppWallpaper = useSettingsStore(s => s.setBackgroundImage);
    const quickLookSize = useSettingsStore(s => s.quickLookSize) ?? 85;
    const globalVolume = useSettingsStore(s => s.globalVolume);
    const setGlobalVolume = useSettingsStore(s => s.setGlobalVolume);
    const setGlobalMuted = useSettingsStore(s => s.setGlobalMuted);

    const ext = file?.extension?.toLowerCase() ?? '';
    const isImage = IMAGE_EXTS.has(ext);
    const isNativeVideo = NATIVE_VIDEO_EXTS.has(ext);
    const isConvertVideo = CONVERT_VIDEO_EXTS.has(ext);
    const isAudio = AUDIO_EXTS.has(ext);
    const isMarkdown = MARKDOWN_EXTS.has(ext);
    const isText = TEXT_EXTS.has(ext) || isMarkdown;
    const isPdf = PDF_EXTS.has(ext);
    const isDocx = DOCX_EXTS.has(ext);
    const isXlsx = XLSX_EXTS.has(ext);
    const isMedia = isImage || isNativeVideo || isAudio;

    // ─── Gallery navigation (sibling images in same directory) ───
    const [siblingImages, setSiblingImages] = useState<FileEntry[]>([]);
    const [galleryIndex, setGalleryIndex] = useState(0);
    const [deleteKey, setDeleteKey] = useState(0);

    const loadGallery = useCallback(() => {
        if (!open || !file) {
            setSiblingImages([]);
            setGalleryIndex(0);
            return;
        }
        const fileExt = file.extension?.toLowerCase() ?? '';
        if (!IMAGE_EXTS.has(fileExt)) {
            setSiblingImages([]);
            setGalleryIndex(0);
            return;
        }
        let dir = file.path.replace(/[\\/][^\\/]+$/, '');
        if (/^[A-Za-z]:$/.test(dir)) dir += '\\';

        invoke<FileEntry[]>('read_dir', { path: dir })
            .then(entries => {
                const imgs = entries
                    .filter(f => !f.is_dir && IMAGE_EXTS.has(f.extension?.toLowerCase() ?? ''))
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

                setSiblingImages(prevImgs => {
                    const newIndex = (prevIndex: number) => {
                        if (imgs.length === 0) {
                            onClose();
                            return 0;
                        }
                        if (prevImgs.length > 0 && imgs.length < prevImgs.length) {
                            setDeleteKey(k => k + 1);
                        }
                        const currentActive = prevImgs[prevIndex] ?? file;
                        const stillExists = imgs.findIndex(f => f.path === currentActive.path);
                        if (stillExists >= 0) return stillExists;
                        return Math.min(prevIndex, imgs.length - 1);
                    };

                    setGalleryIndex(newIndex);
                    return imgs;
                });
            })
            .catch(() => setSiblingImages([]));
    }, [open, file, onClose]);

    useEffect(() => {
        loadGallery();
        window.addEventListener('explorer-refresh', loadGallery);
        return () => window.removeEventListener('explorer-refresh', loadGallery);
    }, [loadGallery]);

    useEffect(() => {
        setZoom(1);
    }, [open, file?.path]);

    useEffect(() => {
        zoomRef.current = zoom;
    }, [zoom]);

    const activeFile = (isImage && siblingImages.length > 0) ? (siblingImages[galleryIndex] ?? file) : file;
    const activeSrc = activeFile ? convertFileSrc(activeFile.path) : null;

    useEffect(() => {
        if (!open || !isImage || siblingImages.length <= 1) return;
        const prev = siblingImages[(galleryIndex - 1 + siblingImages.length) % siblingImages.length];
        const next = siblingImages[(galleryIndex + 1) % siblingImages.length];
        const preload = (entry?: FileEntry) => {
            if (!entry) return;
            const img = new Image();
            img.decoding = 'async';
            img.src = convertFileSrc(entry.path);
        };
        const cancel = requestIdle(() => {
            preload(prev);
            preload(next);
        });
        return cancel;
    }, [open, isImage, siblingImages, galleryIndex]);

    const goToPrev = useCallback(() => {
        if (siblingImages.length <= 1) return;
        setGalleryIndex(i => i > 0 ? i - 1 : siblingImages.length - 1);
    }, [siblingImages.length]);

    const goToNext = useCallback(() => {
        if (siblingImages.length <= 1) return;
        setGalleryIndex(i => i < siblingImages.length - 1 ? i + 1 : 0);
    }, [siblingImages.length]);

    useEffect(() => {
        if (!open || !file) {
            setTextContent(null);
            setMediaSrc(null);
            setConvertError(null);
            return;
        }

        setLoading(true);
        setConvertError(null);

        if (isMedia) {
            setTextContent(null);
            setMediaSrc(convertFileSrc(file.path));
            setLoading(false);
        } else if (isConvertVideo) {
            // Convert MKV/AVI via ffmpeg backend
            setTextContent(null);
            setMediaSrc(null);
            invoke<string>('convert_video_for_preview', { source: file.path })
                .then(tempPath => {
                    setMediaSrc(convertFileSrc(tempPath));
                    setLoading(false);
                })
                .catch(err => {
                    setConvertError(String(err));
                    setLoading(false);
                });
        } else if (isText) {
            setMediaSrc(null);
            invoke<string>('read_file_as_text', { path: file.path })
                .then(content => {
                    setTextContent(content.length > 200000 ? `${content.slice(0, 200000)}\n\n... (truncated)` : content);
                    setLoading(false);
                })
                .catch(() => {
                    setTextContent('Unable to read file');
                    setLoading(false);
                });
        } else if (isPdf || isDocx || isXlsx) {
            // Let shell animation complete first before mounting heavier preview components.
            setTextContent(null);
            setMediaSrc(null);
            const cancel = requestIdle(() => setLoading(false));
            return cancel;
        } else {
            setTextContent(null);
            setMediaSrc(null);
            setLoading(false);
        }
    }, [open, file, isMedia, isConvertVideo, isText, isPdf, isDocx, isXlsx]);

    const seekQuickLookVideo = useCallback((deltaSeconds: number) => {
        const video = document.querySelector<HTMLVideoElement>('.quicklook-video .video-element');
        if (!video) return false;

        let totalDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        if (totalDuration <= 0 && video.seekable && video.seekable.length > 0) {
            const seekableEnd = video.seekable.end(video.seekable.length - 1);
            if (Number.isFinite(seekableEnd) && seekableEnd > 0) {
                totalDuration = seekableEnd;
            }
        }
        if (totalDuration <= 0) return false;

        video.currentTime = Math.max(0, Math.min(totalDuration, video.currentTime + deltaSeconds));
        return true;
    }, []);

    const adjustMediaVolume = useCallback((delta: number) => {
        const isPlayableMediaPreview = (isAudio || isNativeVideo || isConvertVideo) && Boolean(mediaSrc);
        if (!isPlayableMediaPreview) return false;

        const next = Math.max(0, Math.min(1, globalVolume + delta));
        setGlobalVolume(next);
        setGlobalMuted(next <= 0);
        return true;
    }, [isAudio, isNativeVideo, isConvertVideo, mediaSrc, globalVolume, setGlobalVolume, setGlobalMuted]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        const hasPriorityPopup = document.querySelector('.confirm-dialog-overlay, .input-dialog-overlay, .ctx-menu');
        if (hasPriorityPopup) return;
        const isVideoPreview = (isNativeVideo || isConvertVideo) && Boolean(mediaSrc);

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            handleClose();
            return;
        }

        if (e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();

            const vid = document.querySelector<HTMLVideoElement>('.video-element');
            if (vid) {
                if (vid.paused) vid.play().catch(() => { });
                else vid.pause();
                return;
            }

            const aud = document.querySelector<HTMLAudioElement>('.audio-player-container audio');
            if (aud) {
                if (aud.paused) aud.play().catch(() => { });
                else aud.pause();
                return;
            }
        }
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (isVideoPreview && seekQuickLookVideo(-10)) {
                e.stopPropagation();
                return;
            }
            goToPrev();
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (isVideoPreview && seekQuickLookVideo(10)) {
                e.stopPropagation();
                return;
            }
            goToNext();
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (adjustMediaVolume(0.05)) {
                e.stopPropagation();
            }
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (adjustMediaVolume(-0.05)) {
                e.stopPropagation();
            }
        }
        if (e.key === 'Delete') {
            e.preventDefault();
            e.stopPropagation();
            if (!activeFile) return;

            const performTrash = async () => {
                try {
                    await invoke('trash_items', { paths: [activeFile.path] });
                    window.dispatchEvent(new CustomEvent('explorer-refresh'));
                } catch (err) {
                    console.error('Delete in QuickLook failed:', err);
                }
            };

            if (useSettingsStore.getState().confirmDelete) {
                (window as any).__explorerConfirmDialog?.({
                    title: 'Delete Item',
                    message: `Are you sure you want to move "${activeFile.name}" to the Recycle Bin?`,
                    type: 'warning',
                    confirmLabel: 'Move to Bin',
                    onConfirm: performTrash
                });
            } else {
                performTrash();
            }
        }
    }, [handleClose, goToPrev, goToNext, isNativeVideo, isConvertVideo, mediaSrc, seekQuickLookVideo, adjustMediaVolume, activeFile]);

    const handleContextMenu = (e: React.MouseEvent) => {
        if (!isImage) return;
        e.preventDefault();
        e.stopPropagation();
        setCtx({ x: e.clientX, y: e.clientY });
    };

    useEffect(() => {
        if (ctx) {
            const handleGlobal = () => setCtx(null);
            window.addEventListener('mousedown', handleGlobal);
            return () => window.removeEventListener('mousedown', handleGlobal);
        }
    }, [ctx]);

    useEffect(() => {
        if (open) {
            window.addEventListener('keydown', handleKeyDown, { capture: true });
            return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
        }
    }, [open, handleKeyDown]);

    useEffect(() => {
        const wrap = imageWrapRef.current;
        if (!wrap) return;
        const handleNativeWheel = (e: WheelEvent) => {
            if (!isImage) return;
            e.preventDefault();
            // Faster wheel zoom
            const delta = e.deltaY < 0 ? 0.15 : -0.15;
            const currentZoom = zoomRef.current;
            const newZoom = Math.max(0.1, Math.min(5, currentZoom + delta));

            if (newZoom === currentZoom) return;

            // Geometry calculations for cursor anchoring
            const rect = wrap.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;

            const contentX = wrap.scrollLeft + cursorX;
            const contentY = wrap.scrollTop + cursorY;

            const zoomRatio = newZoom / currentZoom;

            // New scroll targets
            const newScrollLeft = (contentX * zoomRatio) - cursorX;
            const newScrollTop = (contentY * zoomRatio) - cursorY;

            zoomOriginRef.current = { scrollLeft: newScrollLeft, scrollTop: newScrollTop };
            if (zoomRafRef.current !== null) {
                cancelAnimationFrame(zoomRafRef.current);
            }
            zoomRafRef.current = requestAnimationFrame(() => {
                setZoom(newZoom);
                zoomRafRef.current = null;
            });
        };
        wrap.addEventListener('wheel', handleNativeWheel, { passive: false });
        // Clean up when unmounting or changing image
        return () => {
            wrap.removeEventListener('wheel', handleNativeWheel);
            if (zoomRafRef.current !== null) {
                cancelAnimationFrame(zoomRafRef.current);
                zoomRafRef.current = null;
            }
        };
    }, [isImage, activeSrc, loading]);

    useLayoutEffect(() => {
        // Sync scroll bounds flawlessly directly after React applies the new zoom dimension CSS
        if (zoomOriginRef.current && imageWrapRef.current) {
            imageWrapRef.current.scrollLeft = zoomOriginRef.current.scrollLeft;
            imageWrapRef.current.scrollTop = zoomOriginRef.current.scrollTop;
            zoomOriginRef.current = null;
        }
    }, [zoom]);

    const handleImgMouseDown = (e: React.MouseEvent) => {
        // Only allow dragging if zoomed in and left clicked
        if (e.button !== 0 || zoom <= 1) return;
        setIsDragging(true);
        setDragStart({
            x: e.clientX,
            y: e.clientY,
            scrollLeft: imageWrapRef.current?.scrollLeft || 0,
            scrollTop: imageWrapRef.current?.scrollTop || 0
        });
        e.preventDefault();
    };

    const handleImgMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || !imageWrapRef.current) return;
        imageWrapRef.current.scrollLeft = dragStart.scrollLeft - (e.clientX - dragStart.x);
        imageWrapRef.current.scrollTop = dragStart.scrollTop - (e.clientY - dragStart.y);
    };

    useEffect(() => {
        const handleImgMouseUpGlobal = () => setIsDragging(false);
        if (isDragging) {
            window.addEventListener('mouseup', handleImgMouseUpGlobal);
            return () => window.removeEventListener('mouseup', handleImgMouseUpGlobal);
        }
    }, [isDragging]);

    const renderContent = () => {
        if (!file) return null;

        if (loading) {
            return (
                <div className="quicklook-unsupported">
                    <div className="quicklook-unsupported-text" style={{ opacity: 0.6 }}>Loading preview...</div>
                </div>
            );
        }

        if (isImage && activeSrc) {
            return (
                <div
                    ref={imageWrapRef}
                    className="quicklook-image-wrap flex-center-fallback"
                    onContextMenu={handleContextMenu}
                    onMouseDown={handleImgMouseDown}
                    onMouseMove={handleImgMouseMove}
                    style={{
                        '--ql-zoom': zoom,
                        cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                        width: '100%',
                        height: '100%',
                        overflow: 'auto',
                        display: 'flex',
                        alignItems: 'safe center',
                        justifyContent: 'safe center',
                        position: 'relative'
                    } as React.CSSProperties}
                >
                    <AnimatePresence mode="wait">
                        <motion.img
                            key={`delete-anim-${deleteKey}`}
                            className="quicklook-image"
                            src={activeSrc}
                            alt={activeFile?.name ?? ''}
                            style={{ pointerEvents: 'none', margin: 'auto' }}
                            initial={deleteKey > 0 ? { opacity: 0, scale: 0.95, filter: 'blur(4px)' } : false}
                            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                            exit={{ opacity: 0, scale: 1.05, filter: 'blur(4px)', transition: { duration: 0.15 } }}
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                        />
                    </AnimatePresence>
                </div>
            );
        }

        if ((isNativeVideo || isConvertVideo) && mediaSrc) {
            return (
                mediaMountReady ? (
                    <VideoPlayer
                        src={mediaSrc}
                        className="quicklook-video"
                        autoPlay
                        filePath={file.path}
                    />
                ) : (
                    <div className="quicklook-unsupported">
                        <div className="quicklook-unsupported-text" style={{ opacity: 0.6 }}>Opening preview…</div>
                    </div>
                )
            );
        }

        if (isConvertVideo && convertError) {
            return (
                <div className="quicklook-unsupported">
                    <div className="quicklook-unsupported-icon">🎬</div>
                    <div className="quicklook-unsupported-text">{convertError}</div>
                    <button
                        className="quicklook-open-external"
                        onClick={() => invoke('open_file', { path: file.path }).catch(console.error)}
                    >
                        <ExternalLink size={14} />
                        Open in default player
                    </button>
                </div>
            );
        }

        if (isAudio && mediaSrc) {
            return mediaMountReady
                ? <AudioPlayer src={mediaSrc} fileName={file.name} autoPlay />
                : (
                    <div className="quicklook-unsupported">
                        <div className="quicklook-unsupported-text" style={{ opacity: 0.6 }}>Opening preview…</div>
                    </div>
                );
        }

        if (isPdf) {
            return <PdfPreview src={convertFileSrc(file.path)} />;
        }

        if (isDocx) {
            return <DocxPreview filePath={file.path} />;
        }

        if (isXlsx) {
            return <XlsxPreview filePath={file.path} />;
        }

        if (isMarkdown && textContent) {
            return (
                <div className="quicklook-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(textContent) }} />
            );
        }

        if (isText && textContent !== null) {
            return <pre className="quicklook-text">{textContent}</pre>;
        }

        return (
            <div className="quicklook-unsupported">
                <div className="quicklook-unsupported-icon">FILE</div>
                <div className="quicklook-unsupported-text">
                    No preview available for <strong>.{ext || 'unknown'}</strong> files
                </div>
                <div style={{ fontSize: '11px', opacity: 0.56 }}>
                    Press <kbd>Enter</kbd> to open with default application
                </div>
            </div>
        );
    };

    return (
        <AnimatePresence>
            {open && file && (
                <motion.div
                    className={`quicklook-overlay ${isPip ? 'quicklook-overlay--pip' : ''}`}
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget && !isPip) handleClose();
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: isClosingPip ? 0 : 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                    <motion.div
                        className="quicklook-container"
                        drag={isPip}
                        dragControls={dragControls}
                        dragListener={false}
                        dragMomentum={false}
                        style={{
                            x: pipX,
                            y: pipY,
                            width: !isPip ? `${quickLookSize}vw` : pipSize.w,
                            height: !isPip ? `${quickLookSize * 0.85}vh` : pipSize.h,
                            borderRadius: 8,
                            transformOrigin: 'center center',
                            boxShadow: 'var(--shadow-xl)',
                            willChange: 'transform, opacity'
                        }}
                        animate={{
                            scale: isClosingPip ? 0.9 : 1,
                            opacity: isClosingPip ? 0 : 1,
                            y: isClosingPip ? 24 : 0
                        }}
                        onMouseDown={e => {
                            e.stopPropagation();
                            if (ctx) setCtx(null);
                        }}
                        initial={{ scale: 0.94, opacity: 0, y: 12 }}
                        exit={{ scale: 0.96, opacity: 0, y: 10 }}
                        transition={{
                            duration: 0.22,
                            ease: [0.22, 1, 0.36, 1]
                        }}
                    >
                        <div
                            className="quicklook-header"
                            onPointerDown={(e) => {
                                if (isPip) dragControls.start(e);
                            }}
                        >
                            <span className="quicklook-filename">{isImage && activeFile ? activeFile.name : file.name}</span>
                            <span className="quicklook-meta">
                                {isImage && siblingImages.length > 1 && (
                                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, marginRight: 8 }}>
                                        {galleryIndex + 1} / {siblingImages.length}
                                    </span>
                                )}
                                {formatBytes(isImage && activeFile ? activeFile.size : file.size)}
                            </span>

                            {isImage && (
                                <div className="quicklook-zoom-bar">
                                    <button className="quicklook-zoom-btn" onClick={() => setZoom(z => Math.max(0.1, z - 0.2))} title="Zoom Out">
                                        <ZoomOut size={13} />
                                    </button>
                                    <input
                                        type="range"
                                        className="quicklook-zoom-slider"
                                        min="0.1" max="5" step="0.05"
                                        value={zoom}
                                        onChange={e => setZoom(parseFloat(e.target.value))}
                                        onDoubleClick={() => setZoom(1)}
                                        title="Double click to reset"
                                    />
                                    <button className="quicklook-zoom-btn" onClick={() => setZoom(z => Math.min(5, z + 0.2))} title="Zoom In">
                                        <ZoomIn size={13} />
                                    </button>
                                    <span className="quicklook-zoom-text">{Math.round(zoom * 100)}%</span>
                                    <div style={{ width: 1, height: 12, background: 'var(--border-subtle)', margin: '0 4px' }} />
                                    <button
                                        className="quicklook-zoom-btn"
                                        onClick={() => setZoom(1)}
                                        title="Reset Zoom"
                                        style={{ opacity: zoom === 1 ? 0.4 : 1, pointerEvents: zoom === 1 ? 'none' : 'auto' }}
                                    >
                                        <RotateCcw size={12} />
                                    </button>
                                </div>
                            )}

                            <button
                                className="quicklook-open-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsPip(!isPip);
                                }}
                                title={isPip ? "Expand" : "Picture in Picture"}
                            >
                                {isPip ? <Expand size={14} /> : <PictureInPicture size={14} />}
                                {isPip ? 'Expand' : 'PIP'}
                            </button>

                            <button
                                className="quicklook-open-btn"
                                onClick={() => invoke('open_file', { path: file.path }).catch(console.error)}
                                title="Open in default app"
                            >
                                <ExternalLink size={14} />
                                Open
                            </button>
                            <button className="quicklook-close" onClick={handleClose} title="Close (Esc)">x</button>
                        </div>
                        <div className="quicklook-body">
                            {renderContent()}
                        </div>

                        {/* Gallery Navigation Arrows */}
                        {isImage && siblingImages.length > 1 && (
                            <>
                                <button
                                    className="quicklook-nav quicklook-nav--prev"
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => { e.stopPropagation(); goToPrev(); }}
                                >
                                    <ChevronLeft size={24} />
                                </button>
                                <button
                                    className="quicklook-nav quicklook-nav--next"
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => { e.stopPropagation(); goToNext(); }}
                                >
                                    <ChevronRight size={24} />
                                </button>
                            </>
                        )}

                        {/* Custom Context Menu */}
                        {ctx && createPortal(
                            <motion.div
                                className="quicklook-ctx"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                style={{ left: ctx.x, top: ctx.y }}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => e.stopPropagation()}
                            >
                                <button className="quicklook-ctx-item" onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    invoke('set_wallpaper', { path: file.path }).catch(console.error);
                                    setCtx(null);
                                }}>
                                    <Monitor size={14} />
                                    <span>Set as Desktop Wallpaper</span>
                                </button>
                                <button className="quicklook-ctx-item" onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setAppWallpaper(file.path);
                                    setCtx(null);
                                }}>
                                    <ImageIcon size={14} />
                                    <span>Set as App Background</span>
                                </button>
                                <div className="quicklook-ctx-divider" />
                                <button className="quicklook-ctx-item" onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(file.path);
                                    setCtx(null);
                                }}>
                                    <MapPin size={14} />
                                    <span>Copy Path</span>
                                </button>
                                <button className="quicklook-ctx-item" onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    invoke('open_file', { path: file.path }).catch(console.error);
                                    setCtx(null);
                                }}>
                                    <ExternalLink size={14} />
                                    <span>Open in Default App</span>
                                </button>
                            </motion.div>,
                            document.body
                        )}

                        {isPip && (
                            <>
                                <div className="ql-resize top-left" onPointerDown={e => handleResizePointerDown(e, 'tl')} />
                                <div className="ql-resize top-right" onPointerDown={e => handleResizePointerDown(e, 'tr')} />
                                <div className="ql-resize bottom-left" onPointerDown={e => handleResizePointerDown(e, 'bl')} />
                                <div className="ql-resize bottom-right" onPointerDown={e => handleResizePointerDown(e, 'br')} />
                            </>
                        )}
                    </motion.div>
                    <motion.div
                        className="quicklook-hint"
                        initial={{ opacity: 0, x: "-50%", y: 10 }}
                        animate={{ opacity: 1, x: "-50%", y: 0 }}
                        exit={{ opacity: 0, x: "-50%", y: 10 }}
                        transition={{ duration: 0.2, delay: 0.1 }}
                    >
                        Press <kbd>Space</kbd> or <kbd>Esc</kbd> to close
                    </motion.div>
                </motion.div>
            )
            }
        </AnimatePresence >
    );
}

function renderMarkdown(md: string): string {
    return md
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '- $1<br/>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br/>');
}
