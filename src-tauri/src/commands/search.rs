use crate::commands::fs_ops::FileEntry;
use std::collections::HashSet;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

fn fuzzy_match(target: &str, query_lower: &str) -> bool {
    if query_lower.is_empty() {
        return true;
    }
    let target_lower = target.to_lowercase();
    let mut target_chars = target_lower.chars();
    'outer: for qc in query_lower.chars() {
        loop {
            match target_chars.next() {
                Some(tc) if tc == qc => continue 'outer,
                Some(_) => continue,
                None => return false,
            }
        }
    }
    true
}

#[tauri::command]
pub async fn search_in_directory(
    root: String,
    query: String,
    extensions: Vec<String>,
    max_results: usize,
    recursive: bool,
) -> Vec<FileEntry> {
    tauri::async_runtime::spawn_blocking(move || {
        let max = if max_results == 0 { 500 } else { max_results };
        let query_lower = query.to_lowercase();
        let ext_set: HashSet<String> = extensions.iter().map(|e| e.to_lowercase()).collect();
        let mut results = Vec::with_capacity(max.min(256));

        let walker: Box<dyn Iterator<Item = walkdir::DirEntry>> = if recursive {
            Box::new(
                WalkDir::new(&root)
                    .min_depth(1)
                    .into_iter()
                    .filter_map(|e| e.ok()),
            )
        } else {
            Box::new(
                WalkDir::new(&root)
                    .min_depth(1)
                    .max_depth(1)
                    .into_iter()
                    .filter_map(|e| e.ok()),
            )
        };

        for entry in walker {
            if results.len() >= max {
                break;
            }
            let name = match entry.file_name().to_str() {
                Some(n) => n,
                None => continue,
            };

            if !fuzzy_match(name, &query_lower) {
                continue;
            }

            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let is_dir = meta.is_dir();
            let is_file = meta.file_type().is_file();

            let ext = if is_file {
                entry.path()
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase()
            } else {
                String::new()
            };

            if !ext_set.is_empty() && !is_dir {
                if !ext_set.contains(&ext) {
                    continue;
                }
            }

            let symlink = entry.path_is_symlink();

            let get_ms = |t: std::time::SystemTime| {
                t.duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0)
            };

            #[cfg(target_os = "windows")]
            let hidden = {
                use std::os::windows::fs::MetadataExt;
                meta.file_attributes() & 0x2 != 0
            };
            #[cfg(not(target_os = "windows"))]
            let hidden = name.starts_with('.');

            results.push(FileEntry {
                name: name.to_string(),
                path: entry.path().to_string_lossy().to_string(),
                size: if is_file { meta.len() } else { 0 },
                modified: get_ms(meta.modified().unwrap_or(UNIX_EPOCH)),
                created: get_ms(meta.created().unwrap_or(UNIX_EPOCH)),
                is_dir,
                extension: ext,
                hidden,
                symlink,
            });
        }

        results
    })
    .await
    .unwrap_or_default()
}
