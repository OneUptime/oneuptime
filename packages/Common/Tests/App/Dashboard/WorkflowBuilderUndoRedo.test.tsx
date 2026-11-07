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
import { ComponentProps as SettingsProps } from "../../../UI/Components/Workflow/ComponentSettingsModal";
import { Node as FlowNode, NodeChange, ReactFlowProps } from "reactflow";

/*
 * UNDO, REDO AND THE VERSION HISTORY, in the real Builder with the real canvas
 * (issue #6188: "if I make a mistake in workflow builder, it autosaves").
 *
 * What a person does - delete a step, drag a card, restore a version, take
 * back what Ask AI did - goes through the canvas's own state; Undo and Redo
 * hand the canvas the graph to show; and every one of them is saved, the
 * graph the canvas shows and nothing else.
 *
 * Only what jsdom cannot draw is replaced: react-flow's renderer (each step a
 * button that says where it sits, with buttons to drag it) and a step's
 * settings dialog (its Delete and a Save that changes a setting). The API is a
 * stand-in that serves the workflow and its versions and records each save.
 */

let mockCanvasDraws: number = 0;
const MOCK_MOST_CANVAS_DRAWS: number = 1000;

jest.mock("reactflow", () => {
  const actual: typeof import("reactflow") = jest.requireActual(
    "reactflow",
  ) as typeof import("reactflow");

  return {
    ...actual,
    __esModule: true,
    default: (props: ReactFlowProps): React.ReactElement => {
      mockCanvasDraws++;

      if (mockCanvasDraws > MOCK_MOST_CANVAS_DRAWS) {
        throw new Error(
          "The canvas kept being drawn: the page and the canvas are chasing each other.",
        );
      }

      const move: (
        node: FlowNode,
        dragging: boolean,
        dx: number,
      ) => void = (node: FlowNode, dragging: boolean, dx: number): void => {
        props.onNodesChange?.([
          {
            id: node.id,
            type: "position",
            position: { x: node.position.x + dx, y: node.position.y },
            dragging,
          } as NodeChange,
        ]);
      };

      return (
        <div data-testid="workflow-canvas">
          {(props.nodes || []).map((node: FlowNode): React.ReactElement => {
            const data: { id?: string; nodeType?: string } = node.data;
            const name: string = data.id || "placeholder";

            return (
              <div key={node.id}>
                <div
                  role="button"
                  tabIndex={0}
                  className="react-flow__node"
                  data-id={node.id}
                  data-x={String(node.position.x)}
                  data-testid={`workflow-node-${name}`}
                  onClick={(event: React.MouseEvent<HTMLDivElement>) => {
                    props.onNodeClick?.(event, node);
                  }}
                >
                  {name}
                </div>
                <button
                  type="button"
                  data-testid={`drag-${name}`}
                  onClick={() => {
                    move(node, true, 16);
                  }}
                >
                  drag
                </button>
                <button
                  type="button"
                  data-testid={`drop-${name}`}
                  onClick={() => {
                    move(node, false, 0);
                  }}
                >
                  drop
                </button>
              </div>
            );
          })}
        </div>
      );
    },
    Background: (): null => {
      return null;
    },
    Controls: (): null => {
      return null;
    },
    MiniMap: (): null => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/Workflow/Component", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/Workflow/ComponentSettingsModal", () => {
  return {
    __esModule: true,
    default: (props: SettingsProps): React.ReactElement => {
      return (
        <div data-testid="step-settings" role="dialog" aria-modal="true">
          <span>{props.component.id}</span>
          <input aria-label="A setting" data-testid="step-setting-input" />
          <button
            type="button"
            onClick={() => {
              props.onSave({
                ...props.component,
                arguments: {
                  ...(props.component.arguments || {}),
                  value: "a new value",
                },
              });
            }}
          >
            Save settings
          </button>
          <button
            type="button"
            onClick={() => {
              props.onDelete(props.component);
              props.onClose();
            }}
          >
            Delete step
          </button>
        </div>
      );
    },
  };
});

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
      post: async (): Promise<unknown> => {
        return { data: {} };
      },
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string } | null)?.message || "Server Error";
      },
    },
  };
});

