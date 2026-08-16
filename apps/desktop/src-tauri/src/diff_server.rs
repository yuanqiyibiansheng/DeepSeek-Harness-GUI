/** Local code-review diff server for the desktop shell. */
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use rusqlite::{params, Connection};
use std::thread;
use std::time::{Duration, Instant};

/** How long a snapshot-review response stays cached before recomputation. */
const REVIEW_CACHE_TTL: Duration = Duration::from_secs(3);

/** One cached snapshot-review body, keyed by (cwd, session). */
static REVIEW_CACHE: OnceLock<Mutex<std::collections::HashMap<(String, String), (Instant, String)>>> = OnceLock::new();

fn review_cache() -> &'static Mutex<std::collections::HashMap<(String, String), (Instant, String)>> {
  REVIEW_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

pub fn start() {
  // Any panicking request thread must leave a readable trace: the desktop
  // shell discards stderr, so mirror the panic to a log next to the temp dir.
  std::panic::set_hook(Box::new(|info| {
    let message = format!("dsh-diff-server panic: {info}\n");
    eprint!("{message}");
    if let Some(dir) = std::env::temp_dir().to_str().map(String::from) {
      use std::io::Write;
      let _ = std::fs::OpenOptions::new().create(true).append(true)
        .open(std::path::Path::new(&dir).join("dsh-diff-server-panic.log"))
        .and_then(|mut file| file.write_all(message.as_bytes()));
    }
  }));
  thread::spawn(|| {
    // Retry binding for a few seconds instead of dying silently: the previous
    // instance's socket may still be closing when the app relaunches, and a
    // fetch in that window is what the client reads as "Failed to fetch".
    let listener = loop {
      match TcpListener::bind(("127.0.0.1", 3199)) {
        Ok(listener) => break listener,
        Err(_) => thread::sleep(Duration::from_millis(200)),
      }
    };
    // One thread per connection: a slow request (a full message snapshot on a
    // big workspace) must not stall the review/rollback requests behind it —
    // serial handling is what made the second drawer open appear empty. A
    // panicking handler must not kill the server silently either: the panic
    // is caught and logged next to the history db, so a regression surfaces
    // as a readable file instead of a raw RST the client reads as
    // "Failed to fetch".
    for stream in listener.incoming().flatten() {
      thread::spawn(move || {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
          let _ = handle(stream);
        }));
      });
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
  let scope = percent_decode(query_param(query, "scope"));
  let scope = if scope.is_empty() { "both".to_string() } else { scope };

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

  if target == "/code-review/snapshots" {
    if session.is_empty() {
      return write_response(stream, 400, r#"{"ok":false,"error":"session required"}"#);
    }
    let snapshots = open_history(&cwd)
      .and_then(|conn| list_message_snapshots(&conn, &session))
      .map(|items| serde_json::json!({ "ok": true, "snapshots": items }).to_string())
      .unwrap_or_else(|error| serde_json::json!({ "ok": false, "error": error }).to_string());
    return write_response(stream, 200, &snapshots);
  }

  if target == "/code-review/rollback/preview" {
    if session.is_empty() || message.is_empty() {
      return write_response(stream, 400, r#"{"ok":false,"error":"session and message required"}"#);
    }
    return match preview_message_rollback(&cwd, &session, &message, &scope) {
      Ok(body) => write_response(stream, 200, &body),
      Err(error) => write_response(
        stream,
        200,
        &format!(r#"{{"ok":false,"error":{}}}"#, json_string(&error)),
      ),
    };
  }

  if target == "/code-review/rollback" {
    if session.is_empty() {
      return write_response(stream, 400, r#"{"ok":false,"error":"session required"}"#);
    }
    let rollback = if message.is_empty() {
      open_history(&cwd).and_then(|conn| rollback_session(&conn, &cwd, &session, &scope))
    } else {
      open_history(&cwd).and_then(|conn| rollback_message_session(&conn, &cwd, &session, &message, &scope))
    };
    return match rollback {
      Ok(result) => {
        let restored = result.restored.iter().map(|p| json_string(p)).collect::<Vec<_>>().join(",");
        let deleted = result.deleted.iter().map(|p| json_string(p)).collect::<Vec<_>>().join(",");
        let skipped = result.skipped.iter().map(|p| json_string(p)).collect::<Vec<_>>().join(",");
        write_response(
          stream,
          200,
          &format!(r#"{{"ok":true,"restored":[{restored}],"deleted":[{deleted}],"skipped":[{skipped}],"logRestored":{logRestored}}}"#, logRestored = result.log_restored),
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
      // No git repository: serve a session-baseline review from the history
      // snapshot when a session is known, so the code-review drawer still
      // shows what this conversation changed in a plain folder.
      if session.is_empty() {
        return write_response(
          stream,
          200,
          r#"{"ok":false,"error":"current directory is not inside a git repository"}"#,
        );
      }
      let cache_key = (cwd.clone(), session.clone());
      if let Some((at, cached)) = review_cache().lock().unwrap().get(&cache_key).cloned() {
        if at.elapsed() < REVIEW_CACHE_TTL {
          return write_response(stream, 200, &cached);
        }
      }
      return match snapshot_review(&cwd, &session) {
        Ok((files, numstat, stat, diff, new_files)) => {
          let fingerprint = format!("snapshot-{}", session);
          let body = format!(
            r#"{{"ok":true,"root":"","cwd":{},"files":{},"numstat":{},"stat":{},"diff":{},"newFiles":{},"fingerprint":{},"snapshot":true}}"#,
            json_string(&cwd), json_string(&files), json_string(&numstat), json_string(&stat), json_string(&diff), json_string(&new_files), json_string(&fingerprint)
          );
          review_cache().lock().unwrap().insert(cache_key, (Instant::now(), body.clone()));
          write_response(stream, 200, &body)
        }
        Err(error) => write_response(
          stream,
          200,
          &format!(r#"{{"ok":false,"error":{}}}"#, json_string(&error)),
        ),
      };
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


/**
 * Run a batch of writes inside ONE transaction. rusqlite auto-commits every
 * statement otherwise, so a full-workspace snapshot of tens of thousands of
 * rows would pay one transaction per row (the dominant cost of the slow
 * review the snapshot paths used to suffer).
 * @param conn - the history connection.
 * @param work - the write batch; its error rolls the transaction back.
 * @returns the batch result.
 */
fn batch_transaction<T>(conn: &Connection, work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
  // BEGIN IMMEDIATE takes the write lock up front: with one thread per
  // connection, concurrent snapshot requests would otherwise interleave and
  // one of them could see a half-written state (or both see an empty
  // baseline and both run the full scan). Serializing writers also keeps
  // the exclusive VACUUM from starving against a busy writer.
  conn.execute_batch("BEGIN IMMEDIATE").map_err(|error| format!("cannot begin batch: {error}"))?;
  match work() {
    Ok(value) => {
      conn.execute_batch("COMMIT").map_err(|error| format!("cannot commit batch: {error}"))?;
      Ok(value)
    }
    Err(error) => {
      let _ = conn.execute_batch("ROLLBACK");
      Err(error)
    }
  }
}

fn open_history(cwd: &str) -> Result<Connection, String> {
  let recode_dir = Path::new(cwd).join(".recode");
  std::fs::create_dir_all(&recode_dir)
    .map_err(|error| format!("cannot create .recode: {error}"))?;
  let conn = Connection::open(recode_dir.join("history.db"))
    .map_err(|error| format!("cannot open history.db: {error}"))?;
  // Connections are now per-request threads; a concurrent snapshot write must
  // wait instead of failing with SQLITE_BUSY.
  conn.busy_timeout(std::time::Duration::from_secs(10))
    .map_err(|error| format!("cannot set busy timeout: {error}"))?;
  conn.execute_batch(
    r#"CREATE TABLE IF NOT EXISTS changes (
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
    CREATE INDEX IF NOT EXISTS idx_message_snapshots_order ON message_snapshots(session, order_no);
    CREATE TABLE IF NOT EXISTS file_meta (
      session TEXT NOT NULL,
      path TEXT NOT NULL,
      mtime TEXT NOT NULL,
      PRIMARY KEY (session, path)
    );"#,
  ).map_err(|error| format!("cannot initialize history.db: {error}"))?;
  // One-time migration: the old design stored a FULL content copy of every
  // workspace text file per message snapshot plus a full-content file_state,
  // which made history.db balloon on large workspaces. Snapshots are now
  // differential (only changed files), so the full-content table is dropped
  // and the space reclaimed exactly once (user_version guards the VACUUM,
  // which needs an exclusive lock and must not run per connection).
  let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap_or(0);
  if version < 1 {
    // Best-effort: VACUUM needs the exclusive lock, which a concurrent
    // snapshot write may hold. Skipping defers the reclamation; the old
    // table is never read by the new code, so functionality is unaffected.
    let _ = conn.execute_batch("DROP TABLE IF EXISTS file_state; VACUUM; PRAGMA user_version = 1;");
  }
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
    r#"SELECT COUNT(*) FROM file_meta WHERE session = ?1"#,
    params![session],
    |row| row.get(0),
  ).unwrap_or(0);
  if existing > 0 {
    let _ = snapshot_session_log(cwd, session);
    return Ok(existing as usize);
  }
  conn.execute(r#"DELETE FROM file_meta WHERE session = ?1"#, params![session])
    .map_err(|error| format!("cannot clear session meta: {error}"))?;
  let files = collect_files(Path::new(cwd))
    .map_err(|error| format!("cannot scan workspace: {error}"))?;
  // Track only path + mtime — never file contents — so the first message
  // snapshot can detect what changed without a full-content baseline table.
  let count = batch_transaction(conn, || {
    let mut count = 0;
    for rel in &files {
      let path = normalize_path(rel);
      let full = Path::new(cwd).join(&path);
      if let Some(meta) = std::fs::metadata(&full).ok() {
        if let Ok(mtime) = meta.modified() {
          conn.execute(
            r#"INSERT OR REPLACE INTO file_meta (session, path, mtime) VALUES (?1, ?2, ?3)"#,
            params![session, path, mtime.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis().to_string()).unwrap_or_default()],
          ).map_err(|error| format!("cannot store meta {}: {error}", path))?;
          count += 1;
        }
      }
    }
    Ok(count)
  })?;
  let _ = snapshot_session_log(cwd, session);
  Ok(count)
}

fn record_changes(conn: &Connection, cwd: &str, session: &str) -> Result<usize, String> {
  // The comparison reference is each path's LATEST changes row (its most
  // recent known content); paths never recorded fall back to the FIRST
  // message snapshot (the session baseline), so a first-time change records
  // the true initial content as its old side.
  let mut latest: HashMap<String, Option<String>> = HashMap::new();
  {
    let mut stmt = conn.prepare(
      r#"SELECT c.path, c.new_content FROM changes c
         JOIN (SELECT path, MAX(id) AS mid FROM changes WHERE session = ?1 GROUP BY path) m
         ON c.id = m.mid"#,
    ).map_err(|error| format!("cannot prepare latest query: {error}"))?;
    let rows = stmt.query_map(params![session], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|error| format!("cannot query latest: {error}"))?;
    for row in rows {
      let (path, content) = row.map_err(|error| format!("cannot read latest row: {error}"))?;
      latest.insert(path, content);
    }
  }
  let first_order: Option<i64> = conn.query_row(
    r#"SELECT MIN(order_no) FROM message_snapshots WHERE session = ?1"#,
    params![session],
    |row| row.get(0),
  ).unwrap_or(None);
  if let Some(first_order) = first_order {
    let mut stmt = conn.prepare(r#"SELECT path, content FROM message_snapshots WHERE session = ?1 AND order_no = ?2"#)
      .map_err(|error| format!("cannot prepare baseline query: {error}"))?;
    let rows = stmt.query_map(params![session, first_order], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|error| format!("cannot query baseline: {error}"))?;
    for row in rows {
      let (path, content) = row.map_err(|error| format!("cannot read baseline row: {error}"))?;
      latest.entry(path).or_insert(content);
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

  let count = batch_transaction(conn, || {
    let mut count = 0;
    for (path, new_content) in &current {
      let old = latest.get(path).cloned().flatten();
      if old.as_deref() != Some(new_content.as_str()) {
        conn.execute(
          r#"INSERT INTO changes (session, path, old_content, new_content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"#,
          params![session, path, old, new_content, timestamp],
        ).map_err(|error| format!("cannot record change for {}: {error}", path))?;
        count += 1;
      }
    }

    for (path, old) in &latest {
      if old.is_some() && !current.contains_key(path) {
        conn.execute(
          r#"INSERT INTO changes (session, path, old_content, new_content, created_at) VALUES (?1, ?2, ?3, NULL, ?4)"#,
          params![session, path, old, timestamp],
        ).map_err(|error| format!("cannot record deletion for {}: {error}", path))?;
        count += 1;
      }
    }
    Ok(count)
  })?;

  Ok(count)
}

struct RollbackResult {
  restored: Vec<String>,
  deleted: Vec<String>,
  /** Targets that were refused or unreadable (path escapes, symlinks, binaries). */
  skipped: Vec<String>,
  log_restored: bool,
}

fn rollback_session(conn: &Connection, cwd: &str, session: &str, scope: &str) -> Result<RollbackResult, String> {
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
    skipped: Vec::new(),
    log_restored: false,
  };
  if scope != "conversation" {
    result = restore_files(cwd, targets)?;
  }
  if scope != "code" {
    result.log_restored = restore_session_log(cwd, session).unwrap_or(false);
  }
  Ok(result)
}

fn next_message_order(conn: &Connection, session: &str) -> Result<i64, String> {
  conn.query_row(
    r#"SELECT COALESCE(MAX(order_no), 0) FROM message_snapshots WHERE session = ?1"#,
    params![session],
    |row| row.get(0),
  ).map_err(|error| format!("cannot read message order: {error}"))
}

fn list_message_snapshots(conn: &Connection, session: &str) -> Result<Vec<serde_json::Value>, String> {
  let mut stmt = conn.prepare(
    r#"SELECT message_id, MIN(order_no) FROM message_snapshots
       WHERE session = ?1 GROUP BY message_id ORDER BY MIN(order_no) ASC"#,
  ).map_err(|error| format!("cannot prepare snapshots query: {error}"))?;
  let rows = stmt.query_map(params![session], |row| {
    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
  }).map_err(|error| format!("cannot query snapshots: {error}"))?;
  let mut items = Vec::new();
  for row in rows {
    let (message_id, order_no) = row.map_err(|error| format!("cannot read snapshot row: {error}"))?;
    items.push(serde_json::json!({ "messageId": message_id, "orderNo": order_no }));
  }
  Ok(items)
}

fn create_message_snapshot(conn: &Connection, cwd: &str, session: &str, message_id: &str) -> Result<i64, String> {
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
  let has_snapshots: i64 = conn.query_row(
    r#"SELECT COUNT(*) FROM message_snapshots WHERE session = ?1"#,
    params![session],
    |row| row.get(0),
  ).unwrap_or(0);
  let files = collect_files(Path::new(cwd))
    .map_err(|error| format!("cannot scan workspace: {error}"))?;
  // Differential snapshot: the FIRST snapshot stores every text file (the
  // session baseline); later ones store only files whose mtime moved since
  // the last snapshot, plus NULL rows for files that disappeared. Unchanged
  // files never enter the database.
  batch_transaction(conn, || {
    let mut meta: HashMap<String, String> = HashMap::new();
    if has_snapshots > 0 {
      let mut stmt = conn.prepare(r#"SELECT path, mtime FROM file_meta WHERE session = ?1"#)
        .map_err(|error| format!("cannot prepare meta query: {error}"))?;
      let rows = stmt.query_map(params![session], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
      }).map_err(|error| format!("cannot query meta: {error}"))?;
      for row in rows {
        let (path, mtime) = row.map_err(|error| format!("cannot read meta row: {error}"))?;
        meta.insert(path, mtime);
      }
    }
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for rel in &files {
      let path = normalize_path(rel);
      seen.insert(path.clone());
      let full = Path::new(cwd).join(&path);
      let mtime = std::fs::metadata(&full).ok()
        .and_then(|m| m.modified().ok())
        .map(|t| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis().to_string()).unwrap_or_default());
      let known = meta.get(&path);
      // First snapshot, or a changed/untracked mtime: record the file.
      if has_snapshots == 0 || known.is_none() || known.map(String::as_str) != mtime.as_deref() {
        let content = read_text_file(&full);
        conn.execute(
          r#"INSERT INTO message_snapshots (session, message_id, order_no, path, content) VALUES (?1, ?2, ?3, ?4, ?5)"#,
          params![session, message_id, order, path, content],
        ).map_err(|error| format!("cannot store message snapshot {}: {error}", path))?;
        match mtime {
          Some(mtime) => {
            conn.execute(
              r#"INSERT OR REPLACE INTO file_meta (session, path, mtime) VALUES (?1, ?2, ?3)"#,
              params![session, path, mtime],
            ).map_err(|error| format!("cannot update meta {}: {error}", path))?;
          }
          None => {
            conn.execute(
              r#"DELETE FROM file_meta WHERE session = ?1 AND path = ?2"#,
              params![session, path],
            ).map_err(|error| format!("cannot clear meta {}: {error}", path))?;
          }
        }
      }
    }
    // Files tracked before but gone now: record a NULL row (the file did not
    // exist at this snapshot) and drop the meta entry.
    for (path, _) in &meta {
      if !seen.contains(path) {
        conn.execute(
          r#"INSERT INTO message_snapshots (session, message_id, order_no, path, content) VALUES (?1, ?2, ?3, ?4, NULL)"#,
          params![session, message_id, order, path],
        ).map_err(|error| format!("cannot store deleted snapshot {}: {error}", path))?;
        conn.execute(
          r#"DELETE FROM file_meta WHERE session = ?1 AND path = ?2"#,
          params![session, path],
        ).map_err(|error| format!("cannot clear meta {}: {error}", path))?;
      }
    }
    Ok(())
  })?;
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
    skipped: Vec::new(),
    log_restored: false,
  };
  for (path, content) in targets {
    match safe_target(cwd, &path) {
      Ok(full) => {
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
            let is_plain_file = full.symlink_metadata()
              .map(|meta| meta.file_type().is_file())
              .unwrap_or(false);
            if is_plain_file {
              std::fs::remove_file(&full)
                .map_err(|error| format!("cannot delete {}: {error}", full.display()))?;
              result.deleted.push(path);
            }
          }
        }
      }
      Err(reason) => result.skipped.push(format!("{path}: {reason}")),
    }
  }
  Ok(result)
}

/**
 * Resolve one restore target and verify it stays inside the workspace: the
 * canonicalized parent directory must be under the canonicalized cwd (so `..`
 * components or a tampered history.db cannot escape the workspace), and the
 * target itself must not be a symbolic link (restoring through a link would
 * write outside the intended location).
 * @param cwd - the workspace root.
 * @param path - the snapshot-relative target path.
 * @returns the verified absolute target, or the refusal reason.
 */
fn safe_target(cwd: &str, path: &str) -> Result<std::path::PathBuf, String> {
  let candidate = Path::new(cwd).join(path);
  let parent = candidate.parent().ok_or_else(|| format!("{} has no parent", candidate.display()))?;
  let root = std::fs::canonicalize(cwd)
    .map_err(|error| format!("cannot resolve workspace root: {error}"))?;
  let canon_parent = std::fs::canonicalize(parent)
    .map_err(|error| format!("cannot resolve parent {}: {error}", parent.display()))?;
  if !canon_parent.starts_with(&root) {
    return Err(format!("{} escapes the workspace", candidate.display()));
  }
  if candidate.is_symlink() {
    return Err(format!("{} is a symbolic link; refusing to write through it", candidate.display()));
  }
  Ok(candidate)
}

fn rollback_message_session(conn: &Connection, cwd: &str, session: &str, message_id: &str, scope: &str) -> Result<RollbackResult, String> {
  let order: i64 = conn.query_row(
    r#"SELECT MIN(order_no) FROM message_snapshots WHERE session = ?1 AND message_id = ?2"#,
    params![session, message_id],
    |row| row.get(0),
  ).map_err(|error| format!("cannot find message snapshot: {error}"))?;
  let target_order = order;
  let mut targets: HashMap<String, Option<String>> = HashMap::new();
  if target_order <= 0 {
    // No snapshot at all: roll back to the session's first recorded contents
    // (each path's oldest changes row).
    let mut stmt = conn.prepare(
      r#"SELECT c.path, c.old_content FROM changes c
         JOIN (SELECT path, MIN(id) AS mid FROM changes WHERE session = ?1 GROUP BY path) m
         ON c.id = m.mid"#,
    ).map_err(|error| format!("cannot prepare initial state query: {error}"))?;
    let rows = stmt.query_map(params![session], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|error| format!("cannot query initial state: {error}"))?;
    for row in rows {
      let (path, content) = row.map_err(|error| format!("cannot read initial state row: {error}"))?;
      targets.insert(path, content);
    }
  } else {
    // Differential snapshots: each path's LATEST record at or before the
    // target order is that file's content at the target moment (the first
    // snapshot is the full session baseline).
    let mut stmt = conn.prepare(
      r#"SELECT s.path, s.content FROM message_snapshots s
         WHERE s.session = ?1 AND s.order_no <= ?2
           AND s.order_no = (SELECT MAX(order_no) FROM message_snapshots
                             WHERE session = ?1 AND order_no <= ?2 AND path = s.path)"#,
    ).map_err(|error| format!("cannot prepare message snapshot query: {error}"))?;
    let rows = stmt.query_map(params![session, target_order], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|error| format!("cannot query message snapshot: {error}"))?;
    for row in rows {
      let (path, content) = row.map_err(|error| format!("cannot read message snapshot row: {error}"))?;
      targets.insert(path, content);
    }
  }

  let mut result = RollbackResult {
    restored: Vec::new(),
    deleted: Vec::new(),
    skipped: Vec::new(),
    log_restored: false,
  };
  if scope != "conversation" {
    result = restore_files(cwd, targets)?;
  }
  if scope != "code" {
    result.log_restored = restore_session_log_for_order(cwd, session, target_order).unwrap_or(false);
  }
  Ok(result)
}

/**
 * Build the rollback preview for one user message: every file the snapshot
 * will restore, with its per-file diff and +/- counts against the current
 * content, plus the files that cannot be restored (binary or unreadable) so
 * the client can say so before the user confirms. Mirrors the cc-haha rewind
 * preview contract: state is `modified` (content differs), `created` (absent
 * at snapshot time, will be deleted), or `deleted` (will be recreated).
 */
fn preview_message_rollback(cwd: &str, session: &str, message_id: &str, scope: &str) -> Result<String, String> {
  if scope == "conversation" {
    return Ok(serde_json::json!({
      "ok": true, "files": [], "skipped": [],
      "totalAdditions": 0, "totalDeletions": 0, "restoreAvailable": true,
      "conversationOnly": true,
    }).to_string());
  }
  let conn = open_history(cwd)?;
  let order: Option<i64> = conn.query_row(
    r#"SELECT MIN(order_no) FROM message_snapshots WHERE session = ?1 AND message_id = ?2"#,
    params![session, message_id],
    |row| row.get(0),
  ).map_err(|error| format!("cannot find message snapshot: {error}"))?;
  let Some(order) = order else {
    return Ok(serde_json::json!({
      "ok": true, "files": [], "skipped": [],
      "totalAdditions": 0, "totalDeletions": 0, "restoreAvailable": false,
    }).to_string());
  };
  let mut files: Vec<serde_json::Value> = Vec::new();
  let mut skipped: Vec<String> = Vec::new();
  let mut total_additions = 0usize;
  let mut total_deletions = 0usize;

  let mut snapshot_paths: Vec<String> = Vec::new();
  {
    // Differential snapshots: the LATEST record per path at or before the
    // target order is that file's content at the target moment.
    let mut stmt = conn.prepare(
      r#"SELECT s.path, s.content FROM message_snapshots s
         WHERE s.session = ?1 AND s.order_no <= ?2
           AND s.order_no = (SELECT MAX(order_no) FROM message_snapshots
                             WHERE session = ?1 AND order_no <= ?2 AND path = s.path)
         ORDER BY s.path"#,
    ).map_err(|error| format!("cannot prepare preview query: {error}"))?;
    let rows = stmt.query_map(params![session, order], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|error| format!("cannot query preview: {error}"))?;
    for row in rows {
      let (path, content) = row.map_err(|error| format!("cannot read preview row: {error}"))?;
      snapshot_paths.push(path.clone());
      let full = Path::new(cwd).join(&path);
      let current = read_text_file(&full);
      let current_missing = !full.exists();
      match (content, current) {
        (Some(old), Some(new)) => {
          if old != new {
            let (diff, added, deleted) = line_diff(&old, &new, &path);
            if !diff.is_empty() {
              files.push(serde_json::json!({
                "path": path, "state": "modified",
                "additions": added, "deletions": deleted, "diff": diff,
              }));
              total_additions += added;
              total_deletions += deleted;
            }
          }
        }
        (Some(old), None) => {
          if current_missing {
            let (diff, _, deleted) = line_diff(&old, "", &path);
            files.push(serde_json::json!({
              "path": path, "state": "deleted",
              "additions": 0, "deletions": deleted, "diff": diff,
            }));
            total_deletions += deleted;
          } else {
            // The snapshot has text but the current file is binary or
            // unreadable: it WILL be restored (written back from the
            // snapshot), so list it without a diff rather than skip it.
            files.push(serde_json::json!({
              "path": path, "state": "modified",
              "additions": 0, "deletions": 0, "diff": "",
              "note": "current content is binary or unreadable; will be restored from snapshot",
            }));
          }
        }
        (None, Some(_new)) => {
          files.push(serde_json::json!({
            "path": path, "state": "created",
            "additions": 0, "deletions": 0, "diff": "",
          }));
        }
        (None, None) => {}
      }
    }
  }

  // Files that exist now but were absent at snapshot time appear only when
  // they are in the snapshot (None content); everything else the snapshot
  // does not know cannot be restored — the same honesty cc-haha applies.
  Ok(serde_json::json!({
    "ok": true,
    "files": files,
    "skipped": skipped,
    "totalAdditions": total_additions,
    "totalDeletions": total_deletions,
    "restoreAvailable": true,
  }).to_string())
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

/** Drop the single trailing empty element `split('\n')` leaves after a final newline. */
fn split_content_lines(content: &str) -> Vec<&str> {
  let mut lines: Vec<&str> = content.split('\n').collect();
  if lines.last() == Some(&"") {
    lines.pop();
  }
  lines
}

/**
 * Build one unified diff between two file contents: common prefix and suffix
 * lines are trimmed, the middle is replaced wholesale, and the whole change
 * renders as a single hunk. Empty when the contents are identical.
 * @returns the diff text (or empty), the added-line count, and the deleted-line count.
 */
fn line_diff(old: &str, new: &str, path: &str) -> (String, usize, usize) {
  let old_lines = split_content_lines(old);
  let new_lines = split_content_lines(new);
  let mut prefix = 0;
  while prefix < old_lines.len() && prefix < new_lines.len() && old_lines[prefix] == new_lines[prefix] {
    prefix += 1;
  }
  let mut suffix = 0;
  while suffix < old_lines.len() - prefix && suffix < new_lines.len() - prefix
    && old_lines[old_lines.len() - 1 - suffix] == new_lines[new_lines.len() - 1 - suffix] {
    suffix += 1;
  }
  let old_mid = old_lines.len() - prefix - suffix;
  let new_mid = new_lines.len() - prefix - suffix;
  if old_mid == 0 && new_mid == 0 {
    return (String::new(), 0, 0);
  }
  let mut out = String::new();
  out.push_str(&format!("diff --git a/{path} b/{path}\n"));
  out.push_str(&format!("--- a/{path}\n+++ b/{path}\n"));
  out.push_str(&format!("@@ -{},{} +{},{} @@\n", prefix + 1, old_mid, prefix + 1, new_mid));
  for line in &old_lines[prefix..prefix + old_mid] {
    out.push('-');
    out.push_str(line);
    out.push('\n');
  }
  for line in &new_lines[prefix..prefix + new_mid] {
    out.push('+');
    out.push_str(line);
    out.push('\n');
  }
  (out, new_mid, old_mid)
}

/**
 * Session-baseline review for workspaces without a git repository: the
 * baseline is the file_state snapshot (session start, overridden by each
 * path's first `changes` row), compared against the current file contents.
 * New files appear as `??` porcelain rows plus `newFiles` content; modified
 * and deleted files produce unified diffs and numstat rows. Returns the
 * review payload fields in the same shape the git path serves, with
 * `snapshot: true` so the client can skip git-based watching.
 */
fn snapshot_review(cwd: &str, session: &str) -> Result<(String, String, String, String, String), String> {
  let conn = open_history(cwd)?;
  // The baseline is the FIRST message snapshot (the full session baseline
  // taken when the first rollback probe ran); later snapshots are
  // differential. No snapshot yet means nothing to compare against — serve
  // an empty review instead of scanning the whole workspace.
  let first_order: Option<i64> = conn.query_row(
    r#"SELECT MIN(order_no) FROM message_snapshots WHERE session = ?1"#,
    params![session],
    |row| row.get(0),
  ).unwrap_or(None);
  let Some(first_order) = first_order else {
    return Ok((String::new(), String::new(), "0 file(s) changed".to_string(), String::new(), String::new()));
  };
  let mut baseline: HashMap<String, Option<String>> = HashMap::new();
  {
    let mut stmt = conn.prepare(r#"SELECT path, content FROM message_snapshots WHERE session = ?1 AND order_no = ?2"#)
      .map_err(|error| format!("cannot prepare snapshot baseline: {error}"))?;
    let rows = stmt.query_map(params![session, first_order], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|error| format!("cannot query snapshot baseline: {error}"))?;
    for row in rows {
      let (path, content) = row.map_err(|error| format!("cannot read snapshot baseline: {error}"))?;
      baseline.insert(path, content);
    }
  }

  // Fast path: read content ONLY for baseline-known paths (typically a small
  // set), then detect new/deleted files with a stat-only directory walk that
  // never reads file contents. A full content scan of a large workspace is
  // what used to make the first open take tens of seconds.
  let mut current: HashMap<String, String> = HashMap::new();
  for path in baseline.keys() {
    if let Some(content) = read_text_file(&Path::new(cwd).join(path)) {
      current.insert(path.clone(), content);
    }
  }

  let mut diff_text = String::new();
  let mut numstat = String::new();
  let mut porcelain = String::new();
  let mut new_files = String::new();
  let mut change_count = 0usize;

  // Modified and deleted files: compare the baseline against current content.
  let mut paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
  paths.extend(baseline.keys().cloned());
  paths.extend(current.keys().cloned());
  for path in paths {
    let old = baseline.get(&path).cloned().flatten();
    let new = current.get(&path).cloned();
    match (old, new) {
      (Some(old_text), None) => {
        let (diff, _, deleted) = line_diff(&old_text, "", &path);
        if !diff.is_empty() {
          diff_text.push_str(&diff);
          numstat.push_str(&format!("0\t{deleted}\t{path}\n"));
          change_count += 1;
        }
      }
      (Some(old_text), Some(new_text)) => {
        if old_text != new_text {
          let (diff, added, deleted) = line_diff(&old_text, &new_text, &path);
          if !diff.is_empty() {
            diff_text.push_str(&diff);
            numstat.push_str(&format!("{added}\t{deleted}\t{path}\n"));
            change_count += 1;
          }
        }
      }
      _ => {}
    }
  }

  // New files: any workspace file with no baseline CONTENT (a baseline key
  // with a NULL value means the file was created during the session and is
  // itself the new file).
  for rel in collect_files(Path::new(cwd)).map_err(|error| format!("cannot scan workspace: {error}"))? {
    let path = normalize_path(&rel);
    if baseline.get(&path).cloned().flatten().is_some() {
      continue;
    }
    if let Some(content) = read_text_file(&Path::new(cwd).join(&rel)) {
      porcelain.push_str(&format!("?? {path}\n"));
      new_files.push_str(&format!("\n===== new file: {path} =====\n{content}"));
      change_count += 1;
    }
  }

  let stat = format!("{change_count} file(s) changed");
  Ok((porcelain, numstat, stat, diff_text, new_files))
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

  fn test_cwd(suffix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("dsh-rollback-test-{}-{}", std::process::id(), suffix));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::create_dir_all(dir.join("node_modules")).unwrap();
    dir
  }

  #[test]
  fn snapshot_record_and_rollback_round_trip() {
    let cwd = test_cwd("roundtrip");
    let cwd_str = cwd.to_string_lossy().into_owned();
    fs::write(cwd.join("src/a.txt"), "one").unwrap();
    fs::write(cwd.join("node_modules/skip.txt"), "skip").unwrap();
    let conn = open_history(&cwd_str).unwrap();
    initialize_session(&conn, &cwd_str, "s1").unwrap();
    // The rollback probe creates the first (baseline) message snapshot before
    // any change recording happens, matching the real frontend flow.
    let _ = create_message_snapshot(&conn, &cwd_str, "s1", "m0").unwrap();
    fs::write(cwd.join("src/a.txt"), "two").unwrap();
    fs::write(cwd.join("src/b.txt"), "new").unwrap();
    let recorded = record_changes(&conn, &cwd_str, "s1").unwrap();
    assert_eq!(recorded, 2);
    let result = rollback_session(&conn, &cwd_str, "s1", "both").unwrap();
    assert_eq!(fs::read_to_string(cwd.join("src/a.txt")).unwrap(), "one");
    assert!(!cwd.join("src/b.txt").exists());
    assert!(cwd.join("node_modules/skip.txt").exists());
    assert_eq!(result.restored.len(), 1);
    assert_eq!(result.deleted.len(), 1);
    let _ = fs::remove_dir_all(&cwd);
  }

  #[test]
  fn line_diff_trims_common_lines_and_counts_sides() {
    let (diff, added, deleted) = line_diff("a\nkeep\nold\n", "a\nkeep\nnew\n", "x.txt");
    assert_eq!(added, 1);
    assert_eq!(deleted, 1);
    assert!(diff.starts_with("diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n"));
    assert!(diff.contains("\n-old\n+new\n"));
    assert!(diff.contains("@@ -3,1 +3,1 @@"));
  }

  #[test]
  fn line_diff_new_file_and_identical_content() {
    let (added_diff, added, deleted) = line_diff("", "one\ntwo\n", "new.txt");
    assert_eq!(added, 2);
    assert_eq!(deleted, 0);
    assert!(added_diff.contains("@@ -1,0 +1,2 @@"));
    assert!(added_diff.contains("\n+one\n+two\n"));
    let (empty_diff, empty_added, empty_deleted) = line_diff("same\n", "same\n", "x.txt");
    assert_eq!(empty_diff, "");
    assert_eq!(empty_added, 0);
    assert_eq!(empty_deleted, 0);
  }

  #[test]
  fn snapshot_review_reports_modified_new_and_deleted_files() {
    let cwd = test_cwd("snapshot");
    let cwd_str = cwd.to_string_lossy().into_owned();
    fs::write(cwd.join("src/a.txt"), "one").unwrap();
    fs::write(cwd.join("src/keep.txt"), "keep").unwrap();
    let conn = open_history(&cwd_str).unwrap();
    initialize_session(&conn, &cwd_str, "s2").unwrap();
    // The first message snapshot is the review baseline.
    let _ = create_message_snapshot(&conn, &cwd_str, "s2", "m0").unwrap();
    fs::write(cwd.join("src/a.txt"), "two").unwrap();
    fs::write(cwd.join("src/b.txt"), "new").unwrap();
    fs::remove_file(cwd.join("src/keep.txt")).unwrap();
    let _ = record_changes(&conn, &cwd_str, "s2");

    let (files, numstat, _stat, diff, new_files) = snapshot_review(&cwd_str, "s2").unwrap();
    assert!(files.contains("?? src/b.txt"));
    assert!(numstat.contains("src/a.txt"));
    assert!(diff.contains("diff --git a/src/a.txt b/src/a.txt"));
    assert!(diff.contains("-one\n+two"));
    assert!(new_files.contains("===== new file: src/b.txt ====="));
    let _ = fs::remove_dir_all(&cwd);
  }

  #[test]
  fn safe_target_rejects_escapes_and_symlinks() {
    let cwd = test_cwd("safe");
    let cwd_str = cwd.to_string_lossy().into_owned();
    assert!(safe_target(&cwd_str, "src/a.txt").is_ok());
    let escape = safe_target(&cwd_str, "../outside.txt");
    assert!(escape.is_err());
    assert!(escape.unwrap_err().contains("escapes the workspace"));
    fs::write(cwd.join("outside-target.txt"), "outside").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(cwd.join("outside-target.txt"), cwd.join("src/link.txt")).unwrap();
    #[cfg(windows)]
    {
      use std::os::windows::fs::symlink_file;
      symlink_file(cwd.join("outside-target.txt"), cwd.join("src/link.txt")).unwrap();
    }
    let link = safe_target(&cwd_str, "src/link.txt");
    assert!(link.is_err());
    assert!(link.unwrap_err().contains("symbolic link"));
    let _ = fs::remove_dir_all(&cwd);
  }

  #[test]
  fn message_snapshots_are_differential_not_full_copies() {
    let cwd = test_cwd("diffsnap");
    let cwd_str = cwd.to_string_lossy().into_owned();
    for index in 0..500 {
      fs::write(cwd.join(format!("src/f{index:03}.txt")), format!("content {index}")).unwrap();
    }
    let conn = open_history(&cwd_str).unwrap();
    let _ = create_message_snapshot(&conn, &cwd_str, "s4", "m0").unwrap();
    // Baseline snapshot stores every file once.
    let baseline_rows: i64 = conn.query_row(
      r#"SELECT COUNT(*) FROM message_snapshots WHERE session = ?1 AND order_no = 1"#,
      params!["s4"],
      |row| row.get(0),
    ).unwrap();
    assert_eq!(baseline_rows, 500);
    // Two more snapshots with only two files changed: only those two rows.
    fs::write(cwd.join("src/f000.txt"), "changed").unwrap();
    fs::write(cwd.join("src/f001.txt"), "changed too").unwrap();
    let _ = create_message_snapshot(&conn, &cwd_str, "s4", "m1").unwrap();
    // No further writes: the next snapshot records nothing (mtime unchanged).
    let _ = create_message_snapshot(&conn, &cwd_str, "s4", "m2").unwrap();
    let total_rows: i64 = conn.query_row(
      r#"SELECT COUNT(*) FROM message_snapshots WHERE session = ?1"#,
      params!["s4"],
      |row| row.get(0),
    ).unwrap();
    assert_eq!(total_rows, 502);
    let _ = fs::remove_dir_all(&cwd);
  }

  #[test]
  fn snapshot_review_survives_large_realistic_history() {
    let cwd = test_cwd("large");
    let cwd_str = cwd.to_string_lossy().into_owned();
    for index in 0..3000 {
      fs::write(cwd.join(format!("src/f{index:04}.txt")), format!("line one\nline two\nvalue {index}\n")).unwrap();
    }
    let conn = open_history(&cwd_str).unwrap();
    let _ = create_message_snapshot(&conn, &cwd_str, "s5", "m0").unwrap();
    for index in 0..200 {
      fs::write(cwd.join(format!("src/f{index:04}.txt")), format!("changed {index}\n")).unwrap();
    }
    let _ = record_changes(&conn, &cwd_str, "s5");
    let _ = create_message_snapshot(&conn, &cwd_str, "s5", "m1").unwrap();
    // The review must complete without panicking on a large history.
    let (files, numstat, _stat, diff, new_files) = snapshot_review(&cwd_str, "s5").unwrap();
    assert!(numstat.contains("src/f0000.txt"));
    assert!(!diff.is_empty());
    let _ = files;
    let _ = new_files;
    let _ = fs::remove_dir_all(&cwd);
  }

  #[test]
  fn preview_message_rollback_reports_modified_and_deleted() {
    let cwd = test_cwd("preview");
    let cwd_str = cwd.to_string_lossy().into_owned();
    fs::write(cwd.join("src/a.txt"), "one").unwrap();
    fs::write(cwd.join("src/keep.txt"), "keep").unwrap();
    let conn = open_history(&cwd_str).unwrap();
    let _ = create_message_snapshot(&conn, &cwd_str, "s3", "m1").unwrap();
    fs::write(cwd.join("src/a.txt"), "two").unwrap();
    fs::remove_file(cwd.join("src/keep.txt")).unwrap();

    let body = preview_message_rollback(&cwd_str, "s3", "m1", "both").unwrap();
    assert!(body.contains("\"state\":\"modified\""));
    assert!(body.contains("\"state\":\"deleted\""));
    // The diff rides inside JSON, so its newlines appear escaped (`\n`).
    assert!(body.contains("-one\\n+two"));
    assert!(body.contains("\"path\":\"src/a.txt\""));
    assert!(body.contains("\"path\":\"src/keep.txt\""));
    assert!(body.contains("\"ok\":true"));
    let _ = fs::remove_dir_all(&cwd);
  }

  #[test]
  fn rollback_scope_selects_code_or_conversation() {
    let cwd = test_cwd("scope");
    let cwd_str = cwd.to_string_lossy().into_owned();
    fs::write(cwd.join("src/a.txt"), "one").unwrap();
    let conn = open_history(&cwd_str).unwrap();
    let _ = create_message_snapshot(&conn, &cwd_str, "s8", "m1").unwrap();
    fs::write(cwd.join("src/a.txt"), "two").unwrap();

    let code = rollback_message_session(&conn, &cwd_str, "s8", "m1", "code").unwrap();
    assert_eq!(fs::read_to_string(cwd.join("src/a.txt")).unwrap(), "one");
    assert_eq!(code.restored.len(), 1);
    assert!(!code.log_restored);

    fs::write(cwd.join("src/a.txt"), "two").unwrap();
    let conv = rollback_message_session(&conn, &cwd_str, "s8", "m1", "conversation").unwrap();
    assert_eq!(fs::read_to_string(cwd.join("src/a.txt")).unwrap(), "two");
    assert_eq!(conv.restored.len(), 0);
    let _ = fs::remove_dir_all(&cwd);
  }

  #[test]
  fn list_message_snapshots_returns_ordered_checkpoints() {
    let cwd = test_cwd("list");
    let cwd_str = cwd.to_string_lossy().into_owned();
    fs::write(cwd.join("src/a.txt"), "one").unwrap();
    let conn = open_history(&cwd_str).unwrap();
    let _ = create_message_snapshot(&conn, &cwd_str, "s9", "m1").unwrap();
    fs::write(cwd.join("src/a.txt"), "two").unwrap();
    let _ = create_message_snapshot(&conn, &cwd_str, "s9", "m2").unwrap();
    let items = list_message_snapshots(&conn, "s9").unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["orderNo"], 1);
    assert_eq!(items[1]["orderNo"], 2);
    let _ = fs::remove_dir_all(&cwd);
  }
}
