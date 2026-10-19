use crate::{
    original::{archive, member, safe_relative, sha, sha_file},
    Result,
};
use serde_json::{json, Value};
use std::{collections::BTreeSet, fs, path::Path, process::Command};
fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let out = Command::new("git").args(args).current_dir(root).output()?;
    if !out.status.success() {
        return Err("git audit command failed".into());
    }
    Ok(out.stdout)
}
fn implementation(p: &str) -> bool {
    if p.contains("/target/") || p.ends_with(".test.cjs") {
        return false;
    }
    (p.starts_with("scripts/")
        && [".cjs", ".sh", ".ps1"]
            .iter()
            .any(|suffix| p.ends_with(suffix)))
        || [
            "runtime/",
            "lib/",
            "drivers/",
            "src/",
            "ui/",
            "frontend/",
            "backend/",
        ]
        .iter()
        .any(|prefix| p.starts_with(prefix))
        || p.ends_with(".rs")
        || [".html", ".jsx", ".tsx", ".vue", ".svelte", ".css", ".scss"]
            .iter()
            .any(|s| p.ends_with(s))
        || !p.contains('/') && (p.ends_with(".cjs") || p.ends_with(".js"))
        || ["/components/", "/screens/", "/pages/"]
            .iter()
            .any(|s| p.contains(s))
        || p.contains("-panel.cjs")
}
fn meaningful(v: &Value) -> bool {
    v.as_str().is_some_and(|s| s.trim().len() >= 12)
}
fn digest(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn valid(r: &Value) -> bool {
    r["schema"] == 1
        && meaningful(&r["feature"])
        && r["original"].as_array().is_some_and(|a| {
            !a.is_empty()
                && a.iter().all(|s| {
                    s["member"].is_string()
                        && digest(&s["sha256"])
                        && s["symbols"].as_array().is_some_and(|s| {
                            !s.is_empty()
                                && s.iter().all(|v| v.as_str().is_some_and(|s| !s.is_empty()))
                        })
                })
        })
        && [
            "control",
            "model",
            "transport",
            "osOrFirmware",
            "replyAndRefresh",
            "linuxAdaptation",
        ]
        .iter()
        .all(|k| meaningful(&r["trace"][k]))
        && r["files"].as_array().is_some_and(|a| {
            !a.is_empty()
                && a.iter().all(|f| {
                    f["path"].as_str().is_some_and(implementation)
                        && (digest(&f["sha256"]) || f["sha256"] == "deleted")
                })
        })
        && r["validation"].as_array().is_some_and(|a| {
            !a.is_empty()
                && a.iter().all(|v| {
                    ["pass", "fail", "blocked", "not-tested"]
                        .contains(&v["status"].as_str().unwrap_or(""))
                        && meaningful(&v["behavior"])
                        && meaningful(&v["evidence"])
                })
        })
        && ["not-required", "required", "captured"]
            .contains(&r["windows"]["status"].as_str().unwrap_or(""))
        && meaningful(&r["windows"]["reason"])
        && meaningful(&r["remainingGaps"])
}
fn suspicious(path: &str, added: &str) -> bool {
    [".html", ".jsx", ".tsx", ".vue", ".svelte", ".css", ".scss"]
        .iter()
        .any(|s| path.ends_with(s))
        || ["/components/", "/screens/", "/pages/"]
            .iter()
            .any(|s| path.contains(s))
        || [
            "customElements.define",
            "ReactDOM.",
            "createRoot(",
            "insertAdjacentHTML(",
            "document.write(",
            "nitrosense-linux-scenario",
            "renderer-scenario.cjs",
        ]
        .iter()
        .any(|s| added.contains(s))
        || added.lines().any(|l| {
            ["innerHTML", "outerHTML"]
                .iter()
                .any(|s| l.contains(s) && l.contains('='))
        })
}
pub fn run(root: &Path, vendor: &Path, base: &str, verify: bool) -> Result<()> {
    let resolved = String::from_utf8(git(
        root,
        &["rev-parse", "--verify", &format!("{base}^{{tree}}")],
    )?)?;
    let base = resolved.trim();
    let mut names = git(root, &["diff", "--name-only", "-z", base, "--"])?;
    names.extend(git(
        root,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )?);
    let files: BTreeSet<_> = names
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8(s.to_vec()))
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|s| implementation(s))
        .collect();
    let mut errors = Vec::new();
    let metadata = Command::new("cargo")
        .args([
            "metadata",
            "--offline",
            "--no-deps",
            "--format-version",
            "1",
            "--manifest-path",
            "backend/Cargo.toml",
        ])
        .current_dir(root)
        .output()?;
    if !metadata.status.success() {
        return Err("cannot inspect workspace dependency boundaries".into());
    }
    let metadata: Value = serde_json::from_slice(&metadata.stdout)?;
    for package in metadata["packages"]
        .as_array()
        .ok_or("workspace package metadata")?
    {
        let name = package["name"].as_str().ok_or("package name")?;
        for dependency in package["dependencies"]
            .as_array()
            .ok_or("package dependencies")?
        {
            let dep = dependency["name"].as_str().ok_or("dependency name")?;
            let allowed = match name {
                "nitrosense-domain" => dep == "serde",
                "nitrosense-application" => dep == "nitrosense-domain",
                "nitrosense-linux" => !["nitrosense-service", "nitrosense-tools"].contains(&dep),
                _ => true,
            };
            if !allowed {
                errors.push(format!("architecture violation: {name} depends on {dep}"));
            }
        }
    }
    let mut reviewed_findings = Vec::new();
    let mut records = Vec::new();
    for entry in fs::read_dir(root.join("docs/reverse-engineering"))? {
        let path = entry?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let r: Value = serde_json::from_slice(&fs::read(&path)?)?;
        if valid(&r) {
            records.push(r);
        } else {
            errors.push(format!(
                "{}: invalid evidence record",
                path.file_name().unwrap().to_string_lossy()
            ));
        }
    }
    for file in &files {
        safe_relative(file)?;
        let path = root.join(file);
        let hash = if path.exists() {
            sha_file(&path)?
        } else {
            "deleted".into()
        };
        if !records.iter().any(|r| {
            r["files"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f["path"] == file.as_str() && f["sha256"] == hash)
        }) {
            errors.push(format!(
                "{file}: missing evidence bound to current file hash"
            ));
        }
        let diff = String::from_utf8(git(
            root,
            &[
                "diff",
                "--no-ext-diff",
                "--no-renames",
                "--unified=0",
                base,
                "--",
                file,
            ],
        )?)?;
        let added = if diff.is_empty() && path.is_file() {
            fs::read_to_string(&path)?
        } else {
            diff.lines()
                .filter(|l| l.starts_with('+') && !l.starts_with("+++"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        if suspicious(file, &added) {
            // The detector's own literal examples trigger self-inspection. Only
            // this exact file/hash may carry an explicit review; findings remain visible.
            let review = records
                .iter()
                .flat_map(|r| r["heuristicReviews"].as_array().into_iter().flatten())
                .find(|r| {
                    file == "backend/crates/tools/src/audit.rs"
                        && r["path"] == file.as_str()
                        && r["sha256"] == hash
                        && r["reason"].as_str().is_some_and(|s| s.len() >= 40)
                });
            if let Some(review) = review {
                reviewed_findings.push(review.clone());
            } else {
                errors.push(format!(
                    "{file}: replacement UI heuristic requires inspection"
                ));
            }
        }
    }
    if verify {
        let bytes = archive(vendor)?;
        for r in &records {
            for source in r["original"].as_array().unwrap() {
                let data = member(&bytes, source["member"].as_str().unwrap())?;
                if sha(data) != source["sha256"].as_str().unwrap() {
                    errors.push("recorded original hash mismatch".into());
                }
                let text = std::str::from_utf8(data)?;
                for symbol in source["symbols"].as_array().unwrap() {
                    if !text.contains(symbol.as_str().unwrap()) {
                        errors.push(format!("original symbol absent: {}", symbol));
                    }
                }
            }
        }
    }
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"checkedFiles":files,"originalVerified":verify,"errors":errors,"reviewedFindings":reviewed_findings,
        "limitation":"Heuristic and evidence gate; cannot establish truthful claims, complete detection, behavior or hardware parity"})
        )?
    );
    if errors.is_empty() {
        Ok(())
    } else {
        Err("reverse engineering audit failed".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn covers_new_architecture_and_rejects_weak_evidence() {
        for p in [
            "backend/crates/tools/src/main.rs",
            "frontend/host/bootstrap.cjs",
            "other/new.rs",
            "backend/Cargo.lock",
        ] {
            assert!(implementation(p));
        }
        assert!(!implementation("backend/target/debug/build.rs"));
        assert!(!valid(
            &json!({"schema":1,"feature":"Looks like screenshot"})
        ));
        assert!(suspicious(
            "frontend/host/adapter.cjs",
            "document.write(html)"
        ));
    }
}
