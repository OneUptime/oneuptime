import {
  decideTwoFactorFollowUp,
  type TwoFactorFollowUp,
} from "./twoFactorFollowUp";
import { describe, expect, test } from "@jest/globals";

/*
 * The one decision between "the second factor was accepted" and "the app is on
 * the dashboard". It is three booleans wide and it is pure, so the whole truth
 * table is written out here rather than sampled: every wrong answer this
 * function can give is SILENT. The user is signed in either way, and finds out
 * what was decided for them months later, at the sign-in they cannot complete.
 *
 * What each group of rows is holding shut:
 *
 *  - CODES IN HAND WIN, unconditionally. A minted set exists in that one HTTP
 *    response and nowhere else -- the server keeps keyed digests -- so any row
 *    where a non-empty count fails to produce "show-codes" is a row where the
 *    app destroys the user's only recovery route on the way to a dashboard.
 *    Both suppressors are exercised against it (an account that already had
 *    codes, a handset that recently skipped the offer) because both are
 *    plausible things for a future reader to check first.
 *
 *  - "NO RECOVERY ROUTE" EARNS AN OFFER, ONCE IN A WHILE. That is everyone who
 *    enrolled before recovery codes existed and everyone an admin has just
 *    reset. Drop the offer and #3382 is back; make it undismissable and the
 *    nudge becomes a toll paid at every sign-in, which is worse than the
 *    problem, because this screen sits between an on-call engineer and a page.
 *
 *  - UNKNOWN IS NOT NONE. The server omits the count when it could not read
 *    it, and the callers spell that as accountHasNoCodes=false. This file pins
 *    the half that lives here: false never produces an offer, so a transient
 *    count failure can never tell a user holding ten printed codes to go and
 *    find an administrator.
 *
 *  - A COUNT OF ZERO IS NOT A SET. "show-codes" renders the list and disables
 *    Continue until the user ticks "I have saved these"; reached with nothing
 *    to show, it is a screen with no codes on it and no way off it, on the
 *    wrong side of a completed sign-in.
 */

describe("decideTwoFactorFollowUp: codes in hand", () => {
  test("a freshly minted set is shown", () => {
    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: 10,
      accountHasNoCodes: true,
      offerRecentlySkipped: false,
    });

    expect(followUp).toBe("show-codes");
  });

  test("a minted set is shown even though this handset recently skipped the offer", () => {
    /*
     * The skip suppresses being ASKED to generate codes. These are already
     * generated: honouring the skip here would throw away the strings it was
     * suppressing a request for.
     */
    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: 10,
      accountHasNoCodes: true,
      offerRecentlySkipped: true,
    });

    expect(followUp).toBe("show-codes");
  });

  test("a minted set is shown even though the account is not short of codes", () => {
    /*
     * Regenerating replaces the previous set, so "the account has codes" is
     * true and the OLD ones stopped working the moment these were minted.
     * Skipping the screen on that basis leaves the user holding a printout of
     * codes the server no longer accepts.
     */
    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: 10,
      accountHasNoCodes: false,
      offerRecentlySkipped: false,
    });

    expect(followUp).toBe("show-codes");
  });

  test("a minted set is shown with both suppressors set at once", () => {
    /*
     * The row where nothing else in the function wants to interrupt the
     * sign-in, and the codes still have to win. If the count check is ever
     * reordered below the others, this is the row that catches it.
     */
    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: 10,
      accountHasNoCodes: false,
      offerRecentlySkipped: true,
    });

    expect(followUp).toBe("show-codes");
  });

  test("a single code is still a set worth stopping for", () => {
    /* One code is one lost handset away from a support ticket, not zero. */
    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: 1,
      accountHasNoCodes: false,
      offerRecentlySkipped: false,
    });

    expect(followUp).toBe("show-codes");
  });
});

