//! Versioned delivery API. Acer wire compatibility belongs only to this layer.
pub mod acer;
pub mod socket;
use nitrosense_application::{Backend, BatteryCharge, DesktopQueries, Telemetry};
use nitrosense_domain::*;
use nitrosense_linux::LinuxDesktop;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

pub const API_VERSION: u32 = 1;
pub const MAX_FRAME: usize = 65536;
#[derive(Debug, Serialize)]
pub struct Request {
    pub api_version: u32,
    pub id: u64,
    #[serde(flatten)]
    pub method: Method,
}
impl<'de> Deserialize<'de> for Request {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        let v = Json::deserialize(d)?;
        let obj = v
            .as_object()
            .ok_or_else(|| serde::de::Error::custom("request object required"))?;
        let extra: &[&str] = match obj.get("method").and_then(Json::as_str) {
            Some("capabilities" | "snapshot" | "charge_status") => &[],
            Some("set_charge_limit") => &["limit"],
            Some("subscribe") => &["interval_ms"],
            Some("applications") => &["locale"],
            Some("processes" | "keyboards") => &[],
            Some("device_identifier") => &["name"],
            Some("preference") => &["key"],
            Some("set_preference") => &["key", "value"],
            Some("acer_query") => &["channel", "packet_id", "payload"],
            _ => return Err(serde::de::Error::custom("unknown method")),
        };
        if obj.keys().any(|k| {
            !["api_version", "id", "method"].contains(&k.as_str()) && !extra.contains(&k.as_str())
        }) {
            return Err(serde::de::Error::custom("unknown request field"));
        }
        #[derive(Deserialize)]
        struct Wire {
            api_version: u32,
            id: u64,
            #[serde(flatten)]
            method: Method,
        }
        let w: Wire = serde_json::from_value(v).map_err(serde::de::Error::custom)?;
        Ok(Self {
            api_version: w.api_version,
            id: w.id,
            method: w.method,
        })
    }
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "method", rename_all = "snake_case", deny_unknown_fields)]
pub enum Method {
    Capabilities,
    Snapshot,
    ChargeStatus,
    SetChargeLimit {
        limit: ChargeLimit,
    },
    Subscribe {
        interval_ms: u64,
    },
    Applications {
        locale: String,
    },
    Processes,
    Keyboards,
    DeviceIdentifier {
        name: String,
    },
    Preference {
        key: String,
    },
    SetPreference {
        key: String,
        value: Preference,
    },
    /// Adapter extension: not used by application or domain types.
    AcerQuery {
        channel: acer::Channel,
        packet_id: u32,
        payload: Json,
    },
}
#[derive(Debug, Deserialize, Serialize)]
pub struct Response {
    pub api_version: u32,
    pub id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Json>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Failure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
}
impl Response {
    pub fn from_result(id: Option<u64>, result: Result<Json>) -> Self {
        let (result, error) = match result {
            Ok(v) => (Some(v), None),
            Err(e) => (None, Some(e)),
        };
        Self {
            api_version: API_VERSION,
            id,
            result,
            error,
            event: None,
        }
    }
}
pub struct Dispatcher<T, C> {
    backend: Backend<T, C>,
    desktop: DesktopQueries<LinuxDesktop>,
    cached: Option<(std::time::Instant, Snapshot)>,
}
impl<T: Telemetry, C: BatteryCharge> Dispatcher<T, C> {
    pub fn new(backend: Backend<T, C>, desktop: LinuxDesktop) -> Self {
        Self {
            backend,
            desktop: DesktopQueries::new(desktop),
            cached: None,
        }
    }
    pub fn snapshot(&mut self) -> Result<Snapshot> {
        if let Some((at, s)) = &self.cached {
            if at.elapsed() < std::time::Duration::from_millis(250) {
                return Ok(s.clone());
            }
        }
        let s = self.backend.snapshot()?;
        self.cached = Some((std::time::Instant::now(), s.clone()));
        Ok(s)
    }
    pub fn dispatch(&mut self, r: &Request) -> Result<Json> {
        if r.api_version != API_VERSION {
            return Err(Failure::new(ErrorCode::VersionMismatch, "api_version"));
        }
        match &r.method {
            Method::Snapshot => encode(self.snapshot()?),
            Method::ChargeStatus => encode(self.backend.charge_status()?),
            Method::SetChargeLimit { limit } => encode(self.backend.set_charge_limit(*limit)?),
            Method::Capabilities => {
                let charge = self.backend.charge_status();
                let snapshot = self.snapshot()?;
                Ok(
                    json!({"api_version":API_VERSION,"target_model":"Nitro ANV15-52",
                    "available_metrics": snapshot.readings.keys().collect::<Vec<_>>(),
                    "charge": match charge { Ok(s) => json!({"available":true,"writable":s.writable,"limits":[80,100]}), Err(e) => json!({"available":false,"error":e}) },
                    "unimplemented_commands":["fan_mode","fan_speed","operating_mode","audio_profile","calibration","usb_charging","boot_logo"]}),
                )
            }
            Method::Subscribe { .. } => Err(Failure::new(
                ErrorCode::InvalidRequest,
                "subscription_transport",
            )),
            Method::Applications { locale } => encode(self.desktop.applications(locale)?),
            Method::Processes => encode(self.desktop.processes()?),
            Method::Keyboards => encode(self.desktop.keyboards()?),
            Method::DeviceIdentifier { name } => encode(self.desktop.identifier(name)?),
            Method::Preference { key } => encode(self.desktop.preference(key)?),
            Method::SetPreference { key, value } => {
                self.desktop.set_preference(key, value.clone())?;
                Ok(Json::Null)
            }
            Method::AcerQuery {
                channel,
                packet_id,
                payload,
            } => {
                // Capability/status reads only. Unknown or native writes never fall through to a device.
                acer::query(*channel, *packet_id, payload, || self.snapshot())
            }
        }
    }
}
fn encode(value: impl Serialize) -> Result<Json> {
    serde_json::to_value(value).map_err(|_| Failure::new(ErrorCode::Protocol, "serialization"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_version_fields_and_invalid_charge_mode() {
        for input in [
            r#"{"api_version":1,"id":1,"method":"set_charge_limit","limit":30}"#,
            r#"{"api_version":1,"id":1,"method":"snapshot","surprise":true}"#,
        ] {
            assert!(serde_json::from_str::<Request>(input).is_err(), "{input}");
        }
        assert!(
            serde_json::from_str::<Request>(r#"{"api_version":1,"id":1,"method":"snapshot"}"#)
                .is_ok()
        );
    }
}
