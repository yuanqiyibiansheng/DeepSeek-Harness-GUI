fn main() {
  let icon = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("icons/icon.ico");
  tauri_build::try_build(
    tauri_build::Attributes::new()
      // Autogenerate the app ACL manifest for the desktop shell commands so
      // capabilities can grant them (allow-pet-control / allow-restart-service)
      // to remote-origin pages (main + pet windows load http://127.0.0.1:*).
      // Without an app manifest the commands are denied on remote origins.
      .app_manifest(tauri_build::AppManifest::new().commands(&[
        "pet_control",
        "restart_service",
        "restart_backend_in_place",
        "balance_query",
        "notify_task_done",
        "open_recharge",
      ]))
      .windows_attributes(
        tauri_build::WindowsAttributes::new().window_icon_path(icon),
      ),
  )
  .expect("tauri build failed");
}
