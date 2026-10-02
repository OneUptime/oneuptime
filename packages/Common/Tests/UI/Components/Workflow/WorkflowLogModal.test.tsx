/*
 * The modal a workflow run is read in.
 *
 * The two things it shows answer different questions and are now two tabs, so
 * most of what is worth pinning down is about the tabs: which one opens first,
 * that only one is mounted at a time, and — because the builder re-renders this
 * every couple of seconds while a run goes — that a poll does not throw the
 * reader back to the other tab.
 *
 * And what it shows can be taken away: Copy log and Download sit in the
 * header (WorkflowRunExportActions.test.tsx covers the controls themselves).
 */

import WorkflowLogModal, {
  FULL_LOG_TAB_NAME,
  STEPS_TAB_NAME,
} from "../../../../UI/Components/Workflow/WorkflowLogModal";
import {
  WorkflowRunDetails,
  buildWorkflowRunJsonText,
} from "../../../../UI/Components/Workflow/WorkflowRunExport";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
} from "../../../../Types/Workflow/StepTrace";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

interface DownloadCall {
  content: Blob | string;
  filename: string;
  mimeType?: string | undefined;
}

const mockDownloads: Array<DownloadCall> = [];

// The browser's download, replaced by a recorder of what would be saved.
jest.mock("../../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: (data: DownloadCall): void => {
      mockDownloads.push(data);
    },
  };
});

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

  describe("the steps tab's count", () => {
    const badge: () => HTMLElement = (): HTMLElement => {
      return stepsTab().querySelector("span") as HTMLElement;
    };

    /*
     * The count takes the colour of the worst thing in the run, so a failure
     * or a warning shows before the tab is opened - from the Full Log tab too.
     */
    test("is red when a step failed", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={{
            steps: [aStep(), aStep({ status: WorkflowStepStatus.Error })],
          }}
          initialTabName={FULL_LOG_TAB_NAME}
          onClose={jest.fn()}
        />,
      );

      expect(badge()).toHaveClass("bg-red-500");
    });

    test("is red when the run stopped for a reason of its own", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={{ steps: [aStep()], runErrorMessage: "timed out" }}
          onClose={jest.fn()}
        />,
      );

      expect(badge()).toHaveClass("bg-red-500");
    });

    test("is amber when a step has a warning and nothing failed", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={{
            steps: [aStep({ warnings: [{ message: "did not resolve" }] })],
          }}
          onClose={jest.fn()}
        />,
      );

      expect(badge()).toHaveClass("bg-yellow-500");
    });

    test("keeps its usual colour for a clean run", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          onClose={jest.fn()}
        />,
      );

      expect(badge()).toHaveClass("bg-indigo-500");
    });

    test("counts only real steps", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={{
            steps: [
              aStep(),
              null as unknown as WorkflowStepTraceEntry,
              aStep({ componentId: "b" }),
            ],
          }}
          onClose={jest.fn()}
        />,
      );

      expect(stepsTab()).toHaveTextContent("2");
    });
  });

  describe("which way each step went", () => {
    /*
     * The maintainer's report, read through the modal: the port a step took
     * is on the Steps tab itself, not only in the Full Log's "Executing Port".
     */
    test("is on the steps tab, without opening a step", () => {
      render(
        <WorkflowLogModal
          logs={"Executing Port: No"}
          stepTrace={{
            steps: [
              aStep(),
              aStep({
                componentId: "if-else-1",
                title: "If / Else",
                executedPort: "no",
                executedPortTitle: "No",
                nextSteps: [],
              }),
            ],
          }}
          onClose={jest.fn()}
        />,
      );

      const outcomes: Array<HTMLElement> = screen.getAllByTestId(
        "workflow-run-step-outcome",
      );

      expect(outcomes[1]).toHaveTextContent("Took No");
    });

    test("says the steps are still to come while the run goes", () => {
      render(
        <WorkflowLogModal
          logs=""
          stepTrace={emptyTrace()}
          isRunning={true}
          statusMessage="Run running…"
          onClose={jest.fn()}
        />,
      );

      expect(
        screen.getByText("The steps show here once the run finishes."),
      ).toBeInTheDocument();
    });
  });

  describe("the toolbar", () => {
    /*
     * More actions on the run as a whole sit beside the status line, above
     * the tabs, so they work from either tab. (This used to be the place a
     * Download button was meant to go; Download is built into the header
     * now, so a stand-in action is used.)
     */
    test("sits beside the status line", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          statusMessage="Run finished successfully."
          toolbar={<button type="button">Open workflow</button>}
          onClose={jest.fn()}
        />,
      );

      const row: HTMLElement = screen.getByTestId("workflow-run-status-row");

      expect(row).toHaveTextContent("Run finished successfully.");
      expect(
        within(row).getByRole("button", { name: "Open workflow" }),
      ).toBeInTheDocument();
    });

    test("stays put whichever tab is open", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          toolbar={<button type="button">Open workflow</button>}
          onClose={jest.fn()}
        />,
      );

      expect(
        screen.getByRole("button", { name: "Open workflow" }),
      ).toBeInTheDocument();

      openLogTab();

      expect(
        screen.getByRole("button", { name: "Open workflow" }),
      ).toBeInTheDocument();
    });

    test("shows on its own when there is no status line", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          toolbar={<button type="button">Open workflow</button>}
          onClose={jest.fn()}
        />,
      );

      expect(screen.getByTestId("workflow-run-toolbar")).toHaveTextContent(
        "Open workflow",
      );
    });

    test("holds only its own actions: Copy log and Download are in the header", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          toolbar={<button type="button">Open workflow</button>}
          onClose={jest.fn()}
        />,
      );

      const row: HTMLElement = screen.getByTestId("workflow-run-status-row");

      expect(
        within(row)
          .getAllByRole("button")
          .map((button: HTMLElement) => {
            return button.textContent;
          }),
      ).toEqual(["Open workflow"]);
      expect(
        within(screen.getByTestId("modal-header")).getByTestId(
          "workflow-run-copy-log",
        ),
      ).toBeInTheDocument();
    });

    test("is not there unless given", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          statusMessage="Run finished successfully."
          onClose={jest.fn()}
        />,
      );

      expect(
        screen.queryByTestId("workflow-run-toolbar"),
      ).not.toBeInTheDocument();
    });

    /*
     * A run with a log to copy and download still has no row of its own:
     * those live in the header.
     */
    test("leaves no empty row when there is neither", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          onClose={jest.fn()}
        />,
      );

      expect(
        screen.queryByTestId("workflow-run-status-row"),
      ).not.toBeInTheDocument();
    });
  });

  describe("copying and downloading the run", () => {
    const RUN_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";

    const RUN: WorkflowRunDetails = {
      runId: RUN_ID,
      workflowId: "0193c0de-7777-4aaa-8bbb-000000000007",
      workflowName: "Route alerts",
      status: WorkflowStatus.Success,
      scheduledAt: new Date("2026-10-01T10:33:06.000Z"),
      startedAt: new Date("2026-10-01T10:33:07.000Z"),
      completedAt: new Date("2026-10-01T10:33:08.000Z"),
    };

    const chooseDownload: (label: string) => void = (label: string): void => {
      fireEvent.click(screen.getByTestId("workflow-run-download"));
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
    };

    beforeEach(() => {
      mockDownloads.length = 0;
    });

    /*
     * The maintainer's report: the Full Log tab had a Close button and no
     * way to take the log anywhere.
     *
     * They are in the header, beside the ×: the body scrolls under a long
     * log or a long list of steps, and the header does not.
     */
    test("Copy log and Download are in the header, beside the close button", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          run={RUN}
          onClose={jest.fn()}
        />,
      );

      const header: HTMLElement = screen.getByTestId("modal-header");

      expect(
        within(header).getByTestId("workflow-run-copy-log"),
      ).toHaveTextContent("Copy log");
      expect(
        within(header).getByTestId("workflow-run-download"),
      ).toHaveTextContent("Download");
      expect(
        within(header)
          .getAllByRole("button")
          .map((button: HTMLElement) => {
            return button.getAttribute("data-testid");
          }),
      ).toEqual([
        "workflow-run-copy-log",
        "workflow-run-download",
        "close-button",
      ]);
      expect(
        within(screen.getByTestId("modal-content")).queryByTestId(
          "workflow-run-export-actions",
        ),
      ).not.toBeInTheDocument();
    });

    /*
     * The header is where a dialog never starts its focus, so opening a run
     * with the keyboard does not land on - or light up - Copy log.
     */
    test("opening the run does not put the focus on them", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          run={RUN}
          onClose={jest.fn()}
        />,
      );

      expect(
        screen
          .getByTestId("workflow-run-export-actions")
          .contains(document.activeElement),
      ).toBe(false);
    });

    test("are there on the Full Log tab too", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          run={RUN}
          initialTabName={FULL_LOG_TAB_NAME}
          onClose={jest.fn()}
        />,
      );

      expect(screen.getByTestId("workflow-run-copy-log")).toBeInTheDocument();
      expect(screen.getByTestId("workflow-run-download")).toBeInTheDocument();

      openStepsTab();

      expect(screen.getByTestId("workflow-run-copy-log")).toBeInTheDocument();
    });

    test("leave the run's status line to itself", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          statusMessage="Run finished successfully."
          run={RUN}
          onClose={jest.fn()}
        />,
      );

      const row: HTMLElement = screen.getByTestId("workflow-run-status-row");

      expect(row).toHaveTextContent("Run finished successfully.");
      expect(
        within(row).queryByTestId("workflow-run-export-actions"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("workflow-run-download")).toBeInTheDocument();
    });

    test("are not there before the run has logged or recorded anything", () => {
      render(
        <WorkflowLogModal
          logs=""
          stepTrace={emptyTrace()}
          isRunning={true}
          statusMessage="Starting run…"
          onClose={jest.fn()}
        />,
      );

      expect(
        screen.queryByTestId("workflow-run-export-actions"),
      ).not.toBeInTheDocument();
      // The status line itself stays.
      expect(screen.getByText("Starting run…")).toBeInTheDocument();
    });

    test("come as soon as the first line does", () => {
      const view: RenderResult = render(
        <WorkflowLogModal
          logs=""
          stepTrace={emptyTrace()}
          isRunning={true}
          onClose={jest.fn()}
        />,
      );

      view.rerender(
        <WorkflowLogModal
          logs="the first line"
          stepTrace={emptyTrace()}
          isRunning={true}
          onClose={jest.fn()}
        />,
      );

      expect(screen.getByTestId("workflow-run-copy-log")).toBeInTheDocument();
    });

    test("Download log saves the full log, named after the run", () => {
      render(
        <WorkflowLogModal
          logs={"line one\nline two"}
          stepTrace={traceWithOneStep()}
          run={RUN}
          onClose={jest.fn()}
        />,
      );

      chooseDownload("Download log");

      expect(mockDownloads).toHaveLength(1);
      expect(mockDownloads[0]!.filename).toBe(
        `route-alerts-run-${RUN_ID}-2026-10-01T10-33-07.txt`,
      );
      expect(mockDownloads[0]!.content).toBe(
        [
          "Workflow: Route alerts",
          "Workflow ID: 0193c0de-7777-4aaa-8bbb-000000000007",
          `Run ID: ${RUN_ID}`,
          "Status: Executed",
          "Scheduled at: 2026-10-01T10:33:06.000Z",
          "Started at: 2026-10-01T10:33:07.000Z",
          "Completed at: 2026-10-01T10:33:08.000Z",
          "",
          "line one",
          "line two",
          "",
        ].join("\n"),
      );
    });

    test("Download run as JSON saves the steps the Steps tab shows", () => {
      const trace: WorkflowStepTrace = {
        steps: [
          aStep(),
          aStep({ componentId: "if-else-1", executedPort: "no" }),
        ],
      };

      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={trace}
          run={RUN}
          onClose={jest.fn()}
        />,
      );

      chooseDownload("Download run as JSON");

      expect(mockDownloads[0]!.filename).toBe(
        `route-alerts-run-${RUN_ID}-2026-10-01T10-33-07.json`,
      );
      expect(mockDownloads[0]!.content).toBe(
        buildWorkflowRunJsonText({ ...RUN, logs: "a line", stepTrace: trace }),
      );
    });

    /*
     * The Full Log tab draws every line; the download is how a log too long
     * to read there gets read, so it is the whole log, not what is drawn.
     */
    test("a very long log downloads whole", () => {
      const longLog: string = Array.from(
        { length: 20000 },
        (_unused: unknown, index: number): string => {
          return `line ${index}`;
        },
      ).join("\n");

      render(
        <WorkflowLogModal
          logs={longLog}
          stepTrace={traceWithOneStep()}
          run={RUN}
          onClose={jest.fn()}
        />,
      );

      chooseDownload("Download log");

      expect(
        (mockDownloads[0]!.content as string).endsWith(`\n\n${longLog}\n`),
      ).toBe(true);
    });

    test("without the run's details it still downloads, under a plain name", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          onClose={jest.fn()}
        />,
      );

      chooseDownload("Download log");

      expect(mockDownloads[0]!.filename).toBe("workflow-run.txt");
      expect(mockDownloads[0]!.content).toBe("a line\n");
    });

    test("a run still going saves what it has logged so far", () => {
      render(
        <WorkflowLogModal
          logs="so far"
          stepTrace={emptyTrace()}
          isRunning={true}
          statusMessage="Run running…"
          run={{ ...RUN, status: WorkflowStatus.Running, completedAt: null }}
          onClose={jest.fn()}
        />,
      );

      chooseDownload("Download log");

      const content: string = mockDownloads[0]!.content as string;

      expect(content).toContain("Status: Running");
      expect(content).not.toContain("Completed at");
      expect(content.endsWith("\n\nso far\n")).toBe(true);
    });

    test("they add no second way out to the footer", () => {
      render(
        <WorkflowLogModal
          logs="a line"
          stepTrace={traceWithOneStep()}
          run={RUN}
          onClose={jest.fn()}
        />,
      );

      const footer: HTMLElement = screen.getByTestId("modal-footer");

      expect(
        within(footer)
          .getAllByRole("button")
          .map((button: HTMLElement) => {
            return button.textContent;
          }),
      ).toEqual(["Close"]);
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
