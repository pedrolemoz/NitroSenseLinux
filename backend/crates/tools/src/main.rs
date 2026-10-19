mod audit;
mod checklist;
mod import;
mod original;
mod setup;
use std::path::{Path, PathBuf};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
fn run() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "help".into());
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()?;
    let mut vendor = root.join("vendor/nitrosense-5.2.84-official");
    let mut symbols = Vec::new();
    let mut verify = false;
    let mut base = std::env::var("RE_AUDIT_BASE").unwrap_or_else(|_| "HEAD".into());
    let mut check = false;
    let mut zip = None;
    let mut output = None;
    let mut runtime = true;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--vendor" => vendor = PathBuf::from(args.next().ok_or("missing vendor path")?),
            "--symbol" => symbols.push(args.next().ok_or("missing symbol")?),
            "--verify-original" => verify = true,
            "--base" => base = args.next().ok_or("missing base revision")?,
            "--check" => check = true,
            "--zip" => {
                zip = Some(PathBuf::from(
                    args.next().ok_or("missing official ZIP path")?,
                ))
            }
            "--output" => {
                output = Some(PathBuf::from(
                    args.next().ok_or("missing import output path")?,
                ))
            }
            "--no-runtime" => runtime = false,
            _ => return Err(format!("unknown argument: {a}").into()),
        }
    }
    match command.as_str(){
        "setup"=>setup::setup(&root,zip,output,runtime)?,
        "import"=>import::import(&zip.ok_or("--zip required")?,&output.ok_or("--output required")?)?,
        "check-original"=>println!("{}",original::verify_vendor(&vendor)?),
        "inspect-original"=>original::inspect(&root,&vendor,&symbols)?,
        "audit"=>audit::run(&root,&vendor,&base,verify)?,
        "checklist"=>checklist::generate(&root,check)?,
        "help"=>println!("nitrosense-tools setup [--zip FILE] [--output DIR] [--no-runtime]\nnitrosense-tools import --zip FILE --output NEW_DIR\nnitrosense-tools check-original [--vendor DIR]\nnitrosense-tools inspect-original [--vendor DIR] [--symbol NAME ...]\nnitrosense-tools audit [--base REV] [--verify-original] [--vendor DIR]\nnitrosense-tools checklist [--check]"),
        _=>return Err("unknown command".into()),
    }
    Ok(())
}
