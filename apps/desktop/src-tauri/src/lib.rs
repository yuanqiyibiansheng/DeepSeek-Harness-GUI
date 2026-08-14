use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent};
use url::Url;

mod diff_server;
struct BackendState(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.unminimize();
      }
    }))
    .setup(|app| {
      app.manage(BackendState(Mutex::new(None)));
      if let Ok(data_dir) = app.path().app_data_dir() {
        std::env::set_var("DSH_HOME", data_dir.join("dsh"));
      }
      diff_server::start();
      let handle = app.handle().clone();
      let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
      thread::spawn(move || {
        match start_backend(&handle) {
          Ok((child, port)) => {
            if let Some(state) = handle.try_state::<BackendState>() {
              if let Ok(mut guard) = state.0.lock() {
                *guard = Some(child);
              }
            }
            let url = format!("http://127.0.0.1:{port}").parse::<Url>();
            if let Ok(url) = url {
              let _ = window.navigate(url);
            }
          }
          Err(error) => {
            eprintln!("dsh desktop backend failed: {error}");
          }
        }
      });
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building DeepSeek Harness desktop shell")
    .run(|app, event| {
      if let RunEvent::Exit = event {
        if let Some(state) = app.try_state::<BackendState>() {
          if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.as_mut() {
              kill_tree(child);
            }
          }
        }
      }
    });
}

fn start_backend(app: &AppHandle) -> Result<(Child, u16), String> {
  let root = resolve_bundle_root(app).ok_or_else(|| {
    "desktop bundle not found; run pnpm run build from apps/desktop first".to_string()
  })?;
  let node = root.join("node").join("node.exe");
  let dsh = root.join("dsh");
  let entry = dsh.join("lib").join("bin.js");
  if !node.exists() || !entry.exists() {
    return Err(format!(
      "desktop bundle incomplete (node: {}, entry: {})",
      node.display(),
      entry.display()
    ));
  }

  let port = find_free_port(3080).ok_or_else(|| "no free local port available".to_string())?;
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("cannot resolve app data dir: {error}"))?;
  let dsh_home = data_dir.join("dsh");
  std::fs::create_dir_all(&dsh_home).map_err(|error| format!("cannot create DSH_HOME: {error}"))?;

  let mut command = Command::new(&node);
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
  }
  command
    .arg(&entry)
    .arg("web")
    .arg("--port")
    .arg(port.to_string())
    .current_dir(&dsh)
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .env("DSH_HOME", &dsh_home);
  if let Some(parent) = node.parent() {
    if let Ok(path) = std::env::var("PATH") {
      command.env("PATH", format!("{};{}", parent.display(), path));
    }
  }

  let mut child = command
    .spawn()
    .map_err(|error| format!("cannot start node backend: {error}"))?;

  let deadline = Instant::now() + Duration::from_secs(90);
  loop {
    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
      return Ok((child, port));
    }
    match child.try_wait() {
      Ok(Some(status)) => {
        kill_tree(&mut child);
        return Err(format!("dsh web exited early with {status}"));
      }
      Ok(None) => {}
      Err(error) => {
        kill_tree(&mut child);
        return Err(format!("cannot inspect backend process: {error}"));
      }
    }
    if Instant::now() > deadline {
      kill_tree(&mut child);
      return Err("dsh web did not start within 90 seconds".to_string());
    }
    thread::sleep(Duration::from_millis(200));
  }
}

fn find_free_port(start: u16) -> Option<u16> {
  (start..start + 200).find(|port| TcpListener::bind(("127.0.0.1", *port)).is_ok())
}

fn resolve_bundle_root(app: &AppHandle) -> Option<PathBuf> {
  let mut candidates = Vec::new();
  if let Ok(resource_dir) = app.path().resource_dir() {
    candidates.push(resource_dir.join("bundle"));
    candidates.push(resource_dir);
  }
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      candidates.push(dir.join("_up_").join("bundle"));
      candidates.push(dir.join("resources").join("bundle"));
      candidates.push(dir.join("resources"));
      candidates.push(dir.join("bundle"));
      candidates.push(dir.to_path_buf());
    }
  }
  if let Ok(cwd) = std::env::current_dir() {
    candidates.push(cwd.join("bundle"));
  }
  candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../bundle"));

  for root in candidates {
    if is_bundle_root(&root) {
      return Some(root);
    }
  }
  None
}

fn is_bundle_root(root: &Path) -> bool {
  root.join("node").join("node.exe").exists() && root.join("dsh").exists()
}

fn kill_tree(child: &mut Child) {
  #[cfg(windows)]
  {
    let pid = child.id();
    use std::os::windows::process::CommandExt;
    let _ = Command::new("taskkill")
      .args(["/PID", &pid.to_string(), "/T", "/F"])
      .creation_flags(0x08000000)
      .output();
  }
  let _ = child.kill();
  let _ = child.wait();
}
