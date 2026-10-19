use nitrosense_application::{Backend, BatteryCharge, Telemetry};
use nitrosense_domain::{ErrorCode, Failure, Result};
use nitrosense_linux::{LinuxCharge, LinuxDesktop, LinuxTelemetry};
use nitrosense_service::{socket, Dispatcher, Method, Request};
use std::path::PathBuf;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
async fn run() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "help".into());
    let mut path: Option<PathBuf> = None;
    let mut writes = false;
    let mut input = None;
    let mut state: Option<PathBuf> = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--socket" => {
                path = Some(
                    args.next()
                        .ok_or_else(|| Failure::new(ErrorCode::InvalidRequest, "socket_argument"))?
                        .into(),
                )
            }
            "--allow-charge-writes" => writes = true,
            "--state-dir" => {
                state = Some(
                    args.next()
                        .ok_or_else(|| Failure::new(ErrorCode::InvalidRequest, "state_argument"))?
                        .into(),
                )
            }
            "--json" => {
                input = Some(
                    args.next()
                        .ok_or_else(|| Failure::new(ErrorCode::InvalidRequest, "json_argument"))?,
                )
            }
            _ => return Err(Failure::new(ErrorCode::InvalidRequest, "arguments")),
        }
    }
    if command == "help" {
        println!("nitrosense-backend serve [--socket /private/dir/backend.sock] [--allow-charge-writes]\nnitrosense-backend request --socket /private/dir/backend.sock --json '<v1 request>'\nnitrosense-backend snapshot|capabilities|charge-status [--socket /private/dir/backend.sock]");
        return Ok(());
    }
    if command == "diagnose" {
        if path.is_some() || state.is_some() || writes || input.is_some() {
            return Err(Failure::new(
                ErrorCode::InvalidRequest,
                "diagnose_arguments",
            ));
        }
        let mut telemetry = LinuxTelemetry::default();
        let first = telemetry.snapshot()?;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let second = telemetry.snapshot()?;
        let charge = LinuxCharge::default().status();
        println!(
            "{}",
            serde_json::json!({"mode":"direct-read-only-diagnostics","snapshots":[first,second],"charge":charge,
            "limitation":"Live adapter reads only; does not verify socket delivery, original UI, hardware commands or full feature parity"})
        );
        return Ok(());
    }
    let path = path.map(Ok).unwrap_or_else(socket::default_socket)?;
    if command == "serve" {
        if input.is_some() {
            return Err(Failure::new(ErrorCode::InvalidRequest, "serve_arguments"));
        }
        // SAFETY: geteuid has no preconditions. The desktop service never needs root.
        if unsafe { libc::geteuid() } == 0 {
            return Err(Failure::new(
                ErrorCode::PermissionDenied,
                "run_as_desktop_user",
            ));
        }
        let (listener, _guard) = socket::bind(&path)?;
        let state = state.unwrap_or_else(|| {
            std::env::var_os("XDG_STATE_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".local/state")
                })
                .join("nitrosense-linux")
        });
        let desktop = LinuxDesktop::new(state)?;
        eprintln!(
            "NitroSense Rust backend listening; charge writes {}",
            if writes {
                "explicitly enabled"
            } else {
                "disabled"
            }
        );
        socket::serve(
            listener,
            Dispatcher::new(
                Backend::new(LinuxTelemetry::default(), LinuxCharge::default(), writes),
                desktop,
            ),
        )
        .await
    } else {
        if writes || state.is_some() {
            return Err(Failure::new(ErrorCode::InvalidRequest, "serve_option"));
        }
        let request = match command.as_str() {
            "request" => serde_json::from_str::<Request>(
                &input.ok_or_else(|| Failure::new(ErrorCode::InvalidRequest, "json_argument"))?,
            )
            .map_err(|_| Failure::new(ErrorCode::InvalidRequest, "json_request"))?,
            "snapshot" | "capabilities" | "charge-status" if input.is_none() => Request {
                api_version: 1,
                id: 1,
                method: match command.as_str() {
                    "snapshot" => Method::Snapshot,
                    "capabilities" => Method::Capabilities,
                    _ => Method::ChargeStatus,
                },
            },
            _ => return Err(Failure::new(ErrorCode::InvalidRequest, "command")),
        };
        println!("{}", socket::call(&path, &request).await?);
        Ok(())
    }
}
