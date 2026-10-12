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
 * Testing a workflow from the Builder while it is turned off, and turning it
 * on.
 *
 * "Run - Why do I have to enable a workflow in order to test run it? Can you
 * please fix it?" - the maintainer. The Builder used to hold a run started
 * while the workflow was off behind a "Turn on this workflow?" dialog, whose
 * only way forward turned the workflow on - letting its trigger loose just to
 * try it once. Off now pauses the trigger, not a person testing it:
 *
 *   - Run Workflow and Run just this step are sent as they are asked for,
 *     with no dialog, and the workflow stays off;
 *   - the run they start is a test run, which the run panel says before it
 *     runs and the run says once it is open, with who started it;
 *   - the notice above the canvas says the trigger is paused and that Run
 *     Workflow still tests it, with Turn on workflow for when it is ready;
 *   - a refused run is shown as the server words it.
 *
 * The real Builder page is rendered; the canvas is a stand-in that hands the
 * test its callbacks (Run just this step and Run Workflow end there), and the
 * API answers from here, as the server now does: a run a person starts goes
 * ahead whether the workflow is on or off.
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
import User from "../../../Models/DatabaseModels/User";
import WorkflowLog from "../../../Models/DatabaseModels/WorkflowLog";
import WorkflowModel from "../../../Models/DatabaseModels/Workflow";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../Types/Workflow/Component";
import WorkflowStatus from "../../../Types/Workflow/WorkflowStatus";
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
  graph: JSONObject;
}

let stored: StoredWorkflow = { isEnabled: false, graph: WEBHOOK_GRAPH };

// No run until one is sent; then the run the server queued for it.
let runsInTheDatabase: Array<WorkflowLog> = [];

type TheRunFunction = (isTestRun: boolean) => WorkflowLog;

const theRun: TheRunFunction = (isTestRun: boolean): WorkflowLog => {
  const person: User = new User();
  person.name = new Name("Ada Lovelace");

  const run: WorkflowLog = new WorkflowLog();
  run._id = "0198c8ec-2a1d-7f0c-9e75-384194161099";
  run.workflowStatus = WorkflowStatus.Success;
  run.logs = isTestRun
    ? "Oct 12 2026, 10:00:00 GMT: Test run, started by Ada Lovelace while this workflow is turned off."
    : "Oct 12 2026, 10:00:00 GMT: Workflow Scheduled.";
  run.stepTrace = { steps: [] } as unknown as JSONObject;
  run.createdAt = new Date("2026-10-12T10:00:00.000Z");
  run.isTestRun = isTestRun;
  run.startedByUser = person;

  return run;
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

type PostsToFunction = (route: string) => Array<Array<unknown>>;

const postsTo: PostsToFunction = (route: string): Array<Array<unknown>> => {
  return mockPost.mock.calls.filter((call: Array<unknown>) => {
    return String((call[0] as { url: unknown }).url).includes(route);
  });
};

type UpdatesFunction = () => Array<JSONObject>;

const savedSwitchValues: UpdatesFunction = (): Array<JSONObject> => {
  return mockUpdateById.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: JSONObject }).data;
  });
};

type ErrorDialogFunction = () => HTMLElement | null;

// A dialog titled "Error": how a refused run is shown.
const errorDialog: ErrorDialogFunction = (): HTMLElement | null => {
  return (
    screen.queryAllByRole("dialog").find((dialog: HTMLElement) => {
      return (
        within(dialog).queryByTestId("modal-title")?.textContent === "Error"
      );
    }) || null
  );
};

type RunModalFunction = () => Promise<HTMLElement>;

// The run the user just started, opened by the Builder.
const runModal: RunModalFunction = async (): Promise<HTMLElement> => {
  const description: HTMLElement = await screen.findByText(
    "This is the run you just started.",
  );

  return description.closest('[role="dialog"]') as HTMLElement;
};

type NoTurnOnDialogFunction = () => void;

