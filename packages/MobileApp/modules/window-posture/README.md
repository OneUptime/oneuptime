# Window posture

A local Expo module that tells the app where its window folds, and how the
phone is held. It is the "check" behind the posture layouts in
`src/layout/windowLayout.ts`:

| What the module reports                                                     | Layout                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Nothing (no module, or no report yet)                                       | Today's layout, by the window's size alone. The divider has no handle.  |
| No fold, or a fold lying flat                                               | The reader can drag the divider between a list and its detail.          |
| A fold running top to bottom that splits the window (half open like a book) | The list and the detail meet on the fold; the divider stays there.      |
| A fold running side to side that splits the window (half open on a table)   | The detail above the fold, the list below it, the bar along the bottom. |

## Platforms

- **Android:** Jetpack WindowManager's folding features
  (`WindowInfoTracker.windowLayoutInfo`), converted to points with the window's
  size (`FoldReport.kt`), so JavaScript can tell a report for this window from
  one made a moment before a rotation or a resize. The module builds against
  the `androidx.window` version React Native itself ships, so it adds no second
  version to the app.
- **iOS:** written (`ios/`) but not linked yet - `expo-module.config.json`
  names Android alone - so iOS keeps today's layout. Apple added what it needs
  in the iOS 27.1 SDK: the fold as a division region
  (`UIView.reservedRegions(kind: .division)`) and the hinge
  (`UIHingeInteraction`, which Expo SDK 58 wraps as `expo-hinge`). An
  invisible view across the key window reads the regions where UIKit tracks
  them (`updateConstraints()`, which UIKit calls again when they change), the
  hinge interaction says whether the phone is half open or flat, and
  `FoldReport.swift` builds the same report `FoldReport.kt` does. Everything
  that needs the new SDK sits behind Expo's own guard
  (`#if canImport(UIKit, _version: 9127.0.85)` and `#available(iOS 27.1, *)`),
  so an older Xcode builds it and reports nothing. It has never been built on
  a Mac: see [Linking the iOS side](#linking-the-ios-side).
- **Web:** the web build does not use this module; it reads the browser's
  viewport segments (`src/layout/postureSource.web.ts`), which is how the
  browser checks in `tests/ui/posture-foldables.spec.js` put the app in each
  posture.

## JavaScript side

`src/layout/postureSource.ts` asks Expo for the module by name
(`OneUptimeWindowPosture`): `getFolds()` returns the latest report, and every
later one arrives as a `foldsChange` event. A missing module, a report this
build cannot read, or a module that throws all read as "no report", which keeps
today's layout.

## Checks

- JavaScript, with the module standing in: `npx jest src/layout src/navigation
src/__tests__/windowPostureModule.test.ts`. The last suite runs Expo's own
  autolinking to show the module is linked into Android builds and into no
  iOS build, and pins the names and the report's shape the Kotlin and Swift
  sides use.
- Kotlin, with the app's Gradle build (Android SDK 36 and JDK 17):

  ```bash
  npx expo prebuild --platform android --no-install
  cd android
  ./gradlew :window-posture:compileReleaseKotlin :window-posture:testReleaseUnitTest :expo:compileReleaseKotlin
  ```

  `testReleaseUnitTest` runs `FoldReportTest` (the report's units and shape);
  `:expo:compileReleaseKotlin` compiles the module list Expo generates, which
  names `WindowPostureModule`.

- Swift, the iOS side's report (`ios/Package.swift`, which never ships): on a
  Mac, `cd ios && swift test`; anywhere else, in Swift's own image, on a copy
  so no `.build` folder lands in the repository:

  ```bash
  cp -r ios /tmp/window-posture-ios
  docker run --rm -v /tmp/window-posture-ios:/package -w /package swift:6.1-noble swift test
  ```

  `FoldReportTests` holds the report's keys, units and shape to the Kotlin's.
  The rest of `ios/Sources` needs UIKit and ExpoModulesCore, so only an Xcode
  build compiles it.

## Linking the iOS side

On a Mac with Xcode 27.1 (the iOS 27.1 SDK):

1. Name Apple in `expo-module.config.json`, as `expo-hinge` does:
   `"platforms": ["apple", "android"]` and
   `"apple": { "modules": ["WindowPostureModule"] }`.
2. `npx expo prebuild --platform ios`, then build and run the app in the
   iPhone Duo simulator, and go through the checks below on it.
3. Turn the autolinking checks in `src/__tests__/windowPostureModule.test.ts`
   around: they hold today that no iOS build links the module.
4. Build once with an older Xcode too: the guard leaves the new SDK out, the
   module reports nothing, and the app keeps today's layout.

## On a device

No device or emulator runs in CI, so check these by hand before a release that
ships the module (RELEASING.md lists them too):

1. Galaxy Z Fold (or the Android Studio foldable emulator), inner screen held
   like a book and half folded: the Inbox's list and incident meet exactly on
   the crease, and the divider has no handle.
2. Opened flat: a handle sits in the middle of the divider. Drag it: the list
   follows the finger and keeps its width. Restart the app: the width is still
   there. Double tap the handle: the divider goes back onto the crease.
3. Inner screen on its side, half folded on a table with an incident open and a
   note half written: the incident is above the crease, the Inbox below it with
   its first row showing, the bar along the bottom. Open it flat again: the note
   is still there.
4. Still on the table, Home: Needs attention and the on-call card above the
   crease, Service health and Grouped events below it, each half scrolling on
   its own and refreshing on its own pull. Settings: who is signed in and the
   workspace above it, the rest below.
5. Still on the table, open Add note, assign someone, or switch projects: the
   sheet rises over the lower half and stops at the crease. Start typing in
   the note: the sheet moves above the crease, the keyboard below it, and
   nothing is hidden behind the keyboard.
6. Galaxy Z Flip half open on a table: the incident above the crease, the list
   below it.
7. A tablet that does not fold: the handle is there; the divider starts where
   it always has.
8. The cover screen, and any phone: nothing changed.
9. TalkBack on the handle: it reads "List width" and the list's share of the
   width ("45%"), double tapping it puts the divider back, and swiping up or
   down moves it. Half open on a table, swiping through the screen reads the
   pane above the fold before the list below it, and on Home and Settings the
   half above the fold before the half below it.
10. A keyboard (a Chromebook, or a keyboard on the tablet): Tab reaches the
    handle and draws a ring around it. The arrow keys, Home, End and Enter move
    it only where React Native's key events are on - today, the web build.
11. After linking the iOS side, the iPhone Duo simulator: each posture above
    as on the Galaxy Z Fold, and an iPhone or iPad that does not fold
    unchanged.
