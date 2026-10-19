use crate::{Dispatcher, Method, Request, Response, API_VERSION, MAX_FRAME};
use nitrosense_application::{BatteryCharge, Telemetry};
use nitrosense_domain::*;
use serde_json::Value;
use std::{
    fs,
    os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
    sync::Semaphore,
};

pub fn default_socket() -> Result<PathBuf> {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "XDG_RUNTIME_DIR"))?;
    Ok(PathBuf::from(runtime).join("nitrosense/backend.sock"))
}
fn io(e: std::io::Error) -> Failure {
    nitrosense_linux::io_failure(e, "backend_socket")
}
pub struct SocketGuard {
    path: PathBuf,
    dev: u64,
    ino: u64,
}
impl Drop for SocketGuard {
    fn drop(&mut self) {
        if let Ok(m) = fs::symlink_metadata(&self.path) {
            if m.file_type().is_socket() && m.dev() == self.dev && m.ino() == self.ino {
                let _ = fs::remove_file(&self.path);
            }
        }
    }
}
pub fn bind(path: &Path) -> Result<(UnixListener, SocketGuard)> {
    if !path.is_absolute() {
        return Err(Failure::new(
            ErrorCode::InvalidRequest,
            "absolute_socket_path",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| Failure::new(ErrorCode::InvalidRequest, "socket_parent"))?;
    if !parent.exists() {
        fs::DirBuilder::new()
            .mode(0o700)
            .create(parent)
            .map_err(io)?;
    }
    let m = fs::symlink_metadata(parent).map_err(io)?;
    // SAFETY: geteuid has no preconditions and does not mutate process state.
    let uid = unsafe { libc::geteuid() };
    if m.file_type().is_symlink() || !m.is_dir() || m.uid() != uid || m.mode() & 0o077 != 0 {
        return Err(Failure::new(
            ErrorCode::PermissionDenied,
            "private_socket_directory",
        ));
    }
    // Refuse existing files, including stale sockets. Never unlink a socket owned by another process.
    let listener = UnixListener::bind(path).map_err(io)?;
    let m = fs::symlink_metadata(path).map_err(io)?;
    let guard = SocketGuard {
        path: path.into(),
        dev: m.dev(),
        ino: m.ino(),
    };
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(io)?;
    Ok((listener, guard))
}
pub async fn read_frame<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<Vec<u8>>> {
    let mut bytes = Vec::new();
    let read = tokio::time::timeout(
        Duration::from_secs(10),
        reader
            .take((MAX_FRAME + 1) as u64)
            .read_until(b'\n', &mut bytes),
    )
    .await
    .map_err(|_| Failure::new(ErrorCode::Timeout, "frame"))?
    .map_err(io)?;
    if read == 0 {
        return Ok(None);
    }
    if bytes.len() > MAX_FRAME || bytes.last() != Some(&b'\n') {
        return Err(Failure::new(ErrorCode::Protocol, "frame_size_or_delimiter"));
    }
    Ok(Some(bytes))
}
async fn send<W: tokio::io::AsyncWrite + Unpin>(writer: &mut W, response: &Response) -> Result<()> {
    let mut bytes =
        serde_json::to_vec(response).map_err(|_| Failure::new(ErrorCode::Protocol, "response"))?;
    if bytes.len() >= MAX_FRAME {
        return Err(Failure::new(ErrorCode::Protocol, "response_size"));
    }
    bytes.push(b'\n');
    tokio::time::timeout(Duration::from_secs(5), writer.write_all(&bytes))
        .await
        .map_err(|_| Failure::new(ErrorCode::Timeout, "response_write"))?
        .map_err(io)
}
pub async fn serve<T: Telemetry + 'static, C: BatteryCharge + 'static>(
    listener: UnixListener,
    dispatcher: Dispatcher<T, C>,
) -> Result<()> {
    let state = Arc::new(Mutex::new(dispatcher));
    let permits = Arc::new(Semaphore::new(16));
    let mut tasks = tokio::task::JoinSet::new();
    let mut terminate =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).map_err(io)?;
    loop {
        tokio::select! {
            _=tokio::signal::ctrl_c()=>break,
            _=terminate.recv()=>break,
            Some(_)=tasks.join_next(),if !tasks.is_empty()=>{},
            connection=listener.accept()=>{
                let (stream,_)=connection.map_err(io)?;
                let peer=stream.peer_cred().map_err(io)?;
                // SAFETY: geteuid has no preconditions.
                if peer.uid()!=unsafe{libc::geteuid()} {continue;}
                let Ok(permit)=permits.clone().try_acquire_owned() else {continue;};
                let state=state.clone();
                tasks.spawn(async move { let _permit=permit; let _=connection_loop(stream,state).await; });
            }
        }
    }
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    Ok(())
}
async fn connection_loop<
    T: Telemetry + 'static,
    C: BatteryCharge + 'static,
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
>(
    stream: S,
    state: Arc<Mutex<Dispatcher<T, C>>>,
) -> Result<()> {
    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);
    while let Some(bytes) = read_frame(&mut reader).await? {
        let request: Request = match serde_json::from_slice(&bytes) {
            Ok(r) => r,
            Err(_) => {
                send(
                    &mut writer,
                    &Response::from_result(
                        None,
                        Err(Failure::new(ErrorCode::InvalidRequest, "request")),
                    ),
                )
                .await?;
                continue;
            }
        };
        if let Method::Subscribe { interval_ms } = &request.method {
            if request.api_version != API_VERSION || !(1000..=60000).contains(interval_ms) {
                send(
                    &mut writer,
                    &Response::from_result(
                        Some(request.id),
                        Err(Failure::new(ErrorCode::InvalidRequest, "subscription")),
                    ),
                )
                .await?;
                continue;
            }
            send(
                &mut writer,
                &Response::from_result(
                    Some(request.id),
                    Ok(serde_json::json!({"subscribed":true})),
                ),
            )
            .await?;
            let mut interval = tokio::time::interval(Duration::from_millis(*interval_ms));
            loop {
                // A subscription is a dedicated connection; detect disconnects without waiting for a sample.
                tokio::select! {
                    _=reader.fill_buf()=>return Ok(()),
                    _=interval.tick()=> {
                        let state=state.clone();
                        let result=tokio::task::spawn_blocking(move||state.lock().map_err(|_|Failure::new(ErrorCode::Io,"backend_state"))?.snapshot()
                            .and_then(|s|serde_json::to_value(s).map_err(|_|Failure::new(ErrorCode::Protocol,"snapshot"))))
                            .await.map_err(|_|Failure::new(ErrorCode::Io,"worker"))?;
                        let mut response=Response::from_result(Some(request.id),result);response.event=Some("snapshot".into());
                        send(&mut writer,&response).await?;
                    }
                }
            }
        }
        let id = request.id;
        let state = state.clone();
        let result = tokio::task::spawn_blocking(move || {
            state
                .lock()
                .map_err(|_| Failure::new(ErrorCode::Io, "backend_state"))?
                .dispatch(&request)
        })
        .await
        .map_err(|_| Failure::new(ErrorCode::Io, "worker"))?;
        send(&mut writer, &Response::from_result(Some(id), result)).await?;
    }
    Ok(())
}
pub async fn call(path: &Path, request: &Request) -> Result<Value> {
    let stream = UnixStream::connect(path).await.map_err(io)?;
    let (reader, mut writer) = stream.into_split();
    let mut bytes = serde_json::to_vec(request)
        .map_err(|_| Failure::new(ErrorCode::InvalidRequest, "request"))?;
    if bytes.len() >= MAX_FRAME {
        return Err(Failure::new(ErrorCode::InvalidRequest, "request_size"));
    }
    bytes.push(b'\n');
    tokio::time::timeout(Duration::from_secs(5), writer.write_all(&bytes))
        .await
        .map_err(|_| Failure::new(ErrorCode::Timeout, "request"))?
        .map_err(io)?;
    let mut reader = BufReader::new(reader);
    let bytes = read_frame(&mut reader)
        .await?
        .ok_or_else(|| Failure::new(ErrorCode::Protocol, "missing_response"))?;
    decode_response(&bytes, request.id)
}
fn decode_response(bytes: &[u8], id: u64) -> Result<Value> {
    let response: Value =
        serde_json::from_slice(bytes).map_err(|_| Failure::new(ErrorCode::Protocol, "response"))?;
    if response["api_version"] != API_VERSION || response["id"].as_u64() != Some(id) {
        return Err(Failure::new(ErrorCode::Protocol, "response_identity"));
    }
    match (response.get("result"), response.get("error")) {
        (Some(v), None) => Ok(v.clone()),
        (None, Some(e)) => Err(serde_json::from_value(e.clone())
            .map_err(|_| Failure::new(ErrorCode::Protocol, "error_shape"))?),
        _ => Err(Failure::new(ErrorCode::Protocol, "response_shape")),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Samples;
    impl Telemetry for Samples {
        fn snapshot(&mut self) -> Result<Snapshot> {
            Ok(Snapshot {
                sampled_at_ms: 123,
                readings: Default::default(),
                identity: Default::default(),
                ac_connected: None,
                errors: vec![],
            })
        }
    }
    struct NoCharge;
    impl BatteryCharge for NoCharge {
        fn status(&self) -> Result<ChargeStatus> {
            Err(Failure::new(ErrorCode::Unsupported, "fixture_charge"))
        }
        fn write(&mut self, _: ChargeLimit) -> Result<()> {
            panic!("read-only test must not write")
        }
    }
    fn state() -> (PathBuf, Arc<Mutex<Dispatcher<Samples, NoCharge>>>) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "nitrosense-api-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let desktop = nitrosense_linux::LinuxDesktop::new(root.clone()).unwrap();
        (
            root,
            Arc::new(Mutex::new(Dispatcher::new(
                nitrosense_application::Backend::new(Samples, NoCharge, false),
                desktop,
            ))),
        )
    }
    #[tokio::test]
    async fn protocol_errors_recover_and_subscriptions_close_on_disconnect() {
        let (root, state) = state();
        let (mut client, server) = tokio::io::duplex(MAX_FRAME);
        let task = tokio::spawn(connection_loop(server, state));
        client.write_all(b"{bad}\n{\"api_version\":1,\"id\":8,\"method\":\"preference\",\"key\":\"unset\"}\n").await.unwrap();
        let mut client = BufReader::new(client);
        let bad: Value =
            serde_json::from_slice(&read_frame(&mut client).await.unwrap().unwrap()).unwrap();
        assert_eq!(bad["error"]["code"], "invalid_request");
        let good = read_frame(&mut client).await.unwrap().unwrap();
        assert_eq!(decode_response(&good, 8).unwrap(), Value::Null);
        client
            .get_mut()
            .write_all(
                b"{\"api_version\":1,\"id\":9,\"method\":\"subscribe\",\"interval_ms\":1000}\n",
            )
            .await
            .unwrap();
        let ack = read_frame(&mut client).await.unwrap().unwrap();
        assert_eq!(decode_response(&ack, 9).unwrap()["subscribed"], true);
        let event: Value =
            serde_json::from_slice(&read_frame(&mut client).await.unwrap().unwrap()).unwrap();
        assert_eq!(event["event"], "snapshot");
        assert_eq!(event["result"]["sampled_at_ms"], 123);
        drop(client);
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn socket_rejects_public_directory_and_preserves_existing_files() {
        let root = std::env::temp_dir().join(format!("nitrosense-public-{}", std::process::id()));
        fs::DirBuilder::new().mode(0o755).create(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        let path = root.join("backend.sock");
        fs::write(&path, "preserve me").unwrap();
        assert!(bind(&path).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "preserve me");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn null_success_is_distinct_from_missing_or_mixed_response() {
        assert_eq!(
            decode_response(br#"{"api_version":1,"id":2,"result":null}"#, 2).unwrap(),
            Value::Null
        );
        for b in [
            br#"{"api_version":1,"id":2}"#.as_slice(),
            br#"{"api_version":1,"id":2,"result":null,"error":null}"#,
        ] {
            assert!(decode_response(b, 2).is_err());
        }
        assert!(decode_response(br#"{"api_version":1,"id":3,"result":1}"#, 2).is_err());
    }
    #[tokio::test]
    async fn fragmented_frames_and_overflow_are_bounded() {
        let (mut a, b) = tokio::io::duplex(MAX_FRAME + 10);
        let task = tokio::spawn(async move {
            a.write_all(b"{\"x\"").await.unwrap();
            a.write_all(b":1}\n").await.unwrap();
        });
        let mut reader = BufReader::new(b);
        assert_eq!(
            read_frame(&mut reader).await.unwrap().unwrap(),
            b"{\"x\":1}\n"
        );
        task.await.unwrap();
        let mut big = BufReader::new(std::io::Cursor::new(vec![b'x'; MAX_FRAME + 1]));
        assert_eq!(
            read_frame(&mut big).await.unwrap_err().code,
            ErrorCode::Protocol
        );
        let mut truncated = BufReader::new(std::io::Cursor::new(b"{}"));
        assert!(read_frame(&mut truncated).await.is_err());
    }
}
