# Original Windows UI references

The 20 PNGs in `screenshots/` were supplied as captures of the original NitroSense
application running on **Windows 11 on the target Acer Nitro ANV15-52**. They are
the visual reference for compatibility work, not a proposed redesign. All 20 were
visually reviewed. `SETTINGS.png` displays **V 5.1.392**; the current Linux import
is **5.2.84**. The version of each other capture is not independently displayed.
The interface is unchanged in the newer version, as confirmed by the user.
Treat this set as the authoritative UI baseline for the current 5.2.84 import
as well. The recorded capture version is provenance, not a reason to relax visual
acceptance or redesign the UI.

`manifest.json` records each source filename, dimensions and SHA-256. Preserve
original images; record Linux comparison captures separately under ignored
`.state/`. Some captures contain device/network identifiers: compare field
structure without copying those identifiers into reports or test fixtures.

## Reviewed inventory and acceptance matrix

Each row is a required comparison for work affecting that page. **Reference
reviewed** does not mean **Linux passed**. Linux comparison against this set is
pending for every row. Links open the original files.

| ID | Reference | Observed original UI / validation target |
| --- | --- | --- |
| HOME-01 | [Home collapsed](<screenshots/HOME - SIDEBAR COLLAPSED.png>) | Top navigation, System Mode, frequency/usage dial on left, central Nitro graphic, GPU/CPU/System temperature gauges on right, recommendation card. Sidebar collapsed. |
| HOME-02 | [Home open](<screenshots/HOME - SIDEBAR OPEN.png>) | Right sidebar overlays part of Home: Scenario Profile dropdown, Mode/Fan summary, Monitoring grid, Live Update and App Shortcut. Preserve the toggle and Details navigation. |
| MODE-AC-B | [Balanced on AC](<screenshots/SCENARIO - BALANCED SELECTED - AC PLUGGED IN.png>) | Daily Use profile selector, overflow menu, Scenario Manager; Mode/Fan Control/Advanced Settings tabs. AC Plugged In; Quiet, Balanced, Performance cards, Balanced highlighted; GPU then CPU gauges. |
| MODE-AC-Q | [Quiet on AC](<screenshots/SCENARIO - QUIET SELECTED - AC PLUGGED IN.png>) | Same three cards; Quiet highlighted. NVIDIA Whisper Mode notice visible. Do not infer Linux Whisper support from this screenshot. |
| MODE-AC-P | [Performance on AC](<screenshots/SCENARIO - PERFORMANCE SELECTED - AC PLUGGED IN.png>) | Same three cards; Performance highlighted and mode description below telemetry. This does not prove Linux overclock support. |
| MODE-DC-B | [Balanced on battery](<screenshots/SCENARIO - BALANCED SELECTED - BATTERY POWER.png>) | On Battery Power; only Eco and Balanced cards, Balanced highlighted; notice about restoring full mode options when AC returns. |
| MODE-DC-E | [Eco on battery](<screenshots/SCENARIO - ECO SELECTED - BATTERY POWER.png>) | Same two cards; Eco highlighted; AC-options and Whisper notices visible; Eco description. |
| FAN-A | [Fan Auto](<screenshots/SCENARIO - FAN CONTROL AUTO.png>) | Auto/Max/Custom cards; Auto highlighted. GPU on left, CPU on right, each with fan graphic and RPM. |
| FAN-M | [Fan Max](<screenshots/SCENARIO - FAN CONTROL MAX.png>) | Max highlighted, same two fan/RPM sections. Captured RPM is an observation, not a target or firmware limit. |
| FAN-C | [Fan Custom](<screenshots/SCENARIO - FAN CONTROL CUSTOM.png>) | Custom highlighted; independent GPU and CPU sliders with minus/plus markers and an Auto button beneath each. Preserve these controls rather than inventing a fan-curve editor. |
| SCENARIO-ADV | [Advanced Settings](<screenshots/SCENARIO - ADVANCED SETTINGS.png>) | Acer TrueHarmony choices: Shooter, RPG, Strategy, Movies, Music, Voice, Automatic, Custom Audio; internal-speaker/3.5 mm note. This capture has no Lighting tab. |
| PERSONAL-01 | [Personal Settings upper](<screenshots/PERSONAL SETTINGS 1.png>) | Left section navigation: Battery & Charge, Screen, Keyboard, System Boot Effect. Battery Charge Mode offers Optimized Battery Charging (80%, recommended) and Full Battery Charging; Full is selected in this capture. Health-information link, Power-off USB Charger and its separate battery-power charge-limit dropdown; Screen and Keyboard below. |
| PERSONAL-02 | [Personal Settings lower](<screenshots/PERSONAL SETTINGS 2.png>) | Scrolled state with System Boot Effect highlighted; Screen settings, Sticky keys, Backlight off after 30 seconds, boot-logo preview and image format/size instructions. The USB dropdown showing 30% is not the laptop's 80% health limit. |
| CHECKUP-01 | [Checkup](<screenshots/CHECKUP.png>) | Checkup All, System Info/Support Service links; battery, per-drive storage and RAM sections. Battery includes charge, temperature, cycles; Optimize Battery includes calibration and Battery Charge Mode navigation. Calibration is distinct from health mode. |
| CHECKUP-INFO | [System Info](<screenshots/CHECKUP - SYSTEM INFO.png>) | Back navigation and labeled model/BIOS/OS/CPU/memory/storage/graphics/audio/network/battery-manufacture fields. Linux must report its actual OS/devices, never copied Windows values. |
| MONITOR-01 | [Monitoring](<screenshots/MONITORING.png>) | GPU and CPU panels on left with temperature/usage histories, extrema, fan RPM and frequency; System temperature, RAM frequency/usage, Ethernet and Wi-Fi rates on right. Compare field identity, units and placement, not frozen sample values. |
| APPS-01 | [App Center](<screenshots/APP CENTER.png>) | Search/refresh, Cannot find app?, category and sorting dropdowns, pin count and app tiles. The Windows application list is not Linux fixture data. |
| EXPERIENCE-01 | [Experience Zone](<screenshots/EXPERIENCE ZONE.png>) | Carousel and position dots; Recommended Apps and Highlight Features sections. Online promotion content can vary; preserve containers/navigation without inventing availability. |
| HELP-01 | [Account & Support](<screenshots/HELP.png>) | Acer membership and sign-up/sign-in controls, device/registration area, Live Update, Find an Answer and country/service-center search. Do not use captured identity or warranty values as defaults. |
| SETTINGS-01 | [Settings](<screenshots/SETTINGS.png>) | About/version/update controls, privacy choice, Celsius/Fahrenheit and homepage live-3D avatar toggle. Version shown is V 5.1.392; compare current app version to actual import. |

