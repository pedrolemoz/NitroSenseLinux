# Independent Rust backend

The domain and application crates have no Electron, Acer protocol, procfs or sysfs dependencies. Linux adapters implement their ports. The service composes adapters and delivers the public API; `service::acer` is an outer compatibility adapter for Acer's original SDK queries.

```sh
cargo build --manifest-path backend/Cargo.toml --locked
cargo test --manifest-path backend/Cargo.toml --locked
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
```

Start as the desktop user. The default socket is `$XDG_RUNTIME_DIR/nitrosense/backend.sock`. Its immediate parent must be owned by that user and private (0700); the socket is 0600 and accepts only matching peer UIDs. Existing sockets/files are refused, including stale sockets after a crash. Inspect and remove a stale socket yourself only after confirming its previous process has exited.

```sh
backend/target/debug/nitrosense-backend serve
backend/target/debug/nitrosense-backend snapshot
backend/target/debug/nitrosense-backend capabilities
backend/target/debug/nitrosense-backend charge-status
```

Use `--socket /absolute/private/directory/backend.sock` on both commands for a separate session. `serve --state-dir /absolute/private/directory` selects the backend's preferences directory; otherwise it uses XDG state storage. An exclusive state-directory lock refuses competing backend writers. Preferences are distinct from observed hardware state and from Acer's original frontend stores. Corrupt or interrupted preference staging is reported; it is not silently replaced. Existing Node preferences are not automatically migrated or deleted.

`diagnose` directly reads two real Linux samples and charge status without opening a socket or writing hardware. Its output is private diagnostic evidence, not frontend acceptance.

## Public API v1

The transport is newline-delimited UTF-8 JSON. Each request includes `api_version: 1`, an unsigned integer `id`, and a `method`. Unknown fields/methods and unsupported versions are rejected. Example:

```json
{"api_version":1,"id":1,"method":"snapshot"}
```

Responses contain the version, correlated ID and exactly one of `result` or a typed `error`. A successful `result: null` is valid. Malformed JSON has a null response ID. Units and sources accompany each available reading; missing values are absent rather than zero or historical samples.

| Method | Additional fields | Result |
| --- | --- | --- |
| `capabilities` | none | Current available metrics, charge availability/policy, unimplemented commands |
| `snapshot` | none | Timestamped real readings, source errors, identity and nullable AC observation |
| `charge_status` | none | Observed 80/100 threshold, writability and actual kernel source |
| `set_charge_limit` | `limit`: 80 or 100 | Requested limit and independently read-back observed state |
| `subscribe` | `interval_ms`: 1000–60000 | Acknowledgement followed by correlated `snapshot` events on a dedicated connection |
| `applications` | `locale` | Real XDG application catalog; not a launch/association claim |
| `processes`, `keyboards` | none | Real OS discovery |
| `device_identifier` | `name`: serial or uuid | Actual DMI identifier or error; never fabricated |
| `preference` | `key` | Saved value or null |
| `set_preference` | `key`, `value`: string or unsigned 32-bit integer | Null after atomic persistence |

The service limits connections, pending work through connection serialization, frame sizes, idle reads, response writes and NVIDIA helper runtime/output. The desktop user can explicitly enable the existing charge ABI with `serve --allow-charge-writes`; the frontend launcher does not do so. There are no fan, operating-mode, calibration, audio or boot-logo command implementations.

`acer_query` is an outer adapter extension with `channel`, `packet_id` and `payload`, used by the retained Acer host. New frontends should use the independent methods above. This extension cannot execute native writes or invent capabilities.

## Rust research tools

```sh
backend/target/debug/nitrosense-tools check-original
backend/target/debug/nitrosense-tools inspect-original --symbol getMonitorData
backend/target/debug/nitrosense-tools audit --verify-original
backend/target/debug/nitrosense-tools checklist --check
backend/target/debug/nitrosense-tools import --zip /path/to/official.zip --output /path/to/new-import
backend/target/debug/nitrosense-tools setup
```

Import requires installed `/usr/bin/unzip`, `/usr/bin/msiinfo` and `/usr/bin/cabextract`. It verifies the official ZIP, AppX, MSI and ASAR hashes before using their data, stages privately, checks paths/sizes/table graphs/cabinet members and publishes only a verified import. It never executes Acer binaries or MSI custom actions. Failed staging is retained for inspection and is never overwritten. `setup` reuses a verified import or downloads the pinned ZIP directly from Acer, then provisions the pinned Electron frontend using npm. `--zip` accepts a local official ZIP and `--no-runtime` skips frontend provisioning. Interrupted downloads are retained and refused on retry. The tools currently run from the source checkout; release packaging remains pending.

See `docs/migration/features.json` and its generated checklist for actual acceptance, including missing fields and unresolved original-native contracts. Passing these tests does not establish complete parity, a security audit, minimum-toolchain support or multi-model compatibility.
