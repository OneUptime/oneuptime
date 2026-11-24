import { describe, expect, test } from "@jest/globals";
import {
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS,
  SignInAgainRefusal,
  judgeSignInAgain,
} from "../../../Types/Accounts/Reauthentication";

/*
 * WHAT A SIGN-IN THAT SIGN IN AGAIN STARTED PROVES (#10217).
 *
 * Every sign-in route holds what its identity provider said - the SAML
 * assertion's AuthnInstant, the ID token's auth_time - to the moment Sign
 * In Again sent the person there, with this one rule: it confirms the
 * session only when the provider says it authenticated them at or after
 * that moment, give or take the skew between the two clocks, and inside
 * the window; it is refused as a reused session when the provider says it
 * authenticated them before; and for saying nothing usable when it says
 * nothing, or a time that has not happened yet. It never trusts that the
 * provider honoured the request.
 */

const SECOND_IN_MS: number = 1000;
const MINUTE_IN_MS: number = 60 * SECOND_IN_MS;
const SKEW_IN_MS: number = SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS * SECOND_IN_MS;
const WINDOW_IN_MS: number = REAUTHENTICATION_WINDOW_IN_MINUTES * MINUTE_IN_MS;

const NOW: Date = new Date("2026-11-20T10:00:00.000Z");
const SENT_AT: Date = new Date(NOW.getTime() - 40 * SECOND_IN_MS);

function judge(
  authenticatedAt: Date | null,
  requestedAt: Date = SENT_AT,
): ReturnType<typeof judgeSignInAgain> {
  return judgeSignInAgain({
    requestedAt: requestedAt,
    authenticatedAt: authenticatedAt,
    now: NOW,
  });
}

function at(offsetInMs: number, from: Date = SENT_AT): Date {
  return new Date(from.getTime() + offsetInMs);
}

describe("a sign-in after Sign In Again sent the person", () => {
  test("confirms the session from the moment the provider authenticated them", () => {
    expect(judge(at(15 * SECOND_IN_MS))).toEqual({
      reauthenticatedAt: at(15 * SECOND_IN_MS),
    });
    expect(judge(SENT_AT)).toEqual({ reauthenticatedAt: SENT_AT });
  });

  test("a provider's clock a little behind still counts, up to the skew", () => {
    expect(judge(at(-SKEW_IN_MS))).toEqual({
      reauthenticatedAt: at(-SKEW_IN_MS),
    });
  });

  test("a provider's clock a little ahead counts from now, never from a time to come", () => {
    expect(judge(at(SKEW_IN_MS / 2, NOW))).toEqual({ reauthenticatedAt: NOW });
  });
});

describe("a sign-in the provider made with a session it had", () => {
  test("before the request, past the skew: a reused session", () => {
    expect(judge(at(-SKEW_IN_MS - 1))).toEqual({
      refusal: SignInAgainRefusal.ReusedSession,
    });
    expect(judge(at(-8 * 60 * MINUTE_IN_MS))).toEqual({
      refusal: SignInAgainRefusal.ReusedSession,
    });
  });

  test("a sign-in older than the window confirms nothing, whenever it was asked for", () => {
    const requestedLongAgo: Date = at(-WINDOW_IN_MS - MINUTE_IN_MS, NOW);

    expect(judge(at(-WINDOW_IN_MS, NOW), requestedLongAgo)).toEqual({
      refusal: SignInAgainRefusal.ReusedSession,
    });
    expect(
      judge(at(-WINDOW_IN_MS + SECOND_IN_MS, NOW), requestedLongAgo),
    ).toEqual({ reauthenticatedAt: at(-WINDOW_IN_MS + SECOND_IN_MS, NOW) });
  });
});

describe("a provider that does not say when", () => {
  test("no time: refused for saying nothing, never taken as fresh", () => {
    expect(judge(null)).toEqual({ refusal: SignInAgainRefusal.NoSignInTime });
  });

  test("a time that is no time", () => {
    expect(judge(new Date("not a time"))).toEqual({
      refusal: SignInAgainRefusal.NoSignInTime,
    });
  });

  test("a time ahead of now by more than the skew has not happened", () => {
    expect(judge(at(SKEW_IN_MS + 1, NOW))).toEqual({
      refusal: SignInAgainRefusal.NoSignInTime,
    });
  });
});

describe("the rule's numbers", () => {
  test("a minute of skew, inside a ten-minute window", () => {
    expect(SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS).toBe(60);
    expect(REAUTHENTICATION_WINDOW_IN_MINUTES).toBe(10);
  });
});
