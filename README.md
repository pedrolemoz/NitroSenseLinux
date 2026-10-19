# NitroSense Linux Compatibility

An experimental compatibility layer that runs the **original Acer NitroSense interface on Linux** and connects it to real Linux monitoring data. This is an independent project, not an official Acer product.

**Current milestone: real read-only monitoring works on the machine below.** The maintainer confirmed the application working after rebooting following an NVIDIA driver update. This is a development build, not a finished NitroSense port or an initial stable release.

> **Download directly from Acer.** `npm run setup` downloads the official **NitroSense 5.2.84** package, verifies its pinned SHA-256, extracts the resources on Linux, and installs the pinned Electron runtime. Acer files stay local and are excluded from Git.

## Checked compatibility

Compatibility has **only** been checked with this setup:

| Component | Verified setup |
| --- | --- |
| Laptop | Acer Nitro V15 **ANV15-52** |
| CPU | Intel Core **i5-13420H** |
| GPU | NVIDIA GeForce **RTX 4050 Laptop GPU** |
| OS | **Ubuntu 26.04.1 LTS**, x86_64 |
| Desktop session | **Wayland** |
| Graphics driver | **NVIDIA proprietary drivers** |

Other Acer models, distributions, kernels, graphics drivers, X11 sessions, and hardware combinations are unverified. A Wayland desktop does not establish that Electron is running natively through Wayland; XWayland may be used. Acer fan/GPU temperature channel mapping is currently restricted in code to this model with the `acer-wmi` driver on **Linux 7.0.x**.

## Development status

| Area | Status |
| --- | --- |
| Original UI | Opens under the pinned Linux Electron runtime; original ASAR remains unchanged |
| Real CPU/RAM monitoring | Implemented and exercised in the original UI: usage, CPU clock/temperature, memory usage |
| NVIDIA monitoring | Implemented through `nvidia-smi`; requires a working driver/userspace combination; user confirmed operation after reboot |
| Acer fan RPM / GPU temperature | Read-only integration with verified Acer hwmon channels |
| Battery | Real charge, cycle count, and full/design capacity ratio when the kernel exposes them |
| Application catalog | Lists Linux desktop entries; launching and game association remain incomplete |
| Fan control, performance modes, lighting | **Not implemented or validated for Linux hardware control** |
| Acer services / full Checkup / complete system information | Incomplete or unsupported |
| Packaging / first release | Source-run workflow only; no ready-made Linux installer |

Missing measurements appear as `--`; they are not replaced by simulated readings. Normal launch commands select **read-only mode with SimulatorMode=0**. A separate, explicitly named UI-only developer experiment still exists and uses the original Acer simulator.

See [detailed status](docs/status.md) and the [initial release roadmap](docs/roadmap.md).

## Requirements

- The official **Acer NitroSense 5.2.84 ZIP**, downloaded automatically by setup or supplied locally.
- The checked Linux desktop setup above, with readable `/proc` and `/sys` interfaces.
- **Node.js 18 or newer** and **npm**. The current development machine uses Node.js 22; Node 18 is the declared minimum, not a promise of ongoing upstream support.
- **msitools** (`msiinfo`) and **cabextract** for extracting the MSI resources on Linux; **unzip** only if manually unpacking your ZIP.
- **Electron 26.6.10**, installed locally using npm. The runtime is pinned to the reviewed Acer application; changing Electron versions is not currently supported.
- Standard Electron desktop libraries (GTK 3, NSS, ALSA, GBM, X11/XWayland dependencies). A normal Ubuntu desktop already supplies many of these.
- Working **NVIDIA proprietary drivers** and `nvidia-smi` for GPU utilization/name/clocks. The kernel module and userspace driver must match.
- Kernel `coretemp` and `acer_wmi` interfaces for the corresponding temperatures/fans. `kmod` and `sudo` are needed only if using the optional Acer module preparation command.
- Internet access for the initial Acer ZIP and npm/Electron downloads. Git is needed if cloning the source.

The application itself runs as your desktop user, **without sudo**. Optional Acer preparation can request sudo to reload a kernel module for the current boot; it does not install a persistent boot configuration.

## Install from source

Run these commands from the repository root in a terminal inside your graphical session. No Windows installation or Windows execution is required for this workflow.

### 1. Install Linux tools

```sh
sudo apt update
sudo apt install nodejs npm git unzip msitools cabextract kmod
node --version
npm --version
```

`node --version` must report at least 18. You can update the rest of Ubuntu separately with `sudo apt upgrade`; a full system upgrade is not an application dependency. Reboot if an OS or NVIDIA driver update requires it.

For a minimal desktop missing Electron libraries, install:

```sh
sudo apt install libnss3 libgtk-3-0t64 libasound2t64 libgbm1 \
  libatk-bridge2.0-0t64 libcups2t64 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxrandr2 libxfixes3 xwayland
```

### 2. Download and prepare NitroSense

Clone or download this repository, enter its directory, then run:

```sh
npm run setup
npm start
```

