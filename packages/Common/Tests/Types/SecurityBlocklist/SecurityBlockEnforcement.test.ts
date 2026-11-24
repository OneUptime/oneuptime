import {
  SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS,
  SECURITY_BLOCK_ENFORCEMENT_STATES,
  SecurityBlockEnforcementShape,
  SecurityBlockEnforcementState,
  SecurityBlockEnforcementSummary,
  SecurityBlockEnforcementView,
  getSecurityBlockEnforcementSummary,
  getSecurityBlockEnforcementView,
  isSecurityBlockEnforced,
  isSecurityBlockEnforcementHolding,
  isSecurityBlockEnforcementState,
} from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { describe, expect, test } from "@jest/globals";

/*
 * Where a block is enforced, and whether that holds (#10338). A block is
 * enforced only where a destination was read back holding it, recently: a
 * destination asked and never seen holding it, one that refused it, and one
 * that stopped answering are not. Not enforced is not done - the rule a
 * Response Plan step and OneUptime AI read a block by.
 */

const NOW: Date = new Date("2026-11-20T10:00:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;

function at(offsetInMs: number): Date {
  return new Date(NOW.getTime() + offsetInMs);
}

function row(
  state: SecurityBlockEnforcementState,
  extra?: Partial<SecurityBlockEnforcementShape>,
): SecurityBlockEnforcementShape {
  return {
    state,
    destinationName: "Test destination",
    ...(extra || {}),
  };
}

describe("isSecurityBlockEnforcementHolding", () => {
  test("Applied and read back within the last ten minutes holds", () => {
    expect(
      isSecurityBlockEnforcementHolding(
        row(SecurityBlockEnforcementState.Applied, {
          lastConfirmedAt: at(-MINUTE_IN_MS),
        }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isSecurityBlockEnforcementHolding(
        row(SecurityBlockEnforcementState.Applied, {
          lastConfirmedAt: at(-SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS),
        }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isSecurityBlockEnforcementHolding(
        row(SecurityBlockEnforcementState.Applied, {
          lastConfirmedAt: at(-MINUTE_IN_MS).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  test("a confirmation gone stale is not known to hold", () => {
    expect(
      isSecurityBlockEnforcementHolding(
        row(SecurityBlockEnforcementState.Applied, {
          lastConfirmedAt: at(-SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS - 1),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  test("Applied with no confirmation, or one that is no date, does not hold", () => {
    expect(
      isSecurityBlockEnforcementHolding(
        row(SecurityBlockEnforcementState.Applied),
        NOW,
      ),
    ).toBe(false);
    expect(
      isSecurityBlockEnforcementHolding(
        row(SecurityBlockEnforcementState.Applied, {
          lastConfirmedAt: "not a date",
        }),
        NOW,
      ),
    ).toBe(false);
  });

  test("Pending, Failed, Removing and Removed never hold, however fresh", () => {
    for (const state of [
      SecurityBlockEnforcementState.Pending,
      SecurityBlockEnforcementState.Failed,
      SecurityBlockEnforcementState.Removing,
      SecurityBlockEnforcementState.Removed,
    ]) {
      expect(
        isSecurityBlockEnforcementHolding(
          row(state, { lastConfirmedAt: NOW }),
          NOW,
        ),
      ).toBe(false);
    }
  });
});

describe("isSecurityBlockEnforced", () => {
  test("enforced when at least one destination holds it", () => {
    expect(
      isSecurityBlockEnforced(
        [
          row(SecurityBlockEnforcementState.Failed, {
            error: "Not applied: Azure WAF cannot challenge",
          }),
          row(SecurityBlockEnforcementState.Applied, { lastConfirmedAt: NOW }),
        ],
        NOW,
      ),
    ).toBe(true);
  });

  test("never enforced with no destination, or with none holding it", () => {
    expect(isSecurityBlockEnforced([], NOW)).toBe(false);
    expect(
      isSecurityBlockEnforced(
        [
          row(SecurityBlockEnforcementState.Pending),
          row(SecurityBlockEnforcementState.Applied, {
            lastConfirmedAt: at(-SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS * 2),
          }),
        ],
        NOW,
      ),
    ).toBe(false);
  });
});

describe("getSecurityBlockEnforcementView", () => {
  test("each state reads as its chip says it", () => {
    expect(
      getSecurityBlockEnforcementView(
        row(SecurityBlockEnforcementState.Applied, { lastConfirmedAt: NOW }),
        NOW,
      ),
    ).toBe(SecurityBlockEnforcementView.Enforced);
    expect(
      getSecurityBlockEnforcementView(
        row(SecurityBlockEnforcementState.Applied, {
          lastConfirmedAt: at(-SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS - 1),
        }),
        NOW,
      ),
    ).toBe(SecurityBlockEnforcementView.Unconfirmed);
    expect(
      getSecurityBlockEnforcementView(
        row(SecurityBlockEnforcementState.Pending),
        NOW,
      ),
    ).toBe(SecurityBlockEnforcementView.Pending);
    expect(
      getSecurityBlockEnforcementView(
        row(SecurityBlockEnforcementState.Failed),
        NOW,
      ),
    ).toBe(SecurityBlockEnforcementView.NotApplied);
    expect(
      getSecurityBlockEnforcementView(
        row(SecurityBlockEnforcementState.Removing),
        NOW,
      ),
    ).toBe(SecurityBlockEnforcementView.Removing);
    expect(
      getSecurityBlockEnforcementView(
        row(SecurityBlockEnforcementState.Removed),
        NOW,
      ),
    ).toBe(SecurityBlockEnforcementView.Removed);
  });

  test("a state that is none of them reads as Pending, never as enforced", () => {
    expect(getSecurityBlockEnforcementView({ state: "Unknown" }, NOW)).toBe(
      SecurityBlockEnforcementView.Pending,
    );
    expect(getSecurityBlockEnforcementView({}, NOW)).toBe(
      SecurityBlockEnforcementView.Pending,
    );
  });
});

describe("getSecurityBlockEnforcementSummary", () => {
  test("names where it holds, and where it does not with why", () => {
    const summary: SecurityBlockEnforcementSummary =
      getSecurityBlockEnforcementSummary(
        [
          {
            state: SecurityBlockEnforcementState.Applied,
            destinationName: " Cloudflare ",
            lastConfirmedAt: NOW,
          },
          {
            state: SecurityBlockEnforcementState.Failed,
            destinationName: "Azure WAF (prod)",
            error: "Not applied: Azure WAF cannot challenge",
          },
          {
            state: SecurityBlockEnforcementState.Pending,
            destinationName: "AWS WAF (prod-alb)",
          },
        ],
        NOW,
      );

    expect(summary).toEqual({
      isEnforced: true,
      enforcedAt: ["Cloudflare"],
      notEnforcedAt: [
        {
          name: "Azure WAF (prod)",
          reason: "Not applied: Azure WAF cannot challenge",
        },
        { name: "AWS WAF (prod-alb)", reason: null },
      ],
    });
  });

  test("leaves out the destinations that let an ended block go", () => {
    expect(
      getSecurityBlockEnforcementSummary(
        [
          {
            state: SecurityBlockEnforcementState.Removed,
            destinationName: "Cloudflare",
          },
          {
            state: SecurityBlockEnforcementState.Removing,
            destinationName: "AWS WAF",
          },
        ],
        NOW,
      ),
    ).toEqual({ isEnforced: false, enforcedAt: [], notEnforcedAt: [] });
  });

  test("with no destination at all, it is not enforced", () => {
    expect(getSecurityBlockEnforcementSummary([], NOW)).toEqual({
      isEnforced: false,
      enforcedAt: [],
      notEnforcedAt: [],
    });
  });

  test("a confirmation gone stale moves the destination to where it does not hold", () => {
    expect(
      getSecurityBlockEnforcementSummary(
        [
          {
            state: SecurityBlockEnforcementState.Applied,
            destinationName: "Cloudflare",
            lastConfirmedAt: at(-SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS - 1),
            error: "Could not read Cloudflare: timed out",
          },
        ],
        NOW,
      ),
    ).toEqual({
      isEnforced: false,
      enforcedAt: [],
      notEnforcedAt: [
        { name: "Cloudflare", reason: "Could not read Cloudflare: timed out" },
      ],
    });
  });
});

describe("the enforcement states", () => {
  test("are the five a row moves through, and only those", () => {
    expect([...SECURITY_BLOCK_ENFORCEMENT_STATES]).toEqual([
      SecurityBlockEnforcementState.Pending,
      SecurityBlockEnforcementState.Applied,
      SecurityBlockEnforcementState.Failed,
      SecurityBlockEnforcementState.Removing,
      SecurityBlockEnforcementState.Removed,
    ]);
    expect(isSecurityBlockEnforcementState("Applied")).toBe(true);
    expect(isSecurityBlockEnforcementState("Enforced")).toBe(false);
    expect(isSecurityBlockEnforcementState(undefined)).toBe(false);
  });
});
