import { describe, expect, test } from "@jest/globals";
import {
  buildOverrideRequest,
  describeOverride,
  type BuildOverrideResult,
} from "./overrideDraft";

/*
 * The direction swap is the dangerous part of this feature: getting it
 * backwards silently routes the WRONG person's pages away, and nobody notices
 * until an alert goes unanswered. So both directions are asserted on the exact
 * field names the server reads, not on a summary object.
 */

const ME: string = "user-me";
const TEAMMATE: string = "user-teammate";
const NOW: number = new Date("2026-03-03T12:00:00.000Z").getTime();
const HOUR: number = 60 * 60 * 1000;

function expectOk(
  result: BuildOverrideResult,
): Extract<BuildOverrideResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`Expected a buildable override, got: ${result.reason}`);
  }

  return result;
}

describe("buildOverrideRequest direction", () => {
  test("'cover for me' sends MY pages to the teammate", () => {
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 4,
        },
        ME,
        NOW,
      ),
    );

    expect(result.input.overrideUserId).toBe(ME);
    expect(result.input.routeAlertsToUserId).toBe(TEAMMATE);
  });

  test("'I'll take over' sends the TEAMMATE's pages to me", () => {
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "take-over",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 4,
        },
        ME,
        NOW,
      ),
    );

    expect(result.input.overrideUserId).toBe(TEAMMATE);
    expect(result.input.routeAlertsToUserId).toBe(ME);
  });
});

describe("buildOverrideRequest window", () => {
  test("starts now and runs for the chosen number of hours", () => {
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 4,
        },
        ME,
        NOW,
      ),
    );

    expect(result.input.startsAt.getTime()).toBe(NOW);
    expect(result.input.endsAt.getTime()).toBe(NOW + 4 * HOUR);
  });

  test("start is strictly before end, which is what the server enforces", () => {
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 1,
        },
        ME,
        NOW,
      ),
    );

    expect(result.input.startsAt.getTime()).toBeLessThan(
      result.input.endsAt.getTime(),
    );
  });

  test("carries the project so the override lands in the right tenant", () => {
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-9",
          counterpartUserId: TEAMMATE,
          durationHours: 2,
        },
        ME,
        NOW,
      ),
    );

    expect(result.input.projectId).toBe("project-9");
  });
});

describe("buildOverrideRequest refusals", () => {
  test("refuses when the signed-in user is unknown", () => {
    const result: BuildOverrideResult = buildOverrideRequest(
      {
        direction: "cover-me",
        projectId: "project-1",
        counterpartUserId: TEAMMATE,
        durationHours: 4,
      },
      null,
      NOW,
    );

    expect(result.ok).toBe(false);
  });

  test("refuses without a project", () => {
    const result: BuildOverrideResult = buildOverrideRequest(
      {
        direction: "cover-me",
        projectId: null,
        counterpartUserId: TEAMMATE,
        durationHours: 4,
      },
      ME,
      NOW,
    );

    expect(result.ok).toBe(false);
  });

  test("refuses without a teammate", () => {
    const result: BuildOverrideResult = buildOverrideRequest(
      {
        direction: "cover-me",
        projectId: "project-1",
        counterpartUserId: null,
        durationHours: 4,
      },
      ME,
      NOW,
    );

    expect(result.ok).toBe(false);
  });

  test("refuses to route a user's pages to themselves", () => {
    /*
     * The server rejects this too, but only after a round trip. Catching it
     * here is the difference between an inline message and a spinner that
     * ends in a red banner.
     */
    const result: BuildOverrideResult = buildOverrideRequest(
      {
        direction: "cover-me",
        projectId: "project-1",
        counterpartUserId: ME,
        durationHours: 4,
      },
      ME,
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/yourself/i);
    }
  });

  test("refuses a zero or negative duration", () => {
    expect(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 0,
        },
        ME,
        NOW,
      ).ok,
    ).toBe(false);

    expect(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: -2,
        },
        ME,
        NOW,
      ).ok,
    ).toBe(false);
  });
});

