# OneUptime Mobile and Desktop Apps

OneUptime offers two ways to use the platform outside of your browser:

- **Native mobile apps** for iOS and Android, published to the **Apple App Store** and **Google Play**. These deliver on-call pages, incident alerts, and acknowledgement actions directly to your phone.
- **Installable desktop apps** for Windows, macOS, and Linux, delivered as a Progressive Web App (PWA) installed directly from your browser. These give the OneUptime dashboard its own window, icon, and notification surface on your computer.

## Mobile (Native Apps)

The **OneUptime On-Call** app is a native application built with React Native. It is distributed through the official stores so you get automatic updates, push notifications, and biometric unlock.

- **iOS** — [Download on the App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391). Requires iOS 15.0 or later. See the [iOS Installation Guide](./ios-installation.md).
- **Android** — [Get it on Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Requires Android 8.0 or later. A direct [APK download](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) is also available for devices without Google Play. See the [Android Installation Guide](./android-installation.md).

## Desktop (Progressive Web App)

OneUptime's web dashboard is a Progressive Web App, so you can install it as a desktop application from a modern browser without going through any store.

- [Windows Installation](./windows-installation.md)
- [macOS Installation](./macos-installation.md)
- [Linux Installation](./linux-installation.md)

### Desktop Getting Started

1. Open your OneUptime instance in a Chromium-based browser (Chrome, Edge) or Safari.
2. Look for the **Install** button in the address bar or in **File → Add to Dock / Apps → Install this site as an app**.
3. Launch the installed app from your Start Menu, Launchpad, or applications launcher.

### Desktop Troubleshooting

**Install option not appearing:**
- Make sure you are using a supported browser.
- Confirm your OneUptime instance is served over HTTPS.
- Refresh the page or clear your browser cache.

**Push notifications not working:**
- Grant notification permissions when prompted by the browser.
- Check your operating system's notification settings for the browser.
- Self-hosted users: confirm push notifications are configured on your OneUptime instance.

## Support

- Mobile-specific issues: check the [iOS](./ios-installation.md) or [Android](./android-installation.md) installation guides.
- Desktop-specific issues: check the [Windows](./windows-installation.md), [macOS](./macos-installation.md), or [Linux](./linux-installation.md) installation guides.
- General questions: see the [FAQ & Troubleshooting](./faq-troubleshooting.md) page.
- File bugs or feature requests on our [GitHub repository](https://github.com/OneUptime/oneuptime).
