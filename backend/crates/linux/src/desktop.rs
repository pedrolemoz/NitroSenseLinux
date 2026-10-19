use crate::{io_failure, read_bounded, Files};
use nitrosense_application::DesktopPlatform;
use nitrosense_domain::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::PathBuf,
};

pub struct LinuxDesktop {
    files: Files,
    state: PathBuf,
    _lock: fs::File,
}
impl LinuxDesktop {
    pub fn new(state: PathBuf) -> Result<Self> {
        if !state.is_absolute() {
            return Err(Failure::new(
                ErrorCode::InvalidRequest,
                "absolute_state_directory",
            ));
        }
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&state)
            .map_err(|e| io_failure(e, "state_directory"))?;
        let m = fs::symlink_metadata(&state).map_err(|e| io_failure(e, "state_directory"))?;
        // SAFETY: geteuid has no preconditions.
        if !m.is_dir()
            || m.file_type().is_symlink()
            || m.uid() != unsafe { libc::geteuid() }
            || m.mode() & 0o077 != 0
        {
            return Err(Failure::new(
                ErrorCode::PermissionDenied,
                "private_state_directory",
            ));
        }
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(state.join("backend.lock"))
            .map_err(|e| io_failure(e, "state_lock"))?;
        // SAFETY: the descriptor belongs to this live File; flock only acquires an advisory lock.
        if unsafe {
            libc::flock(
                std::os::fd::AsRawFd::as_raw_fd(&lock),
                libc::LOCK_EX | libc::LOCK_NB,
            )
        } != 0
        {
            return Err(Failure::new(ErrorCode::Busy, "state_directory_in_use"));
        }
        Ok(Self {
            files: Files::default(),
            state,
            _lock: lock,
        })
    }
    fn preferences(&self) -> Result<BTreeMap<String, Preference>> {
        let path = self.state.join("preferences.json");
        if !path.exists() {
            return Ok(BTreeMap::new());
        }
        if fs::symlink_metadata(&path)
            .map_err(|e| io_failure(e, "preferences"))?
            .file_type()
            .is_symlink()
        {
            return Err(Failure::new(
                ErrorCode::PermissionDenied,
                "preferences_symlink",
            ));
        }
        let text = read_bounded(&path, 65536, "preferences")?;
        serde_json::from_str(&text)
            .map_err(|_| Failure::new(ErrorCode::InvalidReading, "preferences"))
    }
}
impl DesktopPlatform for LinuxDesktop {
    fn processes(&self) -> Result<Vec<Process>> {
        let mut out = Vec::new();
        for n in self.files.names("/proc")? {
            let Ok(pid) = n.parse() else {
                continue;
            };
            match self.files.read(&format!("/proc/{n}/comm")) {
                Ok(name) => out.push(Process { pid, name }),
                Err(e)
                    if matches!(e.code, ErrorCode::Unavailable | ErrorCode::PermissionDenied) => {}
                Err(e) => return Err(e),
            }
        }
        Ok(out)
    }
    fn keyboards(&self) -> Result<Vec<Keyboard>> {
        let mut out = Vec::new();
        for n in self.files.names("/sys/class/input")? {
            if !n
                .strip_prefix("event")
                .is_some_and(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
            {
                continue;
            }
            let base = format!("/sys/class/input/{n}/device");
            let ev = self.files.read(&format!("{base}/capabilities/ev"))?;
            let key = self.files.read(&format!("{base}/capabilities/key"))?;
            let low = |s: &str| -> Option<u64> {
                u64::from_str_radix(s.split_whitespace().last()?, 16).ok()
            };
            if !low(&ev).is_some_and(|v| v & 2 != 0)
                || !low(&key).is_some_and(|v| v & (1 << 30) != 0)
            {
                continue;
            }
            let hex = |attr: &str| -> Result<String> {
                let raw = self.files.read(&format!("{base}/id/{attr}"))?;
                let n = u16::from_str_radix(&raw, 16)
                    .map_err(|_| Failure::new(ErrorCode::InvalidReading, "keyboard_id"))?;
                Ok(format!("{n:04X}"))
            };
            out.push(Keyboard {
                vendor: hex("vendor")?,
                product: hex("product")?,
            });
        }
        Ok(out)
    }
    fn identifier(&self, name: &str) -> Result<String> {
        self.files.read(match name {
            "serial" => "/sys/class/dmi/id/product_serial",
            "uuid" => "/sys/class/dmi/id/product_uuid",
            _ => return Err(Failure::new(ErrorCode::InvalidRequest, "identifier")),
        })
    }
    fn preference(&self, key: &str) -> Result<Option<Preference>> {
        Ok(self.preferences()?.remove(key))
    }
    fn set_preference(&mut self, key: &str, value: Preference) -> Result<()> {
        if key.len() > 256
            || key.contains('\0')
            || matches!(&value,Preference::Text(v) if v.len()>4096)
        {
            return Err(Failure::new(ErrorCode::InvalidRequest, "preference"));
        }
        let mut values = self.preferences()?;
        values.insert(key.into(), value);
        let bytes = serde_json::to_vec(&values)
            .map_err(|_| Failure::new(ErrorCode::InvalidRequest, "preferences"))?;
        if bytes.len() > 65536 {
            return Err(Failure::new(ErrorCode::InvalidRequest, "preference_limit"));
        }
        let temporary = self.state.join("preferences.pending");
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|e| io_failure(e, "preferences_staging"))?;
        let saved = (|| {
            f.write_all(&bytes)?;
            f.sync_all()?;
            fs::rename(&temporary, self.state.join("preferences.json"))?;
            fs::File::open(&self.state)?.sync_all()
        })();
        if saved.is_err() {
            let _ = fs::remove_file(temporary);
        }
        saved.map_err(|e| io_failure(e, "preferences"))
    }
    fn applications(&self, locale: &str) -> Result<Vec<DesktopApplication>> {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "home_directory"))?;
        let user = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join(".local/share"));
        let mut roots = vec![user];
        roots.extend(
            std::env::var("XDG_DATA_DIRS")
                .unwrap_or_else(|_| "/usr/local/share:/usr/share".into())
                .split(':')
                .map(PathBuf::from)
                .filter(|p| p.is_absolute()),
        );
        catalog(
            &roots,
            locale,
            &std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default(),
        )
    }
}
fn parse(text: &str) -> Result<BTreeMap<String, String>> {
    let mut fields = BTreeMap::new();
    let mut active = false;
    let mut seen = false;
    for line in text.trim_start_matches('\u{feff}').lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            active = line == "[Desktop Entry]";
            if active && seen {
                return Err(Failure::new(
                    ErrorCode::InvalidReading,
                    "duplicate_desktop_group",
                ));
            }
            seen |= active;
            continue;
        }
        if !active {
            continue;
        }
        let (k, v) = line
            .split_once('=')
            .ok_or_else(|| Failure::new(ErrorCode::InvalidReading, "desktop_entry"))?;
        if k.is_empty() || fields.insert(k.trim().into(), v.trim().into()).is_some() {
            return Err(Failure::new(ErrorCode::InvalidReading, "desktop_key"));
        }
    }
    if !seen {
        return Err(Failure::new(ErrorCode::InvalidReading, "desktop_group"));
    }
    Ok(fields)
}
fn unescape(s: &str) -> Result<String> {
    let mut out = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        out.push(match chars.next() {
            Some('s') => ' ',
            Some('n') => '\n',
            Some('t') => '\t',
            Some('r') => '\r',
            Some('\\') => '\\',
            _ => return Err(Failure::new(ErrorCode::InvalidReading, "desktop_escape")),
        });
    }
    Ok(out)
}
fn executable(raw: &str) -> Option<String> {
    // Metadata only; no shell, field-code expansion, or launch occurs here.
    let raw = unescape(raw).ok()?;
    let raw = raw.trim();
    let token = if let Some(raw) = raw.strip_prefix('"') {
        let end = raw.find('"')?;
        raw[..end].to_owned()
    } else {
        raw.split_whitespace().next()?.to_owned()
    };
    if token.is_empty() || token.contains(['%', '\0', '\n', '\r']) {
        return None;
    }
    let path = PathBuf::from(&token);
    let candidates = if path.is_absolute() {
        vec![path]
    } else {
        if token.contains('/') {
            return None;
        }
        std::env::var_os("PATH")
            .map(|p| {
                std::env::split_paths(&p)
                    .filter(|p| p.is_absolute())
                    .map(|p| p.join(&token))
                    .collect()
            })
            .unwrap_or_default()
    };
    candidates
        .into_iter()
        .find(|p| fs::metadata(p).is_ok_and(|m| m.is_file() && m.mode() & 0o111 != 0))
        .map(|p| p.to_string_lossy().into_owned())
}
fn catalog(roots: &[PathBuf], locale: &str, desktop: &str) -> Result<Vec<DesktopApplication>> {
    let mut seen = BTreeSet::new();
    let mut apps = Vec::new();
    let mut visited = 0;
    let mut count = 0;
    for root in roots {
        let base = root.join("applications");
        let mut pending = vec![(base.clone(), 0)];
        while let Some((dir, depth)) = pending.pop() {
            visited += 1;
            if visited > 512 || depth > 8 {
                return Err(Failure::new(
                    ErrorCode::InvalidReading,
                    "desktop_inventory_limit",
                ));
            }
            let entries = match fs::read_dir(&dir) {
                Ok(v) => v,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(io_failure(e, "desktop_inventory")),
            };
            let mut entries = entries
                .collect::<std::io::Result<Vec<_>>>()
                .map_err(|e| io_failure(e, "desktop_inventory"))?;
            entries.sort_by_key(|e| e.file_name());
            for entry in entries {
                let path = entry.path();
                let ty = entry
                    .file_type()
                    .map_err(|e| io_failure(e, "desktop_inventory"))?;
                if ty.is_dir() {
                    pending.push((path, depth + 1));
                    continue;
                }
                if path.extension().and_then(|v| v.to_str()) != Some("desktop") {
                    continue;
                }
                count += 1;
                if count > 4096 {
                    return Err(Failure::new(
                        ErrorCode::InvalidReading,
                        "desktop_inventory_limit",
                    ));
                }
                let id = path
                    .strip_prefix(&base)
                    .map_err(|_| Failure::new(ErrorCode::InvalidReading, "desktop_id"))?
                    .to_string_lossy()
                    .replace('/', "-");
                if !seen.insert(id.clone()) {
                    continue;
                }
                let fields = match read_bounded(&path, 256 * 1024, "desktop_entry")
                    .and_then(|v| parse(&v))
                {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let boolean = |key: &str| fields.get(key).map(String::as_str);
                if fields.get("Type").map(String::as_str) != Some("Application")
                    || ["Hidden", "NoDisplay"]
                        .iter()
                        .any(|k| matches!(boolean(k),Some(v) if v!="false"))
                {
                    continue;
                }
                let desktops: Vec<_> = desktop.split(':').collect();
                if fields
                    .get("NotShowIn")
                    .is_some_and(|v| v.split(';').any(|v| desktops.contains(&v)))
                    || fields
                        .get("OnlyShowIn")
                        .is_some_and(|v| !v.split(';').any(|v| desktops.contains(&v)))
                {
                    continue;
                }
                if fields
                    .get("TryExec")
                    .is_some_and(|v| executable(v).is_none())
                {
                    continue;
                }
                let lang = locale.replace('-', "_");
                let lang = lang.split('.').next().unwrap_or("C");
                let name = fields
                    .get(&format!("Name[{lang}]"))
                    .or_else(|| {
                        fields.get(&format!("Name[{}]", lang.split('_').next().unwrap_or(lang)))
                    })
                    .or_else(|| fields.get("Name"));
                let Some(name) = name
                    .and_then(|v| unescape(v).ok())
                    .filter(|v| !v.is_empty())
                else {
                    continue;
                };
                let binary = fields.get("Exec").and_then(|v| executable(v));
                if binary.is_none() && boolean("DBusActivatable") != Some("true") {
                    continue;
                }
                apps.push(DesktopApplication {
                    id: format!("linux-desktop:{id}"),
                    name,
                    desktop_file: path.to_string_lossy().into_owned(),
                    executable: binary,
                    icon: fields.get("Icon").and_then(|v| unescape(v).ok()),
                });
            }
        }
    }
    Ok(apps)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hidden_override_and_locale_survive_catalog_discovery() {
        let (root, _) = crate::fixture();
        let user = root.join("user/applications");
        let system = root.join("system/applications");
        fs::create_dir_all(&user).unwrap();
        fs::create_dir_all(&system).unwrap();
        fs::write(user.join("a.desktop"), "[Desktop Entry]\nHidden=true\n").unwrap();
        let app="[Desktop Entry]\nType=Application\nName=Example\nName[pt]=Exemplo\nExec=/usr/bin/true\n";
        fs::write(system.join("a.desktop"), app).unwrap();
        fs::write(system.join("b.desktop"), app).unwrap();
        let apps = catalog(&[root.join("user"), root.join("system")], "pt-BR", "GNOME").unwrap();
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].name, "Exemplo");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn preferences_are_atomic_and_reject_corrupt_state() {
        let (root, _) = crate::fixture();
        let mut platform = LinuxDesktop::new(root.join("state")).unwrap();
        assert!(LinuxDesktop::new(root.join("state")).is_err());
        platform
            .set_preference("example", Preference::Text("value".into()))
            .unwrap();
        assert!(
            matches!(platform.preference("example").unwrap(),Some(Preference::Text(v)) if v=="value")
        );
        fs::write(root.join("state/preferences.json"), "[]").unwrap();
        assert!(platform.preference("example").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
