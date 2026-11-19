# OneUptime Android Agent

The OneUptime Android agent reports an Android device your organisation owns
(a kiosk, a POS terminal, a handheld, a signage player) to OneUptime: its
health, its restarts, what is installed on it, and its system logs. Your
device manager (Esper, Intune, Workspace ONE, SOTI, any Android Enterprise
EMM) installs it and configures it, so nothing is set up by hand on each
device.

In OneUptime each device is a **host**, beside your servers and your Windows
machines: listed in **Hosts** with its CPU, memory and disk, alertable with the
host alert templates (stopped reporting, high memory, low storage, restarted),
and one item in **Inventory** with its make, model, serial number, OS and
firmware. An app instrumented with OpenTelemetry Android that names the device
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
| CPU | `system.cpu.utilization`, `system.cpu.load_average.*` | Only where Android lets an app read `/proc/stat`: Android 7, and builds that allow it. Android 8 and later keep it from apps |
| Battery and temperature | `hw.battery.charge`, `hw.temperature`, `android.battery.plugged` | When the device has a battery |
| Thermal state | `android.thermal.status`, `android.thermal.headroom` | Android 10 and 11 and later |
| Restarts | `device.boot` and `device.shutdown` log events | How long the device was up, how it went down (cleanly or not), how long it was off, and restart loops |
| Installed apps | `android.package.inventory`, `.installed`, `.updated`, `.removed` log events | Every app installed on the device and every updated system app, once a day and on each change |
| Crashes and ANRs of every app | `app.crash` and `device.anr` log events, with `exception.*` | Unhandled exceptions in OneUptime. Needs READ_LOGS |
| Logcat | Log records with `android.log.tag`, `android.package.name` | Android 12 and earlier, at Warning and above by default. Needs READ_LOGS |

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

## Layout

```
app/src/main/java/com/oneuptime/androidagent/
  agent/      the foreground service, the boot receiver, the watchdog, the cycle (AgentCore)
  apps/       installed apps and their changes
  boot/       restarts: boot id, previous uptime, clean or not, restart loops
  collect/    /proc parsers, the snapshot, and its hostmetrics mapping
  config/     managed configuration, the setup screen's settings, the Keystore vault
  device/     what the device says about itself
  logs/       Logcat: the line parser, the crash and ANR decoder, the sessions
  otlp/       OTLP/JSON: attributes, the resource, metrics and logs
  transport/  the disk outbox, backoff, the HTTP client, the uploader
  ui/         the setup screen
app/src/main/res/xml/app_restrictions.xml   the managed configuration schema
app/src/test/                               JVM and Robolectric tests
app/src/test/resources/otlp/                the golden OTLP requests OneUptime's ingest tests read too
app/src/androidTest/                        tests that run on a device or an emulator
scripts/sign-release.sh                     signs a release APK (v1, v2 and v3)
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
and attaches `oneuptime-android-agent.apk` to the GitHub release. See
[RELEASING.md](RELEASING.md).
