# Contributing

This project is preparing for an open-source release; a license has not been selected yet. Please clarify licensing before proposing substantial code contributions. Do not add a license or third-party material on someone else's behalf.

For development, read the [architecture and test notes](docs/development.md), then run `npm test`. Keep changes focused and describe what changed, why, which tests ran, and whether real hardware was involved. Source-only tests do not require Acer files; vendor integration tests need your own local import and may skip without it.

For a bug report, provide the laptop model, CPU/GPU, Ubuntu/kernel version, desktop session, NVIDIA driver version, command used, observed behavior and a redacted summary. Compatibility outside the README's exact setup is unverified. See [manual testing](docs/manual-testing.md) for hardware checks.

Never submit Acer installer ZIPs, MSI/AppX/ASAR files, extracted application code/resources, credentials or private session logs. The original UI and resources must remain user-supplied. Keep generated data in the ignored local directories and review the staged diff before opening a change.

The [roadmap](docs/roadmap.md) defines initial release scope. Hardware control is future work and needs explicit model-specific validation before being exposed to users.
