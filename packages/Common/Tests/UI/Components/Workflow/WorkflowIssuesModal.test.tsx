import {
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
  WorkflowLintSeverity,
} from "../../../../UI/Components/Workflow/GraphLint";
import WorkflowIssuesModal from "../../../../UI/Components/Workflow/WorkflowIssuesModal";
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, RenderResult } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

type MakeIssueFunction = (params: {
  rule?: WorkflowLintRule | undefined;
  severity?: WorkflowLintSeverity | undefined;
  nodeId?: string | null | undefined;
  componentId?: string | null | undefined;
  message?: string | undefined;
}) => WorkflowLintIssue;

const makeIssue: MakeIssueFunction = (params: {
  rule?: WorkflowLintRule | undefined;
  severity?: WorkflowLintSeverity | undefined;
  nodeId?: string | null | undefined;
  componentId?: string | null | undefined;
  message?: string | undefined;
}): WorkflowLintIssue => {
  return {
    rule: params.rule || WorkflowLintRule.MissingRequiredArgument,
    severity: params.severity || WorkflowLintSeverity.Error,
    nodeId: params.nodeId === undefined ? "n1" : params.nodeId,
    componentId:
      params.componentId === undefined ? "api-get-1" : params.componentId,
    argumentId: null,
    message: params.message || "Something is wrong.",
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

type NoopFunction = () => void;

const noop: NoopFunction = (): void => {};

describe("WorkflowIssuesModal — the panel itself", () => {
  test("keeps the title and the sentence explaining why the list exists", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([makeIssue({})])}
        onClose={noop}
      />,
    );

    expect(getByTestId("modal-title")).toHaveTextContent(
      "Problems with this workflow",
    );
    expect(getByTestId("modal-description")).toHaveTextContent(
      "Fixing them here saves a failed run later.",
    );
  });

  test("closes from the footer button", () => {
    const onClose: MockFunction = getJestMockFunction();

    const { getByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([makeIssue({})])}
        onClose={onClose}
      />,
    );

    fireEvent.click(getByTestId("modal-footer-close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closes from the header button, which the old panel did not have", () => {
    const onClose: MockFunction = getJestMockFunction();

    const { getByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([makeIssue({})])}
        onClose={onClose}
      />,
    );

    fireEvent.click(getByTestId("close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("WorkflowIssuesModal — nothing to show", () => {
  test("says so rather than showing an empty box", () => {
    const { getByTestId, queryAllByTestId }: RenderResult = render(
      <WorkflowIssuesModal lintResult={makeLintResult([])} onClose={noop} />,
    );

    expect(getByTestId("workflow-issues-empty")).toHaveTextContent(
      "Nothing to fix here",
    );
    expect(queryAllByTestId("workflow-issue-group")).toHaveLength(0);
  });

  test("shows no counts when there is nothing to count", () => {
    const { queryByTestId }: RenderResult = render(
      <WorkflowIssuesModal lintResult={makeLintResult([])} onClose={noop} />,
    );

    expect(queryByTestId("workflow-issues-summary")).not.toBeInTheDocument();
  });
});

describe("WorkflowIssuesModal — grouping", () => {
  test("a step reported twice is one card, not two", () => {
    const { queryAllByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({
            nodeId: "n1",
            componentId: "monitor-secret-create-one-1",
            severity: WorkflowLintSeverity.Warning,
            message:
              "Nothing connects to this step from the trigger, so it will never run.",
          }),
          makeIssue({
            nodeId: "n1",
            componentId: "monitor-secret-create-one-1",
            message: '"JSON Object" is required but empty.',
          }),
        ])}
        onClose={noop}
      />,
    );

    expect(queryAllByTestId("workflow-issue-group")).toHaveLength(1);
    expect(queryAllByTestId("workflow-issue")).toHaveLength(2);
  });

  test("different steps get a card each", () => {
    const { queryAllByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ nodeId: "n1", componentId: "api-get-1" }),
          makeIssue({ nodeId: "n2", componentId: "api-post-1" }),
        ])}
        onClose={noop}
      />,
    );

    expect(queryAllByTestId("workflow-issue-group")).toHaveLength(2);
  });

  test("heads a card with the step's name and its id underneath", () => {
    const { getByText }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({
            nodeId: "n1",
            componentId: "monitor-secret-create-one-1",
          }),
        ])}
        stepTitlesByNodeId={{ n1: "Create Monitor Secret" }}
        onClose={noop}
      />,
    );

    expect(getByText("Create Monitor Secret")).toBeInTheDocument();
    expect(getByText("monitor-secret-create-one-1")).toBeInTheDocument();
  });

  test("does not print the step id twice when it is all the card has to go on", () => {
    const { queryAllByText }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ nodeId: "n1", componentId: "api-get-1" }),
        ])}
        onClose={noop}
      />,
    );

    expect(queryAllByText("api-get-1")).toHaveLength(1);
  });

  test("issues about the graph itself are headed as the workflow", () => {
    const { getByText }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({
            rule: WorkflowLintRule.NoTrigger,
            nodeId: null,
            componentId: null,
            message: "This workflow has no trigger, so it can never start.",
          }),
        ])}
        onClose={noop}
      />,
    );

    expect(getByText("This workflow")).toBeInTheDocument();
  });

  test("shows every message the checks produced", () => {
    const { getByText }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ nodeId: "n1", message: "First problem." }),
          makeIssue({ nodeId: "n2", message: "Second problem." }),
        ])}
        onClose={noop}
      />,
    );

    expect(getByText("First problem.")).toBeInTheDocument();
    expect(getByText("Second problem.")).toBeInTheDocument();
  });
});

