import { describe, expect, test } from "@jest/globals";
import DataSecurityIssueResolution, {
  ALL_DATA_SECURITY_ISSUE_RESOLUTIONS,
  FIXED_AT_SOURCE_RESOLUTIONS,
  PENDING_RESOLUTION_DAYS,
  isDataSecurityIssueResolution,
  isFixedAtSource,
  isPendingResolutionCurrent,
  isVerifiedFixResolution,
  readDataSecurityIssuePendingResolution,
  readDataSecurityIssueResolutionDetails,
  readResolutionUrl,
  toResolutionDetailsJSON,
} from "../../../Types/DataSecurity/DataSecurityIssueResolution";
import { DataSecurityResponseAction } from "../../../Types/DataSecurity/DataSecurityResponseAction";
import ObjectID from "../../../Types/ObjectID";

/*
 * HOW A RESOLVED ISSUE WAS RESOLVED (#10368), as data: the values, which
 * of them stopped the problem where it starts - never "contained at
 * ingest" - and the details read back field by field, so a stored row or
 * a server's answer of the wrong shape is never trusted as written.
 */

const ID: string = new ObjectID("8c5a3f30-0000-4000-8000-000000000001").toString();
const NOW: Date = new Date("2026-11-21T14:10:00.000Z");

describe("the resolutions", () => {
  test("are a wire contract", () => {
    expect(Object.values(DataSecurityIssueResolution)).toEqual([
      "FixedInCode",
      "FixedInInfrastructureCode",
      "FixedFromHere",
      "ContainedAtIngest",
      "CheckPassed",
      "ResolvedByPerson",
      "NoLongerChecked",
      "StoreArchived",
    ]);
    expect([...ALL_DATA_SECURITY_ISSUE_RESOLUTIONS].sort()).toEqual(
      Object.values(DataSecurityIssueResolution).sort(),
    );
    expect(isDataSecurityIssueResolution("FixedInCode")).toBe(true);
    expect(isDataSecurityIssueResolution("Fixed")).toBe(false);
  });

  test("a leak only contained at ingest is never fixed at the source; a check turned off neither", () => {
    expect(isFixedAtSource(DataSecurityIssueResolution.ContainedAtIngest)).toBe(
      false,
    );
    expect(isFixedAtSource(DataSecurityIssueResolution.NoLongerChecked)).toBe(
      false,
    );
    expect(isFixedAtSource(DataSecurityIssueResolution.ResolvedByPerson)).toBe(
      false,
    );
    expect([...FIXED_AT_SOURCE_RESOLUTIONS].sort()).toEqual(
      [
        DataSecurityIssueResolution.CheckPassed,
        DataSecurityIssueResolution.FixedFromHere,
        DataSecurityIssueResolution.FixedInCode,
        DataSecurityIssueResolution.FixedInInfrastructureCode,
      ].sort(),
    );
    expect(isVerifiedFixResolution(DataSecurityIssueResolution.FixedInCode)).toBe(
      true,
    );
    expect(isVerifiedFixResolution(DataSecurityIssueResolution.CheckPassed)).toBe(
      false,
    );
  });
});

describe("the details", () => {
  test("are read field by field, and one of the wrong shape left out", () => {
    expect(
      readDataSecurityIssueResolutionDetails({
        at: NOW.toISOString(),
        fix: {
          pullRequestId: ID,
          taskId: "not an id",
          number: 482,
          url: "javascript:alert(1)",
          repository: "acme/checkout",
          version: "2.4.1",
          deployedAt: "not a time",
        },
        scrubRules: [
          { id: ID, signal: "log", name: "Email rule" },
          { id: ID, signal: "log", name: "The same rule again" },
          { id: "x", signal: "log" },
        ],
        responseAction: "Delete the bucket",
        userId: 12,
        regression: { at: NOW.toISOString(), version: "2.5.0" },
      }),
    ).toEqual({
      at: NOW.toISOString(),
      // A link only ever opens http(s).
      fix: {
        pullRequestId: ID,
        number: 482,
        repository: "acme/checkout",
        version: "2.4.1",
      },
      scrubRules: [{ id: ID, signal: "log", name: "Email rule" }],
      regression: { at: NOW.toISOString(), version: "2.5.0" },
    });
  });

  test("a fix without its pull request's row is no fix; none of anything is nothing", () => {
    expect(
      readDataSecurityIssueResolutionDetails({ fix: { number: 482 } }),
    ).toEqual({});
    expect(readDataSecurityIssueResolutionDetails(null)).toEqual({});
    expect(readDataSecurityIssueResolutionDetails([1, 2])).toEqual({});
  });

  test("written as the column takes them: what reads back, and nothing else", () => {
    expect(
      toResolutionDetailsJSON({
        at: NOW.toISOString(),
        responseAction: DataSecurityResponseAction.BlockPublicAccess,
      }),
    ).toEqual({
      at: NOW.toISOString(),
      responseAction: DataSecurityResponseAction.BlockPublicAccess,
    });
  });

  test("an address is only a web address", () => {
    expect(readResolutionUrl("https://github.com/acme/checkout/pull/482")).toBe(
      "https://github.com/acme/checkout/pull/482",
    );
    expect(readResolutionUrl("data:text/html,hi")).toBeUndefined();
  });
});

describe("a response action's change, waiting for its check", () => {
  test("is read only whole: the action, when, and who", () => {
    expect(
      readDataSecurityIssuePendingResolution({
        resolution: DataSecurityIssueResolution.FixedFromHere,
        responseAction: DataSecurityResponseAction.RevokeSharing,
        at: NOW.toISOString(),
        userId: ID,
      }),
    ).toEqual({
      resolution: DataSecurityIssueResolution.FixedFromHere,
      responseAction: DataSecurityResponseAction.RevokeSharing,
      at: NOW.toISOString(),
      userId: ID,
    });
    expect(
      readDataSecurityIssuePendingResolution({
        resolution: DataSecurityIssueResolution.FixedInCode,
        responseAction: DataSecurityResponseAction.RevokeSharing,
        at: NOW.toISOString(),
      }),
    ).toBeNull();
    expect(
      readDataSecurityIssuePendingResolution({
        resolution: DataSecurityIssueResolution.FixedFromHere,
        responseAction: DataSecurityResponseAction.RevokeSharing,
      }),
    ).toBeNull();
  });

  test("explains a check passing within a week of it, and only after the issue last opened", () => {
    const pending: ReturnType<typeof readDataSecurityIssuePendingResolution> = {
      resolution: DataSecurityIssueResolution.FixedFromHere,
      responseAction: DataSecurityResponseAction.BlockPublicAccess,
      at: NOW.toISOString(),
    };
    const day: number = 24 * 60 * 60 * 1000;

    expect(
      isPendingResolutionCurrent({
        pending,
        now: new Date(NOW.getTime() + PENDING_RESOLUTION_DAYS * day),
      }),
    ).toBe(true);
    expect(
      isPendingResolutionCurrent({
        pending,
        now: new Date(NOW.getTime() + PENDING_RESOLUTION_DAYS * day + 1),
      }),
    ).toBe(false);
    expect(
      isPendingResolutionCurrent({
        pending,
        now: NOW,
        openedAt: new Date(NOW.getTime() + 1),
      }),
    ).toBe(false);
    expect(isPendingResolutionCurrent({ pending: null, now: NOW })).toBe(false);
  });
});
