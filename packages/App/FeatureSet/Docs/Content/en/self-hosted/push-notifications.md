# Push Notifications

Native push notifications (iOS/Android) are powered by **Expo Push**. Self-hosted instances use OneUptime's push relay by default and need outbound network access to it.

## How It Works

The OneUptime mobile app registers an Expo Push Token with the backend. The backend sends notifications through OneUptime's push relay, or directly to Expo when `EXPO_ACCESS_TOKEN` is configured. Expo forwards messages to Apple APNs or Google FCM for delivery to the device.

Web push notifications continue to use VAPID keys and the Web Push protocol.

## Self-Hosted Setup

No Expo credentials are required on the server when using the official mobile app and the default relay. For direct Expo delivery, configure `EXPO_ACCESS_TOKEN` with credentials appropriate for your app's Expo project. Web push requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.

## Network Access

| Direction | Destination | Protocol / port | When required |
| --- | --- | --- | --- |
| OneUptime → default push relay | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | Mobile push when `EXPO_ACCESS_TOKEN` is unset. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | Direct mobile push when `EXPO_ACCESS_TOKEN` is set. |
| OneUptime → browser push service | The HTTPS endpoint stored in the browser's push subscription | HTTPS / normally TCP 443 | Web push. |
| Mobile app or browser → OneUptime | Your OneUptime hostname | HTTPS / TCP 443 | Sign in, register the device and open notification links. |

