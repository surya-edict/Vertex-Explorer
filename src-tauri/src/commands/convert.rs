use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use lazy_static::lazy_static;

lazy_static! {
    /// Caches (source path → temp mp4 path) to avoid re-converting the same file.
    static ref CONVERT_CACHE: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
}

/// Check whether ffmpeg is available on PATH.
fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Build a temp output path next to the system temp dir.
fn temp_output_path(source: &str) -> PathBuf {
    let stem = Path::new(source)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let id = uuid::Uuid::new_v4().to_string();
    std::env::temp_dir().join(format!("sleek_preview_{}_{}.mp4", stem, &id[..8]))
}

/// Converts a non-web-compatible video (MKV, AVI, etc.) into a temporary MP4
/// that the WebView <video> element can play.
///
/// Strategy:
///  1. Try a fast **remux** (copy streams into MP4 container). This works when
///     the video stream is already H.264 and audio is AAC/MP3.
///  2. If remux fails, fall back to a **fast re-encode** using libx264 ultrafast.
///
/// Returns the absolute path to the temporary MP4 file.
#[tauri::command]
pub async fn convert_video_for_preview(source: String) -> Result<String, String> {
    // Return cached result if available
    {
        let cache = CONVERT_CACHE.lock().unwrap();
        if let Some(cached) = cache.get(&source) {
            if Path::new(cached).exists() {
                return Ok(cached.clone());
            }
        }
    }

    if !ffmpeg_available() {
        return Err("ffmpeg is not installed or not found in PATH. Install ffmpeg to enable video preview for MKV/AVI files.".into());
    }

    if !Path::new(&source).exists() {
        return Err(format!("Source file not found: {}", source));
    }

    let output = temp_output_path(&source);
    let output_str = output.to_string_lossy().to_string();

    // Attempt 1: fast remux (no re-encoding)
    let remux = Command::new("ffmpeg")
        .args([
            "-y",
            "-i", &source,
            "-c:v", "copy",
            "-c:a", "aac",
            "-movflags", "+faststart",
            &output_str,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    if let Ok(status) = remux {
        if status.success() && output.exists() && output.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            let mut cache = CONVERT_CACHE.lock().unwrap();
            cache.insert(source, output_str.clone());
            return Ok(output_str);
        }
    }

    // Clean up failed remux attempt
    let _ = std::fs::remove_file(&output);

    // Attempt 2: fast re-encode
    let reencode = Command::new("ffmpeg")
        .args([
            "-y",
            "-i", &source,
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "28",
            "-c:a", "aac",
            "-movflags", "+faststart",
            &output_str,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match reencode {
        Ok(status) if status.success() && output.exists() => {
            let mut cache = CONVERT_CACHE.lock().unwrap();
            cache.insert(source, output_str.clone());
            Ok(output_str)
        }
        _ => {
            let _ = std::fs::remove_file(&output);
            Err("Failed to convert video. The file may use an unsupported codec.".into())
        }
    }
}
