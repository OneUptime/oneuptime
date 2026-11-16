import axios from "axios";

/*
 * WHY THE SERVER ENDED THE SESSION (issue #8381).
 *
 * A master admin can end sign-ins after a set time, after a while without
 * use, or both (Admin Dashboard > Settings > Session Length). The server
 * decides at each renewal of the session (POST /identity/refresh-token),
 * and when it ends one it refuses the renewal with a 401 whose message
 * says why: SessionEndedException in Common/Types/Exception, one message
 * per reason (SESSION_ENDED_MESSAGES). The Dashboard reads the reason from
 * that message (SessionEndedException.getReason) and its sign-in page says
 * why the person was signed out; so does the app's, which otherwise drops
 * an on-call person on the sign-in screen with nothing to tell a server's
 * rule from a bug.
 *
 * The app imports nothing from Common at run time, so the reasons and the
 * messages are copied here, and src/auth/sessionEnded.test.ts holds them to
 * Common's word for word.
 */

// Why a session ended (Common/Types/UserSession/SessionLength.ts SessionEndReason).
export type SessionEndReason = "length-reached" | "inactive";

export const SESSION_END_REASONS: ReadonlyArray<SessionEndReason> = [
  "length-reached",
  "inactive",
];

// What the server's refusal says for each reason (SESSION_ENDED_MESSAGES).
export const SESSION_ENDED_MESSAGES: Readonly<
  Record<SessionEndReason, string>
> = {
  "length-reached":
    "Your sign-in has lasted as long as this server allows. Please sign in again.",
  inactive:
    "You were signed out after a period without activity. Please sign in again.",
};

/*
 * What the sign-in screen says for each reason, above the form: why the
 * person is there. It is the sign-in screen, so not "Sign in again".
 */
export const SESSION_ENDED_NOTICES: Readonly<Record<SessionEndReason, string>> =
  {
    "length-reached":
      "You were signed out because your sign-in lasted as long as this server allows.",
    inactive: "You were signed out after a while without use.",
  };

// The reason a refusal's message says a session ended for, or null for any other message.
export function getSessionEndReason(message: unknown): SessionEndReason | null {
  for (const reason of SESSION_END_REASONS) {
    if (SESSION_ENDED_MESSAGES[reason] === message) {
      return reason;
    }
  }

  return null;
}

/*
 * The reason the server gave for refusing a renewal, or null: a 401 whose
 * body's message is one of SESSION_ENDED_MESSAGES. Any other failure - a
 * refresh token that ran out, a session signed out elsewhere, no answer at
 * all - says no reason.
 */
export function getSessionEndReasonOfRefusal(
  failure: unknown,
): SessionEndReason | null {
  if (!axios.isAxiosError(failure) || failure.response?.status !== 401) {
    return null;
  }

  const body: unknown = failure.response.data;

  if (!body || typeof body !== "object") {
    return null;
  }

  return getSessionEndReason((body as Record<string, unknown>)["message"]);
}
