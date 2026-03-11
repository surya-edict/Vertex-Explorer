import { useEffect, useRef } from 'react';
import { AlertTriangle, X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    type?: 'danger' | 'warning' | 'info';
    onClose: () => void;
    onConfirm: () => void;
}

export function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    type = 'warning',
    onClose,
    onConfirm
}: ConfirmDialogProps) {
    const confirmBtnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => confirmBtnRef.current?.focus(), 50);

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
    }, [isOpen, onClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="confirm-dialog-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    onClick={onClose}
                >
                    <motion.div
                        className="confirm-dialog-container"
                        initial={{ scale: 0.95, opacity: 0, y: -20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: -20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="confirm-dialog-header">
                            <div className={`confirm-dialog-title type-${type}`}>
                                {type === 'danger' ? <Trash2 size={16} /> : <AlertTriangle size={16} />}
                                <span>{title}</span>
                            </div>
                            <button className="confirm-dialog-close" onClick={onClose}>
                                <X size={16} />
                            </button>
                        </div>
                        <div className="confirm-dialog-body">
                            <p>{message}</p>
                            <div className="confirm-dialog-footer">
                                <button type="button" className="confirm-dialog-btn secondary" onClick={onClose}>
                                    {cancelLabel}
                                </button>
                                <button
                                    ref={confirmBtnRef}
                                    type="button"
                                    className={`confirm-dialog-btn primary ${type === 'danger' ? 'danger' : ''}`}
                                    onClick={onConfirm}
                                >
                                    {confirmLabel}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
