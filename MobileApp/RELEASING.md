# Publishing OneUptime mobile apps

This is the release runbook for maintainers and AI agents updating the existing
**OneUptime On-Call** apps on Google Play and the Apple App Store. Follow the
repository's [AGENTS.md](../AGENTS.md) as well. Use Chrome for the store consoles.

The workflow below was used to submit version **1.1.0** on **8 September 2026**.
The user reported it live on 9 September. Recheck the actual store state for every
release; the historical build numbers and links below are context, not instructions
to resubmit that release.

## Release sequence

1. Confirm the source revision, existing store versions, build numbers, and access.
2. Prepare a reviewed mobile-only source snapshot and assign unused versions.
3. Compile, run relevant tests, export both platforms, and build with EAS.
4. Upload the Android AAB to a production draft in Play Console.
5. Upload the iOS build with EAS Submit, then attach it in App Store Connect.
6. Complete metadata/privacy checks and submit each store's review request.
7. Verify review submission and release settings. After approval, verify the new
   version is publicly available.

**A finished EAS build, an uploaded binary, and a saved store draft are separate
milestones. None of them alone means the app is published.**

## Accounts and app identifiers

These identify the existing official apps. Do not create replacement app records,
change package identifiers, or generate fresh signing keys during a routine update.

| Item                                          | Value                                  |
| --------------------------------------------- | -------------------------------------- |
| Expo owner                                    | `oneuptime`                            |
| Expo project slug                             | `oneuptime-on-call`                    |
| Expo project ID                               | `d9f87edc-1c3e-466f-b032-1ced7621aa8a` |
| Android package / iOS bundle identifier       | `com.oneuptime.oncall`                 |
| Apple organization                            | `HackerBay, Inc.`                      |
| Apple team ID                                 | `8TX4M8BXZ4`                           |
| App Store Connect numeric app ID (`ascAppId`) | `6759615391`                           |
| Google Play developer ID                      | `5923739376714705080`                  |
| Google Play console app ID                    | `4975935958575757034`                  |
| Google Play production track ID               | `4697777621038446963`                  |

Useful entry points:

