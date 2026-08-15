fn main() {
  let icon = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("icons/icon.ico");
  tauri_build::try_build(
    tauri_build::Attributes::new()
      // Autogenerate the app ACL manifest for `pet_control` so capabilities
      // can grant it (app:default) to remote-origin pages (main + pet windows
      // load http://127.0.0.1:*). Without an app manifest the command is
      // denied on remote origins.
      .app_manifest(tauri_build::AppManifest::new().commands(&["pet_control"]))
      .windows_attributes(
        tauri_build::WindowsAttributes::new().window_icon_path(icon),
      ),
  )
  .expect("tauri build failed");
}
