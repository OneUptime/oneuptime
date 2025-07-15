# Push Notification Implementation for OneUptime

This implementation adds push notification support to OneUptime's on-call alert system, following the existing patterns for email, SMS, and phone notifications.

## Components Implemented

### 1. Database Layer
- **UserPush.ts** - Database model for storing user push notification device registrations
- **UserNotificationSetting.ts** - Updated to include `alertByPush` field
- **UserNotificationRule.ts** - Updated to include UserPush relationships

### 2. Service Layer
- **UserPushService.ts** - Service for managing push notification devices (CRUD operations, verification)
- **PushNotificationService.ts** - Core service for sending push notifications via:
  - Web Push API (for browsers)
  - Firebase Cloud Messaging (for mobile apps)
- **PushNotificationUtil.ts** - Utility class for creating notification messages for different event types

### 3. Type Definitions
- **PushNotificationMessage.ts** - Interface for push notification content
- **PushNotificationRequest.ts** - Interface for push notification requests

### 4. API Layer
- **UserPushAPI.ts** - REST API endpoints for:
  - Device registration (`POST /user-push/register`)
  - Test notifications (`POST /user-push/:deviceId/test-notification`)
  - Device verification (`POST /user-push/:deviceId/verify`)

### 5. Frontend Components
- **Push.tsx** - React component for managing push notification devices
- **NotificationMethods.tsx** - Updated to include push notification management
- **sw.js** - Service worker for handling web push notifications

### 6. Job Integration
- **SendCreatedResourceNotification.ts** - Example of how to add push notifications to existing notification jobs

## Setup Requirements

### Dependencies
Add to `Common/package.json`:
```json
{
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "web-push": "^3.6.7"
  }
}
```

### Environment Variables
```bash
# Web Push (VAPID) Configuration
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
VAPID_SUBJECT=mailto:support@oneuptime.com

# Firebase Configuration (for mobile)
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}

# Frontend Configuration
REACT_APP_VAPID_PUBLIC_KEY=your_vapid_public_key
```

### Database Migration
The UserPush table will be automatically created when the service starts due to TypeORM's synchronization.

## Features

### Device Registration
- Automatic device detection (web, Android, iOS)
- Support for multiple devices per user
- Automatic permission handling

### Notification Types
- **Incident notifications** - Created, state changes, notes
- **Alert notifications** - Created, state changes 
- **Monitor notifications** - Status changes
- **Scheduled maintenance** - Created, state changes
- **Test notifications** - Manual testing capability

### Multi-Platform Support
- **Web browsers** - Chrome, Firefox, Safari, Edge via Web Push API
- **Mobile devices** - Android and iOS via Firebase Cloud Messaging
- **Desktop applications** - Through browser or native app integration

### Security Features
- User-scoped device access (users can only manage their own devices)
- Device verification system
- Automatic cleanup of invalid/expired tokens
- Rate limiting and spam protection

## Usage Examples

### For Users
1. Navigate to User Settings > Notification Methods
2. Click "Register Device" in the Push Notifications section
3. Grant notification permissions when prompted
4. Test notifications using the "Test Notification" button

### For Developers
```typescript
// Send push notification to a user
await PushNotificationService.sendPushNotificationToUser(
  userId,
  projectId,
  {
    title: "New Incident Created",
    body: "Incident #123 needs your attention",
    clickAction: "/dashboard/incidents/123",
    requireInteraction: true,
  }
);

// Send to specific devices
await PushNotificationService.sendPushNotification({
  deviceTokens: ["token1", "token2"],
  message: notificationMessage,
  deviceType: "web",
});
```

## Integration with Existing Notification Jobs

To add push notifications to existing notification jobs, update the `sendUserNotification` calls to include a `pushNotificationMessage`:

```typescript
await UserNotificationSettingService.sendUserNotification({
  userId: user.id!,
  projectId: projectId,
  emailEnvelope: emailMessage,
  smsMessage: smsMessage,
  callRequestMessage: callMessage,
  pushNotificationMessage: pushMessage, // Add this line
  eventType: NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
});
```

## Browser Compatibility

- **Chrome** 50+ (full support)
- **Firefox** 44+ (full support)
- **Safari** 16+ (full support)
- **Edge** 17+ (full support)
- **Mobile browsers** - varies by platform

## Performance Considerations

- Push notifications are sent asynchronously to avoid blocking
- Failed notifications are logged but don't block other notification channels
- Device tokens are automatically cleaned up when they become invalid
- Rate limiting prevents notification spam

## Security Considerations

- VAPID keys should be kept secure and rotated periodically
- Firebase service account credentials should be stored securely
- Device tokens are encrypted in transit
- User permissions are verified for all API operations
- Device registration requires user authentication

## Monitoring and Debugging

- All push notification operations are logged
- Failed notifications include error details for debugging
- Test notification functionality helps verify device setup
- Device "last used" timestamp tracks successful deliveries

## Future Enhancements

- **Rich notifications** - Images, action buttons, progress indicators
- **Notification scheduling** - Delayed and recurring notifications
- **Analytics** - Delivery rates, click-through rates, engagement metrics
- **A/B testing** - Different notification formats and content
- **Notification preferences** - Fine-grained control over notification types
- **Mobile app support** - Native iOS and Android apps via Firebase SDK
