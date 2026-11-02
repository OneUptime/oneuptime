import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import SessionEndedException, {
  SESSION_ENDED_MESSAGES,
} from "../../../Types/Exception/SessionEndedException";
import { SessionEndReason } from "../../../Types/UserSession/SessionLength";
import { describe, expect, test } from "@jest/globals";

/*
 * A session the server's session lengths ended: what POST /refresh-token
 * answers it with, and how the Dashboard reads the reason back from the
 * 401's message to say it on the sign-in page.
 */

const REASONS: Array<SessionEndReason> = [
  SessionEndReason.LengthReached,
  SessionEndReason.Inactive,
];

describe("SessionEndedException", () => {
  test.each(REASONS)(
    "is a 401 like every session that is over (%s)",
    (reason: SessionEndReason) => {
      const exception: SessionEndedException = new SessionEndedException(
        reason,
      );

      expect(exception).toBeInstanceOf(NotAuthenticatedException);
      expect(exception.code).toBe(ExceptionCode.NotAuthenticatedException);
      expect(exception.reason).toBe(reason);
      expect(exception.message).toBe(SESSION_ENDED_MESSAGES[reason]);
    },
  );

  test("each reason has its own message, which says to sign in again", () => {
    expect(new Set(Object.values(SESSION_ENDED_MESSAGES)).size).toBe(
      REASONS.length,
    );

    for (const reason of REASONS) {
      expect(SESSION_ENDED_MESSAGES[reason]).toContain("Please sign in again.");
    }
  });

  test.each(REASONS)(
    "its message reads back as its reason (%s)",
    (reason: SessionEndReason) => {
      expect(
        SessionEndedException.getReason(
          new SessionEndedException(reason).message,
        ),
      ).toBe(reason);
    },
  );

  test("any other 401's message is no reason", () => {
    for (const message of [
      "Session expired. Please login again.",
      "AccessToken is invalid or expired. Please refresh your token.",
      "Refresh token missing. Please login again.",
      "",
      undefined,
      null,
      401,
      {},
    ]) {
      expect(SessionEndedException.getReason(message)).toBeNull();
    }
  });

  test("a message must be exact to count: a lookalike or a padded one is no reason", () => {
    const message: string = SESSION_ENDED_MESSAGES[SessionEndReason.Inactive];

    expect(SessionEndedException.getReason(` ${message}`)).toBeNull();
    expect(SessionEndedException.getReason(message.toUpperCase())).toBeNull();
  });
});
