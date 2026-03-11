use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

type WatcherMap =
    Arc<Mutex<HashMap<String, notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>>;

lazy_static::lazy_static! {
    static ref WATCHERS: WatcherMap = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DirChangedPayload {
    pub path: String,
    pub kind: String,
    pub entries: Vec<DirChangedEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DirChangedEntry {
    pub path: String,
    pub kind: String,
}

#[tauri::command]
pub fn watch_directory(path: String, app: AppHandle) -> Result<(), String> {
    let watch_path = path.clone();
    let app_clone = app.clone();

    let debouncer = new_debouncer(
        Duration::from_millis(80),
        move |result: DebounceEventResult| {
            // DebounceEventResult = Result<Vec<DebouncedEvent>, Vec<notify::Error>>
            if let Ok(events) = result {
                let mut entries: Vec<DirChangedEntry> = Vec::with_capacity(events.len());
                for ev in events {
                    entries.push(DirChangedEntry {
                        path: ev.path.to_string_lossy().to_string(),
                        kind: format!("{:?}", ev.kind),
                    });
                }
                let _ = app_clone.emit(
                    "dir-changed",
                    DirChangedPayload {
                        path: watch_path.clone(),
                        kind: "batch".to_string(),
                        entries,
                    },
                );
            } else {
                let _ = app_clone.emit(
                    "dir-changed",
                    DirChangedPayload {
                        path: watch_path.clone(),
                        kind: "change".to_string(),
                        entries: Vec::new(),
                    },
                );
            }
        },
    )
    .map_err(|e| e.to_string())?;

    let mut debouncer = debouncer;
    debouncer
        .watcher()
        .watch(Path::new(&path), notify::RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    let mut map = WATCHERS.lock().unwrap();
    map.insert(path, debouncer);
    Ok(())
}

#[tauri::command]
pub fn stop_watching(path: String) -> Result<(), String> {
    let mut map = WATCHERS.lock().unwrap();
    map.remove(&path);
    Ok(())
}
