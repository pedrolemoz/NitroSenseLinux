//! Verified 5.2.84 PSSdk query mapping, separate from the frontend-independent API.
use nitrosense_domain::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    Main,
    Monitor,
}
pub fn monitor(s: &Snapshot) -> Json {
    let mut out = serde_json::Map::new();
    for (metric, reading) in &s.readings {
        let key = match metric {
            Metric::CpuLogicalCount => "CPU_CORE_AMOUNT",
            Metric::CpuCoreFrequency => "CPU_CORE_FREQUENCY",
            Metric::CpuFrequency => "CPU_FREQUENCY",
            Metric::CpuMaxFrequency => "CPU_MAX_FREQUENCY",
            Metric::CpuTemperature => "CPU_TEMPERATURE",
            Metric::CpuUsage => "CPU_USAGE",
            Metric::CpuFanRpm => "CPU_FANSPEED",
            Metric::GpuFrequency => "GPU1_FREQUENCY",
            Metric::GpuMaxFrequency => "GPU1_MAX_FREQUENCY",
            Metric::GpuTemperature => "GPU1_TEMPERATURE",
            Metric::GpuUsage => "GPU1_USAGE",
            Metric::GpuFanRpm => "GPU1_FANSPEED",
            Metric::MemoryTotal => "RAM_TOTAL",
            Metric::MemoryUsage => "RAM_USAGE",
            Metric::BatteryPercentage => "BATTERY_PERCENTAGE",
            Metric::BatteryCycleCount => "BATTERY_CYCLE_COUNT",
            Metric::BatteryHealth => "BATTERY_MAX_CAPACITY",
        };
        out.insert(
            key.into(),
            serde_json::to_value(&reading.value).expect("finite adapter value"),
        );
    }
    Json::Object(out)
}
pub fn query(
    channel: Channel,
    id: u32,
    payload: &Json,
    mut sample: impl FnMut() -> Result<Snapshot>,
) -> Result<Json> {
    let object = payload
        .as_object()
        .ok_or_else(|| Failure::new(ErrorCode::InvalidRequest, "acer_payload"))?;
    let function = object.get("Function").and_then(Json::as_str).filter(|f| {
        !f.is_empty()
            && f.len() <= 96
            && f.bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
    });
    let name = match id {
        10 => Some("GET_MONITOR_DATA"),
        30 => Some("GET_CONNECTED_DEVICE"),
        40 => Some("GET_LIGHTING_EFFECT_CAPABILITY"),
        _ => function,
    };
    let reply = |code: &str, data: Json| json!({"request":name,"result":code,"data":data});
    if name.is_none()
        || matches!(id, 10 | 30 | 40) && !object.is_empty()
        || object.keys().any(|k| k != "Function")
    {
        return Ok(reply("3", Json::Null));
    }
    if id == 0 && function == Some("VERSION") && channel == Channel::Main {
        return Ok(reply("0", json!(env!("CARGO_PKG_VERSION"))));
    }
    let relevant = id == 10
        || channel == Channel::Main
            && (id == 20 && function == Some("ADAPTOR_STATUS")
                || id == 0 && matches!(function, Some("SUPPORT_CPU_INFO" | "SUPPORT_GPU_INFO")));
    if !relevant {
        return Ok(reply(
            if matches!(id, 0 | 20 | 30 | 40 | 100) {
                "1"
            } else {
                "3"
            },
            Json::Null,
        ));
    }
    let s = match sample() {
        Ok(s) => s,
        Err(_) => return Ok(reply("1", Json::Null)),
    };
    let data = if id == 10 {
        let d = monitor(&s);
        if d.as_object().is_none_or(|d| d.is_empty()) {
            None
        } else {
            Some(d)
        }
    } else {
        match function {
            Some("ADAPTOR_STATUS") => s.ac_connected.map(|v| json!({"status":u8::from(v)})),
            Some("SUPPORT_CPU_INFO") => s.identity.cpu.as_ref().map(|n| {
                let mut d = json!({"cpu_index":0,"cpu_name":n});
                if let Some(r) = s.readings.get(&Metric::CpuMaxFrequency) {
                    d["cpu_max_frequency"] = json!(r.value);
                }
                json!([d])
            }),
            Some("SUPPORT_GPU_INFO") => s
                .identity
                .gpu
                .as_ref()
                .map(|n| json!([{"gpu_index":1,"gpu_name":n}])),
            _ => None,
        }
    };
    Ok(match data {
        Some(d) => reply("0", d),
        None => reply("1", Json::Null),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_and_write_packets_never_sample_or_write() {
        for (id, payload) in [
            (100, json!({"Function":"SET_FAN_SPEED","Parameter":50})),
            (20, json!({"Function":"UNKNOWN"})),
            (10, json!({"Function":"BAD"})),
        ] {
            let r = query(Channel::Main, id, &payload, || {
                panic!("must not access hardware")
            })
            .unwrap();
            assert_ne!(r["result"], "0");
        }
    }
}
