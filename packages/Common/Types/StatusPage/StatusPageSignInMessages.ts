/*
 * What the server tells a private status page's reader about signing in.
 * Shared with the status page, which says each one in the reader's language
 * (StatusPage/src/Utils/ServerMessageWords.ts, locale keys serverMessages.*).
 * They say "sign in", the name the status page's own pages use (#9132,
 * #9212); they used to say "Please login".
 */

// A private page asked for by somebody who is not signed in to it.
export const STATUS_PAGE_SIGN_IN_TO_VIEW_MESSAGE: string =
  "You do not have access to this status page. Please sign in to view it.";

// The session behind the reader's refresh cookie has ended, or is not this page's.
export const STATUS_PAGE_SESSION_EXPIRED_MESSAGE: string =
  "Session expired. Please sign in again.";

// The reader's browser sent no refresh cookie at all.
export const STATUS_PAGE_SIGNED_OUT_MESSAGE: string =
  "You are signed out. Please sign in again.";
