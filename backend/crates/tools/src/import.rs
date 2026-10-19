//! Transactional import from the one pinned official installer. Tools read data;
//! Windows installers, custom actions, native DLLs and executables are never run.
use crate::{
    original::{member, safe_relative, sha, sha_file, verify_vendor, ASAR},
    Result,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
const ZIP_HASH: &str = "a9e2ca1efff836a045b65e50ec54945488b4804e56b3f77852e9334f76d60908";
const MSI_HASH: &str = "113f71cb8e2176acd8e3e08bd036bf74b9ec1c60fee0197677a2f9aeb2b2bbdb";
const APPX_HASH: &str = "7d5aeafa65e475838a5a5635ef8c1081e8df734f5942bcf30934b51fe6b025c8";
const PREFIX: &str = "NitroSense_Acer_5.2.84_W11x64/";

fn run(tool: &str, args: &[&str], max: u64) -> Result<Vec<u8>> {
    let mut child = Command::new(tool)
        .args(args)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let stdout = child.stdout.take().ok_or("missing extraction stdout")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.take(max + 1).read_to_end(&mut bytes).map(|_| bytes)
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if start.elapsed() < Duration::from_secs(60) => {
                std::thread::sleep(Duration::from_millis(10))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("extraction timed out or failed");
            }
        }
    };
    let bytes = reader.join().map_err(|_| "extraction reader failed")??;
    if !status?.success() || bytes.len() as u64 > max {
        return Err("extraction failed or output limit exceeded".into());
    }
    Ok(bytes)
}
fn zip_read(zip: &Path, name: &str, max: u64) -> Result<Vec<u8>> {
    safe_relative(name)?;
    if name.contains(['*', '?', '[', ']']) {
        return Err("glob ZIP member unsupported".into());
    }
    run(
        "/usr/bin/unzip",
        &["-p", zip.to_str().ok_or("ZIP path encoding")?, name],
        max,
    )
}
fn save(root: &Path, name: &str, data: &[u8], files: &mut Vec<Value>) -> Result<()> {
    safe_relative(name)?;
    let target = root.join(name);
    fs::create_dir_all(target.parent().ok_or("import parent")?)?;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)?;
    f.write_all(data)?;
    files.push(json!({"path":name,"bytes":data.len(),"sha256":sha(data)}));
    Ok(())
}
fn decode_path(s: &str) -> Result<String> {
    let mut bytes = Vec::new();
    let mut chars = s.bytes();
    while let Some(c) = chars.next() {
        if c != b'%' {
            bytes.push(c);
            continue;
        }
        let a = chars.next().ok_or("truncated percent escape")?;
        let b = chars.next().ok_or("truncated percent escape")?;
        let pair = String::from_utf8(vec![a, b])?;
        let decoded = u8::from_str_radix(&pair, 16)?;
        if decoded == b'/' || decoded == b'\\' {
            return Err("encoded path separator".into());
        }
        bytes.push(decoded);
    }
    let out = String::from_utf8(bytes)?;
    safe_relative(&out)?;
    Ok(out)
}
type Row = BTreeMap<String, String>;
fn table(msi: &Path, name: &str) -> Result<Vec<Row>> {
    let bytes = run(
        "/usr/bin/msiinfo",
        &["export", msi.to_str().ok_or("MSI path")?, name],
        16 * 1024 * 1024,
    )?;
    parse_table(std::str::from_utf8(&bytes)?, name)
}
fn parse_table(text: &str, name: &str) -> Result<Vec<Row>> {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    let columns: Vec<_> = lines.next().ok_or("MSI columns")?.split('\t').collect();
    let types: Vec<_> = lines.next().ok_or("MSI types")?.split('\t').collect();
    let keys = lines.next().ok_or("MSI keys")?;
    if columns.len() != types.len()
        || columns.iter().collect::<BTreeSet<_>>().len() != columns.len()
        || keys.split('\t').next() != Some(name)
    {
        return Err("MSI table schema".into());
    }
    let mut out = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let values: Vec<_> = line.split('\t').collect();
        if values.len() != columns.len() {
            return Err("MSI table row".into());
        }
        out.push(
            columns
                .iter()
                .zip(values)
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        );
    }
    Ok(out)
}
fn field<'a>(row: &'a Row, key: &str) -> Result<&'a str> {
    row.get(key)
        .map(String::as_str)
        .ok_or_else(|| format!("missing MSI column {key}").into())
}
fn index(rows: Vec<Row>, key: &str) -> Result<BTreeMap<String, Row>> {
    let mut out = BTreeMap::new();
    for row in rows {
        let id = field(&row, key)?.to_owned();
        if id.is_empty() || out.insert(id, row).is_some() {
            return Err("duplicate MSI row".into());
        }
    }
    Ok(out)
}
fn long_name(raw: &str) -> Result<String> {
    let value = raw
        .split(':')
        .next()
        .ok_or("MSI target name")?
        .split('|')
        .next_back()
        .ok_or("MSI target name")?;
    safe_relative(value)?;
    if value.contains('/') || value.ends_with(['.', ' ']) || value.chars().any(char::is_control) {
        return Err("unsafe MSI target".into());
    }
    Ok(value.into())
}
struct OemFile {
    id: String,
    path: String,
    size: usize,
    cabinet: String,
}
fn plan_oem(msi: &Path) -> Result<(Vec<OemFile>, BTreeSet<String>)> {
    let properties = index(table(msi, "Property")?, "Property")?;
    if properties
        .get("ProductVersion")
        .map(|r| field(r, "Value"))
        .transpose()?
        != Some("5.2.84")
    {
        return Err("MSI product version".into());
    }
    let directories = index(table(msi, "Directory")?, "Directory")?;
    let components = index(table(msi, "Component")?, "Component")?;
    let files = index(table(msi, "File")?, "File")?;
    let ids = files.keys().cloned().collect();
    let mut media = table(msi, "Media")?;
    media.sort_by_key(|r| {
        r.get("LastSequence")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or_default()
    });
    let mut last = 0;
    for m in &media {
        let sequence = field(m, "LastSequence")?.parse::<u64>()?;
        let cabinet = field(m, "Cabinet")?;
        if sequence <= last || !cabinet.starts_with("#cab") || !cabinet.ends_with(".cab") {
            return Err("MSI media".into());
        }
        last = sequence;
    }
    let mut targets = BTreeSet::new();
    let mut plan = Vec::new();
    for (id, row) in files {
        safe_relative(&id)?;
        if id.contains('/') {
            return Err("unsafe cabinet ID".into());
        }
        let mut directory = field(
            components
                .get(field(&row, "Component_")?)
                .ok_or("MSI component")?,
            "Directory_",
        )?
        .to_owned();
        let mut segments = Vec::new();
        let mut visited = BTreeSet::new();
        while directory != "INSTALLFOLDER_OEM_NitroSense" {
            if !visited.insert(directory.clone()) {
                return Err("cyclic MSI directory graph".into());
            }
            let d = directories.get(&directory).ok_or("MSI directory")?;
            let parent = field(d, "Directory_Parent")?;
            if parent.is_empty() || parent == directory {
                break;
            }
            let name = field(d, "DefaultDir")?;
            if name != "." {
                segments.push(long_name(name)?);
            }
            directory = parent.into();
        }
        if directory != "INSTALLFOLDER_OEM_NitroSense" {
            continue;
        }
        segments.reverse();
        segments.push(long_name(field(&row, "FileName")?)?);
        let path = segments.join("/");
        if !path.starts_with("Common/") {
            continue;
        }
        if !targets.insert(path.to_lowercase()) {
            return Err("duplicate OEM target".into());
        }
        let sequence = field(&row, "Sequence")?.parse::<u64>()?;
        let size = field(&row, "FileSize")?.parse::<usize>()?;
        if sequence == 0 || size > 512 * 1024 * 1024 {
            return Err("OEM bounds".into());
        }
        let disk = media
            .iter()
            .find(|r| {
                r["LastSequence"]
                    .parse::<u64>()
                    .is_ok_and(|n| n >= sequence)
            })
            .ok_or("OEM cabinet")?;
        let cabinet = field(disk, "Cabinet")?
            .strip_prefix('#')
            .ok_or("embedded cabinet")?
            .to_owned();
        safe_relative(&cabinet)?;
        plan.push(OemFile {
            id,
            path,
            size,
            cabinet,
        });
    }
    if !plan.iter().any(|f| f.path == "Common/Settings.json")
        || plan.iter().map(|f| f.size as u64).sum::<u64>() > 512 * 1024 * 1024
    {
        return Err("OEM plan bounds or settings".into());
    }
    Ok((plan, ids))
}
fn validate_cabinet(bytes: &[u8], ids: &BTreeSet<String>) -> Result<BTreeMap<String, usize>> {
    if bytes.len() < 36
        || &bytes[..4] != b"MSCF"
        || u32::from_le_bytes(bytes[8..12].try_into()?) as usize != bytes.len()
    {
        return Err("cabinet header".into());
    }
    let mut at = u32::from_le_bytes(bytes[16..20].try_into()?) as usize;
    let count = u16::from_le_bytes(bytes[28..30].try_into()?);
    let mut files = BTreeMap::new();
    for _ in 0..count {
        let header = bytes
            .get(at..at.checked_add(16).ok_or("cabinet overflow")?)
            .ok_or("cabinet member bounds")?;
        let size = u32::from_le_bytes(header[..4].try_into()?) as usize;
        at += 16;
        let tail = bytes.get(at..).ok_or("cabinet name bounds")?;
        let end = tail.iter().position(|b| *b == 0).ok_or("cabinet name")?;
        let name = std::str::from_utf8(&tail[..end])?;
        safe_relative(name)?;
        if name.contains('/')
            || !ids.contains(name)
            || files.insert(name.to_lowercase(), size).is_some()
        {
            return Err("unexpected cabinet member".into());
        }
        at += end + 1;
    }
    Ok(files)
}
pub fn import(zip: &Path, output: &Path) -> Result<()> {
    let zip = zip.canonicalize()?;
    if sha_file(&zip)? != ZIP_HASH {
        return Err("unreviewed official ZIP; no extraction tool executed".into());
    }
    let parent = output.parent().ok_or("output parent")?.canonicalize()?;
    let output = parent.join(output.file_name().ok_or("output name")?);
    let staging = PathBuf::from(format!("{}.partial", output.display()));
    if output.exists() || staging.exists() {
        return Err("destination or staging already exists; preserve prior evidence and choose another path".into());
    }
    fs::DirBuilder::new().mode(0o700).create(&staging)?;
    let work = staging.join(".work");
    fs::create_dir(&work)?;
    let appx = work.join("original.appx");
    let msi = work.join("original.msi");
    let appx_data = zip_read(
        &zip,
        &format!("{PREFIX}UWP/92086ed242014d8fadab04e6217e62b4.appx"),
        512 * 1024 * 1024,
    )?;
    if sha(&appx_data) != APPX_HASH {
        return Err("AppX hash mismatch".into());
    }
    fs::write(&appx, appx_data)?;
    let msi_data = zip_read(
        &zip,
        &format!("{PREFIX}Setup/NitroSenseConfig.msi"),
        256 * 1024 * 1024,
    )?;
    if sha(&msi_data) != MSI_HASH {
        return Err("MSI hash mismatch".into());
    }
    fs::write(&msi, msi_data)?;
    let mut files = Vec::new();
    let asar = zip_read(&appx, "app/resources/app.asar", 256 * 1024 * 1024)?;
    if sha(&asar) != ASAR {
        return Err("ASAR hash mismatch".into());
    }
    let package: Value = serde_json::from_slice(member(&asar, "package.json")?)?;
    if package["name"] != "acernitrosense"
        || package["version"] != "5.2.84"
        || package["main"] != "main.js"
    {
        return Err("original application identity".into());
    }
    save(&staging, "resources/app.asar", &asar, &mut files)?;
    drop(asar);
    save(
        &staging,
        "AppxManifest.xml",
        &zip_read(&appx, "AppxManifest.xml", 1024 * 1024)?,
        &mut files,
    )?;
    let listing = run(
        "/usr/bin/unzip",
        &["-Z1", appx.to_str().ok_or("AppX path")?],
        4 * 1024 * 1024,
    )?;
    let mut seen = BTreeSet::new();
    let mut total = 0u64;
    for name in std::str::from_utf8(&listing)?.lines() {
        if !seen.insert(name) {
            return Err("duplicate ZIP member".into());
        }
        if name.ends_with('/')
            || !(name.starts_with("app/win32/")
                || name.starts_with("app/resources/app.asar.unpacked/"))
            || name.to_lowercase().ends_with(".msi")
        {
            continue;
        }
        let relative = decode_path(name.strip_prefix("app/").ok_or("AppX prefix")?)?;
        let data = zip_read(&appx, name, 128 * 1024 * 1024)?;
        total += data.len() as u64;
        if total > 512 * 1024 * 1024 {
            return Err("AppX resource total limit".into());
        }
        save(&staging, &relative, &data, &mut files)?;
    }
    let (plan, ids) = plan_oem(&msi)?;
    let cabinets: BTreeSet<_> = plan.iter().map(|f| f.cabinet.clone()).collect();
    for cabinet in cabinets {
        let data = run(
            "/usr/bin/msiinfo",
            &["extract", msi.to_str().ok_or("MSI path")?, &cabinet],
            256 * 1024 * 1024,
        )?;
        let members = validate_cabinet(&data, &ids)?;
        let cab = work.join(&cabinet);
        fs::write(&cab, data)?;
        for file in plan.iter().filter(|f| f.cabinet == cabinet) {
            if members.get(&file.id.to_lowercase()) != Some(&file.size) {
                return Err("cabinet size differs from MSI table".into());
            }
            let content = run(
                "/usr/bin/cabextract",
                &[
                    "-p",
                    "-q",
                    "-s",
                    "-F",
                    &file.id,
                    cab.to_str().ok_or("cabinet path")?,
                ],
                file.size as u64,
            )?;
            if content.len() != file.size {
                return Err("OEM extracted size mismatch".into());
            }
            save(
                &staging,
                &format!("oem/NitroSense/{}", file.path),
                &content,
                &mut files,
            )?;
        }
    }
    fs::write(
        staging.join("import.json"),
        serde_json::to_vec_pretty(
            &json!({"schema":1,"application":"acernitrosense","version":"5.2.84","runtime":"26.6.10",
        "sourceAppxSha256":APPX_HASH,"asarSha256":ASAR,"oemCommonImported":true,"msiEvidence":{"msiSha256":MSI_HASH,"productVersion":"5.2.84"},"files":files}),
        )?,
    )?;
    verify_vendor(&staging)?;
    // Cleanup is limited to our newly-created staging workspace, after verification.
    fs::remove_dir_all(&work)?;
    fs::rename(&staging, &output)?;
    println!(
        "{}",
        json!({"output":output,"files":files.len(),"original_asar_intact":true,"windows_binaries_executed":false})
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_table_shapes_paths_and_cabinet_bounds() {
        assert!(parse_table("A\tB\ns1\ts1\nFile\tA\nx\n", "File").is_err());
        for p in ["../bad", "a/%2fetc", "a/%5cetc", "a/%2e%2e/x"] {
            assert!(decode_path(p).is_err());
        }
        assert_eq!(
            decode_path("win32/Nitro%20ANV15-52.json").unwrap(),
            "win32/Nitro ANV15-52.json"
        );
        assert!(validate_cabinet(&[0; 36], &BTreeSet::new()).is_err());
    }
}
