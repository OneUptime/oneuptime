# Mobile UI and visual testing

The mobile app uses calm, card-based surfaces on a cool grey canvas, with
OneUptime indigo reserved for actions and status always spelled out in words.
It follows the device's light or dark appearance, and people can override it
under **Settings → Appearance**. The rules, tokens and shared components are in
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), and the
[revamp gallery](../../../.github/pr-assets/mobile-design-revamp/README.md) shows
the light and dark screens.

The five destinations are **Home, Monitors, Inbox, On-Call and Settings**. Inbox
unifies incidents and alerts with explicit categories; grouped episodes remain
one tap away. Home prioritizes active work, then duty status and service health.
Detail pages lead with the resource title and state, then a next-step card with
the response actions, followed by titled content cards.

### Native styling regression (September 2026)

Styles did not load on many iOS and Android pages while the web build and every
test looked correct. The app compiled all JSX through NativeWind's runtime even
though it never used `className`; on native that runtime folded each
component's `style` into an object spread, which discards `Pressable` style
callbacks. Response rows, filter chips, settings rows, the project switcher and
the Acknowledge/Resolve buttons therefore rendered with no background, padding
or layout. NativeWind and Tailwind were removed, and
`src/__tests__/nativeStyling.test.ts` compiles a probe with the real Babel
config for both platforms so the interop runtime cannot return unnoticed.

The [September 2026 polish and audit](UI_AUDIT_2026_09.md) adds prominent Home
response tiles, shared list filters with matching totals and reset actions,
and recovery for failed reads throughout authentication, response and on-call
flows. Its [screenshot gallery](../../../.github/pr-assets/mobile-experience-polish/README.md)
contains the current review captures and before/after comparisons.

Sign-in leads with email and password; passkeys and team SSO are secondary
choices. Recovery screens explain the next step, Settings separates account
and workspace controls, and the on-call hub prioritizes handoff times and
coverage. Private calendar URLs are concealed until explicitly revealed;
copy/share controls keep the credential warning visible. The native launch
screen uses the same light background and the existing official wordmark.
Regenerate its transparent raster asset with
`node scripts/generate-launch-asset.js` after installing Playwright Chromium;
the generator reuses the repository's brand SVG without new dependencies.

The project name in the header is the global switcher. Operational screens use
`useActiveProject`; only the switcher and project management use the complete
membership list from `useProject`. Selection is remembered per account and
server. Changing it returns to Home and resets open detail screens and forms.
Query keys and requests carry the selected project's identity.

Operational lists retain the existing limit of the 100 newest records per
selected project and record type. Search and state filters apply locally to
that fetched batch; scrolling reveals more of the batch, not older server
pages. When a list reaches 100 rows, a helper beside search explains this
limit, including separately for incident and alert episodes. Home counts are
server totals, so they can exceed the matching rows in these recent lists.

## Layout rules

