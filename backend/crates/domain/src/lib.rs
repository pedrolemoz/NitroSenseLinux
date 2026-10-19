//! Frontend-independent observations and errors. No Acer protocol or OS APIs.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Unsupported,
    Unavailable,
    PermissionDenied,
    InvalidRequest,
    InvalidReading,
    ReadbackMismatch,
    Busy,
    Io,
    Timeout,
    Protocol,
    VersionMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Failure {
    pub code: ErrorCode,
    pub operation: String,
}
impl Failure {
    pub fn new(code: ErrorCode, operation: impl Into<String>) -> Self {
        Self {
            code,
            operation: operation.into(),
        }
    }
}
impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.operation)
    }
}
impl std::error::Error for Failure {}
pub type Result<T> = std::result::Result<T, Failure>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Metric {
    CpuLogicalCount,
    CpuCoreFrequency,
    CpuFrequency,
    CpuMaxFrequency,
    CpuTemperature,
    CpuUsage,
    CpuFanRpm,
    GpuFrequency,
    GpuMaxFrequency,
    GpuTemperature,
    GpuUsage,
    GpuFanRpm,
    MemoryTotal,
    MemoryUsage,
    BatteryPercentage,
    BatteryCycleCount,
    BatteryHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    Number(f64),
    Series(Vec<f64>),
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Unit {
    Count,
    Megahertz,
    Celsius,
    Percent,
    Rpm,
    Mebibytes,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reading {
    pub value: Value,
    pub unit: Unit,
    pub source: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Identity {
    pub model: Option<String>,
    pub family: Option<String>,
    pub cpu: Option<String>,
    pub gpu: Option<String>,
    pub mobile: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub sampled_at_ms: u64,
    pub readings: BTreeMap<Metric, Reading>,
    pub ac_connected: Option<bool>,
    pub identity: Identity,
    pub errors: Vec<Failure>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub enum ChargeLimit {
    Optimized,
    Full,
}
impl TryFrom<u8> for ChargeLimit {
    type Error = Failure;
    fn try_from(n: u8) -> Result<Self> {
        match n {
            80 => Ok(Self::Optimized),
            100 => Ok(Self::Full),
            _ => Err(Failure::new(ErrorCode::InvalidRequest, "charge_limit")),
        }
    }
}
impl From<ChargeLimit> for u8 {
    fn from(n: ChargeLimit) -> Self {
        match n {
            ChargeLimit::Optimized => 80,
            ChargeLimit::Full => 100,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChargeStatus {
    pub observed_limit: ChargeLimit,
    pub writable: bool,
    pub source: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandReceipt {
    pub requested_limit: ChargeLimit,
    pub observed: ChargeStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopApplication {
    pub id: String,
    pub name: String,
    pub desktop_file: String,
    pub executable: Option<String>,
    pub icon: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Process {
    pub pid: u32,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyboard {
    pub vendor: String,
    pub product: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Preference {
    Text(String),
    Number(u32),
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn charge_mode_has_no_usb_or_arbitrary_threshold() {
        assert_eq!(ChargeLimit::try_from(80).unwrap(), ChargeLimit::Optimized);
        assert_eq!(ChargeLimit::try_from(100).unwrap(), ChargeLimit::Full);
        assert!(ChargeLimit::try_from(30).is_err());
        assert!(ChargeLimit::try_from(81).is_err());
    }
}
