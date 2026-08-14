use std::ffi::OsStr;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use mslnk::ShellLink;
use serde::Serialize;
use winreg::enums::*;
use winreg::RegKey;

const APP_NAME: &str = "DeepSeek Harness";
const APP_EXE: &str = "DeepSeek Harness.exe";
const UNINSTALL_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeek Harness";
const PAYLOAD_ZIP: &[u8] = include_bytes!("../payload.zip");
const UNINSTALL_EXE: &[u8] = include_bytes!("../uninstall.exe");

#[cfg(target_os = "windows")]
extern "system" {
  fn GetDiskFreeSpaceExW(
    lpDirectoryName: *const u16,
    lpFreeBytesAvailableToCaller: *mut u64,
    lpTotalNumberOfBytes: *mut u64,
    lpTotalNumberOfFreeBytes: *mut u64,
  ) -> i32;
}

#[derive(Serialize)]
pub struct FileEntry {
  relative_path: String,
  size: u64,
}

#[tauri::command]
pub fn get_app_version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn get_default_install_path() -> String {
  if let Some(existing) = existing_install_path() {
    return existing;
  }
  let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
  Path::new(&program_files)
    .join(APP_NAME)
    .display()
    .to_string()
}

fn existing_install_path() -> Option<String> {
  let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
  let key = hklm.open_subkey_with_flags(UNINSTALL_KEY, KEY_READ).ok()?;
  let location: String = key.get_value("InstallLocation").ok()?;
  if Path::new(&location).join(APP_EXE).exists() {
    Some(location)
  } else {
    None
  }
}

#[tauri::command]
pub fn check_disk_space(path: String) -> Result<u64, String> {
  let drive = path
    .chars()
    .next()
    .filter(|c| c.is_ascii_alphabetic())
    .ok_or_else(|| "invalid path".to_string())?;
  let root = format!("{}:\\\\", drive);
  let wide: Vec<u16> = OsStr::new(&root)
    .encode_wide()
    .chain(std::iter::once(0))
    .collect();
  let mut free: u64 = 0;
  let mut total: u64 = 0;
  let mut total_free: u64 = 0;
  let result = unsafe {
    GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut total_free)
  };
  if result == 0 {
    Err(format!(
      "GetDiskFreeSpaceExW failed: {}",
      std::io::Error::last_os_error()
    ))
  } else {
    Ok(free)
  }
}

#[tauri::command]
pub fn get_resource_files() -> Result<Vec<FileEntry>, String> {
  let cursor = std::io::Cursor::new(PAYLOAD_ZIP);
  let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
  let mut files = Vec::new();
  for i in 0..archive.len() {
    let file = archive.by_index(i).map_err(|e| e.to_string())?;
    if !file.name().ends_with('/') {
      files.push(FileEntry {
        relative_path: file.name().to_string(),
        size: file.size(),
      });
    }
  }
  Ok(files)
}

#[tauri::command]
pub fn install(target_dir: String, create_desktop_shortcut: bool) -> Result<(), String> {
  let target = PathBuf::from(&target_dir);
  fs::create_dir_all(&target).map_err(|e| e.to_string())?;
  extract_payload(&target)?;
  register_uninstall(&target_dir)?;
  write_uninstall_script(&target)?;
  fs::write(target.join("uninstall.exe"), UNINSTALL_EXE).map_err(|e| e.to_string())?;
  create_shortcut(APP_NAME, &target.join(APP_EXE), "StartMenu")?;
  if create_desktop_shortcut {
    create_shortcut(APP_NAME, &target.join(APP_EXE), "Desktop")?;
  }
  Ok(())
}

