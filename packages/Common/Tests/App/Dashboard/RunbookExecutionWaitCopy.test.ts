import { describe, expect, test } from "@jest/globals";
import {
  APPROVED_BY_LABEL,
  APPROVE_AND_CONTINUE_BUTTON,
  APPROVE_AND_RUN_BUTTON,
  APPROVE_TO_RUN_NOTE,
  MARK_COMPLETE_BUTTON,
  RUN_WAITS_FOR_APPROVAL_TO_CONTINUE,
  RUN_WAITS_FOR_APPROVAL_TO_RUN,
  RUN_WAITS_ON_MANUAL_STEP,
  WAITING_FOR_APPROVAL_LABEL,
  WAITING_FOR_YOU_LABEL,
  getRunWaitingTemplate,
  getWaitingStepButtonTitle,
  getWaitingStepStatusLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookExecutionWaitCopy";
import { RunbookStepWait } from "../../../Types/Runbook/RunbookStepApproval";
import fs from "fs";
import path from "path";

/*
 * WHAT A RUN'S EXECUTION PAGE SAYS ABOUT THE STEP IT WAITS ON
 * (RunbookExecutionWaitCopy): it names the step, says why the run waits,
 * and offers the one button that moves it on - "Mark complete" on a Manual
 * step, "Approve and run" on a step that asks for approval before it runs,
 * and "Approve & continue" on a step of a run started before approvals
 * moved, which ran and waits. The page draws these, and only these.
 */

const EXECUTION_VIEW: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView.tsx",
);

describe("the step a run waits on", () => {
  test("offers the button that moves the run on, by why it waits", () => {
    expect(getWaitingStepButtonTitle(RunbookStepWait.Manual)).toBe(
      "Mark complete",
    );
    expect(getWaitingStepButtonTitle(RunbookStepWait.ApprovalToRun)).toBe(
      "Approve and run",
    );
    expect(getWaitingStepButtonTitle(RunbookStepWait.ApprovalToContinue)).toBe(
      "Approve & continue",
    );
    expect([
      MARK_COMPLETE_BUTTON,
      APPROVE_AND_RUN_BUTTON,
      APPROVE_AND_CONTINUE_BUTTON,
    ]).toEqual(["Mark complete", "Approve and run", "Approve & continue"]);
  });

  test("its pill: a Manual step waits for you, an approval waits for approval", () => {
    expect(getWaitingStepStatusLabel(RunbookStepWait.Manual)).toBe(
      WAITING_FOR_YOU_LABEL,
    );
    expect(getWaitingStepStatusLabel(RunbookStepWait.ApprovalToRun)).toBe(
      WAITING_FOR_APPROVAL_LABEL,
    );
    expect(getWaitingStepStatusLabel(RunbookStepWait.ApprovalToContinue)).toBe(
      WAITING_FOR_APPROVAL_LABEL,
    );
    expect(WAITING_FOR_YOU_LABEL).toBe("Waiting for you");
    expect(WAITING_FOR_APPROVAL_LABEL).toBe("Waiting for approval");
  });

  test("the run's card names the step it waits on, and why", () => {
    expect(getRunWaitingTemplate(RunbookStepWait.Manual)).toBe(
      'Waiting on "{{title}}". Tick it off below to continue.',
    );
    expect(getRunWaitingTemplate(RunbookStepWait.ApprovalToRun)).toBe(
      'Waiting for approval to run "{{title}}".',
    );
    expect(getRunWaitingTemplate(RunbookStepWait.ApprovalToContinue)).toBe(
      'Waiting for approval to continue after "{{title}}".',
    );
    for (const template of [
      RUN_WAITS_ON_MANUAL_STEP,
      RUN_WAITS_FOR_APPROVAL_TO_RUN,
      RUN_WAITS_FOR_APPROVAL_TO_CONTINUE,
    ]) {
      expect(template).toContain("{{title}}");
    }
  });

  test("a step that waits to run says it runs once approved; who approved is said after", () => {
    expect(APPROVE_TO_RUN_NOTE).toBe("This step runs once someone approves it.");
    expect(APPROVED_BY_LABEL).toBe("Approved by");
  });
});

describe("the execution page draws these words, and no others for a waiting step", () => {
  const source: string = fs.readFileSync(EXECUTION_VIEW, "utf8");

  test("its buttons, pill, card sentence, note and approver come from the copy", () => {
    for (const name of [
      "getWaitingStepButtonTitle(",
      "getWaitingStepStatusLabel(wait)",
      "getRunWaitingTemplate(awaitingWait)",
      "APPROVE_TO_RUN_NOTE",
      "APPROVED_BY_LABEL",
    ]) {
      expect({ name, drawn: source.includes(name) }).toEqual({
        name,
        drawn: true,
      });
    }
  });

  test("the old hand-written button choice is gone", () => {
    expect(source).not.toContain('? "Approve & continue"');
    expect(source).not.toContain(': "Mark complete"');
    expect(source).not.toContain("isWaitingForApproval");
  });

  test("the people who approved are fetched with those who completed or skipped", () => {
    expect(source).toContain("userIdsToFetch.add(s.approvedByUserId);");
  });
});
