import UserSessionService from "../../../Server/Services/UserSessionService";

/*
 * EVERY SESSION A TEST'S ACCESS TOKENS NAME IS LIVE.
 *
 * Every request's session is checked live (#9534): UserMiddleware
 * .readRequestSession asks UserSessionService.isSessionLive whether the
 * session its access token names is still on - one read of the session
 * table, kept per server. A test that signs a token for a made-up session
 * and is about something else - permissions, SSO, a route - has no session
 * table to read, so it treats every session as live, as it treats the
 * person as not blocked (UserService.isUserBlocked). What an ended session
 * does is EndedSessionAccessToken.test.ts and UserSessionLiveSessions.test.ts.
 */
export function treatEverySessionAsLive(): jest.SpyInstance {
  return jest
    .spyOn(UserSessionService, "isSessionLive")
    .mockResolvedValue(true);
}
