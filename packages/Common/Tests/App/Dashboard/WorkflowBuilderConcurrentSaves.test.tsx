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
  RenderResult,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as SettingsProps } from "../../../UI/Components/Workflow/ComponentSettingsModal";
import { Node as FlowNode, NodeChange, ReactFlowProps } from "reactflow";

/*
 * TWO BUILDERS OPEN ON ONE WORKFLOW (issue #6257: "a save no longer silently
 * overwrites a teammate's changes"), in the real Builder with the real
 * canvas, against a stand-in server that refuses exactly what WorkflowService
 * refuses: a save made to an older revision of the graph than the workflow
 * is at (409 Conflict). The workflow is read back with its revision, and
 * every save that lands moves it on by one.
 *
 * Only what jsdom cannot draw is replaced, as in WorkflowBuilderUndoRedo:
 * react-flow's renderer (each step a button, with buttons to drag it) and a
 * step's settings dialog (its Delete).
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

      const move: (node: FlowNode, dragging: boolean, dx: number) => void = (
        node: FlowNode,
        dragging: boolean,
        dx: number,
      ): void => {
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
import Route from "../../../Types/API/Route";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ComponentType, NodeType } from "../../../Types/Workflow/Component";
import { WORKFLOW_GRAPH_REVISION_KEY } from "../../../Types/Workflow/WorkflowGraphRevision";
import { WorkflowSaveConflictCopy } from "../../../UI/Components/Workflow/WorkflowSaveConflict";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Navigation from "../../../UI/Utils/Navigation";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194166257",
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

const CONNECTION: JSONObject = {
  id: "edge-manual-log",
  source: "canvas-manual-1",
  sourceHandle: "out",
  target: "canvas-log-1",
  targetHandle: "in",
};

const STORED: JSONObject = {
  nodes: [MANUAL_TRIGGER, LOG_STEP],
  edges: [CONNECTION],
};

const copyOf: (graph: JSONObject) => JSONObject = (
  graph: JSONObject,
): JSONObject => {
  return JSON.parse(JSON.stringify(graph)) as JSONObject;
};

/*
 * The workflow as the server keeps it: its graph, and how many times the
 * graph was saved (Workflow.graphRevision).
 */
let server: { graph: JSONObject; revision: number } = {
  graph: STORED,
  revision: 0,
};

// Someone else - a teammate's builder, Ask AI, the API - saves over whatever is there.
const saveElsewhere: (graph: JSONObject) => void = (graph: JSONObject): void => {
  server = { graph: copyOf(graph), revision: server.revision + 1 };
};

interface SaveRequest {
  data: JSONObject;
  miscDataProps?: JSONObject | undefined;
}

// Every save a Builder sent, with the revision it named.
const sentSaves: () => Array<SaveRequest> = (): Array<SaveRequest> => {
  return mockUpdateById.mock.calls
    .map((call: Array<unknown>): SaveRequest => {
      return call[0] as SaveRequest;
    })
    .filter((request: SaveRequest): boolean => {
      return Boolean(request.data["graph"]);
    });
};

const namedRevisions: () => Array<unknown> = (): Array<unknown> => {
  return sentSaves().map((request: SaveRequest): unknown => {
    return request.miscDataProps?.[WORKFLOW_GRAPH_REVISION_KEY];
  });
};

const stepIdsOf: (graph: JSONObject | undefined) => Array<string> = (
  graph: JSONObject | undefined,
): Array<string> => {
  return ((graph?.["nodes"] as Array<JSONObject>) || [])
    .map((node: JSONObject): string => {
      return ((node["data"] as JSONObject)["id"] as string) || "placeholder";
    })
    .sort();
};

