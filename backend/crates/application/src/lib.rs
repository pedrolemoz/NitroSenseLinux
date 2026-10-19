//! Inward-facing ports and use cases. Adapters own discovery and hardware details.
use nitrosense_domain::*;

pub trait Telemetry: Send {
    fn snapshot(&mut self) -> Result<Snapshot>;
}
pub trait BatteryCharge: Send {
    fn status(&self) -> Result<ChargeStatus>;
    fn write(&mut self, limit: ChargeLimit) -> Result<()>;
}
/// OS inventory and user-owned preferences, independent of Acer's registry API.
pub trait DesktopPlatform: Send {
    fn applications(&self, locale: &str) -> Result<Vec<DesktopApplication>>;
    fn processes(&self) -> Result<Vec<Process>>;
    fn keyboards(&self) -> Result<Vec<Keyboard>>;
    fn identifier(&self, name: &str) -> Result<String>;
    fn preference(&self, key: &str) -> Result<Option<Preference>>;
    fn set_preference(&mut self, key: &str, value: Preference) -> Result<()>;
}
pub struct DesktopQueries<P> {
    platform: P,
}
impl<P: DesktopPlatform> DesktopQueries<P> {
    pub fn new(platform: P) -> Self {
        Self { platform }
    }
    pub fn applications(&self, locale: &str) -> Result<Vec<DesktopApplication>> {
        self.platform.applications(locale)
    }
    pub fn processes(&self) -> Result<Vec<Process>> {
        self.platform.processes()
    }
    pub fn keyboards(&self) -> Result<Vec<Keyboard>> {
        self.platform.keyboards()
    }
    pub fn identifier(&self, name: &str) -> Result<String> {
        if !["serial", "uuid"].contains(&name) {
            return Err(Failure::new(ErrorCode::InvalidRequest, "identifier"));
        }
        self.platform.identifier(name)
    }
    pub fn preference(&self, key: &str) -> Result<Option<Preference>> {
        self.platform.preference(key)
    }
    pub fn set_preference(&mut self, key: &str, value: Preference) -> Result<()> {
        self.platform.set_preference(key, value)
    }
}
pub struct Backend<T, C> {
    telemetry: T,
    charge: C,
    allow_charge_writes: bool,
}
impl<T: Telemetry, C: BatteryCharge> Backend<T, C> {
    pub fn new(telemetry: T, charge: C, allow_charge_writes: bool) -> Self {
        Self {
            telemetry,
            charge,
            allow_charge_writes,
        }
    }
    pub fn snapshot(&mut self) -> Result<Snapshot> {
        self.telemetry.snapshot()
    }
    pub fn charge_status(&self) -> Result<ChargeStatus> {
        let mut status = self.charge.status()?;
        status.writable &= self.allow_charge_writes;
        Ok(status)
    }
    pub fn set_charge_limit(&mut self, limit: ChargeLimit) -> Result<CommandReceipt> {
        if !self.allow_charge_writes {
            return Err(Failure::new(
                ErrorCode::PermissionDenied,
                "charge_writes_disabled",
            ));
        }
        if !self.charge.status()?.writable {
            return Err(Failure::new(ErrorCode::PermissionDenied, "charge_limit"));
        }
        self.charge.write(limit)?;
        let observed = self.charge.status()?;
        if observed.observed_limit != limit {
            return Err(Failure::new(ErrorCode::ReadbackMismatch, "charge_limit"));
        }
        Ok(CommandReceipt {
            requested_limit: limit,
            observed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct NoTelemetry;
    impl Telemetry for NoTelemetry {
        fn snapshot(&mut self) -> Result<Snapshot> {
            Err(Failure::new(ErrorCode::Unavailable, "test"))
        }
    }
    struct Charge {
        observed: ChargeLimit,
        accept: bool,
        writes: usize,
    }
    impl BatteryCharge for Charge {
        fn status(&self) -> Result<ChargeStatus> {
            Ok(ChargeStatus {
                observed_limit: self.observed,
                writable: true,
                source: "fixture".into(),
            })
        }
        fn write(&mut self, value: ChargeLimit) -> Result<()> {
            self.writes += 1;
            if self.accept {
                self.observed = value;
            }
            Ok(())
        }
    }
    #[test]
    fn read_only_does_not_write() {
        let mut b = Backend::new(
            NoTelemetry,
            Charge {
                observed: ChargeLimit::Optimized,
                accept: true,
                writes: 0,
            },
            false,
        );
        assert!(!b.charge_status().unwrap().writable);
        assert_eq!(
            b.set_charge_limit(ChargeLimit::Full).unwrap_err().code,
            ErrorCode::PermissionDenied
        );
        assert_eq!(b.charge.writes, 0);
    }
    #[test]
    fn write_requires_independent_readback() {
        let mut b = Backend::new(
            NoTelemetry,
            Charge {
                observed: ChargeLimit::Optimized,
                accept: false,
                writes: 0,
            },
            true,
        );
        assert_eq!(
            b.set_charge_limit(ChargeLimit::Full).unwrap_err().code,
            ErrorCode::ReadbackMismatch
        );
        b.charge.accept = true;
        assert_eq!(
            b.set_charge_limit(ChargeLimit::Full)
                .unwrap()
                .observed
                .observed_limit,
            ChargeLimit::Full
        );
    }
}