describe("WorkflowIssuesModal — counts", () => {
  test("totals the whole list at the top", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ nodeId: "n1", message: "One." }),
          makeIssue({ nodeId: "n2", message: "Two." }),
          makeIssue({
            nodeId: "n2",
            severity: WorkflowLintSeverity.Warning,
            message: "Three.",
          }),
        ])}
        onClose={noop}
      />,
    );

    expect(getByTestId("workflow-issues-error-count")).toHaveTextContent(
      "2 errors",
    );
    expect(getByTestId("workflow-issues-warning-count")).toHaveTextContent(
      "1 warning",
    );
    expect(getByTestId("workflow-issues-summary")).toHaveTextContent(
      "across 2 places",
    );
  });

  test("says one place in the singular", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([makeIssue({ nodeId: "n1" })])}
        onClose={noop}
      />,
    );

    expect(getByTestId("workflow-issues-summary")).toHaveTextContent(
      "across 1 place",
    );
  });

  test("leaves out a count of zero", () => {
    const { getByTestId, queryByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ severity: WorkflowLintSeverity.Warning }),
        ])}
        onClose={noop}
      />,
    );

    expect(
      queryByTestId("workflow-issues-error-count"),
    ).not.toBeInTheDocument();
    expect(getByTestId("workflow-issues-warning-count")).toHaveTextContent(
      "1 warning",
    );
  });

  test("counts each card as well as the whole list", () => {
    const { getAllByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ nodeId: "n1", message: "One." }),
          makeIssue({ nodeId: "n1", message: "Two." }),
          makeIssue({
            nodeId: "n1",
            severity: WorkflowLintSeverity.Warning,
            message: "Three.",
          }),
        ])}
        onClose={noop}
      />,
    );

    expect(
      getAllByTestId("workflow-issue-group-error-count")[0],
    ).toHaveTextContent("2 errors");
    expect(
      getAllByTestId("workflow-issue-group-warning-count")[0],
    ).toHaveTextContent("1 warning");
  });
});

