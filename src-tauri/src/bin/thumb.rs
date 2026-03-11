use windows::{
    core::{PCWSTR, Interface},
    Win32::{
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED},
        UI::Shell::{SHCreateItemFromParsingName, IShellItemImageFactory, SIIGBF_RESIZETOFIT, SIIGBF_MEMORYONLY},
        Foundation::SIZE,
    },
};

fn main() {
    let path = "C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg";
    let size = 256;
    
    let wide: Vec<u16> = path.encode_utf16().chain(Some(0u16)).collect();
    let pcwstr = PCWSTR(wide.as_ptr());

    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).unwrap() };

    let factory: IShellItemImageFactory = unsafe { 
        SHCreateItemFromParsingName(pcwstr, None).unwrap() 
    };
    
    let size_struct = SIZE { cx: size as i32, cy: size as i32 };
    let flags = SIIGBF_RESIZETOFIT;
    
    let hbitmap = unsafe { factory.GetImage(size_struct, flags).unwrap() };
    println!("Got HBITMAP: {:?}", hbitmap.0);
    
    unsafe { CoUninitialize() };
}