import Builder from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import WorkflowModel from "../../../Models/DatabaseModels/Workflow";
import WorkflowVersion from "../../../Models/DatabaseModels/WorkflowVersion";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ComponentType, NodeType } from "../../../Types/Workflow/Component";
import { WorkflowVersionType } from "../../../Types/Workflow/WorkflowVersion";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Navigation from "../../../UI/Utils/Navigation";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194166188",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

// A step as a saved graph stores it.
const graphNode: (data: {
  id: string;
  metadataId: string;
  componentType: ComponentType;
  y: number;
}) => JSONObject = (data: {
  id: string;
  metadataId: string;
  componentType: ComponentType;
  y: number;
}): JSONObject => {
  return {
    id: `canvas-${data.id}`,
    type: "node",
    position: { x: 160, y: data.y },
    data: {
      id: data.id,
      internalId: `runner-${data.id}`,
      nodeType: NodeType.Node,
      componentType: data.componentType,
      metadataId: data.metadataId,
      arguments: {},
      returnValues: {},
    },
  };
};

const MANUAL_TRIGGER: JSONObject = graphNode({
  id: "manual-1",
  metadataId: "manual",
  componentType: ComponentType.Trigger,
  y: 96,
});

const LOG_STEP: JSONObject = graphNode({
  id: "log-1",
  metadataId: "log",
  componentType: ComponentType.Component,
  y: 336,
});

const EMAIL_STEP: JSONObject = graphNode({
  id: "send-email-1",
  metadataId: "send-email",
  componentType: ComponentType.Component,
  y: 576,
});

const STORED: JSONObject = {
  nodes: [MANUAL_TRIGGER, LOG_STEP],
  edges: [
    {
      id: "edge-manual-log",
      source: "canvas-manual-1",
      sourceHandle: "out",
      target: "canvas-log-1",
      targetHandle: "in",
    },
  ],
};

let storedGraph: JSONObject = STORED;

// Every graph the Builder saved, in order.
const savedGraphs: () => Array<JSONObject> = (): Array<JSONObject> => {
  return mockUpdateById.mock.calls
    .map((call: Array<unknown>): JSONObject | undefined => {
      return (call[0] as { data: JSONObject }).data["graph"] as
        | JSONObject
        | undefined;
    })
    .filter((graph: JSONObject | undefined): boolean => {
      return Boolean(graph);
    }) as Array<JSONObject>;
};

const stepIdsOf: (graph: JSONObject | undefined) => Array<string> = (
  graph: JSONObject | undefined,
): Array<string> => {
  return ((graph?.["nodes"] as Array<JSONObject>) || []).map(
    (node: JSONObject): string => {
      return ((node["data"] as JSONObject)["id"] as string) || "placeholder";
    },
  );
};

const lastSaved: () => JSONObject | undefined = ():
  | JSONObject
  | undefined => {
  const graphs: Array<JSONObject> = savedGraphs();
  return graphs[graphs.length - 1];
};

const waitForSaveWith: (stepIds: Array<string>) => Promise<void> = async (
  stepIds: Array<string>,
): Promise<void> => {
  await waitFor(
    () => {
      expect(stepIdsOf(lastSaved())).toEqual(stepIds);
    },
    { timeout: 4000 },
  );
};

const renderBuilder: () => Promise<void> = async (): Promise<void> => {
  render(<Builder {...PAGE_PROPS} />);

  await waitFor(() => {
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });
};

const undoButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("workflow-undo-button");
};

const redoButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("workflow-redo-button");
};

const deleteStep: (stepId: string) => Promise<void> = async (
  stepId: string,
): Promise<void> => {
  fireEvent.click(screen.getByTestId(`workflow-node-${stepId}`));
  fireEvent.click(screen.getByRole("button", { name: "Delete step" }));

  await waitFor(() => {
    expect(screen.queryByTestId(`workflow-node-${stepId}`)).toBeNull();
  });
};

const pressKeys: (init: KeyboardEventInit, target?: Element) => void = (
  init: KeyboardEventInit,
  target: Element = document.body,
): void => {
  fireEvent.keyDown(target, init);
};

const wait: (milliseconds: number) => Promise<void> = async (
  milliseconds: number,
): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, milliseconds);
    });
  });
};