If you change `PUSH_NOTIFICATION_RELAY_URL`, allow its destination hostname and configured port. A custom relay must implement OneUptime's relay API. These defaults and the switch between relay and direct delivery are defined in [OneUptime's configuration](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) and [push service](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts). Direct Expo requests use the endpoint documented in [Expo's sending guide](https://docs.expo.dev/push-notifications/sending-notifications/). OneUptime reads delivery receipts from the relay at the same address with `/receipts` in place of `/send`. A relay without that route still delivers pushes; a device whose app was removed is then noticed only when a later push to it is refused.

For web push, allow the actual subscription endpoint hosts for the browsers your team uses. OneUptime accepts `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` and `push.apple.com`, including their subdomains. Typical examples include `updates.push.services.mozilla.com` and `web.push.apple.com`. The [browser's push subscription](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) supplies the destination; allowing only Expo or OneUptime's relay does not enable web push.

Permit DNS resolution and outbound TLS from the OneUptime process that sends notifications. Its trust store must validate the destination's certificate, and proxies must pass API requests without interactive authentication. Push providers do not call a webhook on your OneUptime server, so the server can stay private when user devices can access it through a VPN or other private connection. A server with no access to its relay or external push services cannot deliver these notifications.

Device connectivity is a separate requirement. iOS devices need APNs access, typically TCP 5223 with TCP 443 fallback; consult [Apple's current network requirements](https://support.apple.com/en-us/102266) for destination ranges. Android devices need FCM access on TCP 5228–5230 and 443; use [Google's current host and firewall guidance](https://firebase.google.com/docs/cloud-messaging/network-configuration). These device ports do not need to be opened inbound on OneUptime, and the mobile server flow uses the relay or Expo rather than directly connecting to APNs/FCM.

Verify DNS and HTTPS connectivity from the notification sender's container or pod to the destination for the selected delivery mode. Then send a test from **User Settings > Notification Methods > Push** and confirm it arrives on a registered device. Test each browser separately for web push. Check relay, Expo or web-push errors in OneUptime logs; successful API submission alone does not confirm device delivery. For mobile pushes, OneUptime also reads Expo's delivery receipt about 15 minutes after each push: a push that never reached the device then shows as not delivered in the push log and, for an on-call page, on the on-call timeline.

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

The official **OneUptime On-Call** app on the App Store carries the
entitlement from **version 1.5.0**. Earlier versions do not, and iOS never
offers critical alerts to them, so update the app before turning the setting
on.

If you build the app yourself, the entitlement is opt-in. A provisioning
profile cannot carry an entitlement the team has not been granted, and a
build that declares one it cannot carry **fails to sign**. Only the
`production` profile in `packages/MobileApp/eas.json` turns it on, because
Apple has granted it to the team that publishes the official app. A fork that
signs with its own Apple team must remove that `env` entry until Apple grants
the entitlement to that team too. Once it has, turn it on when building:

```
EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT=true npx expo prebuild
```

or add `EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT: "true"` to the build profile's
`env` block in `packages/MobileApp/eas.json`.

On the device, turn on **Settings > Notifications > Critical On-Call Alerts**
in the app, and allow critical alerts when iOS asks. iOS adds a **Critical
Alerts** switch for the app under iOS **Settings > Notifications > OneUptime
On-Call** only after the app has asked for the permission, so that switch is
not there before you turn the setting on in the app. If you decline the
prompt, you can allow critical alerts later with that switch in iOS Settings.

On a build without the entitlement, iOS shows no prompt and no switch, and the
app's settings screen says that this version of the app cannot receive
critical alerts. It does not send the responder to look for a switch that
iOS is not showing.

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
- Check **User Settings > Notification Methods > Push**: a device marked **Not receiving notifications** stopped receiving them and has to be registered again (see below)

### No Critical Alerts switch in iOS Settings

- Update OneUptime On-Call from the App Store. Versions before 1.5.0 were
  built without Apple's critical alerts entitlement, and iOS shows no
  Critical Alerts switch for them at all
- Turn on **Settings > Notifications > Critical On-Call Alerts** in the app.
  iOS adds the switch to its own Settings only after the app has asked for the
  permission, and the app asks when this setting is turned on
- Removing and re-adding on-call notification rules or push devices does not
  change this. The setting belongs to the app on the device, not to a rule

### Critical alerts do not override silent mode

- Check the switch is on for **that** device - the setting is per device, and a
  reinstall or a new phone set up from scratch creates a new device
  registration (a phone set up from a backup of the old one takes over the old
  phone's registration once that no longer receives notifications, with the
  setting the app had)
- **iOS**: confirm the build carries Apple's critical alerts entitlement (see
  above), and that Critical Alerts is allowed under
  iOS Settings > Notifications > OneUptime On-Call
- **Android**: confirm the app has Do Not Disturb access under
  Settings > Notifications > Do Not Disturb access
- The settings screen states which of these is missing; it reads the current
  state back from the OS rather than trusting what the app last requested

### Pushes marked "not delivered"

Expo accepting a push does not mean it reached the device: Apple or Google can still refuse it. OneUptime reads each mobile push's delivery receipt about 15 minutes after sending it, through the push relay when `EXPO_ACCESS_TOKEN` is not set. When the receipt reports an error, the push log and the on-call timeline of the page change from sent to **Push notification not delivered**, with Expo's error code:

- `DeviceNotRegistered`: the mobile app was removed from the device, or its push token is no longer valid. See the next section.
- `MessageRateExceeded`: too many notifications were sent to the device in a short time. Later pushes to it are sent as usual.
- `MessageTooBig`: the notification was larger than push services accept. OneUptime shortens notifications to fit, so this should not happen; please report it if it does.
- `InvalidCredentials` or `MismatchSenderId`: the push credentials of the Expo project that sent the push are not valid. With `EXPO_ACCESS_TOKEN`, check your Expo project's push credentials; with the default relay, contact OneUptime support.

When Expo refuses a push outright, the push log gives the reason straight away. Through the push relay this works too: the relay passes on Expo's error code instead of answering with a server error.

### "DeviceNotRegistered" errors in logs

Expo reports `DeviceNotRegistered` when the mobile app was removed from the device or the device's push token is no longer valid. It usually says so in a push's delivery receipt, which OneUptime reads about 15 minutes after the push, and sometimes refuses the push outright. Either way OneUptime stops sending to that device. It is marked as not receiving notifications rather than deleted, so its notification rules stay, and the push log and the on-call timeline of the page that did not arrive say why. **User Settings > Notification Methods > Push** shows it as **Not receiving notifications**. Its owner's other devices and notification methods are still paged.

To bring the device back, open the mobile app on it while signed in. The app registers again, which renews its push token with Expo, and the device receives notifications again with its rules. If the app was removed, install it again and sign in. A receipt for a push sent before the app registered again does not mark the device. When an up-to-date mobile app is set up on a new phone from a backup of the old one, it tells OneUptime the push token it had before; if the old phone's device no longer receives notifications, the new phone takes it over with its rules.

Through the push relay (no `EXPO_ACCESS_TOKEN`) this works the same way: the relay reports `DeviceNotRegistered` when it sends a push, and reads the delivery receipts your instance asks it about.

## Support

If you encounter issues with push notifications, please:

1. Check the troubleshooting section above
2. Review the OneUptime logs for detailed error messages
3. Contact us at [hello@oneuptime.com](mailto:hello@oneuptime.com)
