# FAQ and Troubleshooting

Frequently asked questions and solutions for the OneUptime mobile and desktop apps.

## How does OneUptime distribute its apps?

- **Mobile (iOS and Android):** OneUptime ships a native app called **OneUptime On-Call**. It is published to the [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) and [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). A signed [APK download](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) is also available for Android devices without Google Play.
- **Desktop (Windows, macOS, Linux):** The OneUptime web dashboard is a Progressive Web App (PWA). You can install it as a desktop application directly from a Chromium-based browser or Safari — no store account required.

## Mobile App FAQ

### Which devices are supported?

- **iOS:** iPhone or iPad running iOS 15.0 or later.
- **Android:** Phones and tablets running Android 8.0 (Oreo) or later.

### Is the app free?

Yes. The OneUptime On-Call app is free to install. You sign in with your existing OneUptime account.

### Can I use the app with a self-hosted OneUptime instance?

Yes. On first launch, the app asks for a **Server URL**. Enter the URL of your self-hosted instance (for example, `https://oneuptime.example.com`). The app validates that the server is reachable before letting you sign in.

For push notifications on self-hosted instances, follow the [Push Notifications](/docs/self-hosted/push-notifications) guide.

### How are updates delivered?

- **iOS:** Through the App Store. Enable automatic updates in **Settings → App Store**, or update manually from your App Store profile.
- **Android (Google Play):** Automatic updates are enabled by default.
- **Android (APK sideload):** Download and install the latest APK from the GitHub Releases link above.

### Why don't I receive push notifications?

Mobile push uses APNs (iOS) and FCM (Android) via Expo Push. Check the following:

1. Notifications are enabled at the OS level for **OneUptime On-Call**.
2. Battery optimisation is disabled and background activity is allowed (Android).
3. Do Not Disturb or Focus modes are off, or the app is on the exception list.
4. You are signed in — the push token is registered with the server only after you sign in.
5. **Self-hosted only:** Push notifications are configured on your OneUptime instance. See the [Push Notifications](/docs/self-hosted/push-notifications) guide.

### Is the data on my phone secure?

- All API traffic uses HTTPS.
- Access and refresh tokens are stored in the device's secure keystore (Keychain on iOS, Keystore on Android).
- You can require Face ID / Touch ID / fingerprint unlock from the in-app **Settings** screen.

### Can I install the app on multiple devices?

Yes. Sign in with the same OneUptime account on as many devices as you need. Each device receives its own push notifications.

### How do I uninstall?

- **iOS:** Long-press the icon → **Remove App** → **Delete App**.
- **Android:** Long-press the icon → **Uninstall**, or **Settings → Apps → OneUptime On-Call → Uninstall**.

Your OneUptime account and data are stored on the server and are not removed when you uninstall the app.

## Desktop App (PWA) FAQ

### What is a Progressive Web App (PWA)?

A Progressive Web App is a web application that can be installed like a native desktop app. Once installed, it runs in its own window, has its own icon in your launcher, and can deliver desktop notifications — without going through Windows Store, Mac App Store, or any other distribution channel.

### Why does the desktop app use PWA technology?

- **Instant updates** — the app stays in sync with your OneUptime instance the moment you deploy.
- **No store account required** — install directly from any modern browser.
- **Single codebase** — the same dashboard runs on Windows, macOS, and Linux.

### Why isn't the "Install" button appearing?

1. Use a Chromium-based browser (Chrome, Edge, Brave, Arc) or Safari (macOS Sonoma+).
2. Confirm your OneUptime instance is served over HTTPS with a valid certificate.
3. Clear your browser cache and reload.
4. The app may already be installed — check your Applications / Start Menu.

### How do I update the desktop app?

The PWA updates automatically whenever you open it while online. To force an update, refresh the window with **Ctrl+R** (Windows/Linux) or **Cmd+R** (macOS).

### How do I uninstall the desktop PWA?

- **Windows:** **Settings → Apps → OneUptime → Uninstall**, or right-click the Start Menu entry.
- **macOS:** Drag the app from **Applications** to the Trash, or right-click the Dock icon and choose **Remove**.
- **Linux:** Use your application launcher's uninstall option, or remove the relevant `.desktop` file.

## Troubleshooting

### Mobile App Issues

**App won't sign in / "Network Error":**
- Confirm the **Server URL** is correct and reachable from your phone.
- Check that your phone is connected to the internet.
- For self-hosted instances behind a VPN, ensure the VPN is active.

**Push notifications delayed or missing (Android):**
- Disable battery optimisation: **Settings → Apps → OneUptime On-Call → Battery → Unrestricted**.
- Disable Data Saver for the app.
- On Samsung devices, turn off **Device care → Battery → Background usage limits** for OneUptime On-Call.

**Push notifications delayed or missing (iOS):**
- Avoid Force-Quitting the app — iOS may pause background delivery.
- Disable Low Power Mode while you are on-call.
- Add OneUptime On-Call to any active Focus mode's allow list.

**Face ID / Touch ID / fingerprint not working:**
- Make sure biometrics are enrolled in your OS settings.
- Re-enable biometric unlock from the **Settings** screen inside the OneUptime On-Call app.

### Desktop App (PWA) Issues

**Install button missing:**
- Use a supported browser (Chromium-based or Safari on macOS Sonoma+).
- Ensure the OneUptime instance is served over HTTPS.
- Wait for the page to finish loading, then check the address bar for the install icon.

**Desktop notifications not appearing:**
- Allow notifications when the browser prompts you.
- Check OS notification settings (Windows Focus Assist, macOS Notifications, Linux notification daemon).
- For self-hosted instances, ensure the [Push Notifications](/docs/self-hosted/push-notifications) configuration is complete.

**App not showing latest data:**
- Refresh with **Ctrl+R** / **Cmd+R**.
- Close and reopen the window.
- Check your network connection.

## Support

If you still need help:

- Mobile: see the [iOS](./ios-installation.md) or [Android](./android-installation.md) installation guides.
- Desktop: see the [Windows](./windows-installation.md), [macOS](./macos-installation.md), or [Linux](./linux-installation.md) installation guides.
- Open an issue on the [OneUptime GitHub repository](https://github.com/OneUptime/oneuptime).
- Contact support through your OneUptime dashboard.
