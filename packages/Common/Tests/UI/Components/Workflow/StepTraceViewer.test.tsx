/*
 * A run read as the list of steps it took.
 *
 * The maintainer's report was that the Steps tab did not say which port a step
 * took ("If / Else ... → no", small, at the far right, gone on a phone) while
 * the full log did ("Executing Port: No"). So most of what is pinned here is
 * what a step says before anyone opens it: the output it took, by the name the
 * canvas gives it, where that led, whether it worked, and any warning the
 * runner raised about it. Then what opening it shows, and that traces written
 * before any of this was recorded still read.
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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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

/*
 * The If / Else step from the maintainer's screenshot, as the runner now
 * records it: the No port, nothing wired to it, and the webhook reference
 * that did not resolve because only this step ran.
 */
const UNRESOLVED_REFERENCE: string =
  "{{local.components.webhook-1.returnValues.request-body.environment}}";

const ifElseStep: (overrides?: StepOverrides) => WorkflowStepTraceEntry = (
  overrides?: StepOverrides,
): WorkflowStepTraceEntry => {
  return aStep({
    componentId: "if-else-1",
    metadataId: "if-else",
    title: "If / Else",
    durationInMs: 5,
    // JSONB's key order: shortest first, not the order the settings use.
    argumentValues: {
      "input-1": UNRESOLVED_REFERENCE,
      "input-2": "production",
      operator: "==",
      "input-1-type": "text",
      "input-2-type": "text",
    },
    argumentNames: [
      { id: "input-1-type", name: "Input 1 Type" },
      { id: "input-1", name: "Input 1" },
      { id: "operator", name: "Operator" },
      { id: "input-2-type", name: "Input 2 Type" },
      { id: "input-2", name: "Input 2" },
    ],
    argumentTemplates: { "input-1": UNRESOLVED_REFERENCE },
    returnValueNames: [],
    executedPort: "no",
    executedPortTitle: "No",
    executedPortDescription: "If, no then this port will be executed",
    nextSteps: [],
    warnings: [
      {
        message: `${UNRESOLVED_REFERENCE} in "Input 1" did not resolve to anything and was left as literal text. Check the step id and the return value name.`,
        argumentId: "input-1",
        unresolvedReferences: [UNRESOLVED_REFERENCE],
      },
    ],
    ...overrides,
  });
};

const renderTrace: (trace: WorkflowStepTrace) => void = (
  trace: WorkflowStepTrace,
): void => {
  render(<StepTraceViewer trace={trace} />);
};

const stepCards: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.getAllByTestId("workflow-run-step");
};

const outcomeOf: (card: HTMLElement) => HTMLElement = (
  card: HTMLElement,
): HTMLElement => {
  return within(card).getByTestId("workflow-run-step-outcome");
};

const toggleOf: (card: HTMLElement) => HTMLElement = (
  card: HTMLElement,
): HTMLElement => {
  return within(card).getByRole("button");
};