describe("decideTwoFactorFollowUp: an account with no recovery route", () => {
  test("is offered a set when nothing has been skipped", () => {
    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: 0,
      accountHasNoCodes: true,
      offerRecentlySkipped: false,
    });

    expect(followUp).toBe("offer-codes");
  });

  test("is let through when this handset was recently told to stop asking", () => {
    /*
     * The account still has no codes -- that is not fixed and the offer will
     * be made again once the snooze lapses. What is not acceptable is standing
     * between a responder and the incident on every single sign-in until they
     * give in.
     */
    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: 0,
      accountHasNoCodes: true,
      offerRecentlySkipped: true,
    });

    expect(followUp).toBe("signed-in");
  });
});

describe("decideTwoFactorFollowUp: an account that already has codes", () => {
  test("is let straight through", () => {
    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: 0,
      accountHasNoCodes: false,
      offerRecentlySkipped: false,
    });

    expect(followUp).toBe("signed-in");
  });

  test("is let straight through regardless of the skip flag", () => {
    /*
     * The skip is a suppressor, never a trigger: an account with codes is not
     * offered more of them whether or not it ever saw the offer. Pinned so the
     * two booleans can never be combined into a single "should we nudge"
     * variable that reads the skip in isolation.
     */
    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: 0,
      accountHasNoCodes: false,
      offerRecentlySkipped: true,
    });

    expect(followUp).toBe("signed-in");
  });

  test("an unreadable count reaches here as accountHasNoCodes=false and never produces an offer", () => {
    /*
     * The server omits backupCodeCount when it could not read it, so null
     * means UNKNOWN, and the callers narrow it with `=== 0` rather than with
     * `!count` precisely so that unknown lands as false. This is the far end
     * of that contract: given false, this function must not offer.
     *
     * The failure it forbids: a transient database fault makes the count
     * unreadable, and a user with ten printed codes in their wallet is told
     * they have no recovery route and should go and ask an administrator to
     * reset their second factor. The narrowing itself is pinned by the screen
     * suites; the refusal to offer is pinned here, and it is the half that
     * makes the narrowing worth anything.
     */
    const backupCodeCount: number | null = null;
    const accountHasNoCodes: boolean = backupCodeCount === 0;

    expect(accountHasNoCodes).toBe(false);

    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: 0,
      accountHasNoCodes,
      offerRecentlySkipped: false,
    });

    expect(followUp).toBe("signed-in");
  });
});

describe("decideTwoFactorFollowUp: counts that are not a set of codes", () => {
  test("zero minted codes is never the show screen", () => {
    /*
     * "show-codes" renders the list and keeps Continue disabled until the user
     * confirms they have saved what is on it. With nothing on it, that is an
     * empty screen with a dead button, reached AFTER the sign-in completed --
     * a dead end the user cannot back out of, on the only path into the app.
     */
    expect(
      decideTwoFactorFollowUp({
        mintedCodeCount: 0,
        accountHasNoCodes: true,
        offerRecentlySkipped: false,
      }),
    ).not.toBe("show-codes");

    expect(
      decideTwoFactorFollowUp({
        mintedCodeCount: 0,
        accountHasNoCodes: false,
        offerRecentlySkipped: false,
      }),
    ).not.toBe("show-codes");
  });

  test("a negative count is never the show screen either", () => {
    /*
     * Nothing should ever produce one, but the callers compute this as
     * `response.backupCodes?.length || 0` from a field the server controls,
     * and a truthiness test (`if (mintedCodeCount)`) would send -1 to the same
     * empty, unleavable screen. Pinned as a comparison, not a coercion.
     */
    expect(
      decideTwoFactorFollowUp({
        mintedCodeCount: -1,
        accountHasNoCodes: false,
        offerRecentlySkipped: false,
      }),
    ).toBe("signed-in");
  });

  test("a negative count still lets the missing-codes offer through", () => {
    /*
     * Having decided the response carries no usable set, the decision must
     * carry on to the account's actual state rather than short-circuiting to
     * "signed-in" -- otherwise a garbled count silently costs an account with
     * no recovery route its one offer.
     */
    expect(
      decideTwoFactorFollowUp({
        mintedCodeCount: -1,
        accountHasNoCodes: true,
        offerRecentlySkipped: false,
      }),
    ).toBe("offer-codes");
  });
});
