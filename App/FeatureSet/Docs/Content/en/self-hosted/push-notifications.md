# Push Notifications

Native push notifications (iOS/Android) are powered by **Expo Push** and require **no server-side configuration** for self-hosted instances.

## How It Works

The OneUptime mobile app registers an Expo Push Token with the backend. When the backend needs to send a notification it POSTs to the public Expo Push API, which routes the message to Apple APNs or Google FCM on behalf of the app.

Web push notifications continue to use VAPID keys and the Web Push protocol.

## Self-Hosted Setup

No push notification configuration is required. The mobile app binary handles all platform registration automatically via Expo's push infrastructure.

## Critical On-Call Alerts (Overriding Silent Mode)

By default a push notification obeys the handset: a phone on silent stays
silent, and Do Not Disturb holds the notification back. For an on-call
responder that is the wrong default at 3am, so the mobile app offers a
per-device setting - **Settings > Notifications > Critical On-Call Alerts** -
that lets *on-call pages only* play a sound through both.

The scope is deliberately narrow. Only pages produced by an on-call
notification rule are eligible. Owner subscriptions, note-posted notices,
status-change updates and monitor notifications are never escalated, whatever
this setting says.

Three things must all be true for a page to override silent mode. If any one
is missing, the page is still delivered - just quietly.

1. **The responder turned it on for that device.** Stored per device, off by
   default, in `UserPush.isCriticalAlertEnabled`. A responder's phone and their
   tablet are separate decisions.
2. **The server marks the page critical.** It sends the APNs critical sound
   payload plus `interruptionLevel: critical` for iOS, and targets the
   `oncall_critical` notification channel for Android.
3. **The operating system allows it**, which is where the two platforms differ.

### iOS: Apple's critical alerts entitlement

Critical alerts on iOS require the
`com.apple.developer.usernotifications.critical-alerts` entitlement, which
Apple grants per developer account, on request, for apps that notify people
about urgent events. Request it at
[Apple's Critical Alerts request form](https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/).

Because a provisioning profile cannot carry an entitlement the team has not
been granted - and a build that declares one it cannot carry **fails to
sign** - the entitlement is **not** enabled in this repository by default.
Once Apple has granted it to your team, turn it on when building:

```
EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT=true npx expo prebuild
```

or add `EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT: "true"` to the build profile's
`env` block in `MobileApp/eas.json`.

Without the entitlement the app still behaves correctly: iOS declines to grant
the permission, and the settings screen tells the responder so rather than
showing a switch that does nothing.

### Android: Do Not Disturb access

Android has no vendor approval step, but Do Not Disturb bypass is granted by
the user on a system screen rather than by an in-app prompt. When a responder
turns the setting on, the app opens
**Settings > Notifications > Do Not Disturb access** for them and re-checks when
they return.

Two mechanisms are in play, and they cover different cases:

- The `oncall_critical` notification channel requests `bypassDnd`, which covers
  Do Not Disturb and needs the access described above.
- The same channel uses the **alarm** audio stream, which is audible on a phone
  whose ringer is simply muted. That half needs no permission at all.

Android freezes a channel's settings when the channel is first created, so
these cannot be changed by an app update - only by shipping a new channel id.

### Verifying it works

Send a test notification to the device from
**User Settings > Notification Methods > Push**. When the device has critical
alerts enabled, the test is sent as a critical alert too - so silence the phone
first, and you will hear whether a real page would reach you.

## Troubleshooting

### Push notifications not arriving

- Ensure the mobile app was built with EAS Build (Expo Go does not support push notifications)
- Verify the device is registered in the `UserPush` table in your database
- Check OneUptime server logs for Expo Push API errors
- Confirm the device has an active internet connection and notification permissions enabled

### Critical alerts do not override silent mode

- Check the switch is on for **that** device - the setting is per device, and a
  reinstall or a new push token creates a new device registration
- **iOS**: confirm the build carries Apple's critical alerts entitlement (see
  above), and that Critical Alerts is allowed under
  iOS Settings > Notifications > OneUptime On-Call
- **Android**: confirm the app has Do Not Disturb access under
  Settings > Notifications > Do Not Disturb access
- The settings screen states which of these is missing; it reads the current
  state back from the OS rather than trusting what the app last requested

### "DeviceNotRegistered" errors in logs

The Expo Push Token is no longer valid. This usually means the app was uninstalled or the user revoked notification permissions. The token will be cleaned up automatically.

## Support

If you encounter issues with push notifications, please:

1. Check the troubleshooting section above
2. Review the OneUptime logs for detailed error messages
3. Contact us at [hello@oneuptime.com](mailto:hello@oneuptime.com)
