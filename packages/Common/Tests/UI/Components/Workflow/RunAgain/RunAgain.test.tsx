/*
 * Issue #5944, in the Dashboard: Run again in a run's window, in a run list's
 * row, and the last run's values in the Run Workflow panel. The components are
 * the real thing; what the API answers is stood in for.
 */

jest.mock("../../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
      getCommonHeaders: jest.fn(() => {
        return { tenantid: "project" };
      }),
    },
  };
});

jest.mock("../../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
      getFriendlyMessage: jest.fn((err: Error) => {
        return err.message;
      }),
    },
  };
});

jest.mock("../../../../../UI/Components/Workflow/WorkflowRunGate", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../UI/Components/Workflow/WorkflowRunGate",
  );

  return { ...actual, getWorkflowRunGate: jest.fn() };
});

// Monaco does not run under jsdom.
jest.mock("../../../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: () => {
      return <textarea />;
    },
  };
});

import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../../../Types/Icon/IconProp";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import { emptyTrace } from "../../../../../Types/Workflow/StepTrace";
import WorkflowStatus from "../../../../../Types/Workflow/WorkflowStatus";
import WorkflowLog from "../../../../../Models/DatabaseModels/WorkflowLog";
import { ActionButtonPlacement } from "../../../../../UI/Components/ActionButton/ActionButtonSchema";
import { getWorkflowRunAgainAction } from "../../../../../UI/Components/Workflow/RunAgain/RunAgainAction";
import RunAgainButton, {
  RunAgainCopy,
} from "../../../../../UI/Components/Workflow/RunAgain/RunAgainButton";
import RunAgainFromLastRun from "../../../../../UI/Components/Workflow/RunAgain/RunAgainFromLastRun";
import {
  fetchLatestWorkflowRun,
  loadLastRunToRunAgain,
  sendRunAgain,
} from "../../../../../UI/Components/Workflow/RunAgain/RunAgainSource";
import WorkflowRunWindow from "../../../../../UI/Components/Workflow/RunAgain/WorkflowRunWindow";
import RunModal from "../../../../../UI/Components/Workflow/RunModal";
import { WatchedRunDetail } from "../../../../../UI/Components/Workflow/UseRunWatch";
import {
  WorkflowRunExport,
  WorkflowRunExportFormat,
  getWorkflowRunExportFile,
  getWorkflowRunExportFromWorkflowLog,
} from "../../../../../UI/Components/Workflow/WorkflowRunExport";
import { getWorkflowRunGate } from "../../../../../UI/Components/Workflow/WorkflowRunGate";
import API from "../../../../../UI/Utils/API/API";
import ModelAPI from "../../../../../UI/Utils/ModelAPI/ModelAPI";
import { resetPageScrollLockForTesting } from "../../../../../UI/Utils/PageScrollLock";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const WORKFLOW_ID: string = "d8000000-0000-4000-8000-0000000000a1";
const RUN_ID: string = "d8000000-0000-4000-8000-0000000000b1";
const NEW_RUN_ID: string = "d8000000-0000-4000-8000-0000000000b2";

const post: jest.Mock = API.post as unknown as jest.Mock;
const getList: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

type LockFunction = (reason?: string | undefined) => void;

const lock: LockFunction = (reason?: string | undefined): void => {
  (getWorkflowRunGate as jest.Mock).mockReturnValue(
    reason ? { isAllowed: false, disabledReason: reason } : { isAllowed: true },
  );
};

type AnswerPostFunction = (ok?: boolean | undefined) => void;

const answerPost: AnswerPostFunction = (ok: boolean = true): void => {
  (post as any).mockResolvedValue(
    ok
      ? new HTTPResponse(200, { status: "Scheduled" }, {})
      : new HTTPErrorResponse(400, { message: "Refused" }, {}),
  );
};

type RowFunction = (values?: Record<string, unknown>) => WorkflowLog;

const row: RowFunction = (
  values: Record<string, unknown> = {},
): WorkflowLog => {
  return {
    _id: NEW_RUN_ID,
    workflowStatus: WorkflowStatus.Running,
    logs: "the new run's log",
    createdAt: new Date("2026-11-05T10:00:00.000Z"),
    isTestRun: false,
    canRunAgain: true,
    ...values,
  } as unknown as WorkflowLog;
};

