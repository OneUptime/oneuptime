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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as SettingsProps } from "../../../UI/Components/Workflow/ComponentSettingsModal";
import { Node as FlowNode, ReactFlowProps } from "reactflow";

/*
 * The Builder's add button with the real canvas and the real Add Trigger /
 * Add Component panel: what the button says, the panel it opens, and the
 * button changing as the first trigger is chosen and the last one deleted.
 *
 * "When there are no triggers on the form, the Add Component button should
 * say 'Add Trigger' so it's easier for people to use and understand." - the
 * maintainer.
 *
 * Only what jsdom cannot draw is replaced: react-flow's renderer (each step a
 * button, as in Workflow.test.tsx) and a step's settings dialog (just its
 * Delete). The catalog is the real hand-written steps plus the real
 * generator's steps for a few models (PickerFixtures), and the panel is the
 * real ComponentsModal, titled with the name the button showed.
 */

/*
 * How many times the canvas was drawn in this test. A page and a canvas
 * that chase each other's state re-draw it for ever and hang the suite;
 * past this many draws the stand-in throws instead, and the test fails.
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

      return (
        <div data-testid="workflow-canvas">
          {(props.nodes || []).map((node: FlowNode): React.ReactElement => {
            const data: { id?: string; nodeType?: string } = node.data;

            return (
              <div
                role="button"
                tabIndex={0}
                key={node.id}
                className="react-flow__node"
                data-id={node.id}
                data-testid={`workflow-node-${data.id || "placeholder"}`}
                onClick={(event: React.MouseEvent<HTMLDivElement>) => {
                  props.onNodeClick?.(event, node);
                }}
              >
                {data.nodeType === "PlaceholderNode"
                  ? "Choose what starts this workflow"
                  : data.id}
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

jest.mock("../../../UI/Components/Workflow/Utils", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Workflow/Utils",
  ) as Record<string, unknown>;
  const fixtures: {
    buildFixturePalette: () => { components: unknown; categories: unknown };
  } = jest.requireActual(
    "../../UI/Components/Workflow/ComponentPicker/PickerFixtures",
  ) as {
    buildFixturePalette: () => { components: unknown; categories: unknown };
  };

  return {
    ...actual,
    loadComponentsAndCategories: () => {
      return fixtures.buildFixturePalette();
    },
  };
});

jest.mock("../../../UI/Components/Workflow/ComponentSettingsModal", () => {
  return {
    __esModule: true,
    default: (props: SettingsProps): React.ReactElement => {
      return (
        <div data-testid="step-settings">
          <span>{props.component.id}</span>
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
const mockUpdateById: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 1 };
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
import WorkflowModel from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ComponentType, NodeType } from "../../../Types/Workflow/Component";
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
  y: number;
}) => JSONObject;

// A step as a saved graph stores it.
const graphNode: GraphNodeFunction = (data: {
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
      error: "",
      arguments: {},
      returnValues: {},
    },
  };
};

const MANUAL_TRIGGER: JSONObject = graphNode({
  id: "manual-1",
  metadataId: "manual",
  componentType: ComponentType.Trigger,
  y: 100,
});

const LOG_STEP: JSONObject = graphNode({
  id: "log-1",
  metadataId: "log",
  componentType: ComponentType.Component,
  y: 340,
});

let storedGraph: JSONObject = { nodes: [], edges: [] };

type RenderBuilderFunction = () => Promise<void>;

const renderBuilder: RenderBuilderFunction = async (): Promise<void> => {
  render(<Builder {...PAGE_PROPS} />);

  await waitFor(() => {
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });
};

type ElementFunction = () => HTMLElement;

const addButton: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-add-button");
};

// The open Add Trigger or Add Component panel.
const panel: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("side-over");
};

type PanelTitleFunction = () => string;

const panelTitle: PanelTitleFunction = (): string => {
  return screen.getByTestId("side-over-title").textContent || "";
};

type PressFunction = () => Promise<string>;

/*
 * Presses the toolbar's add button, and gives back the title of the panel
 * that opened, once it has.
 */
const pressAddButton: PressFunction = async (): Promise<string> => {
  fireEvent.click(addButton());

  await waitFor(() => {
    expect(screen.getByTestId("side-over-title")).toBeInTheDocument();
  });

  return panelTitle();
};

type ChooseFunction = (title: string) => Promise<void>;

// One click on a step in the panel adds it, and the panel closes.
const choose: ChooseFunction = async (title: string): Promise<void> => {
  fireEvent.click(
    within(panel()).getByRole("button", { name: title, exact: true }),
  );

  await waitFor(() => {
    expect(screen.queryByTestId("side-over-title")).toBeNull();
  });
};

type CloseFunction = () => Promise<void>;

const closePanel: CloseFunction = async (): Promise<void> => {
  fireEvent.click(
    within(screen.getByTestId("side-over-footer")).getByRole("button", {
      name: "Close",
    }),
  );

  await waitFor(() => {
    expect(screen.queryByTestId("side-over-title")).toBeNull();
  });
};

type ButtonSaysFunction = (name: string) => Promise<void>;

const expectButtonToSay: ButtonSaysFunction = async (
  name: string,
): Promise<void> => {
  await waitFor(() => {
    expect(addButton()).toHaveTextContent(name);
  });
  expect(addButton()).toHaveAccessibleName(name);
};

