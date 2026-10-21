/*
 * A run's status, in words.
 *
 * The run lists draw it as a pill, and a downloaded log heads itself with it.
 * Two of the stored values read differently on screen - "Success" is
 * "Executed", and "Workflow Count Exceeded" is "Execution Exceeded Current
 * Plan" - so both places read from one table, and this holds them together.
 */

import WorkflowStatusElement from "../../../../UI/Components/Workflow/WorkflowStatus";
import WorkflowStatus, {
  UNKNOWN_WORKFLOW_STATUS_LABEL,
  getWorkflowStatusLabel,
} from "../../../../Types/Workflow/WorkflowStatus";
import { getWorkflowRunHeadingLines } from "../../../../UI/Components/Workflow/WorkflowRunExport";
import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

const EVERY_STATUS: Array<WorkflowStatus> = Object.values(WorkflowStatus);

describe("a run's status, in words", () => {
  afterEach(() => {
    cleanup();
  });

  test.each([
    [WorkflowStatus.Scheduled, "Scheduled"],
    [WorkflowStatus.Running, "Running"],
    [WorkflowStatus.Waiting, "Waiting"],
    [WorkflowStatus.Success, "Executed"],
    [WorkflowStatus.Error, "Error"],
    [WorkflowStatus.Timeout, "Timeout"],
    [WorkflowStatus.WorkflowCountExceeded, "Execution Exceeded Current Plan"],
  ])("%s reads as %s", (status: WorkflowStatus, label: string) => {
    expect(getWorkflowStatusLabel(status)).toBe(label);
  });

  test("every status has words of its own", () => {
    for (const status of EVERY_STATUS) {
      expect({ status, label: getWorkflowStatusLabel(status) }).not.toEqual({
        status,
        label: UNKNOWN_WORKFLOW_STATUS_LABEL,
      });
    }
  });

  test.each([[null], [undefined], [""], ["Paused"]])(
    "%j is Unknown, as the pill has always said",
    (status: string | null | undefined) => {
      expect(getWorkflowStatusLabel(status)).toBe("Unknown");
    },
  );

  test.each(EVERY_STATUS)(
    "the pill and a downloaded log agree on %s",
    (status: WorkflowStatus) => {
      const { container } = render(<WorkflowStatusElement status={status} />);

      expect(container).toHaveTextContent(getWorkflowStatusLabel(status));
      expect(getWorkflowRunHeadingLines({ status })).toEqual([
        `Status: ${getWorkflowStatusLabel(status)}`,
      ]);
    },
  );

  test("the pill still says Unknown for a status it does not know", () => {
    const { container } = render(
      <WorkflowStatusElement status={"Paused" as WorkflowStatus} />,
    );

    expect(container).toHaveTextContent("Unknown");
  });
});
