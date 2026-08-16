mod installer;

use installer::*;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      let main = app
        .get_webview_window("main")
        .ok_or("main window missing")?;
      // The window starts hidden to avoid a black startup frame; show it
      // after the frontend had time to mount even if the JS show call fails.
      std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let _ = main.show();
      });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_default_install_path,
      check_disk_space,
      get_resource_files,
      install,
      cancel_install,
      launch_installed_app,
      get_app_version
    ])
    .run(tauri::generate_context!())
    .expect("error while running DeepSeek Harness setup");
}