describe("describeOverride", () => {
  test("says which way the pages flow, in each direction", () => {
    expect(describeOverride("cover-me", "Priya", 4)).toBe(
      "Your on-call pages go to Priya for the next 4 hours.",
    );

    expect(describeOverride("take-over", "Priya", 4)).toBe(
      "Priya's on-call pages come to you for the next 4 hours.",
    );
  });

  test("says 1 hour, not 1 hours", () => {
    expect(describeOverride("cover-me", "Priya", 1)).toContain("1 hour.");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Prefilled windows ("Get cover" on a shift card) and policy scoping.
 * ---------------------------------------------------------------------------
 */

describe("buildOverrideRequest with an explicit window", () => {
  test("covers the whole shift when it has not started", () => {
    const startsAt: Date = new Date(NOW + 2 * HOUR);
    const endsAt: Date = new Date(NOW + 10 * HOUR);

    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 4,
          window: { startsAt, endsAt },
        },
        ME,
        NOW,
      ),
    );

    expect(result.input.startsAt.getTime()).toBe(startsAt.getTime());
    expect(result.input.endsAt.getTime()).toBe(endsAt.getTime());
    expect(result.input.overrideUserId).toBe(ME);
    expect(result.input.routeAlertsToUserId).toBe(TEAMMATE);
  });

  test("the window wins over the duration preset", () => {
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 1,
          window: {
            startsAt: new Date(NOW + HOUR),
            endsAt: new Date(NOW + 9 * HOUR),
          },
        },
        ME,
        NOW,
      ),
    );

    expect(
      (result.input.endsAt.getTime() - result.input.startsAt.getTime()) / HOUR,
    ).toBe(8);
  });

  test("a shift already in progress is covered from NOW, not from its start", () => {
    /*
     * An override cannot start in the past, and one that claims to would be
     * rejected by the server after the user has stopped reading.
     */
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 4,
          window: {
            startsAt: new Date(NOW - 3 * HOUR),
            endsAt: new Date(NOW + 5 * HOUR),
          },
        },
        ME,
        NOW,
      ),
    );

    expect(result.input.startsAt.getTime()).toBe(NOW);
    expect(result.input.endsAt.getTime()).toBe(NOW + 5 * HOUR);
  });

  test("refuses a shift that has already ended", () => {
    const result: BuildOverrideResult = buildOverrideRequest(
      {
        direction: "cover-me",
        projectId: "project-1",
        counterpartUserId: TEAMMATE,
        durationHours: 4,
        window: {
          startsAt: new Date(NOW - 10 * HOUR),
          endsAt: new Date(NOW - 2 * HOUR),
        },
      },
      ME,
      NOW,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("That shift has already ended.");
  });

  test("refuses an inverted or unreadable window", () => {
    const inverted: BuildOverrideResult = buildOverrideRequest(
      {
        direction: "cover-me",
        projectId: "project-1",
        counterpartUserId: TEAMMATE,
        durationHours: 4,
        window: {
          startsAt: new Date(NOW + 9 * HOUR),
          endsAt: new Date(NOW + HOUR),
        },
      },
      ME,
      NOW,
    );

    expect(inverted.ok).toBe(false);

    const unreadable: BuildOverrideResult = buildOverrideRequest(
      {
        direction: "cover-me",
        projectId: "project-1",
        counterpartUserId: TEAMMATE,
        durationHours: 4,
        window: {
          startsAt: new Date("garbage"),
          endsAt: new Date(NOW + HOUR),
        },
      },
      ME,
      NOW,
    );

    expect(unreadable.ok).toBe(false);
  });

  test("a null window falls back to the duration", () => {
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 2,
          window: null,
        },
        ME,
        NOW,
      ),
    );

    expect(result.input.startsAt.getTime()).toBe(NOW);
    expect(result.input.endsAt.getTime()).toBe(NOW + 2 * HOUR);
  });
});

describe("buildOverrideRequest policy scope", () => {
  test("stays project-wide by default", () => {
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 4,
        },
        ME,
        NOW,
      ),
    );

    expect("onCallDutyPolicyId" in result.input).toBe(false);
  });

  test("carries the policy for a policy-variant shift", () => {
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 4,
          onCallDutyPolicyId: "policy-1",
        },
        ME,
        NOW,
      ),
    );

    expect(result.input.onCallDutyPolicyId).toBe("policy-1");
  });

  test("an explicit null policy is the same as none", () => {
    const result: Extract<BuildOverrideResult, { ok: true }> = expectOk(
      buildOverrideRequest(
        {
          direction: "cover-me",
          projectId: "project-1",
          counterpartUserId: TEAMMATE,
          durationHours: 4,
          onCallDutyPolicyId: null,
        },
        ME,
        NOW,
      ),
    );

    expect("onCallDutyPolicyId" in result.input).toBe(false);
  });
});

describe("describeOverride with a window label", () => {
  test("names the window instead of a duration", () => {
    expect(
      describeOverride(
        "cover-me",
        "Priya Rao",
        4,
        "for your shift on Primary (Today 9:00 AM → Today 5:00 PM)",
      ),
    ).toBe(
      "Your on-call pages go to Priya Rao for your shift on Primary (Today 9:00 AM → Today 5:00 PM).",
    );

    expect(describeOverride("take-over", "Priya Rao", 4, "on Thursday")).toBe(
      "Priya Rao's on-call pages come to you on Thursday.",
    );
  });

  test("an empty label falls back to the duration wording", () => {
    expect(describeOverride("cover-me", "Priya Rao", 4, null)).toBe(
      "Your on-call pages go to Priya Rao for the next 4 hours.",
    );
    expect(describeOverride("cover-me", "Priya Rao", 4, "")).toBe(
      "Your on-call pages go to Priya Rao for the next 4 hours.",
    );
  });
});
