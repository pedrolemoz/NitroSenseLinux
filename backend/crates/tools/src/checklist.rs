use crate::Result;
use serde_json::Value;
use std::{collections::BTreeSet, fs, path::Path};
pub fn generate(root: &Path, check: bool) -> Result<()> {
    let ledger: Value =
        serde_json::from_slice(&fs::read(root.join("docs/migration/features.json"))?)?;
    let mut out=String::from("# Screenshot implementation checklist\n\nGenerated from `features.json` with `cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- checklist`.\n\nHistorical Node observations are not Rust acceptance. A checked item requires independent behavioral evidence and original-frontend acceptance.\n\n| Feature | References | Rust backend | Acer integration | Visual | Behavior | Next action |\n| --- | --- | --- | --- | --- | --- | --- |\n");
    let mut covered = BTreeSet::new();
    let mut ids = BTreeSet::new();
    let references = ledger["references"]
        .as_object()
        .ok_or("missing screenshot references")?;
    let manifest: Value =
        serde_json::from_slice(&fs::read(root.join("references/manifest.json"))?)?;
    if references.len() != 20 {
        return Err("expected all 20 reference IDs".into());
    }
    for file in references.values() {
        let file = file.as_str().ok_or("invalid reference path")?;
        let known = manifest["screenshots"]
            .as_array()
            .ok_or("reference manifest")?
            .iter()
            .find(|s| s["file"] == file)
            .ok_or("unknown screenshot")?;
        if crate::original::sha_file(&root.join("references").join(file))?
            != known["sha256"].as_str().ok_or("screenshot hash")?
        {
            return Err("screenshot hash mismatch".into());
        }
    }
    for f in ledger["features"].as_array().ok_or("missing features")? {
        let id = f["id"].as_str().ok_or("missing feature id")?;
        if !ids.insert(id) {
            return Err("duplicate feature id".into());
        }
        let refs = f["references"]
            .as_array()
            .ok_or("feature references")?
            .iter()
            .map(|r| r.as_str().ok_or("invalid reference"))
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for r in &refs {
            if !references.contains_key(*r) {
                return Err("unknown reference ID".into());
            }
            covered.insert(*r);
        }
        for field in ["visual", "behavior"] {
            if !["pass", "fail", "blocked", "not-tested"].contains(&f[field].as_str().unwrap_or(""))
            {
                return Err("invalid validation status".into());
            }
        }
        for key in ["original_evidence", "blockers", "next_action"] {
            if f.get(key).is_none() {
                return Err("missing evidence/status field".into());
            }
        }
        let done =
            f["visual"] == "pass" && f["behavior"] == "pass" && f["integration"] == "verified";
        let cell = |k: &str| {
            f[k].as_str()
                .unwrap_or("missing")
                .replace('|', "/")
                .replace('\n', " ")
        };
        out.push_str(&format!(
            "| {} {} | {} | {} | {} | {} | {} | {} |\n",
            if done { "[x]" } else { "[ ]" },
            cell("name"),
            refs.join(", "),
            cell("backend"),
            cell("integration"),
            cell("visual"),
            cell("behavior"),
            cell("next_action")
        ));
    }
    if covered.len() != 20 {
        return Err("some screenshots have no feature goal".into());
    }
    let path = root.join("docs/migration/checklist.md");
    if check {
        if fs::read_to_string(path)? != out {
            return Err("generated checklist is stale".into());
        }
    } else {
        fs::write(path, out)?;
    }
    println!(
        "Checklist: {} features across {} verified screenshot references",
        ids.len(),
        covered.len()
    );
    Ok(())
}
