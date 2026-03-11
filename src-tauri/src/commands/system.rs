/// System utilities: clipboard, trash, file icons, wallpaper
use std::path::Path;

#[tauri::command]
pub fn set_wallpaper(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        // Windows API: SystemParametersInfoW with SPI_SETDESKWALLPAPER
        const SPI_SETDESKWALLPAPER: u32 = 0x0014;
        const SPIF_UPDATEINIFILE: u32 = 0x0001;
        const SPIF_SENDCHANGE: u32 = 0x0002;

        let wide_path: Vec<u16> = OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let result = unsafe {
            #[link(name = "user32")]
            extern "system" {
                fn SystemParametersInfoW(
                    uiAction: u32,
                    uiParam: u32,
                    pvParam: *const u16,
                    fWinIni: u32,
                ) -> i32;
            }
            SystemParametersInfoW(
                SPI_SETDESKWALLPAPER,
                0,
                wide_path.as_ptr(),
                SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
            )
        };

        if result != 0 {
            Ok(())
        } else {
            Err("Failed to set wallpaper".to_string())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("set_wallpaper is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn empty_trash() -> Result<(), String> {
    let status = std::process::Command::new("powershell")
        .args([
            "-Command",
            "(New-Object -ComObject Shell.Application).NameSpace(10).Items() | foreach { Remove-Item $_.Path -Recurse -Force -ErrorAction SilentlyContinue }",
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Failed to empty trash".to_string())
    }
}

#[tauri::command]
pub fn trash_items(paths: Vec<String>) -> Result<(), String> {
    trash::delete_all(&paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_trash_items(paths: Vec<String>) -> Result<(), String> {
    let refs_json = serde_json::to_string(&paths).unwrap_or_else(|_| "[]".to_string());
    let b64 = base64_encode(refs_json.as_bytes());
    let script = format!(
        "$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('{}')); $paths = $json | ConvertFrom-Json; $rb = (New-Object -ComObject Shell.Application).NameSpace(10); if ($rb -ne $null) {{ $items = $rb.Items(); foreach ($item in $items) {{ if ($paths -contains $item.Path) {{ $item.InvokeVerb('undelete') }} }} }}",
        b64
    );
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn read_file_as_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file_as_base64(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(base64_encode(&buf))
}

/// Minimal base64 encoder (no external dep needed)
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 63) as usize] as char);
        out.push(CHARS[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            CHARS[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            CHARS[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    if path == "shell:RecycleBinFolder" {
        return true;
    }
    Path::new(&path).exists()
}

#[tauri::command]
pub fn get_parent_path(path: String) -> Option<String> {
    Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn join_path(base: String, name: String) -> String {
    Path::new(&base).join(&name).to_string_lossy().to_string()
}