beforeEach(() => {
  mockCanvasDraws = 0;
  storedGraph = { nodes: [], edges: [] };
  mockGetItem.mockReset();
  mockUpdateById.mockReset();

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);

  mockGetItem.mockImplementation(async () => {
    const workflow: WorkflowModel = new WorkflowModel();

    workflow.graph = JSON.parse(JSON.stringify(storedGraph)) as JSONObject;
    workflow.name = "Notify on-call";
    workflow.isEnabled = false;

    return workflow;
  });

  mockUpdateById.mockImplementation(async () => {
    return {};
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  // Far fewer than the cap: each press, choice and deletion draws it a few times.
  expect(mockCanvasDraws).toBeLessThan(200);
});

describe("a workflow from scratch, in the real Builder", () => {
  test("the button says Add Trigger and opens the Add Trigger panel, which offers triggers only", async () => {
    await renderBuilder();
    await expectButtonToSay("Add Trigger");

    expect(await pressAddButton()).toBe("Add Trigger");
    expect(screen.getByTestId("side-over-description")).toHaveTextContent(
      "Click a trigger to add it to your workflow.",
    );
    expect(
      within(panel()).getByRole("button", { name: "Manual", exact: true }),
    ).toBeInTheDocument();
    expect(
      within(panel()).queryByRole("button", { name: "Log", exact: true }),
    ).toBeNull();
  });

  test("choosing a trigger in it replaces the dashed card, and the button says Add Component", async () => {
    await renderBuilder();
    await pressAddButton();
    await choose("Manual");

    expect(screen.getByTestId("workflow-node-manual-1")).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-node-placeholder")).toBeNull();
    // Its settings stay closed, as for any step just added.
    expect(screen.queryByTestId("step-settings")).toBeNull();

    await expectButtonToSay("Add Component");
  });

  test("then the button opens the Add Component panel, and the step chosen joins the trigger", async () => {
    await renderBuilder();
    await pressAddButton();
    await choose("Manual");
    await expectButtonToSay("Add Component");

    expect(await pressAddButton()).toBe("Add Component");
    expect(
      within(panel()).queryByRole("button", { name: "Manual", exact: true }),
    ).toBeNull();

    await choose("Log");

    expect(screen.getByTestId("workflow-node-manual-1")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-node-log-1")).toBeInTheDocument();
    await expectButtonToSay("Add Component");
  });

  test("the dashed card's own panel is the same Add Trigger panel, and the button follows it too", async () => {
    await renderBuilder();

    fireEvent.click(screen.getByTestId("workflow-node-placeholder"));

    await waitFor(() => {
      expect(panelTitle()).toBe("Add Trigger");
    });
    // One panel, not two.
    expect(screen.getAllByTestId("side-over-title")).toHaveLength(1);

    await choose("Manual");
    await expectButtonToSay("Add Component");
  });

  test("closed without a choice, the panel opens again on the next press", async () => {
    await renderBuilder();

    expect(await pressAddButton()).toBe("Add Trigger");
    await closePanel();

    expect(screen.getByTestId("workflow-node-placeholder")).toBeInTheDocument();
    await expectButtonToSay("Add Trigger");

    expect(await pressAddButton()).toBe("Add Trigger");
  });
});

describe("a workflow with a trigger, in the real Builder", () => {
  test("the button says Add Component and opens the Add Component panel", async () => {
    storedGraph = { nodes: [MANUAL_TRIGGER, LOG_STEP], edges: [] };

    await renderBuilder();
    await expectButtonToSay("Add Component");

    expect(await pressAddButton()).toBe("Add Component");
    expect(screen.getByTestId("side-over-description")).toHaveTextContent(
      "Click a component to add it to your workflow.",
    );
  });

  test("deleting its trigger brings back the dashed card and Add Trigger; a new trigger brings back Add Component", async () => {
    storedGraph = { nodes: [MANUAL_TRIGGER, LOG_STEP], edges: [] };

    await renderBuilder();
    await expectButtonToSay("Add Component");

    fireEvent.click(screen.getByTestId("workflow-node-manual-1"));
    fireEvent.click(screen.getByRole("button", { name: "Delete step" }));

    await waitFor(() => {
      expect(
        screen.getByTestId("workflow-node-placeholder"),
      ).toBeInTheDocument();
    });
    await expectButtonToSay("Add Trigger");

    expect(await pressAddButton()).toBe("Add Trigger");
    await choose("Manual");

    // The step kept its place; the new trigger took the dashed card's.
    expect(screen.getByTestId("workflow-node-log-1")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-node-manual-1")).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-node-placeholder")).toBeNull();
    await expectButtonToSay("Add Component");
  });

  test("deleting a step that is not the trigger leaves Add Component", async () => {
    storedGraph = { nodes: [MANUAL_TRIGGER, LOG_STEP], edges: [] };

    await renderBuilder();

    fireEvent.click(screen.getByTestId("workflow-node-log-1"));
    fireEvent.click(screen.getByRole("button", { name: "Delete step" }));

    await waitFor(() => {
      expect(screen.queryByTestId("workflow-node-log-1")).toBeNull();
    });
    await expectButtonToSay("Add Component");
  });
});

describe("what the Builder saves along the way", () => {
  test("the trigger chosen from the button is saved, and no dashed card with it", async () => {
    await renderBuilder();
    await pressAddButton();
    await choose("Manual");

    await waitFor(
      () => {
        const graphs: Array<JSONObject> = mockUpdateById.mock.calls
          .map((call: Array<unknown>) => {
            return (call[0] as { data: JSONObject }).data["graph"] as
              | JSONObject
              | undefined;
          })
          .filter((graph: JSONObject | undefined): boolean => {
            return Boolean(graph);
          }) as Array<JSONObject>;
        const last: JSONObject | undefined = graphs[graphs.length - 1];

        expect(
          ((last?.["nodes"] as Array<JSONObject>) || []).map(
            (node: JSONObject) => {
              const data: JSONObject = node["data"] as JSONObject;

              return [data["nodeType"], data["id"]];
            },
          ),
        ).toEqual([[NodeType.Node, "manual-1"]]);
      },
      { timeout: 4000 },
    );
  });
});
