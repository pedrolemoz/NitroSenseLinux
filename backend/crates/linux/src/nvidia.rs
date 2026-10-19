//! Bounded query of the installed NVIDIA utility. No shell or stable numeric GPU-index assumption.
use nitrosense_domain::*;
use std::{
    io::Read,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn failure(code: ErrorCode) -> Failure {
    Failure::new(code, "nvidia-smi")
}
pub fn sample(s: &mut Snapshot) -> Result<()> {
    let mut child=Command::new("/usr/bin/nvidia-smi").args([
        "--query-gpu=pci.bus_id,name,temperature.gpu,utilization.gpu,clocks.current.graphics,clocks.max.graphics",
        "--format=csv,noheader,nounits"])
        .env_clear().env("LC_ALL","C").env("PATH","/usr/bin:/bin")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
        .map_err(|e|crate::io_failure(e,"nvidia-smi"))?;
    let stdout = child.stdout.take().ok_or_else(|| failure(ErrorCode::Io))?;
    let output = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.take(65537).read_to_end(&mut bytes).map(|_| bytes)
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if start.elapsed() < Duration::from_millis(1500) => {
                std::thread::sleep(Duration::from_millis(10))
            }
            Ok(None) => break Err(failure(ErrorCode::Timeout)),
            Err(_) => break Err(failure(ErrorCode::Io)),
        }
    };
    if status.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let bytes = output
        .join()
        .map_err(|_| failure(ErrorCode::Io))?
        .map_err(|_| failure(ErrorCode::Io))?;
    if !status?.success() {
        return Err(failure(ErrorCode::Unavailable));
    }
    if bytes.len() > 65536 {
        return Err(failure(ErrorCode::InvalidReading));
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| failure(ErrorCode::InvalidReading))?;
    parse(text, s)
}
fn csv(line: &str) -> Result<Vec<String>> {
    let mut fields = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut ended = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted => {
                if chars.peek() == Some(&'"') {
                    cell.push('"');
                    chars.next();
                } else {
                    quoted = false;
                    ended = true;
                }
            }
            '"' if cell.trim().is_empty() && !ended => {
                cell.clear();
                quoted = true;
            }
            ',' if !quoted => {
                fields.push(cell.trim().to_owned());
                cell.clear();
                ended = false;
            }
            _ if quoted => cell.push(c),
            '"' => return Err(failure(ErrorCode::InvalidReading)),
            _ if ended && !c.is_whitespace() => return Err(failure(ErrorCode::InvalidReading)),
            _ => cell.push(c),
        }
    }
    if quoted {
        return Err(failure(ErrorCode::InvalidReading));
    }
    fields.push(cell.trim().to_owned());
    Ok(fields)
}
fn parse(text: &str, s: &mut Snapshot) -> Result<()> {
    let rows = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(csv)
        .collect::<Result<Vec<_>>>()?;
    // A multi-GPU query does not establish which device Acer calls GPU1.
    if rows.len() != 1 {
        return Err(failure(ErrorCode::Unsupported));
    }
    let row = &rows[0];
    if row.len() != 6
        || row[1].is_empty()
        || row[1].chars().any(char::is_control)
        || !valid_pci(&row[0])
    {
        return Err(failure(ErrorCode::InvalidReading));
    }
    s.identity.gpu = Some(row[1].clone());
    for (column, metric, unit, max) in [
        (2, Metric::GpuTemperature, Unit::Celsius, 200.0),
        (3, Metric::GpuUsage, Unit::Percent, 100.0),
        (4, Metric::GpuFrequency, Unit::Megahertz, 100000.0),
        (5, Metric::GpuMaxFrequency, Unit::Megahertz, 100000.0),
    ] {
        let source = format!("nvidia-smi:{}:column{}", row[0], column);
        match crate::number(&row[column], "nvidia_metric") {
            Ok(n) if n <= max && !(column == 5 && n == 0.0) => {
                s.readings.insert(
                    metric,
                    Reading {
                        value: Value::Number(n),
                        unit,
                        source,
                    },
                );
            }
            _ => s
                .errors
                .push(Failure::new(ErrorCode::Unavailable, "nvidia_metric")),
        }
    }
    Ok(())
}
fn valid_pci(s: &str) -> bool {
    let parts: Vec<_> = s.split([':', '.']).collect();
    parts.len() == 4
        && matches!(parts[0].len(), 4 | 8)
        && parts[1].len() == 2
        && parts[2].len() == 2
        && parts[3].len() == 1
        && parts
            .iter()
            .all(|s| s.bytes().all(|b| b.is_ascii_hexdigit()))
        && parts[3].parse::<u8>().is_ok_and(|n| n <= 7)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn empty() -> Snapshot {
        Snapshot {
            sampled_at_ms: 0,
            readings: Default::default(),
            ac_connected: None,
            identity: Default::default(),
            errors: vec![],
        }
    }
    #[test]
    fn rejects_ambiguous_gpu_and_preserves_partial_readings() {
        let row = "00000000:01:00.0, NVIDIA example, 40, N/A, 500, 2000\n";
        let mut s = empty();
        parse(row, &mut s).unwrap();
        assert!(s.readings.contains_key(&Metric::GpuTemperature));
        assert!(!s.readings.contains_key(&Metric::GpuUsage));
        assert!(parse(&(row.to_owned() + row), &mut empty()).is_err());
        assert!(parse("0, not a PCI identity, 40, 1, 500, 2000", &mut empty()).is_err());
    }
}