Setup downloads the [official NitroSense 5.2.84 ZIP](https://global-download.acer.com/GDFiles/Application/Nitro%20Sense/Nitro%20Sense_Acer_5.2.84_W11x64_A.zip?acerid=639270422763622831&Step1=&Step2=&Step3=NITRO%20ANV15-52&OS=ALL&LC=pt&BC=ACER&SC=PA_3) (approximately 947 MiB) from Acer's download server. The source is the [Acer ANV15-52 support page](https://www.acer.com/br-pt/support/product-support/ANV15-52/downloads).

The command verifies the ZIP's pinned SHA-256, extracts only the MSI and main AppX, imports the required resources into `vendor/nitrosense-5.2.84-official`, verifies the import, and installs Electron 26.6.10 into `.tools/electron-runtime`. It does not execute Windows installers. Allow roughly 3 GiB of free space for the download, extraction, and runtime. Run setup as your normal desktop user.

The download is cached under `.state/downloads/`. Re-running setup verifies an existing completed import and installs the runtime. Partial imports are preserved for diagnosis and refused; use the troubleshooting guide before retrying. A changed upstream ZIP fails verification instead of silently accepting different code.

If you already downloaded the official ZIP, use:

```sh
npm run setup -- --zip '/absolute/path/to/NitroSense_Acer_5.2.84_W11x64_A.zip'
```

For manual extraction/import:

```sh
unzip '/absolute/path/to/NitroSense_Acer_5.2.84_W11x64_A.zip' -d .state/installer
npm run prepare:vendor -- .state/installer/NitroSense_Acer_5.2.84_W11x64 vendor/nitrosense-5.2.84-official
npm run setup:electron
npm run check
```

The 5.2.84 source patches and resource import are checked against the official package. The hardware observations above came from the earlier 5.1.392 build; graphical and hardware acceptance testing on 5.2.84 is still required.

## Run with real data

First confirm the NVIDIA driver is healthy:

```sh
nvidia-smi
```

Then launch:

```sh
npm start
```

If Acer fan/temperature interfaces need preparation for this boot, use:

```sh
npm run start:acer
```

This checks the existing Acer interfaces first and may temporarily reload `acer_wmi` with `predator_v4=1` when required. Module reloads initialize firmware interfaces; see [manual testing](docs/manual-testing.md) before using this option. Neither launch command enables fan/profile/lighting control.

Wait 30–60 seconds and open Monitoring in the original interface. To finish, press **Ctrl+C in the launching terminal**. The original window's X can hide the application while leaving it running. A termination code of 130 after Ctrl+C is expected.

Each launch saves private diagnostics under `.state/linux-readonly-<timestamp>/`. To assess the latest session:

```sh
npm run verify:readings
```

This checks CPU/RAM backend evidence and simulator state; it does not certify every visible field. Follow the [manual test checklist](docs/manual-testing.md) to compare the screen with your real hardware.

## Known limitations and security

The compatibility runtime currently retains Acer's experimental settings, including `--no-sandbox`, `--ignore-certificate-errors`, and permissive application integration. **Normal Electron sandbox and certificate protections are not in place.** Electron 26 is an old compatibility dependency. Security hardening and a supported-runtime migration are release blockers, not completed work.

Some original UI controls remain visible even though the Linux backend does not implement their operations. Do not interpret their appearance as hardware support. Unsupported capabilities and missing sensors should remain unavailable.

Raw application logs can contain tokens, cookies, machine identifiers, and personal paths. Keep `.state/`, `analysis/`, and `vendor/` private; share only reviewed, redacted diagnostics. See [troubleshooting](docs/troubleshooting.md).

## Repository layout

```text
lib/             Linux telemetry, services, protocols, archive/import utilities
runtime/         Electron bootstrap and in-memory compatibility patches
scripts/         Linux launch, preparation, diagnostics and developer tools
scripts/windows/ Historical Windows inspection/extraction tools; optional research only
tests/           Automated tests using synthetic fixtures where appropriate
docs/            Status, roadmap, manual testing and development notes
```

`vendor/`, `.tools/`, `.state/`, and `analysis/` are generated/local-only and excluded from Git. Historical development notes are preserved locally under `.state/local-history/`, outside the public source tree.

## Development

```sh
npm test
```

The source-only test suite runs without Acer files or an Electron installation. Tests that inspect original Acer code or captured reference data are skipped when those private inputs are absent. Automated tests do not open the UI or perform the optional real module reload.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [development notes](docs/development.md), and the [script guide](scripts/README.md).

## Licensing and Acer assets

**No project license has been selected yet; no `LICENSE` file is provided.** The intention is an open-source release, but licensing is still pending. Public source availability does not itself supply an open-source license.

Acer NitroSense and its bundled resources remain separate proprietary material. Setup obtains the official ZIP directly from Acer on the user’s machine. **We do not provide any Acer ZIP, MSI, AppX, ASAR, extracted application resources, or other Acer binaries.** The project is not affiliated with or endorsed by Acer.
