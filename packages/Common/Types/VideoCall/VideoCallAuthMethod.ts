/*
 * How a video call connection signs in to its provider. Stored on
 * VideoCallConnection.authMethod.
 *
 * OAuth is the one-click Connect: someone signs in to Zoom, Google or
 * Microsoft and allows this server's own app (ZOOM_APP_CLIENT_ID,
 * GOOGLE_MEET_APP_CLIENT_ID, MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID) to
 * create meetings as that account. OneUptime keeps the account's refresh
 * token and every meeting is created as that account. Nothing has to be
 * set up on the provider's side.
 *
 * AppCredentials is a project's own app: a Zoom Server-to-Server OAuth app, a
 * Google service account with domain-wide delegation, a Microsoft Entra app
 * registration. Its settings and credentials come from the connection form.
 *
 * A connection stored before the column existed, and a standing meeting
 * link, have none. Both are read as app credentials (isOAuth is false).
 */
enum VideoCallAuthMethod {
  OAuth = "OAuth",
  AppCredentials = "AppCredentials",
}

export default VideoCallAuthMethod;

export function isVideoCallOAuth(value: unknown): boolean {
  return value === VideoCallAuthMethod.OAuth;
}
