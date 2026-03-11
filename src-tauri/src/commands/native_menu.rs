use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use tauri::Manager;

#[derive(serde::Serialize, Debug, Clone)]
pub struct NativeMenuItem {
    pub id: u32,
    pub title: String,
    pub is_separator: bool,
    pub subitems: Option<Vec<NativeMenuItem>>,
    pub icon: Option<String>,
}

#[tauri::command]
pub async fn show_native_context_menu(
    window: tauri::Window,
    paths: Vec<String>,
    x: i32,
    y: i32,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd_raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd_val = hwnd_raw.0 as isize;

        let (tx, rx) = tokio::sync::oneshot::channel();
        let paths_clone = paths.clone();
        
        window.run_on_main_thread(move || {
            let res = unsafe { platform::show_shell_context_menu(hwnd_val, &paths_clone, x, y) };
            let _ = tx.send(res);
        })
        .map_err(|e| e.to_string())?;

        rx.await.map_err(|_| "Channel closed".to_string())?
    }

    #[cfg(not(windows))]
    {
        let _ = (window, paths, x, y);
        Err("Native context menu is only supported on Windows".into())
    }
}

#[tauri::command]
pub async fn get_native_context_menu_items(
    window: tauri::Window,
    paths: Vec<String>,
) -> Result<Vec<NativeMenuItem>, String> {
    #[cfg(windows)]
    {
        let hwnd_raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd_val = hwnd_raw.0 as isize;

        let (tx, rx) = tokio::sync::oneshot::channel();
        
        window.run_on_main_thread(move || {
            let res = unsafe { platform::get_shell_context_menu_items(hwnd_val, &paths) };
            let _ = tx.send(res);
        })
        .map_err(|e| e.to_string())?;

        rx.await.map_err(|_| "Channel closed".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, paths);
        Err("Supported only on Windows".into())
    }
}

#[tauri::command]
pub async fn invoke_native_context_command(
    window: tauri::Window,
    paths: Vec<String>,
    id: u32,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd_raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd_val = hwnd_raw.0 as isize;

        let (tx, rx) = tokio::sync::oneshot::channel();
        
        window.run_on_main_thread(move || {
            let res = unsafe { platform::invoke_shell_context_command(hwnd_val, &paths, id) };
            let _ = tx.send(res);
        })
        .map_err(|e| e.to_string())?;

        rx.await.map_err(|_| "Channel closed".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, paths, id);
        Err("Supported only on Windows".into())
    }
}

