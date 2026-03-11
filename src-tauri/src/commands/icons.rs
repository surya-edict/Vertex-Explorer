/// Extracts the real Windows shell icon for a file/folder path.
///
/// `size` is the requested display size. The backend snaps to the nearest
/// quality tier and returns a PNG at exactly that resolution:
///
///   ≤ 16 px  →  16×16   (SHGetFileInfo SHGFI_SMALLICON)
///   ≤ 32 px  →  32×32   (SHGetFileInfo SHGFI_LARGEICON)
///   ≤ 48 px  →  48×48   (SHGetImageList SHIL_EXTRALARGE)
///   > 48 px  → 256×256  (SHGetImageList SHIL_JUMBO)
#[tauri::command]
pub async fn get_file_icon(path: String, size: u32) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let tier: u32 = if size <= 16 {
                16
            } else if size <= 32 {
                32
            } else if size <= 48 {
                48
            } else {
                256
            };
            platform::extract(path, tier)
        }
        #[cfg(not(windows))]
        {
            let _ = (path, size);
            None
        }
    })
    .await
    .map_err(|e: tokio::task::JoinError| e.to_string())
}

#[tauri::command]
pub async fn get_file_icons_batch(
    extensions: Vec<String>,
    size: u32,
) -> Result<std::collections::HashMap<String, Option<String>>, String> {
    tokio::task::spawn_blocking(move || {
        let mut result = std::collections::HashMap::with_capacity(extensions.len());
        #[cfg(windows)]
        {
            let tier: u32 = if size <= 16 { 16 } else if size <= 32 { 32 } else if size <= 48 { 48 } else { 256 };
            for ext in extensions {
                let dummy_path = if ext.is_empty() || ext == "__dir__" {
                    std::env::temp_dir().to_string_lossy().to_string()
                } else {
                    format!("C:\\__dummy__.{}", ext)
                };
                let icon = platform::extract(dummy_path, tier);
                result.insert(ext, icon);
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (extensions, size);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_image_thumbnail(path: String, size: u32) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        {
            platform::extract_thumbnail(path, size).ok_or_else(|| "Failed to get thumbnail".into())
        }
        #[cfg(not(windows))]
        {
            Err("Not supported".into())
        }
    })
    .await
    .map_err(|e: tokio::task::JoinError| e.to_string())?
}

// ──────────────────────────────────────────────────────────────────────────────
// Windows implementation
// ──────────────────────────────────────────────────────────────────────────────
#[cfg(windows)]
mod platform {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use lazy_static::lazy_static;
    use std::{
        collections::{hash_map::DefaultHasher, HashMap, VecDeque},
        fs,
        hash::{Hash, Hasher},
        mem,
        path::PathBuf,
        sync::Mutex,
    };

    use windows::{
        core::PCWSTR,
        Win32::{
            Graphics::Gdi::{
                CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject,
                BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, HGDIOBJ, HBITMAP, BitBlt, SRCCOPY,
            },
            UI::{
                Controls::IImageList,
                Shell::{
                    SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
                    SHGFI_SMALLICON, SHGFI_SYSICONINDEX,
                },
                WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON},
            },
        },
    };

    const SHIL_EXTRALARGE: i32 = 2;
    const SHIL_JUMBO: i32 = 4;
    const THUMB_MEM_MAX: usize = 2000;
    const ICON_CACHE_MAX: usize = 512;

    lazy_static! {
        static ref THUMB_MEM: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
        static ref THUMB_MEM_ORDER: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
        static ref ICON_EXT_CACHE: Mutex<HashMap<String, Option<String>>> = Mutex::new(HashMap::new());
    }

    fn needs_per_path_icon(ext: &str) -> bool {
        matches!(ext, "exe" | "lnk" | "url" | "appref-ms" | "msi" | "ico" | "")
    }

    fn icon_cache_key(path: &str, tier: u32) -> String {
        let ext = std::path::Path::new(path)
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        let is_dir = std::path::Path::new(path).is_dir();
        if is_dir {
            format!("__dir__|{}", tier)
        } else if needs_per_path_icon(&ext) {
            format!("{}|{}", path, tier)
        } else {
            format!(".{}|{}", ext, tier)
        }
    }

    pub fn extract(path: String, tier: u32) -> Option<String> {
        let cache_key = icon_cache_key(&path, tier);
        if let Ok(cache) = ICON_EXT_CACHE.lock() {
            if let Some(cached) = cache.get(&cache_key) {
                return cached.clone();
            }
        }

        let wide: Vec<u16> = path.encode_utf16().chain(Some(0u16)).collect();
        let pcwstr = PCWSTR(wide.as_ptr());
        let result = match tier {
            16 | 32 => extract_shfileinfo(pcwstr, tier),
            48 => extract_imagelist(pcwstr, SHIL_EXTRALARGE, 48),
            _ => extract_imagelist(pcwstr, SHIL_JUMBO, 256),
        };

        if let Ok(mut cache) = ICON_EXT_CACHE.lock() {
            if cache.len() >= ICON_CACHE_MAX {
                let first_key = cache.keys().next().cloned();
                if let Some(k) = first_key {
                    cache.remove(&k);
                }
            }
            cache.insert(cache_key, result.clone());
        }

        result
    }

    thread_local! {
        static COM_INIT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    }

    fn ensure_com() {
        COM_INIT.with(|init| {
            if !init.get() {
                use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
                let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
                init.set(true);
            }
        });
    }

    pub fn extract_thumbnail(path: String, size: u32) -> Option<String> {
        let cache_key = thumbnail_cache_key(&path, size);
        if let Some(hit) = mem_get(&cache_key) {
            return Some(hit);
        }
        if let Some(hit) = disk_get(&cache_key) {
            mem_put(cache_key.clone(), hit.clone());
            return Some(hit);
        }

        ensure_com();

        let wide: Vec<u16> = path.encode_utf16().chain(Some(0u16)).collect();
        let pcwstr = PCWSTR(wide.as_ptr());

        let factory: windows::core::Result<windows::Win32::UI::Shell::IShellItemImageFactory> = unsafe {
            windows::Win32::UI::Shell::SHCreateItemFromParsingName(pcwstr, None)
        };
        let factory = match factory {
            Ok(f) => f,
            Err(_) => return None,
        };

        let size_struct = windows::Win32::Foundation::SIZE { cx: size as i32, cy: size as i32 };
        let hbitmap = unsafe { factory.GetImage(size_struct, windows::Win32::UI::Shell::SIIGBF_RESIZETOFIT).ok() };
        
        let result = if let Some(hbmp) = hbitmap {
            let res = hbitmap_to_png(hbmp, size);
            unsafe { let _ = DeleteObject(HGDIOBJ(hbmp.0)); }
            res
        } else {
            None
        };

        if let Some(ref uri) = result {
            mem_put(cache_key.clone(), uri.clone());
            disk_put(&cache_key, uri);
        }
        result
    }

    fn thumbnail_cache_key(path: &str, size: u32) -> String {
        let mut hasher = DefaultHasher::new();
        path.hash(&mut hasher);
        size.hash(&mut hasher);
        if let Ok(meta) = fs::metadata(path) {
            meta.len().hash(&mut hasher);
            if let Ok(modified) = meta.modified() {
                if let Ok(ts) = modified.duration_since(std::time::UNIX_EPOCH) {
                    ts.as_millis().hash(&mut hasher);
                }
            }
        }
        format!("{:016x}", hasher.finish())
    }

    fn cache_dir() -> Option<PathBuf> {
        let base = dirs::cache_dir()?;
        let dir = base.join("sleek-explorer").join("thumb-cache");
        if !dir.exists() {
            let _ = fs::create_dir_all(&dir);
        }
        Some(dir)
    }

    fn cache_file_path(key: &str) -> Option<PathBuf> {
        Some(cache_dir()?.join(format!("{}.png", key)))
    }

    fn mem_get(key: &str) -> Option<String> {
        let guard = THUMB_MEM.lock().ok()?;
        guard.get(key).cloned()
    }

    fn mem_put(key: String, value: String) {
        if let Ok(mut mem) = THUMB_MEM.lock() {
            mem.insert(key.clone(), value);
            if let Ok(mut order) = THUMB_MEM_ORDER.lock() {
                order.push_back(key);
                while order.len() > THUMB_MEM_MAX {
                    if let Some(old) = order.pop_front() {
                        mem.remove(&old);
                    }
                }
            }
        }
    }

    fn disk_get(key: &str) -> Option<String> {
        let path = cache_file_path(key)?;
        let bytes = fs::read(path).ok()?;
        Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
    }

    fn disk_put(key: &str, data_uri: &str) {
        let Some(path) = cache_file_path(key) else { return; };
        let Some(b64) = data_uri.strip_prefix("data:image/png;base64,") else { return; };
        let Ok(bytes) = STANDARD.decode(b64) else { return; };
        std::thread::spawn(move || {
            let _ = fs::write(path, bytes);
        });
    }

    fn extract_shfileinfo(pcwstr: PCWSTR, size: u32) -> Option<String> {
        let mut shfi: SHFILEINFOW = unsafe { mem::zeroed() };
        let flags = SHGFI_ICON
            | if size <= 16 {
                SHGFI_SMALLICON
            } else {
                SHGFI_LARGEICON
            };
        let ret = unsafe {
            SHGetFileInfoW(
                pcwstr,
                Default::default(),
                Some(&mut shfi),
                mem::size_of::<SHFILEINFOW>() as u32,
                flags,
            )
        };
        if ret == 0 {
            return None;
        }
        let hicon = shfi.hIcon;
        if hicon.is_invalid() {
            return None;
        }
        let result = hicon_to_png(hicon, size);
        unsafe {
            let _ = DestroyIcon(hicon);
        }
        result
    }

    fn extract_imagelist(pcwstr: PCWSTR, shil: i32, size: u32) -> Option<String> {
        // Get the system image-list index for this path
        let mut shfi: SHFILEINFOW = unsafe { mem::zeroed() };
        let ret = unsafe {
            SHGetFileInfoW(
                pcwstr,
                Default::default(),
                Some(&mut shfi),
                mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_SYSICONINDEX,
            )
        };
        if ret == 0 {
            return None;
        }
        let icon_idx = shfi.iIcon as i32;

        // Fetch the high-res image list and extract the HICON
        let img_list: IImageList = unsafe { SHGetImageList(shil) }.ok()?;
        let hicon: HICON = unsafe { img_list.GetIcon(icon_idx, 0x0001) }.ok()?; // ILD_TRANSPARENT
        if hicon.is_invalid() {
            return None;
        }

        let result = hicon_to_png(hicon, size);
        unsafe {
            let _ = DestroyIcon(hicon);
        }
        result
    }

    fn hicon_to_png(hicon: HICON, size: u32) -> Option<String> {
        // Create an off-screen DC
        let hdc = unsafe { CreateCompatibleDC(None) };
        if hdc.is_invalid() {
            return None;
        }

        // Describe a top-down 32-bpp DIB section (BGRA layout)
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size as i32,
                biHeight: -(size as i32), // negative = top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0, // BI_RGB
                ..Default::default()
            },
            ..Default::default()
        };

        let mut bits_ptr: *mut core::ffi::c_void = core::ptr::null_mut();
        let hbmp = unsafe { CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &mut bits_ptr, None, 0) };

        let hbmp = match hbmp {
            Ok(b) if !b.is_invalid() => b,
            _ => {
                unsafe {
                    DeleteDC(hdc);
                }
                return None;
            }
        };

        // Select bitmap into DC, draw icon, then restore
        let hold = unsafe { SelectObject(hdc, HGDIOBJ(hbmp.0)) };

        unsafe {
            let _ = DrawIconEx(
                hdc,
                0,
                0,
                hicon,
                size as i32,
                size as i32,
                0,
                None,
                DI_NORMAL,
            );
        }

        // Read BGRA pixel data
        let n_bytes = (size * size * 4) as usize;
        let raw = unsafe { std::slice::from_raw_parts(bits_ptr as *const u8, n_bytes) };

        // Convert BGRA → RGBA.
        // Older mask-based icons leave alpha=0 everywhere even for visible pixels.
        // Detect that case and force full opacity so they don't disappear.
        let has_alpha = raw.chunks(4).any(|c| c[3] > 0);

        let mut rgba = Vec::with_capacity(n_bytes);
        for c in raw.chunks(4) {
            rgba.push(c[2]); // R
            rgba.push(c[1]); // G
            rgba.push(c[0]); // B
            rgba.push(if has_alpha { c[3] } else { 255 }); // A
        }

        // Cleanup GDI resources
        unsafe {
            SelectObject(hdc, hold);
            DeleteObject(HGDIOBJ(hbmp.0));
            DeleteDC(hdc);
        }

        // Encode as PNG → base64 data URL
        let img = image::RgbaImage::from_raw(size, size, rgba)?;
        
        // --- CRITICAL FIX: Trim Transparent Padding ---
        // Older icons inside SHIL_JUMBO return a 256x256 image with a tiny 32x32 drawing in the top left.
        // We find the bounding box of non-transparent pixels and crop to it!
        let mut min_x = size;
        let mut min_y = size;
        let mut max_x = 0;
        let mut max_y = 0;
        let mut has_visible = false;
        
        for y in 0..size {
            for x in 0..size {
                let p = img.get_pixel(x, y);
                if p[3] > 0 { // Alpha > 0
                    if x < min_x { min_x = x; }
                    if y < min_y { min_y = y; }
                    if x > max_x { max_x = x; }
                    if y > max_y { max_y = y; }
                    has_visible = true;
                }
            }
        }
        
        let dyn_img = if has_visible {
            let width = (max_x - min_x + 1).max(1);
            let height = (max_y - min_y + 1).max(1);
            let cropped = image::imageops::crop_imm(&img, min_x, min_y, width, height).to_image();
            image::DynamicImage::ImageRgba8(cropped)
        } else {
            image::DynamicImage::ImageRgba8(img)
        };

        let mut png_bytes = Vec::new();
        dyn_img
            .write_to(
                &mut std::io::Cursor::new(&mut png_bytes),
                image::ImageFormat::Png,
            )
            .ok()?;

        Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(&png_bytes)
        ))
    }

    fn hbitmap_to_png(hbitmap: HBITMAP, _size: u32) -> Option<String> {
        use windows::Win32::Graphics::Gdi::{GetObjectW, BITMAP};

        // Get actual dimensions of the HBITMAP (Windows may return non-square thumbnails)
        let mut bmp: BITMAP = unsafe { mem::zeroed() };
        let ret = unsafe {
            GetObjectW(
                HGDIOBJ(hbitmap.0),
                mem::size_of::<BITMAP>() as i32,
                Some(&mut bmp as *mut BITMAP as *mut core::ffi::c_void),
            )
        };
        if ret == 0 { return None; }

        let w = bmp.bmWidth as u32;
        let h = bmp.bmHeight.unsigned_abs();
        if w == 0 || h == 0 { return None; }

        let hdc = unsafe { CreateCompatibleDC(None) };
        if hdc.is_invalid() { return None; }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: core::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                biHeight: -(h as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut bits_ptr: *mut core::ffi::c_void = core::ptr::null_mut();
        let hbmp = unsafe { CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &mut bits_ptr, None, 0) };
        let hbmp = match hbmp {
            Ok(b) if !b.is_invalid() => b,
            _ => { unsafe { DeleteDC(hdc); } return None; }
        };

        let hold = unsafe { SelectObject(hdc, HGDIOBJ(hbmp.0)) };
        let src_dc = unsafe { CreateCompatibleDC(None) };
        let hold_src = unsafe { SelectObject(src_dc, HGDIOBJ(hbitmap.0)) };
        
        unsafe {
            let _ = BitBlt(hdc, 0, 0, w as i32, h as i32, src_dc, 0, 0, SRCCOPY);
        }

        unsafe {
            SelectObject(src_dc, hold_src);
            DeleteDC(src_dc);
        }

        let n_bytes = (w * h * 4) as usize;
        let raw = unsafe { std::slice::from_raw_parts(bits_ptr as *const u8, n_bytes) };
        let has_alpha = raw.chunks(4).any(|c| c[3] > 0);

        let mut rgba = Vec::with_capacity(n_bytes);
        for c in raw.chunks(4) {
            rgba.push(c[2]); // R
            rgba.push(c[1]); // G
            rgba.push(c[0]); // B
            rgba.push(if has_alpha { c[3] } else { 255 }); // A
        }

        unsafe {
            SelectObject(hdc, hold);
            DeleteObject(HGDIOBJ(hbmp.0));
            DeleteDC(hdc);
        }

        let img = image::RgbaImage::from_raw(w, h, rgba)?;
        
        let mut min_x = w;
        let mut min_y = h;
        let mut max_x = 0;
        let mut max_y = 0;
        let mut has_visible = false;
        for y in 0..h {
            for x in 0..w {
                let p = img.get_pixel(x, y);
                if p[3] > 0 {
                    if x < min_x { min_x = x; }
                    if y < min_y { min_y = y; }
                    if x > max_x { max_x = x; }
                    if y > max_y { max_y = y; }
                    has_visible = true;
                }
            }
        }

        let dyn_img = if has_visible {
            let width = (max_x - min_x + 1).max(1);
            let height = (max_y - min_y + 1).max(1);
            let cropped = image::imageops::crop_imm(&img, min_x, min_y, width, height).to_image();
            image::DynamicImage::ImageRgba8(cropped)
        } else {
            image::DynamicImage::ImageRgba8(img)
        };

        let mut png_bytes = Vec::new();
        dyn_img.write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png).ok()?;

        Some(format!("data:image/png;base64,{}", STANDARD.encode(&png_bytes)))
    }
}
