import { describe, expect, test } from "@jest/globals";
import {
  applyManualResolutionChange,
  ExceptionIssueBadge,
  getExceptionIssueBadges,
  isExceptionNew,
  isExceptionRegressed,
  NEW_EXCEPTION_WINDOW_MS,
} from "../../../Utils/Exceptions/ExceptionIssueState";

/*
 * Where an exception stands at a glance - Regressed, New, Unhandled - and
 * what resolving or reopening it by hand writes besides the switch. The
 * list, the exception's page and the API read one definition.
 */

const NOW: Date = new Date("2026-10-30T12:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR_MS);
}

describe("Regressed", () => {
  test("an unresolved exception that came back after it was resolved", () => {
    expect(
      isExceptionRegressed({ isResolved: false, regressedAt: hoursAgo(1) }),
    ).toBe(true);
  });

  test("not once it is resolved again, and never without a regression time", () => {
    expect(
      isExceptionRegressed({ isResolved: true, regressedAt: hoursAgo(1) }),
    ).toBe(false);
    expect(isExceptionRegressed({ isResolved: false })).toBe(false);
    expect(isExceptionRegressed({ isResolved: false, regressedAt: null })).toBe(
      false,
    );
  });

  test("reads the time as the API sends it, and ignores one that is not a time", () => {
    expect(
      isExceptionRegressed({
        isResolved: false,
        regressedAt: "2026-10-30T11:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isExceptionRegressed({ isResolved: false, regressedAt: "not a date" }),
    ).toBe(false);
    expect(isExceptionRegressed({ isResolved: false, regressedAt: "" })).toBe(
      false,
    );
  });
});

describe("New", () => {
  test("first seen within the last day, while nobody has resolved or archived it", () => {
    expect(isExceptionNew({ firstSeenAt: hoursAgo(2) }, NOW)).toBe(true);
    expect(isExceptionNew({ firstSeenAt: hoursAgo(23.9) }, NOW)).toBe(true);
    expect(isExceptionNew({ firstSeenAt: hoursAgo(24.1) }, NOW)).toBe(false);
    expect(
      isExceptionNew({ firstSeenAt: hoursAgo(2), isResolved: true }, NOW),
    ).toBe(false);
    expect(
      isExceptionNew({ firstSeenAt: hoursAgo(2), isArchived: true }, NOW),
    ).toBe(false);
  });

  test("the day is the New Exception finding's day", () => {
    expect(NEW_EXCEPTION_WINDOW_MS).toBe(24 * HOUR_MS);
  });

  test("a first seen in the future or missing is not new", () => {
    expect(isExceptionNew({ firstSeenAt: hoursAgo(-1) }, NOW)).toBe(false);
    expect(isExceptionNew({}, NOW)).toBe(false);
  });
});

describe("the badges, in the order they show", () => {
  test("Regressed wins over New: a regressed exception is not new", () => {
    expect(
      getExceptionIssueBadges(
        {
          isResolved: false,
          regressedAt: hoursAgo(1),
          firstSeenAt: hoursAgo(2),
          unhandled: true,
        },
        NOW,
      ),
    ).toEqual([ExceptionIssueBadge.Regressed, ExceptionIssueBadge.Unhandled]);
  });

  test("New, then Unhandled", () => {
    expect(
      getExceptionIssueBadges(
        { firstSeenAt: hoursAgo(2), unhandled: true },
        NOW,
      ),
    ).toEqual([ExceptionIssueBadge.New, ExceptionIssueBadge.Unhandled]);
  });

  test("an old, handled, resolved exception carries none", () => {
    expect(
      getExceptionIssueBadges(
        {
          isResolved: true,
          firstSeenAt: hoursAgo(400),
          regressedAt: hoursAgo(100),
          unhandled: false,
        },
        NOW,
      ),
    ).toEqual([]);
  });

  test("Unhandled stays on a resolved exception: it says how it fails", () => {
    expect(
      getExceptionIssueBadges(
        { isResolved: true, firstSeenAt: hoursAgo(400), unhandled: true },
        NOW,
      ),
    ).toEqual([ExceptionIssueBadge.Unhandled]);
  });
});

/*
 * The state transitions a person makes. Resolving or reopening clears the
 * Regressed mark (a manual reopen is never a regression); a resolve keeps a
 * release to wait out only when it names one; every reopen and every plain
 * resolve clears the release, so a later plain resolve never inherits one.
 */
describe("what resolving or reopening by hand writes", () => {
  function written(data: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...data };
    applyManualResolutionChange(copy);
    return copy;
  }

  test("a plain resolve clears the Regressed mark and any release", () => {
    expect(written({ isResolved: true })).toEqual({
      isResolved: true,
      regressedAt: null,
      resolvedInReleaseAfter: null,
    });
  });

  test("Resolve in next release keeps its release, trimmed", () => {
    expect(
      written({ isResolved: true, resolvedInReleaseAfter: "  v1.4.0 " }),
    ).toEqual({
      isResolved: true,
      regressedAt: null,
      resolvedInReleaseAfter: "v1.4.0",
    });
  });

  test("a blank release is a plain resolve", () => {
    expect(
      written({ isResolved: true, resolvedInReleaseAfter: "   " }),
    ).toEqual({
      isResolved: true,
      regressedAt: null,
      resolvedInReleaseAfter: null,
    });
    expect(written({ isResolved: true, resolvedInReleaseAfter: 42 })).toEqual({
      isResolved: true,
      regressedAt: null,
      resolvedInReleaseAfter: null,
    });
  });

  test("a reopen clears both, whatever release it names", () => {
    expect(
      written({ isResolved: false, resolvedInReleaseAfter: "v1.4.0" }),
    ).toEqual({
      isResolved: false,
      regressedAt: null,
      resolvedInReleaseAfter: null,
    });
  });

  test("a write that names a regression time keeps it: a fix that did not hold reopens as Regressed", () => {
    const at: Date = hoursAgo(0);

    expect(written({ isResolved: false, regressedAt: at })).toEqual({
      isResolved: false,
      regressedAt: at,
      resolvedInReleaseAfter: null,
    });
  });

  test("the switch as a form sends it, a string, is read the same", () => {
    expect(
      written({ isResolved: "true", resolvedInReleaseAfter: "v2" }),
    ).toEqual({
      isResolved: "true",
      regressedAt: null,
      resolvedInReleaseAfter: "v2",
    });
    expect(written({ isResolved: "false" })).toEqual({
      isResolved: "false",
      regressedAt: null,
      resolvedInReleaseAfter: null,
    });
  });

  test("a write that does not turn the switch leaves the mark alone and only tidies a release", () => {
    expect(written({ isArchived: true })).toEqual({ isArchived: true });
    expect(written({ resolvedInReleaseAfter: " v3 " })).toEqual({
      resolvedInReleaseAfter: "v3",
    });
    expect(written({ resolvedInReleaseAfter: "" })).toEqual({
      resolvedInReleaseAfter: null,
    });
  });
});
