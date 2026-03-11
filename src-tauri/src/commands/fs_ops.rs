use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

const PREFETCH_MAX: usize = 32;

lazy_static::lazy_static! {
    static ref DIR_PREFETCH_CACHE: Mutex<HashMap<String, Vec<FileEntry>>> = Mutex::new(HashMap::new());
}

/// On Windows, converts a path to extended-length format (\\?\...) to bypass
/// the 260-character MAX_PATH limitation. Returns the path unchanged on other OSes.
fn win_long_path(p: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let s = p.to_string_lossy();
        if s.starts_with("\\\\?\\") {
            return p.to_path_buf();
        }
        // Convert to absolute if relative
        let abs = if p.is_absolute() {
            p.to_path_buf()
        } else {
            std::env::current_dir().unwrap_or_default().join(p)
        };
        PathBuf::from(format!("\\\\?\\{}", abs.to_string_lossy()))
    }
    #[cfg(not(target_os = "windows"))]
    {
        p.to_path_buf()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
    pub created: u64,
    pub is_dir: bool,
    pub extension: String,
    pub hidden: bool,
    pub symlink: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DriveInfo {
    pub letter: String,
    pub label: String,
    pub total: u64,
    pub free: u64,
    pub drive_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemPaths {
    pub home: String,
    pub desktop: String,
    pub downloads: String,
    pub documents: String,
    pub pictures: String,
    pub music: String,
    pub videos: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileMetadata {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
    pub created: u64,
    pub is_dir: bool,
    pub extension: String,
    pub hidden: bool,
    pub symlink: bool,
    pub readonly: bool,
    pub attributes: u32,
}

fn get_unix_ms(st: std::time::SystemTime) -> u64 {
    st.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_hidden(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        if let Ok(meta) = fs::metadata(path) {
            return meta.file_attributes() & 0x2 != 0; // FILE_ATTRIBUTE_HIDDEN
        }
    }
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        return name.starts_with('.');
    }
    false
}

#[tauri::command]
pub async fn prefetch_directory(path: String) {
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(cache) = DIR_PREFETCH_CACHE.lock() {
            if cache.contains_key(&path) { return; }
        }
        if let Ok(result) = read_dir_sync(&path) {
            if let Ok(mut cache) = DIR_PREFETCH_CACHE.lock() {
                if cache.len() >= PREFETCH_MAX {
                    let first_key = cache.keys().next().cloned();
                    if let Some(k) = first_key { cache.remove(&k); }
                }
                cache.insert(path, result);
            }
        }
    });
}

fn read_dir_sync(path: &str) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut files = Vec::with_capacity(1024);
    for entry in entries.flatten() {
        let p = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let file_type = entry.file_type().unwrap_or(meta.file_type());
        let os_name = entry.file_name();
        let name = os_name.to_string_lossy().to_string();
        let is_dir = file_type.is_dir();
        let is_file = file_type.is_file();
        let ext = if is_file {
            Path::new(&os_name).extension().unwrap_or_default().to_string_lossy().to_lowercase()
        } else { String::new() };
        let symlink = file_type.is_symlink();
        #[cfg(target_os = "windows")]
        let hidden = { use std::os::windows::fs::MetadataExt; (meta.file_attributes() & 0x2) != 0 };
        #[cfg(not(target_os = "windows"))]
        let hidden = name.starts_with('.');
        files.push(FileEntry {
            name, path: p.to_string_lossy().to_string(),
            size: if is_file { meta.len() } else { 0 },
            modified: get_unix_ms(meta.modified().unwrap_or(UNIX_EPOCH)),
            created: get_unix_ms(meta.created().unwrap_or(UNIX_EPOCH)),
            is_dir, extension: ext, hidden, symlink,
        });
    }
    Ok(files)
}

