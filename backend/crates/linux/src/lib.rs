//! Linux adapters. Hardware discovery stays outside the domain and use cases.
mod charge;
mod desktop;
mod nvidia;
mod telemetry;
pub use charge::LinuxCharge;
pub use desktop::LinuxDesktop;
pub use telemetry::LinuxTelemetry;

use nitrosense_domain::{ErrorCode, Failure, Result};
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Clone)]
struct Files {
    proc: PathBuf,
    sys: PathBuf,
}
impl Default for Files {
    fn default() -> Self {
        Self {
            proc: "/proc".into(),
            sys: "/sys".into(),
        }
    }
}
impl Files {
    fn path(&self, path: &str) -> PathBuf {
        if let Some(p) = path.strip_prefix("/proc/") {
            self.proc.join(p)
        } else if let Some(p) = path.strip_prefix("/sys/") {
            self.sys.join(p)
        } else {
            panic!("adapter path must be procfs or sysfs")
        }
    }
    fn read(&self, path: &str) -> Result<String> {
        read_bounded(&self.path(path), 1024 * 1024, path)
    }
    fn names(&self, path: &str) -> Result<Vec<String>> {
        let mut out = Vec::new();
        for item in std::fs::read_dir(self.path(path)).map_err(|e| io_failure(e, path))? {
            let item = item.map_err(|e| io_failure(e, path))?;
            let name = item
                .file_name()
                .into_string()
                .map_err(|_| Failure::new(ErrorCode::InvalidReading, path))?;
            out.push(name);
            if out.len() > 4096 {
                return Err(Failure::new(ErrorCode::InvalidReading, path));
            }
        }
        out.sort();
        Ok(out)
    }
}
pub fn read_bounded(path: &Path, limit: u64, operation: &str) -> Result<String> {
    let mut text = String::new();
    File::open(path)
        .and_then(|f| f.take(limit + 1).read_to_string(&mut text))
        .map_err(|e| io_failure(e, operation))?;
    if text.len() as u64 > limit || text.contains('\0') {
        return Err(Failure::new(ErrorCode::InvalidReading, operation));
    }
    Ok(text.trim().to_owned())
}
pub fn io_failure(e: std::io::Error, operation: &str) -> Failure {
    let code = match e.kind() {
        std::io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
        std::io::ErrorKind::NotFound => ErrorCode::Unavailable,
        _ if e.raw_os_error() == Some(libc::EBUSY) => ErrorCode::Busy,
        _ if matches!(e.raw_os_error(), Some(libc::EOPNOTSUPP | libc::ENOSYS)) => {
            ErrorCode::Unsupported
        }
        _ if e.raw_os_error() == Some(libc::ENODEV) => ErrorCode::Unavailable,
        _ if e.raw_os_error() == Some(libc::EPROTO) => ErrorCode::InvalidReading,
        _ => ErrorCode::Io,
    };
    Failure::new(code, operation)
}
fn number(text: &str, operation: &str) -> Result<f64> {
    let n: f64 = text
        .parse()
        .map_err(|_| Failure::new(ErrorCode::InvalidReading, operation))?;
    if !n.is_finite() || n < 0.0 || n > (1_u64 << 53) as f64 {
        return Err(Failure::new(ErrorCode::InvalidReading, operation));
    }
    Ok(n)
}

#[cfg(test)]
pub(crate) fn fixture() -> (PathBuf, Files) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let root = std::env::temp_dir().join(format!(
        "nitrosense-fixture-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir(&root).unwrap();
    (
        root.clone(),
        Files {
            proc: root.join("proc"),
            sys: root.join("sys"),
        },
    )
}
#[cfg(test)]
pub(crate) fn write(files: &Files, p: &str, value: &str) {
    let p = files.path(p);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, value).unwrap();
}
