import WorkflowLogModal, {
  FULL_LOG_TAB_NAME,
  STEPS_TAB_NAME,
} from "../../../../UI/Components/Workflow/WorkflowLogModal";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
} from "../../../../Types/Workflow/StepTrace";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const traceWithOneStep: () => WorkflowStepTrace = (): WorkflowStepTrace => {
  return {
    steps: [
      {
        componentId: "api-get-1",
        metadataId: "api-get",
        title: "Get from API",
        status: WorkflowStepStatus.Success,
        startedAt: "2024-01-01T00:00:00.000Z",
        completedAt: "2024-01-01T00:00:01.000Z",
        durationInMs: 1000,
        argumentValues: {},
        returnValues: {},
        executedPort: "out",
      },
    ],
  };
};

const openLogTab: () => void = (): void => {
  fireEvent.click(screen.getByTestId(`tab-${FULL_LOG_TAB_NAME}`));
};

describe("WorkflowLogModal", () => {
  afterEach(() => {
    cleanup();
  });

  test("opens on the steps, with the log a tab away", () => {
    render(
      <WorkflowLogModal
        logs={"line one\nline two"}
        stepTrace={traceWithOneStep()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId(`tab-${STEPS_TAB_NAME}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Get from API")).toBeInTheDocument();

    // The other tab's content is not rendered until it is asked for.
    expect(screen.queryByText("line one")).not.toBeInTheDocument();

    openLogTab();

    expect(screen.getByText("line one")).toBeInTheDocument();
    expect(screen.getByText("line two")).toBeInTheDocument();
  });

  test("counts the steps on the tab", () => {
    render(
      <WorkflowLogModal
        logs=""
        stepTrace={traceWithOneStep()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId(`tab-${STEPS_TAB_NAME}`)).toHaveTextContent("1");
  });

  /*
   * A run that is still going has usually logged nothing yet. Saying so beats
   * an empty black rectangle that looks like a broken viewer.
   */
  test("says why the log is empty, and whether more is coming", () => {
    const { rerender } = render(
      <WorkflowLogModal
        logs=""
        stepTrace={{ steps: [] }}
        isRunning={true}
        onClose={jest.fn()}
      />,
    );

    openLogTab();
    expect(
      screen.getByText("Nothing has been logged yet."),
    ).toBeInTheDocument();

    rerender(
      <WorkflowLogModal
        logs=""
        stepTrace={{ steps: [] }}
        isRunning={false}
        onClose={jest.fn()}
      />,
    );

    expect(
      screen.getByText("This run did not log anything."),
    ).toBeInTheDocument();
  });

  test("shows the run's status above the tabs, on either tab", () => {
    render(
      <WorkflowLogModal
        logs="a line"
        stepTrace={traceWithOneStep()}
        statusMessage="Run running…"
        isRunning={true}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText("Run running…")).toBeInTheDocument();

    openLogTab();

    expect(screen.getByText("Run running…")).toBeInTheDocument();
  });

  test("closes", () => {
    const onClose: () => void = jest.fn();

    render(
      <WorkflowLogModal logs="" stepTrace={{ steps: [] }} onClose={onClose} />,
    );

    fireEvent.click(screen.getByText("Close"));

    expect(onClose).toHaveBeenCalled();
  });
});
