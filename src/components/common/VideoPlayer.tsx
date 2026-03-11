import React, { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, ExternalLink, SkipBack, SkipForward, Repeat } from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';
import './VideoPlayer.css';

interface VideoPlayerProps {
    src: string;
    className?: string;
    autoPlay?: boolean;
    filePath?: string;
}

const resolveVideoDuration = (video: HTMLVideoElement | null, fallback = 0) => {
    if (!video) return fallback;

    if (Number.isFinite(video.duration) && video.duration > 0) {
        return video.duration;
    }

    const seekable = video.seekable;
    if (seekable && seekable.length > 0) {
        const end = seekable.end(seekable.length - 1);
        if (Number.isFinite(end) && end > 0) {
            return end;
        }
    }

    return fallback;
};

export function VideoPlayer({ src, className = '', autoPlay = true, filePath }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const controlsTimeoutRef = useRef<number | null>(null);
    const progressFrameRef = useRef<number>(0);
    const progressLastEmitRef = useRef<number>(0);
    const durationSetRef = useRef(false);
    const isDraggingRef = useRef(false);
    const isVolumeDraggingRef = useRef(false);

    const { globalVolume, setGlobalVolume, globalMuted, setGlobalMuted } = useSettingsStore();

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [showControls, setShowControls] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [playbackError, setPlaybackError] = useState<string | null>(null);
    const [isRepeatEnabled, setIsRepeatEnabled] = useState(false);

    const resetControlsTimeout = useCallback(() => {
        setShowControls(true);
        if (controlsTimeoutRef.current) {
            window.clearTimeout(controlsTimeoutRef.current);
        }
        controlsTimeoutRef.current = window.setTimeout(() => {
            if (isPlaying && !document.querySelector('.video-controls:hover')) {
                setShowControls(false);
            }
        }, 2500);
    }, [isPlaying]);

    useEffect(() => {
        resetControlsTimeout();
        return () => {
            if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
        };
    }, [isPlaying, resetControlsTimeout]);

    useEffect(() => {
        setPlaybackError(null);
        setCurrentTime(0);
        setDuration(0);
        setShowControls(true);
        cancelAnimationFrame(progressFrameRef.current);
        progressLastEmitRef.current = 0;
        durationSetRef.current = false;
    }, [src]);

    useEffect(() => {
        const syncFullscreenState = () => {
            setIsFullscreen(Boolean(document.fullscreenElement));
        };

        document.addEventListener('fullscreenchange', syncFullscreenState);
        return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        video.volume = globalVolume;
        video.muted = globalMuted;

        const updateProgress = () => {
            // Throttle React state updates to avoid 60fps re-rendering.
            // This removes "micro lag" on open and during playback.
            if (!isDraggingRef.current) {
                const now = performance.now();
                if (now - progressLastEmitRef.current > 140) {
                    progressLastEmitRef.current = now;
                    setCurrentTime(video.currentTime);
                }
            }
            if (!video.paused) {
                progressFrameRef.current = requestAnimationFrame(updateProgress);
            }
        };

        const onPlay = () => {
            setIsPlaying(true);
            resetControlsTimeout();
            cancelAnimationFrame(progressFrameRef.current);
            progressFrameRef.current = requestAnimationFrame(updateProgress);
        };

        const onPause = () => {
            setIsPlaying(false);
            setShowControls(true);
            cancelAnimationFrame(progressFrameRef.current);
            if (!isDraggingRef.current) setCurrentTime(video.currentTime);
        };

        const onTimeUpdate = () => {
            if (!durationSetRef.current) {
                const resolved = resolveVideoDuration(video, 0);
                if (resolved > 0) {
                    durationSetRef.current = true;
                    setDuration(resolved);
                }
            }
            if (!isDraggingRef.current) {
                setCurrentTime(video.currentTime);
            }
        };

        const onLoadedMetadata = () => {
            const d = resolveVideoDuration(video, 0);
            if (d > 0) {
                durationSetRef.current = true;
                setDuration(d);
            }
            if (video.videoWidth === 0 || video.videoHeight === 0) {
                setPlaybackError('This video codec or container is not supported by the built-in preview.');
            }
        };

        const onDurationChange = () => {
            if (durationSetRef.current) return;
            const d = resolveVideoDuration(video, 0);
            if (d > 0) {
                durationSetRef.current = true;
                setDuration(d);
            }
        };

        const onEnded = () => {
            setIsPlaying(false);
            setShowControls(true);
            cancelAnimationFrame(progressFrameRef.current);
            setCurrentTime(video.currentTime);
        };

        const onError = () => {
            const code = video.error?.code;
            if (code === 4) {
                setPlaybackError('Unsupported media format. Try opening this file in VLC or another external player.');
                return;
            }
            setPlaybackError('Failed to decode this video in preview. Open it in your default media player.');
        };

        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('timeupdate', onTimeUpdate);
        video.addEventListener('loadedmetadata', onLoadedMetadata);
        video.addEventListener('durationchange', onDurationChange);
        video.addEventListener('ended', onEnded);
        video.addEventListener('error', onError);

        if (!video.paused) {
            setIsPlaying(true);
            cancelAnimationFrame(progressFrameRef.current);
            progressFrameRef.current = requestAnimationFrame(updateProgress);
        }

        return () => {
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('timeupdate', onTimeUpdate);
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('durationchange', onDurationChange);
            video.removeEventListener('ended', onEnded);
            video.removeEventListener('error', onError);
            cancelAnimationFrame(progressFrameRef.current);
        };
    }, [resetControlsTimeout, globalVolume, globalMuted]);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = globalVolume;
            videoRef.current.muted = globalMuted;
        }
    }, [globalVolume, globalMuted]);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.loop = isRepeatEnabled;
        }
    }, [isRepeatEnabled]);

    const togglePlay = useCallback(() => {
        if (playbackError) return;

        const video = videoRef.current;
        if (!video) return;

        if (video.paused) {
            video.play().catch((err) => {
                if (err.name !== 'AbortError') console.error('Video play failed:', err);
            });
        } else {
            video.pause();
        }
    }, [playbackError]);

    const seekTo = (e: MouseEvent | React.MouseEvent, el: HTMLElement) => {
        const video = videoRef.current;
        if (!video) return;

        const total = resolveVideoDuration(video, duration);
        if (!total || total <= 0) return;

        const rect = el.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        video.currentTime = pct * total;
        setCurrentTime(video.currentTime);
    };

    const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        isDraggingRef.current = true;
        cancelAnimationFrame(progressFrameRef.current);

        const el = e.currentTarget;
        seekTo(e, el);

        const onMove = (ev: MouseEvent) => seekTo(ev, el);
        const onUp = () => {
            isDraggingRef.current = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);

            const video = videoRef.current;
            if (video && !video.paused) {
                const updateProgress = () => {
                    if (!isDraggingRef.current && videoRef.current) {
                        setCurrentTime(videoRef.current.currentTime);
                    }
                    if (videoRef.current && !videoRef.current.paused) {
                        progressFrameRef.current = requestAnimationFrame(updateProgress);
                    }
                };
                progressFrameRef.current = requestAnimationFrame(updateProgress);
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const skip = (seconds: number) => {
        const video = videoRef.current;
        if (!video) return;

        const total = resolveVideoDuration(video, duration);
        if (!total || total <= 0) return;

        video.currentTime = Math.max(0, Math.min(total, video.currentTime + seconds));
        setCurrentTime(video.currentTime);
    };

    const toggleMute = () => setGlobalMuted(!globalMuted);
    const toggleRepeat = () => setIsRepeatEnabled((prev) => !prev);

    const setVolumeFromMouse = (e: MouseEvent | React.MouseEvent, el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setGlobalVolume(pct);
        if (pct > 0 && globalMuted) setGlobalMuted(false);
        else if (pct === 0 && !globalMuted) setGlobalMuted(true);
    };

    const handleVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        isVolumeDraggingRef.current = true;

        const el = e.currentTarget;
        setVolumeFromMouse(e, el);

        const onMove = (ev: MouseEvent) => setVolumeFromMouse(ev, el);
        const onUp = () => {
            isVolumeDraggingRef.current = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const toggleFullscreen = () => {
        if (!containerRef.current) return;

        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch((err) => {
                console.error(`Error attempting to enable full-screen mode: ${err.message}`);
            });
        } else {
            document.exitFullscreen().catch((err) => {
                console.error(`Error attempting to exit full-screen mode: ${err.message}`);
            });
        }
    };

    const handleOpenWithMpv = () => {
        if (!filePath) return;
        invoke('open_with_mpv', { path: filePath }).catch((err) => {
            console.error('Failed to launch external player:', err);
            window.alert('No external player found. Install MPV or VLC, then retry.');
        });
    };

    const formatTime = (time: number) => {
        if (!Number.isFinite(time)) return '0:00';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const effectiveDuration = resolveVideoDuration(videoRef.current, duration);
    const progressPct = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0;
    const volumePct = (globalMuted ? 0 : globalVolume) * 100;

    return (
        <div
            ref={containerRef}
            className={`video-player ${className} ${!isPlaying ? 'is-paused' : ''}`}
            onClick={togglePlay}
            onMouseMove={resetControlsTimeout}
            onMouseLeave={() => isPlaying && setShowControls(false)}
        >
            <video
                ref={videoRef}
                src={src}
                className="video-element"
                autoPlay={autoPlay}
                muted={globalMuted}
                playsInline
                disablePictureInPicture
                controlsList="nodownload noplaybackrate"
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                }}
                onCanPlay={() => {
                    if (autoPlay && videoRef.current && videoRef.current.paused) {
                        videoRef.current.play().catch(e => {
                            if (e.name !== 'AbortError') console.warn('AutoPlay blocked:', e);
                        });
                    }
                }}
            />

            {playbackError && (
                <div className="video-error-overlay" onClick={(e) => e.stopPropagation()}>
                    <div className="video-error-title">Preview not supported</div>
                    <div className="video-error-text">{playbackError}</div>
                    <div className="video-error-actions">
                        {filePath && (
                            <button className="video-error-open-btn" onClick={handleOpenWithMpv}>
                                <Play size={14} />
                                Play externally
                            </button>
                        )}
                        {filePath && (
                            <button
                                className="video-error-open-btn"
                                onClick={() => invoke('open_file', { path: filePath }).catch(console.error)}
                            >
                                <ExternalLink size={14} />
                                Open in default app
                            </button>
                        )}
                    </div>
                </div>
            )}

            <div className="video-center-overlay">
                <div className="video-big-play">
                    <Play size={30} fill="currentColor" />
                </div>
            </div>

            <div className={`video-controls ${showControls && !playbackError ? 'video-controls--visible' : ''}`} onClick={(e) => e.stopPropagation()}>
                <div className="video-progress-container" onMouseDown={handleProgressMouseDown}>
                    <div className="video-progress-bg" />
                    <div className="video-progress-filled" style={{ width: `${progressPct}%` }} />
                    <div className="video-progress-knob" style={{ left: `${progressPct}%` }} />
                </div>

                <div className="video-bottom-bar">
                    <div className="video-controls-left">
                        <button className="video-btn" onClick={() => skip(-10)} title="Back 10 seconds">
                            <SkipBack size={16} />
                        </button>
                        <button className="video-btn video-btn--play" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                        </button>
                        <button className="video-btn" onClick={() => skip(10)} title="Forward 10 seconds">
                            <SkipForward size={16} />
                        </button>

                        <div className="video-time">
                            {formatTime(currentTime)} / {formatTime(effectiveDuration)}
                        </div>
                    </div>

                    <div className="video-controls-right">
                        <div className="video-volume-container">
                            <button className="video-btn" onClick={toggleMute} title={globalMuted ? 'Unmute' : 'Mute'}>
                                {globalMuted || globalVolume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                            </button>
                            <div className="video-volume-progress-container" onMouseDown={handleVolumeMouseDown}>
                                <div className="video-progress-bg" />
                                <div className="video-progress-filled" style={{ width: `${volumePct}%` }} />
                                <div className="video-progress-knob" style={{ left: `${volumePct}%` }} />
                            </div>
                        </div>

                        <button className="video-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit full screen' : 'Full screen'}>
                            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                        </button>
                        <button
                            className={`video-btn ${isRepeatEnabled ? 'video-btn--active' : ''}`}
                            onClick={toggleRepeat}
                            title={isRepeatEnabled ? 'Disable repeat' : 'Enable repeat'}
                        >
                            <Repeat size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
