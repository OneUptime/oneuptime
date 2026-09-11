# Mobile experience audit — September 2026

The audit covers the application's browser-accessible journeys and the native
JavaScript contracts exercised by the iOS and Android Jest projects. Screenshots
use the real Expo / React Native Web application with synthetic data.

## UI changes

- Home gives active incidents and alerts separate, prominent response tiles.
  Larger system text switches these tiles to a vertical layout.
- Inbox has a shorter header, keeping more of the response queue visible.
- Incident, alert, episode and monitor lists share readable filter controls,
  matching-result totals and a nearby reset action. Clearing search retains
  input focus. Section totals include every matching fetched record, including
  records beyond the first rendered batch.
- Monitor health totals are grouped into a compact summary. Failed reads do not
  present old totals as current health.
- Failed detail reads have visible retry controls. Previously loaded content
  stays available during a failed refresh. Notes render Markdown and runbook links.

## Findings and regression coverage

| Area | Defect and resulting behavior | Coverage |
| --- | --- | --- |
| Sign-in and two-factor authentication | The server serializes the user at the response root; the app expected a nested `data` object. Account identity now survives password and two-factor sign-in, including serialized IDs, email and names. Older nested envelopes remain supported. | Authentication API tests, login and two-factor suites, browser sign-in to Settings journey |
| Workspace connection | Editing a saved workspace started from the default address, and Login retained its old workspace label after a change. Both now reflect the saved address; a connection failure can be corrected and retried. | Server URL and Login component tests, browser change-workspace journey |
| Sign Out | An SSO-storage deletion error could prevent leaving the authenticated UI. Both SSO keys are attempted and local authentication/cache cleanup still finishes. | Session logout and SSO-storage tests |
| Project access and SSO | A project-list failure could appear as no projects; provider-discovery failure could appear as no configured providers. Both explain the failure and offer recovery. | Project access component tests, browser SSO discovery failure/retry journey |
| Response lists | Missing state metadata could file resolved incidents/alerts as active. Initial metadata failures now have a retry; failed background refreshes preserve cached lists with an explicit notice. | Both list suites; browser incident/alert state failure/recovery journeys |
| List totals and search | Section counts reflected only the first rendered batch. Counts now describe all matching fetched rows; combined search and state filters reset together. Search clearing retains keyboard focus. | List and filter component tests, browser pagination/search/reset checks |
| Response actions | A failed native haptic could turn a successful server state change into an apparent failure. Haptics are now best effort. | Haptics unit tests and API → React Query → detail-screen integration tests |
| Detail refresh and errors | Refresh indicators were hard-coded off; refresh omitted response-state metadata. Notes, activity, history and measurement failures could look empty. Refresh now waits for all reads, and failed reads expose targeted retries. | All five detail suites and `DetailRecovery.integration.test.tsx` |
| Notes | The composer offered Markdown while note bodies displayed raw Markdown. Formatting, runbook links and serialized author names now render correctly. | NotesSection and MarkdownContent suites; existing note submission browser journey |
| On-call refresh | Pending refreshes did not show progress; empty/error views could remove the refresh gesture. Overview, roster, policies, coverage history, pages and calendar preserve refresh/retry behavior. | Shared refresh hook and seven on-call screen suites; full browser on-call journey |
| Coverage | A teammate-directory failure looked like an empty directory. Coverage previews did not advance while a form stayed open, and invalid shift windows could fall through to a different coverage request. Directory failures now offer retry; previews update; invalid shifts are blocked. | Coverage form regressions; browser teammate failure/retry and current-shift coverage journeys |

List search continues to cover the newest 100 fetched records per project and
record type. The existing limit notice remains visible; the new result totals
describe this fetched set, not an unlimited server search.

## Validation results

- 1,938 focused tests passed in 78 platform suites (39 source suites run as
  both iOS and Android).
- All 76 browser journeys passed across four viewport sizes. The 32 list and
  main-screen journeys were repeated successfully after the final list refinements.
- `npm run compile` passed in `MobileApp`; Common declarations were generated
  using its compile command.
