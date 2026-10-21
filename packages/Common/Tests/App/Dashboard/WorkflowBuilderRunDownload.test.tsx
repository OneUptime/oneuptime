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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as CanvasProps } from "../../../UI/Components/Workflow/Workflow";

/*
 * Downloading the run the builder just started.
 *
 * Run Workflow in the builder opens the same run modal the Runs pages use,
 * following the run while it goes. Its Copy log and Download have to name
 * the file after this workflow and this run like everywhere else, which the
 * page can only do if it asks for the workflow's name and the run's times.
 * The real Builder page is rendered; the canvas is a stand-in that hands the
 * test its callbacks, the API answers from here, and the browser's download
 * is a recorder.
 */

const WORKFLOW_NAME: string = "Nightly sync";
const RUN_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194161abc";

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

const mockGetItem: MockFunction = getJestMockFunction();
const mockGetList: MockFunction = getJestMockFunction();
const mockPost: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
      updateById: async (): Promise<unknown> => {
        return {};
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
      getFriendlyMessage: (): string => {
        return "Request failed";
      },
    },
  };
});

interface DownloadCall {
  content: Blob | string;
  filename: string;
  mimeType?: string | undefined;
}

const mockDownloads: Array<DownloadCall> = [];

jest.mock("../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: (data: DownloadCall): void => {
      mockDownloads.push(data);
    },
  };
});

let mockCanvasProps: CanvasProps | null = null;

jest.mock("../../../UI/Components/Workflow/Workflow", () => {
  return {
    __esModule: true,
    default: (props: CanvasProps): React.ReactElement => {
      mockCanvasProps = props;

      return <div data-testid="workflow-canvas" />;
    },
    getEdgeDefaultProps: (): Record<string, unknown> => {
      return {};
    },
    getPlaceholderTriggerNode: (): Record<string, unknown> => {
      return {
        id: "placeholder",
        type: "node",
        position: { x: 0, y: 0 },
        data: { nodeType: "PlaceholderNode", componentType: "Trigger" },
      };
    },
  };
});

import Builder from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import WorkflowModel from "../../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../../Models/DatabaseModels/WorkflowLog";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { NodeDataProp } from "../../../Types/Workflow/Component";
import { WorkflowStepStatus } from "../../../Types/Workflow/StepTrace";
import WorkflowStatus from "../../../Types/Workflow/WorkflowStatus";
import Navigation from "../../../UI/Utils/Navigation";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161002",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

const LOG: string = [
  "Oct 01 2026, 10:33:07 GMT: Executing Component: log-1",
  "Oct 01 2026, 10:33:07 GMT: Deployment finished",
].join("\n");

// What the worker writes once it picks the run up.
const theRun: () => WorkflowLog = (): WorkflowLog => {
  const run: WorkflowLog = new WorkflowLog();

  run._id = RUN_ID;
  run.workflowStatus = WorkflowStatus.Success;
  run.logs = LOG;
  run.stepTrace = {
    steps: [
      {
        componentId: "log-1",
        metadataId: "log",
        title: "Log",
        status: WorkflowStepStatus.Success,
        startedAt: "2026-10-01T10:33:07.000Z",
        completedAt: "2026-10-01T10:33:07.005Z",
        durationInMs: 5,
        argumentValues: { value: "Deployment finished" },
        returnValues: {},
        executedPort: "out",
      },
    ],
  } as unknown as JSONObject;
  run.createdAt = new Date("2026-10-01T10:33:06.000Z");
  run.startedAt = new Date("2026-10-01T10:33:07.000Z");
  run.completedAt = new Date("2026-10-01T10:33:08.000Z");

  return run;
};

// No run until the trigger has been sent; the worker's run after that.
let runsInTheDatabase: Array<WorkflowLog> = [];

type CanvasFunction = () => CanvasProps;

const canvas: CanvasFunction = (): CanvasProps => {
  if (!mockCanvasProps) {
    throw new Error("Expected the builder to draw its canvas.");
  }

  return mockCanvasProps;
};

type RenderBuilderFunction = () => Promise<void>;

const renderBuilder: RenderBuilderFunction = async (): Promise<void> => {
  render(<Builder {...PAGE_PROPS} />);

  await waitFor(() => {
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });
};

type RunTheWorkflowFunction = () => Promise<void>;

// Run Workflow, from the canvas's run dialog.
const runTheWorkflow: RunTheWorkflowFunction = async (): Promise<void> => {
  await act(async () => {
    canvas().onRun({ arguments: {} } as unknown as NodeDataProp);
  });
};

type RunModalFunction = () => Promise<HTMLElement>;

