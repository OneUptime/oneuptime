/*
 * Copy log and Download, in the header of a workflow run's modal.
 *
 * Pinned here, with the browser's download replaced by a recorder:
 *   - Copy log puts the whole log on the clipboard and says so - and says so
 *     honestly when the clipboard refuses;
 *   - Download offers the log as text and the whole run as JSON, and saves
 *     the file named after the run;
 *   - a refused download is reported where the user clicked, not swallowed;
 *   - both are quiet header buttons, like the step dialog's "How to use":
 *     the modal's only action is to close.
 */

import WorkflowRunExportActions, {
  COPY_FEEDBACK_DURATION_MS,
} from "../../../../UI/Components/Workflow/WorkflowRunExportActions";
import { WorkflowRunExportText } from "../../../../UI/Components/Workflow/DownloadWorkflowRun";
import {
  WorkflowRunExport,
  WorkflowRunExportFormat,
  buildWorkflowRunJsonText,
  buildWorkflowRunLogText,
  getWorkflowRunFileName,
} from "../../../../UI/Components/Workflow/WorkflowRunExport";
import { WorkflowStepStatus } from "../../../../Types/Workflow/StepTrace";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
let mockDownloadError: Error | null = null;

jest.mock("../../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: (data: DownloadCall): void => {
      if (mockDownloadError) {
        throw mockDownloadError;
      }

      mockDownloads.push(data);
    },
  };
});

const RUN_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";

const LOG: string = [
  "Oct 01 2026, 10:33:07 GMT: Executing Component: if-else-1",
  "Oct 01 2026, 10:33:07 GMT: Executing Port: No",
].join("\n");

const aRun: (overrides?: Partial<WorkflowRunExport>) => WorkflowRunExport = (
  overrides?: Partial<WorkflowRunExport>,
): WorkflowRunExport => {
  return {
    runId: RUN_ID,
    workflowId: "0193c0de-7777-4aaa-8bbb-000000000007",
    workflowName: "Route alerts",
    status: WorkflowStatus.Success,
    scheduledAt: new Date("2026-10-01T10:33:06.000Z"),
    startedAt: new Date("2026-10-01T10:33:07.000Z"),
    completedAt: new Date("2026-10-01T10:33:08.000Z"),
    logs: LOG,
    stepTrace: {
      steps: [
        {
          componentId: "if-else-1",
          metadataId: "if-else",
          title: "If / Else",
          status: WorkflowStepStatus.Success,
          startedAt: "2026-10-01T10:33:07.000Z",
          completedAt: "2026-10-01T10:33:07.010Z",
          durationInMs: 10,
          argumentValues: { "input-1": "production" },
          returnValues: {},
          executedPort: "no",
          executedPortTitle: "No",
        },
      ],
    },
    ...overrides,
  };
};

type WriteText = (text: string) => Promise<void>;

let writeText: ReturnType<typeof jest.fn<WriteText>>;

const originalExecCommand: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(document, "execCommand");

const installClipboard: (write: WriteText | undefined) => void = (
  write: WriteText | undefined,
): void => {
  Object.defineProperty(navigator, "clipboard", {
    value: write ? { writeText: write } : undefined,
    configurable: true,
  });
};

const installExecCommand: (
  execCommand: ((command: string) => boolean) | undefined,
) => void = (execCommand: ((command: string) => boolean) | undefined): void => {
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
    writable: true,
  });
};

const copyButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("workflow-run-copy-log");
};

const clickCopy: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(copyButton());
  });
};

const openDownloadMenu: () => void = (): void => {
  fireEvent.click(screen.getByTestId("workflow-run-download"));
};

const chooseDownload: (label: string) => void = (label: string): void => {
  openDownloadMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
};

beforeEach(() => {
  mockDownloads.length = 0;
  mockDownloadError = null;
  writeText = jest.fn<WriteText>(async (): Promise<void> => {});
  installClipboard(writeText);
  installExecCommand(undefined);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();

  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    installExecCommand(undefined);
  }
});