type AnswerListFunction = (rows: Array<WorkflowLog>) => void;

const answerList: AnswerListFunction = (rows: Array<WorkflowLog>): void => {
  (getList as any).mockResolvedValue({
    data: rows,
    count: rows.length,
    skip: 0,
    limit: 1,
  });
};

type OpenedRunFunction = (
  values?: Partial<WorkflowRunExport>,
) => WorkflowRunExport;

const openedRun: OpenedRunFunction = (
  values: Partial<WorkflowRunExport> = {},
): WorkflowRunExport => {
  return {
    runId: RUN_ID,
    workflowId: WORKFLOW_ID,
    workflowName: "Tickets",
    status: WorkflowStatus.Error,
    canRunAgain: true,
    logs: "the old run's log",
    stepTrace: emptyTrace(),
    ...values,
  };
};

type PressRunAgainFunction = () => void;

const pressRunAgain: PressRunAgainFunction = (): void => {
  fireEvent.click(screen.getByTestId("workflow-run-again"));
};

type ConfirmFunction = () => Promise<void>;

// The dialog's own Run again, not the button that opened it.
const confirm: ConfirmFunction = async (): Promise<void> => {
  const dialog: HTMLElement = screen.getByTestId("modal-footer-submit-button");

  await act(async () => {
    fireEvent.click(dialog);
  });
};

beforeEach(() => {
  post.mockReset();
  getList.mockReset();
  lock();
  answerPost();
  answerList([row()]);
  resetPageScrollLockForTesting();
});

afterEach(() => {
  cleanup();
});

describe("sendRunAgain", () => {
  test("posts to the run's own route, as the person's project", async () => {
    await sendRunAgain(RUN_ID);

    const call: {
      url: { toString: () => string };
      headers: Record<string, string>;
    } = post.mock.calls[0]?.[0] as never;

    expect(call.url.toString()).toContain(`/manual/run-again/${RUN_ID}`);
    expect(call.headers).toEqual({ tenantid: "project" });
  });

  test("sends nothing of the run: the server has what it started with", async () => {
    await sendRunAgain(RUN_ID);

    expect((post.mock.calls[0]?.[0] as { data: unknown }).data).toEqual({});
  });

  test("rejects with the API's error when it is refused", async () => {
    answerPost(false);

    await expect(sendRunAgain(RUN_ID)).rejects.toBeInstanceOf(
      HTTPErrorResponse,
    );
  });
});

