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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as CanvasProps } from "../../../UI/Components/Workflow/Workflow";

/*
 * The Builder of an archived workflow.
 *
 * An archived workflow does not run, from any trigger, whatever its Enabled
 * switch says; the banner across the top of its pages says so and offers
 * Unarchive. So the Builder does not also offer to turn it on: no "This
 * workflow is off" notice, and a run started from it is not held behind the
 * turn-on dialog (turning it on would flip the switch and still not run it).
 * The run is refused in the server's own words instead, and nothing is sent.
 * Unarchived on the page, the Builder goes back to the ordinary behaviour at
 * once.
 *
 * The harness is WorkflowBuilderTurnOn.test.tsx's: the real Builder page, a
 * stand-in canvas that hands over its run callbacks, and the API answered
 * from here.
 */

const WORKFLOW_NAME: string = "Notify on-call";

let mockPermissions: Array<string> = ["ProjectAdmin"];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions;
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
const mockUpdateById: MockFunction = getJestMockFunction();
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
      updateById: (...args: Array<unknown>): unknown => {
        return mockUpdateById(...args);
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
      // What the real one gives back: the error's own message.
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string } | null)?.message || "Server Error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: (): void => {
      // Not under test here.
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
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../Types/Workflow/Component";
import { WORKFLOW_TURNED_OFF_MESSAGE } from "../../../Types/Workflow/WorkflowEnabled";
import { WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE } from "../../../Types/Workflow/WorkflowArchive";
import { announceArchiveStateChange } from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ArchiveStateEvents";
import Navigation from "../../../UI/Utils/Navigation";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161003",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

type GraphNodeFunction = (data: {
  id: string;
  metadataId: string;
  componentType: ComponentType;
}) => JSONObject;

const graphNode: GraphNodeFunction = (data: {
  id: string;
  metadataId: string;
  componentType: ComponentType;
}): JSONObject => {
  return {
    id: `canvas-${data.id}`,
    type: "node",
    position: { x: 0, y: 0 },
    data: {
      id: data.id,
      internalId: `runner-${data.id}`,
      nodeType: NodeType.Node,
      componentType: data.componentType,
      metadataId: data.metadataId,
      error: "",
      arguments: {},
      returnValues: {},
    },
  };
};

// A webhook that decides, then does something: what the maintainer had open.
const WEBHOOK_GRAPH: JSONObject = {
  nodes: [
    graphNode({
      id: "webhook-1",
      metadataId: "webhook",
      componentType: ComponentType.Trigger,
    }),
    graphNode({
      id: "if-else-1",
      metadataId: "if-else",
      componentType: ComponentType.Component,
    }),
  ],
  edges: [],
};

const MANUAL_GRAPH: JSONObject = {
  nodes: [
    graphNode({
      id: "manual-1",
      metadataId: "manual",
      componentType: ComponentType.Trigger,
    }),
    graphNode({
      id: "log-1",
      metadataId: "log",
      componentType: ComponentType.Component,
    }),
  ],
  edges: [],
};

// The If / Else step, as its settings dialog hands it to Run just this step.
const IF_ELSE_STEP: NodeDataProp = {
  id: "if-else-1",
  internalId: "runner-if-else-1",
  nodeType: NodeType.Node,
  componentType: ComponentType.Component,
  metadataId: "if-else",
  metadata: { title: "If / Else" },
  error: "",
  arguments: {},
  returnValues: {},
} as unknown as NodeDataProp;

// The trigger, as the run panel hands it to Run Workflow.
const TRIGGER_WITH_VALUES: NodeDataProp = {
  arguments: { "request-body": '{"service": "checkout"}' },
} as unknown as NodeDataProp;

interface StoredWorkflow {
  isEnabled: boolean | undefined;
  isArchived: boolean;
  graph: JSONObject;
}

let stored: StoredWorkflow = {
  isEnabled: false,
  isArchived: true,
  graph: WEBHOOK_GRAPH,
};

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

type ActionFunction = () => Promise<void>;

// Run just this step, confirmed in the step's settings.
const runTheStep: ActionFunction = async (): Promise<void> => {
  await act(async () => {
    canvas().onRunStep?.(IF_ELSE_STEP);
  });
};

// Run Workflow, confirmed in the run panel.
const runTheWorkflow: ActionFunction = async (): Promise<void> => {
  await act(async () => {
    canvas().onRun(TRIGGER_WITH_VALUES);
  });
};

type ElementFunction = () => HTMLElement;

const enabledSwitch: ElementFunction = (): HTMLElement => {
  return screen.getByRole("switch", { name: "Enabled" });
};

