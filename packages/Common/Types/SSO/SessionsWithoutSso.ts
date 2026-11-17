import { JSONObject } from "../JSON";

/*
 * PEOPLE SIGNED IN WITHOUT SSO, WHILE THE WHOLE SERVER REQUIRES IT (#6116).
 *
 * Turning on Require SSO to Sign In (Admin Dashboard > Settings > Single
 * Sign-On) keeps everyone but master admins out of every project until they
 * sign in with SSO, but it ends nobody's session: whoever signed in with a
 * password, a passkey or Sign in with Microsoft before stays signed in to
 * their account, and their session renews. While SSO is required the card
 * says how many people that is, and a master admin can sign them all out at
 * once - their sessions and refresh tokens ended on the server
 * (UserSessionService.endSessionsSignedInWithoutSso). Master admins are never
 * among them. Both routes are master admins' only, under "/api":
 *
 *   GET  /global-config/sessions-without-sso      -> { peopleCount }
 *   POST /global-config/sessions-without-sso/end  -> { sessionsEnded }
 *
 * The second is refused while SSO is not required: they would sign in
 * again with their password at once.
 */

export const SESSIONS_WITHOUT_SSO_ROUTE: string =
  "/global-config/sessions-without-sso";

export const END_SESSIONS_WITHOUT_SSO_ROUTE: string =
  "/global-config/sessions-without-sso/end";

export const SIGN_OUT_WITHOUT_SSO_NEEDS_SSO_REQUIRED_MESSAGE: string =
  "Single sign-on is not required, so people signed in with a password would sign in again with it at once. Turn on Require SSO to Sign In first.";

export interface SessionsWithoutSsoAnswer {
  // How many people, not master admins, have a session that did not sign in with SSO.
  peopleCount: number;
}

export interface EndSessionsWithoutSsoAnswer {
  // How many sessions were ended.
  sessionsEnded: number;
}

const readCount: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
};

// The count route's answer, or null for anything it would not answer.
export const readSessionsWithoutSsoAnswer: (
  answer: unknown,
) => SessionsWithoutSsoAnswer | null = (
  answer: unknown,
): SessionsWithoutSsoAnswer | null => {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    return null;
  }

  const peopleCount: number | null = readCount(
    (answer as JSONObject)["peopleCount"],
  );

  return peopleCount === null ? null : { peopleCount };
};