const xOf: (graph: JSONObject, stepId: string) => number | undefined = (
  graph: JSONObject,
  stepId: string,
): number | undefined => {
  const node: JSONObject | undefined = (
    (graph["nodes"] as Array<JSONObject>) || []
  ).find((each: JSONObject): boolean => {
    return (each["data"] as JSONObject)["id"] === stepId;
  });

  return (node?.["position"] as { x?: number } | undefined)?.x;
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

// One Builder on the page, and what a person does in it.
interface OpenBuilder {
  view: ReturnType<typeof within>;
  deleteStep: (stepId: string) => Promise<void>;
  moveStep: (stepId: string) => void;
  dialog: () => HTMLElement | null;
  saveStatus: () => HTMLElement;
  undoButton: () => HTMLElement;
}

const openBuilder: () => Promise<OpenBuilder> =
  async (): Promise<OpenBuilder> => {
    const rendered: RenderResult = render(<Builder {...PAGE_PROPS} />);
    const view: ReturnType<typeof within> = within(rendered.container);

    await waitFor(() => {
      expect(view.getByTestId("workflow-canvas")).toBeInTheDocument();
    });

    return {
      view,
      deleteStep: async (stepId: string): Promise<void> => {
        fireEvent.click(view.getByTestId(`workflow-node-${stepId}`));
        fireEvent.click(view.getByRole("button", { name: "Delete step" }));

        await waitFor(() => {
          expect(view.queryByTestId(`workflow-node-${stepId}`)).toBeNull();
        });
      },
      moveStep: (stepId: string): void => {
        fireEvent.click(view.getByTestId(`drag-${stepId}`));
        fireEvent.click(view.getByTestId(`drop-${stepId}`));
      },
      dialog: (): HTMLElement | null => {
        return view.queryByRole("dialog", {
          name: WorkflowSaveConflictCopy.title,
        });
      },
      saveStatus: (): HTMLElement => {
        return view.getByTestId("workflow-save-status");
      },
      undoButton: (): HTMLElement => {
        return view.getByTestId("workflow-undo-button");
      },
    };
  };

beforeEach(() => {
  mockCanvasDraws = 0;
  mockPermissions = ["ProjectAdmin"];
  server = { graph: copyOf(STORED), revision: 0 };
  mockGetItem.mockReset();
  mockGetList.mockReset();
  mockUpdateById.mockReset();

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);

  mockGetItem.mockImplementation(async () => {
    const workflow: WorkflowModel = new WorkflowModel();
    workflow.graph = copyOf(server.graph);
    workflow.graphRevision = server.revision;
    workflow.name = "Notify on-call";
    workflow.isEnabled = false;
    return workflow;
  });

  mockGetList.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 20 };
  });

  // WorkflowService's rule: a save made to an older revision is refused.
  mockUpdateById.mockImplementation(async (request: SaveRequest) => {
    const basedOn: unknown =
      request.miscDataProps?.[WORKFLOW_GRAPH_REVISION_KEY];

    if (typeof basedOn === "number" && basedOn !== server.revision) {
      throw new HTTPErrorResponse(
        409,
        {
          message:
            "Someone else saved this workflow's graph after you read it, so this save was not made.",
        },
        {},
      );
    }

    if (request.data["graph"]) {
      server = {
        graph: copyOf(request.data["graph"] as JSONObject),
        revision: server.revision + 1,
      };
    }

    return {};
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  expect(mockCanvasDraws).toBeLessThan(800);
});

