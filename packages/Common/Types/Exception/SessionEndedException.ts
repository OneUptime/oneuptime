import NotAuthenticatedException from "./NotAuthenticatedException";
import { SessionEndReason } from "../UserSession/SessionLength";

/*
 * A session the server's session lengths have ended (Types/UserSession/
 * SessionLength.ts): its sign-in has lasted as long as the server lets one
 * last, or its person has not used OneUptime for as long as it allows. A
 * 401, as for every session that is over, with what to do. POST
 * /refresh-token answers it, and the Dashboard tells its reason by the
 * message (getReason), as it tells a blocked project's 403
 * (ProjectBlockedException): the sign-in page then says why the person
 * was signed out.
 */
export const SESSION_ENDED_MESSAGES: Readonly<
  Record<SessionEndReason, string>
> = {
  [SessionEndReason.LengthReached]:
    "Your sign-in has lasted as long as this server allows. Please sign in again.",
  [SessionEndReason.Inactive]:
    "You were signed out after a period without activity. Please sign in again.",
};

export default class SessionEndedException extends NotAuthenticatedException {
  public readonly reason: SessionEndReason;

  public constructor(reason: SessionEndReason) {
    super(SESSION_ENDED_MESSAGES[reason]);
    this.reason = reason;
  }

  // The reason a 401's message says a session ended for, or null for any other 401.
  public static getReason(errorMessage: unknown): SessionEndReason | null {
    for (const reason of Object.keys(
      SESSION_ENDED_MESSAGES,
    ) as Array<SessionEndReason>) {
      if (SESSION_ENDED_MESSAGES[reason] === errorMessage) {
        return reason;
      }
    }

    return null;
  }
}