describe("WorkflowRunExportActions", () => {
  describe("what is offered", () => {
    test("Copy log and Download", () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      expect(copyButton()).toHaveTextContent("Copy log");
      expect(screen.getByTestId("workflow-run-download")).toHaveTextContent(
        "Download",
      );
    });

    test("Download is a menu button, closed until it is opened", () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      const trigger: HTMLElement = screen.getByTestId("workflow-run-download");

      expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    test("the menu holds the two files a run can be saved as, the log first", () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      openDownloadMenu();

      expect(
        screen.getAllByRole("menuitem").map((item: HTMLElement) => {
          return item.textContent;
        }),
      ).toEqual(["Download log", "Download run as JSON"]);
      expect(screen.getByTestId("workflow-run-download")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    test("a run that printed nothing but recorded steps can still be downloaded, not copied", () => {
      render(<WorkflowRunExportActions run={aRun({ logs: "" })} />);

      expect(
        screen.queryByTestId("workflow-run-copy-log"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("workflow-run-download")).toBeInTheDocument();
    });

    /*
     * The modal shows a run; its one way out is Close and it has no "do it"
     * action. A filled indigo button here would be a second primary.
     */
    test("both are quiet buttons, not action ones", () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      for (const button of [
        copyButton(),
        screen.getByTestId("workflow-run-download"),
      ]) {
        expect(button).toHaveClass("text-gray-500");
        expect(button).toHaveClass("hover:bg-gray-100");
        // No fill of its own: only a grey wash on hover.
        expect(button.className).not.toMatch(/(^|\s)bg-/);
        expect(button).toHaveAttribute("type", "button");
      }
    });

    /*
     * The step dialog's "How to use" is the one other button a workflow
     * dialog keeps in its header. These are drawn the same way - grey text,
     * a grey wash on hover, no border or fill - so the two read as the same
     * kind of thing, and the two of them look alike.
     */
    test("look like the step dialog's header button, and like each other", () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      for (const button of [
        copyButton(),
        screen.getByTestId("workflow-run-download"),
      ]) {
        expect(button).toHaveClass(
          "rounded-md",
          "px-2",
          "py-1",
          "text-sm",
          "font-medium",
          "text-gray-500",
          "hover:bg-gray-100",
          "hover:text-gray-700",
        );
        expect(button.className).not.toMatch(/(^|\s)border(-|\s|$)/);
      }

      expect(screen.getByTestId("workflow-run-download").className).toBe(
        copyButton().className,
      );
    });

    /*
     * A phone's header has no room for words beside the title and the ×,
     * so there the icons stand alone - and the words stay for screen
     * readers, as the buttons' names.
     */
    test("on a phone only the icons show, and the words stay for screen readers", () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      expect(screen.getByText("Copy log")).toHaveClass("max-sm:sr-only");
      expect(screen.getByText("Download", { selector: "span" })).toHaveClass(
        "max-sm:sr-only",
      );
      expect(screen.getByRole("button", { name: "Copy log" })).toBe(
        copyButton(),
      );
      expect(screen.getByRole("button", { name: "Download" })).toBe(
        screen.getByTestId("workflow-run-download"),
      );
    });
  });

  describe("Copy log", () => {
    test("puts the whole log on the clipboard, exactly as printed", async () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      await clickCopy();

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(LOG);
    });

    test("copies only the log - no heading, no steps", async () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      await clickCopy();

      const copied: string = writeText.mock.calls[0]![0];

      expect(copied).not.toContain("Run ID");
      expect(copied).not.toContain("production");
    });

    test("copies a very long log whole", async () => {
      const longLog: string = Array.from(
        { length: 50000 },
        (_unused: unknown, index: number): string => {
          return `Oct 01 2026, 10:33:07 GMT: line ${index}`;
        },
      ).join("\n");

      render(<WorkflowRunExportActions run={aRun({ logs: longLog })} />);

      await clickCopy();

      expect(writeText.mock.calls[0]![0]).toBe(longLog);
    });

    test("says Copied! for a moment, then goes back", async () => {
      jest.useFakeTimers();

      render(<WorkflowRunExportActions run={aRun()} />);

      await clickCopy();

      expect(copyButton()).toHaveTextContent("Copied!");
      expect(screen.getByRole("status")).toHaveTextContent("Copied!");

      act(() => {
        jest.advanceTimersByTime(COPY_FEEDBACK_DURATION_MS);
      });

      expect(copyButton()).toHaveTextContent("Copy log");
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    test("a second copy restarts the moment rather than cutting it short", async () => {
      jest.useFakeTimers();

      render(<WorkflowRunExportActions run={aRun()} />);

      await clickCopy();

      act(() => {
        jest.advanceTimersByTime(COPY_FEEDBACK_DURATION_MS - 100);
      });

      await clickCopy();

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(copyButton()).toHaveTextContent("Copied!");
    });

    /*
     * A self-hosted install reached over plain http has no async clipboard,
     * and a browser can refuse a write. "Copied!" would then be a lie that
     * leaves the user pasting nothing; the honest answer points at Download.
     */
    test("says it failed, and what to do instead, when the clipboard refuses", async () => {
      jest.useFakeTimers();
      installClipboard(
        jest.fn<WriteText>(async (): Promise<void> => {
          throw new Error("Document is not focused.");
        }),
      );
      installExecCommand((): boolean => {
        return false;
      });

      render(<WorkflowRunExportActions run={aRun()} />);

      await clickCopy();

      expect(copyButton()).toHaveTextContent("Copy failed");
      expect(copyButton()).not.toHaveTextContent("Copied!");
      expect(screen.getByRole("status")).toHaveTextContent(
        "The log could not be copied. Download it instead.",
      );

      act(() => {
        jest.advanceTimersByTime(COPY_FEEDBACK_DURATION_MS);
      });

      expect(copyButton()).toHaveTextContent("Copy log");
    });

    test("falls back to the older copy command where there is no clipboard API", async () => {
      installClipboard(undefined);

      const execCommand: ReturnType<
        typeof jest.fn<(command: string) => boolean>
      > = jest.fn<(command: string) => boolean>((): boolean => {
        return true;
      });

      installExecCommand(execCommand);

      render(<WorkflowRunExportActions run={aRun()} />);

      await clickCopy();

      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(copyButton()).toHaveTextContent("Copied!");
    });

    test("stops its timer when the modal closes mid-moment", async () => {
      jest.useFakeTimers();

      const view: ReturnType<typeof render> = render(
        <WorkflowRunExportActions run={aRun()} />,
      );

      await clickCopy();

      view.unmount();

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("Download", () => {
    test("Download log saves the log as text, named after the run", () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      chooseDownload("Download log");

      expect(mockDownloads).toHaveLength(1);
      expect(mockDownloads[0]).toEqual({
        content: buildWorkflowRunLogText(aRun()),
        filename: `route-alerts-run-${RUN_ID}-2026-10-01T10-33-07.txt`,
        mimeType: "text/plain;charset=utf-8",
      });
    });

    test("the saved log is the heading and the whole log", () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      chooseDownload("Download log");

      const content: string = mockDownloads[0]!.content as string;

      expect(content).toContain("Workflow: Route alerts");
      expect(content).toContain(`Run ID: ${RUN_ID}`);
      expect(content).toContain("Status: Executed");
      expect(content.endsWith(`\n\n${LOG}\n`)).toBe(true);
    });

    test("Download run as JSON saves the steps too", () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      chooseDownload("Download run as JSON");

      expect(mockDownloads).toHaveLength(1);
      expect(mockDownloads[0]!.filename).toBe(
        getWorkflowRunFileName(aRun(), WorkflowRunExportFormat.JSON),
      );
      expect(mockDownloads[0]!.mimeType).toBe("application/json;charset=utf-8");
      expect(mockDownloads[0]!.content).toBe(buildWorkflowRunJsonText(aRun()));

      const saved: {
        stepTrace: {
          steps: Array<{ componentId: string; executedPort: string }>;
        };
      } = JSON.parse(mockDownloads[0]!.content as string);

      expect(saved.stepTrace.steps[0]).toMatchObject({
        componentId: "if-else-1",
        executedPort: "no",
      });
    });

    test("choosing a file closes the menu", () => {
      render(<WorkflowRunExportActions run={aRun()} />);

      chooseDownload("Download log");

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    test("saves what the run holds when it is clicked, as the run goes on", () => {
      const view: ReturnType<typeof render> = render(
        <WorkflowRunExportActions
          run={aRun({ status: WorkflowStatus.Running, completedAt: null })}
        />,
      );

      chooseDownload("Download log");

      view.rerender(
        <WorkflowRunExportActions
          run={aRun({ logs: `${LOG}\nOct 01 2026, 10:33:09 GMT: one more` })}
        />,
      );

      chooseDownload("Download log");

      expect(mockDownloads[0]!.content).toContain("Status: Running");
      expect(mockDownloads[0]!.content).not.toContain("one more");
      expect(mockDownloads[1]!.content).toContain("Status: Executed");
      expect(mockDownloads[1]!.content).toContain("one more");
    });

    test("a refused download is said where it was clicked", () => {
      mockDownloadError = new Error("Download blocked");

      render(<WorkflowRunExportActions run={aRun()} />);

      chooseDownload("Download log");

      expect(screen.getByRole("alert")).toHaveTextContent(
        "This run could not be downloaded. Try again.",
      );
      expect(screen.getByTestId("workflow-run-download-error")).toBeVisible();
    });

    test("the next download that works clears it", () => {
      mockDownloadError = new Error("Download blocked");

      render(<WorkflowRunExportActions run={aRun()} />);

      chooseDownload("Download run as JSON");

      expect(screen.getByRole("alert")).toBeInTheDocument();

      mockDownloadError = null;

      chooseDownload("Download run as JSON");

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(mockDownloads).toHaveLength(1);
    });
  });

  describe("its words", () => {
    test("are the ones the dashboard's locale files translate", () => {
      expect(WorkflowRunExportText).toEqual({
        copyLog: "Copy log",
        copied: "Copied!",
        copyFailed: "Copy failed",
        copyFailedMessage: "The log could not be copied. Download it instead.",
        download: "Download",
        downloadLog: "Download log",
        downloadJson: "Download run as JSON",
        downloadFailed: "This run could not be downloaded. Try again.",
      });
    });
  });
});
