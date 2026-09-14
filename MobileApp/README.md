# OneUptime Mobile App

Expo + React Native mobile app for OneUptime on-call management.

For store updates, follow the [mobile publishing guide](RELEASING.md). It includes
the existing app identifiers, EAS builds, store review steps, and release handoff
instructions for maintainers and AI agents.

## Prerequisites

- Node.js 18+
- npm
- [Expo Go](https://expo.dev/go) app on your iOS or Android device (for quick testing)
- A running OneUptime instance (or use `https://oneuptime.com`)

For native builds:

- **iOS**: macOS with Xcode 15+
- **Android**: Android Studio with SDK 34+

## Setup

```bash
cd MobileApp
npm install
```

## Running the App

### Expo Go (quickest way to test)

```bash
npm start
```

This starts the Expo dev server. You'll see a QR code in the terminal:

- **iOS**: Scan the QR code with your iPhone camera
- **Android**: Scan the QR code from the Expo Go app

### iOS Simulator

```bash
npm run ios
```

Requires Xcode installed on macOS.

### Android Emulator

```bash
npm run android
```

Requires Android Studio with an emulator configured.

### Web (for quick UI testing)

```bash
npm run web
```

## App Configuration

On first launch, the app will ask for:

1. **Server URL** - The URL of your OneUptime instance (defaults to `https://oneuptime.com`). The app validates the URL by calling `/api/status` before proceeding.
2. **Login** - Email and password for your OneUptime account.

Tokens are stored securely in the device Keychain. The server URL is stored in AsyncStorage.

## Project Structure

```
MobileApp/
├── src/
│   ├── api/           # Axios client, auth API calls
│   ├── components/    # Reusable UI components (badges, skeleton, empty state)
│   ├── hooks/         # Auth hook / context, data hooks
│   ├── navigation/    # React Navigation (auth stack, main tabs)
│   ├── oncall/        # Pure on-call domain logic (shifts, duty state, overrides)
│   ├── screens/       # Screen components (auth, home, incidents, alerts, on-call, settings)
│   ├── storage/       # Keychain (tokens) and AsyncStorage (server URL)
│   ├── theme/         # Colors, typography, spacing, theme context
│   └── App.tsx        # Root component with providers
├── assets/            # App icons and splash screen
├── app.json           # Expo configuration
├── index.ts           # Entry point
├── package.json
└── tsconfig.json
```

## Auth Flow

```
ServerUrlScreen → LoginScreen → MainTabNavigator (Home, Monitors, Incidents, Alerts, On-Call, Settings)
```

- Access tokens are refreshed automatically on 401 responses.
- Logout clears all stored tokens and returns to the login screen.

## Project Navigation

The app shows one project at a time. Tap the project name in the header to
switch projects. Home, monitors, incidents, alerts, on-call schedules, pages,
coverage and calendar links all follow that selection.

The last selected project is remembered for the signed-in account and server.
The app restores the selection before loading project data; if that membership
is no longer available, it selects an available project. Switching projects
returns to Home and clears the previous project's open detail screens and forms.
Operational requests and query caches are scoped to the selected project.

Project membership management remains under Settings. Projects that require
SSO must be authenticated before their operational data can be read; an
inaccessible project is not treated as an empty incident list or an off-call
status.

## Tests

```bash
npm run test-file -- --runTestsByPath src/screens/OnCallOverviewScreen.test.tsx
```

Run only the suites relevant to your changes. Jest runs each selected suite
with both `jest-expo/ios` and `jest-expo/android`. Tests live next to the code they cover
(`src/**/*.test.ts[x]`); shared native-module mocks are in
`src/__tests__/setup.ts`.

See [UI redesign and visual testing](docs/UI_REDESIGN.md) for browser journeys,
screenshot capture, project isolation checks and the limits of browser previews.

The light interface has five destinations: **Home, Monitors, Inbox, On-Call,
Settings**. Inbox brings incidents and alerts together, including their grouped
episodes. Pick a project in any workspace header; the selection is remembered
for this account and server across restarts. Switching returns to Home and
clears open forms and details so projects never share an editing context.

## On-Call

The On-Call tab answers the three questions a responder actually has on a
handset, in this order:

1. **Am I on call, and until when?** The status card leads with a live
   countdown to the next handoff. It refuses to invent one: an escalation rule
   that names you directly has no shift window, so the card says "standing
   assignment — no scheduled handoff" rather than borrowing a boundary from an
   unrelated schedule.
2. **Who else is on?** _Who's On Call_ lists the selected project's schedules
   with the person on each now, who is next, and when they swap.
   Schedules with **nobody** on call are pulled to the top — they are the only
   rows on that screen that are a problem. Search matches schedules and people;
   the coverage filters narrow the list to gaps or covered schedules.
3. **Can somebody take this?** _Cover for me_ creates a project-wide
   `OnCallDutyPolicyUserOverride` that starts now and runs for a preset number
   of hours. The same sheet works in reverse ("I'll take over") for picking up
   a teammate's pages. _Get cover_ on an individual shift pre-fills that shift's
   time window. The form shows the selected project and reads back the routing
   and duration before confirmation.

**Coverage** splits arrangements into active, scheduled and ended; cancellation
requires confirmation. **My pages** highlights unanswered notifications and
opens the corresponding incident, alert or episode. **My policies** explains
the assignments that can currently page you. **Calendar sync** creates a private
subscription link for your shifts in the selected project. Its raw credential
is hidden by default, with explicit reveal, copy and share controls.

Scrollable screens reserve space for the entire bottom navigation bar, the
device's safe area and an additional 40 points of breathing room. The coverage
form keeps the same clearance because its nested modal can leave the tab bar
visible.

### Where the data comes from

| Screen                            | Endpoint                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| Duty status, standing assignments | `GET /api/on-call-duty-policy/current-on-duty-escalation-policies`                           |
| Materialized shifts               | `GET /api/on-call-calendar/my-shifts` with the selected project's `tenantid` header          |
| Roster and fallback handoff times | `POST /api/on-call-duty-policy-schedule/get-list`                                            |
| Overrides                         | `POST /api/on-call-duty-policy-user-override/get-list`, `POST`/`DELETE` on the same resource |
| Teammate picker                   | `POST /api/team-member/get-list`                                                             |
| Pages sent to me                  | `POST /api/user-notification-log/get-list`                                                   |
| Personal calendar subscription    | `GET /api/on-call-calendar/feed/current`, `POST /api/on-call-calendar/feed/rotate`           |

Keep these distinctions when changing the data flow:

- **The shift list and duty summary have different sources.** `/my-shifts`
  supplies materialized shift windows, including cover and policy-specific
  shifts. The schedule roster supplies `rosterHandoffAt`, `rosterStartAt`,
  `rosterNextStartAt` and `rosterNextHandoffAt` for the summary and fallback
  list when materialized shifts are unavailable. The assignments endpoint knows
  _whether_ you are on duty (and accounts for overrides); it says nothing about
  when it stops.
- **Every operational read uses the selected project.** Use `useActiveProject`
  for data views. Reserve `useProject`'s full membership list for the global
  switcher and project management. Coverage mutations reject a draft or row
  belonging to another project.
- **The notification log is scoped server-side.** `UserOnCallLog` grants read
  through the auto-granted `CurrentUser` permission, which the server converts
  into a `userId` row filter. The app neither sends nor can send a user id
  there.

The app identifies the signed-in user from the `userId` claim on the access
token (`src/auth/currentUser.ts`) rather than from the login response, because
a session restored on a cold start never produces one — and a null user id
there does not degrade the on-call screens, it inverts them.

## Push Notifications

Native push notifications (iOS/Android) are powered by Expo Push and require no server-side configuration. The mobile app registers an Expo Push Token with the backend on login. The backend sends notifications via the public Expo Push API.

Web push uses VAPID keys (configured separately). See the [Push Notifications docs](../App/FeatureSet/Docs/Content/en/self-hosted/push-notifications.md) for details.

### Critical on-call alerts

**Settings > Notifications > Critical On-Call Alerts** lets a responder have
on-call pages play a sound even when the handset is silenced or in Do Not
Disturb. It is per device and off by default, and only on-call pages are
escalated - never owner subscriptions or note-posted notices.

- **Android** uses the `oncall_critical` notification channel, which requests
  `bypassDnd` and plays on the alarm audio stream. The Do Not Disturb bypass
  needs the user to grant this app **Do Not Disturb access** in system
  settings; the app opens that screen when the switch is turned on. Channel
  settings are frozen by Android at creation, so changing them means shipping a
  new channel id, not editing `src/notifications/channels.ts`.
- **iOS** needs Apple's critical-alerts entitlement, which is **not** enabled by
  default because a build declaring an entitlement the Apple team has not been
  granted fails to sign. Once Apple grants it:

  ```bash
  EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT=true npm run prebuild
  ```

  or set `EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT: "true"` in the relevant
  `eas.json` build profile's `env`.

Without the OS capability the app does not pretend: the settings screen reads
the real state back from the OS and tells the responder which setting is
missing.

## Troubleshooting

- **"Network Error" on login**: Make sure your OneUptime server URL is correct and reachable from your device/emulator.
- **Expo Go can't connect**: Ensure your dev machine and phone are on the same Wi-Fi network. Try `npm start -- --tunnel` if direct connections don't work.
- **iOS build fails**: Run `npx expo prebuild --clean` then `npx expo run:ios`.
- **Android build fails**: Run `npx expo prebuild --clean` then `npx expo run:android`.
