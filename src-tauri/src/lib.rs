mod commands;

use commands::{
    batch_rename, context_cmds, convert, fs_ops, icons, mft_index, native_menu, search, system,
    watcher,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap());
            if !app_dir.exists() {
                let _ = std::fs::create_dir_all(&app_dir);
            }
            app.manage(commands::scores::ScoreStore::new(app_dir));
            app.manage(mft_index::MftCache::new());
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            // mft_index
            mft_index::build_mft_index,
            mft_index::search_mft,
            mft_index::increment_score,
            // fs_ops
            fs_ops::read_dir,
            fs_ops::prefetch_directory,
            fs_ops::get_folder_size,
            fs_ops::check_paste_conflicts,
            fs_ops::copy_items,
            fs_ops::move_items,
            fs_ops::delete_items,
            fs_ops::rename_item,
            fs_ops::create_folder,
            fs_ops::create_file,
            fs_ops::open_file,
            fs_ops::open_with_mpv,
            fs_ops::open_in_terminal,
            fs_ops::get_file_metadata,
            fs_ops::get_drives,
            fs_ops::get_system_paths,
            // watcher
            watcher::watch_directory,
            watcher::stop_watching,
            // search
            search::search_in_directory,
            // batch_rename
            batch_rename::preview_rename,
            batch_rename::apply_rename,
            // system
            system::trash_items,
            system::restore_trash_items,
            system::read_file_as_text,
            system::read_file_as_base64,
            system::path_exists,
            system::get_parent_path,
            system::join_path,
            system::set_wallpaper,
            system::empty_trash,
            // convert
            convert::convert_video_for_preview,
            // icons
            icons::get_file_icon,
            icons::get_file_icons_batch,
            icons::get_image_thumbnail,
            // context
            context_cmds::extract_archive,
            context_cmds::compress_items,
            context_cmds::rotate_image,
            context_cmds::convert_image,
            // native menu
            native_menu::show_native_context_menu,
            native_menu::get_native_context_menu_items,
            native_menu::invoke_native_context_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running explorer");
}
