/*
 * The modal a workflow run is read in.
 *
 * The two things it shows answer different questions and are now two tabs, so
 * most of what is worth pinning down is about the tabs: which one opens first,
 * that only one is mounted at a time, and — because the builder re-renders this
 * every couple of seconds while a run goes — that a poll does not throw the
 * reader back to the other tab.
 */

import WorkflowLogModal, {
  FULL_LOG_TAB_NAME,
  STEPS_TAB_NAME,
} from "../../../../UI/Components/Workflow/WorkflowLogModal";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
} from "../../../../Types/Workflow/StepTrace";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

type StepOverrides = Partial<WorkflowStepTraceEntry>;

const aStep: (overrides?: StepOverrides) => WorkflowStepTraceEntry = (
  overrides?: StepOverrides,
): WorkflowStepTraceEntry => {
  return {
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
    ...overrides,
  };
};

const traceWithOneStep: () => WorkflowStepTrace = (): WorkflowStepTrace => {
  return { steps: [aStep()] };
};

const emptyTrace: () => WorkflowStepTrace = (): WorkflowStepTrace => {
  return { steps: [] };
};

const stepsTab: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(`tab-${STEPS_TAB_NAME}`);
};

const logTab: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(`tab-${FULL_LOG_TAB_NAME}`);
};

const openLogTab: () => void = (): void => {
  fireEvent.click(logTab());
};

const openStepsTab: () => void = (): void => {
  fireEvent.click(stepsTab());
};

const isSelected: (tab: HTMLElement) => boolean = (
  tab: HTMLElement,
): boolean => {
  return tab.getAttribute("aria-selected") === "true";
};