beforeEach(() => {
  mockCanvasDraws = 0;
  mockPermissions = ["ProjectAdmin"];
  storedGraph = STORED;
  mockGetItem.mockReset();
  mockGetList.mockReset();
  mockUpdateById.mockReset();

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);

  mockGetItem.mockImplementation(
    async (request: { modelType: unknown; id: ObjectID }) => {
      if (request.modelType === WorkflowVersion) {
        const version: WorkflowVersion = new WorkflowVersion();
        version.graph = {
          nodes: [MANUAL_TRIGGER, LOG_STEP, EMAIL_STEP],
          edges: STORED["edges"],
        } as JSONObject;
        return version;
      }

      const workflow: WorkflowModel = new WorkflowModel();
      workflow.graph = JSON.parse(JSON.stringify(storedGraph)) as JSONObject;
      workflow.name = "Notify on-call";
      workflow.isEnabled = false;
      return workflow;
    },
  );

  mockGetList.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 20 };
  });

  mockUpdateById.mockImplementation(async () => {
    return {};
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  expect(mockCanvasDraws).toBeLessThan(400);
});

describe("Undo and Redo, on the toolbar", () => {
  test("start locked, saying there is nothing to do; opening the workflow saves nothing", async () => {
    await renderBuilder();

    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    expect(undoButton()).toHaveAttribute("aria-label", "Nothing to undo");
    expect(redoButton()).toHaveAttribute("aria-label", "Nothing to redo");
    expect(
      screen.getByTestId("workflow-version-history-button"),
    ).toHaveTextContent("Version history");

    // Opening a workflow used to save it a second later, every time.
    await wait(1500);
    expect(savedGraphs()).toHaveLength(0);
    expect(screen.getByTestId("workflow-save-status")).toHaveTextContent(
      "Ready",
    );
  });

  test("a deleted step: Undo names it and puts it back, and the workflow is saved with it", async () => {
    await renderBuilder();
    await deleteStep("log-1");

    await waitFor(() => {
      expect(undoButton()).not.toBeDisabled();
    });
    expect(undoButton()).toHaveAttribute(
      "aria-label",
      'Undo deleting "Log" (log-1)',
    );
    await waitForSaveWith(["manual-1"]);

    fireEvent.click(undoButton());

    await waitFor(() => {
      expect(screen.getByTestId("workflow-node-log-1")).toBeInTheDocument();
    });
    await waitForSaveWith(["manual-1", "log-1"]);

    // Its connection came back with it.
    expect(lastSaved()?.["edges"]).toEqual([
      {
        id: "edge-manual-log",
        source: "canvas-manual-1",
        sourceHandle: "out",
        target: "canvas-log-1",
        targetHandle: "in",
      },
    ]);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toHaveAttribute(
      "aria-label",
      'Redo deleting "Log" (log-1)',
    );

    fireEvent.click(redoButton());

    await waitFor(() => {
      expect(screen.queryByTestId("workflow-node-log-1")).toBeNull();
    });
    await waitForSaveWith(["manual-1"]);
  });

  test("a step's settings changed: Undo puts them back", async () => {
    await renderBuilder();

    fireEvent.click(screen.getByTestId("workflow-node-log-1"));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(undoButton()).toHaveAttribute(
        "aria-label",
        'Undo changes to "Log" (log-1)',
      );
    });

    const logArguments: () => JSONObject | undefined = ():
      | JSONObject
      | undefined => {
      const log: JSONObject | undefined = (
        (lastSaved()?.["nodes"] as Array<JSONObject>) || []
      ).find((node: JSONObject): boolean => {
        return node["id"] === "canvas-log-1";
      });

      return (log?.["data"] as JSONObject | undefined)?.["arguments"] as
        | JSONObject
        | undefined;
    };

    await waitFor(
      () => {
        expect(logArguments()).toEqual({ value: "a new value" });
      },
      { timeout: 4000 },
    );

    fireEvent.click(undoButton());

    await waitFor(
      () => {
        expect(logArguments()).toEqual({});
      },
      { timeout: 4000 },
    );
  });

  test("an edit taken back before it was saved sends nothing: the server has the workflow as it is", async () => {
    await renderBuilder();
    await deleteStep("log-1");

    fireEvent.click(undoButton());

    await waitFor(() => {
      expect(screen.getByTestId("workflow-node-log-1")).toBeInTheDocument();
    });
    await wait(1500);

    expect(savedGraphs()).toHaveLength(0);
  });

  test("a drag is one step, taken in where the card is dropped", async () => {
    await renderBuilder();

    fireEvent.click(screen.getByTestId("drag-log-1"));
    fireEvent.click(screen.getByTestId("drag-log-1"));

    // Still being dragged: nothing to undo yet, and nothing saved.
    await wait(1200);
    expect(undoButton()).toBeDisabled();
    expect(savedGraphs()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("drop-log-1"));

    await waitFor(() => {
      expect(undoButton()).toHaveAttribute(
        "aria-label",
        'Undo moving "Log" (log-1)',
      );
    });
    expect(screen.getByTestId("workflow-node-log-1")).toHaveAttribute(
      "data-x",
      "192",
    );

    fireEvent.click(undoButton());

    await waitFor(() => {
      expect(screen.getByTestId("workflow-node-log-1")).toHaveAttribute(
        "data-x",
        "160",
      );
    });
    expect(undoButton()).toBeDisabled();
  });

  test("selecting a step is no edit: nothing to undo, nothing saved", async () => {
    await renderBuilder();

    fireEvent.click(screen.getByTestId("workflow-node-log-1"));
    await wait(1200);

    expect(undoButton()).toBeDisabled();
    expect(savedGraphs()).toHaveLength(0);
  });
});