// The numbered dot on the path, beside the step's card.
const dotOf: (card: HTMLElement) => HTMLElement = (
  card: HTMLElement,
): HTMLElement => {
  const dot: Element | undefined = Array.from(card.children).find(
    (child: Element) => {
      return child.classList.contains("rounded-full");
    },
  );

  if (!dot) {
    throw new Error("The step has no dot on the path.");
  }

  return dot as HTMLElement;
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
    jest.useRealTimers();
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

    /*
     * The runner writes the steps when the run finishes, so a run that is
     * still going has none yet. Saying it has none at all, and blaming its
     * age, would be wrong.
     */
    test("says the steps are still to come while the run goes", () => {
      render(<StepTraceViewer trace={{ steps: [] }} isRunning={true} />);

      expect(
        screen.getByText("The steps show here once the run finishes."),
      ).toBeInTheDocument();
      expect(screen.queryByText(/no recorded steps/i)).not.toBeInTheDocument();
    });

    test("says why a run stopped before its first step", () => {
      renderTrace({
        steps: [],
        runErrorMessage:
          "This workflow has no components to execute. Please open the workflow and add a Trigger.",
      });

      const note: HTMLElement = screen.getByTestId("workflow-run-stopped");

      expect(note).toHaveTextContent("The run stopped before its first step");
      expect(note).toHaveTextContent(
        "This workflow has no components to execute.",
      );
      expect(screen.queryByText(/no recorded steps/i)).not.toBeInTheDocument();
    });
  });

  describe("which output a step took", () => {
    /*
     * The report itself. The port is named as the canvas names it, and it is
     * there without opening the step.
     */
    test("says plainly that If / Else took No", () => {
      renderTrace({ steps: [aStep(), ifElseStep()] });

      const outcome: HTMLElement = outcomeOf(stepCards()[1]!);

      expect(outcome).toHaveTextContent(/^Took/);
      expect(
        within(outcome).getByTestId("workflow-run-step-port"),
      ).toHaveTextContent("No");
    });

    test("says Yes when it took Yes", () => {
      renderTrace({
        steps: [
          ifElseStep({
            executedPort: "yes",
            executedPortTitle: "Yes",
            warnings: [],
          }),
        ],
      });

      expect(screen.getByTestId("workflow-run-step-port")).toHaveTextContent(
        "Yes",
      );
    });

    test("names a step's only output, Out", () => {
      renderTrace({
        steps: [
          aStep({
            title: "Log",
            componentId: "log-1",
            executedPort: "out",
            executedPortTitle: "Out",
          }),
        ],
      });

      expect(screen.getByTestId("workflow-run-step-port")).toHaveTextContent(
        "Out",
      );
    });

    test("names the port by its title, not its id", () => {
      renderTrace({
        steps: [
          aStep({
            title: "Manual",
            componentId: "manual-1",
            executedPort: "success",
            executedPortTitle: "Execute",
          }),
        ],
      });

      expect(screen.getByTestId("workflow-run-step-port")).toHaveTextContent(
        "Execute",
      );
      expect(screen.queryByText(/success/i)).not.toBeInTheDocument();
    });

    /*
     * Error is the one output that means something went wrong, so it alone
     * is drawn as a failure; Yes and No are both just the way the run went.
     */
    test("draws the Error output as a failure, and the step as failed", () => {
      renderTrace({
        steps: [
          aStep({
            status: WorkflowStepStatus.Error,
            executedPort: "error",
            executedPortTitle: "Error",
          }),
        ],
      });

      const port: HTMLElement = screen.getByTestId("workflow-run-step-port");

      expect(port).toHaveTextContent("Error");
      expect(port).toHaveClass("text-red-700");
      expect(screen.getByTestId("workflow-run-step-status")).toHaveTextContent(
        "Failed",
      );
    });

    test("does not draw No as a failure", () => {
      renderTrace({ steps: [ifElseStep()] });

      const port: HTMLElement = screen.getByTestId("workflow-run-step-port");

      expect(port).toHaveClass("text-indigo-700");
      expect(port).not.toHaveClass("text-red-700");
      expect(screen.getByTestId("workflow-run-step-status")).toHaveTextContent(
        "Succeeded",
      );
    });

    /*
     * The old row hid the port below the sm breakpoint. On a phone the port
     * was simply not there.
     */
    test("is not hidden at any screen width", () => {
      renderTrace({ steps: [ifElseStep()] });

      let element: HTMLElement | null = screen.getByTestId(
        "workflow-run-step-port",
      );

      while (element) {
        expect(element.className || "").not.toMatch(
          /(^|\s)(max-\w+:)?hidden(\s|$)/,
        );
        element = element.parentElement;
      }
    });

    test("explains the port the way the canvas does, on hover", async () => {
      jest.useFakeTimers();
      renderTrace({ steps: [ifElseStep()] });

      fireEvent.mouseEnter(screen.getByTestId("workflow-run-step-port"));
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(
        screen.getByText("If, no then this port will be executed"),
      ).toBeInTheDocument();
    });

    describe("in a trace recorded before port names were kept", () => {
      test("still names the port, from its id", () => {
        renderTrace({ steps: [aStep({ executedPort: "no" })] });

        expect(screen.getByTestId("workflow-run-step-port")).toHaveTextContent(
          "No",
        );
      });

      test("does not claim to know where it led", () => {
        renderTrace({ steps: [aStep({ executedPort: "success" })] });

        const outcome: HTMLElement = screen.getByTestId(
          "workflow-run-step-outcome",
        );

        expect(outcome).toHaveTextContent("Took Success");
        expect(outcome).not.toHaveTextContent(/connected/);
        expect(outcome).not.toHaveTextContent("→");
      });

      test("says a step that worked but took no port ended the run", () => {
        renderTrace({ steps: [aStep({ executedPort: null })] });

        expect(screen.getByTestId("workflow-run-step-outcome")).toHaveTextContent(
          "Took no output, so the run ended here.",
        );
        expect(
          screen.queryByTestId("workflow-run-step-port"),
        ).not.toBeInTheDocument();
      });

      /*
       * A step that threw never reached a port. Its error is what it has to
       * say, not "took no output".
       */
      test("lets a failed step's error speak for a missing port", () => {
        renderTrace({
          steps: [
            aStep({
              executedPort: null,
              status: WorkflowStepStatus.Error,
              errorMessage: "component exploded",
            }),
          ],
        });

        expect(
          screen.queryByTestId("workflow-run-step-outcome"),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("workflow-run-step-error")).toHaveTextContent(
          "component exploded",
        );
      });

      test("survives a port field that is missing altogether", () => {
        const step: WorkflowStepTraceEntry = aStep();
        delete (step as Partial<WorkflowStepTraceEntry>).executedPort;

        renderTrace({ steps: [step] });

        expect(screen.getByText("Get from API")).toBeInTheDocument();
        expect(
          screen.queryByTestId("workflow-run-step-port"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("where the output led", () => {
    test("names the step it led to, by its number in the run", () => {
      renderTrace({
        steps: [
          aStep({
            title: "Webhook",
            componentId: "webhook-1",
            executedPortTitle: "Out",
            nextSteps: [{ componentId: "if-else-1", title: "If / Else" }],
          }),
          ifElseStep({ warnings: [] }),
        ],
      });

      const next: HTMLElement = within(outcomeOf(stepCards()[0]!)).getByTestId(
        "workflow-run-step-next",
      );

      expect(next).toHaveTextContent("Step 2");
      expect(next).toHaveTextContent("If / Else");
      expect(next).toHaveTextContent("if-else-1");
      expect(next).not.toHaveTextContent("did not run");
    });

    /*
     * Steps run first-in first-out, so with two branches the next card down
     * is not always the step this one started. The number says which it was.
     */
    test("numbers each branch of a fan-out by where it actually ran", () => {
      renderTrace({
        steps: [
          aStep({
            title: "Manual",
            componentId: "manual-1",
            executedPortTitle: "Execute",
            nextSteps: [
              { componentId: "slack-1", title: "Send Message to Slack" },
              { componentId: "email-1", title: "Send Email" },
            ],
          }),
          aStep({ title: "Send Message to Slack", componentId: "slack-1" }),
          aStep({ title: "Send Email", componentId: "email-1" }),
        ],
      });

      const nextSteps: Array<HTMLElement> = within(
        outcomeOf(stepCards()[0]!),
      ).getAllByTestId("workflow-run-step-next");

      expect(nextSteps).toHaveLength(2);
      expect(nextSteps[0]).toHaveTextContent("Step 2");
      expect(nextSteps[0]).toHaveTextContent("Send Message to Slack");
      expect(nextSteps[1]).toHaveTextContent("Step 3");
      expect(nextSteps[1]).toHaveTextContent("Send Email");
    });

    test("says when the step it led to did not run", () => {
      renderTrace({
        steps: [
          aStep({
            executedPortTitle: "Success",
            executedPort: "success",
            nextSteps: [{ componentId: "slack-1", title: "Send to Slack" }],
          }),
        ],
        runErrorMessage: "Workflow execution time was more than 100ms.",
      });

      expect(screen.getByTestId("workflow-run-step-next")).toHaveTextContent(
        "Send to Slack slack-1 (did not run)",
      );
    });

    test("says the run ended when nothing is connected to the output", () => {
      renderTrace({ steps: [aStep(), ifElseStep()] });

      expect(outcomeOf(stepCards()[1]!)).toHaveTextContent(
        "Took No Nothing is connected to it, so the run ended here.",
      );
    });

    /*
     * With a second branch still to run, an unconnected output ends this
     * branch only.
     */
    test("says only the branch ended when other steps ran after it", () => {
      renderTrace({
        steps: [
          aStep({
            title: "Log",
            componentId: "log-1",
            executedPortTitle: "Out",
            nextSteps: [],
          }),
          aStep({ title: "Send Email", componentId: "email-1" }),
        ],
      });

      expect(outcomeOf(stepCards()[0]!)).toHaveTextContent(
        "Nothing is connected to it, so this branch ended here.",
      );
    });

    test("reads the path as an ordered list, numbered in the order it ran", () => {
      renderTrace({
        steps: [
          aStep({ title: "First", componentId: "one" }),
          aStep({ title: "Second", componentId: "two" }),
          aStep({ title: "Third", componentId: "three" }),
        ],
      });

      const list: HTMLElement = screen.getByRole("list", {
        name: "Steps, in the order they ran",
      });

      expect(list.tagName).toBe("OL");
      expect(within(list).getAllByRole("listitem")).toHaveLength(3);
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^Step 2: Second/ }),
      ).toBeInTheDocument();
    });
  });

  describe("a test of one step", () => {
    const singleStepTrace: () => WorkflowStepTrace = (): WorkflowStepTrace => {
      return {
        steps: [
          ifElseStep({
            nextSteps: [{ componentId: "slack-1", title: "Send to Slack" }],
          }),
        ],
        singleStepComponentId: "if-else-1",
      };
    };

    /*
     * The maintainer's run was "Run this step": the webhook never ran, which
     * is why its value did not resolve. The view says so up front.
     */
    test("says only this step ran, and what that means for its values", () => {
      renderTrace(singleStepTrace());

      const note: HTMLElement = screen.getByTestId(
        "workflow-run-single-step-note",
      );

      expect(note).toHaveTextContent("Only this step ran");
      expect(note).toHaveTextContent(/steps before it did not run/);
      expect(note).toHaveTextContent(/Run Workflow/);
    });

    test("names the step that would have run next", () => {
      renderTrace(singleStepTrace());

      expect(screen.getByTestId("workflow-run-step-next")).toHaveTextContent(
        "Send to Slack slack-1 (not run in this test)",
      );
    });

    test("says nothing of the kind about a whole run", () => {
      renderTrace({ steps: [ifElseStep()] });

      expect(
        screen.queryByTestId("workflow-run-single-step-note"),
      ).not.toBeInTheDocument();
    });
  });

  describe("status and duration", () => {
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

    test("says in words whether it worked", () => {
      renderTrace({
        steps: [
          aStep({ componentId: "ok-1" }),
          aStep({
            componentId: "bad-1",
            status: WorkflowStepStatus.Error,
            errorMessage: "Nope",
          }),
        ],
      });

      const [worked, broke] = stepCards() as [HTMLElement, HTMLElement];

      expect(
        within(worked).getByTestId("workflow-run-step-status"),
      ).toHaveTextContent("Succeeded");
      expect(
        within(broke).getByTestId("workflow-run-step-status"),
      ).toHaveTextContent("Failed");
    });

    test("does not trip over a duration that was never written", () => {
      renderTrace({
        steps: [aStep({ durationInMs: undefined as unknown as number })],
      });

      expect(screen.getByText("0ms")).toBeInTheDocument();
    });
  });

  describe("errors", () => {
    test("show on the failed step without opening it, called out", () => {
      renderTrace({
        steps: [
          aStep({ componentId: "ok-1" }),
          aStep({
            componentId: "bad-1",
            status: WorkflowStepStatus.Error,
            executedPort: null,
            errorMessage: "Request timed out after 30s",
          }),
        ],
      });

      const error: HTMLElement = screen.getByTestId("workflow-run-step-error");

      expect(error).toHaveTextContent("This step failed");
      expect(error).toHaveTextContent("Request timed out after 30s");
      expect(stepCards()[1]).toContainElement(error);
      expect(dotOf(stepCards()[1]!)).toHaveClass("bg-red-500");
      expect(dotOf(stepCards()[0]!)).toHaveClass("bg-emerald-500");
    });

    /*
     * A step that took its Error output carries no message of its own: the
     * run went down the error branch. The status and the red port say it.
     */
    test("a step that left by its Error output needs no message to read as failed", () => {
      renderTrace({
        steps: [
          aStep({
            status: WorkflowStepStatus.Error,
            executedPort: "error",
            executedPortTitle: "Error",
            nextSteps: [{ componentId: "log-1", title: "Log" }],
          }),
          aStep({ title: "Log", componentId: "log-1" }),
        ],
      });

      expect(
        screen.queryByTestId("workflow-run-step-error"),
      ).not.toBeInTheDocument();
      expect(outcomeOf(stepCards()[0]!)).toHaveTextContent(
        "Took Error → which led to Step 2 Log log-1",
      );
    });

    test("say why the run stopped when no step carries the reason", () => {
      renderTrace({
        steps: [aStep({ componentId: "a" }), aStep({ componentId: "b" })],
        runErrorMessage:
          "Workflow execution time was more than 5000ms and workflow timed-out.",
      });

      const stopped: HTMLElement = screen.getByTestId("workflow-run-stopped");

      expect(stopped).toHaveTextContent("The run stopped here");
      expect(stopped).toHaveTextContent("timed-out");
      // At the end of the path, after the last step.
      const list: HTMLElement = screen.getByRole("list");
      expect(list.lastElementChild).toBe(stopped);
    });
  });

  describe("warnings", () => {
    /*
     * The second half of the report: the unresolved {{...}} was only in the
     * full log.
     */
    test("show on the step itself, without opening it", () => {
      renderTrace({ steps: [aStep(), ifElseStep()] });

      const warning: HTMLElement = within(stepCards()[1]!).getByTestId(
        "workflow-run-step-warning",
      );

      expect(warning).toHaveTextContent(UNRESOLVED_REFERENCE);
      expect(warning).toHaveTextContent(/did not resolve to anything/);
      expect(warning).not.toHaveTextContent(/^Warning:/);
    });

    test("mark the argument they are about", () => {
      renderTrace({ steps: [aStep(), ifElseStep()] });

      const rows: Array<HTMLElement> = within(stepCards()[1]!).getAllByTestId(
        "workflow-run-step-value",
      );
      const input1: HTMLElement = rows.find((row: HTMLElement) => {
        return row.textContent?.startsWith("Input 1Did not resolve");
      }) as HTMLElement;

      expect(input1).toBeDefined();
      expect(
        within(input1).getByTestId("workflow-run-step-unresolved"),
      ).toHaveTextContent("Did not resolve");
      // The literal text is the value; it is not repeated as a template.
      expect(
        within(input1).queryByTestId("workflow-run-step-template"),
      ).not.toBeInTheDocument();
    });

    test("show every warning a step has", () => {
      renderTrace({
        steps: [
          aStep({
            warnings: [
              { message: "first thing" },
              { message: "second thing" },
            ],
          }),
        ],
      });

      expect(screen.getAllByTestId("workflow-run-step-warning")).toHaveLength(
        2,
      );
    });

    test("colour the step's dot, so a warning shows from the path", () => {
      renderTrace({ steps: [aStep(), ifElseStep()] });

      expect(dotOf(stepCards()[1]!)).toHaveClass("bg-amber-500");
      expect(dotOf(stepCards()[0]!)).toHaveClass("bg-emerald-500");
    });

    test("ignore entries with nothing to say", () => {
      renderTrace({
        steps: [
          aStep({
            warnings: [
              null as never,
              { message: "" },
              { argumentId: "x" } as never,
            ],
          }),
        ],
      });

      expect(
        screen.queryByTestId("workflow-run-step-warning"),
      ).not.toBeInTheDocument();
    });
  });

  describe("opening a step", () => {
    test("a step that worked stays shut until asked", () => {
      renderTrace({
        steps: [
          aStep({ argumentValues: { url: "https://example.com" } }),
          aStep({ componentId: "api-get-2" }),
        ],
      });

      expect(screen.queryByText("Received")).not.toBeInTheDocument();

      fireEvent.click(toggleOf(stepCards()[0]!));

      expect(screen.getByText("Received")).toBeInTheDocument();
      expect(screen.getByText("Returned")).toBeInTheDocument();
      expect(screen.getByText("https://example.com")).toBeInTheDocument();
    });

    test("closes again", () => {
      renderTrace({ steps: [aStep(), aStep({ componentId: "api-get-2" })] });

      const toggle: HTMLElement = toggleOf(stepCards()[0]!);

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("Received")).not.toBeInTheDocument();
    });

    test("points the open step's button at what it opened", () => {
      renderTrace({ steps: [aStep(), aStep({ componentId: "api-get-2" })] });

      const toggle: HTMLElement = toggleOf(stepCards()[0]!);

      fireEvent.click(toggle);

      const details: HTMLElement = screen.getByTestId(
        "workflow-run-step-details",
      );

      expect(toggle.getAttribute("aria-controls")).toBe(details.id);
    });

    /*
     * The step that broke the run is the reason anyone opened this. It should
     * not need a click.
     */
    test("a step that failed is open already, with its error", () => {
      renderTrace({
        steps: [
          aStep({ componentId: "ok-1" }),
          aStep({
            componentId: "bad-1",
            status: WorkflowStepStatus.Error,
            errorMessage: "Request timed out after 30s",
          }),
        ],
      });

      expect(
        screen.getByText("Request timed out after 30s"),
      ).toBeInTheDocument();
      expect(screen.getAllByText("Received")).toHaveLength(1);
      expect(toggleOf(stepCards()[1]!)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    test("a step with a warning is open already, so its arguments show", () => {
      renderTrace({ steps: [aStep(), ifElseStep()] });

      expect(toggleOf(stepCards()[0]!)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(toggleOf(stepCards()[1]!)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    /*
     * One step is all the run there is (a test of a single step, usually),
     * so what it received and returned is the whole answer.
     */
    test("the only step of a run is open already", () => {
      renderTrace({
        steps: [aStep({ argumentValues: { url: "https://example.com" } })],
      });

      expect(screen.getByText("Received")).toBeInTheDocument();
      expect(screen.getByText("https://example.com")).toBeInTheDocument();
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

  describe("what a step received", () => {
    test("lists the arguments by name, in the order the settings use", () => {
      renderTrace({ steps: [ifElseStep()] });

      const names: Array<string> = screen
        .getAllByTestId("workflow-run-step-value")
        .map((row: HTMLElement) => {
          return row.querySelector("dt span")?.textContent || "";
        });

      expect(names).toEqual([
        "Input 1 Type",
        "Input 1",
        "Operator",
        "Input 2 Type",
        "Input 2",
        // Returned: nothing.
      ]);
    });

    test("shows the value without the quotes If / Else adds while it runs", () => {
      renderTrace({ steps: [ifElseStep()] });

      expect(screen.getByText("production")).toBeInTheDocument();
      expect(screen.queryByText('"production"')).not.toBeInTheDocument();
    });

    test("falls back to the ids, in the trace's order, for an older trace", () => {
      renderTrace({
        steps: [
          aStep({
            argumentValues: { url: "https://example.com", method: "GET" },
          }),
        ],
      });

      const names: Array<string> = screen
        .getAllByTestId("workflow-run-step-value")
        .map((row: HTMLElement) => {
          return row.querySelector("dt span")?.textContent || "";
        });

      expect(names).toEqual(["url", "method"]);
    });

    test("shows a reference next to the value it resolved to", () => {
      renderTrace({
        steps: [
          aStep({
            argumentValues: { environment: "production" },
            argumentNames: [{ id: "environment", name: "Environment" }],
            argumentTemplates: {
              environment:
                "{{local.components.webhook-1.returnValues.request-body.environment}}",
            },
          }),
        ],
      });

      const template: HTMLElement = screen.getByTestId(
        "workflow-run-step-template",
      );

      expect(screen.getByText("production")).toBeInTheDocument();
      expect(template).toHaveTextContent(
        "from {{local.components.webhook-1.returnValues.request-body.environment}}",
      );
    });

    test("shows a text template beside what it became", () => {
      renderTrace({
        steps: [
          aStep({
            argumentValues: { message: "Deploy to production failed" },
            argumentTemplates: {
              message: "Deploy to {{local.variables.environment}} failed",
            },
          }),
        ],
      });

      expect(screen.getByTestId("workflow-run-step-template")).toHaveTextContent(
        "from Deploy to {{local.variables.environment}} failed",
      );
    });

    test("says Empty text rather than showing nothing", () => {
      renderTrace({ steps: [aStep({ argumentValues: { message: "" } })] });

      expect(screen.getByText("Empty text")).toBeInTheDocument();
    });

    test("shows numbers, booleans and null as they are", () => {
      renderTrace({
        steps: [
          aStep({
            argumentValues: { count: 3, enabled: false, missing: null },
          }),
        ],
      });

      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("false")).toBeInTheDocument();
      expect(screen.getByText("null")).toBeInTheDocument();
    });

    test("says so when the step received nothing", () => {
      renderTrace({ steps: [aStep({ argumentValues: {} })] });

      expect(screen.getByText("Nothing received.")).toBeInTheDocument();
    });
  });

  describe("what a step returned", () => {
    test("shows a string as it is", () => {
      renderTrace({
        steps: [aStep({ returnValues: { body: "hello there" } })],
      });

      expect(screen.getByText("body")).toBeInTheDocument();
      expect(screen.getByText("hello there")).toBeInTheDocument();
    });

    test("names each value, with the id a reference reads it by", () => {
      renderTrace({
        steps: [
          aStep({
            returnValues: { "response-status": 200 },
            returnValueNames: [
              { id: "response-status", name: "Response Status" },
            ],
          }),
        ],
      });

      const row: HTMLElement = screen.getByTestId("workflow-run-step-value");

      expect(row).toHaveTextContent("Response Status");
      expect(row).toHaveTextContent("response-status");
      expect(row).toHaveTextContent("200");
    });

    test("indents anything structured, as a block", () => {
      renderTrace({
        steps: [
          aStep({
            returnValues: { data: { id: 4, ok: true } as never },
          }),
        ],
      });

      const rendered: HTMLElement | undefined = Array.from(
        document.querySelectorAll("pre"),
      ).find((element: Element) => {
        return (
          element.textContent === JSON.stringify({ id: 4, ok: true }, null, 2)
        );
      }) as HTMLElement | undefined;

      expect(rendered).toBeDefined();
      expect(rendered).toHaveClass("font-mono");
    });

    test("puts long text in a block that can scroll", () => {
      const long: string = "x".repeat(300);

      renderTrace({ steps: [aStep({ returnValues: { body: long } })] });

      const block: HTMLElement = screen.getByText(long);

      expect(block.tagName).toBe("PRE");
      expect(block).toHaveClass("overflow-auto");
    });

    test("says a step that never returns anything does not", () => {
      renderTrace({ steps: [ifElseStep()] });

      expect(
        screen.getByText("This step does not return any data."),
      ).toBeInTheDocument();
    });

    test("says Nothing returned when a step that can return did not", () => {
      renderTrace({
        steps: [
          aStep({
            returnValues: {},
            returnValueNames: [{ id: "body", name: "Body" }],
          }),
        ],
      });

      expect(screen.getByText("Nothing returned.")).toBeInTheDocument();
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

  describe("a trace that is not quite what it should be", () => {
    test("draws a step with no values, names or ports at all", () => {
      const bare: WorkflowStepTraceEntry = {
        componentId: "bare-1",
        title: "Bare",
        status: WorkflowStepStatus.Success,
      } as unknown as WorkflowStepTraceEntry;

      renderTrace({ steps: [bare] });

      expect(screen.getByText("Bare")).toBeInTheDocument();
      expect(screen.getByText("Nothing received.")).toBeInTheDocument();
      expect(screen.getByText("Nothing returned.")).toBeInTheDocument();
    });

    test("skips entries that are not steps", () => {
      renderTrace({
        steps: [null as never, aStep({ title: "Real" }), "junk" as never],
      });

      expect(stepCards()).toHaveLength(1);
      expect(screen.getByText("Real")).toBeInTheDocument();
    });

    test("ignores next steps without an id", () => {
      renderTrace({
        steps: [
          aStep({
            executedPortTitle: "Out",
            nextSteps: [
              null as never,
              { componentId: "", title: "Nameless" },
              { componentId: "log-1", title: "" },
            ],
          }),
        ],
      });

      const next: Array<HTMLElement> = screen.getAllByTestId(
        "workflow-run-step-next",
      );

      expect(next).toHaveLength(1);
      // A next step without a title is called by its id.
      expect(next[0]).toHaveTextContent("log-1 log-1");
    });
  });
});
