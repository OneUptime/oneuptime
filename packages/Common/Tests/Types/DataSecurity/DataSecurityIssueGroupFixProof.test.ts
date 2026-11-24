import { DataSecurityAiProposalKind } from "../../../Types/DataSecurity/DataSecurityAi";
import {
  IssueGroupFixProofIssue,
  IssueGroupFixProofStanding,
  getIssueGroupFixProofStanding,
  isIssueClosedByGroupFix,
} from "../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import DataSecurityIssueResolution, {
  ALL_DATA_SECURITY_ISSUE_RESOLUTIONS,
} from "../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataSecurityResponseAction } from "../../../Types/DataSecurity/DataSecurityResponseAction";
import { describe, expect, test } from "@jest/globals";

/*
 * WHETHER A GROUP'S FIX WORKED (#10738), AS DATA.
 *
 * A group's fix is proven - and AI Results counts it among the changes that
 * worked - once every issue it fixed is closed, each by the fix itself, as
 * #10368's resolutions say: the pull request's issues as Fixed in
 * infrastructure code by its own task, the one approval's as Fixed from
 * here by the action it ran, after it ran. An issue closed any other way
 * proves nothing, and one still open is waited for.
 */

const CODE: DataSecurityAiProposalKind =
  DataSecurityAiProposalKind.FixIssueGroupInCode;
const CLOUD: DataSecurityAiProposalKind =
  DataSecurityAiProposalKind.FixIssueGroupInCloud;
const TASK_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_TASK_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const APPLIED_AT: Date = new Date("2026-11-20T10:00:00.000Z");
const AFTER: string = "2026-11-21T10:00:00.000Z";
const BEFORE: string = "2026-11-19T10:00:00.000Z";
const VERSIONING: DataSecurityResponseAction =
  DataSecurityResponseAction.TurnOnVersioning;

function fixedInCode(taskId: string = TASK_ID): IssueGroupFixProofIssue {
  return {
    status: DataSecurityIssueStatus.Resolved,
    resolution: DataSecurityIssueResolution.FixedInInfrastructureCode,
    resolvedAt: AFTER,
    fixTaskId: taskId,
  };
}

function fixedFromHere(
  action: string = VERSIONING,
  resolvedAt: string = AFTER,
): IssueGroupFixProofIssue {
  return {
    status: DataSecurityIssueStatus.Resolved,
    resolution: DataSecurityIssueResolution.FixedFromHere,
    resolvedAt,
    responseAction: action,
    expectedAction: VERSIONING,
  };
}

describe("a group's pull request", () => {
  test("is proven once every issue it lists resolved as Fixed in infrastructure code by its own task", () => {
    expect(
      getIssueGroupFixProofStanding({
        kind: CODE,
        taskId: TASK_ID,
        issues: [fixedInCode(), fixedInCode(TASK_ID.toUpperCase())],
      }),
    ).toBe(IssueGroupFixProofStanding.Proven);
  });

  test("waits while one of its issues is open, whatever the others say", () => {
    expect(
      getIssueGroupFixProofStanding({
        kind: CODE,
        taskId: TASK_ID,
        issues: [
          fixedInCode(),
          { status: DataSecurityIssueStatus.Open },
          {
            status: DataSecurityIssueStatus.Accepted,
          },
        ],
      }),
    ).toBe(IssueGroupFixProofStanding.Waiting);
  });

  test("is not proven by an issue another pull request fixed", () => {
    expect(
      getIssueGroupFixProofStanding({
        kind: CODE,
        taskId: TASK_ID,
        issues: [fixedInCode(), fixedInCode(OTHER_TASK_ID)],
      }),
    ).toBe(IssueGroupFixProofStanding.ClosedOtherwise);
  });

  test("is not proven when either side names no task", () => {
    expect(
      getIssueGroupFixProofStanding({
        kind: CODE,
        taskId: TASK_ID,
        issues: [{ ...fixedInCode(), fixTaskId: undefined }],
      }),
    ).toBe(IssueGroupFixProofStanding.ClosedOtherwise);
    expect(
      getIssueGroupFixProofStanding({
        kind: CODE,
        issues: [fixedInCode()],
      }),
    ).toBe(IssueGroupFixProofStanding.ClosedOtherwise);
  });

  test("is not proven by an issue whose check passed for no change OneUptime knows of, before its production check said so", () => {
    expect(
      getIssueGroupFixProofStanding({
        kind: CODE,
        taskId: TASK_ID,
        issues: [
          fixedInCode(),
          {
            status: DataSecurityIssueStatus.Resolved,
            resolution: DataSecurityIssueResolution.CheckPassed,
            resolvedAt: AFTER,
          },
        ],
      }),
    ).toBe(IssueGroupFixProofStanding.ClosedOtherwise);
  });
});

