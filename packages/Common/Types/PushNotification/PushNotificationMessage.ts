interface PushNotificationMessage {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: { [key: string]: any };
  tag?: string;
  requireInteraction?: boolean;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
  clickAction?: string;
  url?: string;
  /*
   * Ask the handset to ring even when it is silenced or in Do Not Disturb.
   * Reserved for on-call pages: a responder who has opted their device in has
   * decided that being woken is the point. Everything else - owner
   * subscriptions, note-posted, test pings - leaves this unset and respects
   * the ringer switch like a normal notification.
   *
   * Honouring it is a three-way handshake, and all three have to agree or the
   * page arrives silently:
   *   - the responder opts THIS device in (UserPush.isCriticalAlertEnabled),
   *   - the server stamps the flag onto the payload (PushNotificationService),
   *   - the OS lets it through (iOS critical-alert entitlement, or an Android
   *     channel granted Do Not Disturb access).
   */
  isCriticalAlert?: boolean;
}

export default PushNotificationMessage;