describe("fetchLatestWorkflowRun", () => {
  test("asks for the workflow's newest run, with what its window shows", async () => {
    await fetchLatestWorkflowRun(new ObjectID(WORKFLOW_ID));

    const call: Record<string, any> = getList.mock.calls[0]?.[0] as never;

    expect(String(call["query"].workflowId)).toBe(WORKFLOW_ID);
    expect(call["limit"]).toBe(1);
    expect(call["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(call["select"].canRunAgain).toBe(true);
    expect(call["select"].logs).toBe(true);
    expect(call["select"].stepTrace).toBe(true);
  });

  test("never asks for what the run started with: nobody may read it", async () => {
    await fetchLatestWorkflowRun(new ObjectID(WORKFLOW_ID));

    expect(
      (getList.mock.calls[0]?.[0] as Record<string, any>)["select"]
        .triggerValues,
    ).toBeUndefined();
  });

  test("reads the run", async () => {
    const run: WatchedRunDetail | null = await fetchLatestWorkflowRun(
      new ObjectID(WORKFLOW_ID),
    );

    expect(run?.runId).toBe(NEW_RUN_ID);
    expect(run?.status).toBe(WorkflowStatus.Running);
    expect(run?.logs).toBe("the new run's log");
    expect(run?.canRunAgain).toBe(true);
  });

  test("says when a run cannot be run again", async () => {
    answerList([row({ canRunAgain: false })]);

    expect(
      (await fetchLatestWorkflowRun(new ObjectID(WORKFLOW_ID)))?.canRunAgain,
    ).toBe(false);
  });

  test("is null when the workflow has not run", async () => {
    answerList([]);

    expect(await fetchLatestWorkflowRun(new ObjectID(WORKFLOW_ID))).toBeNull();
  });
});

describe("loadLastRunToRunAgain", () => {
  test("asks only for a run that can be run again, newest first", async () => {
    await loadLastRunToRunAgain(new ObjectID(WORKFLOW_ID));

    const call: Record<string, any> = getList.mock.calls[0]?.[0] as never;

    expect(call["query"].canRunAgain).toBe(true);
    expect(String(call["query"].workflowId)).toBe(WORKFLOW_ID);
    expect(call["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(call["limit"]).toBe(1);
  });

  test("gives its id and when it was", async () => {
    answerList([row({ _id: RUN_ID })]);

    expect(await loadLastRunToRunAgain(new ObjectID(WORKFLOW_ID))).toEqual({
      runId: RUN_ID,
      scheduledAt: new Date("2026-11-05T10:00:00.000Z"),
    });
  });

  test("is null when no run can be", async () => {
    answerList([]);

    expect(await loadLastRunToRunAgain(new ObjectID(WORKFLOW_ID))).toBeNull();
  });
});

describe("RunAgainButton", () => {
  type DrawFunction = (send?: MockFunction) => void;

  const draw: DrawFunction = (send?: MockFunction): void => {
    render(
      <RunAgainButton
        send={(send || (jest.fn(async () => {}) as never)) as never}
      />,
    );
  };

  test("says Run again, and starts nothing by itself", () => {
    const send: MockFunction = getJestMockFunction();

    draw(send);

    expect(screen.getByTestId("workflow-run-again")).toHaveTextContent(
      RunAgainCopy.runAgain,
    );
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByText(RunAgainCopy.confirmTitle)).toBeNull();
  });

  test("asks first, and says the steps run for real", () => {
    const send: MockFunction = getJestMockFunction();

    draw(send);
    pressRunAgain();

    expect(screen.getByText(RunAgainCopy.confirmTitle)).toBeInTheDocument();
    expect(
      screen.getByText(RunAgainCopy.confirmDescription),
    ).toBeInTheDocument();
    expect(RunAgainCopy.confirmDescription).toContain(
      "Every step runs for real",
    );
    expect(send).not.toHaveBeenCalled();
  });

  test("Cancel starts nothing", () => {
    const send: MockFunction = getJestMockFunction();

    draw(send);
    pressRunAgain();
    fireEvent.click(screen.getByText("Cancel"));

    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByText(RunAgainCopy.confirmTitle)).toBeNull();
  });

  test("the dialog's button starts it, and closes once it has", async () => {
    const send: jest.Mock<() => Promise<void>> = jest.fn(async () => {});

    render(<RunAgainButton send={send} />);
    pressRunAgain();
    await confirm();

    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(RunAgainCopy.confirmTitle)).toBeNull();
  });

  test("a refusal is said in the dialog, which stays open to try again", async () => {
    const send: jest.Mock<() => Promise<void>> = jest.fn(async () => {
      throw new Error("You do not have permission to run this workflow.");
    });

    render(<RunAgainButton send={send} />);
    pressRunAgain();
    await confirm();

    expect(screen.getByText(RunAgainCopy.confirmTitle)).toBeInTheDocument();
    expect(
      screen.getByText("You do not have permission to run this workflow."),
    ).toBeInTheDocument();

    await confirm();

    expect(send).toHaveBeenCalledTimes(2);
  });

  test("the refusal is gone when the dialog is opened again", async () => {
    const send: jest.Mock<() => Promise<void>> = jest.fn(async () => {
      throw new Error("Refused");
    });

    render(<RunAgainButton send={send} />);
    pressRunAgain();
    await confirm();
    fireEvent.click(screen.getByText("Cancel"));
    pressRunAgain();

    expect(screen.queryByText("Refused")).toBeNull();
  });

  test("while it is on its way the dialog's button cannot be pressed again", async () => {
    let finish: () => void = () => {};
    const send: jest.Mock<() => Promise<void>> = jest.fn(() => {
      return new Promise<void>((resolve: () => void) => {
        finish = resolve;
      });
    });

    render(<RunAgainButton send={send} />);
    pressRunAgain();

    await confirm();
    await confirm();

    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
  });

  test("for someone who may not run the workflow it is locked, saying why", () => {
    lock("You do not have permission to run this workflow.");

    draw();

    const button: HTMLElement = screen.getByTestId("workflow-run-again");

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(screen.queryByText(RunAgainCopy.confirmTitle)).toBeNull();
  });
});

describe("Run again in a run list's row", () => {
  type ActionFunction = (
    onStarted?: MockFunction,
  ) => ReturnType<typeof getWorkflowRunAgainAction>;

  const action: ActionFunction = (
    onStarted?: MockFunction,
  ): ReturnType<typeof getWorkflowRunAgainAction> => {
    return getWorkflowRunAgainAction({
      onStarted: (onStarted || getJestMockFunction()) as never,
    });
  };

  test("waits in the row's ⋯ menu: View Logs keeps the row's button", () => {
    expect(action().placement).toBe(ActionButtonPlacement.MoreMenu);
    expect(action().title).toBe(RunAgainCopy.runAgain);
    expect(action().icon).toBe(IconProp.Refresh);
  });

  test("is on a row that can be run again, and no other", () => {
    expect(action().isVisible?.(row({ canRunAgain: true }))).toBe(true);
    expect(action().isVisible?.(row({ canRunAgain: false }))).toBe(false);
    expect(action().isVisible?.(row({ canRunAgain: undefined }))).toBe(false);
  });

  test("asks first, in the same words", () => {
    expect(action().getConfirmation?.(row())).toEqual({
      title: RunAgainCopy.confirmTitle,
      description: RunAgainCopy.confirmDescription,
      submitButtonText: RunAgainCopy.runAgain,
    });
  });

  test("is open to whoever may run the workflow", () => {
    expect(action().disabled).toBe(false);
    expect(action().tooltip).toBeUndefined();
  });

  test("is locked for anyone else, saying why", () => {
    lock("You do not have permission to run this workflow.");

    expect(action().disabled).toBe(true);
    expect(action().tooltip).toBe(
      "You do not have permission to run this workflow.",
    );
  });

  test("starts the run, shows it in the list and opens it", async () => {
    const onStarted: MockFunction = getJestMockFunction();
    const onCompleteAction: MockFunction = getJestMockFunction();
    const onError: MockFunction = getJestMockFunction();
    const refresh: MockFunction = getJestMockFunction();
    const run: WorkflowLog = row({ _id: RUN_ID });

    await (action(onStarted).onClick(
      run,
      onCompleteAction as never,
      onError as never,
      { refresh: refresh as never },
    ) as unknown);

    expect(
      (
        post.mock.calls[0]?.[0] as { url: { toString: () => string } }
      ).url.toString(),
    ).toContain(`/manual/run-again/${RUN_ID}`);
    expect(onCompleteAction).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledWith(run);
    expect(onError).not.toHaveBeenCalled();
  });

  test("a list with no way to refresh carries on without one", async () => {
    const onStarted: MockFunction = getJestMockFunction();

    await (action(onStarted).onClick(
      row(),
      getJestMockFunction() as never,
      getJestMockFunction() as never,
    ) as unknown);

    expect(onStarted).toHaveBeenCalledTimes(1);
  });

  test("a refusal is handed to the dialog, in the API's words, and nothing opens", async () => {
    answerPost(false);
    (API.getFriendlyMessage as jest.Mock).mockReturnValueOnce("Refused");

    const onStarted: MockFunction = getJestMockFunction();
    const onCompleteAction: MockFunction = getJestMockFunction();
    const onError: MockFunction = getJestMockFunction();

    await (action(onStarted).onClick(
      row(),
      onCompleteAction as never,
      onError as never,
    ) as unknown);

    expect(
      ((onError as unknown as jest.Mock).mock.calls[0]?.[0] as Error).message,
    ).toBe("Refused");
    expect(onStarted).not.toHaveBeenCalled();
    expect(onCompleteAction).not.toHaveBeenCalled();
  });
});

describe("a run saved as a file", () => {
  test.each([WorkflowRunExportFormat.Log, WorkflowRunExportFormat.JSON])(
    "as %s says nothing of whether it can be run again",
    (format: WorkflowRunExportFormat) => {
      const content: string = String(
        getWorkflowRunExportFile(openedRun(), format).content,
      );

      expect(content).not.toContain("canRunAgain");
      expect(content).not.toContain("Can Run Again");
    },
  );

  test("reads whether it can be from the row", () => {
    expect(
      getWorkflowRunExportFromWorkflowLog(row({ canRunAgain: true }))
        .canRunAgain,
    ).toBe(true);
    expect(
      getWorkflowRunExportFromWorkflowLog(row({ canRunAgain: undefined }))
        .canRunAgain,
    ).toBe(false);
  });
});

describe("a run's window", () => {
  type OpenFunction = (data?: {
    run?: Partial<WorkflowRunExport>;
    isNewRun?: boolean;
    onRunStarted?: MockFunction;
    onClose?: MockFunction;
  }) => void;

  const open: OpenFunction = (data?: {
    run?: Partial<WorkflowRunExport>;
    isNewRun?: boolean;
    onRunStarted?: MockFunction;
    onClose?: MockFunction;
  }): void => {
    render(
      <WorkflowRunWindow
        openRun={{ run: openedRun(data?.run), isNewRun: data?.isNewRun }}
        onRunStarted={data?.onRunStarted as never}
        onClose={(data?.onClose || getJestMockFunction()) as never}
      />,
    );
  };

  test("shows the run it was opened on", () => {
    open();

    fireEvent.click(screen.getByText("Full Log"));

    expect(screen.getByText(/the old run's log/)).toBeInTheDocument();
    expect(getList).not.toHaveBeenCalled();
  });

  test("offers Run again beside its status", () => {
    open();

    expect(
      within(screen.getByTestId("workflow-run-toolbar")).getByTestId(
        "workflow-run-again",
      ),
    ).toBeInTheDocument();
  });

  test.each([
    ["a run that cannot be run again", { canRunAgain: false }],
    ["a run that does not say", { canRunAgain: undefined }],
    ["a run with no id", { runId: null }],
  ])(
    "offers nothing for %s",
    (_name: string, run: Partial<WorkflowRunExport>) => {
      open({ run: run });

      expect(screen.queryByTestId("workflow-run-again")).toBeNull();
    },
  );

  test("runs again the run it shows", async () => {
    open();

    pressRunAgain();
    await confirm();

    expect(
      (
        post.mock.calls[0]?.[0] as { url: { toString: () => string } }
      ).url.toString(),
    ).toContain(`/manual/run-again/${RUN_ID}`);
  });

  test("then follows the new run, saying that is what it is", async () => {
    answerList([row({ _id: RUN_ID, logs: "the old run's log" })]);

    open();

    pressRunAgain();

    // Polls after the request find the new run.
    (post as any).mockImplementation(async () => {
      answerList([row()]);
      return new HTTPResponse(200, { status: "Scheduled" }, {});
    });

    await confirm();

    expect(
      screen.getByText(RunAgainCopy.newRunDescription),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Full Log"));

    await waitFor(() => {
      expect(screen.getByText(/the new run's log/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/the old run's log/)).toBeNull();
  });

  test("tells the page, so its list shows the new run", async () => {
    const onRunStarted: MockFunction = getJestMockFunction();

    open({ onRunStarted: onRunStarted });

    pressRunAgain();
    await confirm();

    expect(onRunStarted).toHaveBeenCalledTimes(1);
  });

  test("offers no second Run again while the new run is going", async () => {
    open();

    pressRunAgain();
    await confirm();

    await waitFor(() => {
      expect(screen.getByTestId("workflow-run-status-row")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("workflow-run-again")).toBeNull();
  });

  test("once the new run has settled it can be run again, by its own id", async () => {
    answerList([row({ _id: RUN_ID })]);

    open();

    (post as any).mockImplementation(async () => {
      answerList([row({ workflowStatus: WorkflowStatus.Success })]);
      return new HTTPResponse(200, { status: "Scheduled" }, {});
    });

    pressRunAgain();
    await confirm();

    await waitFor(() => {
      expect(screen.getByTestId("workflow-run-again")).toBeInTheDocument();
    });

    pressRunAgain();
    await confirm();

    expect(
      (
        post.mock.calls[1]?.[0] as { url: { toString: () => string } }
      ).url.toString(),
    ).toContain(`/manual/run-again/${NEW_RUN_ID}`);
  });

  test("opened from a row, it follows the new run from the start", async () => {
    open({ isNewRun: true, run: { logs: "the row's log" } });

    expect(
      screen.getByText(RunAgainCopy.newRunDescription),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Full Log"));

    await waitFor(() => {
      expect(screen.getByText(/the new run's log/)).toBeInTheDocument();
    });

    expect(screen.queryByText(/the row's log/)).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  test("a refusal stays in the dialog, and the run stays on screen", async () => {
    answerPost(false);
    (API.getFriendlyMessage as jest.Mock).mockReturnValueOnce("Refused");

    open();

    pressRunAgain();
    await confirm();

    expect(screen.getByText("Refused")).toBeInTheDocument();
    expect(screen.queryByText(RunAgainCopy.newRunDescription)).toBeNull();
  });
});

describe("the last run's values, in the Run Workflow panel", () => {
  const TRIGGER: NodeDataProp = {
    error: "",
    id: "webhook-1",
    nodeType: NodeType.Node,
    metadata: {
      id: "webhook",
      title: "Webhook",
      category: "Webhook",
      description: "",
      iconProp: IconProp.Webhook,
      componentType: ComponentType.Trigger,
      arguments: [],
      returnValues: [],
      inPorts: [],
      outPorts: [],
    } as unknown as ComponentMetadata,
    metadataId: "webhook",
    internalId: "webhook-1",
    arguments: {},
    returnValues: {},
    componentType: ComponentType.Trigger,
  } as unknown as NodeDataProp;

  type LoadMock = jest.Mock<
    () => Promise<{ runId: string; scheduledAt: Date | null } | null>
  >;

  type LoadOfFunction = (
    run: { runId: string; scheduledAt: Date | null } | null,
  ) => LoadMock;

  const loadOf: LoadOfFunction = (
    run: { runId: string; scheduledAt: Date | null } | null,
  ): LoadMock => {
    return jest.fn(async () => {
      return run;
    }) as unknown as LoadMock;
  };

  const LAST_RUN: { runId: string; scheduledAt: Date | null } = {
    runId: RUN_ID,
    scheduledAt: new Date("2026-11-05T10:00:00.000Z"),
  };

  describe("on its own", () => {
    test("says nothing until there is a run to start from", async () => {
      const load: LoadMock = loadOf(null);

      render(
        <RunAgainFromLastRun
          workflowId={new ObjectID(WORKFLOW_ID)}
          onRunAgain={jest.fn(async () => {}) as never}
          loadLastRun={load as never}
        />,
      );

      await waitFor(() => {
        expect(load).toHaveBeenCalledTimes(1);
      });

      expect(screen.queryByTestId("run-again-last-run")).toBeNull();
    });

    test("says nothing when the runs cannot be read", async () => {
      const load: LoadMock = jest.fn(async () => {
        throw new Error("Not allowed");
      }) as unknown as LoadMock;

      render(
        <RunAgainFromLastRun
          workflowId={new ObjectID(WORKFLOW_ID)}
          onRunAgain={jest.fn(async () => {}) as never}
          loadLastRun={load as never}
        />,
      );

      await waitFor(() => {
        expect(load).toHaveBeenCalledTimes(1);
      });

      expect(screen.queryByTestId("run-again-last-run")).toBeNull();
    });

    test("reads the workflow's own runs", async () => {
      const load: LoadMock = loadOf(LAST_RUN);

      render(
        <RunAgainFromLastRun
          workflowId={new ObjectID(WORKFLOW_ID)}
          onRunAgain={jest.fn(async () => {}) as never}
          loadLastRun={load as never}
        />,
      );

      await screen.findByTestId("run-again-last-run");

      expect(
        String((load.mock.calls[0] as Array<unknown> | undefined)?.[0]),
      ).toBe(WORKFLOW_ID);
    });

    test("says which run, by when it was", async () => {
      render(
        <RunAgainFromLastRun
          workflowId={new ObjectID(WORKFLOW_ID)}
          onRunAgain={jest.fn(async () => {}) as never}
          loadLastRun={loadOf(LAST_RUN) as never}
        />,
      );

      const card: HTMLElement = await screen.findByTestId("run-again-last-run");

      expect(card).toHaveTextContent(RunAgainCopy.lastRunTitle);
      expect(card).toHaveTextContent("2026");
    });

    test("a run with no date still offers itself", async () => {
      render(
        <RunAgainFromLastRun
          workflowId={new ObjectID(WORKFLOW_ID)}
          onRunAgain={jest.fn(async () => {}) as never}
          loadLastRun={loadOf({ runId: RUN_ID, scheduledAt: null }) as never}
        />,
      );

      expect(await screen.findByTestId("run-again-last-run")).toHaveTextContent(
        RunAgainCopy.lastRunTitle,
      );
    });

    test("an answer that arrives after it has gone is dropped", async () => {
      let answer: (run: {
        runId: string;
        scheduledAt: Date | null;
      }) => void = () => {};
      const load: LoadMock = jest.fn(() => {
        return new Promise(
          (
            resolve: (run: { runId: string; scheduledAt: Date | null }) => void,
          ) => {
            answer = resolve;
          },
        );
      }) as unknown as LoadMock;

      const { unmount } = render(
        <RunAgainFromLastRun
          workflowId={new ObjectID(WORKFLOW_ID)}
          onRunAgain={jest.fn(async () => {}) as never}
          loadLastRun={load as never}
        />,
      );

      unmount();

      await act(async () => {
        answer(LAST_RUN);
      });

      expect(screen.queryByTestId("run-again-last-run")).toBeNull();
    });
  });

  describe("in the panel", () => {
    type OpenPanelFunction = (data?: {
      onRunAgain?: unknown;
      onClose?: MockFunction;
      trigger?: NodeDataProp;
      workflowId?: ObjectID | undefined;
    }) => void;

    const openPanel: OpenPanelFunction = (data?: {
      onRunAgain?: unknown;
      onClose?: MockFunction;
      trigger?: NodeDataProp;
      workflowId?: ObjectID | undefined;
    }): void => {
      render(
        <RunModal
          trigger={data?.trigger || TRIGGER}
          workflowId={
            data && "workflowId" in data
              ? data.workflowId
              : new ObjectID(WORKFLOW_ID)
          }
          onClose={(data?.onClose || getJestMockFunction()) as never}
          onRun={getJestMockFunction() as never}
          onRunAgain={data?.onRunAgain as never}
          loadLastRun={loadOf(LAST_RUN) as never}
        />,
      );
    };

    test("is offered once there is a way to start it", async () => {
      openPanel({ onRunAgain: jest.fn(async () => {}) });

      expect(
        await screen.findByTestId("run-again-last-run"),
      ).toBeInTheDocument();
    });

    test("is not offered with no way to start it", async () => {
      openPanel();

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByTestId("run-again-last-run")).toBeNull();
    });

    test("is not offered with no workflow to read", async () => {
      openPanel({ onRunAgain: jest.fn(async () => {}), workflowId: undefined });

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByTestId("run-again-last-run")).toBeNull();
    });

    test("is not offered while there is no trigger to run from", async () => {
      openPanel({
        onRunAgain: jest.fn(async () => {}),
        trigger: { ...TRIGGER, nodeType: NodeType.PlaceholderNode },
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByTestId("run-again-last-run")).toBeNull();
    });

    test("asks first, starts that run again and closes the panel", async () => {
      const onRunAgain: jest.Mock<(runId: string) => Promise<void>> = jest.fn(
        async () => {},
      );
      const onClose: MockFunction = getJestMockFunction();

      openPanel({ onRunAgain: onRunAgain, onClose: onClose });

      await screen.findByTestId("run-again-last-run");

      pressRunAgain();

      expect(onRunAgain).not.toHaveBeenCalled();

      await confirm();

      expect(onRunAgain).toHaveBeenCalledWith(RUN_ID);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("a refusal is said where it was asked, and the panel stays", async () => {
      const onRunAgain: jest.Mock<() => Promise<void>> = jest.fn(async () => {
        throw new Error("This workflow is archived.");
      });
      const onClose: MockFunction = getJestMockFunction();

      openPanel({ onRunAgain: onRunAgain, onClose: onClose });

      await screen.findByTestId("run-again-last-run");

      pressRunAgain();
      await confirm();

      expect(
        screen.getByText("This workflow is archived."),
      ).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    test("the panel's own Run Workflow still starts from its own form", async () => {
      openPanel({ onRunAgain: jest.fn(async () => {}) });

      await screen.findByTestId("run-again-last-run");

      expect(
        screen.getByText("Run Workflow", { selector: "h2" }),
      ).toBeInTheDocument();
    });
  });
});
