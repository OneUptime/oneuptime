# OneUptime Android Agent

The OneUptime Android agent reports an Android device your organisation owns
(a kiosk, a POS terminal, a handheld, a signage player) to OneUptime: its
health, its restarts, what is installed on it, and its system logs. Your
device manager (Esper, Intune, Workspace ONE, SOTI, any Android Enterprise
EMM) installs it and configures it, so nothing is set up by hand on each
device.

In OneUptime each device is a **host**, beside your servers and your Windows
machines: listed in **Hosts** with its CPU, memory and disk, alertable with the
Android host alert templates (unplugged, low battery, overheating, restart
loop, storage nearly full, stopped reporting, restarted, high memory),
and one item in **Inventory** with its make, model, serial number, OS, security
patch level and firmware. An app instrumented with OpenTelemetry Android that names the device
the same way (`host.name`) reports into the same Inventory item.

The [Android Agent docs](https://oneuptime.com/docs/telemetry/android-agent)
are the guide for people deploying it. This file is for working on it.
[RELEASING.md](RELEASING.md) says how it is released and distributed.

## What it sends

Over OTLP/HTTP (JSON, gzipped) to `https://<your OneUptime>/otlp`, with a
Server ingestion key in `x-oneuptime-token`:

| What | How | Notes |
| --- | --- | --- |
| Uptime, memory, storage, network | `system.uptime`, `system.memory.*`, `system.filesystem.*`, `system.network.*` | The OpenTelemetry hostmetrics receiver's names, so the Hosts product reads them as it reads a server's |
| CPU | `system.cpu.utilization`, `system.cpu.load_average.*` | From `/proc/stat` where Android lets an app read it: Android 7, and builds that allow it. On Android 8 and later, from `HardwarePropertiesManager.getCpuUsages()` when the agent is the device owner and the hardware reports it (`user` is busy, `idle` the rest); otherwise none, and an `oneuptime.agent.cpu` event and the setup screen say why |
| Battery and temperature | `hw.battery.charge`, `hw.temperature`, `android.battery.plugged` | When the device has a battery |
| Thermal state | `android.thermal.status`, `android.thermal.headroom` | Android 10 and 11 and later |
| Restarts | `device.boot` and `device.shutdown` log events | How long the device was up, how it went down (cleanly or not), how long it was off, and restart loops |
| Installed apps | `android.package.inventory`, `.installed`, `.updated`, `.removed` log events | Every app installed on the device and every updated system app, once a day and on each change |
| Crashes and ANRs of every app | `app.crash` and `device.anr` log events, with `exception.*` | Unhandled exceptions in OneUptime. Needs READ_LOGS |
| Crash stacks, native crashes, ANR traces, watchdogs, reboot reasons | The same events from DropBox (`android.dropbox.tag`), with the whole stack; `device.boot` with `android.boot.reason` | Every app's, read from DropBox (`dropbox/`). Needs READ_LOGS (READ_DROPBOX_DATA on Android 15 and later) and usage access. Redacted (`logs/Redactor.kt`) |
| Restart loops | `android.boot.recent_count` | Boots in the last hour, for the Restart Loop template |
| Security patch age | `android.os.security_patch.age` | Days since the patch level's date (`device/SecurityPatchAge.kt`), for the Security Patch Out of Date template: more than 90 is behind |
| Grants still missing | `oneuptime.agent.permissions.missing`, a resource attribute | READ_LOGS, READ_DROPBOX_DATA and GET_USAGE_STATS still to grant, or `none` (`agent/AgentPermissions.kt`): Inventory's Agent Permissions filter |
| Logcat | Log records with `android.log.tag`, `android.package.name` | Android 12 and earlier, at Warning and above by default. Needs READ_LOGS |
| Log sessions | Every app's lines, with `oneuptime.agent.log_session.id` | For the minutes OneUptime asks, once the person at the device allows it (`logsession/`), with the requester's note shown on the request (`logsession/LogSessionNote.kt`) |

The resource (`otlp/DeviceResource.kt`) names the device in `host.name`, sets
`os.type=linux`, and never sets `device.id`, `device.model.identifier` or
`service.name`: those would file the device as a mobile app or as a service
instead of a host.

## Why Logcat is limited on Android 13 and later

READ_LOGS can only be granted with adb (`pm grant`), never by an app or a
device policy. And from Android 13, Android asks the person at the device to
approve each Logcat session, and refuses outright when the app asking is not
on screen. The one exception is a session that reads only the `events`
buffer, which is where ActivityManager writes every app's crash (`am_crash`)
and ANR (`am_anr`). So on Android 13 and later the agent reads crashes and
ANRs, unattended; on Android 12 and earlier it also reads the main, system and
crash buffers. Granting READ_LOGS restarts the agent's process (Android adds
the `log` group to it), and the agent picks it up at once.