- Root `npm run fix` passed.
- Twenty reviewed images, including two previous-design references, are in the
  linked screenshot gallery.

## Reproduce validation

Install dependencies with `npm ci` in `MobileApp`. When Common declarations are
not present, run `npm run compile -- --declaration --emitDeclarationOnly` in
`Common` first (after installing its dependencies). Then run in `MobileApp`:

```bash
npm run compile
npm run test-file -- --runTestsByPath \
  src/components/ListFilters.test.tsx \
  src/components/SearchField.test.tsx \
  src/components/NotesSection.test.tsx \
  src/components/MarkdownContent.test.tsx \
  src/screens/HomeScreen.test.tsx \
  src/screens/IncidentsScreen.test.tsx \
  src/screens/AlertsScreen.test.tsx \
  src/screens/MonitorsScreen.test.tsx \
  src/screens/DetailRecovery.integration.test.tsx \
  src/screens/IncidentDetailScreen.test.tsx \
  src/screens/AlertDetailScreen.test.tsx \
  src/screens/IncidentEpisodeDetailScreen.test.tsx \
  src/screens/AlertEpisodeDetailScreen.test.tsx \
  src/screens/MonitorDetailScreen.test.tsx \
  src/hooks/useHaptics.test.ts \
  src/hooks/useRefresh.test.tsx \
  src/screens/CreateOnCallOverrideScreen.test.tsx \
  src/screens/OnCallOverviewScreen.test.tsx \
  src/screens/WhoIsOnCallScreen.test.tsx \
  src/screens/MyOnCallPagesScreen.test.tsx \
  src/screens/MyOnCallPoliciesScreen.test.tsx \
  src/screens/OnCallOverridesScreen.test.tsx \
  src/screens/OnCallCalendarFeedScreen.test.tsx \
  src/screens/auth/LoginScreenPasskey.test.tsx \
  src/screens/auth/LoginScreenTwoFactor.test.tsx \
  src/screens/auth/ServerUrlScreen.test.tsx \
  src/screens/auth/TwoFactorScreen.test.tsx \
  src/screens/auth/TwoFactorEnrolmentScreen.test.tsx \
  src/screens/auth/BackupCodesScreen.test.tsx \
  src/screens/settings/ProjectsScreen.test.tsx \
  src/api/authTwoFactor.test.ts \
  src/api/authPasskey.test.ts \
  src/api/authServerUrl.test.ts \
  src/hooks/useAuthLogout.test.tsx \
  src/hooks/useAuthTwoFactor.test.tsx \
  src/hooks/useAuthSessionCache.test.tsx \
  src/storage/ssoTokens.test.ts \
  src/navigation/MainTabNavigator.test.tsx \
  src/navigation/ProjectNotificationNavigation.integration.test.tsx
npm run test-ui
```

Run `npm run fix` at repository root. Generated browser output is excluded from
the mobile TypeScript project, so exporting the app does not add bundles or
Playwright reports to compilation.

The browser suite covers sign-in, password recovery, SSO discovery, two-factor
verification/enrolment, backup-code recovery, Home, all response lists/details,
monitors, notes, project switching/restoration, Settings and the on-call journeys.
Assertions include tenant IDs, request payloads, recovery after errors, filter
state, touch targets, bottom clearance and horizontal overflow. It runs at
320 × 740, 390 × 844, 412 × 915 and 768 × 1024.

## Screenshots and environment limits

See the [review gallery](../../.github/pr-assets/mobile-experience-polish/README.md)
for current captures. `npm run test-ui` attaches screenshots to its Playwright
report; the gallery selects representative screens and recovery states.

This checkout did not contain `config.env`, a running application backend, or
an Android/iOS simulator. The audit therefore used synthetic HTTP fixtures;
it did not validate a live deployment or produce native device screenshots.
The iOS/Android Jest projects exercise platform-specific JavaScript with native
modules mocked. Native keyboard behavior, OS permission dialogs, push delivery,
biometrics, native SSO handoff and calendar subscriptions still require device
validation. No native binary was built, submitted or published.
