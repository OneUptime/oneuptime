# Releasing the OneUptime Android agent

This is the release runbook for maintainers and AI agents. It covers the
Android device agent (`agents/AndroidAgent`): what each release does by
itself, the one-time setup only a maintainer can do, and how customers get
the agent onto their devices. Follow the repository's
[AGENTS.md](../../AGENTS.md) as well.

The agent has no release of its own. Every OneUptime release builds it with
the release's version and ships it two ways, from
[.github/workflows/release.yml](../../.github/workflows/release.yml):

- **The APK on the GitHub release**, `oneuptime-android-agent.apk`, which
  customers upload to their device manager.
- **Google Play**, where managed Google Play lets any Android Enterprise
  device manager install the agent and keep it updated by itself.

Nobody builds or uploads anything by hand once the one-time setup below is
done.

**Until a maintainer has done the one-time setup, releases go out without
either**: the `android-agent-build` job fails with "The
ANDROID_AGENT_KEYSTORE_BASE64 secret is not set", and the release is published
without the APK, as it is when a mobile app build fails; and the
`publish-android-agent-to-google-play` job is skipped, with a notice naming
the secrets that are not set.

## Release sequence

1. A push to `release` starts release.yml. Its `android-agent-build` job runs
   `./gradlew assembleRelease -PagentVersion=<version>` in
   `agents/AndroidAgent`: the release build, shrunk with R8, unsigned. Its
   version code is worked out from the version (major × 10,000,000 + minor ×
   10,000 + patch), so every release's is higher than the one before, which
   device managers and Google Play require of an update.
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
4. Once the release is published, `publish-android-agent-to-google-play`
   checks its five secrets ([below](#6-add-the-secrets)), and stops there,
   with a notice, while any is not set. Otherwise it runs `./gradlew
   bundleRelease -PagentVersion=<version>`, signs the bundle with the upload
   key ([scripts/sign-bundle.sh](scripts/sign-bundle.sh), which signs with
   jarsigner and fails unless every entry verifies), keeps it as the
   `android-agent-google-play-bundle` artifact for 30 days, and has
   [Gradle Play Publisher](https://github.com/Triple-T/gradle-play-publisher)
   upload it, with the store listing and release notes in
   [app/src/main/play](app/src/main/play). The release lands on Google Play
   as a **draft on the internal testing track**: no device gets it until a
   maintainer rolls it out ([Track and rollout](#3-track-and-rollout)). A
   re-run skips a version Play already has.

Why apksigner and not Gradle's `signingConfig`: with a minSdk of 24 the
Android Gradle plugin leaves the v1 (JAR) signature out even when asked for
it, and Esper refuses an APK without one. The bundle is unsigned in Gradle
too, and signed by its own script, so the upload key never signs the APK and
no build needs a key.

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
| Secrets for the APK (repository) | `ANDROID_AGENT_KEYSTORE_BASE64`, `ANDROID_AGENT_KEYSTORE_PASSWORD`, `ANDROID_AGENT_KEY_ALIAS`, `ANDROID_AGENT_KEY_PASSWORD` |
| Google Play developer account | HackerBay Inc, developer ID `5923739376714705080`: the one that publishes the On-Call app. [packages/MobileApp/RELEASING.md](../../packages/MobileApp/RELEASING.md) says how to reach it |
| Google Play app | Not created yet: see [Google Play](#google-play). Record its console app ID here |
| Public or private on Google Play | Not decided yet: [decision 1](#1-a-public-listing-or-a-private-app) |
| App signing key on Google Play | Not decided yet: [decision 2](#2-the-app-signing-key). Record its certificate's SHA-256 here |
| Upload key | RSA 4096, alias `oneuptime-android-agent-upload`, valid 30 years. Not created yet. Record its certificate's SHA-256 here |
| Secrets for Google Play (repository) | `ANDROID_AGENT_UPLOAD_KEYSTORE_BASE64`, `ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_AGENT_UPLOAD_KEY_ALIAS`, `ANDROID_AGENT_UPLOAD_KEY_PASSWORD`, `ANDROID_AGENT_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` |

Do not print the keystores, their passwords or the service account's key,
put them in files in the repository, or paste them into a conversation with
an agent.

## One-time setup of the APK (a maintainer)

### 1. Create the signing key

On a machine you trust, with a JDK:

```bash
keytool -genkeypair \
  -keystore oneuptime-android-agent.jks \
  -alias oneuptime-android-agent \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=OneUptime Android Agent, O=HackerBay, Inc."
```

keytool asks for one password: the keystore it makes (PKCS12) gives the key
the keystore's password, so `ANDROID_AGENT_KEY_PASSWORD` is the same password
as `ANDROID_AGENT_KEYSTORE_PASSWORD`. Keep the keystore and its password in
the organization's password manager, with a second copy offline: losing them
means no installed agent can be updated.

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

## Google Play

With the agent on Google Play, a device manager adds it from managed Google
Play like any other app: it installs it on the devices it is given to,
updates it by itself after every release with no APK to upload, and shows
its managed configuration in its console straight from Play: the settings in
[app_restrictions.xml](app/src/main/res/xml/app_restrictions.xml), which the
manifest's `android.content.APP_RESTRICTIONS` names.

What the repository holds:

| What | Where |
| --- | --- |
| The publishing | `publish-android-agent-to-google-play` in release.yml, and the `play { }` block of [app/build.gradle.kts](app/build.gradle.kts): Gradle Play Publisher 4.1.2, the line for the Android Gradle plugin 9 (`gradle/libs.versions.toml`) |
| The signing with the upload key | [scripts/sign-bundle.sh](scripts/sign-bundle.sh) |
| The store listing | [app/src/main/play](app/src/main/play): the title, the short and full descriptions, the contact email and website, the default language (en-US), the release notes, the icon and the feature graphic. Every release uploads it, so change it here, never in the Play Console: the next release would put it back |
| The graphics | Drawn from the launcher icon by [scripts/PlayGraphics.java](scripts/PlayGraphics.java): `java scripts/PlayGraphics.java` from this directory writes both again |
| Their tests | `PlayListingTest` (each file within Play's limits), `ManagedConfigurationSchemaTest` (the manifest names the schema, and Android reads every key from it), [Tests/Ops/AndroidAgentRelease.test.js](../../Tests/Ops/AndroidAgentRelease.test.js) (the job, and `sign-bundle.sh`) |

Gradle Play Publisher reads the service account's key from the
`ANDROID_PUBLISHER_CREDENTIALS` environment variable, and only when a task
that talks to Play runs: every other task, `./gradlew test lint assembleDebug
bundleRelease` included, works without it.

### Decisions to make first

#### 1. A public listing or a private app

- **Public.** Listed on Google Play: every organization's device manager
  finds the agent in managed Google Play, with nothing for OneUptime to do
  per customer. Google Play publishes it only with a complete store listing
  (the repository's, and the screenshots [still to add](#graphics-still-to-add))
  and the declarations in [step 7](#7-fill-in-app-content).
- **Private.** Only the organizations whose IDs are added in the Play
  Console see it: Setup > Advanced settings, the Managed Google Play tab, Add
  organization, up to 1,000 per app. Each customer copies their
  organization ID from managed Google Play's Admin Settings and sends it to
  OneUptime, and a maintainer adds it before they can install the agent.
  Google needs only the bundle and a title for a private app.
- **It cannot be undone.** Google's help says an app restricted to
  organizations stays private, and that making it public takes a new app
  with a different package name. The agent's package name can never change,
  so a private agent is private for good.

#### 2. The app signing key

With Play App Signing, a release is uploaded signed with the **upload key**,
and Google Play signs the APKs it delivers to devices with the **app signing
key**. The app signing key can be chosen only until the app's first release
reaches open testing or production (Protected with Play > Play Store
protection > Manage Play app signing > Change key):

- **The GitHub APK's key** (`oneuptime-android-agent`, from the APK's
  one-time setup), given to Google as a copy, encrypted with the PEPK tool the
  same page offers. The APKs from Google Play and from GitHub then carry the
  same certificate, so a device can move from one to the other as an update,
  keeping its settings and its identity. Google holds a copy of that key.
- **A key Google makes**, Play's default. The Play build's certificate is
  Google's, so a device that installed the GitHub APK cannot update to the
  Play build: Android refuses an update signed with another key, and the
  agent must be uninstalled first, losing what was set on its screen and
  whatever it had not sent yet. And from Android 8 the Android ID an app
  sees depends on its signing key, so a device named by default (its model
  and the start of its Android ID) comes back as a new host: give such
  devices a `device_name` in their managed configuration before they move.
  Decide which of the two distributions is the one customers use, and say so
  in the docs (telemetry/android-agent).

In both cases the upload key is a key of its own, as Google recommends: if
it is lost or leaks, Google resets it (Manage Play app signing > Request
upload key reset); a lost app signing key cannot be.

#### 3. Track and rollout

Every release goes up as a draft on the internal testing track (the
`play { }` block of app/build.gradle.kts). No device gets a draft: a
maintainer checks it, then rolls it out, or promotes it to production, which
is what device managers install, from Test and release > Testing > Internal
testing in the Play Console. A draft is also the only kind of release Google
Play's API takes for an app that has never been published.

Once the app is published, releases can go to production by themselves, with
this in the `play { }` block, in a pull request:

```kotlin
track.set("production")
releaseStatus.set(ReleaseStatus.COMPLETED)
```

That needs the service account's production permission
([step 5](#5-create-the-service-account)).

### One-time setup (a maintainer)

#### 1. Create the app

In the Play Console of the developer account above, Create app: the name
"OneUptime Android Agent" (managed Google Play shows it as it is), the
default language English (United States) – en-US, an app, free. For a
private app, add the organizations now (decision 1). Record the console app
ID in the table above.

#### 2. Set the app signing key

Decision 2. For the GitHub APK's key: Protected with Play > Play Store
protection > Manage Play app signing > Change key, then follow the steps to
export and upload a key from a Java keystore, with PEPK, from
`oneuptime-android-agent.jks`. For a key Google makes there is nothing to
do: the first upload enrolls the app.

#### 3. Create the upload key

On a machine you trust, with a JDK:

```bash
keytool -genkeypair \
  -keystore oneuptime-android-agent-upload.jks \
  -alias oneuptime-android-agent-upload \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=OneUptime Android Agent upload key, O=HackerBay, Inc."
```

One password, as for the APK's key. Keep the keystore and its password in
the organization's password manager. Never upload with the app signing key.

#### 4. Upload the first bundle by hand

Google Play's API cannot make an app's first release, so the first bundle
is uploaded in the Play Console. Build it from a checkout of the latest
release's tag, in this directory, with that release's version: the bundle
is then what that version is, and the next release's version code is
higher.

```bash
./gradlew bundleRelease -PagentVersion=<the latest release, such as 17.0.12>
read -rsp "Upload keystore password: " ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD; echo
export ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD
export ANDROID_AGENT_UPLOAD_KEY_PASSWORD="$ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD"
export ANDROID_AGENT_UPLOAD_KEYSTORE_FILE=oneuptime-android-agent-upload.jks
export ANDROID_AGENT_UPLOAD_KEY_ALIAS=oneuptime-android-agent-upload
scripts/sign-bundle.sh app/build/outputs/bundle/release/app-release.aab oneuptime-android-agent.aab
```

Then, in Test and release > Testing > Internal testing, create a release,
upload `oneuptime-android-agent.aab`, and save it. Check, in Manage Play app
signing, that the upload key certificate's SHA-256 is the one
`sign-bundle.sh` printed, and record it in the table above.

Or, once the secrets are set (step 6), let the next release make the bundle:
its `publish-android-agent-to-google-play` job keeps it as the
`android-agent-google-play-bundle` artifact, then fails with "No application
found for the package name". Download the artifact from that run, upload it
by hand as above, and re-run the job, which then publishes the listing.

#### 5. Create the service account

As [Gradle Play Publisher's guide](https://github.com/Triple-T/gradle-play-publisher#service-account)
says: a Google Cloud project with the Google Play Android Developer API turned
on (the On-Call app's project, `oneuptime-on-call`, has it), a service
account in it, and a JSON key for that account. Then, in the Play Console's
Users and permissions, invite the service account's email with permissions
for the OneUptime Android Agent app only, none account-wide:

- View app information and download bulk reports (read-only)
- Release apps to testing tracks
- Manage store presence, for the listing
- Release to production, exclude devices, and use Play App Signing: only once
  releases go to production by themselves (decision 3)

The On-Call app's service account can be given these permissions on this app
instead of making another; its JSON key then goes in this app's secret too.

#### 6. Add the secrets

```bash
base64 -w0 oneuptime-android-agent-upload.jks | gh secret set ANDROID_AGENT_UPLOAD_KEYSTORE_BASE64 --repo OneUptime/oneuptime
gh secret set ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD --repo OneUptime/oneuptime
gh secret set ANDROID_AGENT_UPLOAD_KEY_ALIAS --repo OneUptime/oneuptime --body oneuptime-android-agent-upload
gh secret set ANDROID_AGENT_UPLOAD_KEY_PASSWORD --repo OneUptime/oneuptime
gh secret set ANDROID_AGENT_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON --repo OneUptime/oneuptime < service-account-key.json
```

| Secret | What it holds |
| --- | --- |
| `ANDROID_AGENT_UPLOAD_KEYSTORE_BASE64` | The upload keystore, `oneuptime-android-agent-upload.jks`, in base64 |
| `ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD` | Its password |
| `ANDROID_AGENT_UPLOAD_KEY_ALIAS` | `oneuptime-android-agent-upload` |
| `ANDROID_AGENT_UPLOAD_KEY_PASSWORD` | The key's password, which is the keystore's |
| `ANDROID_AGENT_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | The service account's JSON key |

Delete the JSON key's file once the secret is set. The job publishes only
when all five are set, and says which are not otherwise.

#### 7. Fill in App content

Google Play asks for these in Monitor and improve > App content before it
publishes the app, and asks for a permission's declaration once a bundle
uses it:

- **Privacy policy**: `https://oneuptime.com/legal/privacy`.
- **App access**: the agent reports only with a OneUptime URL and a
  **Server** ingestion key, entered on its screen. Give reviewers a key of a
  OneUptime project kept for review, as the On-Call app gives them an
  account.
- **Ads** (none), **content rating**, **target audience** (adults; it is a
  tool for organizations' devices), and the news, government, financial and
  health questions (none apply).
- **QUERY_ALL_PACKAGES** (the permissions declaration). Google Play allows it
  only for an app whose core purpose needs every installed app, documented
  prominently in its description. The agent's: the inventory of every app
  installed on an organization's managed device, sent once a day and at each
  install, update and removal (`android.package.inventory`). The full
  description says so, and `PlayListingTest` keeps it saying so.
- **The foreground service** (`specialUse`, declared for each foreground
  service type of an app that targets Android 14 or later): its description
  (the manifest's `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` text), what happens if
  Android defers or stops it (readings, restarts and crashes are reported
  late, from what it kept on the device), and a link to a video of it: the
  agent's notification, and its screen saying it reports.
- **READ_LOGS, READ_DROPBOX_DATA and PACKAGE_USAGE_STATS.** The manifest
  declares them, for other apps' crashes, ANRs, Logcat lines and the reasons
  a device restarted. Android never grants the first two to an app installed
  from Google Play: an administrator grants them with adb (`pm grant`), and
  usage access with adb (`appops`) or in the device's Settings. Google's help
  names no declaration for them at the time of writing; if review asks, that
  is the answer, with the docs' "Read other apps' logs".
- **Data safety.** Answer with
  [Google's definitions](https://support.google.com/googleplay/android-developer/answer/10787469),
  from what the agent sends ([README](README.md#what-it-sends)) to the
  OneUptime it is set up with, over HTTPS only:

  | What the agent sends | Data safety type |
  | --- | --- |
  | The device's Android ID (`host.id`), its serial number and name when set, its IP addresses | Device or other IDs |
  | Every app installed, with its version and install times | App activity: installed apps |
  | Other apps' crashes and ANRs with their stack traces, the reasons the device restarted | App info and performance: crash logs |
  | Memory, storage, network, battery, temperature, thermal state, CPU, uptime; Logcat lines | App info and performance: diagnostics, other performance data |

  Logcat lines and crash messages are other apps' text: the agent reads them
  only with READ_LOGS granted, and takes card numbers, email addresses,
  credentials and tokens out of them before sending them
  ([Redactor.kt](app/src/main/java/com/oneuptime/androidagent/logs/Redactor.kt)).

#### 8. Check the first release that goes through the API

After the next release, the job's log shows the bundle and the listing
uploaded, and the Play Console a draft on Internal testing named after the
version. Roll it out or promote it (decision 3), then in a device manager's
managed Google Play (for a private app, one of the organizations added):
find OneUptime Android Agent, approve it, check that its managed
configuration lists every setting in app_restrictions.xml, and install it on
a test device.

### Graphics still to add

The repository has the two graphics every listing needs: the icon, 512 × 512,
and the feature graphic, 1024 × 500. **To do, for a public listing only**: a
maintainer adds the screenshots Google Play asks for before it publishes one,
taken on a device or an emulator running the agent:

- `app/src/main/play/listings/en-US/graphics/phone-screenshots/1.png` and
  `2.png`, at least two and up to eight: the agent's screen reporting, and a
  log session request.
- `app/src/main/play/listings/en-US/graphics/tablet-screenshots/` (7-inch)
  and `large-tablet-screenshots/` (10-inch), recommended since kiosks and POS
  terminals are tablets: Google asks for at least four for tablets.

Each is a JPEG or a PNG without an alpha channel, 320 to 3840 pixels a side
(Google takes up to 7680 for tablets), the longer side at most 2.3 times the
shorter. `adb exec-out screencap -p` writes a PNG with an alpha channel,
which Google Play refuses: save it as a JPEG, or as a PNG without alpha.
`PlayListingTest` checks every screenshot added. A private app needs none of
them.

## Distributing it

Customers install the agent through their device manager. The
[Android Agent docs](../../packages/App/FeatureSet/Docs/Content/en/telemetry/android-agent.md)
are what they follow; what matters for a release:

- **Esper.** Upload the APK to the App Library, add it to the blueprint with
  its managed configuration, and turn on Launch on Start (Multi-App mode) or
  open it once on each device: Android keeps a newly installed app from
  starting at boot until it has been opened once. Each new version is
  uploaded and set in the blueprint the same way. READ_LOGS is granted with
  Esper's Secure Remote ADB, or with adb when the devices are staged: no
  Esper command or blueprint grants it (the docs' "Grant them across a
  fleet" says why), and Inventory's Agent Permissions filter lists the
  devices that still need it.
- **Intune, Workspace ONE, SOTI and other EMMs.** As a line-of-business or
  internal Android app, from the same APK, with the managed configuration
  the console reads from the APK's `app_restrictions.xml`.
- **Managed Google Play.** Once the agent is on Google Play (above), any
  Android Enterprise device manager, Esper's included, adds it from managed
  Google Play, sets its managed configuration in its console, and updates it
  after every release rolled out on Play. It still has to be opened once on
  each device, and READ_LOGS is still granted with adb. Until it is there,
  customers use the APK.

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
| `publish-android-agent-to-google-play` says "Google Play skipped" | The secrets it names are not set: [Google Play](#google-play). The release itself went out |
| It fails at "Sign the bundle with the upload key" | jarsigner says why: the keystore is not the base64 of the `.jks`, or the password or the alias does not match. Set the secret again |
| It fails with "No application found for the package name" | The app is not on Google Play yet, or its first bundle was not uploaded by hand: [step 4](#4-upload-the-first-bundle-by-hand) |
| It fails with "Only releases with status draft may be created on draft app" | The app has never been published, and the `play { }` block asks for more than a draft. Keep `ReleaseStatus.DRAFT` until it is |
| Google Play says the bundle is signed with the wrong key | It was not signed with Play's upload key: compare the SHA-256 `sign-bundle.sh` printed with the upload key certificate in Manage Play app signing. A lost upload key is reset there |
| It fails with 401, 403 or "The caller does not have permission" | The service account's key was revoked, or it lacks the app's permissions: [step 5](#5-create-the-service-account) |
| It warns "Ignoring artifact" and publishes no release | Google Play already has that version code, as on a re-run of a published release. Nothing to do |
| A device refuses the Play build ("signatures do not match", "App not installed") | It has the GitHub APK, and Google Play signs with another key: [decision 2](#2-the-app-signing-key) |
| The listing upload fails | Read Google Play's message; `PlayListingTest` holds the limits it knows, so add the one it missed |