## Important distinctions from the review

- Scenario is the original profile/performance/fan/audio page. No charging panel
  belongs there. Its reference header has Mode, Fan Control and Advanced Settings.
- The existing Personal Settings radio choices must connect to firmware health
  mode: Optimized Battery Charging corresponds to 80%; Full Battery Charging to
  100%. Do not add a second set of controls or move them between pages.
- USB charging while the laptop is off/on battery is a separate function. Neither
  the 30% dropdown nor battery calibration is implemented by the health-mode driver.
- Sensor values, RPM, memory consumption and clocks are time-dependent, not
  comparison constants. Compare field identity and real Linux sources.
- `PERSONAL SETTINGS 1.png` and `2.png` visibly contain `MUI_undefined` for
  Bluelight Reduction. Record this as an existing reference anomaly, not a Linux
  regression or a label to deliberately reproduce.
- Profile-manager dialogs, opened mode/fan information dialogs, Optimized selected,
  battery-health details and successful calibration are not shown. Do not infer
  their interaction behavior from these static captures.

## Required validation procedure

1. Select the relevant IDs above before changing an adapter or UI compatibility
   patch. Inspect the linked source captures. Keep Acer's original component,
   template, hierarchy, terminology, icons and navigation.
2. Record Linux revision, imported NitroSense version, kernel/driver, app viewport
   in CSS pixels, display scale, language, active profile, AC/battery state, selected
   mode, scroll position and sidebar state. PNG dimensions are capture dimensions,
   not proof of CSS viewport or desktop scaling. Match framing where practical.
3. Capture the original app running on Linux. Store local evidence under `.state/`;
   identify matching reference IDs. Compare page structure, visible cards, active
   state, labels, units, clipping and navigation. Check that the Home guest does not
   cover another tab. Do not use a replacement panel or simulator as a pass.
4. Separate visual compatibility from behavior: a selected radio/card must reflect
   confirmed backend state. Where hardware writes are implemented and validated,
   exercise the existing control and verify the real result. For charging, read
   back the WMI threshold and restore the starting limit. Do not exercise unverified
   fan/performance/audio/calibration writes just to resemble a screenshot.
5. Compare changing readings with simultaneous Linux sources; never replay the
   Windows samples. Record unavailable readings honestly. Classify platform and dynamic-content differences separately, with evidence.
   Do not excuse layout or control differences merely because the imported app
   has a newer version number: the user confirmed that its interface is the same.
6. Record every relevant row as **pass**, **fail**, **blocked** or **not tested**.
   Include evidence paths and remaining gaps. Unit/source tests complement this
   review; they do not certify screenshot or hardware acceptance.

Suggested result record:

| Reference ID | Linux capture | Visual result | Behavior / backend evidence | Differences / reason |
| --- | --- | --- | --- | --- |
| PERSONAL-01 | `.state/<session>/<capture>.png` | Not tested | Original radio integration pending | Driver verification alone is insufficient |
| MODE-AC-B | `.state/<session>/<capture>.png` | Not tested | Original Scenario compatibility pending | No replacement component permitted |
