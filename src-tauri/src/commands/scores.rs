use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::RwLock;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ScoreEntry {
    pub count: u32,
    pub last_visited: u64,
}

const SAVE_DEBOUNCE_SECS: u64 = 5;

pub struct ScoreStore {
    pub data: RwLock<HashMap<String, ScoreEntry>>,
    pub path: PathBuf,
    dirty: AtomicBool,
    last_save: AtomicU64,
}

impl ScoreStore {
    pub fn new(app_dir: PathBuf) -> Self {
        let store_path = app_dir.join("file_scores.json");
        let data = if let Ok(json) = fs::read_to_string(&store_path) {
            serde_json::from_str(&json).unwrap_or_default()
        } else {
            HashMap::new()
        };

        Self {
            data: RwLock::new(data),
            path: store_path,
            dirty: AtomicBool::new(false),
            last_save: AtomicU64::new(0),
        }
    }

    pub fn increment(&self, path: String) {
        {
            let mut data = self.data.write().unwrap();
            let entry = data.entry(path).or_insert(ScoreEntry {
                count: 0,
                last_visited: 0,
            });
            entry.count += 1;
            entry.last_visited = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
        }
        self.dirty.store(true, Ordering::Relaxed);
        self.maybe_flush();
    }

    fn maybe_flush(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let last = self.last_save.load(Ordering::Relaxed);
        if now - last >= SAVE_DEBOUNCE_SECS && self.dirty.load(Ordering::Relaxed) {
            self.flush();
        }
    }

    pub fn flush(&self) {
        if !self.dirty.swap(false, Ordering::Relaxed) {
            return;
        }
        let data = self.data.read().unwrap();
        if let Ok(json) = serde_json::to_string(&*data) {
            let _ = fs::write(&self.path, json);
        }
        self.last_save.store(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            Ordering::Relaxed,
        );
    }

    pub fn get_score(&self, path: &str) -> f32 {
        let data = self.data.read().unwrap();
        if let Some(entry) = data.get(path) {
            entry.count as f32
        } else {
            0.0
        }
    }
}