describe("a group's one approval", () => {
  test("is proven once every issue whose store it changed resolved as Fixed from here, by its action, after it ran", () => {
    expect(
      getIssueGroupFixProofStanding({
        kind: CLOUD,
        appliedAt: APPLIED_AT,
        issues: [fixedFromHere(), fixedFromHere()],
      }),
    ).toBe(IssueGroupFixProofStanding.Proven);
  });

  test("is not proven by a store fixed from here by another action", () => {
    expect(
      getIssueGroupFixProofStanding({
        kind: CLOUD,
        appliedAt: APPLIED_AT,
        issues: [
          fixedFromHere(),
          fixedFromHere(DataSecurityResponseAction.BlockPublicAccess),
        ],
      }),
    ).toBe(IssueGroupFixProofStanding.ClosedOtherwise);
  });

  test("is not proven by a store fixed from here before it ran: another hand fixed it", () => {
    expect(
      getIssueGroupFixProofStanding({
        kind: CLOUD,
        appliedAt: APPLIED_AT,
        issues: [fixedFromHere(VERSIONING, BEFORE)],
      }),
    ).toBe(IssueGroupFixProofStanding.ClosedOtherwise);
  });

  test("a proposal from before it said each store's action is proven by any action from here", () => {
    expect(
      getIssueGroupFixProofStanding({
        kind: CLOUD,
        appliedAt: APPLIED_AT,
        issues: [
          {
            ...fixedFromHere(DataSecurityResponseAction.TurnOnSoftDelete),
            expectedAction: undefined,
          },
        ],
      }),
    ).toBe(IssueGroupFixProofStanding.Proven);
  });

  test("with no moment to compare, the resolution alone decides", () => {
    expect(
      getIssueGroupFixProofStanding({
        kind: CLOUD,
        issues: [fixedFromHere(VERSIONING, BEFORE)],
      }),
    ).toBe(IssueGroupFixProofStanding.Proven);
    expect(
      getIssueGroupFixProofStanding({
        kind: CLOUD,
        appliedAt: "not a date",
        issues: [{ ...fixedFromHere(), resolvedAt: null }],
      }),
    ).toBe(IssueGroupFixProofStanding.Proven);
  });
});

describe("nothing proves a fix but its issues' own checks", () => {
  test("a fix that fixed no issue has nothing to prove", () => {
    expect(
      getIssueGroupFixProofStanding({ kind: CODE, taskId: TASK_ID, issues: [] }),
    ).toBe(IssueGroupFixProofStanding.NothingToProve);
    expect(getIssueGroupFixProofStanding({ kind: CLOUD, issues: [] })).toBe(
      IssueGroupFixProofStanding.NothingToProve,
    );
  });

  test.each([
    DataSecurityIssueStatus.Accepted,
    DataSecurityIssueStatus.NotAnIssue,
    "Deleted",
  ])("an issue that is %s was closed some other way", (status: string) => {
    for (const kind of [CODE, CLOUD]) {
      expect(
        getIssueGroupFixProofStanding({
          kind,
          taskId: TASK_ID,
          appliedAt: APPLIED_AT,
          issues: [
            kind === CODE ? fixedInCode() : fixedFromHere(),
            { status, resolution: null },
          ],
        }),
      ).toBe(IssueGroupFixProofStanding.ClosedOtherwise);
    }
  });

  test.each(ALL_DATA_SECURITY_ISSUE_RESOLUTIONS)(
    "a pull request's issue resolved as %s proves it only when that is Fixed in infrastructure code",
    (resolution: DataSecurityIssueResolution) => {
      const closed: boolean = isIssueClosedByGroupFix({
        kind: CODE,
        taskId: TASK_ID,
        issue: {
          status: DataSecurityIssueStatus.Resolved,
          resolution,
          resolvedAt: AFTER,
          fixTaskId: TASK_ID,
          responseAction: VERSIONING,
        },
      });

      expect(closed).toBe(
        resolution === DataSecurityIssueResolution.FixedInInfrastructureCode,
      );
    },
  );

  test.each(ALL_DATA_SECURITY_ISSUE_RESOLUTIONS)(
    "a one approval's issue resolved as %s proves it only when that is Fixed from here",
    (resolution: DataSecurityIssueResolution) => {
      const closed: boolean = isIssueClosedByGroupFix({
        kind: CLOUD,
        appliedAt: APPLIED_AT,
        issue: {
          status: DataSecurityIssueStatus.Resolved,
          resolution,
          resolvedAt: AFTER,
          fixTaskId: TASK_ID,
          responseAction: VERSIONING,
          expectedAction: VERSIONING,
        },
      });

      expect(closed).toBe(
        resolution === DataSecurityIssueResolution.FixedFromHere,
      );
    },
  );

  test("a resolution on an issue that is not resolved proves nothing", () => {
    expect(
      isIssueClosedByGroupFix({
        kind: CODE,
        taskId: TASK_ID,
        issue: { ...fixedInCode(), status: DataSecurityIssueStatus.Accepted },
      }),
    ).toBe(false);
  });

  test("a proposal that is no group's fix is never proven here", () => {
    expect(
      isIssueClosedByGroupFix({
        kind: DataSecurityAiProposalKind.ScrubTelemetry,
        taskId: TASK_ID,
        issue: fixedFromHere(),
      }),
    ).toBe(false);
  });
});
