import { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import './PdfPreview.css';

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
).toString();

interface Props {
    src: string; // asset URL from convertFileSrc
}

export function PdfPreview({ src }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [pageCount, setPageCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function renderPdf() {
            setLoading(true);
            setError(null);

            try {
                const pdf = await pdfjsLib.getDocument(src).promise;
                if (cancelled) return;

                setPageCount(pdf.numPages);
                const container = containerRef.current;
                if (!container) return;
                container.innerHTML = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    if (cancelled) return;

                    // Render at 1.5x scale for sharpness
                    const scale = 1.5;
                    const viewport = page.getViewport({ scale });

                    const canvas = document.createElement('canvas');
                    canvas.className = 'pdf-page-canvas';
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    canvas.style.width = `${viewport.width / scale}px`;
                    canvas.style.height = `${viewport.height / scale}px`;

                    container.appendChild(canvas);

                    const ctx = canvas.getContext('2d')!;
                    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
                }

                setLoading(false);
            } catch (err) {
                if (!cancelled) {
                    setError('Failed to load PDF. The file may be corrupted or password-protected.');
                    setLoading(false);
                }
            }
        }

        renderPdf();
        return () => { cancelled = true; };
    }, [src]);

    return (
        <div className="pdf-preview">
            {loading && (
                <div className="pdf-loading">
                    <div className="pdf-spinner" />
                    <span>Rendering PDF…</span>
                </div>
            )}
            {error && (
                <div className="pdf-error">
                    <div className="pdf-error-icon">📄</div>
                    <div>{error}</div>
                </div>
            )}
            <div ref={containerRef} className="pdf-pages" />
            {pageCount > 0 && !loading && (
                <div className="pdf-page-badge">{pageCount} page{pageCount !== 1 ? 's' : ''}</div>
            )}
        </div>
    );
}
