import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, Activity, Music, Repeat } from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';
import './AudioPlayer.css';

interface AudioPlayerProps {
    src: string;
    fileName: string;
    autoPlay?: boolean;
}

const VISUAL_STYLE_NAMES = [
    'Aurora Flow',
    'Orbital Mesh',
    'Fluid Blob',
    'Northern Lights',
    'Glass Bars'
] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const colorWithAlpha = (color: string, alpha: number) => {
    const normalized = color.trim();

    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
        const r = parseInt(normalized.slice(1, 3), 16);
        const g = parseInt(normalized.slice(3, 5), 16);
        const b = parseInt(normalized.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
        const r = parseInt(normalized[1] + normalized[1], 16);
        const g = parseInt(normalized[2] + normalized[2], 16);
        const b = parseInt(normalized[3] + normalized[3], 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbMatch) {
        const channels = rgbMatch[1]
            .split(',')
            .map((channel) => Number.parseFloat(channel.trim()))
            .slice(0, 3);

        if (channels.length === 3 && channels.every((channel) => Number.isFinite(channel))) {
            return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
        }
    }

    return `rgba(129, 140, 248, ${alpha})`;
};

const getBandAverage = (data: Uint8Array, startRatio: number, endRatio: number) => {
    if (data.length === 0) return 0;

    const start = Math.floor(clamp(startRatio, 0, 1) * data.length);
    const end = Math.max(start + 1, Math.floor(clamp(endRatio, 0, 1) * data.length));
    let sum = 0;

    for (let i = start; i < end; i++) {
        sum += data[i] / 255;
    }

    return sum / (end - start);
};

const sampleFrequency = (data: Uint8Array | null, ratio: number) => {
    if (!data || data.length === 0) return 0;
    const index = Math.round(clamp(ratio, 0, 1) * (data.length - 1));
    return data[index] / 255;
};

const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
};

const drawPolygon = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    sides: number,
    rotation: number
) => {
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
        const angle = (i / sides) * Math.PI * 2 + rotation;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
};

const hash = (seed: number) => {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
};

