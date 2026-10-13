import { ComponentProps as CodeEditorProps } from "../../../../UI/Components/CodeEditor/CodeEditor";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import type { Mock } from "jest-mock";

// Monaco does not run under jsdom; the run form's fields only have to hold text.
jest.mock("../../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      const raw: unknown = props.value ?? props.initialValue ?? "";

      return (
        <textarea
          aria-labelledby={props.ariaLabelledby}
          value={typeof raw === "string" ? raw : JSON.stringify(raw)}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

jest.mock("../../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: (): void => {
      // Not under test here.
    },
  };
});

import {
  WorkflowRunPanelTestRunNote,
  WorkflowTestRunNote,
  WorkflowTestRunPill,
  getTestRunStartedByText,
} from "../../../../UI/Components/Workflow/WorkflowTestRun";
import WorkflowStatusElement from "../../../../UI/Components/Workflow/WorkflowStatus";
import RunModal from "../../../../UI/Components/Workflow/RunModal";
import WorkflowLogModal from "../../../../UI/Components/Workflow/WorkflowLogModal";
import { WorkflowEnabledCopy } from "../../../../UI/Components/Workflow/WorkflowEnabledCopy";
import { createTranslator } from "../../../../UI/Utils/TranslateTemplate";
import { resetPageScrollLockForTesting } from "../../../../UI/Utils/PageScrollLock";
import BuiltInComponents from "../../../../Types/Workflow/Components";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";

/*
 * How a test run is marked.
 *
 * "Run - Why do I have to enable a workflow in order to test run it? Can you
 * please fix it?" A person may now run a workflow from its Builder while it
 * is turned off: a test run. It is not a dry run - its steps run for real -
 * and it is not one its trigger started, so the dashboard says so wherever
 * it shows one:
 *
 *   - the Run Workflow panel, before anything runs, while the workflow is off;
 *   - the run itself, on a line under its status, with who started it;
 *   - both run lists, beside the run's status, as a pill of the status's size.
 *
 * The marks in the run and in the lists are the same neutral pill, so a
 * person who has seen one recognises the other. Only the Run Workflow panel's
 * note is a blue box: it is read before the run, and says every step runs for
 * real.
 */

const TRIGGER: NodeDataProp = ((): NodeDataProp => {
  const metadata: ComponentMetadata = BuiltInComponents.find(
    (component: ComponentMetadata): boolean => {
      return component.id === ComponentID.Manual;
    },
  )!;

  return {
    id: "manual-1",
    internalId: "runner-manual-1",
    nodeType: NodeType.Node,
    componentType: metadata.componentType,
    metadataId: metadata.id,
    metadata: { ...metadata },
    error: "",
    arguments: {},
    returnValues: {},
  };
})();

beforeEach(() => {
  resetPageScrollLockForTesting();
});

