/** Local code-review diff server for the desktop shell. */
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use rusqlite::{params, Connection};
use std::thread;
use std::time::{Duration, Instant};

pub fn start() {
  thread::spawn(|| {
    let listener = match TcpListener::bind(("127.0.0.1", 3199)) {
      Ok(listener) => listener,
      Err(_) => return,
    };
    for stream in listener.incoming().flatten() {
      let _ = handle(stream);
    }
  });
}

fn handle(stream: TcpStream) -> std::io::Result<()> {
  let mut reader = BufReader::new(stream.try_clone()?);
  let mut request_line = String::new();
  reader.read_line(&mut request_line)?;
  let mut parts = request_line.split_whitespace();
  let method = parts.next().unwrap_or("");
  let raw_target = parts.next().unwrap_or("/");
  let target = raw_target.split('?').next().unwrap_or("/");
  if method != "GET" || !target.starts_with("/code-review") {
    return write_response(stream, 404, r#"{"ok":false,"error":"not found"}"#);
  }
  let query = raw_target.split_once('?').map(|(_, q)| q).unwrap_or("");
  let cwd = percent_decode(query_param(query, "cwd"));
  if cwd.is_empty() {
    return write_response(stream, 400, r#"{"ok":false,"error":"cwd required"}"#);
  }
  let session = percent_decode(query_param(query, "session"));
  let message = percent_decode(query_param(query, "message"));

  if target == "/code-review/snapshot" {
    if session.is_empty() {
      return write_response(stream, 400, r#"{"ok":false,"error":"session required"}"#);
    }
    if !message.is_empty() {
      return match open_history(&cwd).and_then(|conn| create_message_snapshot(&conn, &cwd, &session, &message)) {
        Ok(order) => write_response(
          stream,
          200,
          &format!(r#"{{"ok":true,"message":{}}}"#, json_string(&format!("message snapshot {}", order))),
        ),
        Err(error) => write_response(
          stream,
          200,
          &format!(r#"{{"ok":false,"error":{}}}"#, json_string(&error)),
        ),
      };
    }
    return match open_history(&cwd).and_then(|conn| initialize_session(&conn, &cwd, &session)) {
      Ok(count) => write_response(
        stream,
        200,
        &format!(r#"{{"ok":true,"message":{}}}"#, json_string(&format!("snapshotted {} files", count))),
      ),
      Err(error) => write_response(
        stream,
        200,
        &format!(r#"{{"ok":false,"error":{}}}"#, json_string(&error)),
      ),
    };
  }

  if target == "/code-review/rollback/status" {
    if session.is_empty() {
      return write_response(stream, 400, r#"{"ok":false,"error":"session required"}"#);
    }
    let snapshot = open_history(&cwd).map(|conn| {
      conn.query_row(
        r#"SELECT COUNT(*) FROM file_state WHERE session = ?1"#,
        params![session],
        |row| row.get::<_, i64>(0),
      ).unwrap_or(0) > 0
    }).unwrap_or(false);
    return write_response(
      stream,
      200,
      &format!(r#"{{"ok":true,"snapshot":{}}}"#, snapshot),
    );
  }

  if target == "/code-review/rollback" {
    if session.is_empty() {
      return write_response(stream, 400, r#"{"ok":false,"error":"session required"}"#);
    }
    let rollback = if message.is_empty() {
      open_history(&cwd).and_then(|conn| rollback_session(&conn, &cwd, &session))
    } else {
      open_history(&cwd).and_then(|conn| rollback_message_session(&conn, &cwd, &session, &message))
    };
    return match rollback {
      Ok(result) => {
        let restored = result.restored.iter().map(|p| json_string(p)).collect::<Vec<_>>().join(",");
        let deleted = result.deleted.iter().map(|p| json_string(p)).collect::<Vec<_>>().join(",");
        write_response(
          stream,
          200,
          &format!(r#"{{"ok":true,"restored":[{restored}],"deleted":[{deleted}],"logRestored":{logRestored}}}"#, logRestored = result.log_restored),
        )
      }
      Err(error) => write_response(
        stream,
        200,
        &format!(r#"{{"ok":false,"error":{}}}"#, json_string(&error)),
      ),
    };
  }

  if target == "/code-review/watch" {
    let since = query_param(query, "since").to_string();
    thread::spawn(move || {
      let _ = watch_changes(stream, cwd, since, session);
    });
    return Ok(());
  }

  let root = match git_root(&cwd) {
    Some(root) => root,
    None => {
      return write_response(
        stream,
        200,
        r#"{"ok":false,"error":"current directory is not inside a git repository"}"#,
      );
    }
  };
  let raw_files = run_git(&cwd, &["status", "--porcelain", "-uall", "--", "."]);
  let files = filter_binary_untracked(&root, &raw_files);
  let numstat = filter_binary_numstat(&run_git(&cwd, &["diff", "--numstat", "--", "."]));
  let stat = run_git(&cwd, &["diff", "--stat", "--", "."]);
  let diff = filter_binary_diff(&run_git(&cwd, &["diff", "--unified=3", "--", "."]));
  let new_files = untracked_contents(&root, &files);
  let fingerprint = fingerprint(&cwd, &root);
  let body = format!(
    r#"{{"ok":true,"root":{},"cwd":{},"files":{},"numstat":{},"stat":{},"diff":{},"newFiles":{},"fingerprint":{}}}"#,
    json_string(&root), json_string(&cwd), json_string(&files), json_string(&numstat), json_string(&stat), json_string(&diff), json_string(&new_files), json_string(&fingerprint)
  );
  write_response(stream, 200, &body)
}

const ROLLBACK_EXCLUDES: &[&str] = &[
  ".git", "node_modules", ".pnpm", "target", "dist", "build", ".next",
  ".cache", "coverage", ".recode", "__pycache__", ".venv", "venv",
];

fn sanitize_session(session: &str) -> String {
  session
    .chars()
    .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
    .collect()
}

fn encode_segment(raw: &str) -> String {
  let mut out = String::new();
  for c in raw.chars() {
    if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
      out.push(c);
    } else {
      let code = c as u32;
      out.push('~');
      out.push_str(&format!("{:04X}", code & 0xFFFF));
    }
  }
  out
}

fn find_session_log(session: &str) -> Option<PathBuf> {
  let root = std::env::var_os("DSH_HOME").map(PathBuf::from)?;
  let sessions = root.join("sessions");
  if !sessions.is_dir() {
    return None;
  }
  let encoded = encode_segment(session);
  let mut stack = vec![sessions];
  while let Some(dir) = stack.pop() {
    let entries = std::fs::read_dir(&dir).ok()?;
    for entry in entries.flatten() {
      let path = entry.path();
      let file_type = entry.file_type().ok()?;
      if file_type.is_dir() {
        stack.push(path);
      } else if file_type.is_file() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if (name == "session.jsonl" || name == "session.jsonl.zstd")
          && path.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()) == Some(encoded.clone())
        {
          return Some(path);
        }
      }
    }
  }
  None
}

fn session_baseline(cwd: &str, session: &str) -> PathBuf {
  Path::new(cwd).join(".recode").join(format!("{}.session.baseline", sanitize_session(session)))
}

fn snapshot_session_log(cwd: &str, session: &str) -> Result<bool, String> {
  snapshot_session_log_for_order(cwd, session, 0)
}

fn log_offset_file(cwd: &str, session: &str, order: i64) -> PathBuf {
  Path::new(cwd).join(".recode").join(format!("{}.{}.log-offset", sanitize_session(session), order))
}

fn restore_session_log_for_order(cwd: &str, session: &str, order: i64) -> Result<bool, String> {
  let offset_file = log_offset_file(cwd, session, order);
  if !offset_file.exists() {
    return Ok(false);
  }
  let text = std::fs::read_to_string(&offset_file)
    .map_err(|error| format!("cannot read log offset: {error}"))?;
  let offset: u64 = text.trim().parse()
    .map_err(|_| "corrupt log offset".to_string())?;
  let Some(log) = find_session_log(session) else {
    return Ok(false);
  };
  let file = std::fs::OpenOptions::new().write(true).open(&log)
    .map_err(|error| format!("cannot open session log: {error}"))?;
  file.set_len(offset)
    .map_err(|error| format!("cannot truncate session log: {error}"))?;
  Ok(true)
}

fn restore_session_log(cwd: &str, session: &str) -> Result<bool, String> {
  restore_session_log_for_order(cwd, session, 0)
}


fn open_history(cwd: &str) -> Result<Connection, String> {
  let recode_dir = Path::new(cwd).join(".recode");
  std::fs::create_dir_all(&recode_dir)
    .map_err(|error| format!("cannot create .recode: {error}"))?;
  let conn = Connection::open(recode_dir.join("history.db"))
    .map_err(|error| format!("cannot open history.db: {error}"))?;
  conn.execute_batch(
    r#"CREATE TABLE IF NOT EXISTS file_state (
      session TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT,
      PRIMARY KEY (session, path)
    );
    CREATE TABLE IF NOT EXISTS changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session TEXT NOT NULL,
      path TEXT NOT NULL,
      old_content TEXT,
      new_content TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_changes_session ON changes(session);
    CREATE TABLE IF NOT EXISTS message_snapshots (
      session TEXT NOT NULL,
      message_id TEXT NOT NULL,
      order_no INTEGER NOT NULL,
      path TEXT NOT NULL,
      content TEXT,
      PRIMARY KEY (session, message_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_message_snapshots_order ON message_snapshots(session, order_no);"#,
  ).map_err(|error| format!("cannot initialize history.db: {error}"))?;
  Ok(conn)
}

fn should_skip(rel: &Path) -> bool {
  rel.components().any(|component| {
    let name = component.as_os_str().to_string_lossy();
    ROLLBACK_EXCLUDES.contains(&name.as_ref())
  })
}

fn collect_files(root: &Path) -> std::io::Result<Vec<PathBuf>> {
  let mut files = Vec::new();
  let mut stack = vec![PathBuf::new()];
  while let Some(rel) = stack.pop() {
    let dir = root.join(&rel);
    for entry in std::fs::read_dir(&dir)? {
      let entry = entry?;
      let child_rel = rel.join(entry.file_name());
      if should_skip(&child_rel) {
        continue;
      }
      let file_type = entry.file_type()?;
      if file_type.is_dir() {
        stack.push(child_rel);
      } else if file_type.is_file() {
        files.push(child_rel);
      }
    }
  }
  files.sort();
  Ok(files)
}

fn normalize_path(path: &Path) -> String {
  path.to_string_lossy().replace('\\', "/")
}

fn read_text_file(path: &Path) -> Option<String> {
  let bytes = std::fs::read(path).ok()?;
  if bytes.contains(&0) {
    return None;
  }
  String::from_utf8(bytes).ok()
}

fn initialize_session(conn: &Connection, cwd: &str, session: &str) -> Result<usize, String> {
  let existing: i64 = conn.query_row(
    r#"SELECT COUNT(*) FROM file_state WHERE session = ?1"#,
    params![session],
    |row| row.get(0),
  ).unwrap_or(0);
  if existing > 0 {
    let _ = snapshot_session_log(cwd, session);
    return Ok(existing as usize);
  }
  conn.execute(r#"DELETE FROM file_state WHERE session = ?1"#, params![session])
    .map_err(|error| format!("cannot clear session state: {error}"))?;
  let files = collect_files(Path::new(cwd))
    .map_err(|error| format!("cannot scan workspace: {error}"))?;
  let mut count = 0;
  for rel in &files {
    if let Some(content) = read_text_file(&Path::new(cwd).join(rel)) {
      let path = normalize_path(rel);
      conn.execute(
        r#"INSERT INTO file_state (session, path, content) VALUES (?1, ?2, ?3)"#,
        params![session, path, content],
      ).map_err(|error| format!("cannot store {}: {error}", path))?;
      count += 1;
    }
  }
  let _ = snapshot_session_log(cwd, session);
  Ok(count)
}

fn record_changes(conn: &Connection, cwd: &str, session: &str) -> Result<usize, String> {
  let mut state: HashMap<String, Option<String>> = HashMap::new();
  {
    let mut stmt = conn.prepare(r#"SELECT path, content FROM file_state WHERE session = ?1"#)
      .map_err(|error| format!("cannot prepare state query: {error}"))?;
    let rows = stmt.query_map(params![session], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|error| format!("cannot query state: {error}"))?;
    for row in rows {
      let (path, content) = row.map_err(|error| format!("cannot read state row: {error}"))?;
      state.insert(path, content);
    }
  }

  let mut current: HashMap<String, String> = HashMap::new();
  let files = collect_files(Path::new(cwd))
    .map_err(|error| format!("cannot scan workspace: {error}"))?;
  for rel in &files {
    if let Some(content) = read_text_file(&Path::new(cwd).join(rel)) {
      current.insert(normalize_path(rel), content);
    }
  }

  let timestamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|duration| duration.as_millis().to_string())
    .unwrap_or_default();
  let mut count = 0;

  for (path, new_content) in &current {
    let old = state.get(path).cloned().flatten();
    if old.as_deref() != Some(new_content.as_str()) {
      conn.execute(
        r#"INSERT INTO changes (session, path, old_content, new_content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"#,
        params![session, path, old, new_content, timestamp],
      ).map_err(|error| format!("cannot record change for {}: {error}", path))?;
      conn.execute(
        r#"INSERT OR REPLACE INTO file_state (session, path, content) VALUES (?1, ?2, ?3)"#,
        params![session, path, new_content],
      ).map_err(|error| format!("cannot update state for {}: {error}", path))?;
      count += 1;
    }
  }

  for (path, old) in &state {
    if !current.contains_key(path) {
      conn.execute(
        r#"INSERT INTO changes (session, path, old_content, new_content, created_at) VALUES (?1, ?2, ?3, NULL, ?4)"#,
        params![session, path, old, timestamp],
      ).map_err(|error| format!("cannot record deletion for {}: {error}", path))?;
      conn.execute(
        r#"DELETE FROM file_state WHERE session = ?1 AND path = ?2"#,
        params![session, path],
      ).map_err(|error| format!("cannot clear state for {}: {error}", path))?;
      count += 1;
    }
  }

  Ok(count)
}

struct RollbackResult {
  restored: Vec<String>,
  deleted: Vec<String>,
  log_restored: bool,
}

fn rollback_session(conn: &Connection, cwd: &str, session: &str) -> Result<RollbackResult, String> {
  let mut stmt = conn.prepare(
    r#"SELECT path, old_content FROM changes WHERE session = ?1 ORDER BY id ASC"#,
  ).map_err(|error| format!("cannot prepare rollback query: {error}"))?;
  let rows = stmt.query_map(params![session], |row| {
    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
  }).map_err(|error| format!("cannot query rollback rows: {error}"))?;
  let mut targets: HashMap<String, Option<String>> = HashMap::new();
  for row in rows {
    let (path, old) = row.map_err(|error| format!("cannot read rollback row: {error}"))?;
    if !targets.contains_key(&path) {
      targets.insert(path, old);
    }
  }

  let mut result = RollbackResult {
    restored: Vec::new(),
    deleted: Vec::new(),
    log_restored: false,
  };
  for (path, content) in targets {
    let full = Path::new(cwd).join(&path);
    match content {
      Some(text) => {
        if let Some(parent) = full.parent() {
          std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create parent for {}: {error}", full.display()))?;
        }
        std::fs::write(&full, text)
          .map_err(|error| format!("cannot restore {}: {error}", full.display()))?;
        result.restored.push(path);
      }
      None => {
        if full.is_file() {
          std::fs::remove_file(&full)
            .map_err(|error| format!("cannot delete {}: {error}", full.display()))?;
          result.deleted.push(path);
        }
      }
    }
  }
  let log_restored = restore_session_log(cwd, session).unwrap_or(false);
  Ok(RollbackResult {
    restored: result.restored,
    deleted: result.deleted,
    log_restored,
  })
}

fn next_message_order(conn: &Connection, session: &str) -> Result<i64, String> {
  conn.query_row(
    r#"SELECT COALESCE(MAX(order_no), 0) FROM message_snapshots WHERE session = ?1"#,
    params![session],
    |row| row.get(0),
  ).map_err(|error| format!("cannot read message order: {error}"))
}

fn create_message_snapshot(conn: &Connection, cwd: &str, session: &str, message_id: &str) -> Result<i64, String> {
  let initial_count: i64 = conn.query_row(
    r#"SELECT COUNT(*) FROM file_state WHERE session = ?1"#,
    params![session],
    |row| row.get(0),
  ).unwrap_or(0);
  if initial_count == 0 {
    let _ = initialize_session(conn, cwd, session)?;
  }

  let existing: i64 = conn.query_row(
    r#"SELECT COUNT(*) FROM message_snapshots WHERE session = ?1 AND message_id = ?2"#,
    params![session, message_id],
    |row| row.get(0),
  ).unwrap_or(0);
  if existing > 0 {
    return conn.query_row(
      r#"SELECT MIN(order_no) FROM message_snapshots WHERE session = ?1 AND message_id = ?2"#,
      params![session, message_id],
      |row| row.get(0),
    ).map_err(|error| format!("cannot read message order: {error}"));
  }
  let order = next_message_order(conn, session)? + 1;
  let files = collect_files(Path::new(cwd))
    .map_err(|error| format!("cannot scan workspace: {error}"))?;
  for rel in &files {
    if let Some(content) = read_text_file(&Path::new(cwd).join(rel)) {
      let path = normalize_path(rel);
      conn.execute(
        r#"INSERT INTO message_snapshots (session, message_id, order_no, path, content) VALUES (?1, ?2, ?3, ?4, ?5)"#,
        params![session, message_id, order, path, content],
      ).map_err(|error| format!("cannot store message snapshot {}: {error}", path))?;
    }
  }
  snapshot_session_log_for_order(cwd, session, order)?;
  Ok(order)
}

fn snapshot_session_log_for_order(cwd: &str, session: &str, order: i64) -> Result<bool, String> {
  let Some(log) = find_session_log(session) else {
    return Ok(false);
  };
  let len = std::fs::metadata(&log)
    .map(|meta| meta.len())
    .map_err(|error| format!("cannot read session log size: {error}"))?;
  let offset_file = log_offset_file(cwd, session, order);
  if let Some(parent) = offset_file.parent() {
    std::fs::create_dir_all(parent)
      .map_err(|error| format!("cannot create .recode: {error}"))?;
  }
  std::fs::write(&offset_file, len.to_string())
    .map_err(|error| format!("cannot write log offset: {error}"))?;
  Ok(true)
}

fn restore_files(cwd: &str, targets: HashMap<String, Option<String>>) -> Result<RollbackResult, String> {
  let mut result = RollbackResult {
    restored: Vec::new(),
    deleted: Vec::new(),
    log_restored: false,
  };
  for (path, content) in targets {
    let full = Path::new(cwd).join(&path);
    match content {
      Some(text) => {
        if let Some(parent) = full.parent() {
          std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create parent for {}: {error}", full.display()))?;
        }
        std::fs::write(&full, text)
          .map_err(|error| format!("cannot restore {}: {error}", full.display()))?;
        result.restored.push(path);
      }
      None => {
        if full.is_file() {
          std::fs::remove_file(&full)
            .map_err(|error| format!("cannot delete {}: {error}", full.display()))?;
          result.deleted.push(path);
        }
      }
    }
  }
  Ok(result)
}

fn rollback_message_session(conn: &Connection, cwd: &str, session: &str, message_id: &str) -> Result<RollbackResult, String> {
  let order: i64 = conn.query_row(
    r#"SELECT MIN(order_no) FROM message_snapshots WHERE session = ?1 AND message_id = ?2"#,
    params![session, message_id],
    |row| row.get(0),
  ).map_err(|error| format!("cannot find message snapshot: {error}"))?;
  let target_order = order;
  let mut targets: HashMap<String, Option<String>> = HashMap::new();
  if target_order <= 0 {
    let mut stmt = conn.prepare(r#"SELECT path, content FROM file_state WHERE session = ?1"#)
      .map_err(|error| format!("cannot prepare initial state query: {error}"))?;
    let rows = stmt.query_map(params![session], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|error| format!("cannot query initial state: {error}"))?;
    for row in rows {
      let (path, content) = row.map_err(|error| format!("cannot read initial state row: {error}"))?;
      targets.insert(path, content);
    }
  } else {
    let mut stmt = conn.prepare(
      r#"SELECT path, content FROM message_snapshots WHERE session = ?1 AND order_no = ?2"#,
    ).map_err(|error| format!("cannot prepare message snapshot query: {error}"))?;
    let rows = stmt.query_map(params![session, target_order], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|error| format!("cannot query message snapshot: {error}"))?;
    for row in rows {
      let (path, content) = row.map_err(|error| format!("cannot read message snapshot row: {error}"))?;
      targets.insert(path, content);
    }
  }

  let mut result = restore_files(cwd, targets)?;
  result.log_restored = restore_session_log_for_order(cwd, session, target_order).unwrap_or(false);
  Ok(result)
}


fn record_changes_for_session(cwd: &str, session: &str) {
  if session.is_empty() {
    return;
  }
  if let Ok(conn) = open_history(cwd) {
    let _ = record_changes(&conn, cwd, session);
  }
}

fn watch_changes(stream: TcpStream, cwd: String, since: String, session: String) -> std::io::Result<()> {
  let root = match git_root(&cwd) {
    Some(root) => root,
    None => {
      return write_response(
        stream,
        200,
        r#"{"ok":false,"error":"current directory is not inside a git repository"}"#,
      );
    }
  };
  let current = fingerprint(&cwd, &root);
  if since.is_empty() || since != current {
    record_changes_for_session(&cwd, &session);
    return write_response(
      stream,
      200,
      &format!(r#"{{"ok":true,"changed":true,"fingerprint":{}}}"#, json_string(&current)),
    );
  }
  let deadline = Instant::now() + Duration::from_secs(30);
  while Instant::now() < deadline {
    thread::sleep(Duration::from_millis(1000));
    let next = fingerprint(&cwd, &root);
    if next != current {
      record_changes_for_session(&cwd, &session);
      return write_response(
        stream,
        200,
        &format!(r#"{{"ok":true,"changed":true,"fingerprint":{}}}"#, json_string(&next)),
      );
    }
  }
  write_response(
    stream,
    200,
    &format!(r#"{{"ok":true,"changed":false,"fingerprint":{}}}"#, json_string(&current)),
  )
}

fn git_root(cwd: &str) -> Option<String> {
  let root = run_git(cwd, &["rev-parse", "--show-toplevel"]);
  let root = root.trim();
  if root.is_empty() || root.starts_with("fatal:") || root.starts_with("git unavailable") {
    None
  } else {
    Some(root.to_string())
  }
}

fn is_binary(root: &str, path: &str) -> bool {
  let full = Path::new(root).join(path);
  let mut file = match File::open(&full) {
    Ok(file) => file,
    Err(_) => return false,
  };
  let mut buffer = [0u8; 8192];
  let read = file.read(&mut buffer).unwrap_or(0);
  buffer[..read].contains(&0)
}

fn untracked_path(line: &str) -> &str {
  let trimmed = line[3..].trim();
  if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
    &trimmed[1..trimmed.len() - 1]
  } else {
    trimmed
  }
}

fn filter_binary_untracked(root: &str, files: &str) -> String {
  let mut out = String::new();
  for line in files.lines() {
    if line.starts_with("?? ") && !untracked_path(line).is_empty() && is_binary(root, untracked_path(line)) {
      continue;
    }
    out.push_str(line);
    out.push('\n');
  }
  out
}

fn filter_binary_numstat(numstat: &str) -> String {
  let mut out = String::new();
  for line in numstat.lines() {
    let mut parts = line.split('\t');
    let added = parts.next().unwrap_or("");
    let deleted = parts.next().unwrap_or("");
    if added == "-" && deleted == "-" {
      continue;
    }
    out.push_str(line);
    out.push('\n');
  }
  out
}

fn filter_binary_diff(diff: &str) -> String {
  let mut sections = Vec::new();
  let mut current = String::new();
  let mut in_section = false;
  for line in diff.lines() {
    if line.starts_with("diff --git ") {
      if in_section {
        sections.push(current.clone());
      }
      current = String::new();
      in_section = true;
    }
    if in_section {
      current.push_str(line);
      current.push('\n');
    }
  }
  if in_section {
    sections.push(current);
  }
  let mut out = String::new();
  for section in sections {
    if section.contains("Binary files ") || section.contains("GIT binary patch") {
      continue;
    }
    out.push_str(&section);
  }
  out
}

fn untracked_contents(root: &str, files: &str) -> String {
  let mut out = String::new();
  for line in files.lines() {
    if !line.starts_with("?? ") {
      continue;
    }
    let path = untracked_path(line);
    if path.is_empty() || is_binary(root, path) {
      continue;
    }
    let full = Path::new(root).join(path);
    let mut bytes = Vec::new();
    let file = match File::open(&full) {
      Ok(file) => file,
      Err(_) => continue,
    };
    let _ = file.take(1_048_576).read_to_end(&mut bytes);
    let content = String::from_utf8_lossy(&bytes);
    out.push_str("\n===== new file: ");
    out.push_str(path);
    out.push_str(" =====\n");
    out.push_str(&content);
    if !content.ends_with('\n') {
      out.push('\n');
    }
    if bytes.len() >= 1_048_576 {
      out.push_str("[truncated]\n");
    }
  }
  out
}

fn fingerprint(cwd: &str, root: &str) -> String {
  let status = filter_binary_untracked(root, &run_git(cwd, &["status", "--porcelain", "-uall", "--", "."]));
  let raw = run_git(cwd, &["diff", "--raw", "--", "."]);
  let new_files = untracked_contents(root, &status);
  let mut hasher = DefaultHasher::new();
  status.hash(&mut hasher);
  raw.hash(&mut hasher);
  new_files.hash(&mut hasher);
  format!("{:016x}", hasher.finish())
}

fn query_param<'a>(query: &'a str, name: &str) -> &'a str {
  query.split('&').find_map(|pair| {
    let (key, value) = pair.split_once('=')?;
    (key == name).then_some(value)
  }).unwrap_or("")
}

fn run_git(cwd: &str, args: &[&str]) -> String {
  let mut command = Command::new("git");
  command.arg("-C").arg(cwd).args(args);
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
  }
  let output = command.output();
  match output {
    Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout).into_owned(),
    Ok(output) => String::from_utf8_lossy(&output.stderr).into_owned(),
    Err(error) => format!("git unavailable: {error}"),
  }
}

fn percent_decode(input: &str) -> String {
  let bytes = input.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' && i + 2 < bytes.len() {
      if let (Some(high), Some(low)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
        out.push((high << 4) | low);
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

fn hex(byte: u8) -> Option<u8> {
  match byte {
    b'0'..=b'9' => Some(byte - b'0'),
    b'a'..=b'f' => Some(byte - b'a' + 10),
    b'A'..=b'F' => Some(byte - b'A' + 10),
    _ => None,
  }
}

fn json_string(value: &str) -> String {
  let mut out = String::with_capacity(value.len() + 2);
  out.push('"');
  for ch in value.chars() {
    match ch {
      '"' => out.push_str("\\\""),
      '\\' => out.push_str("\\\\"),
      '\n' => out.push_str("\\n"),
      '\r' => out.push_str("\\r"),
      '\t' => out.push_str("\\t"),
      '\u{0008}' => out.push_str("\\b"),
      '\u{000C}' => out.push_str("\\f"),
      c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
      c => out.push(c),
    }
  }
  out.push('"');
  out
}

fn write_response(mut stream: TcpStream, status: u16, body: &str) -> std::io::Result<()> {
  let reason = if status == 200 { "OK" } else if status == 400 { "Bad Request" } else { "Not Found" };
  let response = format!(
    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    body.len(), body
  );
  stream.write_all(response.as_bytes())?;
  stream.flush()
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn test_cwd() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("dsh-rollback-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::create_dir_all(dir.join("node_modules")).unwrap();
    dir
  }

  #[test]
  fn snapshot_record_and_rollback_round_trip() {
    let cwd = test_cwd();
    let cwd_str = cwd.to_string_lossy().into_owned();
    fs::write(cwd.join("src/a.txt"), "one").unwrap();
    fs::write(cwd.join("node_modules/skip.txt"), "skip").unwrap();
    let conn = open_history(&cwd_str).unwrap();
    initialize_session(&conn, &cwd_str, "s1").unwrap();
    fs::write(cwd.join("src/a.txt"), "two").unwrap();
    fs::write(cwd.join("src/b.txt"), "new").unwrap();
    let recorded = record_changes(&conn, &cwd_str, "s1").unwrap();
    assert_eq!(recorded, 2);
    let result = rollback_session(&conn, &cwd_str, "s1").unwrap();
    assert_eq!(fs::read_to_string(cwd.join("src/a.txt")).unwrap(), "one");
    assert!(!cwd.join("src/b.txt").exists());
    assert!(cwd.join("node_modules/skip.txt").exists());
    assert_eq!(result.restored.len(), 1);
    assert_eq!(result.deleted.len(), 1);
    let _ = fs::remove_dir_all(&cwd);
  }
}

