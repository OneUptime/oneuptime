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
 * "When workflow is not enabled, it doesnt tell me how to enable this
 * workflow. Can you please add that?" - the maintainer, looking at an Error
 * dialog that said "This workflow is not enabled" over an If / Else step's
 * settings, after Run just this step. Its only button was Close.
 *
 * The real Builder page is rendered; the canvas is a stand-in that hands the
 * test its callbacks (Run just this step and Run Workflow end there), and the
 * API answers from here. The page now:
 *   - shows the Enabled switch at the top, and a notice while it is off;
 *   - holds a run started while the workflow is off and asks to turn it on,
 *     then sends that same run;
 *   - reads the switch again when a run is refused, instead of showing the
 *     refusal, so a workflow turned off elsewhere is handled the same way.
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
  graph: JSONObject;
}

let stored: StoredWorkflow = { isEnabled: false, graph: WEBHOOK_GRAPH };

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
  stored = { isEnabled: false, graph: WEBHOOK_GRAPH };
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
    return { data: [], count: 0, skip: 0, limit: 1 };
  });

  // The server: a workflow that is off does not run.
  mockPost.mockImplementation(async () => {
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

describe("the Builder shows whether the workflow is on", () => {
  test("it reads the switch with the graph, in the one request it already makes", async () => {
    await renderBuilder();

    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(
      (mockGetItem.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select["isEnabled"],
    ).toBe(true);
  });

  test("off: the Enabled switch is off, and a notice says what that means", async () => {
    await renderBuilder();

    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).toHaveTextContent("This workflow is off");
    expect(notice).toHaveTextContent(
      "Its trigger is ignored and it can't be run or tested until you turn it on.",
    );
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

describe("Run just this step on a workflow that is off", () => {
  test("nothing is sent, no Error dialog: the Builder asks to turn the workflow on", async () => {
    await renderBuilder();
    await runTheStep();

    const dialog: HTMLElement = await prompt();

    expect(postsTo("/run-step/")).toHaveLength(0);
    expect(mockUpdateById).not.toHaveBeenCalled();
    expect(errorDialog()).toBeNull();
    expect(screen.queryByText("This workflow is not enabled")).toBeNull();

    expect(dialog).toHaveTextContent("Turn on this workflow?");
    expect(dialog).toHaveTextContent(
      'This workflow is off, so "If / Else" can\'t run. Turn the workflow on to run this step now.',
    );
    // What else turning it on does, and where the switch is.
    expect(dialog).toHaveTextContent(
      "Once it's on, its Webhook trigger starts it too.",
    );
    expect(dialog).toHaveTextContent(
      "You can turn it off again with the Enabled switch above the canvas.",
    );
  });

  test("Turn on and run step turns the workflow on, then runs that step", async () => {
    await renderBuilder();
    await runTheStep();

    const dialog: HTMLElement = await prompt();

    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Turn on and run step");

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(postsTo("/run-step/")).toHaveLength(1);
    });

    expect(savedSwitchValues()).toEqual([{ isEnabled: true }]);
    expect(
      (mockUpdateById.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(WORKFLOW_ID.toString());

    const runStep: { url: unknown; data: JSONObject } = postsTo(
      "/run-step/",
    )[0]![0] as { url: unknown; data: JSONObject };

    expect(String(runStep.url)).toContain(
      `/run-step/${WORKFLOW_ID.toString()}`,
    );
    expect(runStep.data).toEqual({ componentId: "if-else-1" });

    // The run the user asked for opens, and the page now says it is on.
    expect(
      await screen.findByText("This is the run you just started."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-turn-on-prompt")).toBeNull();
    expect(screen.queryByTestId("workflow-turned-off-notice")).toBeNull();
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "true");
    expect(errorDialog()).toBeNull();
  });

  test("Cancel turns nothing on and runs nothing", async () => {
    await renderBuilder();
    await runTheStep();

    const dialog: HTMLElement = await prompt();

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));
    });

    expect(screen.queryByTestId("workflow-turn-on-prompt")).toBeNull();
    expect(mockUpdateById).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("workflow-turned-off-notice"),
    ).toBeInTheDocument();
  });

  test("a refused turn-on says why inside the dialog, and runs nothing", async () => {
    mockUpdateById.mockRejectedValue(
      new Error("You do not have permission to update this Workflow."),
    );

    await renderBuilder();
    await runTheStep();

    const dialog: HTMLElement = await prompt();

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(dialog).toHaveTextContent(
        "You do not have permission to update this Workflow.",
      );
    });

    expect(mockPost).not.toHaveBeenCalled();
    expect(errorDialog()).toBeNull();
    expect(
      screen.getByTestId("workflow-turned-off-notice"),
    ).toBeInTheDocument();
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("the dialog is drawn after the canvas, so it opens over the step's settings", async () => {
    await renderBuilder();
    await runTheStep();

    const dialog: HTMLElement = await prompt();

    expect(
      screen.getByTestId("workflow-canvas").compareDocumentPosition(dialog) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a Manual trigger is not named: only Run Workflow starts it", async () => {
    stored.graph = MANUAL_GRAPH;

    await renderBuilder();
    await runTheStep();

    const dialog: HTMLElement = await prompt();

    expect(dialog).not.toHaveTextContent("trigger starts it too");
    expect(dialog).toHaveTextContent(
      "You can turn it off again with the Enabled switch above the canvas.",
    );
  });
});

describe("Run Workflow on a workflow that is off", () => {
  test("Turn on and run turns it on, then runs it with the values from the run panel", async () => {
    await renderBuilder();
    await runTheWorkflow();

    const dialog: HTMLElement = await prompt();

    expect(postsTo("/manual/run/")).toHaveLength(0);
    expect(dialog).toHaveTextContent(
      "This workflow is off, so it can't run. Turn it on to run it now.",
    );
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Turn on and run");

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(postsTo("/manual/run/")).toHaveLength(1);
    });

    expect(savedSwitchValues()).toEqual([{ isEnabled: true }]);
    expect(
      (postsTo("/manual/run/")[0]![0] as { data: JSONObject }).data,
    ).toEqual({ data: { "request-body": '{"service": "checkout"}' } });
    expect(
      await screen.findByText("This is the run you just started."),
    ).toBeInTheDocument();
  });
});

describe("a run the server refuses", () => {
  test("because the workflow was turned off elsewhere: the same dialog, not an Error", async () => {
    stored.isEnabled = true;

    await renderBuilder();

    // Someone turns it off in another tab after this page loaded.
    stored.isEnabled = false;

    await runTheStep();

    const dialog: HTMLElement = await prompt();

    expect(postsTo("/run-step/")).toHaveLength(1);
    expect(errorDialog()).toBeNull();
    expect(dialog).toHaveTextContent('so "If / Else" can\'t run');
    // The page catches up with the switch.
    expect(
      screen.getByTestId("workflow-turned-off-notice"),
    ).toBeInTheDocument();
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(postsTo("/run-step/")).toHaveLength(2);
    });

    expect(savedSwitchValues()).toEqual([{ isEnabled: true }]);
  });

  test("for any other reason: the reason is shown as before", async () => {
    stored.isEnabled = true;
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
    expect(screen.queryByTestId("workflow-turn-on-prompt")).toBeNull();
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
    // Turning it on runs nothing by itself.
    expect(mockPost).not.toHaveBeenCalled();
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

  test("a run after turning it on from the switch goes straight through", async () => {
    await renderBuilder();

    await act(async () => {
      fireEvent.click(enabledSwitch());
    });

    await runTheStep();

    await waitFor(() => {
      expect(postsTo("/run-step/")).toHaveLength(1);
    });

    expect(screen.queryByTestId("workflow-turn-on-prompt")).toBeNull();
  });
});

describe("someone who may not edit the workflow", () => {
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

  test("is told who can turn it on, with no button to press", async () => {
    await renderBuilder();

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).toHaveTextContent(
      "Only people who can edit this workflow can turn it on.",
    );
    expect(within(notice).queryByTestId("workflow-turn-on-button")).toBeNull();
  });

  test("running a step gets a notice that closes, and nothing is saved or sent", async () => {
    await renderBuilder();
    await runTheStep();

    const dialog: HTMLElement = await prompt();

    expect(dialog).toHaveTextContent(
      "This workflow is off, so it can't run. Only people who can edit this workflow can turn it on.",
    );
    expect(within(dialog).queryByText("Turn on and run step")).toBeNull();

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    expect(screen.queryByTestId("workflow-turn-on-prompt")).toBeNull();
    expect(mockUpdateById).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });
});