describe("WorkflowIssuesModal — severity", () => {
  test("marks an error and a warning differently", () => {
    const { queryAllByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ nodeId: "n1", message: "An error." }),
          makeIssue({
            nodeId: "n1",
            severity: WorkflowLintSeverity.Warning,
            message: "A warning.",
          }),
        ])}
        onClose={noop}
      />,
    );

    expect(queryAllByTestId("workflow-issue-error-icon")).toHaveLength(1);
    expect(queryAllByTestId("workflow-issue-warning-icon")).toHaveLength(1);
  });

  test("says the severity in words, so it does not rest on colour alone", () => {
    const { getByText }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ nodeId: "n1", message: "An error." }),
          makeIssue({
            nodeId: "n1",
            severity: WorkflowLintSeverity.Warning,
            message: "A warning.",
          }),
        ])}
        onClose={noop}
      />,
    );

    expect(getByText(/^Error:/)).toBeInTheDocument();
    expect(getByText(/^Warning:/)).toBeInTheDocument();
  });

  test("puts errors above warnings inside a card", () => {
    const { getAllByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({
            nodeId: "n1",
            severity: WorkflowLintSeverity.Warning,
            message: "A warning.",
          }),
          makeIssue({ nodeId: "n1", message: "An error." }),
        ])}
        onClose={noop}
      />,
    );

    const issues: Array<HTMLElement> = getAllByTestId("workflow-issue");

    expect(issues[0]).toHaveTextContent("An error.");
    expect(issues[1]).toHaveTextContent("A warning.");
  });

  test("puts the workflow's own problems above the steps", () => {
    const { getAllByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ nodeId: "n1", message: "A step problem." }),
          makeIssue({
            rule: WorkflowLintRule.NoTrigger,
            nodeId: null,
            componentId: null,
            message: "This workflow has no trigger.",
          }),
        ])}
        onClose={noop}
      />,
    );

    const groups: Array<HTMLElement> = getAllByTestId("workflow-issue-group");

    expect(groups[0]).toHaveTextContent("This workflow has no trigger.");
    expect(groups[1]).toHaveTextContent("A step problem.");
  });
});

describe("WorkflowIssuesModal — getting to the step", () => {
  test("offers to open the step the issues belong to", () => {
    const onGoToStep: MockFunction = getJestMockFunction();

    const { getByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ nodeId: "n1", componentId: "api-get-1" }),
        ])}
        stepTitlesByNodeId={{ n1: "Make API Request" }}
        onClose={noop}
        onGoToStep={onGoToStep}
      />,
    );

    fireEvent.click(getByTestId("workflow-issue-go-to-step"));

    expect(onGoToStep).toHaveBeenCalledTimes(1);
    expect(onGoToStep).toHaveBeenCalledWith("n1");
  });

  test("names the step it would open", () => {
    const { getByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([makeIssue({ nodeId: "n1" })])}
        stepTitlesByNodeId={{ n1: "Make API Request" }}
        onClose={noop}
        onGoToStep={getJestMockFunction()}
      />,
    );

    expect(getByTestId("workflow-issue-go-to-step")).toHaveAttribute(
      "aria-label",
      "Open settings for Make API Request",
    );
  });

  test("offers nothing for a problem with the workflow itself — there is no step to open", () => {
    const { queryByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({
            rule: WorkflowLintRule.NoTrigger,
            nodeId: null,
            componentId: null,
            message: "This workflow has no trigger.",
          }),
        ])}
        onClose={noop}
        onGoToStep={getJestMockFunction()}
      />,
    );

    expect(queryByTestId("workflow-issue-go-to-step")).not.toBeInTheDocument();
  });

  test("offers nothing when the page cannot open steps", () => {
    const { queryByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([makeIssue({ nodeId: "n1" })])}
        onClose={noop}
      />,
    );

    expect(queryByTestId("workflow-issue-go-to-step")).not.toBeInTheDocument();
  });

  test("offers one per card when several steps have problems", () => {
    const { getAllByTestId }: RenderResult = render(
      <WorkflowIssuesModal
        lintResult={makeLintResult([
          makeIssue({ nodeId: "n1", componentId: "api-get-1" }),
          makeIssue({ nodeId: "n2", componentId: "api-post-1" }),
        ])}
        onClose={noop}
        onGoToStep={getJestMockFunction()}
      />,
    );

    expect(getAllByTestId("workflow-issue-go-to-step")).toHaveLength(2);
  });
});