afterEach(() => {
  cleanup();
  resetPageScrollLockForTesting();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("who started a test run, in a sentence", () => {
  const english: ReturnType<typeof createTranslator> = createTranslator(
    undefined,
    "en",
  );

  test("names the person", () => {
    expect(getTestRunStartedByText(english, "Ada Lovelace")).toBe(
      "Started by Ada Lovelace while this workflow was off.",
    );
  });

  test.each([undefined, null, "", "   "])(
    "says started by hand when nobody is named (%p)",
    (startedBy: string | null | undefined) => {
      expect(getTestRunStartedByText(english, startedBy)).toBe(
        "Started by hand while this workflow was off.",
      );
    },
  );

  test("trims the name it puts in", () => {
    expect(getTestRunStartedByText(english, "  Ada Lovelace ")).toBe(
      "Started by Ada Lovelace while this workflow was off.",
    );
  });
});

describe("the line in a test run", () => {
  test("says it is a test run, and who started it", () => {
    render(<WorkflowTestRunNote startedBy="Ada Lovelace" />);

    const note: HTMLElement = screen.getByTestId("workflow-run-test-run-note");

    expect(note).toHaveAttribute("role", "note");
    expect(note).toHaveTextContent("Test run");
    expect(
      within(note).getByTestId("workflow-run-test-run-started-by"),
    ).toHaveTextContent("Started by Ada Lovelace while this workflow was off.");
  });

  test("is the run lists' pill, with who started it written out, not a box", () => {
    render(<WorkflowTestRunNote startedBy="Ada Lovelace" />);

    const note: HTMLElement = screen.getByTestId("workflow-run-test-run-note");
    const pill: HTMLElement = within(note).getByTestId("pill");

    expect(pill).toHaveTextContent(/^Test run$/);
    expect(pill.querySelector("svg")).not.toBeNull();
    // A quiet line of context: no coloured box around it.
    expect(note.className).not.toMatch(/\bbg-/);
    expect(note.className).not.toMatch(/\bborder\b/);
    // Written out, so it needs no hover - and says it once.
    expect(note.querySelector("[title]")).toBeNull();
    expect(
      within(note).getAllByText(
        "Started by Ada Lovelace while this workflow was off.",
      ),
    ).toHaveLength(1);
  });

  test("its pill is the run lists' pill, drawn the same", () => {
    render(
      <div>
        <div data-testid="in-the-run">
          <WorkflowTestRunNote startedBy="Ada Lovelace" />
        </div>
        <div data-testid="in-a-list">
          <WorkflowTestRunPill startedBy="Ada Lovelace" />
        </div>
      </div>,
    );

    const inTheRun: HTMLElement = within(
      screen.getByTestId("in-the-run"),
    ).getByTestId("pill");
    const inAList: HTMLElement = within(
      screen.getByTestId("in-a-list"),
    ).getByTestId("pill");

    expect(inTheRun.className).toBe(inAList.className);
    expect(inTheRun.getAttribute("style")).toBe(inAList.getAttribute("style"));
    expect(inTheRun.textContent).toBe(inAList.textContent);
  });

  test("the sentence flows beside the pill and wraps under it, in one block", () => {
    render(<WorkflowTestRunNote startedBy="Ada Lovelace" />);

    const note: HTMLElement = screen.getByTestId("workflow-run-test-run-note");

    // A flex row would drop the whole sentence under the pill on a phone.
    expect(note.className).not.toMatch(/\bflex\b/);
    expect(note.tagName).toBe("DIV");
    // Icon draws a div; a div inside a <p> is invalid markup.
    expect(note.querySelector("p div")).toBeNull();
  });

  test("its icon is decoration", () => {
    render(<WorkflowTestRunNote startedBy="Ada Lovelace" />);

    const note: HTMLElement = screen.getByTestId("workflow-run-test-run-note");

    expect(note.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("the Run Workflow panel's note", () => {
  test("says off makes this a test run, and that its steps run for real", () => {
    render(<WorkflowRunPanelTestRunNote />);

    expect(
      screen.getByTestId("workflow-run-panel-test-run-note"),
    ).toHaveTextContent(
      "This workflow is off, so this is a test run. Every step runs for real: anything it sends, writes or deletes actually happens.",
    );
  });

  test("is in the panel while the workflow is off", () => {
    render(
      <RunModal
        trigger={TRIGGER}
        isTestRun={true}
        onClose={jest.fn()}
        onRun={jest.fn()}
      />,
    );

    const panel: HTMLElement = screen.getByTestId("side-over-content");

    expect(
      within(panel).getByTestId("workflow-run-panel-test-run-note"),
    ).toBeInTheDocument();
  });

  test("comes before the trigger's values, so it is read first", () => {
    render(
      <RunModal
        trigger={TRIGGER}
        isTestRun={true}
        onClose={jest.fn()}
        onRun={jest.fn()}
      />,
    );

    const note: HTMLElement = screen.getByTestId(
      "workflow-run-panel-test-run-note",
    );
    const heading: HTMLElement = screen.getByText("Run Manual");

    expect(
      note.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test.each([false, undefined])(
    "is not in the panel while the workflow is on (isTestRun %p)",
    (isTestRun: boolean | undefined) => {
      render(
        <RunModal
          trigger={TRIGGER}
          isTestRun={isTestRun}
          onClose={jest.fn()}
          onRun={jest.fn()}
        />,
      );

      expect(
        screen.queryByTestId("workflow-run-panel-test-run-note"),
      ).toBeNull();
    },
  );

  test("does not stand in the way of the run: Run Workflow Manually and Run still send it", () => {
    const onRun: Mock<(trigger: NodeDataProp) => void> = jest.fn();

    render(
      <RunModal
        trigger={TRIGGER}
        isTestRun={true}
        onClose={jest.fn()}
        onRun={onRun}
      />,
    );

    fireEvent.click(
      within(screen.getByTestId("side-over-footer")).getByRole("button", {
        name: "Run Workflow Manually",
      }),
    );

    const confirm: HTMLElement = screen.getByText(
      "Are you sure you want to run this workflow manually?",
    );
    const dialog: HTMLElement = confirm.closest('[role="dialog"]')!;

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    expect(onRun).toHaveBeenCalledTimes(1);
  });
});

describe("the run lists' mark", () => {
  test("a pill reading Test run, with who started it on hover", () => {
    render(<WorkflowTestRunPill startedBy="Ada Lovelace" />);

    const pill: HTMLElement = screen.getByTestId("workflow-test-run-pill");

    expect(pill).toHaveTextContent("Test run");
    expect(pill.querySelector("svg")).not.toBeNull();
  });

  test("sits beside the status of a test run", () => {
    render(
      <WorkflowStatusElement
        status={WorkflowStatus.Success}
        isTestRun={true}
        testRunStartedBy="Ada Lovelace"
      />,
    );

    const pills: Array<HTMLElement> = screen.getAllByTestId("pill");

    expect(
      pills.map((pill: HTMLElement): string => {
        return pill.textContent || "";
      }),
    ).toEqual(["Executed", "Test run"]);
  });

  test.each([
    WorkflowStatus.Success,
    WorkflowStatus.Error,
    WorkflowStatus.Running,
    WorkflowStatus.WorkflowCountExceeded,
  ])(
    "is the same size as the status it sits beside (%s)",
    (status: WorkflowStatus) => {
      /*
       * It used to be drawn at the small size, a 10px pill beside a 13px
       * status: it read as a footnote, and was hard to read at all.
       */
      render(
        <WorkflowStatusElement
          status={status}
          isTestRun={true}
          testRunStartedBy="Ada Lovelace"
        />,
      );

      const [statusPill, testRunPill] = screen.getAllByTestId("pill") as [
        HTMLElement,
        HTMLElement,
      ];

      expect(testRunPill.style.fontSize).toBe(statusPill.style.fontSize);
      expect(testRunPill.style.fontSize).toBe("13px");
    },
  );

  test.each([false, undefined])(
    "is not drawn for any other run (isTestRun %p)",
    (isTestRun: boolean | undefined) => {
      const { container } = render(
        <WorkflowStatusElement
          status={WorkflowStatus.Error}
          isTestRun={isTestRun}
        />,
      );

      expect(screen.queryByTestId("workflow-test-run-pill")).toBeNull();
      // The status alone, as it has always been drawn: one pill, unwrapped.
      expect(container.firstElementChild).toBe(screen.getByTestId("pill"));
    },
  );

  test("the words are the copy's, looked up", () => {
    expect(WorkflowEnabledCopy.testRun).toBe("Test run");
  });
});

describe("the run, opened", () => {
  test("a test run says so under its status, and above its tabs", () => {
    render(
      <WorkflowLogModal
        logs="10:00:00: Test run, started by Ada Lovelace while this workflow is turned off."
        stepTrace={{ steps: [] }}
        run={{
          runId: "0193c0de-1111-4aaa-8bbb-000000000001",
          status: WorkflowStatus.Success,
          isTestRun: true,
          startedBy: "Ada Lovelace",
        }}
        statusMessage="Run finished successfully."
        onClose={jest.fn()}
      />,
    );

    const status: HTMLElement = screen.getByTestId("workflow-run-status-row");
    const note: HTMLElement = screen.getByTestId("workflow-run-test-run-note");

    // Whether the run worked is read first; that it was a test, second.
    expect(
      status.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      note.compareDocumentPosition(screen.getByRole("tablist")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Spaced from the status line above it.
    expect(note.parentElement!.className).toMatch(/\bmt-2\b/);
  });

  test("a test run says so above its tabs, with who started it", () => {
    render(
      <WorkflowLogModal
        logs="10:00:00: Test run, started by Ada Lovelace while this workflow is turned off."
        stepTrace={{ steps: [] }}
        run={{
          runId: "0193c0de-1111-4aaa-8bbb-000000000001",
          status: WorkflowStatus.Success,
          isTestRun: true,
          startedBy: "Ada Lovelace",
        }}
        onClose={jest.fn()}
      />,
    );

    const note: HTMLElement = screen.getByTestId("workflow-run-test-run-note");

    expect(note).toHaveTextContent(
      "Started by Ada Lovelace while this workflow was off.",
    );
    expect(
      note.compareDocumentPosition(screen.getByRole("tablist")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // With no status line above it (the run lists' View Logs), it leads.
    expect(note.parentElement!.className).not.toMatch(/\bmt-2\b/);
  });

  test("a run that is no test run says nothing of the kind", () => {
    render(
      <WorkflowLogModal
        logs="10:00:00: Workflow Scheduled."
        stepTrace={{ steps: [] }}
        run={{
          runId: "0193c0de-1111-4aaa-8bbb-000000000001",
          status: WorkflowStatus.Success,
          isTestRun: false,
          startedBy: "Ada Lovelace",
        }}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByTestId("workflow-run-test-run-note")).toBeNull();
  });

  test("a run with no details says nothing of the kind", () => {
    render(
      <WorkflowLogModal
        logs=""
        stepTrace={{ steps: [] }}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByTestId("workflow-run-test-run-note")).toBeNull();
  });
});