describe("the shortcuts", () => {
  test("⌘Z and Ctrl+Y undo and redo from anywhere on the page", async () => {
    await renderBuilder();
    await deleteStep("log-1");

    await waitFor(() => {
      expect(undoButton()).not.toBeDisabled();
    });

    pressKeys({ key: "z", metaKey: true });

    await waitFor(() => {
      expect(screen.getByTestId("workflow-node-log-1")).toBeInTheDocument();
    });

    pressKeys({ key: "y", ctrlKey: true });

    await waitFor(() => {
      expect(screen.queryByTestId("workflow-node-log-1")).toBeNull();
    });

    pressKeys({ key: "z", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByTestId("workflow-node-log-1")).toBeInTheDocument();
    });

    pressKeys({ key: "Z", metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.queryByTestId("workflow-node-log-1")).toBeNull();
    });
  });

  test("never take a key from someone typing, or from a dialog", async () => {
    await renderBuilder();
    await deleteStep("log-1");

    await waitFor(() => {
      expect(undoButton()).not.toBeDisabled();
    });

    // Typing in a field elsewhere on the page.
    const field: HTMLInputElement = document.createElement("input");
    document.body.appendChild(field);
    pressKeys({ key: "z", metaKey: true }, field);

    // A step's settings open: their fields undo their own typing.
    fireEvent.click(screen.getByTestId("workflow-node-manual-1"));
    pressKeys({ key: "z", metaKey: true }, screen.getByTestId("step-setting-input"));
    pressKeys({ key: "z", metaKey: true });

    await wait(300);
    expect(screen.queryByTestId("workflow-node-log-1")).toBeNull();

    field.remove();
  });
});

describe("a save that fails", () => {
  test("says so once, keeps the change on the canvas, and Try again saves it", async () => {
    mockUpdateById.mockImplementation(async () => {
      throw new Error("The server is not reachable.");
    });

    await renderBuilder();
    await deleteStep("log-1");

    await waitFor(
      () => {
        expect(screen.getByTestId("workflow-save-status")).toHaveTextContent(
          "Could not save",
        );
      },
      { timeout: 4000 },
    );

    // A dialog says why, and the pill keeps saying it under the pointer.
    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Error",
    });

    expect(dialog).toHaveTextContent("The server is not reachable.");
    expect(screen.getByTestId("workflow-save-status")).toHaveAttribute(
      "title",
      "The server is not reachable.",
    );
    // What was not saved stays on the canvas.
    expect(screen.queryByTestId("workflow-node-log-1")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Error" })).toBeNull();
    });

    // Failing again, it says so in the pill only: no dialog after every edit.
    fireEvent.click(screen.getByTestId("drag-manual-1"));
    fireEvent.click(screen.getByTestId("drop-manual-1"));
    await wait(1500);

    expect(screen.getByTestId("workflow-save-status")).toHaveTextContent(
      "Could not save",
    );
    expect(screen.queryByRole("dialog", { name: "Error" })).toBeNull();

    mockUpdateById.mockImplementation(async () => {
      return {};
    });

    fireEvent.click(screen.getByTestId("workflow-save-retry-button"));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-save-status")).toHaveTextContent(
        "Saved",
      );
    });
    expect(stepIdsOf(lastSaved())).toEqual(["manual-1"]);
  });
});

