import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Check } from 'lucide-react';
import { FileEntry } from '../../hooks/useDirectory';
import './BatchRename.css';

type PatternType = 'Sequential' | 'Prefix' | 'Suffix' | 'Replace' | 'InsertDate' | 'ChangeExt';

interface RenameResult { original: string; preview: string; conflict: boolean; }

interface Props {
    files: FileEntry[];
    onClose: () => void;
    onDone: () => void;
}

export function BatchRename({ files, onClose, onDone }: Props) {
    const [pattern, setPattern] = useState<PatternType>('Sequential');
    const [prefix, setPrefix] = useState('');
    const [suffix, setSuffix] = useState('');
    const [search, setSearch] = useState('');
    const [replace, setReplace] = useState('');
    const [startNum, setStartNum] = useState(1);
    const [newExt, setNewExt] = useState('');
    const [previews, setPreviews] = useState<RenameResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [applied, setApplied] = useState(false);

    const getPatternPayload = () => {
        switch (pattern) {
            case 'Sequential': return { Sequential: { prefix, start_number: startNum, padding: 3 } };
            case 'Prefix': return { Prefix: { prefix } };
            case 'Suffix': return { Suffix: { suffix } };
            case 'Replace': return { Replace: { search, replacement: replace } };
            case 'InsertDate': return { InsertDate: { position: 'Prefix' } };
            case 'ChangeExt': return { ChangeExt: { new_extension: newExt } };
            default: return { Sequential: { prefix: '', start_number: 1, padding: 3 } };
        }
    };

    const doPreview = async () => {
        const names = files.map(f => f.name);
        try {
            const results = await invoke<RenameResult[]>('preview_rename', {
                fileNames: names,
                pattern: getPatternPayload(),
            });
            setPreviews(results);
        } catch (e) { console.error(e); }
    };

    const doApply = async () => {
        setLoading(true);
        try {
            await invoke('apply_rename', {
                filePaths: files.map(f => f.path),
                pattern: getPatternPayload(),
            });
            setApplied(true);
            setTimeout(() => { onDone(); onClose(); }, 800);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    };

    const PATTERNS: { id: PatternType; label: string }[] = [
        { id: 'Sequential', label: 'Sequential' },
        { id: 'Prefix', label: 'Add Prefix' },
        { id: 'Suffix', label: 'Add Suffix' },
        { id: 'Replace', label: 'Find & Replace' },
        { id: 'InsertDate', label: 'Insert Date' },
        { id: 'ChangeExt', label: 'Change Extension' },
    ];

    return (
        <div className="batchrename-overlay" onMouseDown={onClose}>
            <div className="batchrename anim-scale" onMouseDown={e => e.stopPropagation()}>
                <div className="batchrename-header">
                    <span className="batchrename-title">Batch Rename — {files.length} items</span>
                    <button className="batchrename-close" onClick={onClose}><X size={14} /></button>
                </div>

                {/* Pattern selector */}
                <div className="batchrename-patterns">
                    {PATTERNS.map(p => (
                        <button key={p.id} className={`batchrename-pattern ${pattern === p.id ? 'batchrename-pattern--active' : ''}`}
                            onClick={() => setPattern(p.id)}>{p.label}</button>
                    ))}
                </div>

                {/* Options */}
                <div className="batchrename-options">
                    {pattern === 'Sequential' && (
                        <>
                            <label className="batchrename-field">
                                <span>Base Name</span>
                                <input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="e.g. Photo" className="batchrename-input" />
                            </label>
                            <label className="batchrename-field">
                                <span>Start #</span>
                                <input type="number" value={startNum} onChange={e => setStartNum(Number(e.target.value))} className="batchrename-input batchrename-input--sm" />
                            </label>
                        </>
                    )}
                    {pattern === 'Prefix' && (
                        <label className="batchrename-field">
                            <span>Prefix</span>
                            <input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="text to add at start" className="batchrename-input" />
                        </label>
                    )}
                    {pattern === 'Suffix' && (
                        <label className="batchrename-field">
                            <span>Suffix</span>
                            <input value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="text to add at end" className="batchrename-input" />
                        </label>
                    )}
                    {pattern === 'Replace' && (
                        <>
                            <label className="batchrename-field">
                                <span>Find</span>
                                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="search text" className="batchrename-input" />
                            </label>
                            <label className="batchrename-field">
                                <span>Replace</span>
                                <input value={replace} onChange={e => setReplace(e.target.value)} placeholder="replacement" className="batchrename-input" />
                            </label>
                        </>
                    )}
                    {pattern === 'ChangeExt' && (
                        <label className="batchrename-field">
                            <span>New Extension</span>
                            <input value={newExt} onChange={e => setNewExt(e.target.value)} placeholder="e.g. jpg" className="batchrename-input batchrename-input--sm" />
                        </label>
                    )}
                    {pattern === 'InsertDate' && <p className="batchrename-hint">Will prepend today's date (YYYY-MM-DD) to each file name.</p>}
                    <button className="batchrename-preview-btn" onClick={doPreview}>Preview</button>
                </div>

                {/* Preview list */}
                {previews.length > 0 && (
                    <div className="batchrename-preview-list">
                        {previews.map((p, i) => (
                            <div key={i} className={`batchrename-preview-row ${p.conflict ? 'batchrename-preview-row--conflict' : ''}`}>
                                <span className="batchrename-original">{p.original}</span>
                                <span className="batchrename-arrow">→</span>
                                <span className="batchrename-new">{p.preview}</span>
                                {p.conflict && <span className="batchrename-conflict-badge">conflict</span>}
                            </div>
                        ))}
                    </div>
                )}

                <div className="batchrename-footer">
                    <button className="batchrename-cancel-btn" onClick={onClose}>Cancel</button>
                    <button
                        className={`batchrename-apply-btn ${applied ? 'batchrename-apply-btn--done' : ''}`}
                        onClick={doApply}
                        disabled={loading || previews.length === 0}
                    >
                        {applied ? <><Check size={13} /> Done!</> : loading ? 'Applying…' : 'Apply Rename'}
                    </button>
                </div>
            </div>
        </div>
    );
}