#[tauri::command]
pub fn cancel_install(target_dir: String) -> Result<(), String> {
  let path = Path::new(&target_dir);
  if path.exists() {
    fs::remove_dir_all(path).map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
pub fn launch_installed_app(target_dir: String) -> Result<(), String> {
  let exe = Path::new(&target_dir).join(APP_EXE);
  if !exe.exists() {
    return Err(format!("{} not found", APP_EXE));
  }
  Command::new(&exe).spawn().map_err(|e| e.to_string())?;
  Ok(())
}

fn extract_payload(target: &Path) -> Result<(), String> {
  let cursor = std::io::Cursor::new(PAYLOAD_ZIP);
  let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
  for i in 0..archive.len() {
    let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
    let name = file.name().to_string().replace('\\', "/");
    let out = target.join(&name);
    if name.ends_with('/') {
      fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    } else {
      if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
      }
      let mut f = fs::File::create(&out).map_err(|e| e.to_string())?;
      std::io::copy(&mut file, &mut f).map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

fn create_shortcut(name: &str, target_exe: &Path, location: &str) -> Result<(), String> {
  let folder = if location == "Desktop" {
    dirs::desktop_dir().ok_or_else(|| "no desktop folder".to_string())?
  } else {
    get_common_programs()?
  };
  let path = folder.join(format!("{}.lnk", name));
  let mut sl = ShellLink::new(target_exe).map_err(|e| e.to_string())?;
  sl.set_working_dir(Some(
    target_exe
      .parent()
      .unwrap_or_else(|| Path::new(""))
      .to_string_lossy()
      .to_string(),
  ));
  sl.create_lnk(&path).map_err(|e| e.to_string())?;
  Ok(())
}

fn get_common_programs() -> Result<PathBuf, String> {
  extern "system" {
    fn SHGetFolderPathW(
      hwnd: *mut std::ffi::c_void,
      csidl: i32,
      h_token: *mut std::ffi::c_void,
      dw_flags: u32,
      psz_path: *mut u16,
    ) -> i32;
  }
  const CSIDL_COMMON_PROGRAMS: i32 = 0x0017;
  let mut buf = vec![0u16; 260];
  let result = unsafe {
    SHGetFolderPathW(
      std::ptr::null_mut(),
      CSIDL_COMMON_PROGRAMS,
      std::ptr::null_mut(),
      0,
      buf.as_mut_ptr(),
    )
  };
  if result == 0 {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Ok(PathBuf::from(String::from_utf16_lossy(&buf[..len])))
  } else {
    Err("SHGetFolderPathW failed".to_string())
  }
}

fn register_uninstall(install_dir: &str) -> Result<(), String> {
  let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
  let (key, _) = hklm.create_subkey(UNINSTALL_KEY).map_err(|e| e.to_string())?;
  let exe = format!("{}\\{}", install_dir, APP_EXE);
  let uninstaller = format!("\"{}\\uninstall.exe\"", install_dir);
  key.set_value("DisplayName", &APP_NAME).map_err(|e| e.to_string())?;
  key.set_value("DisplayVersion", &env!("CARGO_PKG_VERSION")).map_err(|e| e.to_string())?;
  key.set_value("DisplayIcon", &exe).map_err(|e| e.to_string())?;
  key.set_value("Publisher", &"DeepSeek AI").map_err(|e| e.to_string())?;
  key.set_value("InstallLocation", &install_dir).map_err(|e| e.to_string())?;
  key.set_value(
    "UninstallString",
    &format!(
      "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\"",
      uninstaller
    ),
  )
  .map_err(|e| e.to_string())?;
  key.set_value("NoModify", &1u32).map_err(|e| e.to_string())?;
  key.set_value("NoRepair", &1u32).map_err(|e| e.to_string())?;
  key.set_value("EstimatedSize", &250_000u32).map_err(|e| e.to_string())?;
  Ok(())
}

fn write_uninstall_script(target: &Path) -> Result<(), String> {
  let dir = target.display().to_string().replace('\'', "''");
  let script = format!(
    "$ErrorActionPreference = 'SilentlyContinue'\r\n\
     Remove-Item -LiteralPath ([Environment]::GetFolderPath('Desktop') + '\\DeepSeek Harness.lnk') -Force\r\n\
     Remove-Item -LiteralPath ([Environment]::GetFolderPath('Programs') + '\\DeepSeek Harness.lnk') -Force\r\n\
     Remove-Item -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DeepSeek Harness' -Recurse -Force\r\n\
     Remove-Item -LiteralPath '{}' -Recurse -Force\r\n",
    dir
  );
  fs::write(target.join("uninstall.ps1"), script).map_err(|e| e.to_string())?;
  Ok(())
}