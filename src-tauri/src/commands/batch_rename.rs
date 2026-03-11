use serde::{Deserialize, Serialize};
use std::path::Path;
use std::fs;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "mode")]
pub enum RenamePattern {
    Sequential { template: String, start: u32, step: u32, padding: u32 },
    Prefix { prefix: String },
    Suffix { suffix: String },
    Replace { find: String, replacement: String },
    InsertDate { position: String, date_field: String }, // position: "prefix"|"suffix", date_field: "created"|"modified"
    GenerateId,
    ChangeExt { new_ext: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenamePreview {
    pub original_path: String,
    pub old_name: String,
    pub new_name: String,
    pub conflict: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenameResult {
    pub original_path: String,
    pub new_path: String,
    pub success: bool,
    pub error: Option<String>,
}

fn apply_pattern(name: &str, ext: &str, pattern: &RenamePattern, index: u32, path: &Path) -> String {
    let stem = if ext.is_empty() { name.to_string() } else { name[..name.len().saturating_sub(ext.len() + 1)].to_string() };
    let ext_str = if ext.is_empty() { String::new() } else { format!(".{}", ext) };

    match pattern {
        RenamePattern::Sequential { template, start, step, padding } => {
            let n = start + index * step;
            let num = format!("{:0>width$}", n, width = *padding as usize);
            let new_stem = template.replace("###", &num).replace("{n}", &num);
            format!("{}{}", new_stem, ext_str)
        }
        RenamePattern::Prefix { prefix } => format!("{}{}{}", prefix, stem, ext_str),
        RenamePattern::Suffix { suffix } => format!("{}{}{}", stem, suffix, ext_str),
        RenamePattern::Replace { find, replacement } => {
            format!("{}{}", stem.replace(find.as_str(), replacement.as_str()), ext_str)
        }
        RenamePattern::InsertDate { position, date_field } => {
            let meta = fs::metadata(path).ok();
            let ts = meta.as_ref().and_then(|m| {
                if date_field == "created" { m.created().ok() } else { m.modified().ok() }
            });
            let date_str = ts.map(|t| {
                let secs = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
                let s = secs;
                // Simple date formatting: YYYY-MM-DD
                let days = s / 86400;
                let mut y = 1970u32;
                let mut d = days as u32;
                loop {
                    let days_in_y = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
                    if d < days_in_y { break; }
                    d -= days_in_y;
                    y += 1;
                }
                let months = [31u32, if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
                let mut m = 1u32;
                for &days_in_m in &months {
                    if d < days_in_m { break; }
                    d -= days_in_m;
                    m += 1;
                }
                format!("{:04}-{:02}-{:02}", y, m, d + 1)
            }).unwrap_or_else(|| "0000-00-00".to_string());

            if position == "prefix" {
                format!("{}-{}{}", date_str, stem, ext_str)
            } else {
                format!("{}-{}{}", stem, date_str, ext_str)
            }
        }
        RenamePattern::GenerateId => {
            format!("{}{}", Uuid::new_v4().to_string().split('-').next().unwrap_or("id"), ext_str)
        }
        RenamePattern::ChangeExt { new_ext } => {
            if new_ext.is_empty() {
                stem
            } else {
                format!("{}.{}", stem, new_ext.trim_start_matches('.'))
            }
        }
    }
}

#[tauri::command]
pub fn preview_rename(paths: Vec<String>, pattern: RenamePattern) -> Vec<RenamePreview> {
    let mut previews = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // Pre-populate with existing names (excluding files being renamed)
    let existing_parents: Vec<_> = paths.iter()
        .filter_map(|p| Path::new(p).parent().map(|par| par.to_path_buf()))
        .collect();

    for (i, path_str) in paths.iter().enumerate() {
        let p = Path::new(path_str);
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        let ext = p.extension().unwrap_or_default().to_string_lossy().to_lowercase();
        let new_name = apply_pattern(&name, &ext, &pattern, i as u32, p);

        // Check for conflict: new name already exists in directory (and wasn't just renamed)
        let parent = p.parent().unwrap_or(Path::new(""));
        let new_path = parent.join(&new_name);
        let conflict = (new_path.exists() && new_name != name) || seen.contains(&new_name);
        seen.insert(new_name.clone());

        previews.push(RenamePreview {
            original_path: path_str.clone(),
            old_name: name,
            new_name,
            conflict,
        });
    }
    previews
}

#[tauri::command]
pub fn apply_rename(paths: Vec<String>, pattern: RenamePattern) -> Vec<RenameResult> {
    let mut results = Vec::new();
    for (i, path_str) in paths.iter().enumerate() {
        let p = Path::new(path_str);
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        let ext = p.extension().unwrap_or_default().to_string_lossy().to_lowercase();
        let new_name = apply_pattern(&name, &ext, &pattern, i as u32, p);
        let parent = p.parent().unwrap_or(Path::new(""));
        let new_path = parent.join(&new_name);

        match fs::rename(p, &new_path) {
            Ok(_) => results.push(RenameResult {
                original_path: path_str.clone(),
                new_path: new_path.to_string_lossy().to_string(),
                success: true,
                error: None,
            }),
            Err(e) => results.push(RenameResult {
                original_path: path_str.clone(),
                new_path: String::new(),
                success: false,
                error: Some(e.to_string()),
            }),
        }
    }
    results
}
