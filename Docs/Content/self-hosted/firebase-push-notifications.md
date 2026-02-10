# Push Notifications

Native push notifications (iOS/Android) are powered by **Expo Push** and require **no server-side configuration** for self-hosted instances.

## How It Works

The OneUptime mobile app registers an Expo Push Token with the backend. When the backend needs to send a notification it POSTs to the public Expo Push API, which routes the message to Apple APNs or Google FCM on behalf of the app.

Web push notifications continue to use VAPID keys and the Web Push protocol.

## Self-Hosted Setup

No push notification configuration is required. The mobile app binary handles all platform registration automatically via Expo's push infrastructure.

## Troubleshooting

### Push notifications not arriving

- Ensure the mobile app was built with EAS Build (Expo Go does not support push notifications)
- Verify the device is registered in the `UserPush` table in your database
- Check OneUptime server logs for Expo Push API errors
- Confirm the device has an active internet connection and notification permissions enabled

### "DeviceNotRegistered" errors in logs

The Expo Push Token is no longer valid. This usually means the app was uninstalled or the user revoked notification permissions. The token will be cleaned up automatically.

## Support

If you encounter issues with push notifications, please:

1. Check the troubleshooting section above
2. Review the OneUptime logs for detailed error messages
3. Contact us at [hello@oneuptime.com](mailto:hello@oneuptime.com)