- Lay screens out by the window, never the device: one pane and a bottom bar
  below 600 points, a rail from 600 points on a window wider than tall, and a
  list beside its detail from 840 points. The full rules, and how a screen
  keeps its state through a fold, are under _Windows, panes and foldables_ in
  [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
- Build screens from the shared components listed in
  [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md): `ScreenIntro` for the page title,
  `Card`/`ListGroup` for grouped content, `SearchField` and `ListFilters` for
  lists, `Banner` for inline messages and `EmptyState` for empty and failed reads.
- Use the `spacing`, `radius` and `typography` tokens: 20-point page gutters,
  16-point card corners, 12-point control corners and controls at least 48
  points tall (54 for response actions).
- Never hard-code a colour. Every token exists in the light and dark palettes,
  and `src/theme/colors.test.ts` checks 4.5:1 contrast for text, status tints
  and filled-control labels in both.
- Use `useScreenPadding()` on scrollable pages, including nested sheets. It
  includes the 72-point navigation bar, the greater of the bottom safe area or a
  12-point gap, and another 40 points after the content.
- Preserve room for wrapped labels and scaled text. State must be expressed in
  text and accessibility properties as well as colour.
- Failed or SSO-locked reads must not be presented as empty success, off-call
  duty or complete coverage. Destructive actions keep their confirmation.

## Focused checks

Run the relevant Jest suites from `packages/MobileApp`, for example:

```bash
npm run test-file -- --runTestsByPath \
  src/hooks/OnCallProjectIsolation.test.tsx \
  src/screens/CreateOnCallOverrideScreen.test.tsx \
  src/screens/WhoIsOnCallScreen.test.tsx
npm run compile
```

The Jest configuration runs selected suites with separate iOS and Android Expo
presets. This checks platform-specific JavaScript branches and native component
contracts using mocks; it does not launch either operating system. Run
`npm run fix` from the repository root after source changes.

Project isolation tests cover selected-tenant requests, cache changes during a
switch, inaccessible SSO projects, and rejection of coverage mutations for a
different project. Screen tests cover navigation, filtering, truthful loading
and error states, and bottom clearance.

Inbox integration tests also cover cold notification entry, category-correct
Back navigation from individual and grouped resources, and Home shortcuts
replacing previous filters without leaving a stale search or stacking lists.

## Browser journeys and screenshots

Install the browser once, then build the current web export and run the visual
journeys:

```bash
npx playwright install chromium
npm run test-ui
```

`test-ui` exports the Expo application to `dist-ui` and serves it at
`http://127.0.0.1:8096`. Keep that port free before starting, or pick another
with `MOBILE_UI_PORT` (`MOBILE_UI_PORT=8317 npm run test-ui`). Playwright uses
synthetic API fixtures and a fixed date from `tests/ui/fixtures.js`; the journeys
do not depend on a live OneUptime server or real account data.

The configured Chromium viewports are 320 × 740, 390 × 844, 412 × 915 and
768 × 1024. Their names (`small-phone`, `iphone-size`, `android-size`, `tablet`)
describe dimensions, not native device emulation.

A fifth project, `foldables`, runs `tests/ui/foldables.spec.js` once. Each test
sets its own windows - the Galaxy Z Fold's cover screen (344 × 882) and inner
screen (884 × 1104, and 1104 × 884 on its side), the iPhone Duo held open
(951 × 669) and a phone on its side (852 × 393), light and dark - and resizes
the window mid-task the way a fold does: an incident open with a note
half-written in its sheet keeps both through a fold and an unfold, the list
keeps its search, and the project sheet stays open. It also checks the
divider sits on the fold, the rail and the bar, the readable width and that
nothing scrolls sideways. Run it alone with
`npx playwright test --project=foldables`. The same project runs
`tests/ui/posture-foldables.spec.js`, which has Chromium's DevTools half close
the phone - on a table and like a book - and open it flat
(`Emulation.setDeviceMetricsOverride` with a `displayFeature`): the app reads
the fold from the browser's viewport segments, as it reads Jetpack
WindowManager's on Android. It checks the tabletop layout keeps every pane off
the crease, the divider stays on a book's fold, the handle moves it when flat
(remembered across a reload, put back by a double tap), and that a window
nothing reports a fold for - the iPhone Duo today - keeps the layout by size
alone. Playwright's own screenshot drops an emulated fold, so that spec
captures through DevTools.

A sixth project, `tablets`, runs `tests/ui/tablets.spec.js` once on a tablet on
its side (1280 × 800): the rail, each list beside its detail, Home in two
columns and the sheets at their readable width, light and dark. The layout
rules themselves are unit-tested in `src/layout/windowLayout.test.ts` and
`src/layout/windowLayoutPosture.test.ts`. These screenshots show the
real React Native Web rendering, not screenshots from an iOS simulator or
Android emulator. Native keyboards, safe-area behavior, gestures, notifications,
SSO handoffs and calendar subscriptions still require device or simulator checks.
Read [RELEASING.md](../RELEASING.md) before building or publishing native apps.

Capture review images from the current build:

```bash
UPDATE_SCREENSHOTS=1 npm run test-ui -- --project=iphone-size
```

Images are written to `docs/screenshots/<viewport>-<screen>.png`. Normal runs
write images to Playwright's test output and attach them to its report. Captures
wait for content, fonts and navigation transitions; journeys also assert
navigation, tenant headers, private-link visibility, touch-target dimensions and
that the last controls can be reached above the bottom bar. To inspect failures:

```bash
npx playwright show-report
```

`tests/ui/oncall.spec.js` covers the overview, roster search and coverage filters,
teammate picker, coverage confirmation, coverage history, page-to-incident
navigation, policy assignments and calendar setup. `tests/ui/security.spec.js`
and `security-foldables.spec.js` cover security cases (installFixtures'
`security` option): Home's row and the Inbox's Security category only for
people who can see cases, the open cases in triage order, what OneUptime AI
found shown at once, a playbook step approved with a comment (Approve the
screen's one filled button until it is decided), a case taken on and closed
with a verdict, the inner screen's two panes and a fold mid-approval. Other specifications cover the
remaining operational, authentication and settings screens.

After editing source, use `npm run test-ui` again so screenshots reflect a fresh
export. When only the test changes and the export is already current, a focused
run can reuse it:

```bash
npx playwright test oncall.spec.js --project=iphone-size --workers=1
```

Only commit reviewed screenshots containing synthetic fixtures. Do not capture
production incident details, account credentials, backup codes or real private
calendar subscription URLs in pull requests.
