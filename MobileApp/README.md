# OneUptime Mobile App

Expo + React Native mobile app for OneUptime on-call management.

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
ServerUrlScreen → LoginScreen → MainTabNavigator (Home, Incidents, Alerts, Settings)
```

- Access tokens are refreshed automatically on 401 responses.
- Logout clears all stored tokens and returns to the login screen.

## Tests

```bash
npm test
```

Jest with the `jest-expo` preset. Tests live next to the code they cover
(`src/**/*.test.ts[x]`); shared native-module mocks are in
`src/__tests__/setup.ts`.

## On-Call

The On-Call tab answers the three questions a responder actually has on a
handset, in this order:

1. **Am I on call, and until when?** The status card leads with a live
   countdown to the next handoff. It refuses to invent one: an escalation rule
   that names you directly has no shift window, so the card says "standing
   assignment — no scheduled handoff" rather than borrowing a boundary from an
   unrelated schedule.
2. **Who else is on?** _Who's On Call_ lists every schedule across every
   project with the person on it now, who is next, and when they swap.
   Schedules with **nobody** on call are pulled to the top — they are the only
   rows on that screen that are a problem.
3. **Can somebody take this?** _Cover for me_ creates a project-wide
   `OnCallDutyPolicyUserOverride` that starts now and runs for a preset number
   of hours. The same sheet works in reverse ("I'll take over") for picking up
   a teammate's pages.

Two supporting screens round it out: **Overrides**, which splits cover
arrangements into in-effect / scheduled / ended and can cancel one, and
**Pages Sent To Me**, the notification log filtered down to what was never
acknowledged.

### Where the data comes from

| Screen                            | Endpoint                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| Duty status, standing assignments | `GET /api/on-call-duty-policy/current-on-duty-escalation-policies`                           |
| Shifts, roster, handoff times     | `POST /api/on-call-duty-policy-schedule/get-list`                                            |
| Overrides                         | `POST /api/on-call-duty-policy-user-override/get-list`, `POST`/`DELETE` on the same resource |
| Teammate picker                   | `POST /api/team-member/get-list`                                                             |
| Pages sent to me                  | `POST /api/user-notification-log/get-list`                                                   |

Two things about that table are worth knowing before changing this code:

- **Shift boundaries only exist on the schedule roster.** `rosterHandoffAt`,
  `rosterStartAt`, `rosterNextStartAt` and `rosterNextHandoffAt` are the only
  place the server says when a shift ends. The assignments endpoint knows
  _whether_ you are on duty (and accounts for overrides); it says nothing about
  when it stops.
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

Web push uses VAPID keys (configured separately). See the [Push Notifications docs](../Docs/Content/self-hosted/push-notifications.md) for details.

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
