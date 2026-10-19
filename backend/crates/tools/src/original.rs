//! Static verified-asset inspection. No Acer binary or module is executed.
use crate::Result;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Component, Path},
};
pub const ASAR: &str = "c79516a91d2eae93b019d040c786d23d8e69795b18255b709a37d48b9b78a401";
pub const MAIN: &str = "8dfad247b6fc019e9c308e86e982eda6e99ffc8f7e2fbb761bb7a6bf3d3fa440";
pub const RENDERER: &str = "0034ac95bd5e805fb480f6829f8504acddf19edb8115bc95c047d671c55f388c";
pub const RENDERER_PATH: &str = "dist/widgets/main/main.ce24a9a875916226.js";
pub fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn sha_file(path: &Path) -> Result<String> {
    let mut hash = Sha256::new();
    let mut f = fs::File::open(path)?;
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn safe_relative(s: &str) -> Result<()> {
    if s.is_empty()
        || s.contains(['\\', ':', '\0'])
        || s.split('/').any(|s| s.is_empty() || s == "." || s == "..")
        || Path::new(s)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("unsafe relative asset path".into());
    }
    Ok(())
}
pub fn archive(root: &Path) -> Result<Vec<u8>> {
    let path = root.join("resources/app.asar");
    if fs::metadata(&path)?.len() > 512 * 1024 * 1024 {
        return Err("ASAR size limit".into());
    }
    let bytes = fs::read(path)?;
    if sha(&bytes) != ASAR {
        return Err("unreviewed original ASAR".into());
    }
    Ok(bytes)
}
pub fn member<'a>(bytes: &'a [u8], name: &str) -> Result<&'a [u8]> {
    safe_relative(name)?;
    if bytes.len() < 16 {
        return Err("short ASAR".into());
    }
    let u32_at = |i| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap()) as usize;
    let base = 8usize.checked_add(u32_at(4)).ok_or("ASAR bounds")?;
    let end = 16usize.checked_add(u32_at(12)).ok_or("ASAR bounds")?;
    if end > base || base > bytes.len() {
        return Err("ASAR header bounds".into());
    }
    let tree: Value = serde_json::from_slice(&bytes[16..end])?;
    let mut node = &tree;
    for segment in name.split('/') {
        node = node
            .get("files")
            .and_then(|n| n.get(segment))
            .ok_or("missing ASAR member")?;
    }
    if node.get("link").is_some() || node.get("unpacked").and_then(Value::as_bool) == Some(true) {
        return Err("not a packed ASAR member".into());
    }
    let offset: usize = node["offset"].as_str().ok_or("ASAR offset")?.parse()?;
    let size = usize::try_from(node["size"].as_u64().ok_or("ASAR size")?)?;
    let start = base.checked_add(offset).ok_or("ASAR bounds")?;
    let end = start.checked_add(size).ok_or("ASAR bounds")?;
    bytes
        .get(start..end)
        .ok_or_else(|| "ASAR member bounds".into())
}
pub fn verify_vendor(directory: &Path) -> Result<Value> {
    let root = directory.canonicalize()?;
    let m: Value = serde_json::from_slice(&fs::read(root.join("import.json"))?)?;
    if m["schema"] != 1
        || m["application"] != "acernitrosense"
        || m["version"] != "5.2.84"
        || m["runtime"] != "26.6.10"
        || m["asarSha256"] != ASAR
        || m["msiEvidence"]["productVersion"] != "5.2.84"
        || m["msiEvidence"]["msiSha256"]
            != "113f71cb8e2176acd8e3e08bd036bf74b9ec1c60fee0197677a2f9aeb2b2bbdb"
    {
        return Err("unreviewed original import".into());
    }
    let mut paths = BTreeSet::new();
    for f in m["files"].as_array().ok_or("import file list")? {
        let relative = f["path"].as_str().ok_or("import file path")?;
        safe_relative(relative)?;
        if !paths.insert(relative.to_owned()) {
            return Err("duplicate import member".into());
        }
        let file = root.join(relative);
        if file.canonicalize()? != file
            || fs::symlink_metadata(&file)?.file_type().is_symlink()
            || !fs::metadata(&file)?.is_file()
            || fs::metadata(&file)?.len() != f["bytes"].as_u64().ok_or("import file length")?
            || sha_file(&file)? != f["sha256"].as_str().ok_or("import file hash")?
        {
            return Err(format!("modified original import member: {relative}").into());
        }
    }
    for required in [
        "resources/app.asar",
        "win32/Settings.json",
        "win32/Nitro/Nitro ANV15-52.json",
        "oem/NitroSense/Common/Settings.json",
    ] {
        if !paths.contains(required) {
            return Err(format!("missing required original member: {required}").into());
        }
    }
    let bytes = archive(&root)?;
    for (name, hash) in [("main.js", MAIN), (RENDERER_PATH, RENDERER)] {
        if sha(member(&bytes, name)?) != hash {
            return Err("unreviewed source member".into());
        }
    }
    Ok(
        json!({"version":"5.2.84","required_electron":"26.6.10","verified_files":paths.len(),"original_asar_intact":true,
        "scope":"import integrity, not GUI or hardware acceptance; OEM manifest provenance is not installer re-extraction"}),
    )
}
pub fn inspect(root: &Path, vendor: &Path, symbols: &[String]) -> Result<()> {
    let bytes = archive(vendor)?;
    let out = root.join("analysis/original-5.2.84");
    fs::create_dir_all(&out)?;
    let mut sources = Vec::new();
    for (name, hash, file) in [
        ("main.js", MAIN, "main.js"),
        (RENDERER_PATH, RENDERER, "renderer.js"),
    ] {
        let data = member(&bytes, name)?;
        if sha(data) != hash {
            return Err("original member hash mismatch".into());
        }
        let text = std::str::from_utf8(data)?;
        fs::write(out.join(file), data)?;
        let mut locations = Vec::new();
        for symbol in symbols {
            if symbol.is_empty() || symbol.len() > 200 {
                return Err("invalid symbol".into());
            }
            let offsets: Vec<_> = text
                .match_indices(symbol)
                .map(|(at, _)| text[..at].encode_utf16().count())
                .collect();
            locations.push(json!({"symbol":symbol,"offsets":offsets}));
        }
        sources.push(json!({"member":name,"sha256":hash,"file":file,"locations":locations}));
    }
    fs::write(
        out.join("index.json"),
        serde_json::to_vec_pretty(&json!({"version":"5.2.84","asarSha256":ASAR,
        "offsetUnit":"zero-based UTF-16 code units","method":"Static packed source extraction; no native decompilation or execution","sources":sources}))?,
    )?;
    println!("Static original sources indexed under ignored analysis/original-5.2.84/");
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_unsafe_archive_names_and_bounds() {
        for s in ["../x", "/x", "a/../x", "a\\x", "C:x", "a//b"] {
            assert!(safe_relative(s).is_err());
        }
        assert!(member(&[0; 15], "main.js").is_err());
        let mut bytes = [0; 16];
        bytes[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(member(&bytes, "main.js").is_err());
    }
}