const runModal: RunModalFunction = async (): Promise<HTMLElement> => {
  return await screen.findByTestId("modal");
};

beforeEach(() => {
  mockCanvasProps = null;
  mockDownloads.length = 0;
  runsInTheDatabase = [];
  mockGetItem.mockReset();
  mockGetList.mockReset();
  mockPost.mockReset();

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);

  mockGetItem.mockImplementation(async () => {
    const workflow: WorkflowModel = new WorkflowModel();

    workflow.graph = { nodes: [], edges: [] };
    workflow.name = WORKFLOW_NAME;

    return workflow;
  });

  mockGetList.mockImplementation(async () => {
    return {
      data: runsInTheDatabase,
      count: runsInTheDatabase.length,
      skip: 0,
      limit: 1,
    };
  });

  mockPost.mockImplementation(async () => {
    runsInTheDatabase = [theRun()];

    return { data: {} };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("downloading the run the builder just started", () => {
  test("the builder asks for its workflow's name, which the download is named after", async () => {
    await renderBuilder();

    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(
      (mockGetItem.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select["name"],
    ).toBe(true);
  });

  test("it follows the run with its times, which head the downloaded log", async () => {
    await renderBuilder();
    await runTheWorkflow();
    await runModal();

    const calls: Array<Array<unknown>> = mockGetList.mock.calls;
    const select: Record<string, unknown> = (
      calls[calls.length - 1]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select).toMatchObject({
      _id: true,
      workflowStatus: true,
      logs: true,
      stepTrace: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    });
  });

  test("the run's modal offers Copy log and Download once the run has logged", async () => {
    await renderBuilder();
    await runTheWorkflow();

    const modal: HTMLElement = await runModal();

    expect(modal).toHaveTextContent("This is the run you just started.");

    await waitFor(() => {
      expect(
        within(modal).getByTestId("workflow-run-copy-log"),
      ).toBeInTheDocument();
    });
    expect(within(modal).getByTestId("workflow-run-download")).toBeVisible();
  });

  test("Download log saves this run, named after this workflow", async () => {
    await renderBuilder();
    await runTheWorkflow();

    const modal: HTMLElement = await runModal();

    await waitFor(() => {
      expect(
        within(modal).getByTestId("workflow-run-download"),
      ).toBeInTheDocument();
    });

    fireEvent.click(within(modal).getByTestId("workflow-run-download"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download log" }));

    expect(mockDownloads).toHaveLength(1);
    expect(mockDownloads[0]!.filename).toBe(
      `nightly-sync-run-${RUN_ID}-2026-10-01T10-33-07.txt`,
    );
    expect(mockDownloads[0]!.content).toBe(
      [
        `Workflow: ${WORKFLOW_NAME}`,
        `Workflow ID: ${WORKFLOW_ID.toString()}`,
        `Run ID: ${RUN_ID}`,
        "Status: Executed",
        "Scheduled at: 2026-10-01T10:33:06.000Z",
        "Started at: 2026-10-01T10:33:07.000Z",
        "Completed at: 2026-10-01T10:33:08.000Z",
        "",
        LOG,
        "",
      ].join("\n"),
    );
  });

  test("Download run as JSON saves its steps", async () => {
    await renderBuilder();
    await runTheWorkflow();

    const modal: HTMLElement = await runModal();

    await waitFor(() => {
      expect(
        within(modal).getByTestId("workflow-run-download"),
      ).toBeInTheDocument();
    });

    fireEvent.click(within(modal).getByTestId("workflow-run-download"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Download run as JSON" }),
    );

    const saved: {
      workflow: { name: string };
      run: { id: string; status: string };
      stepTrace: { steps: Array<{ componentId: string }> };
    } = JSON.parse(mockDownloads[0]!.content as string);

    expect(mockDownloads[0]!.filename).toBe(
      `nightly-sync-run-${RUN_ID}-2026-10-01T10-33-07.json`,
    );
    expect(saved.workflow.name).toBe(WORKFLOW_NAME);
    expect(saved.run).toMatchObject({ id: RUN_ID, status: "Success" });
    expect(saved.stepTrace.steps[0]!.componentId).toBe("log-1");
  });

  /*
   * Until the worker has picked the run up there is nothing to copy or
   * download: the modal says the run is starting and offers neither.
   */
  test("before the run is found, there is nothing to download", async () => {
    mockPost.mockImplementation(async () => {
      return { data: {} };
    });

    await renderBuilder();
    await runTheWorkflow();

    const modal: HTMLElement = await runModal();

    expect(modal).toHaveTextContent("Starting run…");
    expect(
      within(modal).queryByTestId("workflow-run-export-actions"),
    ).not.toBeInTheDocument();
  });
});