// Nothing of the dialog that used to ask to turn the workflow on first.
const expectNoTurnOnDialog: NoTurnOnDialogFunction = (): void => {
  expect(screen.queryByTestId("workflow-turn-on-prompt")).toBeNull();
  expect(screen.queryByText("Turn on this workflow?")).toBeNull();
  expect(screen.queryByText("Turn on and run")).toBeNull();
  expect(screen.queryByText("Turn on and run step")).toBeNull();
};

beforeEach(() => {
  mockCanvasProps = null;
  mockPermissions = [Permission.ProjectAdmin];
  stored = { isEnabled: false, graph: WEBHOOK_GRAPH };
  runsInTheDatabase = [];
  mockGetItem.mockReset();
  mockGetList.mockReset();
  mockUpdateById.mockReset();
  mockPost.mockReset();

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);

  mockGetItem.mockImplementation(async () => {
    const workflow: WorkflowModel = new WorkflowModel();

    workflow.graph = stored.graph;
    workflow.name = WORKFLOW_NAME;

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
    return {
      data: runsInTheDatabase,
      count: runsInTheDatabase.length,
      skip: 0,
      limit: 1,
    };
  });

  /*
   * The server: a run a person starts goes ahead whether the workflow is on
   * or off, and one started while it is off is a test run.
   */
  mockPost.mockImplementation(async () => {
    runsInTheDatabase = [theRun(!stored.isEnabled)];

    return { data: { status: "Scheduled" } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Builder shows whether the workflow is on", () => {
  test("it reads the switch with the graph, in the one request it already makes", async () => {
    await renderBuilder();

    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(
      (mockGetItem.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select["isEnabled"],
    ).toBe(true);
  });

  test("off: the Enabled switch is off, and a notice says the trigger is paused but Run Workflow still tests it", async () => {
    await renderBuilder();

    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).toHaveTextContent("This workflow is off");
    expect(notice).toHaveTextContent(
      "Its trigger is paused until you turn it on. You can still test it with Run Workflow.",
    );
    expect(notice).not.toHaveTextContent("can't be run or tested");
    expect(
      within(notice).getByTestId("workflow-turn-on-button"),
    ).toHaveTextContent("Turn on workflow");
  });

  test("on: the switch is on, and there is no notice", async () => {
    stored.isEnabled = true;

    await renderBuilder();

    expect(enabledSwitch()).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("workflow-turned-off-notice")).toBeNull();
  });

  test("not known: no switch is drawn rather than a wrong one", async () => {
    stored.isEnabled = undefined;

    await renderBuilder();

    expect(screen.queryByRole("switch", { name: "Enabled" })).toBeNull();
    expect(screen.queryByTestId("workflow-turned-off-notice")).toBeNull();
  });

  test("on a phone the toolbar's buttons wrap as a whole, never their labels", async () => {
    await renderBuilder();

    for (const name of ["Add Component", "Run Workflow"]) {
      expect(
        screen.getByRole("button", { name: name, exact: true }).className,
      ).toContain("whitespace-nowrap");
    }
  });

  test("the notice sits above the canvas, below the toolbar's switch", async () => {
    await renderBuilder();

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );
    const canvasElement: HTMLElement = screen.getByTestId("workflow-canvas");

    expect(
      enabledSwitch().compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      notice.compareDocumentPosition(canvasElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("Run just this step on a workflow that is off: a test run", () => {
  test("is sent at once, with no dialog, and the workflow stays off", async () => {
    await renderBuilder();
    await runTheStep();

    await waitFor(() => {
      expect(postsTo("/run-step/")).toHaveLength(1);
    });

    expectNoTurnOnDialog();
    expect(errorDialog()).toBeNull();
    expect(mockUpdateById).not.toHaveBeenCalled();
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByTestId("workflow-turned-off-notice"),
    ).toBeInTheDocument();
  });

  test("sends that step, of this workflow", async () => {
    await renderBuilder();
    await runTheStep();

    await waitFor(() => {
      expect(postsTo("/run-step/")).toHaveLength(1);
    });

    const runStep: { url: unknown; data: JSONObject } = postsTo(
      "/run-step/",
    )[0]![0] as { url: unknown; data: JSONObject };

    expect(String(runStep.url)).toContain(
      `/run-step/${WORKFLOW_ID.toString()}`,
    );
    expect(runStep.data).toEqual({ componentId: "if-else-1" });
  });

  test("opens the run, which says it is a test run and who started it", async () => {
    await renderBuilder();
    await runTheStep();

    const modal: HTMLElement = await runModal();

    await waitFor(() => {
      expect(
        within(modal).getByTestId("workflow-run-test-run-note"),
      ).toHaveTextContent(
        "Started by Ada Lovelace while this workflow was off.",
      );
    });
  });
});

describe("Run Workflow on a workflow that is off: a test run", () => {
  test("the canvas is told, so the run panel says it will be a test run", async () => {
    await renderBuilder();

    expect(canvas().runsAreTestRuns).toBe(true);
  });

  test("is sent at once with the values from the run panel, with no dialog, and nothing is turned on", async () => {
    await renderBuilder();
    await runTheWorkflow();

    await waitFor(() => {
      expect(postsTo("/manual/run/")).toHaveLength(1);
    });

    expect(
      (postsTo("/manual/run/")[0]![0] as { data: JSONObject }).data,
    ).toEqual({ data: { "request-body": '{"service": "checkout"}' } });
    expectNoTurnOnDialog();
    expect(savedSwitchValues()).toEqual([]);
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("opens the run, which says it is a test run and who started it", async () => {
    await renderBuilder();
    await runTheWorkflow();

    const modal: HTMLElement = await runModal();

    await waitFor(() => {
      expect(
        within(modal).getByTestId("workflow-run-test-run-note"),
      ).toHaveTextContent("Test run");
    });
    expect(
      within(modal).getByTestId("workflow-run-test-run-started-by"),
    ).toHaveTextContent("Started by Ada Lovelace while this workflow was off.");
  });

  test("follows the run with whether it is a test run, and who started it", async () => {
    await renderBuilder();
    await runTheWorkflow();
    await runModal();

    const calls: Array<Array<unknown>> = mockGetList.mock.calls;
    const select: Record<string, unknown> = (
      calls[calls.length - 1]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select).toMatchObject({
      isTestRun: true,
      startedByUser: { name: true, email: true },
    });
  });
});

describe("a workflow that is on", () => {
  beforeEach(() => {
    stored.isEnabled = true;
  });

  test("the run panel is not told its runs are test runs", async () => {
    await renderBuilder();

    expect(canvas().runsAreTestRuns).toBe(false);
  });

  test("a run goes straight through, and is no test run", async () => {
    await renderBuilder();
    await runTheWorkflow();

    const modal: HTMLElement = await runModal();

    expect(postsTo("/manual/run/")).toHaveLength(1);
    expect(
      within(modal).queryByTestId("workflow-run-test-run-note"),
    ).toBeNull();
  });
});

describe("a run the server refuses", () => {
  test("is shown as the server words it, and the switch is not read again", async () => {
    mockPost.mockImplementation(async () => {
      return new HTTPErrorResponse(
        422,
        { error: "You do not have permission to run this workflow." },
        {},
      );
    });

    await renderBuilder();
    await runTheStep();

    await waitFor(() => {
      expect(errorDialog()).not.toBeNull();
    });

    expect(errorDialog()).toHaveTextContent(
      "You do not have permission to run this workflow.",
    );
    expectNoTurnOnDialog();
    // The workflow was read once, to draw the page; a refusal reads nothing more.
    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  test("a Run Workflow the server refuses is shown the same way", async () => {
    mockPost.mockImplementation(async () => {
      return new HTTPErrorResponse(
        400,
        { error: "Workflow cannot run because subscription is unpaid." },
        {},
      );
    });

    await renderBuilder();
    await runTheWorkflow();

    await waitFor(() => {
      expect(errorDialog()).toHaveTextContent(
        "Workflow cannot run because subscription is unpaid.",
      );
    });
    expect(screen.queryByText("This is the run you just started.")).toBeNull();
  });
});

describe("the switch and the notice", () => {
  test("the notice's Turn on workflow turns it on, and the notice goes", async () => {
    await renderBuilder();

    await act(async () => {
      fireEvent.click(screen.getByTestId("workflow-turn-on-button"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("workflow-turned-off-notice")).toBeNull();
    });

    expect(savedSwitchValues()).toEqual([{ isEnabled: true }]);
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "true");
    // Turning it on runs nothing by itself, and its runs are no tests now.
    expect(mockPost).not.toHaveBeenCalled();
    expect(canvas().runsAreTestRuns).toBe(false);
  });

  test("turning the switch off saves it, and the notice appears", async () => {
    stored.isEnabled = true;

    await renderBuilder();

    await act(async () => {
      fireEvent.click(enabledSwitch());
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("workflow-turned-off-notice"),
      ).toBeInTheDocument();
    });

    expect(savedSwitchValues()).toEqual([{ isEnabled: false }]);
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");
    expect(canvas().runsAreTestRuns).toBe(true);
  });

  test("a switch the server refuses moves back, and says why", async () => {
    mockUpdateById.mockRejectedValue(new Error("Workflow not found"));

    await renderBuilder();

    await act(async () => {
      fireEvent.click(enabledSwitch());
    });

    await waitFor(() => {
      expect(errorDialog()).not.toBeNull();
    });

    expect(errorDialog()).toHaveTextContent("Workflow not found");
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByTestId("workflow-turned-off-notice"),
    ).toBeInTheDocument();
  });

  test("after turning it on from the switch, a run goes straight through as a real one", async () => {
    await renderBuilder();

    await act(async () => {
      fireEvent.click(enabledSwitch());
    });

    await runTheStep();

    await waitFor(() => {
      expect(postsTo("/run-step/")).toHaveLength(1);
    });

    const modal: HTMLElement = await runModal();

    expect(
      within(modal).queryByTestId("workflow-run-test-run-note"),
    ).toBeNull();
  });
});

describe("a Workflow Member, who runs workflows but may not change them", () => {
  beforeEach(() => {
    mockPermissions = [Permission.WorkflowMember, Permission.ReadWorkflow];
  });

  test("is told they can still test it, and who can turn it on", async () => {
    await renderBuilder();

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).toHaveTextContent(
      "You can still test it with Run Workflow.",
    );
    expect(notice).toHaveTextContent(
      "Only people who can edit this workflow can turn it on.",
    );
    expect(within(notice).queryByTestId("workflow-turn-on-button")).toBeNull();
  });

  test("runs it as a test run, and changes nothing", async () => {
    await renderBuilder();
    await runTheWorkflow();

    await waitFor(() => {
      expect(postsTo("/manual/run/")).toHaveLength(1);
    });

    expectNoTurnOnDialog();
    expect(mockUpdateById).not.toHaveBeenCalled();
  });
});

describe("someone who may neither change nor run the workflow", () => {
  beforeEach(() => {
    mockPermissions = [Permission.ProjectMember, Permission.ReadWorkflow];
  });

  test("sees the switch, disabled, with the permission they would need", async () => {
    await renderBuilder();

    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");
    expect(enabledSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(enabledSwitch()).toHaveAccessibleDescription(
      /You do not have permission to edit this Workflow/,
    );

    await act(async () => {
      fireEvent.click(enabledSwitch());
    });

    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  test("is told who can turn it on, with no button to press, and is not offered Run Workflow", async () => {
    await renderBuilder();

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).toHaveTextContent(
      "Only people who can edit this workflow can turn it on.",
    );
    expect(notice).toHaveTextContent(
      "Its trigger is paused until you turn it on.",
    );
    expect(notice).not.toHaveTextContent("You can still test it");
    expect(within(notice).queryByTestId("workflow-turn-on-button")).toBeNull();
    expect(screen.getByTestId("run-workflow-button")).toBeDisabled();
  });
});