- [Expo project](https://expo.dev/accounts/oneuptime/projects/oneuptime-on-call)
- [Play Console dashboard](https://play.google.com/console/u/4/developers/5923739376714705080/app/4975935958575757034/app-dashboard)
- [Play publishing overview](https://play.google.com/console/u/4/developers/5923739376714705080/app/4975935958575757034/publishing)
- [App Store Connect](https://appstoreconnect.apple.com/apps/6759615391/distribution)
- [Apple Developer account](https://developer.apple.com/account)

Google's `/u/4/` selects a signed-in browser account; that index can change. If a
link opens the wrong account, switch to the account with this developer/app ID.
Find future drafts through the console; the `/releases/3/` path from 1.1.0 must not
be reused for a different release.

## 1. Establish the release state

Read `app.json`, `app.config.js`, `eas.json`, `package.json`, the lockfile, and the
mobile diff since the last published revision. Inspect the working tree before
changing anything. Other tasks may have uncommitted work in the same repository;
preserve it and choose the release revision deliberately. Include any authorized,
uncommitted mobile changes explicitly and record them.

Run EAS commands from **MobileApp**, where its `package.json` and `eas.json` live.
Running them at the repository root can initialize the wrong Expo project. This
matches [Expo's monorepo instructions](https://docs.expo.dev/build-reference/build-with-monorepos/).

```bash
cd MobileApp
eas --version
eas whoami
eas project:info
eas build:list --platform all --limit 10 --non-interactive
```

Use the installed authenticated EAS CLI, or the official `eas-cli` npm package if
it is unavailable. The September release used the existing Expo login and remote
Android/iOS signing credentials. iOS submission also reused an EAS-stored App
Store Connect API key. Confirm access without printing tokens, private keys,
passwords, service-account JSON, or signed log URLs into the task or guide.

In Chrome, inspect:

- Play **Production**, **Latest releases and bundles**, other testing tracks,
  **Publishing overview**, and **App content**. A test upload may already occupy
  a version code even if production is older.
- App Store Connect **Distribution**, **TestFlight**, **App Review**, and any
  account notices. Check uploaded/processing builds as well as the live version.
- Existing drafts and pending submissions. Resume the matching intended release
  instead of creating duplicate submissions or overwriting someone else's draft.

If the user has asked to publish, that authorizes the ordinary build, upload,
metadata, and submission steps. Follow the current tools' confirmation rules for
new legal agreements, credentials, or expanded access. An agreement banner alone
does not establish that every operation is blocked: during 1.1.0 an Apple banner
appeared, but upload and review submission succeeded without the agent accepting
an agreement. If an action really is blocked, record the exact message and ask for
the specific action needed while continuing independent work.

## 2. Select versions and prepare the source

The store version comes from **`expo.version` in `app.json`**. The version in
`MobileApp/package.json` follows the wider repository and is not the store version.

| Field in `app.json`        | Meaning                                              | Value used for 1.1.0 |
| -------------------------- | ---------------------------------------------------- | -------------------- |
| `expo.version`             | Version users see; match the new Apple version draft | `"1.1.0"`            |
| `expo.ios.buildNumber`     | iOS build identifier, a string                       | `"2"`                |
| `expo.android.versionCode` | Android build identifier, an integer                 | `3`                  |

Choose a new user-visible version and unused build identifiers based on the
consoles, including pending uploads. Use increasing counters for both platforms;
do not blindly increment the historical values above. A replacement binary needs
a new build identifier if the earlier one has already been uploaded to that store.

As of this guide, committed `eas.json` has an empty production build profile and
does not explicitly set `cli.appVersionSource` or `autoIncrement`. For the manual
numbering procedure here, merge `"appVersionSource": "local"` into its `cli`
object and keep production auto-increment disabled. If the project has since
moved to remote versioning, inspect/synchronize the EAS counters and use that
established workflow instead. Remote versioning ignores local build counters;
see [Expo version management](https://docs.expo.dev/build-reference/app-versions/).

### Use an isolated snapshot

Run the required root `npm run fix` and review any resulting mobile changes
before freezing the snapshot. Include those fixes in the selected commit or the
explicitly reviewed overrides below. If you edit or fix mobile source after
staging, synchronize only the intended changes, refresh the inventory/hashes, and
rerun affected checks against the snapshot before building.

The successful release uploaded only tracked MobileApp files plus the reviewed
version change. This avoids sending the entire repository, local configuration,
or other agents' work to Expo. One reproducible starting point, run from the
repository root after selecting the desired commit:

```bash
release_repo=$(git rev-parse --show-toplevel)
release_commit=$(git rev-parse HEAD) # Replace HEAD if shipping another revision.
release_stage=$(mktemp -d "${TMPDIR:-/tmp}/oneuptime-mobile-release.XXXXXX")
git archive --format=tar "$release_commit" MobileApp | tar -xf - -C "$release_stage"
cd "$release_stage/MobileApp"
release_app_root=$(pwd -P)
```

These shell variables are reused below. If commands run in separate shell
sessions, restore them from the recorded absolute paths and revision.

`git archive` includes committed files only. Apply the reviewed version/config
edits and any explicitly selected uncommitted changes to this snapshot. Keep the
same release version edits in the source checkout for the normal review/commit
process, so the next agent does not start from stale counters. Do not copy the
whole working directory over the snapshot.

Before building, inspect its inventory and record the source commit, overridden
files, and hashes. Keep `package-lock.json`, `google-services.json`, assets,
`app.config.js`, and `eas.json`; do not include private signing files, local env
files, reports, or generated `ios/` and `android/` trees. `.gitignore` alone is
not a guarantee that every possible secret filename is excluded. Store release
records and artifacts outside the upload directory.

Install the snapshot's locked dependencies with `npm ci`. The prior release used
an ignored symlink to already-installed dependencies after verifying the lockfile;
that is an optimization, not a substitute for matching dependencies.

**Common types:** `tsconfig.json` resolves `Common/*` from
`../Common/build/dist/*`. Current mobile references are type-only and disappear
from the bundled app, but local compilation still needs matching Common outputs.
Use the repository's normal dependency/build setup to produce them if missing.
For this temporary snapshot, a sibling link can expose the existing matching
outputs without putting Common inside the EAS upload:

```bash
ln -s "$release_repo/Common" "$release_stage/Common"
```

Reassess this layout if mobile adds runtime Common imports, workspace packages,
or build hooks that need files outside MobileApp. Exporting/building an app-only
snapshot would then require those dependencies to be packaged appropriately.

**macOS path pitfall:** `/tmp` can resolve to `/private/tmp`. Always use the
canonical `pwd -P` result for `EAS_PROJECT_ROOT` and the command's working
directory. Mixing logical and canonical paths made the first 1.1.0 archives look
for `package.json` under a nonexistent cloud path. Fix the archive root before
trying signing changes or dependency upgrades.

## 3. Validate the release

Use a Node version compatible with the checked-out project's engines and Expo
SDK. Do not rely on old README development prerequisites for store submission.
Recheck the current [Apple submission requirements](https://developer.apple.com/app-store/submitting/)
and [Google target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en).
On 8 September 2026, the accepted builds used Expo SDK 54 / React Native 0.81.5,
iPhoneOS SDK 26.0 / Xcode 26.0, and Android target API 36. These are dated evidence,
not permanent minimums.

Follow `AGENTS.md`: run root `npm run fix` and inspect its diff before freezing the
snapshot, as described above, and compile changed projects. For MobileApp, run
these from the snapshot's app directory against the exact source being shipped:

```bash
npm run compile
npx expo-doctor
npm run test-file -- --watch=false --runTestsByPath \
  src/__tests__/appConfig.test.ts \
  src/api/authServerUrl.test.ts \
  src/api/clientRefreshQueue.test.ts \
  src/api/sso.test.ts \
  src/screens/auth/SSOLoginScreen.test.tsx \
  src/notifications/setup.test.ts \
  src/notifications/handlers.test.ts
npx expo export --platform ios --output-dir ../export-ios
npx expo export --platform android --output-dir ../export-android
```

The listed tests are a starting set. Add relevant authentication, MFA,
notifications, on-call, monitor, and screen suites based on the shipped diff.
`jest.config.js` runs iOS and Android projects automatically; retain both for
release checks. The Android critical-alert settings screen test has a documented
test-tooling exclusion. Do not run every test in the entire repository. The 1.1.0
release's selected coverage was 86 suites / 2,296 tests, not a required future count.

Also smoke-test the relevant user flows on native devices or suitable builds,
especially sign-in/SSO return links, session restoration, notifications, and the
features changed since the last store release. Mocked tests and JS exports do not
verify native push delivery or OS permission behavior. If using local Docker
services, read `HOST` from `config.env` and wait for hot reload before testing.
Record any native coverage that was unavailable.

The broad `npm run fix` once spent over an hour and stalled parsing an unrelated
generated `output/playwright/.../seed.cjs`. Git ignore rules do not control ESLint
ignore rules. If this recurs, diagnose it, stop only this task's stalled process,
and record the broad check as incomplete. Run scoped checks separately from the
repository root (`npx eslint MobileApp --cache` and
`npx prettier --check MobileApp/app.json`); do not label an interrupted broad run
as passed. Preserve other tasks' edits. Likewise, if Jest retains open handles
after passing assertions, distinguish that process issue from the assertion result.

## 4. Build signed store binaries with EAS

From the reviewed snapshot's canonical app directory:

```bash
cd "$release_app_root"
EAS_NO_VCS=1 EAS_PROJECT_ROOT="$release_app_root" \
  eas build --platform all --profile production \
  --non-interactive --freeze-credentials --no-wait \
  --message "Mobile store release from $release_commit"
```

This uses the snapshot as the upload root and the existing remote signing
credentials. `--freeze-credentials` prevents the noninteractive build from
updating them. If credentials are unavailable or expired, resolve that concrete
problem; do not replace the Android upload key or enable new Apple capabilities
just to get past a build error.

Record the **two returned build IDs**, then inspect those exact builds:

```bash
eas build:view "$ios_build_id"
eas build:view "$android_build_id"
```

Set these variables to the IDs from this release. Poll until each is `FINISHED`,
not merely queued or in progress. Queues can take substantially longer than
compilation. If using JSON output, save it locally and print only selected status
fields; build logs may be represented by signed URLs. Do not start duplicate
builds because a queue is slow, or use `--latest` when another release may run.

Download the artifact from the exact finished build. For Android, use the **AAB**
for Play. Validate it with the official
[bundletool](https://developer.android.com/tools/bundletool), inspect its manifest
(package, version name/code, min/target SDK), verify its JAR signature, and record
its SHA-256. Inspect the iOS IPA's `Payload/*.app/Info.plist` for bundle identifier,
version/build, deployment minimum, and SDK/Xcode metadata. Store-side processing
and validation remain required even after local checks pass.

The optional `EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT=true` switch in `app.config.js`
must remain off unless Apple has granted that entitlement to this team and the
provisioning profile supports it. Normal push notifications do not require this
critical-alert capability. See [the feature notes](README.md#critical-on-call-alerts).

## 5. Publish Android through Play Console

This is the route verified for 1.1.0; it gives visibility into the production
track, privacy changes, warnings, and rollout scope.

1. Open the existing app in Chrome, then **Test and release > Production**.
   Create a production release or resume the matching draft.
2. Upload the validated AAB. Wait for upload and processing to finish; navigating
   away during upload can cancel it. Confirm the displayed version code/name.
3. Set the release name and factual release notes. Google uses language tags:

   ```text
   <en-US>
   Describe the user-visible changes in this release.
   </en-US>
   ```

4. Review existing bundles, supported-device changes, and all errors/warnings.
   For the ordinary replacement update, the new bundle replaces the previous
   production binary. Investigate unexpected lost device support.
5. Check the intended rollout and countries. The 1.1.0 release used **100%** in
   the app's existing countries. Preserve the user's current rollout instruction.
6. Click **Next**, inspect **Preview and confirm**, then **Save**. Saving moves
   changes to **Publishing overview**; it does not submit them.
7. In Publishing overview, verify only the intended changes are included. For
   1.1.0 these were the production release and Data safety corrections. With
   **Managed publishing off**, approved changes publish automatically. If it is
   on, account for the additional publish step rather than assuming approval goes
   live automatically.
8. Click **Submit changes for review**, then **Send changes for review** in the
   confirmation. Wait for initial automated checks to finish. Verify the console
   says **Your changes are now in review** and resolve any immediate failures.

The 1.1.0 AAB showed only a missing-deobfuscation-file warning. Its R8/minification
was disabled, so no mapping existed or was required; native debug symbols were
present. For a future obfuscated build, upload that build's actual mapping file.

The `android:submit` npm script is available, but the current submit profile is
empty. Do not assume it selects production or completes review/rollout. If moving
to EAS/API submission, inspect the configured track, release status, credentials,
and remaining Play Console steps first. See
[Google's release instructions](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en).

## 6. Upload iOS, then submit App Review

Merge this target into the snapshot's `eas.json` without replacing other profiles:

```json
{
  "submit": {
    "production": {
      "ios": {
        "ascAppId": "6759615391"
      }
    }
  }
}
```

From that app directory, submit the **specific finished iOS build**:

```bash
EAS_NO_VCS=1 EAS_PROJECT_ROOT="$release_app_root" \
  eas submit --platform ios --id "$ios_build_id" \
  --profile production --non-interactive --wait
```

Wait for EAS to confirm upload success, record the submission ID, and allow Apple
to process the binary. **EAS Submit uploads to App Store Connect/TestFlight; it
does not complete App Review or publish the app.** See
[Expo's iOS submission guide](https://docs.expo.dev/submit/ios/).

In Chrome, open the existing app in App Store Connect:

1. Under **Distribution**, create the next iOS version or resume its matching
   **Prepare for Submission** draft. Its version must match `expo.version`.
2. Fill **What's New in This Version**. Check inherited screenshots, description,
   URLs, review contact, and sign-in details for accuracy. Use the existing review
   account details from the console; do not copy passwords into repository docs.
   Verify the review server/account still works and that instructions explain
   selecting the server before login.
3. Address required privacy, age-rating, export-compliance, and app-content fields
   according to the actual app. `ITSAppUsesNonExemptEncryption` was `false` for
   1.1.0; reassess it if encryption behavior changes instead of blindly answering.
4. Under **Build**, click **Add Build**, select the new version/build (for 1.1.0,
   build 2), click **Done**, then **Save**. If absent, check TestFlight processing
   or errors before attempting another upload.
5. For automatic publication, select **Automatically release this version** and
   the intended full/phased release. 1.1.0 used immediate full release and retained
   existing ratings.
6. Click **Add for Review**. Then open the draft submission and click
   **Submit for Review**. Verify **1 Item Submitted** and the version status
   **Waiting for Review**. **Ready for Review** still needs the submit action.
7. Record the App Review submission URL and watch for review feedback. After
   approval, confirm the intended version is **Ready for Distribution** and
   visible on the public store listing in the intended storefront.

Apple documents these as separate steps in
[Submit an app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/).

## 7. Keep privacy metadata accurate

Compare changes to the app, included SDKs, and backend data handling with the
existing disclosures. Routine releases need not rewrite unchanged answers. These
were the evidence-backed corrections for 1.1.0, including behavior already present
in the prior version:

| Store  | Data                                   | September 2026 declaration                                                   |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------- |
| Apple  | Name, Email Address, Phone Number      | Existing declarations retained                                               |
| Apple  | User ID, Device ID, Other User Content | Added; App Functionality, linked to identity, not tracking                   |
| Google | Name, Email address, User IDs          | Collected, non-ephemeral, required; App functionality and Account management |
| Google | Other user-generated content           | Collected, non-ephemeral, optional; App functionality                        |
| Google | Device or other IDs                    | Collected, non-ephemeral, required; App functionality                        |

Evidence lives in `src/api/client.ts`, `src/api/pushDevice.ts`,
`src/api/incidentNotes.ts`, `src/api/alertNotes.ts`, authentication code, and the
included notification SDKs. Account identifiers accompany authenticated requests;
notes are retained; push tokens are retained to send notifications. Denying
notification permission does not by itself prove every SDK device identifier is
optional. Google account methods were updated for password, SSO, MFA, and OAuth
flows. Validate actual account-creation flows and deletion URLs on future releases.

Do not infer calendar collection merely from exporting a calendar subscription,
contacts collection from displaying a server-provided roster, or analytics from
ordinary operational actions. Conversely, reassess new SDK collection and backend
sharing rather than treating this table as a permanent attestation. Use the
[Apple privacy definitions](https://developer.apple.com/app-store/app-privacy-details/)
and [Google Data safety definitions](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
when answering the current forms.

Apple publishes completed privacy answers separately; adding a data type also
requires finishing its purpose/linkage/tracking questions. Unfinished types may
not be added to the public label. Google Data safety **Save** stages a change for
review in Publishing overview; include it with the intended production submission.

## Troubleshooting and agent handoff

| Symptom                              | Next action                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EAS queued for a long time           | Monitor the recorded build/submission ID. A queue is not a failed build.                                                                                                                                 |
| Cloud cannot find `package.json`     | Verify command directory, archive inventory, canonical `EAS_PROJECT_ROOT`, and whether runtime dependencies sit outside the archive.                                                                     |
| Duplicate build/version error        | Inspect all uploaded builds/tracks, assign an unused counter, and rebuild only the affected platform.                                                                                                    |
| Signing fails                        | Read the exact error; inspect existing profile/key validity and entitlement compatibility. Reuse the established app identity.                                                                           |
| Chrome extension disconnects         | Rediscover Chrome and the intended tab. If supported, use native Chrome controls. Read fresh UI state before each dependent action; old element indexes/tab IDs can refer to another task after a reset. |
| Apple account notice appears         | Distinguish a notice from a demonstrated blocker. Follow current confirmation rules for accepting new agreements.                                                                                        |
| Upload succeeded but nothing is live | Finish the store draft, review submission, approval, and any manual publication step.                                                                                                                    |
| Store rejects the update             | Read the specific review issue; fix metadata or the app as required, retest, and resubmit. A new binary needs a new build identifier.                                                                    |

Use `eas build --platform ios` or `--platform android` with the same production
profile for a platform-specific rebuild. Do not rebuild or resubmit an already
accepted counterpart without a reason.

The general [.github/workflows/release.yml](../.github/workflows/release.yml)
contains mobile publishing jobs, but it is a broad OneUptime release pipeline with
other jobs and version guards. Do not dispatch it as a shortcut for a mobile-only
update without reviewing its full effects. Its iOS upload step also does not
finish App Review. [RELEASE_SIGNING.md](docs/RELEASE_SIGNING.md) describes initial
GitHub signing setup; existing official app updates should reuse EAS credentials.

Maintain a release record outside the upload root, for example
`output/mobile-release-YYYY-MM-DD/release-record.md`. Record:

- Source commit, reviewed overrides, user-facing version, and both build counters.
- Dependency/tool versions, checks and their actual outcomes, and native-test limits.
- EAS build/submission IDs and URLs, artifact paths/hashes, and validation results.
- Store draft/review links, metadata/privacy changes, rollout settings, and errors.
- Time checked and the exact state of each platform: built, uploaded, submitted,
  approved, or publicly live. Add public listing verification after approval.

The next agent should inspect those IDs and console states first and resume the
unfinished step. If handing back while review is pending, say **submitted for
review, automatic release after approval**; do not say **published** until verified.
Do not imply an ongoing monitor exists unless one has actually been arranged.

## Reference release: 1.1.0

These links are for diagnosis/comparison, not future release targets:

- Source: `e43969d7a2ced12ab7855dbf775d533a85ce912d`, with reviewed `app.json`
  version/build overrides; iOS build `2`, Android code `3`.
- [iOS EAS build](https://expo.dev/accounts/oneuptime/projects/oneuptime-on-call/builds/188c259d-379c-4880-9c7e-268c6fd48236)
- [iOS EAS upload](https://expo.dev/accounts/oneuptime/projects/oneuptime-on-call/submissions/d05f6032-9cfc-4df0-82f6-855e696ca639)
- [Apple review submission](https://appstoreconnect.apple.com/apps/6759615391/distribution/reviewsubmissions/details/09746e1b-617c-4605-bbfe-2a71ceaaa048)
- [Android EAS build](https://expo.dev/accounts/oneuptime/projects/oneuptime-on-call/builds/d521db6b-c264-4e57-bfaa-6257de605dc9)

The local September release artifacts and detailed check results were saved under
`output/mobile-release-2026-09-08/`. That ignored directory is machine-local and may
not exist in future checkouts; this tracked guide contains the reusable procedure.
