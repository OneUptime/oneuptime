/*
 * A run read as the list of steps it took.
 *
 * The point of the viewer is that the failed step is the one you want, so most
 * of what is worth pinning down is which rows open by themselves and what a row
 * says before you open it.
 */

import StepTraceViewer, {
  formatStepDuration,
} from "../../../../UI/Components/Workflow/StepTraceViewer";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
} from "../../../../Types/Workflow/StepTrace";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

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

const renderTrace: (trace: WorkflowStepTrace) => void = (
  trace: WorkflowStepTrace,
): void => {
  render(<StepTraceViewer trace={trace} />);
};

describe("formatStepDuration", () => {
  test("keeps sub-second steps in milliseconds", () => {
    expect(formatStepDuration(0)).toBe("0ms");
    expect(formatStepDuration(1)).toBe("1ms");
    expect(formatStepDuration(999)).toBe("999ms");
  });

  test("switches to seconds at a second", () => {
    expect(formatStepDuration(1000)).toBe("1.0s");
    expect(formatStepDuration(1500)).toBe("1.5s");
    expect(formatStepDuration(59999)).toBe("60.0s");
  });

  test("switches to minutes at a minute", () => {
    expect(formatStepDuration(60000)).toBe("1m 0s");
    expect(formatStepDuration(90000)).toBe("1m 30s");
    expect(formatStepDuration(3600000)).toBe("60m 0s");
  });
});

describe("StepTraceViewer", () => {
  afterEach(() => {
    cleanup();
  });

  describe("a run with no recorded steps", () => {
    test("says so, and says why there might not be any", () => {
      renderTrace({ steps: [] });

      expect(screen.getByText(/no recorded steps/i)).toBeInTheDocument();
      expect(screen.getByText(/before step recording/i)).toBeInTheDocument();
    });

    test("survives a trace that is missing its steps entirely", () => {
      render(
        <StepTraceViewer trace={undefined as unknown as WorkflowStepTrace} />,
      );

      expect(screen.getByText(/no recorded steps/i)).toBeInTheDocument();
    });
  });

  describe("a step's row", () => {
    test("names the step and the component it came from", () => {
      renderTrace({
        steps: [aStep({ title: "Post to Slack", componentId: "slack-1" })],
      });

      expect(screen.getByText("Post to Slack")).toBeInTheDocument();
      expect(screen.getByText("slack-1")).toBeInTheDocument();
    });

    test("says how long it took", () => {
      renderTrace({ steps: [aStep({ durationInMs: 2500 })] });

      expect(screen.getByText("2.5s")).toBeInTheDocument();
    });

    test("says which way the run went afterwards", () => {
      renderTrace({ steps: [aStep({ executedPort: "success" })] });

      expect(screen.getByText("→ success")).toBeInTheDocument();
    });

    test("says nothing about a port when the step ended the run", () => {
      renderTrace({ steps: [aStep({ executedPort: null })] });

      expect(screen.queryByText(/→/)).not.toBeInTheDocument();
    });

    test("numbers the steps in the order they ran", () => {
      renderTrace({
        steps: [
          aStep({ title: "First", componentId: "one" }),
          aStep({ title: "Second", componentId: "two" }),
          aStep({ title: "Third", componentId: "three" }),
        ],
      });

      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  describe("opening a step", () => {
    test("a step that worked stays shut until asked", () => {
      renderTrace({
        steps: [aStep({ argumentValues: { url: "https://example.com" } })],
      });

      expect(screen.queryByText("Received")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { expanded: false }));

      expect(screen.getByText("Received")).toBeInTheDocument();
      expect(screen.getByText("Returned")).toBeInTheDocument();
      expect(screen.getByText("https://example.com")).toBeInTheDocument();
    });

    test("closes again", () => {
      renderTrace({ steps: [aStep()] });

      fireEvent.click(screen.getByRole("button", { expanded: false }));
      fireEvent.click(screen.getByRole("button", { expanded: true }));

      expect(screen.queryByText("Received")).not.toBeInTheDocument();
    });

    /*
     * The step that broke the run is the reason anyone opened this. It should
     * not need a click.
     */
    test("a step that failed is open already, with its error", () => {
      renderTrace({
        steps: [
          aStep({
            status: WorkflowStepStatus.Error,
            errorMessage: "Request timed out after 30s",
          }),
        ],
      });

      expect(
        screen.getByText("Request timed out after 30s"),
      ).toBeInTheDocument();
      expect(screen.getByText("Received")).toBeInTheDocument();
    });

    test("only the failed step opens", () => {
      renderTrace({
        steps: [
          aStep({ title: "Worked", componentId: "ok-1" }),
          aStep({
            title: "Broke",
            componentId: "bad-1",
            status: WorkflowStepStatus.Error,
            errorMessage: "Nope",
          }),
        ],
      });

      expect(screen.getByText("Nope")).toBeInTheDocument();
      expect(screen.getAllByText("Received")).toHaveLength(1);
    });
  });

  describe("the values a step received and returned", () => {
    test("says None rather than showing an empty list", () => {
      renderTrace({ steps: [aStep({ argumentValues: {}, returnValues: {} })] });

      fireEvent.click(screen.getByRole("button", { expanded: false }));

      expect(screen.getAllByText("None")).toHaveLength(2);
    });

    test("shows a string as it is", () => {
      renderTrace({
        steps: [aStep({ returnValues: { body: "hello there" } })],
      });

      fireEvent.click(screen.getByRole("button", { expanded: false }));

      expect(screen.getByText("body")).toBeInTheDocument();
      expect(screen.getByText("hello there")).toBeInTheDocument();
    });

    test("serializes anything structured", () => {
      renderTrace({
        steps: [
          aStep({
            returnValues: { data: { id: 4, ok: true } as never },
          }),
        ],
      });

      fireEvent.click(screen.getByRole("button", { expanded: false }));

      const rendered: HTMLElement | undefined = Array.from(
        document.querySelectorAll("dd"),
      ).find((element: Element) => {
        return (
          element.textContent === JSON.stringify({ id: 4, ok: true }, null, 2)
        );
      }) as HTMLElement | undefined;

      expect(rendered).toBeDefined();
    });
  });

  describe("a run too long to keep whole", () => {
    test("says how much of it survived rather than looking complete", () => {
      renderTrace({
        steps: [aStep(), aStep({ componentId: "api-get-2" })],
        truncated: true,
      });

      expect(
        screen.getByText("Only the last 2 steps of this run were kept."),
      ).toBeInTheDocument();
    });

    test("says nothing when the whole run is there", () => {
      renderTrace({ steps: [aStep()] });

      expect(screen.queryByText(/Only the last/)).not.toBeInTheDocument();
    });
  });
});