// ─── Windows implementation ──────────────────────────────────────────────────
#[cfg(windows)]
mod platform {
    use super::NativeMenuItem;
    use base64::Engine;
    use windows::{
        core::{Interface, PCWSTR},
        Win32::{
            Foundation::HWND,
            System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED},
            Graphics::Gdi::*,
            UI::{
                Shell::{Common::ITEMIDLIST, IContextMenu, IShellFolder, SHGetDesktopFolder},
                WindowsAndMessaging::*,
            },
        },
    };

    /// Extract HBITMAP pixel data and return as a base64 data:image/png URI
    unsafe fn hbitmap_to_base64(hbmp: HBITMAP) -> Option<String> {
        let hdc_screen = GetDC(HWND(0));
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        
        // Get bitmap info
        let mut bmp = BITMAP::default();
        let got = GetObjectW(
            hbmp,
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut _),
        );
        if got == 0 || bmp.bmWidth <= 0 || bmp.bmHeight <= 0 {
            DeleteDC(hdc_mem);
            ReleaseDC(HWND(0), hdc_screen);
            return None;
        }

        let w = bmp.bmWidth as u32;
        let h = bmp.bmHeight as u32;

        // Setup BITMAPINFO for 32-bit BGRA
        let mut bi = BITMAPINFO::default();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = w as i32;
        bi.bmiHeader.biHeight = -(h as i32); // top-down
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = 0; // BI_RGB

        let mut pixels: Vec<u8> = vec![0u8; (w * h * 4) as usize];
        let old = SelectObject(hdc_mem, hbmp);
        let result = GetDIBits(
            hdc_mem,
            hbmp,
            0,
            h,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bi,
            DIB_RGB_COLORS,
        );
        SelectObject(hdc_mem, old);
        DeleteDC(hdc_mem);
        ReleaseDC(HWND(0), hdc_screen);

        if result == 0 {
            return None;
        }

        // Convert BGRA to RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2); // B <-> R
            // If alpha is 0 for all pixels, set to 255 (non-premultiplied bitmaps)
        }
        
        // Check if all alpha is 0 (non-alpha bitmap)
        let all_alpha_zero = pixels.chunks_exact(4).all(|c| c[3] == 0);
        if all_alpha_zero {
            for chunk in pixels.chunks_exact_mut(4) {
                chunk[3] = 255;
            }
        }

        // Encode as PNG using the `image` crate
        let img = image::RgbaImage::from_raw(w, h, pixels)?;
        let mut png_buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut png_buf, image::ImageFormat::Png).ok()?;
        
        let b64 = base64::engine::general_purpose::STANDARD.encode(png_buf.into_inner());
        Some(format!("data:image/png;base64,{}", b64))
    }

    pub unsafe fn show_shell_context_menu(hwnd_val: isize, paths: &[String], x: i32, y: i32) -> Result<(), String> {
        let hwnd = HWND(hwnd_val);
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = do_show_menu(hwnd, paths, x, y);
        CoUninitialize();
        result
    }

    pub unsafe fn get_shell_context_menu_items(hwnd_val: isize, paths: &[String]) -> Result<Vec<NativeMenuItem>, String> {
        let hwnd = HWND(hwnd_val);
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = do_get_items(hwnd, paths);
        CoUninitialize();
        result
    }

    pub unsafe fn invoke_shell_context_command(hwnd_val: isize, paths: &[String], id: u32) -> Result<(), String> {
        let hwnd = HWND(hwnd_val);
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = do_invoke_command(hwnd, paths, id);
        CoUninitialize();
        result
    }

    unsafe fn build_context_menu(hwnd: HWND, paths: &[String]) -> Result<(IContextMenu, HMENU, u32, Vec<*mut ITEMIDLIST>, *mut ITEMIDLIST), String> {
        if paths.is_empty() { return Err("No paths provided".into()); }
        let first = std::path::Path::new(&paths[0]);
        let is_root = first.parent().is_none();
        
        let desktop: IShellFolder = SHGetDesktopFolder().map_err(|e| format!("SHGetDesktopFolder: {e}"))?;
        
        let parent_folder: IShellFolder;
        let mut child_pidls: Vec<*mut ITEMIDLIST> = Vec::new();
        let mut parent_pidl: *mut ITEMIDLIST = std::ptr::null_mut();

        if is_root {
            parent_folder = desktop;
            for path_str in paths {
                let wide: Vec<u16> = path_str.encode_utf16().chain(Some(0)).collect();
                let mut child_pidl: *mut ITEMIDLIST = std::ptr::null_mut();
                parent_folder.ParseDisplayName(hwnd, None, PCWSTR(wide.as_ptr()), None, &mut child_pidl, std::ptr::null_mut())
                    .map_err(|e| format!("ParseDisplayName (root '{path_str}'): {e}"))?;
                child_pidls.push(child_pidl);
            }
        } else {
            let parent_dir = first.parent().unwrap();
            let parent_wide: Vec<u16> = parent_dir.to_string_lossy().encode_utf16().chain(Some(0)).collect();
            desktop.ParseDisplayName(hwnd, None, PCWSTR(parent_wide.as_ptr()), None, &mut parent_pidl, std::ptr::null_mut())
                .map_err(|e| format!("ParseDisplayName (parent): {e}"))?;
            parent_folder = desktop.BindToObject(parent_pidl as *const _, None).map_err(|e| format!("BindToObject: {e}"))?;
            
            for path_str in paths {
                let filename = std::path::Path::new(path_str).file_name().unwrap_or_default().to_string_lossy();
                let name_wide: Vec<u16> = filename.encode_utf16().chain(Some(0)).collect();
                let mut child_pidl: *mut ITEMIDLIST = std::ptr::null_mut();
                parent_folder.ParseDisplayName(hwnd, None, PCWSTR(name_wide.as_ptr()), None, &mut child_pidl, std::ptr::null_mut())
                    .map_err(|e| format!("ParseDisplayName (child '{filename}'): {e}"))?;
                child_pidls.push(child_pidl);
            }
        }

        let child_refs: Vec<*const ITEMIDLIST> = child_pidls.iter().map(|p| *p as *const _).collect();
        let ctx_menu: IContextMenu = parent_folder.GetUIObjectOf(hwnd, &child_refs, None).map_err(|e| format!("GetUIObjectOf: {e}"))?;

        let hmenu = CreatePopupMenu().map_err(|e| format!("CreatePopupMenu: {e}"))?;
        let min_id: u32 = 1;
        let max_id: u32 = 0x7FFF;
        let flags = 0x00000000 | 0x00000004 | 0x00000100; // CMF_NORMAL | CMF_EXPLORE | CMF_EXTENDEDVERBS
        
        let _ = ctx_menu.QueryContextMenu(hmenu, 0, min_id, max_id, flags);

        Ok((ctx_menu, hmenu, min_id, child_pidls, parent_pidl))
    }

    unsafe fn do_show_menu(hwnd: HWND, paths: &[String], x: i32, y: i32) -> Result<(), String> {
        let (ctx_menu, hmenu, min_id, child_pidls, parent_pidl) = build_context_menu(hwnd, paths)?;
        
        let _ = SetForegroundWindow(hwnd);
        let cmd = TrackPopupMenu(hmenu, TPM_RETURNCMD | TPM_RIGHTBUTTON, x, y, 0, hwnd, None);

        if cmd.as_bool() && cmd.0 > 0 {
            invoke_command(&ctx_menu, hwnd, min_id, cmd.0 as u32);
        }

        let _ = DestroyMenu(hmenu);
        CoTaskMemFree(Some(parent_pidl as *const _));
        for pidl in child_pidls { CoTaskMemFree(Some(pidl as *const _)); }
        Ok(())
    }

    unsafe fn do_get_items(hwnd: HWND, paths: &[String]) -> Result<Vec<NativeMenuItem>, String> {
        let (ctx_menu, hmenu, _min_id, child_pidls, parent_pidl) = build_context_menu(hwnd, paths)?;
        
        let items = parse_hmenu(hmenu, &ctx_menu);

        let _ = DestroyMenu(hmenu);
        CoTaskMemFree(Some(parent_pidl as *const _));
        for pidl in child_pidls { CoTaskMemFree(Some(pidl as *const _)); }
        
        Ok(items)
    }

    unsafe fn parse_hmenu(hmenu: HMENU, ctx_menu: &IContextMenu) -> Vec<NativeMenuItem> {
        use windows::Win32::UI::Shell::{IContextMenu2, IContextMenu3};
        
        let mut items = Vec::new();
        let count = GetMenuItemCount(hmenu);
        for i in 0..count {
            let mut info = MENUITEMINFOW::default();
            info.cbSize = std::mem::size_of::<MENUITEMINFOW>() as u32;
            info.fMask = MIIM_FTYPE | MIIM_STRING | MIIM_ID | MIIM_SUBMENU | MIIM_BITMAP;
            
            if GetMenuItemInfoW(hmenu, i as u32, true, &mut info).is_ok() {
                if (info.fType & MFT_SEPARATOR) == MFT_SEPARATOR {
                    items.push(NativeMenuItem { id: 0, title: "".into(), is_separator: true, subitems: None, icon: None });
                } else {
                    let mut buf: [u16; 256] = [0; 256];
                    let len = GetMenuStringW(hmenu, i as u32, Some(&mut buf), MF_BYPOSITION);
                    let mut text = String::new();
                    if len > 0 {
                        text = String::from_utf16_lossy(&buf[..len as usize]).replace("&", "");
                    }
                    
                    let mut subitems = None;
                    if !info.hSubMenu.is_invalid() {
                        let wm_initmenupopup = 0x0117; // WM_INITMENUPOPUP
                        if let Ok(ctx3) = ctx_menu.cast::<IContextMenu3>() {
                            let _ = ctx3.HandleMenuMsg(wm_initmenupopup, windows::Win32::Foundation::WPARAM(info.hSubMenu.0 as usize), windows::Win32::Foundation::LPARAM(i as isize));
                        } else if let Ok(ctx2) = ctx_menu.cast::<IContextMenu2>() {
                            let _ = ctx2.HandleMenuMsg(wm_initmenupopup, windows::Win32::Foundation::WPARAM(info.hSubMenu.0 as usize), windows::Win32::Foundation::LPARAM(i as isize));
                        }
                        
                        subitems = Some(parse_hmenu(info.hSubMenu, &ctx_menu.clone()));
                    }
                    
                    // Extract icon from hbmpItem
                    let icon_data = if !info.hbmpItem.is_invalid() {
                        hbitmap_to_base64(info.hbmpItem)
                    } else {
                        None
                    };

                    if !text.is_empty() {
                        items.push(NativeMenuItem {
                            id: info.wID,
                            title: text,
                            is_separator: false,
                            subitems,
                            icon: icon_data,
                        });
                    }
                }
            }
        }
        items
    }

    unsafe fn do_invoke_command(hwnd: HWND, paths: &[String], id: u32) -> Result<(), String> {
        let (ctx_menu, hmenu, min_id, child_pidls, parent_pidl) = build_context_menu(hwnd, paths)?;
        
        invoke_command(&ctx_menu, hwnd, min_id, id);

        let _ = DestroyMenu(hmenu);
        CoTaskMemFree(Some(parent_pidl as *const _));
        for pidl in child_pidls { CoTaskMemFree(Some(pidl as *const _)); }
        Ok(())
    }

    unsafe fn invoke_command(ctx_menu: &IContextMenu, hwnd: HWND, min_id: u32, cmd_id: u32) {
        #[repr(C)]
        #[allow(non_snake_case)]
        struct CMINVOKECOMMANDINFO {
            cbSize: u32,
            fMask: u32,
            hwnd: HWND,
            lpVerb: *const u8,
            lpParameters: *const u8,
            lpDirectory: *const u8,
            nShow: i32,
            dwHotKey: u32,
            hIcon: isize,
        }

        let info = CMINVOKECOMMANDINFO {
            cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
            fMask: 0,
            hwnd,
            lpVerb: (cmd_id - min_id) as usize as *const u8,
            lpParameters: std::ptr::null(),
            lpDirectory: std::ptr::null(),
            nShow: 1, // SW_SHOWNORMAL
            dwHotKey: 0,
            hIcon: 0,
        };

        type InvokeCommandFn = unsafe extern "system" fn(*mut std::ffi::c_void, *const CMINVOKECOMMANDINFO) -> windows::core::HRESULT;
        let vtable = *(ctx_menu.as_raw() as *const *const *const std::ffi::c_void);
        let invoke: InvokeCommandFn = std::mem::transmute(*vtable.add(4));
        let _ = invoke(ctx_menu.as_raw(), &info);
    }
}

