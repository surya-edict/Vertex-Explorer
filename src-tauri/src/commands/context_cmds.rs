use flate2::write::GzEncoder;
use flate2::Compression;
use image::imageops;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::{fs, io};
use tauri::command;
use zip::write::FileOptions;
use zip::ZipArchive;

#[command]
pub fn extract_archive(path: String, dest: String) -> Result<(), String> {
    let file = File::open(&path).map_err(|e| e.to_string())?;

    // Quick ZIP extraction
    if path.to_lowercase().ends_with(".zip") {
        let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
        archive.extract(&dest).map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Basic tar.gz handling (optional via flate2 + tar if installed, keeping simple for now)
    Err("Unsupported archive format for native fast-extract extraction".into())
}

#[command]
pub fn compress_items(paths: Vec<String>, format: String) -> Result<(), String> {
    if paths.is_empty() {
        return Err("No files to compress".into());
    }

    let first = Path::new(&paths[0]);
    let parent = first.parent().unwrap_or(Path::new(""));
    let mut out_path = parent.join("Archive");
    let mut counter = 1;

    let ext = if format == "zip" { "zip" } else { "tar.gz" };
    out_path.set_extension(ext);

    while out_path.exists() {
        let name = format!("Archive ({counter})");
        out_path = parent.join(name);
        out_path.set_extension(ext);
        counter += 1;
    }

    if format == "zip" {
        let file = File::create(&out_path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options =
            FileOptions::<()>::default().compression_method(zip::CompressionMethod::Stored);

        for p in paths {
            let path = Path::new(&p);
            if path.is_file() {
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                zip.start_file(name, options).map_err(|e| e.to_string())?;
                let mut f = File::open(path).map_err(|e| e.to_string())?;
                io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
            }
        }
        zip.finish().map_err(|e| e.to_string())?;
    } else {
        let tar_gz = File::create(&out_path).map_err(|e| e.to_string())?;
        let enc = GzEncoder::new(tar_gz, Compression::default());
        let mut tar = tar::Builder::new(enc);
        for p in paths {
            let path = Path::new(&p);
            if path.is_file() {
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let mut f = File::open(path).map_err(|e| e.to_string())?;
                tar.append_file(name, &mut f).map_err(|e| e.to_string())?;
            } else if path.is_dir() {
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                tar.append_dir_all(name, path).map_err(|e| e.to_string())?;
            }
        }
        tar.finish().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[command]
pub fn rotate_image(path: String, direction: String) -> Result<(), String> {
    let img = image::open(&path).map_err(|e| e.to_string())?;
    let rotated = if direction == "right" {
        img.rotate90()
    } else {
        img.rotate270()
    };

    rotated.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn convert_image(path: String, format: String) -> Result<(), String> {
    let img = image::open(&path).map_err(|e| e.to_string())?;
    let orig = Path::new(&path);
    let mut dest = PathBuf::from(orig);
    dest.set_extension(&format);

    img.save(&dest).map_err(|e| e.to_string())?;
    Ok(())
}