describe("WorkflowLogModal", () => {
  afterEach(() => {
    cleanup();
  });

  describe("the two tabs", () => {
    test("opens on the steps", () => {
      render(
        <WorkflowLogModal
          logs="line one"
          stepTrace={traceWithOneStep()}
          onClose={jest.fn()}
        />,
      );

      expect(isSelected(stepsTab())).toBe(true);
      expect(isSelected(logTab())).toBe(false);
      expect(screen.getByText("Get from API")).toBeInTheDocument();
    });

    /*
     * Only the open tab is mounted. A 4000-character log and a hundred-step
     * trace do not both need to be in the document to read one of them.
     */
    test("shows one tab's content at a time", () => {
      render(
        <WorkflowLogModal
          logs={"line one\nline two"}
          stepTrace={traceWithOneStep()}
          onClose={jest.fn()}
        />,
      );

      expect(screen.queryByText("line one")).not.toBeInTheDocument();

      openLogTab();

      expect(screen.getByText("line one")).toBeInTheDocument();
      expect(screen.getByText("line two")).toBeInTheDocument();
      expect(screen.queryByText("Get from API")).not.toBeInTheDocument();
    });

    test("goes back", () => {
      render(
        <WorkflowLogModal
          logs="line one"
          stepTrace={traceWithOneStep()}
          onClose={jest.fn()}
        />,
      );

      openLogTab();
      openStepsTab();

      expect(isSelected(stepsTab())).toBe(true);
      expect(screen.getByText("Get from API")).toBeInTheDocument();
    });

    test("can be asked to open on the log instead", () => {
      render(
        <WorkflowLogModal
          logs="line one"
          stepTrace={traceWithOneStep()}
          initialTabName={FULL_LOG_TAB_NAME}
          onClose={jest.fn()}
        />,
      );

      expect(isSelected(logTab())).toBe(true);
      expect(screen.getByText("line one")).toBeInTheDocument();
    });

    test("falls back to the steps when asked for a tab it does not have", () => {
      render(
        <WorkflowLogModal
          logs="line one"
          stepTrace={traceWithOneStep()}
          initialTabName="Nonsense"
          onClose={jest.fn()}
        />,
      );

      expect(isSelected(stepsTab())).toBe(true);
    });

    test("moves between tabs with the arrow keys", () => {
      render(
        <WorkflowLogModal
          logs="line one"
          stepTrace={traceWithOneStep()}
          onClose={jest.fn()}
        />,
      );

      fireEvent.keyDown(stepsTab(), { key: "ArrowRight" });

      expect(isSelected(logTab())).toBe(true);

      fireEvent.keyDown(logTab(), { key: "ArrowLeft" });

      expect(isSelected(stepsTab())).toBe(true);
    });

    /*
     * The builder re-renders this on every poll while a run goes. Losing the
     * tab the reader chose every two seconds would make the log unreadable.
     */
    test("stays on the tab being read while the run updates", () => {
      const view: RenderResult = render(
        <WorkflowLogModal
          logs="line one"
          stepTrace={traceWithOneStep()}
          isRunning={true}
          statusMessage="Run running…"
          onClose={jest.fn()}
        />,
      );

      openLogTab();

      view.rerender(
        <WorkflowLogModal
          logs={"line one\nline two"}
          stepTrace={{ steps: [aStep(), aStep({ componentId: "api-get-2" })] }}
          isRunning={true}
          statusMessage="Run running…"
          onClose={jest.fn()}
        />,
      );

      expect(isSelected(logTab())).toBe(true);
      expect(screen.getByText("line two")).toBeInTheDocument();
    });
  });

  describe("the step count", () => {
    test("is on the steps tab", () => {
      render(
        <WorkflowLogModal
          logs=""
          stepTrace={{
            steps: [
              aStep(),
              aStep({ componentId: "b" }),
              aStep({ componentId: "c" }),
            ],
          }}
          onClose={jest.fn()}
        />,
      );

      expect(stepsTab()).toHaveTextContent("3");
    });

    test("is absent when the run recorded no steps", () => {
      render(
        <WorkflowLogModal
          logs=""
          stepTrace={emptyTrace()}
          onClose={jest.fn()}
        />,
      );

      expect(stepsTab()).toHaveTextContent(STEPS_TAB_NAME);
      expect(stepsTab()).not.toHaveTextContent("0");
    });

    test("grows as the run records more", () => {
      const view: RenderResult = render(
        <WorkflowLogModal
          logs=""
          stepTrace={{ steps: [aStep()] }}
          isRunning={true}
          onClose={jest.fn()}
        />,
      );

      expect(stepsTab()).toHaveTextContent("1");

      view.rerender(
        <WorkflowLogModal
          logs=""
          stepTrace={{ steps: [aStep(), aStep({ componentId: "b" })] }}
          isRunning={true}
          onClose={jest.fn()}
        />,
      );

      expect(stepsTab()).toHaveTextContent("2");
    });
  });

  describe("an empty log", () => {
    /*
     * A run that is still going has usually logged nothing yet. Saying so
     * beats an empty black rectangle that reads as a broken viewer.
     */
    test("says more is coming while the run is going", () => {
      render(
        <WorkflowLogModal
          logs=""
          stepTrace={emptyTrace()}
          isRunning={true}
          onClose={jest.fn()}
        />,
      );

      openLogTab();

      expect(
        screen.getByText("Nothing has been logged yet."),
      ).toBeInTheDocument();
    });

    test("says the run logged nothing once it is over", () => {
      render(
        <WorkflowLogModal
          logs=""
          stepTrace={emptyTrace()}
          isRunning={false}
          onClose={jest.fn()}
        />,
      );

      openLogTab();

      expect(
        screen.getByText("This run did not log anything."),
      ).toBeInTheDocument();
    });

    test("gives way to the log as soon as there is one", () => {
      const view: RenderResult = render(
        <WorkflowLogModal
          logs=""
          stepTrace={emptyTrace()}
          isRunning={true}
          onClose={jest.fn()}
        />,
      );

      openLogTab();

      view.rerender(
        <WorkflowLogModal
          logs="the first line"
          stepTrace={emptyTrace()}
          isRunning={true}
          onClose={jest.fn()}
        />,
      );

      expect(
        screen.queryByText("Nothing has been logged yet."),
      ).not.toBeInTheDocument();
      expect(screen.getByText("the first line")).toBeInTheDocument();
    });
  });

  describe("the run's status", () => {
    test("is not there when there is nothing to say", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          onClose={jest.fn()}
        />,
      );

      expect(screen.queryByText(/Run /)).not.toBeInTheDocument();
    });

    test("is visible on either tab", () => {
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

    test("reads as a failure when the run failed", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          statusMessage="Run error. Open the run log to see why."
          isStatusMessageError={true}
          onClose={jest.fn()}
        />,
      );

      expect(
        screen.getByText("Run error. Open the run log to see why."),
      ).toHaveClass("text-red-600");
    });

    test("does not read as a failure otherwise", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          statusMessage="Run finished successfully."
          onClose={jest.fn()}
        />,
      );

      expect(screen.getByText("Run finished successfully.")).toHaveClass(
        "text-gray-600",
      );
    });
  });

  describe("titles", () => {
    test("names the run by default", () => {
      render(
        <WorkflowLogModal
          logs=""
          stepTrace={emptyTrace()}
          onClose={jest.fn()}
        />,
      );

      expect(screen.getByText("Workflow Run")).toBeInTheDocument();
      expect(
        screen.getByText("Here is what happened when this workflow ran."),
      ).toBeInTheDocument();
    });

    test("takes the caller's words when given them", () => {
      render(
        <WorkflowLogModal
          logs=""
          stepTrace={emptyTrace()}
          title="The run you just started"
          description="Following it now."
          onClose={jest.fn()}
        />,
      );

      expect(screen.getByText("The run you just started")).toBeInTheDocument();
      expect(screen.getByText("Following it now.")).toBeInTheDocument();
    });
  });

  describe("closing", () => {
    test("closes from the footer", () => {
      const onClose: () => void = jest.fn();

      render(
        <WorkflowLogModal logs="" stepTrace={emptyTrace()} onClose={onClose} />,
      );

      fireEvent.click(screen.getByText("Close"));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("closes from the header", () => {
      const onClose: () => void = jest.fn();

      render(
        <WorkflowLogModal logs="" stepTrace={emptyTrace()} onClose={onClose} />,
      );

      fireEvent.click(screen.getByTestId("close-button"));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /*
     * Nothing in here is submitted, so there is one button and it closes. A
     * second, differently-worded button for the same action would be a
     * question the reader has to answer.
     */
    test("offers no other button", () => {
      render(
        <WorkflowLogModal
          logs=""
          stepTrace={emptyTrace()}
          onClose={jest.fn()}
        />,
      );

      expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
      expect(screen.queryByText("Save")).not.toBeInTheDocument();
    });
  });
});
