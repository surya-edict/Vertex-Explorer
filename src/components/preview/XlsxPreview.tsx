import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as XLSX from 'xlsx';
import './XlsxPreview.css';

interface Props {
    filePath: string;
}

export function XlsxPreview({ filePath }: Props) {
    const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[]>([]);
    const [activeSheet, setActiveSheet] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadXlsx() {
            setLoading(true);
            setError(null);
            setSheets([]);

            try {
                const base64: string = await invoke('read_file_as_base64', { path: filePath });

                const workbook = XLSX.read(base64, { type: 'base64' });

                const parsed = workbook.SheetNames.map(name => {
                    const sheet = workbook.Sheets[name];
                    const json = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
                    // Cap at 500 rows for preview performance
                    return { name, rows: json.slice(0, 500) as string[][] };
                });

                if (!cancelled) {
                    setSheets(parsed);
                    setActiveSheet(0);
                    setLoading(false);
                }
            } catch (err) {
                if (!cancelled) {
                    setError('Failed to parse spreadsheet. It may be corrupted or password-protected.');
                    setLoading(false);
                }
            }
        }

        loadXlsx();
        return () => { cancelled = true; };
    }, [filePath]);

    const current = sheets[activeSheet];

    return (
        <div className="xlsx-preview">
            {loading && (
                <div className="xlsx-loading">
                    <div className="xlsx-spinner" />
                    <span>Loading spreadsheet…</span>
                </div>
            )}
            {error && (
                <div className="xlsx-error">
                    <div className="xlsx-error-icon">📊</div>
                    <div>{error}</div>
                </div>
            )}
            {sheets.length > 1 && (
                <div className="xlsx-sheet-tabs">
                    {sheets.map((s, i) => (
                        <button
                            key={s.name}
                            className={`xlsx-sheet-tab ${i === activeSheet ? 'xlsx-sheet-tab--active' : ''}`}
                            onClick={() => setActiveSheet(i)}
                        >
                            {s.name}
                        </button>
                    ))}
                </div>
            )}
            {current && current.rows.length > 0 && (
                <div className="xlsx-table-wrapper">
                    <table className="xlsx-table">
                        <thead>
                            <tr>
                                <th className="xlsx-row-num">#</th>
                                {current.rows[0].map((_, ci) => (
                                    <th key={ci}>{String.fromCharCode(65 + (ci % 26))}{ci >= 26 ? String.fromCharCode(65 + Math.floor(ci / 26) - 1) : ''}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {current.rows.map((row, ri) => (
                                <tr key={ri}>
                                    <td className="xlsx-row-num">{ri + 1}</td>
                                    {row.map((cell, ci) => (
                                        <td key={ci}>{String(cell)}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {current && current.rows.length === 0 && !loading && (
                <div className="xlsx-error">
                    <div className="xlsx-error-icon">📊</div>
                    <div>Sheet is empty</div>
                </div>
            )}
        </div>
    );
}