describe("two builders open on one workflow", () => {
  test("B saves after A: B's save does not replace A's change - B is told what A changed, and Show their changes puts it on B's canvas as a step Undo takes back", async () => {
    const a: OpenBuilder = await openBuilder();
    const b: OpenBuilder = await openBuilder();

    // A deletes the Log step, and it is saved.
    await a.deleteStep("log-1");
    await waitFor(
      () => {
        expect(server.revision).toBe(1);
      },
      { timeout: 4000 },
    );
    expect(stepIdsOf(server.graph)).toEqual(["manual-1"]);

    // B, still showing the Log step, moves the trigger: B's save is refused, and B is asked.
    b.moveStep("manual-1");

    await waitFor(
      () => {
        expect(b.dialog()).not.toBeNull();
      },
      { timeout: 4000 },
    );

    const dialog: HTMLElement = b.dialog() as HTMLElement;

    expect(dialog).toHaveTextContent(WorkflowSaveConflictCopy.description);
    expect(
      within(dialog).getByTestId("workflow-save-conflict-changes"),
    ).toHaveTextContent('Removed "Log" (log-1)');
    expect(dialog).toHaveTextContent(WorkflowSaveConflictCopy.note);
    // Two ways on, and no way to leave a change that cannot be saved.
    expect(
      within(dialog).getByRole("button", {
        name: WorkflowSaveConflictCopy.showTheirChanges,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", {
        name: WorkflowSaveConflictCopy.keepMine,
      }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(within(dialog).queryByTestId("close-button")).toBeNull();
    expect(b.saveStatus()).toHaveTextContent("Not saved");

    // Nothing of B's was saved over A's change, and A was asked nothing.
    expect(server.revision).toBe(1);
    expect(stepIdsOf(server.graph)).toEqual(["manual-1"]);
    expect(a.dialog()).toBeNull();
    expect(namedRevisions()).toEqual([0, 0]);

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: WorkflowSaveConflictCopy.showTheirChanges,
      }),
    );

    await waitFor(() => {
      expect(b.view.queryByTestId("workflow-node-log-1")).toBeNull();
    });
    expect(b.dialog()).toBeNull();
    expect(b.undoButton()).toHaveAttribute(
      "aria-label",
      "Undo showing their changes",
    );

    // The server has what B shows now: nothing is saved.
    await wait(1300);
    expect(sentSaves()).toHaveLength(2);
    expect(b.saveStatus()).toHaveTextContent("Saved");

    // Undo brings B's own version back - and saves it, made to A's revision, knowingly.
    fireEvent.click(b.undoButton());

    await waitFor(() => {
      expect(b.view.getByTestId("workflow-node-log-1")).toBeInTheDocument();
    });
    await waitFor(
      () => {
        expect(server.revision).toBe(2);
      },
      { timeout: 4000 },
    );
    expect(namedRevisions()).toEqual([0, 0, 1]);
    expect(stepIdsOf(server.graph)).toEqual(["log-1", "manual-1"]);
    expect(xOf(server.graph, "manual-1")).toBe(176);
  });

  test("Keep mine saves B's version over A's, made to A's revision - and A, saving next, is told in turn", async () => {
    const a: OpenBuilder = await openBuilder();
    const b: OpenBuilder = await openBuilder();

    await a.deleteStep("log-1");
    await waitFor(
      () => {
        expect(server.revision).toBe(1);
      },
      { timeout: 4000 },
    );

    b.moveStep("manual-1");

    await waitFor(
      () => {
        expect(b.dialog()).not.toBeNull();
      },
      { timeout: 4000 },
    );

    fireEvent.click(
      within(b.dialog() as HTMLElement).getByRole("button", {
        name: WorkflowSaveConflictCopy.keepMine,
      }),
    );

    // Saved at once, made to A's revision: the server ends with B's version.
    await waitFor(() => {
      expect(server.revision).toBe(2);
    });
    expect(b.dialog()).toBeNull();
    expect(namedRevisions()).toEqual([0, 0, 1]);
    expect(stepIdsOf(server.graph)).toEqual(["log-1", "manual-1"]);
    await waitFor(() => {
      expect(b.saveStatus()).toHaveTextContent("Saved");
    });

    // A, who never saw B's version, moves a step: A is asked now, and told what B changed.
    a.moveStep("manual-1");

    await waitFor(
      () => {
        expect(a.dialog()).not.toBeNull();
      },
      { timeout: 4000 },
    );

    const dialog: HTMLElement = a.dialog() as HTMLElement;
    const changes: HTMLElement = within(dialog).getByTestId(
      "workflow-save-conflict-changes",
    );

    expect(changes).toHaveTextContent('Added "Log" (log-1)');
    expect(changes).toHaveTextContent('Moved "Manual" (manual-1)');
    expect(server.revision).toBe(2);
    expect(stepIdsOf(server.graph)).toEqual(["log-1", "manual-1"]);
  });
});