export function AudioPlayer({ src, fileName, autoPlay = true }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);
    const progressFrameRef = useRef<number>(0);
    const isDraggingRef = useRef(false);
    const isVolumeDraggingRef = useRef(false);
    const [duration, setDuration] = useState(0);
    const { globalVolume, setGlobalVolume, globalMuted, setGlobalMuted, audioVisualStyle, setAudioVisualStyle, theme } = useSettingsStore();
    const visualStyleRef = useRef(audioVisualStyle ?? 0);
    const globalVolumeRef = useRef(globalVolume);
    const globalMutedRef = useRef(globalMuted);
    const accentColorRef = useRef('#8b92ff');
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [isRepeatEnabled, setIsRepeatEnabled] = useState(false);

    useEffect(() => {
        const updateColor = () => {
            accentColorRef.current = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b92ff';
        };
        updateColor();
        const t = setTimeout(updateColor, 50); // Double-catch right after DOM layout updates variables
        return () => clearTimeout(t);
    }, [theme]);

    // Real Audio Analysis
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyzerRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<AudioNode | null>(null);
    const dataArrayRef = useRef<Uint8Array | null>(null);

    const [controlsVisible, setControlsVisible] = useState(true);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleMouseMove = useCallback(() => {
        setControlsVisible(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            if (audioRef.current && !audioRef.current.paused) {
                setControlsVisible(false);
            }
        }, 2000);
    }, []);

    useEffect(() => {
        return () => {
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        };
    }, []);
    const timeDomainDataRef = useRef<Float32Array | null>(null);
    const envelopeRef = useRef<Float32Array | null>(null);
    const fallbackBandsRef = useRef<Float32Array | null>(null);
    const fallbackFrameCountRef = useRef(0);
    const fallbackBandCountRef = useRef(0);
    const smoothEnergyRef = useRef(0);
    const smoothBassRef = useRef(0);
    const smoothMidRef = useRef(0);
    const smoothTrebleRef = useRef(0);
    const smoothPlayingRef = useRef(0);
    const lastFrameTimeRef = useRef(0);
    const phaseAccRef = useRef({
        auroraWave: [0, 0, 0],
        orbitalAngle: 0,
        northernWave: [0, 0, 0, 0, 0],
        northernWave2: [0, 0, 0, 0, 0],
    });

    const setupAudioContext = useCallback(async () => {
        const audio = audioRef.current;
        if (!audio) return;

        try {
            let ctx = audioContextRef.current;
            if (!ctx) {
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                ctx = new AudioContextClass();
                audioContextRef.current = ctx;
            }

            if (!analyzerRef.current) {
                const analyzer = ctx.createAnalyser();
                analyzer.fftSize = 512;
                analyzer.smoothingTimeConstant = 0.82;
                analyzer.minDecibels = -95;
                analyzer.maxDecibels = -20;
                let sourceNode: AudioNode | null = null;

                const capture = (audio as HTMLMediaElement & {
                    captureStream?: () => MediaStream;
                    mozCaptureStream?: () => MediaStream;
                }).captureStream?.() || (audio as HTMLMediaElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream?.();

                if (capture) {
                    try {
                        sourceNode = ctx.createMediaStreamSource(capture);
                        sourceNode.connect(analyzer);
                        analyzer.connect(ctx.destination);
                    } catch {
                        sourceNode = null;
                    }
                }

                if (!sourceNode) {
                    const mediaSource = ctx.createMediaElementSource(audio);
                    mediaSource.connect(analyzer);
                    analyzer.connect(ctx.destination);
                    sourceNode = mediaSource;
                }

                const bufferLength = analyzer.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                const timeDomainData = new Float32Array(analyzer.fftSize);

                analyzerRef.current = analyzer;
                sourceRef.current = sourceNode;
                dataArrayRef.current = dataArray;
                timeDomainDataRef.current = timeDomainData;
            }

            if (ctx?.state === 'suspended') {
                await ctx.resume();
            }
        } catch (err) {
            console.error("AudioContext setup failed:", err);
        }
    }, []);

    useEffect(() => {
        if (src && autoPlay) {
            // Pre-create and resume the AudioContext PRECISELY during this synchronous user gesture map.
            // If we don't do this here, creating it later in `onPlay` will cause it to be strictly 'suspended',
            // resulting in no sound being output when we connect createMediaElementSource.
            try {
                if (!audioContextRef.current) {
                    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                    audioContextRef.current = new AudioContextClass();
                }
                if (audioContextRef.current?.state === 'suspended') {
                    audioContextRef.current.resume().catch(() => { });
                }
            } catch (err) {
                console.warn('[AudioPlayer] AudioContext creation/resume failed:', err);
            }

            const audio = audioRef.current;
            if (audio && audio.paused) {
                const playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.catch(err => {
                        if (err.name !== 'AbortError') {
                            console.warn('[AudioPlayer] Immediate autoplay failed:', err);
                        }
                    });
                }
            }
        }
    }, [src, autoPlay]);




    // Animated visualizer using real frequency data
    const drawVisualizer = useCallback((playing: boolean) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const nearWhite = 'rgba(242, 246, 255, 0.95)';

        let lastDraw = 0;

        const draw = (time: number) => {
            const accentColor = accentColorRef.current;
            animFrameRef.current = requestAnimationFrame(draw);

            // Throttle to 30fps max if not playing, or 60fps if playing (usually automatic, but limits overhead)
            if (time - lastDraw < (playing ? 16 : 33)) return;
            lastDraw = time;

            const width = canvas.width;
            const height = canvas.height;
            if (!width || !height) return;

            const cx = width / 2;
            const cy = height / 2;
            const minSide = Math.min(width, height);
            const now = performance.now() * 0.001;
            const dt = lastFrameTimeRef.current > 0 ? Math.min(now - lastFrameTimeRef.current, 0.1) : 0.016;
            lastFrameTimeRef.current = now;
            const acc = phaseAccRef.current;
            const analyzer = analyzerRef.current;
            const data = dataArrayRef.current;
            const timeDomainData = timeDomainDataRef.current;
            const envelope = envelopeRef.current;
            const fallbackBands = fallbackBandsRef.current;
            const fallbackFrameCount = fallbackFrameCountRef.current;
            const fallbackBandCount = fallbackBandCountRef.current;

            let bass = 0;
            let mid = 0;
            let treble = 0;
            let energy = 0;
            let rms = 0;
            let analyzerRange = 0;
            let fallbackFrameIndex = -1;
            let fallbackFrameOffset = -1;

            const audioEl = audioRef.current;
            const totalTime = audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;

            if (playing && audioEl && totalTime > 0 && fallbackBands && fallbackFrameCount > 0 && fallbackBandCount > 0) {
                const ratio = clamp(audioEl.currentTime / totalTime, 0, 1);
                fallbackFrameIndex = Math.min(
                    fallbackFrameCount - 1,
                    Math.max(0, Math.floor(ratio * (fallbackFrameCount - 1)))
                );
                fallbackFrameOffset = fallbackFrameIndex * fallbackBandCount;
            }

            const fallbackBandAverage = (startRatio: number, endRatio: number) => {
                if (fallbackFrameOffset < 0 || !fallbackBands || fallbackBandCount < 1) return 0;
                const start = Math.floor(clamp(startRatio, 0, 1) * fallbackBandCount);
                const end = Math.max(start + 1, Math.floor(clamp(endRatio, 0, 1) * fallbackBandCount));
                let sum = 0;
                for (let i = start; i < end; i++) {
                    sum += fallbackBands[fallbackFrameOffset + i] ?? 0;
                }
                return sum / (end - start);
            };

            const sampleAtRatio = (ratio: number) => {
                if (playing && data && analyzerRange > 0.018) {
                    return sampleFrequency(data, ratio);
                }
                if (fallbackFrameOffset >= 0 && fallbackBands && fallbackBandCount > 0) {
                    const idx = Math.min(
                        fallbackBandCount - 1,
                        Math.max(0, Math.floor(clamp(ratio, 0, 1) * (fallbackBandCount - 1)))
                    );
                    return fallbackBands[fallbackFrameOffset + idx] ?? 0;
                }
                return 0;
            };

            if (playing && analyzer && data) {
                analyzer.getByteFrequencyData(data as any);
                bass = getBandAverage(data, 0, 0.18);
                mid = getBandAverage(data, 0.18, 0.58);
                treble = getBandAverage(data, 0.58, 1);
                energy = getBandAverage(data, 0, 1);

                let minVal = 255;
                let maxVal = 0;
                for (let i = 0; i < data.length; i++) {
                    const v = data[i];
                    if (v < minVal) minVal = v;
                    if (v > maxVal) maxVal = v;
                }
                analyzerRange = (maxVal - minVal) / 255;

                if (timeDomainData) {
                    analyzer.getFloatTimeDomainData(timeDomainData as any);
                    let sumSq = 0;
                    for (let i = 0; i < timeDomainData.length; i++) {
                        const sample = timeDomainData[i];
                        sumSq += sample * sample;
                    }
                    rms = Math.sqrt(sumSq / timeDomainData.length);
                    const rmsEnergy = clamp(rms * 5.4, 0, 1);
                    energy = Math.max(energy, rmsEnergy);
                    bass = Math.max(bass, rmsEnergy * 0.78);
                    mid = Math.max(mid, rmsEnergy * 0.62);
                    treble = Math.max(treble, rmsEnergy * 0.5);
                }

                if (!globalMutedRef.current) {
                    const normalization = clamp(1 / Math.max(globalVolumeRef.current, 0.22), 0.75, 1.6);
                    energy = clamp(energy * normalization, 0, 1);
                    bass = clamp(bass * normalization, 0, 1);
                    mid = clamp(mid * normalization, 0, 1);
                    treble = clamp(treble * normalization, 0, 1);
                } else {
                    energy = 0;
                    bass = 0;
                    mid = 0;
                    treble = 0;
                }
            }

            if (playing && fallbackFrameOffset >= 0) {
                const env = envelope && fallbackFrameIndex >= 0 ? (envelope[fallbackFrameIndex] ?? 0) : 0;
                const fbEnergy = Math.max(env, fallbackBandAverage(0, 1));
                const fbBass = Math.max(env * 0.82, fallbackBandAverage(0, 0.2));
                const fbMid = Math.max(env * 0.66, fallbackBandAverage(0.2, 0.62));
                const fbTreble = Math.max(env * 0.5, fallbackBandAverage(0.62, 1));

                if (energy < 0.02 || analyzerRange <= 0.018) {
                    energy = fbEnergy * 0.72;
                    bass = fbBass * 0.7;
                    mid = fbMid * 0.66;
                    treble = fbTreble * 0.62;
                } else {
                    energy = Math.max(energy, fbEnergy * 0.3);
                    bass = Math.max(bass, fbBass * 0.28);
                    mid = Math.max(mid, fbMid * 0.24);
                    treble = Math.max(treble, fbTreble * 0.2);
                }
            }

            const smoothing = playing ? 0.12 : 0.05;
            smoothEnergyRef.current += ((playing ? energy : 0) - smoothEnergyRef.current) * smoothing;
            smoothBassRef.current += ((playing ? bass : 0) - smoothBassRef.current) * smoothing;
            smoothMidRef.current += ((playing ? mid : 0) - smoothMidRef.current) * smoothing;
            smoothTrebleRef.current += ((playing ? treble : 0) - smoothTrebleRef.current) * smoothing;
            smoothPlayingRef.current += ((playing ? 1 : 0) - smoothPlayingRef.current) * smoothing;

            const smoothEnergy = Math.pow(clamp(smoothEnergyRef.current, 0, 1), 1.32) * 0.76;
            const smoothBass = Math.pow(clamp(smoothBassRef.current, 0, 1), 1.26) * 0.74;
            const smoothMid = Math.pow(clamp(smoothMidRef.current, 0, 1), 1.22) * 0.72;
            const smoothTreble = Math.pow(clamp(smoothTrebleRef.current, 0, 1), 1.16) * 0.7;
            const smoothPlaying = smoothPlayingRef.current;
            const beat = clamp((smoothBass - 0.33) * 1.85, 0, 1);

            ctx.clearRect(0, 0, width, height);
            ctx.globalCompositeOperation = 'source-over';

            const topGradient = ctx.createLinearGradient(0, 0, width, height);
            topGradient.addColorStop(0, colorWithAlpha(accentColor, 0.025 + smoothEnergy * 0.04));
            topGradient.addColorStop(0.55, 'rgba(7, 11, 22, 0.02)');
            topGradient.addColorStop(1, 'rgba(2, 6, 14, 0)');
            ctx.fillStyle = topGradient;
            ctx.fillRect(0, 0, width, height);

            const ambient = ctx.createRadialGradient(cx, cy, minSide * 0.04, cx, cy, minSide * 0.68);
            ambient.addColorStop(0, colorWithAlpha(accentColor, 0.08 + smoothEnergy * 0.26));
            ambient.addColorStop(0.75, colorWithAlpha(accentColor, 0.015 + smoothEnergy * 0.03));
            ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = ambient;
            ctx.fillRect(0, 0, width, height);

            ctx.globalCompositeOperation = 'lighter';

            const styleNum = clamp(visualStyleRef.current, 0, VISUAL_STYLE_NAMES.length - 1);

            if (styleNum === 0) {
                const layers = 3;
                const step = Math.max(4, Math.floor(width / 160));

                for (let layer = 0; layer < layers; layer++) {
                    const depth = layer / (layers - 1);
                    const offset = (layer - (layers - 1) / 2) * (4 + 22 * smoothPlaying + smoothEnergy * 30 + beat * 14);
                    const amplitude = (18 + layer * 14 + smoothMid * 130 + beat * 60 + smoothBass * 50) * smoothPlaying + (1 - smoothPlaying) * 3;
                    const speed = 0.9 + layer * 0.21 + smoothEnergy * 0.3 + (1 - smoothPlaying) * 0.15;
                    acc.auroraWave[layer] += dt * speed;
                    const frequency = 0.0085 + layer * 0.0018;

                    // Floating Embers Effect when paused or low volume
                    if (layer === 0 && smoothPlaying < 0.98) {
                        const emberCount = 12;
                        const emberColor = accentColor;
                        for (let e = 0; e < emberCount; e++) {
                            const eSeed = e * 13.37;
                            const eX = ((hash(eSeed) * width) + now * 15) % width;
                            const eSpeedY = 15 + hash(eSeed + 1) * 35;
                            const eLifetime = 4;
                            const eAge = (now + hash(eSeed + 2) * eLifetime) % eLifetime;
                            const eRatio = eAge / eLifetime;

                            const eY = cy - (eRatio * 120) + Math.sin(now * 0.5 + e) * 10;
                            const eSize = (1 - eRatio) * 2.5;
                            const eAlpha = (1 - eRatio) * (1 - smoothPlaying) * 0.4;

                            if (eAlpha > 0) {
                                ctx.fillStyle = colorWithAlpha(emberColor, eAlpha);
                                ctx.beginPath();
                                ctx.arc(eX, eY, eSize, 0, Math.PI * 2);
                                ctx.fill();

                                // Ember Glow
                                if (eAlpha > 0.1) {
                                    ctx.shadowBlur = 8;
                                    ctx.shadowColor = emberColor;
                                    ctx.fill();
                                    ctx.shadowBlur = 0;
                                }
                            }
                        }
                    }

                    const waveGradient = ctx.createLinearGradient(0, cy, width, cy);
                    waveGradient.addColorStop(0, colorWithAlpha(accentColor, 0));
                    waveGradient.addColorStop(0.2, colorWithAlpha(accentColor, 0.08 + depth * 0.12));
                    waveGradient.addColorStop(0.5, colorWithAlpha(accentColor, 0.22 + smoothEnergy * 0.35 + smoothPlaying * 0.1));
                    waveGradient.addColorStop(0.8, colorWithAlpha(accentColor, 0.1 + depth * 0.1));
                    waveGradient.addColorStop(1, colorWithAlpha(accentColor, 0));
                    ctx.strokeStyle = waveGradient;
                    ctx.lineWidth = 1.6 + layer * 0.9 + smoothEnergy * 1.2;

                    ctx.beginPath();
                    for (let x = 0; x <= width; x += step) {
                        const ratio = x / width;
                        const sample = sampleAtRatio(ratio);
                        const anchor = Math.sin(ratio * Math.PI);
                        const primary = Math.sin(x * frequency + acc.auroraWave[layer]) * amplitude;
                        const secondary = Math.cos(x * 0.018 - now * (1.1 + layer * 0.17)) * (10 + smoothTreble * 55) * (0.5 + sample) * smoothPlaying;
                        const tertiary = Math.sin(x * 0.006 + now * 0.4) * smoothBass * 40 * anchor;
                        const y = cy + offset + (primary + secondary + tertiary) * anchor;
                        if (x === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                }
            } else if (styleNum === 1) {
                const pointCount = 56;
                const baseRadius = minSide * (0.16 + smoothEnergy * 0.1);
                const points: Array<{ x: number; y: number }> = [];
                acc.orbitalAngle += dt * (0.18 + smoothEnergy * 0.24);

                for (let i = 0; i < pointCount; i++) {
                    const ratio = i / pointCount;
                    const sample = sampleAtRatio(ratio);
                    const angle = ratio * Math.PI * 2 + acc.orbitalAngle;
                    const wobble = Math.sin(now * 0.8 + i * 0.45) * (8 + smoothMid * 16);
                    const radius = baseRadius + sample * minSide * 0.18 + wobble;
                    points.push({
                        x: cx + Math.cos(angle) * radius,
                        y: cy + Math.sin(angle) * radius
                    });
                }

                if (points.length > 2) {
                    const firstMidX = (points[0].x + points[1].x) / 2;
                    const firstMidY = (points[0].y + points[1].y) / 2;
                    ctx.beginPath();
                    ctx.moveTo(firstMidX, firstMidY);

                    for (let i = 1; i <= pointCount; i++) {
                        const current = points[i % pointCount];
                        const next = points[(i + 1) % pointCount];
                        const midX = (current.x + next.x) / 2;
                        const midY = (current.y + next.y) / 2;
                        ctx.quadraticCurveTo(current.x, current.y, midX, midY);
                    }

                    const shell = ctx.createRadialGradient(cx, cy, baseRadius * 0.35, cx, cy, baseRadius * 1.35);
                    shell.addColorStop(0, colorWithAlpha(accentColor, 0.08 + smoothEnergy * 0.1));
                    shell.addColorStop(1, colorWithAlpha(accentColor, 0.28 + smoothEnergy * 0.32));
                    ctx.strokeStyle = shell;
                    ctx.lineWidth = 1.6 + smoothEnergy * 2;
                    ctx.stroke();
                }

                for (let ring = 0; ring < 3; ring++) {
                    ctx.setLineDash([8 + ring * 2, 10 + ring * 4]);
                    ctx.lineDashOffset = -now * (14 + ring * 8);
                    ctx.beginPath();
                    ctx.strokeStyle = colorWithAlpha(accentColor, 0.1 + ring * 0.08 + smoothEnergy * 0.18);
                    ctx.lineWidth = 1.1 + ring * 0.5;
                    const radius = baseRadius + 26 + ring * 24 + smoothBass * 18;
                    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                    ctx.stroke();
                }
                ctx.setLineDash([]);
            } else if (styleNum === 2) {
                // ── Fluid Blob v2 ──
                const baseRadius = minSide * (0.11 + smoothBass * 0.06 + smoothEnergy * 0.03);
                const blobPoints = 72;

                // Helper: compute blob radius at given angle for a layer
                const blobR = (angle: number, layerSpeed: number, scale: number) => {
                    const sample = sampleAtRatio(((angle / (Math.PI * 2)) % 1 + 1) % 1);
                    let d = 0;
                    d += Math.sin(angle * 2 + now * 0.5 * layerSpeed) * (14 + smoothBass * 45);
                    d += Math.sin(angle * 3 - now * 0.8 * layerSpeed) * (8 + smoothMid * 28);
                    d += Math.cos(angle * 5 + now * 1.1 * layerSpeed) * (4 + smoothTreble * 18);
                    d += Math.sin(angle * 8 - now * 0.3) * (2 + smoothEnergy * 10);
                    d += Math.cos(angle * 13 + now * 1.6) * smoothTreble * 8;
                    d += sample * minSide * 0.09;
                    return (baseRadius + d) * scale;
                };

                // Draw a smooth blob path and return the points
                const drawBlobPath = (layerSpeed: number, scale: number) => {
                    const pts: Array<{ x: number; y: number }> = [];
                    for (let i = 0; i < blobPoints; i++) {
                        const angle = (i / blobPoints) * Math.PI * 2;
                        const r = blobR(angle, layerSpeed, scale);
                        pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
                    }
                    ctx.beginPath();
                    const fmx = (pts[0].x + pts[1].x) / 2;
                    const fmy = (pts[0].y + pts[1].y) / 2;
                    ctx.moveTo(fmx, fmy);
                    for (let i = 1; i <= blobPoints; i++) {
                        const cur = pts[i % blobPoints];
                        const nxt = pts[(i + 1) % blobPoints];
                        ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) / 2, (cur.y + nxt.y) / 2);
                    }
                    return pts;
                };

                // Orbiting particles behind the blob
                const particleCount = 28 + Math.floor(smoothEnergy * 18);
                for (let p = 0; p < particleCount; p++) {
                    const seed = p + 1;
                    const pAngle = hash(seed * 1.47) * Math.PI * 2 + now * (0.15 + hash(seed * 2.31) * 0.2);
                    const pDist = baseRadius * (1.2 + hash(seed * 3.67) * 0.8 + smoothBass * 0.4);
                    const sample = sampleAtRatio(p / particleCount);
                    const px = cx + Math.cos(pAngle) * pDist + Math.sin(now * 0.3 + p) * (4 + smoothMid * 10);
                    const py = cy + Math.sin(pAngle) * pDist + Math.cos(now * 0.25 + p) * (4 + smoothMid * 10);
                    const pSize = 1 + hash(seed * 4.13) * 2.2 + sample * 2.5 + beat * 1.5;
                    const pAlpha = (0.08 + sample * 0.3 + smoothEnergy * 0.15) * (1 - hash(seed * 5.89) * 0.4);

                    if (pSize > 1.6) {
                        const pgGrad = ctx.createRadialGradient(px, py, 0, px, py, pSize * 3);
                        pgGrad.addColorStop(0, colorWithAlpha(accentColor, pAlpha * 0.35));
                        pgGrad.addColorStop(1, colorWithAlpha(accentColor, 0));
                        ctx.fillStyle = pgGrad;
                        ctx.beginPath();
                        ctx.arc(px, py, pSize * 3, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    ctx.fillStyle = colorWithAlpha(hash(seed * 6.1) > 0.75 ? nearWhite : accentColor, pAlpha);
                    ctx.beginPath();
                    ctx.arc(px, py, pSize, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Outer glow layers (back to front)
                for (let layer = 3; layer >= 0; layer--) {
                    const layerScale = 1 + layer * 0.2;
                    const layerAlpha = (0.04 - layer * 0.006) + smoothEnergy * 0.06;

                    drawBlobPath(1 + layer * 0.18, layerScale);
                    const grad = ctx.createRadialGradient(cx, cy, baseRadius * 0.05, cx, cy, baseRadius * layerScale * 1.9);
                    grad.addColorStop(0, colorWithAlpha(accentColor, layerAlpha + smoothEnergy * 0.1));
                    grad.addColorStop(0.5, colorWithAlpha(accentColor, layerAlpha * 0.5));
                    grad.addColorStop(1, colorWithAlpha(accentColor, 0));
                    ctx.fillStyle = grad;
                    ctx.fill();
                }

                // Main blob body
                const mainPts = drawBlobPath(1, 1);

                // Fill with rich gradient
                const blobGrad = ctx.createRadialGradient(cx - baseRadius * 0.15, cy - baseRadius * 0.2, baseRadius * 0.04, cx, cy, baseRadius * 1.35);
                blobGrad.addColorStop(0, colorWithAlpha(nearWhite, 0.16 + smoothEnergy * 0.14 + beat * 0.12));
                blobGrad.addColorStop(0.2, colorWithAlpha(accentColor, 0.32 + smoothEnergy * 0.24));
                blobGrad.addColorStop(0.55, colorWithAlpha(accentColor, 0.18 + smoothBass * 0.18));
                blobGrad.addColorStop(1, colorWithAlpha(accentColor, 0));
                ctx.fillStyle = blobGrad;
                ctx.fill();

                // Bright edge stroke
                ctx.strokeStyle = colorWithAlpha(accentColor, 0.22 + smoothEnergy * 0.35 + beat * 0.15);
                ctx.lineWidth = 1.6 + smoothEnergy * 1.8;
                ctx.stroke();

                // Inner secondary blob (smaller, different phase) for depth
                drawBlobPath(1.6, 0.55 + smoothMid * 0.1);
                const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 0.7);
                innerGrad.addColorStop(0, colorWithAlpha(nearWhite, 0.12 + beat * 0.18));
                innerGrad.addColorStop(0.5, colorWithAlpha(accentColor, 0.10 + smoothEnergy * 0.12));
                innerGrad.addColorStop(1, colorWithAlpha(accentColor, 0));
                ctx.fillStyle = innerGrad;
                ctx.fill();

                // Beat flash ring
                if (beat > 0.1) {
                    const flashR = baseRadius * (1.1 + beat * 0.3);
                    ctx.beginPath();
                    ctx.arc(cx, cy, flashR, 0, Math.PI * 2);
                    ctx.strokeStyle = colorWithAlpha(accentColor, beat * 0.25);
                    ctx.lineWidth = 1 + beat * 2;
                    ctx.stroke();
                }

                // Bright core
                const coreRadius = baseRadius * (0.28 + beat * 0.14);
                const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
                coreGrad.addColorStop(0, colorWithAlpha(nearWhite, 0.36 + beat * 0.45));
                coreGrad.addColorStop(0.3, colorWithAlpha(accentColor, 0.22 + smoothBass * 0.3));
                coreGrad.addColorStop(1, colorWithAlpha(accentColor, 0));
                ctx.fillStyle = coreGrad;
                ctx.beginPath();
                ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
                ctx.fill();

                // Specular highlight
                const hlY = cy - baseRadius * 0.3;
                const hlR = baseRadius * 0.34;
                const hlGrad = ctx.createRadialGradient(cx - baseRadius * 0.08, hlY, 0, cx, hlY, hlR);
                hlGrad.addColorStop(0, colorWithAlpha(nearWhite, 0.12 + smoothEnergy * 0.1));
                hlGrad.addColorStop(1, colorWithAlpha(nearWhite, 0));
                ctx.fillStyle = hlGrad;
                ctx.beginPath();
                ctx.arc(cx, hlY, hlR, 0, Math.PI * 2);
                ctx.fill();
            } else if (styleNum === 3) {
                // ── Northern Lights ──
                const curtainCount = 5;
                const step = Math.max(4, Math.floor(width / 360));
                const beatBoost = Math.pow(clamp(beat, 0, 1), 0.75);
                // Wider speed range so slow/fast change is clearly visible.
                const speedDrive = 0.18 + smoothEnergy * 10.5 + beatBoost * 8.2;

                for (let c = 0; c < curtainCount; c++) {
                    const depth = c / (curtainCount - 1);
                    const baseY = height * (0.18 + depth * 0.22) + smoothBass * 12;
                    const layerMod = 0.9 + c * 0.22;
                    const speed = (0.26 + c * 0.16) * speedDrive * layerMod;
                    acc.northernWave[c] += dt * speed;
                    acc.northernWave2[c] += dt * (speed * 0.78 + 0.06);
                    const freq1 = 0.0068 + c * 0.0014;
                    const freq2 = 0.0102 + c * 0.0022;
                    // Reduced amplitude to avoid mountain-like spikes.
                    const amplitude = 19 + smoothMid * 34 + beat * 12 + c * 6;
                    const alpha = (0.1 + smoothEnergy * 0.16) * (1 - depth * 0.33);

                    const yPoints: number[] = [];
                    const xPoints: number[] = [];
                    for (let x = 0; x <= width; x += step) {
                        const ratio = x / width;
                        const edgeFade = Math.sin(ratio * Math.PI);
                        const wave1 = Math.sin(x * freq1 + acc.northernWave[c]) * amplitude;
                        const wave2 = Math.cos(x * freq2 - acc.northernWave2[c]) * (amplitude * 0.22);
                        const y = baseY + (wave1 + wave2) * edgeFade;
                        yPoints.push(y);
                        xPoints.push(x);
                    }

                    for (let pass = 0; pass < 3; pass++) {
                        const tmp = [...yPoints];
                        for (let i = 1; i < yPoints.length - 1; i++) {
                            yPoints[i] = tmp[i - 1] * 0.24 + tmp[i] * 0.52 + tmp[i + 1] * 0.24;
                        }
                    }
                    // Draw curtain as filled shape with smooth curves
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    if (yPoints.length > 1) {
                        ctx.lineTo(xPoints[0], yPoints[0]);
                        for (let i = 0; i < yPoints.length - 1; i++) {
                            const mx = (xPoints[i] + xPoints[i + 1]) / 2;
                            const my = (yPoints[i] + yPoints[i + 1]) / 2;
                            ctx.quadraticCurveTo(xPoints[i], yPoints[i], mx, my);
                        }
                        ctx.lineTo(xPoints[yPoints.length - 1], yPoints[yPoints.length - 1]);
                    }
                    ctx.lineTo(width, 0);
                    ctx.closePath();

                    const curtainGrad = ctx.createLinearGradient(0, 0, 0, baseY + amplitude * 1.4);
                    curtainGrad.addColorStop(0, colorWithAlpha(accentColor, 0));
                    curtainGrad.addColorStop(0.5, colorWithAlpha(accentColor, alpha * 0.28));
                    curtainGrad.addColorStop(0.85, colorWithAlpha(accentColor, alpha * 0.62));
                    curtainGrad.addColorStop(1, colorWithAlpha(accentColor, alpha * 0.9));
                    ctx.fillStyle = curtainGrad;
                    ctx.fill();

                    ctx.beginPath();
                    if (yPoints.length > 1) {
                        ctx.moveTo(xPoints[0], yPoints[0]);
                        for (let i = 0; i < yPoints.length - 1; i++) {
                            const mx = (xPoints[i] + xPoints[i + 1]) / 2;
                            const my = (yPoints[i] + yPoints[i + 1]) / 2;
                            ctx.quadraticCurveTo(xPoints[i], yPoints[i], mx, my);
                        }
                        ctx.lineTo(xPoints[yPoints.length - 1], yPoints[yPoints.length - 1]);
                    }
                    const edgeGrad = ctx.createLinearGradient(0, 0, width, 0);
                    edgeGrad.addColorStop(0, colorWithAlpha(accentColor, 0));
                    edgeGrad.addColorStop(0.25, colorWithAlpha(accentColor, alpha * 1.5 + smoothEnergy * 0.18));
                    edgeGrad.addColorStop(0.5, colorWithAlpha(nearWhite, alpha * 1.05 + beat * 0.2));
                    edgeGrad.addColorStop(0.75, colorWithAlpha(accentColor, alpha * 1.5 + smoothEnergy * 0.18));
                    edgeGrad.addColorStop(1, colorWithAlpha(accentColor, 0));
                    ctx.strokeStyle = edgeGrad;
                    ctx.lineWidth = 1.1 + smoothEnergy * 1.2 - depth * 0.25;
                    ctx.stroke();
                }

                const reflGrad = ctx.createLinearGradient(0, height * 0.72, 0, height);
                reflGrad.addColorStop(0, colorWithAlpha(accentColor, 0));
                reflGrad.addColorStop(1, colorWithAlpha(accentColor, 0.04 + smoothEnergy * 0.06));
                ctx.fillStyle = reflGrad;
                ctx.fillRect(0, height * 0.72, width, height * 0.28);
            } else if (styleNum === 4) {
                // ── Glass Bars ──
                const sidePadding = width * 0.02;
                const topPadding = height * 0.08;
                const bottomPadding = height * 0.08;
                const clusterHeight = Math.max(180, height - topPadding - bottomPadding);
                const maxBarWidth = Math.max(36, width * 0.085);
                const backLayerWidth = maxBarWidth * 0.62;
                const barsPerCluster = Math.max(18, Math.floor(clusterHeight / 11));
                const gap = Math.max(2, Math.floor(clusterHeight / (barsPerCluster * 5)));
                const totalGap = gap * (barsPerCluster - 1);
                const barHeight = Math.max(3, (clusterHeight - totalGap) / barsPerCluster);

                const leftX = sidePadding;
                const rightX = width - sidePadding;

                const drawVerticalCluster = (isLeft: boolean, sampleOffset: number) => {
                    const startY = (height - clusterHeight) / 2;

                    for (let i = 0; i < barsPerCluster; i++) {
                        const y = startY + i * (barHeight + gap);
                        const ratio = barsPerCluster > 1 ? i / (barsPerCluster - 1) : 0;
                        // Center-out pulse along vertical axis.
                        const centerPulse = 1 - Math.abs(ratio * 2 - 1);
                        const sampleRatio = clamp(sampleOffset + ratio * 0.5, 0, 1);
                        const sample = sampleAtRatio(sampleRatio);
                        const wobble = (Math.sin(now * 4.2 + i * 0.5) * 0.055 + 0.055) * smoothPlaying;
                        const intensity = clamp(sample * 0.82 + centerPulse * 0.36 + smoothEnergy * 0.24 + wobble, 0, 1);

                        const backW = Math.max(4, intensity * backLayerWidth);
                        const frontW = Math.max(6, intensity * maxBarWidth);
                        const radius = Math.min(3.5, barHeight * 0.42);

                        if (isLeft) {
                            // Dual-layer bars grow inward from left edge.
                            ctx.fillStyle = colorWithAlpha(accentColor, 0.14 + intensity * 0.16);
                            drawRoundedRect(ctx, leftX, y, backW, barHeight, radius);
                            ctx.fill();

                            ctx.fillStyle = colorWithAlpha(nearWhite, 0.05 + intensity * 0.08);
                            drawRoundedRect(ctx, leftX, y, frontW, barHeight, radius);
                            ctx.fill();
                            ctx.fillStyle = colorWithAlpha(accentColor, 0.26 + intensity * 0.4);
                            drawRoundedRect(ctx, leftX + 1, y, Math.max(1, frontW - 1), barHeight, radius);
                            ctx.fill();
                        } else {
                            // Dual-layer bars grow inward from right edge.
                            ctx.fillStyle = colorWithAlpha(accentColor, 0.14 + intensity * 0.16);
                            drawRoundedRect(ctx, rightX - backW, y, backW, barHeight, radius);
                            ctx.fill();

                            ctx.fillStyle = colorWithAlpha(nearWhite, 0.05 + intensity * 0.08);
                            drawRoundedRect(ctx, rightX - frontW, y, frontW, barHeight, radius);
                            ctx.fill();
                            ctx.fillStyle = colorWithAlpha(accentColor, 0.26 + intensity * 0.4);
                            drawRoundedRect(ctx, rightX - frontW, y, Math.max(1, frontW - 1), barHeight, radius);
                            ctx.fill();
                        }
                    }
                };

                drawVerticalCluster(true, 0.02);
                drawVerticalCluster(false, 0.5);
            }

            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.lineDashOffset = 0;
            ctx.setLineDash([]);
        };

        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(draw);
    }, []);

    useEffect(() => {
        let cancelled = false;
        envelopeRef.current = null;
        fallbackBandsRef.current = null;
        fallbackFrameCountRef.current = 0;
        fallbackBandCountRef.current = 0;

        const buildEnvelope = async () => {
            try {
                const response = await fetch(src);
                if (!response.ok) return;
                const arrayBuffer = await response.arrayBuffer();
                if (cancelled) return;

                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                const decodeCtx = new AudioContextClass();

                try {
                    const decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
                    if (cancelled) return;

                    const channelCount = decoded.numberOfChannels;
                    if (channelCount < 1) return;

                    const sampleRate = decoded.sampleRate;
                    const totalSamples = decoded.length;
                    const frameRate = 30;
                    const samplesPerFrame = Math.max(512, Math.floor(sampleRate / frameRate));
                    const frameCount = Math.max(1, Math.ceil(totalSamples / samplesPerFrame));
                    const bandCount = 72;

                    const envelope = new Float32Array(frameCount);
                    const fallbackBands = new Float32Array(frameCount * bandCount);

                    const mono = new Float32Array(totalSamples);
                    for (let i = 0; i < totalSamples; i++) {
                        let mixed = 0;
                        for (let ch = 0; ch < channelCount; ch++) {
                            mixed += decoded.getChannelData(ch)[i] ?? 0;
                        }
                        mono[i] = mixed / channelCount;
                    }

                    const bandSums = new Float32Array(bandCount);
                    const bandCounts = new Uint16Array(bandCount);
                    const smoothedBands = new Float32Array(bandCount);
                    let maxEnvelope = 0;
                    let maxBand = 0;

                    for (let frame = 0; frame < frameCount; frame++) {
                        const start = frame * samplesPerFrame;
                        const end = Math.min(start + samplesPerFrame, totalSamples);
                        const frameLength = end - start;
                        if (frameLength <= 0) continue;

                        bandSums.fill(0);
                        bandCounts.fill(0);
                        let sumSq = 0;

                        for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
                            const sample = mono[sampleIndex];
                            const sq = sample * sample;
                            sumSq += sq;

                            const relative = (sampleIndex - start) / frameLength;
                            const bandIndex = Math.min(bandCount - 1, Math.max(0, Math.floor(relative * bandCount)));
                            bandSums[bandIndex] += sq;
                            bandCounts[bandIndex]++;
                        }

                        const frameRms = Math.sqrt(sumSq / frameLength);
                        envelope[frame] = frameRms;
                        if (frameRms > maxEnvelope) maxEnvelope = frameRms;

                        for (let band = 0; band < bandCount; band++) {
                            const count = bandCounts[band];
                            const raw = count > 0 ? Math.sqrt(bandSums[band] / count) : 0;
                            const tilt = 1 - (band / Math.max(1, bandCount - 1)) * 0.32;
                            smoothedBands[band] = raw * tilt;
                        }

                        for (let band = 0; band < bandCount; band++) {
                            const prev = smoothedBands[Math.max(0, band - 1)];
                            const current = smoothedBands[band];
                            const next = smoothedBands[Math.min(bandCount - 1, band + 1)];
                            const smoothed = prev * 0.25 + current * 0.5 + next * 0.25;
                            const prevFrame = frame > 0 ? fallbackBands[(frame - 1) * bandCount + band] : smoothed;
                            const temporal = prevFrame * 0.64 + smoothed * 0.36;
                            fallbackBands[frame * bandCount + band] = temporal;
                            if (temporal > maxBand) maxBand = temporal;
                        }
                    }

                    if (maxEnvelope > 0) {
                        for (let i = 0; i < envelope.length; i++) {
                            envelope[i] = clamp((envelope[i] / maxEnvelope) * 0.82, 0, 1);
                        }
                    }

                    if (maxBand > 0) {
                        for (let i = 0; i < fallbackBands.length; i++) {
                            fallbackBands[i] = clamp((fallbackBands[i] / maxBand) * 0.86, 0, 1);
                        }
                    }

                    if (!cancelled) {
                        envelopeRef.current = envelope;
                        fallbackBandsRef.current = fallbackBands;
                        fallbackFrameCountRef.current = frameCount;
                        fallbackBandCountRef.current = bandCount;
                    }
                } finally {
                    decodeCtx.close().catch(() => undefined);
                }
            } catch {
                envelopeRef.current = null;
                fallbackBandsRef.current = null;
                fallbackFrameCountRef.current = 0;
                fallbackBandCountRef.current = 0;
            }
        };

        void buildEnvelope();

        return () => {
            cancelled = true;
            envelopeRef.current = null;
            fallbackBandsRef.current = null;
            fallbackFrameCountRef.current = 0;
            fallbackBandCountRef.current = 0;
        };
    }, [src]);

    useEffect(() => {
        drawVisualizer(false);
        return () => {
            cancelAnimationFrame(animFrameRef.current);
            cancelAnimationFrame(progressFrameRef.current);
            sourceRef.current?.disconnect();
            analyzerRef.current?.disconnect();
            dataArrayRef.current = null;
            timeDomainDataRef.current = null;
            envelopeRef.current = null;
            fallbackBandsRef.current = null;
            sourceRef.current = null;
            analyzerRef.current = null;
            const ctx = audioContextRef.current;
            if (ctx && ctx.state !== 'closed') {
                ctx.close().catch(() => undefined);
            }
            audioContextRef.current = null;
        };
    }, [drawVisualizer]);



    useEffect(() => {
        globalVolumeRef.current = globalVolume;
        globalMutedRef.current = globalMuted;
        if (audioRef.current) {
            audioRef.current.volume = globalVolume;
            audioRef.current.muted = globalMuted;
        }
    }, [globalVolume, globalMuted]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.loop = isRepeatEnabled;
        }
    }, [isRepeatEnabled]);

    // Resize canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const host = canvas.parentElement;
        if (!host) return;

        const resize = () => {
            const nextWidth = Math.max(1, Math.floor(host.offsetWidth));
            const nextHeight = Math.max(1, Math.floor(host.offsetHeight));
            if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
                canvas.width = nextWidth;
                canvas.height = nextHeight;
            }
        };

        resize();

        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => resize());
            observer.observe(host);
        }

        window.addEventListener('resize', resize);
        return () => {
            window.removeEventListener('resize', resize);
            observer?.disconnect();
        };
    }, []);

    const togglePlay = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;

        // Ensure AudioContext is initialized/resumed on user gesture
        setupAudioContext();

        if (audio.paused) {
            audio.play().catch(e => {
                if (e.name !== 'AbortError') console.warn('Playback failed:', e);
            });
        } else {
            audio.pause();
        }
    }, [setupAudioContext]);

    const skip = (amount: number) => {
        if (audioRef.current) {
            const maxSeek = duration > 0 ? Math.max(0, duration - 0.05) : duration;
            audioRef.current.currentTime = clamp(audioRef.current.currentTime + amount, 0, maxSeek);
        }
    };

    const toggleMute = () => {
        setGlobalMuted(!globalMuted);
    };

    const toggleRepeat = () => {
        setIsRepeatEnabled(!isRepeatEnabled);
    };

    const formatTime = (time: number) => {
        if (!isFinite(time)) return '0:00';
        const m = Math.floor(time / 60);
        const s = Math.floor(time % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        isDraggingRef.current = true;
        const rect = el.getBoundingClientRect();

        const updateProgress = (ev: MouseEvent | React.MouseEvent) => {
            if (!audioRef.current || !isFinite(duration) || duration <= 0) return;
            const pct = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
            const time = pct * duration;
            audioRef.current.currentTime = time;
            setCurrentTime(time);
        };

        updateProgress(e);

        const onMove = (ev: MouseEvent) => updateProgress(ev);
        const onUp = () => {
            isDraggingRef.current = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const handleVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        isVolumeDraggingRef.current = true;
        const el = e.currentTarget;

        const setVolumeFromMouse = (ev: MouseEvent | React.MouseEvent) => {
            const rect = el.getBoundingClientRect();
            const pct = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
            setGlobalVolume(pct);
            if (pct > 0 && globalMuted) setGlobalMuted(false);
            else if (pct === 0 && !globalMuted) setGlobalMuted(true);
        };

        setVolumeFromMouse(e);

        const onMove = (ev: MouseEvent) => setVolumeFromMouse(ev);
        const onUp = () => {
            isVolumeDraggingRef.current = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
    const displayName = fileName.replace(/\.[^.]+$/, '');
    const currentStyle = audioVisualStyle ?? 0;
    const visualStyleName = VISUAL_STYLE_NAMES[clamp(currentStyle, 0, VISUAL_STYLE_NAMES.length - 1)];

    useEffect(() => {
        visualStyleRef.current = currentStyle;
    }, [currentStyle]);

    const cycleVisualStyle = () => {
        const next = (currentStyle + 1) % VISUAL_STYLE_NAMES.length;
        setAudioVisualStyle(next);
    };

    const handleOuterInteraction = () => {
        handleMouseMove();
    };

    return (
        <div
            className={`audio-player-container ${(!controlsVisible && isPlaying) ? 'audio-ui-hidden' : ''}`}
            onMouseMove={handleOuterInteraction}
            onMouseLeave={() => isPlaying && setControlsVisible(false)}
        >
            <audio
                ref={audioRef}
                src={src}
                autoPlay={autoPlay}
                preload="metadata"
                onCanPlay={(e) => {
                    const audio = e.currentTarget;
                    if (autoPlay && audio.paused) {
                        audio.play().catch(err => {
                            if (err.name !== 'AbortError') {
                                console.warn('[AudioPlayer] Autoplay failed:', err);
                            }
                        });
                    }
                }}
                onPlay={() => {
                    setIsPlaying(true);
                    setupAudioContext();
                    drawVisualizer(true);
                }}
                onPause={() => {
                    setIsPlaying(false);
                    drawVisualizer(false);
                }}
                onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onTimeUpdate={(e) => {
                    if (!isDraggingRef.current) {
                        setCurrentTime(e.currentTarget.currentTime);
                    }
                }}
                onEnded={() => {
                    if (isRepeatEnabled && audioRef.current) {
                        audioRef.current.currentTime = 0;
                        audioRef.current.play().catch(() => { });
                    } else {
                        setIsPlaying(false);
                        drawVisualizer(false);
                    }
                }}
            />

            {/* Visualizer */}
            <div className="audio-visualizer">
                <canvas ref={canvasRef} className="audio-visualizer-canvas" />
                <div className="audio-center-info">
                    <div className="audio-icon-pulse">
                        <div className={`audio-icon-ring ${isPlaying ? 'audio-icon-ring--playing' : ''}`} />
                        <div className="audio-icon-inner">
                            <Music size={32} strokeWidth={2.15} />
                        </div>
                    </div>
                    <div className="audio-track-name">{displayName}</div>
                </div>
                <div className="audio-visualizer-style-name">{visualStyleName}</div>
                <button
                    className="audio-visualizer-toggle"
                    onClick={cycleVisualStyle}
                    title={`Style: ${visualStyleName}`}
                >
                    <Activity size={18} />
                </button>
            </div>

            {/* Controls */}
            <div className="audio-controls">
                <div className="audio-progress-container" onMouseDown={handleProgressMouseDown}>
                    <div className="audio-progress-bg" />
                    <div className="audio-progress-filled" style={{ width: `${progressPct}%` }} />
                    <div className="audio-progress-knob" style={{ left: `${progressPct}%` }} />
                </div>

                <div className="audio-bottom-bar">
                    <div className="audio-controls-left">
                        <button className="audio-btn" onClick={() => skip(-10)}>
                            <SkipBack size={16} />
                        </button>
                        <button className="audio-btn audio-btn--play" onClick={togglePlay}>
                            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                        </button>
                        <button className="audio-btn" onClick={() => skip(10)}>
                            <SkipForward size={16} />
                        </button>
                        <button
                            className={`audio-btn ${isRepeatEnabled ? 'audio-btn--active' : ''}`}
                            onClick={toggleRepeat}
                            title={isRepeatEnabled ? 'Disable repeat' : 'Enable repeat'}
                        >
                            <Repeat size={16} />
                        </button>
                        <div className="audio-time">
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </div>
                    </div>

                    <div className="audio-controls-right">
                        <div className="audio-volume-container">
                            <button className="audio-btn" onClick={toggleMute}>
                                {globalMuted || globalVolume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                            </button>
                            <div className="audio-volume-progress-container" onMouseDown={handleVolumeMouseDown}>
                                <div className="audio-progress-bg" />
                                <div
                                    className="audio-progress-filled"
                                    style={{ width: `${(globalMuted ? 0 : globalVolume) * 100}%` }}
                                />
                                <div
                                    className="audio-progress-knob"
                                    style={{ left: `${(globalMuted ? 0 : globalVolume) * 100}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

