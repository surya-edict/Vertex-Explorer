use std::collections::HashMap;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::ptr::null_mut;
use std::sync::RwLock;

use windows::core::HSTRING;
use windows::Win32::Foundation::{ERROR_HANDLE_EOF, HANDLE, INVALID_HANDLE_VALUE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES, FILE_SHARE_READ,
    FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Ioctl::{
    FSCTL_ENUM_USN_DATA, MFT_ENUM_DATA_V1, USN_RECORD_V2, USN_RECORD_V3,
};
use windows::Win32::System::IO::DeviceIoControl;
use crate::commands::scores::ScoreStore;

pub struct MftCache {
    // FileID -> (ParentID, Name, name_lower, is_dir)
    pub graph: RwLock<HashMap<u64, (u64, String, String, bool)>>,
}

impl MftCache {
    pub fn new() -> Self {
        Self {
            graph: RwLock::new(HashMap::new()),
        }
    }
}

const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x00000010;

#[tauri::command]
pub async fn build_mft_index(
    drive_letter: char,
    cache_state: tauri::State<'_, MftCache>,
) -> Result<usize, String> {
    let volume_path = format!("\\\\.\\{}:", drive_letter);
    let h_volume: HANDLE = unsafe {
        CreateFileW(
            &HSTRING::from(&volume_path),
            FILE_READ_ATTRIBUTES.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            Some(null_mut()),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    }
    .map_err(|e| format!("Admin privileges required to open volume: {}", e))?;

    if h_volume == INVALID_HANDLE_VALUE {
        return Err("Failed to obtain volume handle".into());
    }

    let mut mft_enum_data = MFT_ENUM_DATA_V1 {
        StartFileReferenceNumber: 0,
        LowUsn: 0,
        HighUsn: std::i64::MAX,
        MinMajorVersion: 2,
        MaxMajorVersion: 3,
    };

    let buffer_size = 1024 * 1024; // 1MB chunks
    let mut buffer: Vec<u8> = vec![0; buffer_size];
    let mut bytes_returned: u32 = 0;

    let mut count = 0;
    
    let mut local_map = HashMap::with_capacity(500_000);

    loop {
        let result = unsafe {
            DeviceIoControl(
                h_volume,
                FSCTL_ENUM_USN_DATA,
                Some(&mut mft_enum_data as *mut _ as *mut std::ffi::c_void),
                std::mem::size_of::<MFT_ENUM_DATA_V1>() as u32,
                Some(buffer.as_mut_ptr() as *mut std::ffi::c_void),
                buffer_size as u32,
                Some(&mut bytes_returned),
                Some(null_mut()),
            )
        };

        if result.is_err() {
            let err = result.unwrap_err();
            if err.code() == ERROR_HANDLE_EOF.into() {
                break; // End of MFT
            }
            // Real error
            break;
        }

        if bytes_returned < 8 {
            break;
        }

        // The first 8 bytes contain the next StartFileReferenceNumber (an u64)
        mft_enum_data.StartFileReferenceNumber =
            unsafe { std::ptr::read_unaligned(buffer.as_ptr() as *const u64) };

        let mut offset = 8;
        while offset < bytes_returned as usize {
            let record_ptr = unsafe { buffer.as_ptr().add(offset) };
            // Read length to jump properly
            let record_len = unsafe { std::ptr::read_unaligned(record_ptr as *const u32) };
            if record_len == 0 {
                break;
            }

            // Minimal parser for USN_RECORD_V2 (mostly V2, occasionally V3)
            let major_version =
                unsafe { std::ptr::read_unaligned(record_ptr.add(4) as *const u16) };

            if major_version == 2 {
                let rec = unsafe { &*(record_ptr as *const USN_RECORD_V2) };
                let is_dir = (rec.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;

                let name_ptr = unsafe { record_ptr.add(rec.FileNameOffset as usize) as *const u16 };
                let name_len_chars = (rec.FileNameLength / 2) as usize;
                let name_slice = unsafe { std::slice::from_raw_parts(name_ptr, name_len_chars) };
                let name = String::from_utf16_lossy(name_slice);
                let name_lower = name.to_lowercase();

                local_map.insert(
                    rec.FileReferenceNumber,
                    (rec.ParentFileReferenceNumber, name, name_lower, is_dir),
                );
                count += 1;
            } else if major_version == 3 {
                let rec = unsafe { &*(record_ptr as *const USN_RECORD_V3) };
                let is_dir = (rec.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;

                let name_ptr = unsafe { record_ptr.add(rec.FileNameOffset as usize) as *const u16 };
                let name_len_chars = (rec.FileNameLength / 2) as usize;
                let name_slice = unsafe { std::slice::from_raw_parts(name_ptr, name_len_chars) };
                let name = String::from_utf16_lossy(name_slice);
                let name_lower = name.to_lowercase();

                let frn = unsafe {
                    std::ptr::read_unaligned(&rec.FileReferenceNumber as *const _ as *const u64)
                };
                let pfrn = unsafe {
                    std::ptr::read_unaligned(
                        &rec.ParentFileReferenceNumber as *const _ as *const u64,
                    )
                };

                local_map.insert(frn, (pfrn, name, name_lower, is_dir));
                count += 1;
            }

            offset += record_len as usize;
        }
    }

    // Replace the global graph
    let mut graph_lock = cache_state.graph.write().unwrap();
    *graph_lock = local_map;
    
    Ok(count)
}

#[derive(serde::Serialize)]
pub struct MftSearchResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub score: f32,
}

#[tauri::command]
pub fn increment_score(path: String, score_state: tauri::State<'_, ScoreStore>) {
    score_state.increment(path);
}

#[tauri::command]
pub async fn search_mft(
    drive_letter: char,
    query: String,
    limit: usize,
    cache_state: tauri::State<'_, MftCache>,
    score_state: tauri::State<'_, ScoreStore>,
) -> Result<Vec<MftSearchResult>, String> {
    let graph = cache_state.graph.read().unwrap();
    if graph.is_empty() {
        return Err("MFT Index not built yet. Please call build_mft_index first.".into());
    }

    let query_lower = query.to_lowercase();
    let effective_limit = if limit == 0 { 50 } else { limit };
    let mut results: Vec<MftSearchResult> = Vec::with_capacity(effective_limit + 1);
    let mut min_score: f32 = f32::MIN;

    for (_frn, (parent_frn, name, name_lower, is_dir)) in graph.iter() {
        if !name_lower.contains(&query_lower) {
            continue;
        }

        let mut path_parts = vec![name.clone()];
        let mut curr_parent = *parent_frn;
        let mut safety_counter = 0;

        while curr_parent != 0 && curr_parent != 5 && safety_counter < 100 {
            if let Some((next_parent, parent_name, _, _)) = graph.get(&curr_parent) {
                path_parts.push(parent_name.clone());
                curr_parent = *next_parent;
            } else {
                break;
            }
            safety_counter += 1;
        }

        path_parts.reverse();
        let full_path = format!("{}:\\{}", drive_letter, path_parts.join("\\"));
        let score = score_state.get_score(&full_path);

        if results.len() >= effective_limit && score <= min_score {
            continue;
        }

        results.push(MftSearchResult {
            name: name.clone(),
            path: full_path,
            is_dir: *is_dir,
            score,
        });

        if results.len() > effective_limit * 2 {
            results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
            results.truncate(effective_limit);
            min_score = results.last().map(|r| r.score).unwrap_or(f32::MIN);
        }
    }

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(effective_limit);

    Ok(results)
}