describe("one builder on a workflow", () => {
  test("every save is one request, made to the revision the last one landed at, and nothing is read again", async () => {
    server = { graph: copyOf(STORED), revision: 4 };

    const builder: OpenBuilder = await openBuilder();
    const readsWhenOpened: number = mockGetItem.mock.calls.length;

    await builder.deleteStep("log-1");
    await waitFor(
      () => {
        expect(server.revision).toBe(5);
      },
      { timeout: 4000 },
    );

    fireEvent.click(builder.undoButton());
    await waitFor(
      () => {
        expect(server.revision).toBe(6);
      },
      { timeout: 4000 },
    );

    builder.moveStep("manual-1");
    await waitFor(
      () => {
        expect(server.revision).toBe(7);
      },
      { timeout: 4000 },
    );

    expect(namedRevisions()).toEqual([4, 5, 6]);
    expect(mockGetItem.mock.calls.length).toBe(readsWhenOpened);
    expect(builder.dialog()).toBeNull();
    expect(builder.saveStatus()).toHaveTextContent("Saved");
  });

  test("the same graph saved again elsewhere moves only the count: the builder saves again quietly, asking nothing", async () => {
    const builder: OpenBuilder = await openBuilder();

    // The API saves the workflow exactly as it is.
    saveElsewhere(STORED);

    await builder.deleteStep("log-1");
    await waitFor(
      () => {
        expect(server.revision).toBe(2);
      },
      { timeout: 4000 },
    );

    expect(namedRevisions()).toEqual([0, 1]);
    expect(stepIdsOf(server.graph)).toEqual(["manual-1"]);
    expect(builder.dialog()).toBeNull();
    expect(builder.saveStatus()).toHaveTextContent("Saved");
  });

  test("Ask AI's change is never asked about: arriving while the builder asks, it closes the question and is drawn as Ask AI's change", async () => {
    const builder: OpenBuilder = await openBuilder();

    // Ask AI saves, from the panel beside the builder, as the person.
    saveElsewhere({
      nodes: [MANUAL_TRIGGER, LOG_STEP, EMAIL_STEP],
      edges: [CONNECTION],
    });

    // A move made just before the panel says so: refused, and asked about.
    builder.moveStep("manual-1");

    await waitFor(
      () => {
        expect(builder.dialog()).not.toBeNull();
      },
      { timeout: 4000 },
    );

    act(() => {
      GlobalEvents.dispatchEvent(EventName.WORKFLOW_CHANGED_BY_AI, {
        workflowId: WORKFLOW_ID.toString(),
      });
    });

    await waitFor(() => {
      expect(
        builder.view.getByTestId("workflow-node-send-email-1"),
      ).toBeInTheDocument();
    });
    expect(builder.dialog()).toBeNull();
    expect(builder.undoButton()).toHaveAttribute(
      "aria-label",
      "Undo Ask AI's change",
    );

    // Ask AI's change is the server's: nothing is saved over it.
    await wait(1300);
    expect(sentSaves()).toHaveLength(1);
    expect(server.revision).toBe(1);

    // And the next change is made to Ask AI's revision.
    await builder.deleteStep("log-1");
    await waitFor(
      () => {
        expect(server.revision).toBe(2);
      },
      { timeout: 4000 },
    );
    expect(namedRevisions()).toEqual([0, 1]);
    expect(stepIdsOf(server.graph)).toEqual(["manual-1", "send-email-1"]);
  });

  test("Ask AI's change, heard of before the builder saves, draws as before: no question, and saves made to its revision", async () => {
    const builder: OpenBuilder = await openBuilder();

    saveElsewhere({
      nodes: [MANUAL_TRIGGER, LOG_STEP, EMAIL_STEP],
      edges: [CONNECTION],
    });

    act(() => {
      GlobalEvents.dispatchEvent(EventName.WORKFLOW_CHANGED_BY_AI, {
        workflowId: WORKFLOW_ID.toString(),
      });
    });

    await waitFor(() => {
      expect(
        builder.view.getByTestId("workflow-node-send-email-1"),
      ).toBeInTheDocument();
    });

    await builder.deleteStep("log-1");
    await waitFor(
      () => {
        expect(server.revision).toBe(2);
      },
      { timeout: 4000 },
    );

    expect(namedRevisions()).toEqual([1]);
    expect(builder.dialog()).toBeNull();
  });
});
