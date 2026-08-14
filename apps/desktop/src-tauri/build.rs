fn main() {
  let icon = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("icons/icon.ico");
  tauri_build::try_build(
    tauri_build::Attributes::new().windows_attributes(
      tauri_build::WindowsAttributes::new().window_icon_path(icon),
    ),
  )
  .expect("tauri build failed");
}