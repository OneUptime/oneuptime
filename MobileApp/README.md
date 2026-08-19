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
│   ├── hooks/         # Auth hook / context
│   ├── navigation/    # React Navigation (auth stack, main tabs)
│   ├── screens/       # Screen components (auth, home, incidents, alerts, settings)
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
