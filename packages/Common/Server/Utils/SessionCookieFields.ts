import ObjectID from "../../Types/ObjectID";
import type { SessionMetadata } from "../Services/UserSessionService";

/*
 * What a session's cookies are set from (CookieUtil.setUserCookie), as the
 * session service hands a session over when it makes or renews one: its id
 * and refresh token, and what its access token says and how long it lives
 * (SessionMetadata) - when it signed in and when its person was last
 * active, which the server's session lengths are asked against on every
 * request (Common/Types/UserSession/SessionLength.ts), and 15 minutes or
 * less, so the token never outlives the session.
 */
export interface SessionCookieFields {
  sessionId: ObjectID;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  accessTokenExpiresInSeconds: number;
  signedInAt: Date;
  lastActiveAt: Date;
}

// The fields setUserCookie takes from a session the session service just made or renewed.
export const getSessionCookieFields: (
  sessionMetadata: SessionMetadata,
) => SessionCookieFields = (
  sessionMetadata: SessionMetadata,
): SessionCookieFields => {
  return {
    sessionId: sessionMetadata.session.id!,
    refreshToken: sessionMetadata.refreshToken,
    refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
    accessTokenExpiresInSeconds: sessionMetadata.accessTokenExpiresInSeconds,
    signedInAt: sessionMetadata.signedInAt,
    lastActiveAt: sessionMetadata.lastActiveAt,
  };
};
