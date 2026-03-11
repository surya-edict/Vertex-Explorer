import { invoke } from '@tauri-apps/api/core';

/**
 * Performs a paste operation with conflict detection.
 * If any files already exist at the destination, prompts the user with a 
 * confirm dialog (Replace / Skip).
 */
let isPasting = false;

export async function pasteWithConflictCheck(
    sources: string[],
    dest: string,
    action: 'copy' | 'cut',
    opts?: {
        onSuccess?: () => void;
        onClearClipboard?: () => void;
    }
) {
    if (sources.length === 0) return;
    if (isPasting) {
        console.warn('[Paste] Paste already in progress, skipping...');
        return;
    }
    isPasting = true;

    const cmd = action === 'cut' ? 'move_items' : 'copy_items';

    // Check for conflicts
    const conflicts = await invoke<string[]>('check_paste_conflicts', { sources, dest });

    if (conflicts.length > 0) {
        // Show confirm dialog via the global window function
        const conflictNames = conflicts.length <= 3
            ? conflicts.join(', ')
            : `${conflicts.slice(0, 3).join(', ')} and ${conflicts.length - 3} more`;

        const msg = conflicts.length === 1
            ? `"${conflicts[0]}" already exists in this folder.\nDo you want to replace it?`
            : `${conflicts.length} items already exist in this folder:\n${conflictNames}\n\nDo you want to replace them?`;

        (window as any).__explorerConfirmDialog?.({
            title: 'Replace Existing Files',
            message: msg,
            type: 'warning' as const,
            confirmLabel: 'Replace',
            onConfirm: async () => {
                try {
                    await invoke(cmd, { sources, dest, overwrite: true });
                    opts?.onSuccess?.();
                    opts?.onClearClipboard?.();
                } catch (err) {
                    console.error(`[Paste] Overwrite failed:`, err);
                } finally {
                    isPasting = false;
                }
            },
            onCancel: () => {
                isPasting = false;
            }
        });
    } else {
        // No conflicts, paste directly
        try {
            await invoke(cmd, { sources, dest, overwrite: false });
            opts?.onSuccess?.();
            opts?.onClearClipboard?.();
        } catch (err) {
            console.error(`[Paste] Failed:`, err);
        } finally {
            isPasting = false;
        }
    }
}