Every app's log lines on Android 13 and later come from a log session: asked
for in OneUptime (POST `/telemetry/android-agent/v1/log-sessions`, every
cycle), allowed on the agent's screen, which starts a `logcat` of its own
while it is in front so Android shows its prompt, and reported back as it goes
(`logsession/LogSessionManager.kt`). Lines from other apps arriving are how
the agent knows Android allowed it. Android's permission lasts as long as that
`logcat` process, so a session ends when the agent or the device restarts.

## Layout

```
app/src/main/java/com/oneuptime/androidagent/
  admin/      the device admin receiver that lets the agent be a device owner (CPU use)
  agent/      the foreground service, the boot receiver, the watchdog, the cycle (AgentCore)
  apps/       installed apps and their changes
  boot/       restarts: boot id, previous uptime, clean or not, why, restart loops
  collect/    /proc parsers, CPU from the hardware properties, the snapshot, its hostmetrics mapping
  config/     managed configuration, the setup screen's settings, the Keystore vault
  device/     what the device says about itself
  dropbox/    DropBox: crash stacks, tombstones, ANR traces, reboot reasons
  logs/       Logcat: the line parser, the crash and ANR decoder, the sessions, redaction
  logsession/ log sessions OneUptime asks for, allowed at the device
  otlp/       OTLP/JSON: attributes, the resource, metrics and logs
  transport/  the disk outbox, backoff, the HTTP client, the uploader
  ui/         the setup screen
app/src/main/res/xml/app_restrictions.xml   the managed configuration schema
app/src/test/                               JVM and Robolectric tests
app/src/test/resources/otlp/                the golden OTLP requests OneUptime's ingest tests read too
app/src/androidTest/                        tests that run on a device or an emulator
app/src/main/play/                          the Google Play listing, release notes and graphics
scripts/sign-release.sh                     signs a release APK (v1, v2 and v3)
scripts/sign-bundle.sh                      signs a release bundle with the Google Play upload key
scripts/PlayGraphics.java                   draws the Play icon and feature graphic from the launcher icon
```

## Building and testing

You need JDK 17 or later and the Android SDK with platform 36 and
build-tools 36.0.0. The Gradle wrapper fetches Gradle 9.

```bash
./gradlew test lint assembleDebug
```

`test` runs the JVM and Robolectric tests. Two golden files,
`app/src/test/resources/otlp/android-agent-*.json`, are the exact requests the
agent sends for one kiosk; OneUptime's own tests
(`packages/App/Tests/Telemetry/AndroidDeviceAgentIngest.test.ts`) run them
through its ingest code. After changing what the agent sends on purpose,
write them again and run that test too:

```bash
./gradlew :app:testDebugUnitTest --tests '*GoldenPayloadTest*' -PupdateGoldens=true
```

### Testing on a device

The on-device tests run the parsers under Android's own regular expressions
(ICU refuses some patterns the JVM accepts), the Android Keystore, the real
readings, and another app's crash read from Logcat. READ_LOGS must be granted
before they start, since granting it restarts the process:

```bash
./gradlew installDebug installDebugAndroidTest
adb shell pm grant com.oneuptime.androidagent android.permission.READ_LOGS
adb shell am instrument -w com.oneuptime.androidagent.test/androidx.test.runner.AndroidJUnitRunner
```

To watch the agent work end to end, point it at any OTLP/HTTP receiver. From
the Android emulator, `http://10.0.2.2:<port>` is the host machine, and the
agent allows plain http only to that address and to the device itself.

```bash
adb shell am start -n com.oneuptime.androidagent/.ui.SetupActivity
```

`adb shell svc power reboot` restarts the device the way a person does
(Android announces the shutdown); `adb reboot` restarts it from init, which
the agent reports as a restart without a shutdown.

## Releasing

Every OneUptime release builds the agent with the release's version, signs it
and attaches `oneuptime-android-agent.apk` to the GitHub release. Once its
repository secrets are set, the release also uploads a signed bundle to
Google Play, as a draft on the internal track; until then that job is skipped
with a notice. See [RELEASING.md](RELEASING.md).
