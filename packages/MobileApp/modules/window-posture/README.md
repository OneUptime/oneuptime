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
- **iOS:** not linked yet (`expo-module.config.json` names Android alone), so
  iOS keeps today's layout. Apple added what an iOS side needs in the iOS 27.1
  SDK - the fold as a division region (`UIView.reservedRegions(kind:
.division)`) and the hinge (`UIHingeInteraction`; Expo SDK 58 wraps it as
  `expo-hinge`) - but it has to be built and checked on Xcode 27.1 and the
  iPhone Duo simulator before it is linked.
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
  iOS build, and pins the names and the report's shape the Kotlin side uses.
- Kotlin, with the app's Gradle build (Android SDK 36 and JDK 17):

  ```bash
  npx expo prebuild --platform android --no-install
  cd android
  ./gradlew :window-posture:compileReleaseKotlin :window-posture:testReleaseUnitTest :expo:compileReleaseKotlin
  ```

  `testReleaseUnitTest` runs `FoldReportTest` (the report's units and shape);
  `:expo:compileReleaseKotlin` compiles the module list Expo generates, which
  names `WindowPostureModule`.

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
4. Galaxy Z Flip half open on a table: the incident above the crease, the list
   below it.
5. A tablet that does not fold: the handle is there; the divider starts where
   it always has.
6. The cover screen, and any phone: nothing changed.
7. TalkBack on the handle: it reads "List width", how much of the width the
   list takes, and swiping up or down moves it.
