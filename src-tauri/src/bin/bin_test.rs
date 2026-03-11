#![allow(dead_code)]
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::Path;
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    Common::ITEMIDLIST, IContextMenu, IContextMenu2, IContextMenu3, IShellFolder,
    SHGetDesktopFolder,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreatePopupMenu, DestroyMenu, GetMenuItemCount, GetMenuItemInfoW, GetMenuStringW, HMENU,
    MENUITEMINFOW, MFT_SEPARATOR, MF_BYPOSITION, MIIM_BITMAP, MIIM_DATA, MIIM_FTYPE, MIIM_ID,
    MIIM_STATE, MIIM_STRING, MIIM_SUBMENU,
};

fn parse_hmenu(hmenu: HMENU, depth: usize, ctx_menu: &IContextMenu) {
    unsafe {
        let count = GetMenuItemCount(hmenu);
        let prefix = "  ".repeat(depth);
        for i in 0..count {
            let mut info = MENUITEMINFOW::default();
            info.cbSize = std::mem::size_of::<MENUITEMINFOW>() as u32;
            info.fMask = MIIM_FTYPE | MIIM_STRING | MIIM_ID | MIIM_SUBMENU;

            if GetMenuItemInfoW(hmenu, i as u32, true, &mut info).is_ok() {
                if (info.fType & MFT_SEPARATOR) == MFT_SEPARATOR {
                    println!("{}[Separator]", prefix);
                } else {
                    let mut buf: [u16; 256] = [0; 256];
                    let len = GetMenuStringW(hmenu, i as u32, Some(&mut buf), MF_BYPOSITION);
                    let mut clean_text = String::new();
                    if len > 0 {
                        let text = String::from_utf16_lossy(&buf[..len as usize]);
                        clean_text = text.replace("&", "");
                    }

                    println!(
                        "{}[Item] ID: {}, Text: '{}', Has Submenu: {}",
                        prefix,
                        info.wID,
                        clean_text,
                        !info.hSubMenu.is_invalid()
                    );

                    if !info.hSubMenu.is_invalid() {
                        // try to send WM_INITMENUPOPUP
                        let wm_initmenupopup = 0x0117; // WM_INITMENUPOPUP
                        if let Ok(ctx3) =
                            ctx_menu.cast::<windows::Win32::UI::Shell::IContextMenu3>()
                        {
                            unsafe {
                                ctx3.HandleMenuMsg(
                                    wm_initmenupopup,
                                    windows::Win32::Foundation::WPARAM(info.hSubMenu.0 as usize),
                                    windows::Win32::Foundation::LPARAM(i as isize),
                                )
                                .ok();
                            }
                        } else if let Ok(ctx2) =
                            ctx_menu.cast::<windows::Win32::UI::Shell::IContextMenu2>()
                        {
                            unsafe {
                                ctx2.HandleMenuMsg(
                                    wm_initmenupopup,
                                    windows::Win32::Foundation::WPARAM(info.hSubMenu.0 as usize),
                                    windows::Win32::Foundation::LPARAM(i as isize),
                                )
                                .ok();
                            }
                        }

                        parse_hmenu(info.hSubMenu, depth + 1, &ctx_menu.clone());
                    }
                }
            }
        }
    }
}

fn main() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let test_path_str = "D:\\JStuff\\explorer test\\src\\main.tsx";
        let test_path = Path::new(test_path_str);

        let parent_dir = test_path.parent().unwrap();
        let filename = test_path.file_name().unwrap();

        let desktop: IShellFolder = SHGetDesktopFolder().unwrap();
        let mut parent_pidl: *mut ITEMIDLIST = std::ptr::null_mut();

        let parent_wide: Vec<u16> = parent_dir
            .to_string_lossy()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        desktop
            .ParseDisplayName(
                HWND(0),
                None,
                PCWSTR(parent_wide.as_ptr()),
                None,
                &mut parent_pidl,
                std::ptr::null_mut(),
            )
            .unwrap();
        let parent_folder: IShellFolder =
            desktop.BindToObject(parent_pidl as *const _, None).unwrap();

        let mut child_pidl: *mut ITEMIDLIST = std::ptr::null_mut();
        let child_wide: Vec<u16> = filename
            .to_string_lossy()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        parent_folder
            .ParseDisplayName(
                HWND(0),
                None,
                PCWSTR(child_wide.as_ptr()),
                None,
                &mut child_pidl,
                std::ptr::null_mut(),
            )
            .unwrap();

        let child_refs = vec![child_pidl as *const ITEMIDLIST];
        let ctx_menu: IContextMenu = parent_folder
            .GetUIObjectOf(HWND(0), &child_refs, None)
            .unwrap();

        let hmenu = CreatePopupMenu().unwrap();
        let flags = 0x00000000 | 0x00000004 | 0x00000100;

        ctx_menu
            .QueryContextMenu(hmenu, 0, 1, 0x7FFF, flags)
            .unwrap();

        parse_hmenu(hmenu, 0, &ctx_menu);

        DestroyMenu(hmenu).unwrap();
        CoUninitialize();
    }
}
