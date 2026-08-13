import {
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
  WorkflowLintSeverity,
} from "../../../../UI/Components/Workflow/GraphLint";
import WorkflowStatusBar, {
  WorkflowSaveState,
  getWorkflowSaveStatePresentation,
} from "../../../../UI/Components/Workflow/WorkflowStatusBar";
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, RenderResult } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

type MakeIssueFunction = (
  severity: WorkflowLintSeverity,
  message: string,
) => WorkflowLintIssue;

const makeIssue: MakeIssueFunction = (
  severity: WorkflowLintSeverity,
  message: string,
): WorkflowLintIssue => {
  return {
    rule: WorkflowLintRule.MissingRequiredArgument,
    severity: severity,
    nodeId: "n1",
    componentId: "api-get-1",
    argumentId: null,
    message: message,
  };
};

type MakeLintResultFunction = (
  issues: Array<WorkflowLintIssue>,
) => WorkflowLintResult;

const makeLintResult: MakeLintResultFunction = (
  issues: Array<WorkflowLintIssue>,
): WorkflowLintResult => {
  return {
    issues: issues,
    errorsByNodeId: {},
    errorCount: issues.filter((issue: WorkflowLintIssue) => {
      return issue.severity === WorkflowLintSeverity.Error;
    }).length,
    warningCount: issues.filter((issue: WorkflowLintIssue) => {
      return issue.severity === WorkflowLintSeverity.Warning;
    }).length,
  };
};

const CLEAN_RESULT: WorkflowLintResult = makeLintResult([]);

describe("getWorkflowSaveStatePresentation", () => {
  test("an untouched draft is ready rather than saved", () => {
    expect(getWorkflowSaveStatePresentation(WorkflowSaveState.Idle).label).toBe(
      "Ready",
    );
  });

  test("names each of the other states", () => {
    expect(
      getWorkflowSaveStatePresentation(WorkflowSaveState.Saving).label,
    ).toBe("Saving…");
    expect(
      getWorkflowSaveStatePresentation(WorkflowSaveState.Saved).label,
    ).toBe("Saved");
    expect(
      getWorkflowSaveStatePresentation(WorkflowSaveState.Error).label,
    ).toBe("Could not save");
  });

  test("a failed save is the only red one", () => {
    expect(
      getWorkflowSaveStatePresentation(WorkflowSaveState.Error).dotClassName,
    ).toContain("red");
    expect(
      getWorkflowSaveStatePresentation(WorkflowSaveState.Saved).dotClassName,
    ).not.toContain("red");
    expect(
      getWorkflowSaveStatePresentation(WorkflowSaveState.Idle).dotClassName,
    ).not.toContain("red");
  });
});

describe("WorkflowStatusBar — save state", () => {
  test("shows the save state", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar saveState={WorkflowSaveState.Saved} />,
    );

    expect(getByTestId("workflow-save-status")).toHaveTextContent("Saved");
  });

  test("shows a save that failed", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar saveState={WorkflowSaveState.Error} />,
    );

    expect(getByTestId("workflow-save-status")).toHaveTextContent(
      "Could not save",
    );
  });
});

describe("WorkflowStatusBar — the run it started", () => {
  test("says nothing when no run is being watched", () => {
    const { queryByTestId }: RenderResult = render(
      <WorkflowStatusBar saveState={WorkflowSaveState.Saved} />,
    );

    expect(queryByTestId("workflow-run-status")).not.toBeInTheDocument();
  });

  test("shows what the run is doing", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        runStatusMessage="Run in progress…"
      />,
    );

    expect(getByTestId("workflow-run-status")).toHaveTextContent(
      "Run in progress…",
    );
  });

  test("colours a failed run red", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        runStatusMessage="Run failed."
        runStatusFailed={true}
      />,
    );

    expect(getByTestId("workflow-run-status").className).toContain(
      "text-red-700",
    );
  });

  test("leaves a run that is still going neutral", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        runStatusMessage="Run in progress…"
      />,
    );

    expect(getByTestId("workflow-run-status").className).not.toContain(
      "text-red-700",
    );
  });
});

describe("WorkflowStatusBar — what the checks found", () => {
  test("shows nothing about the checks before they have run", () => {
    const { queryByTestId }: RenderResult = render(
      <WorkflowStatusBar saveState={WorkflowSaveState.Saved} />,
    );

    expect(queryByTestId("workflow-lint-status")).not.toBeInTheDocument();
    expect(
      queryByTestId("workflow-lint-status-button"),
    ).not.toBeInTheDocument();
  });

  test("says so when there is nothing wrong", () => {
    const { getByTestId, queryByTestId }: RenderResult = render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        lintResult={CLEAN_RESULT}
      />,
    );

    expect(getByTestId("workflow-lint-status")).toHaveTextContent(
      "No problems",
    );
    expect(
      queryByTestId("workflow-lint-status-button"),
    ).not.toBeInTheDocument();
  });

  test("counts what it found", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        lintResult={makeLintResult([
          makeIssue(WorkflowLintSeverity.Error, "An error."),
          makeIssue(WorkflowLintSeverity.Warning, "A warning."),
        ])}
      />,
    );

    expect(getByTestId("workflow-lint-status-button")).toHaveTextContent(
      "1 error, 1 warning",
    );
  });

  test("the counts are a button, not underlined text", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        lintResult={makeLintResult([
          makeIssue(WorkflowLintSeverity.Error, "An error."),
        ])}
      />,
    );

    const button: HTMLElement = getByTestId("workflow-lint-status-button");

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).not.toContain("underline");
  });

  test("opens the list when clicked", () => {
    const onShowIssues: MockFunction = getJestMockFunction();

    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        lintResult={makeLintResult([
          makeIssue(WorkflowLintSeverity.Error, "An error."),
        ])}
        onShowIssues={onShowIssues}
      />,
    );

    fireEvent.click(getByTestId("workflow-lint-status-button"));

    expect(onShowIssues).toHaveBeenCalledTimes(1);
  });

  test("an error makes the pill red", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        lintResult={makeLintResult([
          makeIssue(WorkflowLintSeverity.Error, "An error."),
          makeIssue(WorkflowLintSeverity.Warning, "A warning."),
        ])}
      />,
    );

    expect(getByTestId("workflow-lint-status-button").className).toContain(
      "text-red-700",
    );
  });

  test("warnings on their own make the pill amber", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        lintResult={makeLintResult([
          makeIssue(WorkflowLintSeverity.Warning, "A warning."),
        ])}
      />,
    );

    const className: string = getByTestId(
      "workflow-lint-status-button",
    ).className;

    expect(className).toContain("text-amber-800");
    expect(className).not.toContain("text-red-700");
  });

  test("the pill says out loud what it opens", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        lintResult={makeLintResult([
          makeIssue(WorkflowLintSeverity.Error, "An error."),
          makeIssue(WorkflowLintSeverity.Error, "Another error."),
        ])}
      />,
    );

    expect(getByTestId("workflow-lint-status-button")).toHaveAttribute(
      "aria-label",
      "2 errors found in this workflow. Open the list.",
    );
  });
});
