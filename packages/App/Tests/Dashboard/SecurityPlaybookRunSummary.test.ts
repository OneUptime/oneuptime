import { describe, expect, test } from "@jest/globals";
import { JSONArray } from "Common/Types/JSON";
import {
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  RunStepsSummary,
  getRunStepRows,
  summarizeRunSteps,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunStepRows";

/*
 * A list of playbook runs - every run of the project, a playbook's latest -
 * draws each run as its header and one line of how far it got, its steps a
 * click away (SecurityPlaybookRunCard's isCollapsible). The line is
 * summarizeRunSteps: how many steps are done, and the step a failure or a
 * rejection stopped the run at.
 */

const STEPS: JSONArray = [
  {
    id: "check",
    action: SecurityPlaybookActionType.CheckThreatIntel,
    config: {},
    requiresApproval: false,
  },
  {
    id: "activity",
    action: SecurityPlaybookActionType.LookUpEntityActivity,
    config: {},
    requiresApproval: false,
  },
  {
    id: "note",
    action: SecurityPlaybookActionType.AddCaseNote,
    config: { note: "Looked." },
    requiresApproval: false,
  },
] as unknown as JSONArray;

function summarize(
  statuses: Array<SecurityPlaybookStepStatus | undefined>,
): RunStepsSummary {
  return summarizeRunSteps(
    getRunStepRows({
      steps: STEPS,
      stepResults: statuses
        .map(
          (status: SecurityPlaybookStepStatus | undefined, index: number) => {
            return status
              ? {
                  stepId: ["check", "activity", "note"][index],
                  status,
                }
              : null;
          },
        )
        .filter(Boolean) as unknown as JSONArray,
    }),
  );
}

describe("a run in one line", () => {
  test("a run that has not started has none of its steps done", () => {
    expect(summarize([])).toEqual({
      total: 3,
      done: 0,
      stoppedAt: undefined,
    });
  });

  test("a run part way through counts the steps that succeeded", () => {
    const summary: RunStepsSummary = summarize([
      SecurityPlaybookStepStatus.Succeeded,
      SecurityPlaybookStepStatus.Running,
    ]);

    expect(summary.total).toBe(3);
    expect(summary.done).toBe(1);
    expect(summary.stoppedAt).toBeUndefined();
  });

  test("a step skipped because its condition did not hold is done", () => {
    const summary: RunStepsSummary = summarize([
      SecurityPlaybookStepStatus.Succeeded,
      SecurityPlaybookStepStatus.Skipped,
      SecurityPlaybookStepStatus.Succeeded,
    ]);

    expect(summary.done).toBe(3);
    expect(summary.stoppedAt).toBeUndefined();
  });

  test("a step waiting for approval is not done, and stops nothing", () => {
    const summary: RunStepsSummary = summarize([
      SecurityPlaybookStepStatus.Succeeded,
      SecurityPlaybookStepStatus.WaitingForApproval,
    ]);

    expect(summary.done).toBe(1);
    expect(summary.stoppedAt).toBeUndefined();
  });

  test("a failed step is where the run stopped, with its place and its name", () => {
    const summary: RunStepsSummary = summarize([
      SecurityPlaybookStepStatus.Succeeded,
      SecurityPlaybookStepStatus.Failed,
      SecurityPlaybookStepStatus.Failed,
    ]);

    expect(summary.done).toBe(1);
    // The first one: the later step failed because the run had.
    expect(summary.stoppedAt?.index).toBe(1);
    expect(summary.stoppedAt?.title).toBe(
      getSecurityPlaybookAction(SecurityPlaybookActionType.LookUpEntityActivity)
        ?.title,
    );
  });

  test("a step an approver turned down is where the run stopped too", () => {
    const summary: RunStepsSummary = summarize([
      SecurityPlaybookStepStatus.Succeeded,
      SecurityPlaybookStepStatus.Rejected,
    ]);

    expect(summary.stoppedAt?.index).toBe(1);
  });

  test("a run whose steps no longer read still counts its stored results", () => {
    const summary: RunStepsSummary = summarizeRunSteps(
      getRunStepRows({
        steps: [{ nonsense: true }] as unknown as JSONArray,
        stepResults: [
          {
            stepId: "a",
            action: SecurityPlaybookActionType.AddCaseNote,
            status: SecurityPlaybookStepStatus.Succeeded,
          },
          {
            stepId: "b",
            action: SecurityPlaybookActionType.AddCaseNote,
            status: SecurityPlaybookStepStatus.Failed,
          },
        ] as unknown as JSONArray,
      }),
    );

    expect(summary.total).toBe(2);
    expect(summary.done).toBe(1);
    expect(summary.stoppedAt?.index).toBe(1);
  });

  test("nothing to summarize is nothing done", () => {
    expect(summarizeRunSteps([])).toEqual({
      total: 0,
      done: 0,
      stoppedAt: undefined,
    });
  });
});
