# Releasing the OneUptime Android agent

This is the release runbook for maintainers and AI agents. It covers the
Android device agent (`agents/AndroidAgent`): what each release does by
itself, the one-time setup only a maintainer can do, and how customers get
the APK onto their devices. Follow the repository's
[AGENTS.md](../../AGENTS.md) as well.

The agent has no release of its own. Every OneUptime release builds it with
the release's version, signs it and attaches it to the GitHub release, from
[.github/workflows/release.yml](../../.github/workflows/release.yml). Nobody
builds or uploads anything by hand once the one-time setup below is done.

**Until a maintainer has done the one-time setup, releases go out without the
APK**: the `android-agent-build` job fails with "The
ANDROID_AGENT_KEYSTORE_BASE64 secret is not set", and the release is published
without it, as it is when a mobile app build fails.

## Release sequence

1. A push to `release` starts release.yml. Its `android-agent-build` job runs
   `./gradlew assembleRelease -PagentVersion=<version>` in
   `agents/AndroidAgent`: the release build, shrunk with R8, unsigned. Its
   version code is worked out from the version (major × 10,000,000 + minor ×
   10,000 + patch), so every release's is higher than the one before, which
   device managers require of an update.
2. The same job decodes the keystore from `ANDROID_AGENT_KEYSTORE_BASE64` and
   runs [scripts/sign-release.sh](scripts/sign-release.sh), which aligns the
   APK, signs it with apksigner (v1, v2 and v3 schemes) and fails unless all
   three verify. It keeps `oneuptime-android-agent.apk` and
   `oneuptime-android-agent.apk.sha256` as the `release-android-agent`
   artifact, and deletes the keystore.
3. Once the e2e jobs pass, `finalize-github-release` attaches both files to
   the draft and publishes the release. A release cannot take a file once it
   is published, so a failed `android-agent-build` means that release has no
   APK; the next release carries one.

Why apksigner and not Gradle's `signingConfig`: with a minSdk of 24 the
Android Gradle plugin leaves the v1 (JAR) signature out even when asked for
it, and Esper refuses an APK without one.

## Accounts, keys and secrets

Do not make a new key for a routine release. Every installed agent trusts the
key it was installed with: an APK signed with another key is refused as an
update, and devices would have to uninstall the agent first, losing its
settings.

| Item | Value |
| --- | --- |
| Package name (application ID) | `com.oneuptime.androidagent`. It can never change |
| Release asset | `oneuptime-android-agent.apk`, and `oneuptime-android-agent.apk.sha256` |
| Signing key | RSA 4096, alias `oneuptime-android-agent`, valid 30 years. Not created yet: see the one-time setup |
| Signing certificate SHA-256 | Record it here once the key exists |
| Secrets (repository) | `ANDROID_AGENT_KEYSTORE_BASE64`, `ANDROID_AGENT_KEYSTORE_PASSWORD`, `ANDROID_AGENT_KEY_ALIAS`, `ANDROID_AGENT_KEY_PASSWORD` |

Do not print the keystore or its passwords, put them in files in the
repository, or paste them into a conversation with an agent.

## One-time setup (a maintainer)

### 1. Create the signing key

On a machine you trust, with a JDK:

```bash
keytool -genkeypair \
  -keystore oneuptime-android-agent.jks \
  -alias oneuptime-android-agent \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=OneUptime Android Agent, O=HackerBay, Inc."
```

keytool asks for the keystore password and the key password. Keep the
keystore and both passwords in the organization's password manager, with a
second copy offline: losing them means no installed agent can be updated.

### 2. Add the secrets

```bash
base64 -w0 oneuptime-android-agent.jks | gh secret set ANDROID_AGENT_KEYSTORE_BASE64 --repo OneUptime/oneuptime
gh secret set ANDROID_AGENT_KEYSTORE_PASSWORD --repo OneUptime/oneuptime
gh secret set ANDROID_AGENT_KEY_ALIAS --repo OneUptime/oneuptime --body oneuptime-android-agent
gh secret set ANDROID_AGENT_KEY_PASSWORD --repo OneUptime/oneuptime
```

`gh secret set` without `--body` asks for the value, so the passwords are
never on a command line. On macOS, `base64 -i oneuptime-android-agent.jks`.

### 3. Record the certificate

```bash
keytool -list -v -keystore oneuptime-android-agent.jks -alias oneuptime-android-agent | grep SHA256
```

Write the SHA-256 in the table above, in a pull request of its own. People
check a download against it (below), and Esper and other device managers show
it.

### 4. Check the first release that has the APK

After the next release, download its APK and check its signature:

```bash
apksigner verify --verbose --print-certs --min-sdk-version 23 oneuptime-android-agent.apk
sha256sum -c oneuptime-android-agent.apk.sha256
```

`--min-sdk-version 23` makes apksigner check the v1 signature too. All of v1,
v2 and v3 must say `true`, and the certificate's SHA-256 must be the one
recorded above. Install it on a test device or an emulator and open it once
(the [README](README.md#testing-on-a-device) says how to watch it report).

## Distributing it

Customers install the APK from the GitHub release through their device
manager. The [Android Agent docs](../../packages/App/FeatureSet/Docs/Content/en/telemetry/android-agent.md)
are what they follow; what matters for a release:

- **Esper.** Upload the APK to the App Library, add it to the blueprint with
  its managed configuration, and turn on Launch on Start (Multi-App mode) or
  open it once on each device: Android keeps a newly installed app from
  starting at boot until it has been opened once. Each new version is
  uploaded and set in the blueprint the same way. READ_LOGS is granted with
  Esper's Secure Remote ADB.
- **Intune, Workspace ONE, SOTI and other EMMs.** As a line-of-business or
  internal Android app, from the same APK, with the managed configuration
  the console reads from the APK's `app_restrictions.xml`.
- **Managed Google Play.** Not set up yet. It needs the agent published from
  OneUptime's Play Console developer account (the one that publishes the
  On-Call app): an app with the package name above, an Android App Bundle
  (`./gradlew bundleRelease`) signed with an upload key and Play App Signing,
  the permission declarations Play asks for (`QUERY_ALL_PACKAGES` for device
  inventory, the `specialUse` foreground service), the data safety form, and
  either a public listing or private targeting of each customer's
  organization ID. A device manager then installs and updates it like any
  managed Google Play app. Until then, customers use the APK. It is a
  maintainer's decision, tracked as a follow-up issue.

Google's developer verification for apps installed outside Google Play rolls
out from 2026. If it comes to cover the devices customers manage, register the
package name and the certificate above with the Android Developer Console
from the same account.

## Troubleshooting

| Symptom | Next action |
| --- | --- |
| `android-agent-build` fails at "Sign" saying the secret is not set | Do the one-time setup. The release went out without the APK |
| It fails at "Sign" with a keytool or apksigner error | A secret is wrong: the keystore is not the base64 of the `.jks`, or a password or the alias does not match. Set the secret again |
| It fails at "Build" | Read the Gradle output; the same build runs in "Android Agent Test" on every pull request that changes the agent, so main is usually green |
| A device manager says the APK has no v1 signature | It was not signed by `sign-release.sh`. Check the release asset with `apksigner verify --min-sdk-version 23` |
| A device refuses the update ("signatures do not match") | The APK was signed with another key. Never replace the key; if it was lost, devices must uninstall the agent and install it again |
