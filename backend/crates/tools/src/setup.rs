//! Installer orchestration in Rust. npm is used only to provision Electron.
use crate::{import, original::verify_vendor, Result};
use serde_json::Value;
use std::{
    fs,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
const URL:&str="https://global-download.acer.com/GDFiles/Application/Nitro%20Sense/Nitro%20Sense_Acer_5.2.84_W11x64_A.zip?acerid=639270422763622831&Step1=&Step2=&Step3=NITRO%20ANV15-52&OS=ALL&LC=pt&BC=ACER&SC=PA_3";
fn download(path: &Path) -> Result<()> {
    let partial = PathBuf::from(format!("{}.partial", path.display()));
    let output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&partial)?;
    let mut child = Command::new("/usr/bin/wget")
        .args([
            "--quiet",
            "--https-only",
            "--max-redirect=0",
            "--timeout=30",
            "--tries=1",
            "--output-document=-",
            URL,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::from(output))
        .stderr(Stdio::null())
        .spawn()?;
    let start = Instant::now();
    loop {
        if start.elapsed() > Duration::from_secs(1800)
            || fs::metadata(&partial)?.len() > 2 * 1024 * 1024 * 1024
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err("download limit reached; preserve partial file for inspection".into());
        }
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                return Err("official download failed; partial file retained".into());
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if crate::original::sha_file(&partial)?
        != "a9e2ca1efff836a045b65e50ec54945488b4804e56b3f77852e9334f76d60908"
    {
        return Err("official ZIP hash mismatch; partial file retained".into());
    }
    fs::rename(partial, path)?;
    Ok(())
}
pub fn setup(
    root: &Path,
    zip: Option<PathBuf>,
    output: Option<PathBuf>,
    runtime: bool,
) -> Result<()> {
    let output = output.unwrap_or_else(|| root.join("vendor/nitrosense-5.2.84-official"));
    if output.exists() {
        println!("{}", verify_vendor(&output)?);
    } else {
        for tool in ["/usr/bin/unzip", "/usr/bin/msiinfo", "/usr/bin/cabextract"] {
            if !Path::new(tool).is_file() {
                return Err(format!("missing extraction tool {tool}").into());
            }
        }
        let zip = if let Some(zip) = zip {
            zip
        } else {
            let cache = root.join(".state/downloads");
            fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(&cache)?;
            let path = cache.join("NitroSense_Acer_5.2.84_W11x64_A.zip");
            if !path.exists() {
                download(&path)?;
            }
            path
        };
        fs::create_dir_all(output.parent().ok_or("import output parent")?)?;
        import::import(&zip, &output)?;
    }
    if runtime {
        let prefix = root.join(".tools/electron-runtime");
        let package = prefix.join("node_modules/electron/package.json");
        let installed = fs::read(&package)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .is_some_and(|v| v["version"] == "26.6.10");
        if !installed {
            let status = Command::new("npm")
                .args(["install", "--prefix"])
                .arg(&prefix)
                .args([
                    "--save-exact",
                    "--no-audit",
                    "--no-fund",
                    "electron@26.6.10",
                ])
                .status()?;
            if !status.success() {
                return Err("frontend Electron provisioning failed".into());
            }
        }
    }
    println!("Rust setup complete; original-frontend/hardware acceptance and runtime hardening remain separate.");
    Ok(())
}
