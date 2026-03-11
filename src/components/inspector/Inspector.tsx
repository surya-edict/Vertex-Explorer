import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { FileEntry } from '../../hooks/useDirectory';
import { formatBytes, formatDate } from '../../utils/formatters';
import { IMAGE_EXTS, TEXT_EXTS, NATIVE_VIDEO_EXTS, CONVERT_VIDEO_EXTS, PDF_EXTS, DOCX_EXTS, XLSX_EXTS, getFileType } from '../../utils/fileTypes';
import { useSettingsStore } from '../../store/settingsStore';
import { VideoPlayer } from '../common/VideoPlayer';
import { AudioPlayer } from '../common/AudioPlayer';
import { PdfPreview } from '../preview/PdfPreview';
import { DocxPreview } from '../preview/DocxPreview';
import { XlsxPreview } from '../preview/XlsxPreview';
import './Inspector.css';

interface Props {
    file: FileEntry | null;
    width: number;
}

const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma']);

export function Inspector({ file, width }: Props) {
    const backgroundImage = useSettingsStore(s => s.backgroundImage);
    const [textContent, setTextContent] = useState<string | null>(null);
    const [imgSrc, setImgSrc] = useState<string | null>(null);
    const [convertedVideoSrc, setConvertedVideoSrc] = useState<string | null>(null);
    const [convertError, setConvertError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [imageScale, setImageScale] = useState(1);
    const imageScaleRef = useRef(1);
    const cleanupRef = useRef<(() => void) | null>(null);

    // Callback ref: attaches a non-passive wheel handler the instant the image mounts
    const imageZoomRef = (el: HTMLDivElement | null) => {
        // Clean up previous listener
        if (cleanupRef.current) {
            cleanupRef.current();
            cleanupRef.current = null;
        }
        if (!el) return;
        const handler = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -0.15 : 0.15;
            imageScaleRef.current = Math.max(0.25, Math.min(imageScaleRef.current + delta, 8));
            setImageScale(imageScaleRef.current);
        };
        el.addEventListener('wheel', handler, { passive: false });
        cleanupRef.current = () => el.removeEventListener('wheel', handler);
    };

    const dateFormat = useSettingsStore(s => s.dateFormat);
    const setInspectorWidth = useSettingsStore(s => s.setInspectorWidth);

    const handleResizeMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = width;
        const onMove = (ev: MouseEvent) => {
            const delta = startX - ev.clientX;
            const next = Math.max(260, Math.min(700, startWidth + delta));
            setInspectorWidth(next);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const ext = file?.extension?.toLowerCase() ?? '';
    const isImage = IMAGE_EXTS.has(ext);
    const isText = TEXT_EXTS.has(ext);
    const isNativeVideo = NATIVE_VIDEO_EXTS.has(ext);
    const isConvertVideo = CONVERT_VIDEO_EXTS.has(ext);
    const isAudio = AUDIO_EXTS.has(ext);
    const isPdf = PDF_EXTS.has(ext);
    const isDocx = DOCX_EXTS.has(ext);
    const isXlsx = XLSX_EXTS.has(ext);

    useEffect(() => {
        setTextContent(null);
        setImgSrc(null);
        setConvertedVideoSrc(null);
        setConvertError(null);
        setImageScale(1);
        imageScaleRef.current = 1;
        if (!file || file.is_dir) return;

        if (isImage) {
            setLoading(true);
            invoke<string>('read_file_as_base64', { path: file.path })
                .then(b64 => {
                    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
                    setImgSrc(`data:${mime};base64,${b64}`);
                })
                .catch(() => { })
                .finally(() => setLoading(false));
        } else if (isConvertVideo) {
            setLoading(true);
            invoke<string>('convert_video_for_preview', { source: file.path })
                .then(tempPath => {
                    setConvertedVideoSrc(convertFileSrc(tempPath));
                    setLoading(false);
                })
                .catch(err => {
                    setConvertError(String(err));
                    setLoading(false);
                });
        } else if (isText || (!isNativeVideo && !isAudio && !isPdf && !isDocx && !isXlsx && file.size < 200_000)) {
            setLoading(true);
            invoke<string>('read_file_as_text', { path: file.path })
                .then(text => setTextContent(text.slice(0, 10000)))
                .catch(() => setTextContent('[Cannot read file]'))
                .finally(() => setLoading(false));
        }
    }, [file]);

    if (!file) {
        return (
            <motion.div
                className="inspector inspector--empty"
                style={{ width }}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 40, scale: 0.96, filter: 'blur(6px)' }}
                transition={{ type: "spring", stiffness: 360, damping: 32 }}
                data-transparent={!!backgroundImage}
            >
                <div className="inspector-inner">
                    <div className="inspector-resize-handle" onMouseDown={handleResizeMouseDown} />
                    <div className="inspector-empty-icon">👁</div>
                    <p className="inspector-empty-text">Select a file to preview</p>
                </div>
            </motion.div>
        );
    }

    const typeInfo = !file.is_dir ? getFileType(file.extension) : null;

    const renderPreview = () => {
        if (loading) {
            return <div className="inspector-spinner"><div className="spinner" /></div>;
        }

        if (isImage && imgSrc) {
            return (
                <div
                    className="inspector-image-wrap"
                    ref={imageZoomRef}
                >
                    <img
                        src={imgSrc}
                        alt={file.name}
                        className="inspector-image"
                        style={{ transform: `scale(${imageScale})`, transition: 'transform 0.15s ease-out', cursor: imageScale > 1 ? 'zoom-out' : 'zoom-in' }}
                    />
                    {imageScale !== 1 && (
                        <button className="inspector-zoom-reset" onClick={() => { setImageScale(1); imageScaleRef.current = 1; }}>Reset Zoom</button>
                    )}
                </div>
            );
        }

        if (isNativeVideo) {
            return (
                <div className="inspector-media-wrap">
                    <VideoPlayer src={convertFileSrc(file.path)} className="inspector-video" autoPlay filePath={file.path} />
                </div>
            );
        }

        if (isConvertVideo && convertedVideoSrc) {
            return (
                <div className="inspector-media-wrap">
                    <VideoPlayer src={convertedVideoSrc} className="inspector-video" autoPlay filePath={file.path} />
                </div>
            );
        }

        if (isConvertVideo && convertError) {
            return <div className="inspector-folder-note">⚠ {convertError}</div>;
        }

        if (isAudio) {
            return (
                <div className="inspector-media-wrap">
                    <AudioPlayer src={convertFileSrc(file.path)} fileName={file.name} autoPlay />
                </div>
            );
        }

        if (isPdf) {
            return (
                <div className="inspector-doc-wrap">
                    <PdfPreview src={convertFileSrc(file.path)} />
                </div>
            );
        }

        if (isDocx) {
            return (
                <div className="inspector-doc-wrap">
                    <DocxPreview filePath={file.path} />
                </div>
            );
        }

        if (isXlsx) {
            return (
                <div className="inspector-doc-wrap">
                    <XlsxPreview filePath={file.path} />
                </div>
            );
        }

        if (textContent !== null) {
            return <pre className="inspector-text">{textContent}</pre>;
        }

        if (file.is_dir) {
            return <div className="inspector-folder-note">📂 Folder</div>;
        }

        return null;
    };

    return (
        <motion.div
            className="inspector"
            style={{ width }}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40, scale: 0.96, filter: 'blur(6px)' }}
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
            data-transparent={!!backgroundImage}
        >
            <div className="inspector-inner">
                <div className="inspector-resize-handle" onMouseDown={handleResizeMouseDown} />
                <div className="inspector-header">
                    <div className="inspector-file-icon">
                        {file.is_dir ? '📁' : typeInfo?.icon ?? '📄'}
                    </div>
                    <div className="inspector-file-info">
                        <span className="inspector-file-name">{file.name}</span>
                        <span className="inspector-file-type" style={{ color: typeInfo?.color ?? 'var(--text-muted)' }}>
                            {file.is_dir ? 'Folder' : typeInfo?.label ?? file.extension}
                        </span>
                    </div>
                </div>

                {/* Preview */}
                <div className="inspector-preview">
                    {renderPreview()}
                </div>

                {/* Metadata */}
                <div className="inspector-meta">
                    <div className="inspector-meta-row">
                        <span className="inspector-meta-label">Size</span>
                        <span className="inspector-meta-value">{file.is_dir ? '—' : formatBytes(file.size)}</span>
                    </div>
                    <div className="inspector-meta-row">
                        <span className="inspector-meta-label">Modified</span>
                        <span className="inspector-meta-value">{formatDate(file.modified, dateFormat)}</span>
                    </div>
                    <div className="inspector-meta-row">
                        <span className="inspector-meta-label">Created</span>
                        <span className="inspector-meta-value">{formatDate(file.created, dateFormat)}</span>
                    </div>
                    {file.extension && (
                        <div className="inspector-meta-row">
                            <span className="inspector-meta-label">Extension</span>
                            <span className="inspector-meta-value">.{file.extension}</span>
                        </div>
                    )}
                    {file.hidden && (
                        <div className="inspector-meta-row">
                            <span className="inspector-meta-label">Attributes</span>
                            <span className="inspector-meta-value">Hidden</span>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