#[tauri::command]
pub async fn read_dir(path: String) -> Result<Vec<FileEntry>, String> {
    if path == "shell:RecycleBinFolder" {
        return tauri::async_runtime::spawn_blocking(move || read_recycle_bin())
            .await
            .unwrap_or_else(|e| Err(e.to_string()));
    }

    if let Ok(mut cache) = DIR_PREFETCH_CACHE.lock() {
        if let Some(cached) = cache.remove(&path) {
            return Ok(cached);
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
        let mut files = Vec::with_capacity(1024);
        for entry in entries.flatten() {
            let p = entry.path();
            
            // On Windows, entry.metadata() frequently avoids a syscall by reading WIN32_FIND_DATA
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            
            let file_type = entry.file_type().unwrap_or(meta.file_type());
            let os_name = entry.file_name();
            let name = os_name.to_string_lossy().to_string();
            
            let is_dir = file_type.is_dir();
            let is_file = file_type.is_file();
            
            let ext = if is_file {
                Path::new(&os_name)
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase()
            } else {
                String::new()
            };
            
            let symlink = file_type.is_symlink();
            
            #[cfg(target_os = "windows")]
            let hidden = {
                use std::os::windows::fs::MetadataExt;
                (meta.file_attributes() & 0x2) != 0 // FILE_ATTRIBUTE_HIDDEN
            };
            #[cfg(not(target_os = "windows"))]
            let hidden = name.starts_with('.');

            files.push(FileEntry {
                name,
                path: p.to_string_lossy().to_string(),
                size: if is_file { meta.len() } else { 0 },
                modified: get_unix_ms(meta.modified().unwrap_or(UNIX_EPOCH)),
                created: get_unix_ms(meta.created().unwrap_or(UNIX_EPOCH)),
                is_dir,
                extension: ext,
                hidden,
                symlink,
            });
        }
        Ok(files)
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

fn read_recycle_bin() -> Result<Vec<FileEntry>, String> {
    let mut files = Vec::new();
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile", "-Command",
            "$rb = (New-Object -ComObject Shell.Application).NameSpace(10); $items = $rb.Items(); if ($items.Count -gt 0) { @($items) | Select-Object -Property Path, Name, Size, IsFolder | ConvertTo-Json -Compress }"
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            if let Ok(arr) = serde_json::from_str::<serde_json::Value>(trimmed) {
                let items = if arr.is_array() {
                    arr.as_array().cloned().unwrap_or_default()
                } else {
                    vec![arr]
                };
                for item in items {
                    let p_str = item["Path"].as_str().unwrap_or("").to_string();
                    let name = item["Name"].as_str().unwrap_or("").to_string();
                    let size = item["Size"].as_u64().unwrap_or(0);
                    let is_dir = item["IsFolder"].as_bool().unwrap_or(false);
                    let ext = if !is_dir {
                        if let Some(pos) = name.rfind('.') {
                            name[pos + 1..].to_lowercase()
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };

                    let p = Path::new(&p_str);
                    let meta = fs::metadata(&p).ok();
                    let modified = meta
                        .as_ref()
                        .map(|m| get_unix_ms(m.modified().unwrap_or(UNIX_EPOCH)))
                        .unwrap_or(0);
                    let created = meta
                        .as_ref()
                        .map(|m| get_unix_ms(m.created().unwrap_or(UNIX_EPOCH)))
                        .unwrap_or(0);

                    files.push(FileEntry {
                        name,
                        path: p_str.clone(),
                        size,
                        modified,
                        created,
                        is_dir,
                        extension: ext,
                        hidden: false,
                        symlink: false,
                    });
                }
            }
        }
    }
    Ok(files)
}

#[tauri::command]
pub async fn get_folder_size(path: String) -> u64 {
    if path == "shell:RecycleBinFolder" {
        return 0;
    }
    tauri::async_runtime::spawn_blocking(move || {
        walkdir::WalkDir::new(&path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| e.metadata().ok())
            .map(|m| m.len())
            .sum()
    })
    .await
    .unwrap_or(0)
}

/// Returns a list of filenames that already exist at the destination.
/// The frontend uses this to show a "Replace or Skip" dialog before pasting.
#[tauri::command]
pub fn check_paste_conflicts(sources: Vec<String>, dest: String) -> Vec<String> {
    let dest_str = if dest.len() == 2 && dest.ends_with(':') {
        format!("{}\\", dest)
    } else {
        dest
    };
    let dest_path = Path::new(&dest_str);
    let mut conflicts = Vec::new();
    for src in &sources {
        let src_path = Path::new(src);
        if !src_path.exists() {
            continue;
        }
        if let Some(name) = src_path.file_name() {
            let target = dest_path.join(name);
            if target.exists() {
                let canon_src = fs::canonicalize(src_path).unwrap_or(src_path.to_path_buf());
                let canon_target = fs::canonicalize(&target).unwrap_or(target.clone());
                // If it's the exact same file, it's not a conflict, it's an in-place duplication/move request!
                if canon_src != canon_target {
                    conflicts.push(name.to_string_lossy().to_string());
                }
            }
        }
    }
    conflicts
}

#[tauri::command]
pub fn copy_items(
    sources: Vec<String>,
    dest: String,
    overwrite: Option<bool>,
) -> Result<(), String> {
    let dest_str = if dest.len() == 2 && dest.ends_with(':') {
        format!("{}\\", dest)
    } else {
        dest
    };
    let dest_path = Path::new(&dest_str);
    let do_overwrite = overwrite.unwrap_or(false);
    eprintln!(
        "[copy_items] dest={:?}, sources={:?}, overwrite={}",
        dest_str, sources, do_overwrite
    );

    if !dest_path.exists() {
        return Err(format!("Destination does not exist: {}", dest_str));
    }

    let canon_dest = fs::canonicalize(dest_path).unwrap_or(dest_path.to_path_buf());

    for src in &sources {
        let src_path = Path::new(src);

        if !src_path.exists() {
            return Err(format!("Source file not found: {}", src));
        }

        let canon_src = fs::canonicalize(src_path).unwrap_or(src_path.to_path_buf());

        // Skip: trying to copy a directory into itself (dest is inside source)
        if src_path.is_dir() && canon_dest.starts_with(&canon_src) {
            eprintln!("[copy_items] skipping: dest is inside source ({})", src);
            continue;
        }

        let name = src_path
            .file_name()
            .ok_or(format!("Invalid source path: {}", src))?;
        let mut target = dest_path.join(name);

        let canon_target = fs::canonicalize(&target).unwrap_or(target.clone());
        if canon_src == canon_target && target.exists() {
            // It's the exact same file. We generate a " - Copy" name automatically!
            target = generate_copy_name(src_path);
        } else {
            // If target already exists, skip unless overwrite is true
            if target.exists() && !do_overwrite {
                eprintln!("[copy_items] skipping existing: {}", target.display());
                continue;
            }
        }

        let long_src = win_long_path(src_path);
        let long_target = win_long_path(&target);

        if src_path.is_dir() {
            // For overwrite on dirs, remove existing first
            if target.exists() && do_overwrite {
                let _ = fs::remove_dir_all(win_long_path(&target));
            }
            let canon_target = fs::canonicalize(&target).unwrap_or(target.clone());
            copy_dir_all(&long_src, &long_target, Some(&canon_target))
                .map_err(|e| format!("Dir copy failed ({} -> {}): {}", src, target.display(), e))?;
        } else {
            fs::copy(&long_src, &long_target).map_err(|e| {
                format!("File copy failed ({} -> {}): {}", src, target.display(), e)
            })?;
        }
    }
    Ok(())
}

/// Generates a unique "Copy" name for a file/folder, Windows-style.
/// e.g. "photo.jpg" -> "photo - Copy.jpg" -> "photo - Copy (2).jpg" -> ...
/// e.g. "MyFolder"  -> "MyFolder - Copy"  -> "MyFolder - Copy (2)"  -> ...
fn generate_copy_name(original: &Path) -> PathBuf {
    let parent = original.parent().unwrap_or(Path::new("."));
    let stem = original
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = original
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let is_dir = original.is_dir();

    // For directories, there's no extension split, use the full name
    let (base_name, suffix) = if is_dir {
        let full = original
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        (full, String::new())
    } else {
        (stem, ext)
    };

    // First try: "name - Copy.ext"
    let first = parent.join(format!("{} - Copy{}", base_name, suffix));
    if !first.exists() {
        return first;
    }

    // Then try: "name - Copy (2).ext", "name - Copy (3).ext", ...
    for i in 2..1000 {
        let candidate = parent.join(format!("{} - Copy ({}){}", base_name, i, suffix));
        if !candidate.exists() {
            return candidate;
        }
    }

    // Fallback: timestamp-based
    let ts = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    parent.join(format!("{} - Copy {}{}", base_name, ts, suffix))
}

/// Recursively copy a directory. `skip_canon` is the canonical path of the
/// target directory itself — any child entry matching it is skipped to prevent
/// infinite recursion when the target is created inside the source.
fn copy_dir_all(src: &Path, dst: &Path, skip_canon: Option<&PathBuf>) -> std::io::Result<()> {
    let long_dst = win_long_path(dst);
    fs::create_dir_all(&long_dst)?;
    let long_src = win_long_path(src);
    for entry in fs::read_dir(&long_src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let entry_path = entry.path();

        // Skip if this child IS the target directory (prevents infinite recursion)
        if let Some(skip) = skip_canon {
            if let Ok(canon_entry) = fs::canonicalize(&entry_path) {
                if canon_entry == *skip {
                    continue;
                }
            }
        }

        let child_dst = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry_path, &child_dst, skip_canon)?;
        } else {
            let long_child_dst = win_long_path(&child_dst);
            fs::copy(entry_path, &long_child_dst)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn move_items(
    sources: Vec<String>,
    dest: String,
    overwrite: Option<bool>,
) -> Result<(), String> {
    let dest_str = if dest.len() == 2 && dest.ends_with(':') {
        format!("{}\\", dest)
    } else {
        dest
    };
    let do_overwrite = overwrite.unwrap_or(false);
    let dest_path = Path::new(&dest_str);
    for src in &sources {
        let src_path = Path::new(src);
        let name = src_path
            .file_name()
            .ok_or(format!("Invalid source path: {}", src))?;
        let target = dest_path.join(name);

        let canon_src = fs::canonicalize(src_path).unwrap_or(src_path.to_path_buf());
        let canon_target = fs::canonicalize(&target).unwrap_or(target.clone());
        if canon_src == canon_target && target.exists() {
            eprintln!(
                "[move_items] skipping: source and target are exactly the same file ({})",
                src
            );
            continue;
        }

        // If target already exists, skip unless overwrite is true
        if target.exists() && !do_overwrite {
            continue;
        }

        // If overwrite, remove existing target first
        if target.exists() && do_overwrite {
            if target.is_dir() {
                let _ = fs::remove_dir_all(win_long_path(&target));
            } else {
                let _ = fs::remove_file(win_long_path(&target));
            }
        }

        // Try simple rename first (same drive, fast)
        if fs::rename(src_path, &target).is_err() {
            let long_src = win_long_path(src_path);
            let long_target = win_long_path(&target);

            // Cross-device: copy then delete
            if src_path.is_dir() {
                copy_dir_all(&long_src, &long_target, None).map_err(|e| {
                    format!(
                        "Cross-drive dir copy failed ({} -> {}): {}",
                        src,
                        target.display(),
                        e
                    )
                })?;
                fs::remove_dir_all(&long_src)
                    .map_err(|e| format!("Cross-drive dir delete failed ({}): {}", src, e))?;
            } else {
                fs::copy(&long_src, &long_target).map_err(|e| {
                    format!(
                        "Cross-drive file copy failed ({} -> {}): {}",
                        src,
                        target.display(),
                        e
                    )
                })?;
                fs::remove_file(&long_src)
                    .map_err(|e| format!("Cross-drive file delete failed ({}): {}", src, e))?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_items(paths: Vec<String>) -> Result<(), String> {
    for p in &paths {
        let path = Path::new(p);
        if path.is_dir() {
            fs::remove_dir_all(path).map_err(|e| format!("Failed to delete {}: {}", p, e))?;
        } else {
            fs::remove_file(path).map_err(|e| format!("Failed to delete {}: {}", p, e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn rename_item(old_path: String, new_name: String) -> Result<String, String> {
    let old = Path::new(&old_path);
    let parent = old.parent().ok_or("No parent directory")?;
    let new_path = parent.join(&new_name);
    fs::rename(old, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    fs::File::create(&path).map_err(|e| e.to_string())?;
    Ok(())
}

/// On Windows, removes the "Mark of the Web" (Zone.Identifier) so the default app
/// won't show "Is this file from a trusted source?". No-op if file has no zone or on other OSes.
#[cfg(target_os = "windows")]
fn unblock_file_if_needed(path: &str) {
    let path_escaped = path.replace('\'', "''");
    let _ = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("Unblock-File -LiteralPath '{}' -ErrorAction SilentlyContinue", path_escaped),
        ])
        .output();
}

#[cfg(not(target_os = "windows"))]
fn unblock_file_if_needed(_path: &str) {}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    unblock_file_if_needed(&path);
    open::that(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_with_mpv(path: String) -> Result<(), String> {
    let (player, args) = resolve_video_player(&path).ok_or_else(|| {
        "No compatible external player found. Install MPV or VLC and retry.".to_string()
    })?;

    Command::new(player)
        .args(args)
        .spawn()
        .map_err(|e| format!("Failed to launch external player: {}", e))?;

    Ok(())
}

fn resolve_video_player(path: &str) -> Option<(String, Vec<String>)> {
    #[cfg(target_os = "windows")]
    {
        if let Some(exe) = find_in_path("mpv") {
            return Some((
                exe,
                vec![
                    "--force-window=yes".to_string(),
                    "--keep-open=no".to_string(),
                    path.to_string(),
                ],
            ));
        }
        if let Some(exe) = find_in_path("mpvnet") {
            return Some((exe, vec![path.to_string()]));
        }
        if let Some(exe) = find_in_path("vlc") {
            return Some((exe, vec!["--play-and-exit".to_string(), path.to_string()]));
        }

        let mut candidates = vec![
            "C:\\Program Files\\mpv\\mpv.exe".to_string(),
            "C:\\Program Files\\mpv.net\\mpvnet.exe".to_string(),
            "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe".to_string(),
            "C:\\Program Files (x86)\\mpv\\mpv.exe".to_string(),
            "C:\\Program Files (x86)\\mpv.net\\mpvnet.exe".to_string(),
            "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe".to_string(),
            "C:\\ProgramData\\chocolatey\\bin\\mpv.exe".to_string(),
            "C:\\Program Files\\Windows Media Player\\wmplayer.exe".to_string(),
            "C:\\Program Files (x86)\\Windows Media Player\\wmplayer.exe".to_string(),
        ];

        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push(format!("{}\\Programs\\mpv\\mpv.exe", local_app_data));
            candidates.push(format!("{}\\Programs\\mpv.net\\mpvnet.exe", local_app_data));
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            candidates.push(format!(
                "{}\\scoop\\apps\\mpv\\current\\mpv.exe",
                user_profile
            ));
            candidates.push(format!(
                "{}\\scoop\\apps\\vlc\\current\\vlc.exe",
                user_profile
            ));
        }

        if let Some(exe) = candidates.into_iter().find(|p| Path::new(p).exists()) {
            let lower = exe.to_lowercase();
            if lower.contains("vlc") {
                return Some((exe, vec!["--play-and-exit".to_string(), path.to_string()]));
            }
            if lower.contains("wmplayer") || lower.contains("mpvnet") {
                return Some((exe, vec![path.to_string()]));
            }
            return Some((
                exe,
                vec![
                    "--force-window=yes".to_string(),
                    "--keep-open=no".to_string(),
                    path.to_string(),
                ],
            ));
        }

        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        Some(("mpv".to_string(), vec![path.to_string()]))
    }
}

#[cfg(target_os = "windows")]
fn find_in_path(exe_name: &str) -> Option<String> {
    let output = Command::new("cmd")
        .args(["/C", "where", exe_name])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && Path::new(line).exists())
        .map(|s| s.to_string())
}

#[tauri::command]
pub fn open_in_terminal(path: String) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/c", "start", "wt", "-d", &path])
        .spawn()
        .or_else(|_| {
            std::process::Command::new("cmd")
                .args(["/c", "start", "cmd", "/k", &format!("cd /d \"{}\"", path)])
                .spawn()
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let p = Path::new(&path);
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    let sym_meta = fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
    let name = p
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = if meta.is_file() {
        p.extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
    } else {
        String::new()
    };

    #[cfg(target_os = "windows")]
    let (readonly, attrs) = {
        use std::os::windows::fs::MetadataExt;
        (meta.permissions().readonly(), meta.file_attributes())
    };
    #[cfg(not(target_os = "windows"))]
    let (readonly, attrs) = (meta.permissions().readonly(), 0u32);

    Ok(FileMetadata {
        name,
        path: path.clone(),
        size: if meta.is_file() { meta.len() } else { 0 },
        modified: get_unix_ms(meta.modified().unwrap_or(UNIX_EPOCH)),
        created: get_unix_ms(meta.created().unwrap_or(UNIX_EPOCH)),
        is_dir: meta.is_dir(),
        extension: ext,
        hidden: is_hidden(p),
        symlink: sym_meta.file_type().is_symlink(),
        readonly,
        attributes: attrs,
    })
}

#[tauri::command]
pub fn get_drives() -> Vec<DriveInfo> {
    let mut drives = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        unsafe {
            #[link(name = "kernel32")]
            extern "system" {
                fn GetLogicalDrives() -> u32;
                fn GetVolumeInformationW(
                    lpRootPathName: *const u16,
                    lpVolumeNameBuffer: *mut u16,
                    nVolumeNameSize: u32,
                    lpVolumeSerialNumber: *mut u32,
                    lpMaximumComponentLength: *mut u32,
                    lpFileSystemFlags: *mut u32,
                    lpFileSystemNameBuffer: *mut u16,
                    nFileSystemNameSize: u32,
                ) -> i32;
                fn GetDiskFreeSpaceExW(
                    lpDirectoryName: *const u16,
                    lpFreeBytesAvailableToCaller: *mut u64,
                    lpTotalNumberOfBytes: *mut u64,
                    lpTotalNumberOfFreeBytes: *mut u64,
                ) -> i32;
            }

            let drives_mask = GetLogicalDrives();
            for i in 0..26 {
                if (drives_mask & (1 << i)) != 0 {
                    let letter = format!("{}:\\", (b'A' + i) as char);
                    let wide_path: Vec<u16> = OsStr::new(&letter)
                        .encode_wide()
                        .chain(std::iter::once(0))
                        .collect();

                    let mut volume_name = [0u16; 261];
                    let _ = GetVolumeInformationW(
                        wide_path.as_ptr(),
                        volume_name.as_mut_ptr(),
                        261,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        0,
                    );

                    let mut label = String::from_utf16_lossy(&volume_name);
                    label = label.trim_end_matches('\0').to_string();

                    let mut free_bytes_available: u64 = 0;
                    let mut total_number_of_bytes: u64 = 0;
                    let mut total_number_of_free_bytes: u64 = 0;
                    let _ = GetDiskFreeSpaceExW(
                        wide_path.as_ptr(),
                        &mut free_bytes_available,
                        &mut total_number_of_bytes,
                        &mut total_number_of_free_bytes,
                    );

                    drives.push(DriveInfo {
                        letter: format!("{}:", (b'A' + i) as char),
                        label: if label.is_empty() {
                            "Local Disk".to_string()
                        } else {
                            label
                        },
                        total: total_number_of_bytes,
                        free: free_bytes_available,
                        drive_type: "fixed".to_string(),
                    });
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Fallback for linux/mac just in case
        drives.push(DriveInfo {
            letter: "/".to_string(),
            label: "Root Temp".to_string(),
            total: 10000000000,
            free: 5000000000,
            drive_type: "fixed".to_string(),
        });
    }

    drives
}

#[tauri::command]
pub fn get_system_paths() -> SystemPaths {
    let home = dirs_path("home");
    SystemPaths {
        home: home.clone(),
        desktop: dirs_path("desktop"),
        downloads: dirs_path("downloads"),
        documents: dirs_path("documents"),
        pictures: dirs_path("pictures"),
        music: dirs_path("music"),
        videos: dirs_path("videos"),
    }
}

fn dirs_path(kind: &str) -> String {
    let p = match kind {
        "home" => dirs::home_dir(),
        "desktop" => dirs::desktop_dir(),
        "downloads" => dirs::download_dir(),
        "documents" => dirs::document_dir(),
        "pictures" => dirs::picture_dir(),
        "music" => dirs::audio_dir(),
        "videos" => dirs::video_dir(),
        _ => None,
    };
    p.map(|d| d.to_string_lossy().to_string())
        .unwrap_or_default()
}