const prompt: () => Promise<HTMLElement> = async (): Promise<HTMLElement> => {
  const body: HTMLElement = await screen.findByTestId(
    "workflow-turn-on-prompt",
  );

  return body.closest('[role="dialog"]') as HTMLElement;
};

type UpdatesFunction = () => Array<JSONObject>;

const savedSwitchValues: UpdatesFunction = (): Array<JSONObject> => {
  return mockUpdateById.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: JSONObject }).data;
  });
};

type ErrorDialogFunction = () => HTMLElement | null;

// The old way of saying anything: a dialog titled "Error".
const errorDialog: ErrorDialogFunction = (): HTMLElement | null => {
  return (
    screen.queryAllByRole("dialog").find((dialog: HTMLElement) => {
      return (
        within(dialog).queryByTestId("modal-title")?.textContent === "Error"
      );
    }) || null
  );
};

beforeEach(() => {
  mockCanvasProps = null;
  mockPermissions = [Permission.ProjectAdmin];
  stored = { isEnabled: false, isArchived: true, graph: WEBHOOK_GRAPH };
  mockGetItem.mockReset();
  mockGetList.mockReset();
  mockUpdateById.mockReset();
  mockPost.mockReset();

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);

  mockGetItem.mockImplementation(async () => {
    const workflow: WorkflowModel = new WorkflowModel();

    workflow.graph = stored.graph;
    workflow.name = WORKFLOW_NAME;
    workflow.isArchived = stored.isArchived;

    if (stored.isEnabled !== undefined) {
      workflow.isEnabled = stored.isEnabled;
    }

    return workflow;
  });

  mockUpdateById.mockImplementation(
    async (request: { data: JSONObject }): Promise<unknown> => {
      if (typeof request.data["isEnabled"] === "boolean") {
        stored.isEnabled = request.data["isEnabled"] as boolean;
      }

      return {};
    },
  );

  mockGetList.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 1 };
  });

  // The server: an archived workflow does not run, nor one that is off.
  mockPost.mockImplementation(async () => {
    if (stored.isArchived) {
      return new HTTPErrorResponse(
        400,
        { error: WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE },
        {},
      );
    }

    if (!stored.isEnabled) {
      return new HTTPErrorResponse(
        400,
        { error: WORKFLOW_TURNED_OFF_MESSAGE },
        {},
      );
    }

    return { data: { status: "Scheduled" } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

type UnarchiveFunction = () => void;

// The banner (or the Settings card) unarchives the workflow on this page.
const unarchiveOnThePage: UnarchiveFunction = (): void => {
  stored.isArchived = false;

  act(() => {
    announceArchiveStateChange({
      modelType: WorkflowModel,
      modelId: WORKFLOW_ID,
      isArchived: false,
    });
  });
};

describe("the Builder of an archived workflow", () => {
  test("reads whether it is archived in the one request it already makes", async () => {
    await renderBuilder();

    expect(mockGetItem).toHaveBeenCalledTimes(1);
    const select: Record<string, unknown> = (
      mockGetItem.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["isArchived"]).toBe(true);
    expect(select["isEnabled"]).toBe(true);
  });

  test("does not offer to turn it on: no notice, even though it is off", async () => {
    await renderBuilder();

    expect(screen.queryByTestId("workflow-turned-off-notice")).toBeNull();
    // The switch itself is still there, and still says off.
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("Run just this step is refused in the server's words, and nothing is sent or switched", async () => {
    await renderBuilder();

    await runTheStep();

    expect(screen.queryByTestId("workflow-turn-on-prompt")).toBeNull();
    const dialog: HTMLElement | null = errorDialog();
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveTextContent(WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE);
    expect(mockPost).not.toHaveBeenCalled();
    expect(savedSwitchValues()).toEqual([]);
  });

  test("Run Workflow is refused too, when the workflow is on", async () => {
    stored.isEnabled = true;
    stored.graph = MANUAL_GRAPH;

    await renderBuilder();
    await runTheWorkflow();

    expect(errorDialog()).toHaveTextContent(
      WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE,
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("unarchived on the page, it is an ordinary workflow that is off again", async () => {
    await renderBuilder();
    expect(screen.queryByTestId("workflow-turned-off-notice")).toBeNull();

    unarchiveOnThePage();

    expect(
      await screen.findByTestId("workflow-turned-off-notice"),
    ).toBeInTheDocument();

    // A run is held behind the turn-on dialog again.
    await runTheStep();

    expect(await prompt()).toBeInTheDocument();
    expect(errorDialog()).toBeNull();
  });

  test("a workflow that is not archived still gets the notice", async () => {
    stored.isArchived = false;

    await renderBuilder();

    expect(
      screen.getByTestId("workflow-turned-off-notice"),
    ).toBeInTheDocument();
  });
});
