use super::{number, Files};
use nitrosense_application::Telemetry;
use nitrosense_domain::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    time::{SystemTime, UNIX_EPOCH},
};

pub struct LinuxTelemetry {
    files: Files,
    previous_cpu: Option<Counters>,
    gpu: fn(&mut Snapshot) -> Result<()>,
}
impl Default for LinuxTelemetry {
    fn default() -> Self {
        Self {
            files: Files::default(),
            previous_cpu: None,
            gpu: crate::nvidia::sample,
        }
    }
}
struct Counters {
    ticks: Vec<u64>,
    topology: Vec<String>,
}
fn counters(text: &str) -> Result<Counters> {
    let ticks: Vec<u64> = text
        .lines()
        .next()
        .and_then(|l| l.strip_prefix("cpu "))
        .ok_or_else(|| Failure::new(ErrorCode::InvalidReading, "cpu_counters"))?
        .split_whitespace()
        .take(8)
        .map(|s| {
            s.parse()
                .map_err(|_| Failure::new(ErrorCode::InvalidReading, "cpu_counters"))
        })
        .collect::<Result<_>>()?;
    let topology: Vec<_> = text
        .lines()
        .filter_map(|l| l.split_whitespace().next())
        .filter(|s| {
            s.strip_prefix("cpu")
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        })
        .map(str::to_owned)
        .collect();
    if ticks.len() != 8 || topology.is_empty() {
        return Err(Failure::new(ErrorCode::InvalidReading, "cpu_counters"));
    }
    Ok(Counters { ticks, topology })
}
fn cpu_usage(old: &Counters, new: &Counters) -> Option<f64> {
    if old.topology != new.topology || old.ticks.iter().zip(&new.ticks).any(|(a, b)| b < a) {
        return None;
    }
    let deltas: Vec<u128> = old
        .ticks
        .iter()
        .zip(&new.ticks)
        .map(|(a, b)| (b - a) as u128)
        .collect();
    let total: u128 = deltas.iter().sum();
    (total > 0).then(|| (total - deltas[3] - deltas[4]) as f64 / total as f64 * 100.0)
}
fn put(s: &mut Snapshot, metric: Metric, n: f64, unit: Unit, source: &str) {
    if n.is_finite() {
        s.readings.insert(
            metric,
            Reading {
                value: Value::Number(n),
                unit,
                source: source.into(),
            },
        );
    }
}
impl LinuxTelemetry {
    fn cpu(&mut self, s: &mut Snapshot) -> Result<()> {
        let current = match self.files.read("/proc/stat").and_then(|t| counters(&t)) {
            Ok(c) => c,
            Err(e) => {
                self.previous_cpu = None;
                return Err(e);
            }
        };
        if let Some(usage) = self
            .previous_cpu
            .as_ref()
            .and_then(|old| cpu_usage(old, &current))
        {
            put(
                s,
                Metric::CpuUsage,
                usage,
                Unit::Percent,
                "/proc/stat delta; iowait idle; guest excluded",
            );
        }
        self.previous_cpu = Some(current);
        let text = self.files.read("/proc/cpuinfo")?;
        let cpus: Vec<BTreeMap<&str, &str>> = text
            .split("\n\n")
            .map(|b| {
                b.lines()
                    .filter_map(|l| l.split_once(':'))
                    .map(|(k, v)| (k.trim(), v.trim()))
                    .collect()
            })
            .filter(|m: &BTreeMap<_, _>| m.contains_key("processor"))
            .collect();
        let ids: Vec<u32> = cpus
            .iter()
            .map(|c| {
                c["processor"]
                    .parse()
                    .map_err(|_| Failure::new(ErrorCode::InvalidReading, "cpu_identity"))
            })
            .collect::<Result<_>>()?;
        if cpus.is_empty() || ids.iter().collect::<BTreeSet<_>>().len() != ids.len() {
            return Err(Failure::new(ErrorCode::InvalidReading, "cpu_identity"));
        }
        put(
            s,
            Metric::CpuLogicalCount,
            cpus.len() as f64,
            Unit::Count,
            "/proc/cpuinfo logical processors",
        );
        let models: BTreeSet<_> = cpus.iter().filter_map(|c| c.get("model name")).collect();
        let packages: BTreeSet<_> = cpus.iter().filter_map(|c| c.get("physical id")).collect();
        if models.len() == 1
            && packages.len() == 1
            && cpus.iter().all(|c| c.contains_key("physical id"))
        {
            s.identity.cpu = models.first().map(|m| m.to_string());
        }
        let mut ordered: Vec<_> = ids.into_iter().zip(cpus).collect();
        ordered.sort_by_key(|(id, _)| *id);
        let frequencies: Result<Vec<_>> = ordered
            .iter()
            .map(|(_, c)| {
                c.get("cpu MHz")
                    .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "cpu_frequency"))
                    .and_then(|v| number(v, "cpu_frequency"))
                    .and_then(|n| {
                        if n > 0.0 {
                            Ok(n)
                        } else {
                            Err(Failure::new(ErrorCode::InvalidReading, "cpu_frequency"))
                        }
                    })
            })
            .collect();
        match frequencies {
            Ok(values) => {
                put(
                    s,
                    Metric::CpuFrequency,
                    values.iter().sum::<f64>() / values.len() as f64,
                    Unit::Megahertz,
                    "/proc/cpuinfo mean MHz",
                );
                s.readings.insert(
                    Metric::CpuCoreFrequency,
                    Reading {
                        value: Value::Series(values),
                        unit: Unit::Megahertz,
                        source: "/proc/cpuinfo processor order".into(),
                    },
                );
            }
            Err(e) => s.errors.push(e),
        }
        Ok(())
    }
    fn memory(&self, s: &mut Snapshot) -> Result<()> {
        let text = self.files.read("/proc/meminfo")?;
        let field = |key: &str| -> Result<f64> {
            let raw = text
                .lines()
                .find_map(|l| l.strip_prefix(key))
                .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "memory"))?;
            let value = raw
                .trim()
                .strip_suffix(" kB")
                .ok_or_else(|| Failure::new(ErrorCode::InvalidReading, "memory"))?;
            number(value, "memory")
        };
        let total = field("MemTotal:")?;
        let available = field("MemAvailable:")?;
        if total <= 0.0 || available > total {
            return Err(Failure::new(ErrorCode::InvalidReading, "memory"));
        }
        put(
            s,
            Metric::MemoryTotal,
            total / 1024.0,
            Unit::Mebibytes,
            "/proc/meminfo:MemTotal",
        );
        put(
            s,
            Metric::MemoryUsage,
            (total - available) / total * 100.0,
            Unit::Percent,
            "/proc/meminfo:MemAvailable/MemTotal",
        );
        Ok(())
    }
    fn sensors(&self, s: &mut Snapshot) -> Result<()> {
        let mut packages = Vec::new();
        let mut acers = Vec::new();
        for name in self.files.names("/sys/class/hwmon")? {
            let base = format!("/sys/class/hwmon/{name}");
            match self.files.read(&format!("{base}/name")).as_deref() {
                Ok("coretemp") => {
                    for attr in self.files.names(&base)? {
                        if !attr.starts_with("temp") || !attr.ends_with("_label") {
                            continue;
                        }
                        if self
                            .files
                            .read(&format!("{base}/{attr}"))?
                            .starts_with("Package id ")
                        {
                            let source = format!("{base}/{}", attr.replace("_label", "_input"));
                            match self
                                .files
                                .read(&source)
                                .and_then(|v| number(&v, "cpu_temperature"))
                            {
                                Ok(n) if n <= 200000.0 => packages.push((source, n / 1000.0)),
                                _ => s.errors.push(Failure::new(
                                    ErrorCode::InvalidReading,
                                    "cpu_temperature",
                                )),
                            }
                        }
                    }
                }
                Ok("acer") => acers.push(base),
                _ => {}
            }
        }
        if packages.len() == 1 {
            put(
                s,
                Metric::CpuTemperature,
                packages[0].1,
                Unit::Celsius,
                &packages[0].0,
            );
        }
        let kernel = self
            .files
            .read("/proc/sys/kernel/osrelease")
            .unwrap_or_default();
        if acers.len() == 1
            && s.identity.model.as_deref() == Some("Nitro ANV15-52")
            && kernel.starts_with("7.0.")
        {
            let base = &acers[0];
            let driver =
                std::fs::canonicalize(self.files.path(&format!("{base}/device/driver"))).ok();
            if driver
                .as_ref()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                == Some("acer-wmi")
            {
                for (attr, metric, unit, scale, maximum) in [
                    ("fan1_input", Metric::CpuFanRpm, Unit::Rpm, 1.0, 100000.0),
                    ("fan2_input", Metric::GpuFanRpm, Unit::Rpm, 1.0, 100000.0),
                    (
                        "temp2_input",
                        Metric::GpuTemperature,
                        Unit::Celsius,
                        1000.0,
                        200000.0,
                    ),
                ] {
                    let source = format!("{base}/{attr}");
                    match self
                        .files
                        .read(&source)
                        .and_then(|v| number(&v, "acer_sensor"))
                    {
                        Ok(n) if n <= maximum => put(s, metric, n / scale, unit, &source),
                        Ok(_) => s
                            .errors
                            .push(Failure::new(ErrorCode::InvalidReading, "acer_sensor")),
                        Err(e) => s.errors.push(e),
                    }
                }
            }
        }
        Ok(())
    }
    fn power(&self, s: &mut Snapshot) -> Result<()> {
        let mut batteries = Vec::new();
        let mut mains = Vec::new();
        let mut uncertain = false;
        for name in self.files.names("/sys/class/power_supply")? {
            let base = format!("/sys/class/power_supply/{name}");
            let kind = self.files.read(&format!("{base}/type"))?;
            let optional = |attr: &str| -> Result<Option<String>> {
                match self.files.read(&format!("{base}/{attr}")) {
                    Ok(v) => Ok(Some(v)),
                    Err(e) if e.code == ErrorCode::Unavailable => Ok(None),
                    Err(e) => Err(e),
                }
            };
            let scope = optional("scope")?;
            if scope.as_deref() == Some("Device") {
                continue;
            }
            if scope.is_some() && scope.as_deref() != Some("System") {
                uncertain = true;
                continue;
            }
            if kind == "Battery" {
                if optional("present")?.as_deref().is_none_or(|v| v == "1") {
                    batteries.push(base);
                }
            } else {
                let online = self.files.read(&format!("{base}/online"))?;
                match (kind.as_str(), online.as_str()) {
                    ("Mains", "1") => mains.push(true),
                    ("Mains", "0") => mains.push(false),
                    (_, "0") => {}
                    _ => uncertain = true,
                }
            }
        }
        // A positively observed mains input establishes AC even when another
        // charger is present. An offline mains input cannot establish battery-only
        // operation while an unclassified/USB input may still power the system.
        if mains.iter().any(|v| *v) {
            s.ac_connected = Some(true);
        } else if !mains.is_empty() && !uncertain {
            s.ac_connected = Some(false);
        }
        if batteries.len() == 1 {
            let base = &batteries[0];
            for (attr, metric, unit, max) in [
                ("capacity", Metric::BatteryPercentage, Unit::Percent, 100.0),
                (
                    "cycle_count",
                    Metric::BatteryCycleCount,
                    Unit::Count,
                    100000.0,
                ),
            ] {
                let source = format!("{base}/{attr}");
                match self.files.read(&source).and_then(|v| number(&v, "battery")) {
                    Ok(n) if n <= max => put(s, metric, n, unit, &source),
                    Ok(_) => s
                        .errors
                        .push(Failure::new(ErrorCode::InvalidReading, "battery")),
                    Err(e) => s.errors.push(e),
                }
            }
            for kind in ["energy", "charge"] {
                let full = self
                    .files
                    .read(&format!("{base}/{kind}_full"))
                    .and_then(|v| number(&v, "battery_health"));
                let design = self
                    .files
                    .read(&format!("{base}/{kind}_full_design"))
                    .and_then(|v| number(&v, "battery_health"));
                if let (Ok(full), Ok(design)) = (full, design) {
                    if design > 0.0 && full > 0.0 && full <= design * 1.2 {
                        put(
                            s,
                            Metric::BatteryHealth,
                            full / design * 100.0,
                            Unit::Percent,
                            &format!("{base}/{kind}_full / {kind}_full_design"),
                        );
                    } else {
                        s.errors
                            .push(Failure::new(ErrorCode::InvalidReading, "battery_health"));
                    }
                    break;
                }
            }
        }
        Ok(())
    }
}
impl Telemetry for LinuxTelemetry {
    fn snapshot(&mut self) -> Result<Snapshot> {
        let identity = Identity {
            model: self.files.read("/sys/class/dmi/id/product_name").ok(),
            family: self.files.read("/sys/class/dmi/id/product_family").ok(),
            mobile: self
                .files
                .read("/sys/class/dmi/id/chassis_type")
                .ok()
                .and_then(|v| v.parse::<u32>().ok())
                .map(|n| [8, 9, 10, 11, 14, 30, 31, 32].contains(&n)),
            ..Identity::default()
        };
        let mut s = Snapshot {
            sampled_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            readings: BTreeMap::new(),
            ac_connected: None,
            identity,
            errors: Vec::new(),
        };
        if let Err(e) = self.cpu(&mut s) {
            s.errors.push(e);
        }
        if let Err(e) = self.memory(&mut s) {
            s.errors.push(e);
        }
        if let Err(e) = self.sensors(&mut s) {
            s.errors.push(e);
        }
        if let Err(e) = self.power(&mut s) {
            s.errors.push(e);
        }
        if let Err(e) = (self.gpu)(&mut s) {
            s.errors.push(e);
        }
        if let Ok(names) = self.files.names("/sys/devices/system/cpu/cpufreq") {
            let maxima: Result<Vec<f64>> = names
                .iter()
                .filter(|n| {
                    n.strip_prefix("policy")
                        .is_some_and(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
                })
                .map(|n| {
                    self.files
                        .read(&format!(
                            "/sys/devices/system/cpu/cpufreq/{n}/cpuinfo_max_freq"
                        ))
                        .and_then(|v| number(&v, "cpu_max_frequency"))
                        .and_then(|v| {
                            if v > 0.0 {
                                Ok(v)
                            } else {
                                Err(Failure::new(ErrorCode::InvalidReading, "cpu_max_frequency"))
                            }
                        })
                })
                .collect();
            match maxima {
                Err(e) => s.errors.push(e),
                Ok(maxima) => {
                    if let Some(n) = maxima.into_iter().reduce(f64::max) {
                        put(
                            &mut s,
                            Metric::CpuMaxFrequency,
                            n / 1000.0,
                            Unit::Megahertz,
                            "/sys/devices/system/cpu/cpufreq/*/cpuinfo_max_freq",
                        );
                    }
                }
            }
        }
        Ok(s)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{fixture, write};
    #[test]
    fn partial_frequency_policy_failure_cannot_understate_the_maximum() {
        let (root, files) = fixture();
        write(
            &files,
            "/sys/devices/system/cpu/cpufreq/policy0/cpuinfo_max_freq",
            "2400000",
        );
        write(
            &files,
            "/sys/devices/system/cpu/cpufreq/policy1/cpuinfo_max_freq",
            "invalid",
        );
        let mut monitor = LinuxTelemetry {
            files: files.clone(),
            previous_cpu: None,
            gpu: |_| Ok(()),
        };
        assert!(!monitor
            .snapshot()
            .unwrap()
            .readings
            .contains_key(&Metric::CpuMaxFrequency));
        write(
            &files,
            "/sys/devices/system/cpu/cpufreq/policy1/cpuinfo_max_freq",
            "4600000",
        );
        assert!(
            matches!(monitor.snapshot().unwrap().readings[&Metric::CpuMaxFrequency].value,Value::Number(v) if v==4600.0)
        );
        fs_cleanup(root);
    }
    fn fs_cleanup(root: std::path::PathBuf) {
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn mains_presence_is_positive_evidence_but_usb_cannot_be_invented_as_ac_flags() {
        let (root, files) = fixture();
        write(&files, "/sys/class/power_supply/AC/type", "Mains");
        write(&files, "/sys/class/power_supply/AC/online", "1");
        write(&files, "/sys/class/power_supply/USB/type", "USB");
        write(&files, "/sys/class/power_supply/USB/online", "1");
        let mut monitor = LinuxTelemetry {
            files: files.clone(),
            previous_cpu: None,
            gpu: |_| Ok(()),
        };
        assert_eq!(monitor.snapshot().unwrap().ac_connected, Some(true));
        write(&files, "/sys/class/power_supply/AC/online", "0");
        assert_eq!(monitor.snapshot().unwrap().ac_connected, None);
        write(&files, "/sys/class/power_supply/USB/online", "0");
        assert_eq!(monitor.snapshot().unwrap().ac_connected, Some(false));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cpu_delta_omits_boot_reset_topology_change_and_guest_double_counting() {
        let a = counters("cpu  10 0 10 80 0 0 0 0 2 0\ncpu0 0").unwrap();
        let b = counters("cpu  20 0 20 160 0 0 0 0 100 0\ncpu0 0").unwrap();
        assert_eq!(cpu_usage(&a, &b), Some(20.0));
        assert_eq!(cpu_usage(&b, &a), None);
        let c = counters("cpu  20 0 20 160 0 0 0 0\ncpu0 0\ncpu1 0").unwrap();
        assert_eq!(cpu_usage(&a, &c), None);
        assert_eq!(cpu_usage(&a, &a), None);
    }
    #[test]
    fn source_failure_does_not_replay_memory_and_recovers() {
        let (root, files) = fixture();
        write(
            &files,
            "/proc/meminfo",
            "MemTotal: 1024000 kB\nMemAvailable: 512000 kB",
        );
        let mut monitor = LinuxTelemetry {
            files: files.clone(),
            previous_cpu: None,
            gpu: |_| Ok(()),
        };
        assert!(monitor
            .snapshot()
            .unwrap()
            .readings
            .contains_key(&Metric::MemoryUsage));
        write(
            &files,
            "/proc/meminfo",
            "MemTotal: 0 kB\nMemAvailable: 0 kB",
        );
        assert!(!monitor
            .snapshot()
            .unwrap()
            .readings
            .contains_key(&Metric::MemoryUsage));
        write(
            &files,
            "/proc/meminfo",
            "MemTotal: 2048 kB\nMemAvailable: 1024 kB",
        );
        assert!(monitor
            .snapshot()
            .unwrap()
            .readings
            .contains_key(&Metric::MemoryUsage));
        std::fs::remove_dir_all(root).unwrap();
    }
}
