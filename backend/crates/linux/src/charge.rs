use super::{io_failure, Files};
use nitrosense_application::BatteryCharge;
use nitrosense_domain::*;
use std::{fs::OpenOptions, io::Write, os::unix::fs::OpenOptionsExt};

const WMI: &str = "/sys/bus/wmi/devices/79772EC5-04B1-4BFD-843C-61E7F77B6CC9";
#[derive(Default)]
pub struct LinuxCharge {
    files: Files,
}
impl LinuxCharge {
    fn detect(&self) -> Result<String> {
        // Model scope is deliberate. A generic threshold ABI does not establish Acer semantics.
        if self.files.read("/sys/class/dmi/id/sys_vendor")? != "Acer"
            || self.files.read("/sys/class/dmi/id/product_name")? != "Nitro ANV15-52"
        {
            return Err(Failure::new(ErrorCode::Unsupported, "charge_model"));
        }
        let mut batteries = Vec::new();
        for n in self.files.names("/sys/class/power_supply")? {
            let b = format!("/sys/class/power_supply/{n}");
            if self.files.read(&format!("{b}/type"))? != "Battery" {
                continue;
            }
            let optional = |attr: &str| -> Result<Option<String>> {
                match self.files.read(&format!("{b}/{attr}")) {
                    Ok(v) => Ok(Some(v)),
                    Err(e) if e.code == ErrorCode::Unavailable => Ok(None),
                    Err(e) => Err(e),
                }
            };
            if optional("scope")?.is_some_and(|v| v != "System") {
                continue;
            }
            if optional("present")?.is_some_and(|v| v != "1") {
                continue;
            }
            batteries.push(b);
        }
        if batteries.len() != 1 {
            return Err(Failure::new(
                ErrorCode::Unsupported,
                "single_system_battery",
            ));
        }
        let standard = format!("{}/charge_control_end_threshold", batteries[0]);
        if self.files.path(&standard).exists() {
            return Ok(standard);
        }
        let driver = std::fs::canonicalize(self.files.path(&format!("{WMI}/driver")))
            .map_err(|e| io_failure(e, "charge_driver"))?;
        if driver.file_name().and_then(|s| s.to_str()) != Some("nitrosense_charge") {
            return Err(Failure::new(ErrorCode::Unsupported, "charge_driver"));
        }
        Ok(format!("{WMI}/charge_control_end_threshold"))
    }
}
impl BatteryCharge for LinuxCharge {
    fn status(&self) -> Result<ChargeStatus> {
        let source = self.detect()?;
        let raw = self.files.read(&source)?;
        let observed_limit = raw
            .parse::<u8>()
            .ok()
            .and_then(|n| ChargeLimit::try_from(n).ok())
            .ok_or_else(|| Failure::new(ErrorCode::InvalidReading, "charge_limit"))?;
        // Opening without writing checks actual credentials/ACLs, without changing the setting.
        let writable = OpenOptions::new()
            .write(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(self.files.path(&source))
            .is_ok();
        Ok(ChargeStatus {
            observed_limit,
            writable,
            source,
        })
    }
    fn write(&mut self, limit: ChargeLimit) -> Result<()> {
        let source = self.detect()?;
        let mut attr = OpenOptions::new()
            .write(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(self.files.path(&source))
            .map_err(|e| io_failure(e, "charge_limit"))?;
        attr.write_all(u8::from(limit).to_string().as_bytes())
            .map_err(|e| io_failure(e, "charge_limit"))?;
        Ok(()) // The use case performs a new independent read; the WMI driver also verifies firmware.
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{fixture, write};
    #[test]
    fn discovery_refuses_ambiguous_batteries_and_wrong_model() {
        let (root, files) = fixture();
        write(&files, "/sys/class/dmi/id/sys_vendor", "Acer");
        write(&files, "/sys/class/dmi/id/product_name", "Nitro ANV15-52");
        for b in ["BAT0", "BAT1"] {
            write(
                &files,
                &format!("/sys/class/power_supply/{b}/type"),
                "Battery",
            );
            write(
                &files,
                &format!("/sys/class/power_supply/{b}/charge_control_end_threshold"),
                "80",
            );
        }
        let charge = LinuxCharge {
            files: files.clone(),
        };
        assert_eq!(charge.status().unwrap_err().code, ErrorCode::Unsupported);
        write(&files, "/sys/class/power_supply/BAT1/scope", "Device");
        assert_eq!(
            charge.status().unwrap().observed_limit,
            ChargeLimit::Optimized
        );
        write(&files, "/sys/class/dmi/id/product_name", "other model");
        assert_eq!(charge.status().unwrap_err().code, ErrorCode::Unsupported);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_kernel_state_is_never_a_supported_charge_mode() {
        let (root, files) = fixture();
        write(&files, "/sys/class/dmi/id/sys_vendor", "Acer");
        write(&files, "/sys/class/dmi/id/product_name", "Nitro ANV15-52");
        write(&files, "/sys/class/power_supply/BAT0/type", "Battery");
        write(
            &files,
            "/sys/class/power_supply/BAT0/charge_control_end_threshold",
            "30",
        );
        assert_eq!(
            LinuxCharge { files }.status().unwrap_err().code,
            ErrorCode::InvalidReading
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
