import { useState, useEffect, useRef } from 'react';
import { FolderPlus, FilePlus, X, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './InputDialog.css';

interface InputDialogProps {
    isOpen: boolean;
    title: string;
    type: 'folder' | 'file' | 'rename';
    initialValue?: string;
    onClose: () => void;
    onSubmit: (value: string) => void;
}

export function InputDialog({ isOpen, title, type, initialValue = '', onClose, onSubmit }: InputDialogProps) {
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setValue(initialValue);
            setTimeout(() => inputRef.current?.focus(), 50);

            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose();
                }
            };
            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        }
    }, [isOpen, initialValue, onClose]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (value.trim()) {
            onSubmit(value.trim());
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="input-dialog-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    onClick={onClose}
                >
                    <motion.div
                        className="input-dialog-container"
                        initial={{ scale: 0.95, opacity: 0, y: -20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: -20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="input-dialog-header">
                            <div className="input-dialog-title">
                                {type === 'folder' ? <FolderPlus size={16} /> : type === 'rename' ? <Pencil size={16} /> : <FilePlus size={16} />}
                                <span>{title}</span>
                            </div>
                            <button className="input-dialog-close" onClick={onClose}>
                                <X size={16} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="input-dialog-body">
                            <input
                                ref={inputRef}
                                type="text"
                                className="input-dialog-input"
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                placeholder={type === 'folder' ? 'New Folder' : 'New Document.txt'}
                                spellCheck={false}
                            />
                            <div className="input-dialog-footer">
                                <button type="button" className="input-dialog-btn secondary" onClick={onClose}>
                                    Cancel
                                </button>
                                <button type="submit" className="input-dialog-btn primary" disabled={!value.trim()}>
                                    {type === 'rename' ? 'Rename' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
