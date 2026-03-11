import { FileEntry } from '../hooks/useDirectory';
import { IMAGE_EXTS, VIDEO_EXTS } from './fileTypes';

export interface FileGroup {
    label: string;
    files: FileEntry[];
}

const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma']);

/**
 * Groups files into logical sections: Folders, Images, Videos, Audio, Documents, Others.
 * Returns groups in display order, omitting empty groups.
 */
export function groupFilesByType(files: FileEntry[]): FileGroup[] {
    const folders: FileEntry[] = [];
    const images: FileEntry[] = [];
    const videos: FileEntry[] = [];
    const audio: FileEntry[] = [];
    const others: FileEntry[] = [];

    for (const f of files) {
        if (f.is_dir) {
            folders.push(f);
        } else {
            const ext = (f.extension || '').toLowerCase();
            if (IMAGE_EXTS.has(ext)) images.push(f);
            else if (VIDEO_EXTS.has(ext)) videos.push(f);
            else if (AUDIO_EXTS.has(ext)) audio.push(f);
            else others.push(f);
        }
    }

    const groups: FileGroup[] = [];
    if (folders.length) groups.push({ label: 'Folders', files: folders });
    if (images.length) groups.push({ label: 'Images', files: images });
    if (videos.length) groups.push({ label: 'Videos', files: videos });
    if (audio.length) groups.push({ label: 'Audio', files: audio });
    if (others.length) groups.push({ label: 'Others', files: others });

    return groups;
}