describe("the Version history", () => {
  const VERSIONS: Array<WorkflowVersion> = [3, 2].map(
    (versionNumber: number): WorkflowVersion => {
      const version: WorkflowVersion = new WorkflowVersion();
      version._id = `0198c8ec-2a1d-7f0c-9e75-00000000000${versionNumber}`;
      version.id = new ObjectID(version._id);
      version.versionNumber = versionNumber;
      version.versionType = WorkflowVersionType.Changed;
      version.changes =
        versionNumber === 3
          ? ['Removed "Send Email" (send-email-1)']
          : ['Added "Send Email" (send-email-1)'];
      version.changeCount = 1;
      version.createdAt = new Date();
      version.updatedAt = new Date();
      return version;
    },
  );

  test("restoring a version puts it on the canvas as a step Undo takes back, and saves it at once", async () => {
    mockGetList.mockImplementation(async () => {
      return { data: VERSIONS, count: 2, skip: 0, limit: 20 };
    });

    await renderBuilder();

    fireEvent.click(screen.getByTestId("workflow-version-history-button"));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-version-2")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("workflow-version-preview-2"));

    await waitFor(() => {
      expect(
        screen.getByTestId("workflow-version-preview-changes"),
      ).toHaveTextContent('Added "Send Email" (send-email-1)');
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));

    await waitFor(() => {
      expect(
        within(screen.getAllByTestId("workflow-canvas")[0] as HTMLElement).getByTestId(
          "workflow-node-send-email-1",
        ),
      ).toBeInTheDocument();
    });

    // Saved at once, not a moment later.
    await waitFor(
      () => {
        expect(stepIdsOf(lastSaved())).toEqual([
          "manual-1",
          "log-1",
          "send-email-1",
        ]);
      },
      { timeout: 900 },
    );

    expect(undoButton()).toHaveAttribute(
      "aria-label",
      "Undo restoring version 2",
    );

    fireEvent.click(undoButton());

    await waitFor(() => {
      expect(screen.queryByTestId("workflow-node-send-email-1")).toBeNull();
    });
    await waitForSaveWith(["manual-1", "log-1"]);
  });
});

describe("what Ask AI saved", () => {
  test("is drawn where the canvas is, without saving it again, and Undo takes it back", async () => {
    await renderBuilder();

    storedGraph = {
      nodes: [MANUAL_TRIGGER, LOG_STEP, EMAIL_STEP],
      edges: STORED["edges"],
    };

    act(() => {
      GlobalEvents.dispatchEvent(EventName.WORKFLOW_CHANGED_BY_AI, {
        workflowId: WORKFLOW_ID.toString(),
      });
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("workflow-node-send-email-1"),
      ).toBeInTheDocument();
    });

    await wait(1300);
    expect(savedGraphs()).toHaveLength(0);
    expect(undoButton()).toHaveAttribute("aria-label", "Undo Ask AI's change");

    fireEvent.click(undoButton());

    await waitFor(() => {
      expect(screen.queryByTestId("workflow-node-send-email-1")).toBeNull();
    });
    await waitForSaveWith(["manual-1", "log-1"]);
  });
});

describe("for someone who may only look at the workflow", () => {
  test("no Undo or Redo, the Version history still opens, and no shortcut saves anything", async () => {
    mockPermissions = ["WorkflowViewer"];
    mockGetList.mockImplementation(async () => {
      return { data: [], count: 0, skip: 0, limit: 20 };
    });

    await renderBuilder();

    expect(screen.queryByTestId("workflow-undo-button")).toBeNull();
    expect(screen.queryByTestId("workflow-redo-button")).toBeNull();

    pressKeys({ key: "z", metaKey: true });
    await wait(1200);
    expect(savedGraphs()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("workflow-version-history-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("workflow-version-history-empty"),
      ).toBeInTheDocument();
    });
  });
});
