import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import mammoth from 'mammoth';
import './DocxPreview.css';

interface Props {
    filePath: string;
}

export function DocxPreview({ filePath }: Props) {
    const [html, setHtml] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadDocx() {
            setLoading(true);
            setError(null);
            setHtml(null);

            try {
                const base64: string = await invoke('read_file_as_base64', { path: filePath });

                // Convert base64 to ArrayBuffer
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }

                const result = await mammoth.convertToHtml(
                    { arrayBuffer: bytes.buffer },
                    {
                        styleMap: [
                            "p[style-name='Title'] => h1.doc-title",
                            "p[style-name='Heading 1'] => h1",
                            "p[style-name='Heading 2'] => h2",
                            "p[style-name='Heading 3'] => h3",
                        ]
                    }
                );

                if (!cancelled) {
                    setHtml(result.value);
                    setLoading(false);
                }
            } catch (err) {
                if (!cancelled) {
                    setError('Failed to parse DOCX file. It may be corrupted or in an unsupported format.');
                    setLoading(false);
                }
            }
        }

        loadDocx();
        return () => { cancelled = true; };
    }, [filePath]);

    return (
        <div className="docx-preview">
            {loading && (
                <div className="docx-loading">
                    <div className="docx-spinner" />
                    <span>Loading document…</span>
                </div>
            )}
            {error && (
                <div className="docx-error">
                    <div className="docx-error-icon">📝</div>
                    <div>{error}</div>
                </div>
            )}
            {html && (
                <div
                    className="docx-content"
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            )}
        </div>
    );
}
