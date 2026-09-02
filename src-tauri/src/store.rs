//! Small, careful persistence: atomic JSON writes with a rolling backup, plus
//! the keystroke ledger that survives crashes.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// Writes `data` to `path` atomically: write a temp file in the same
/// directory, fsync, then rename over the destination. The previous file, if
/// any, becomes `<name>.bak`.
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    if path.exists() {
        let bak = backup_path(path);
        // Best effort: a failed backup should not block saving.
        let _ = fs::rename(path, &bak);
    }
    fs::rename(&tmp, path)
}

pub fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().map(|s| s.to_os_string()).unwrap_or_default();
    name.push(".bak");
    path.with_file_name(name)
}

/// Reads a JSON document, falling back to the backup if the main file is
/// missing or corrupt. Returns `None` if neither is usable.
pub fn read_json_with_fallback(path: &Path) -> Option<String> {
    for candidate in [path.to_path_buf(), backup_path(path)] {
        if let Ok(text) = fs::read_to_string(&candidate) {
            if serde_json::from_str::<serde_json::Value>(&text).is_ok() {
                return Some(text);
            }
            log::warn!("{} is not valid JSON, trying fallback", candidate.display());
        }
    }
    None
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Default)]
struct LedgerFile {
    total: u64,
}

/// Lifetime keystroke total on disk. Flushed periodically and on exit.
#[derive(Debug)]
pub struct KeyLedger {
    path: PathBuf,
    last_written: AtomicU64,
    lock: Mutex<()>,
}

impl KeyLedger {
    pub fn open(path: PathBuf) -> Self {
        let total = read_json_with_fallback(&path)
            .and_then(|t| serde_json::from_str::<LedgerFile>(&t).ok())
            .map(|l| l.total)
            .unwrap_or(0);
        Self {
            path,
            last_written: AtomicU64::new(total),
            lock: Mutex::new(()),
        }
    }

    pub fn base(&self) -> u64 {
        self.last_written.load(Ordering::Relaxed)
    }

    /// Persists `total` if it moved since the last flush.
    pub fn flush(&self, total: u64) {
        if total == self.last_written.load(Ordering::Relaxed) {
            return;
        }
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let body = serde_json::to_vec(&LedgerFile { total }).unwrap_or_default();
        match write_atomic(&self.path, &body) {
            Ok(()) => self.last_written.store(total, Ordering::Relaxed),
            Err(e) => log::warn!("could not persist key ledger: {e}"),
        }
    }
}
