import Workflow, {
  ComponentProps as WorkflowProps,
  getPlaceholderTriggerNode,
} from "../../../../UI/Components/Workflow/Workflow";
import { ComponentProps as PickerProps } from "../../../../UI/Components/Workflow/ComponentsModal";
import { ComponentProps as SettingsProps } from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import { ComponentProps as RunProps } from "../../../../UI/Components/Workflow/RunModal";
import { WorkflowNodeRenderData } from "../../../../UI/Components/Workflow/GraphLintSummary";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import IconProp from "../../../../Types/Icon/IconProp";
import ObjectID from "../../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React, { ReactElement } from "react";
import { Edge, Node, ReactFlowInstance, ReactFlowProps } from "reactflow";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * These tests exercise the builder's wiring, including ReactFlow's real state
 * hooks and graph helpers. Only its browser renderer and the three modal
 * boundaries are replaced: jsdom cannot measure the canvas, and form field
 * validation is covered in the modal suites. Clicks travel through ReactFlow's
 * node-click event, matching the production canvas's settings entry point.
 *
 * The stand-in canvas draws each step the way react-flow's own node wrapper
 * does as far as these tests care: a focusable element with the class
 * react-flow__node and the node's id in data-id, inside a wrapper that carries
 * the builder's own props (onKeyDown among them).
 */
let mockFlowProps: ReactFlowProps | null = null;
let mockSettingsProps: SettingsProps | null = null;
const mockSetCenter: MockFunction = getJestMockFunction();
const mockSetViewport: MockFunction = getJestMockFunction();
const mockGetViewport: MockFunction = getJestMockFunction();
const mockGetZoom: MockFunction = getJestMockFunction();

jest.mock("reactflow", () => {
  const actual: typeof import("reactflow") = jest.requireActual(
    "reactflow",
  ) as typeof import("reactflow");

  return {
    ...actual,
    __esModule: true,
    default: (props: ReactFlowProps): ReactElement => {
      mockFlowProps = props;

      React.useEffect(() => {
        props.onInit?.({
          setCenter: mockSetCenter,
          setViewport: mockSetViewport,
          getViewport: mockGetViewport,
          getZoom: mockGetZoom,
        } as unknown as ReactFlowInstance);
      }, []);

      return (
        <div data-testid="workflow-canvas" onKeyDown={props.onKeyDown}>
          {(props.nodes || []).map((node: Node): ReactElement => {
            const data: NodeDataProp = node.data as NodeDataProp;

            return (
              <div
                role="button"
                tabIndex={0}
                key={node.id}
                className="react-flow__node"
                data-id={node.id}
                data-testid={`workflow-node-${node.id}`}
                onClick={(event: React.MouseEvent<HTMLDivElement>) => {
                  props.onNodeClick?.(event, node);
                }}
              >
                {data.id || "Add trigger"}
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

jest.mock("../../../../UI/Components/Workflow/Component", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("../../../../UI/Components/Workflow/Utils", () => {
  return {
    loadComponentsAndCategories: () => {
      return {
        components: [ACTION_METADATA, TRIGGER_METADATA],
        categories: [
          {
            name: "General",
            description: "Workflow building blocks",
            icon: IconProp.Bolt,
          },
        ],
      };
    },
  };
});

jest.mock("../../../../UI/Components/Workflow/ComponentsModal", () => {
  return {
    __esModule: true,
    default: (props: PickerProps): ReactElement => {
      return (
        <div data-testid={`picker-${props.componentsType}`}>
          {props.components.map((metadata: ComponentMetadata): ReactElement => {
            return (
              <button
                type="button"
                key={metadata.id}
                onClick={() => {
                  props.onComponentClick(metadata);
                }}
              >
                Choose {metadata.title}
              </button>
            );
          })}
          <button type="button" onClick={props.onCloseModal}>
            Close picker
          </button>
        </div>
      );
    },
  };
});

jest.mock("../../../../UI/Components/Workflow/ComponentSettingsModal", () => {
  return {
    __esModule: true,
    default: (props: SettingsProps): ReactElement => {
      mockSettingsProps = props;
      const [draft, setDraft] = React.useState<NodeDataProp>(props.component);

      return (
        <div data-testid="step-settings">
          <span data-testid="settings-step-id">{props.component.id}</span>
          <input
            aria-label="Step message"
            value={String(draft.arguments?.["message"] || "")}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setDraft({
                ...draft,
                arguments: {
                  ...draft.arguments,
                  message: event.target.value,
                },
              });
            }}
          />
          <button
            type="button"
            onClick={() => {
              props.onSave(draft);
            }}
          >
            Save settings
          </button>
          <button type="button" onClick={props.onClose}>
            Close settings
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
          {props.onRunStep && (
            <button
              type="button"
              onClick={() => {
                props.onRunStep?.(draft);
              }}
            >
              Run this step
            </button>
          )}
        </div>
      );
    },
  };
});

jest.mock("../../../../UI/Components/Workflow/RunModal", () => {
  return {
    __esModule: true,
    default: (props: RunProps): ReactElement => {
      return (
        <div data-testid="run-workflow-modal">
          <span data-testid="run-trigger-id">{props.trigger.id}</span>
          <button type="button" onClick={props.onClose}>
            Close run
          </button>
          <button
            type="button"
            onClick={() => {
              props.onRun(props.trigger);
            }}
          >
            Confirm run
          </button>
        </div>
      );
    },
  };
});

const ACTION_METADATA: ComponentMetadata = {
  id: "write-log",
  title: "Write a log message",
  description: "Write a message to the workflow log.",
  category: "General",
  iconProp: IconProp.Bolt,
  componentType: ComponentType.Component,
  arguments: [
    {
      id: "message",
      name: "Message",
      description: "The message to log.",
      required: true,
      type: ComponentInputType.Text,
    },
  ],
  returnValues: [],
  inPorts: [{ id: "in", title: "In", description: "Start this step." }],
  outPorts: [{ id: "out", title: "Out", description: "Continue." }],
};

const TRIGGER_METADATA: ComponentMetadata = {
  ...ACTION_METADATA,
  id: "manual-trigger",
  title: "Manual trigger",
  description: "Start this workflow manually.",
  componentType: ComponentType.Trigger,
  arguments: [],
  inPorts: [],
};

type MakeNodeFunction = (
  metadata: ComponentMetadata,
  number?: number,
) => Node<NodeDataProp>;

const makeNode: MakeNodeFunction = (
  metadata: ComponentMetadata,
  number: number = 1,
): Node<NodeDataProp> => {
  return {
    id: `canvas-${metadata.id}-${number}`,
    type: "node",
    position: { x: 160, y: number * 240 },
    data: {
      id: `${metadata.id}-${number}`,
      internalId: `runner-${metadata.id}-${number}`,
      nodeType: NodeType.Node,
      componentType: metadata.componentType,
      metadataId: metadata.id,
      metadata: metadata,
      error: "",
      arguments: {},
      returnValues: {},
    },
  };
};

interface BuilderHarness {
  view: RenderResult;
  props: WorkflowProps;
  onUpdated: MockFunction;
  onPickerUpdate: MockFunction;
  onRunUpdate: MockFunction;
  onRun: MockFunction;
  onLint: MockFunction;
}

type RenderBuilderFunction = (
  overrides?: Partial<WorkflowProps>,
) => BuilderHarness;

const renderBuilder: RenderBuilderFunction = (
  overrides: Partial<WorkflowProps> = {},
): BuilderHarness => {
  const onUpdated: MockFunction = getJestMockFunction();
  const onPickerUpdate: MockFunction = getJestMockFunction();
  const onRunUpdate: MockFunction = getJestMockFunction();
  const onRun: MockFunction = getJestMockFunction();
  const onLint: MockFunction = getJestMockFunction();
  const props: WorkflowProps = {
    initialNodes: [makeNode(TRIGGER_METADATA)],
    initialEdges: [],
    workflowId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    showComponentsPickerModal: false,
    showRunModal: false,
    onWorkflowUpdated: onUpdated,
    onComponentPickerModalUpdate: onPickerUpdate,
    onRunModalUpdate: onRunUpdate,
    onRun: onRun,
    onLintResultChange: onLint,
    ...overrides,
  };

  return {
    view: render(<Workflow {...props} />),
    props: props,
    onUpdated: onUpdated,
    onPickerUpdate: onPickerUpdate,
    onRunUpdate: onRunUpdate,
    onRun: onRun,
    onLint: onLint,
  };
};

type GetRenderedNodesFunction = () => Array<Node<WorkflowNodeRenderData>>;

const getRenderedNodes: GetRenderedNodesFunction = (): Array<
  Node<WorkflowNodeRenderData>
> => {
  return (mockFlowProps?.nodes || []) as Array<Node<WorkflowNodeRenderData>>;
};

type GetStoredNodesFunction = (
  harness: BuilderHarness,
) => Array<Node<WorkflowNodeRenderData>>;

const getStoredNodes: GetStoredNodesFunction = (
  harness: BuilderHarness,
): Array<Node<WorkflowNodeRenderData>> => {
  const calls: Array<Array<unknown>> = harness.onUpdated.mock.calls;
  return calls[calls.length - 1]?.[0] as Array<Node<WorkflowNodeRenderData>>;
};

type FindRenderedNodeFunction = (
  componentId: string,
) => Node<WorkflowNodeRenderData>;

const findRenderedNode: FindRenderedNodeFunction = (
  componentId: string,
): Node<WorkflowNodeRenderData> => {
  const node: Node<WorkflowNodeRenderData> | undefined =
    getRenderedNodes().find((candidate: Node<WorkflowNodeRenderData>) => {
      return candidate.data.id === componentId;
    });

  if (!node) {
    throw new Error(`Expected ${componentId} on the workflow canvas.`);
  }

  return node;
};

type GetNodeElementFunction = (componentId: string) => HTMLElement;

const getNodeElement: GetNodeElementFunction = (
  componentId: string,
): HTMLElement => {
  return screen.getByTestId(
    `workflow-node-${findRenderedNode(componentId).id}`,
  );
};

type GetSettingsPropsFunction = () => SettingsProps;

const getSettingsProps: GetSettingsPropsFunction = (): SettingsProps => {
  if (!mockSettingsProps) {
    throw new Error("Expected step settings to have opened.");
  }

  return mockSettingsProps;
};

type OpenPickerFunction = (harness: BuilderHarness) => void;

const openPicker: OpenPickerFunction = (harness: BuilderHarness): void => {
  harness.view.rerender(
    <Workflow {...harness.props} showComponentsPickerModal={false} />,
  );
  harness.view.rerender(
    <Workflow {...harness.props} showComponentsPickerModal={true} />,
  );
};

type ChooseActionFunction = () => void;

const chooseAction: ChooseActionFunction = (): void => {
  fireEvent.click(
    screen.getByRole("button", { name: `Choose ${ACTION_METADATA.title}` }),
  );
};

type AddActionFunction = (harness: BuilderHarness) => void;

const addAction: AddActionFunction = (harness: BuilderHarness): void => {
  openPicker(harness);
  chooseAction();
};

type SetCanvasSizeFunction = (width: number, height: number) => void;

/*
 * jsdom lays nothing out, so the canvas has no size and no step is ever in
 * view. Tests about a step that is already on screen give it one.
 */
const setCanvasSize: SetCanvasSizeFunction = (
  width: number,
  height: number,
): void => {
  const frame: HTMLElement = screen.getByTestId("workflow-canvas")
    .parentElement as HTMLElement;

  Object.defineProperty(frame, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(frame, "clientHeight", {
    configurable: true,
    value: height,
  });
};

type PressKeyFunction = (
  element: HTMLElement,
  init: { key: string } & Partial<KeyboardEventInit>,
) => boolean;

/** Presses a key on an element; true when nothing cancelled the keydown. */
const pressKey: PressKeyFunction = (
  element: HTMLElement,
  init: { key: string } & Partial<KeyboardEventInit>,
): boolean => {
  return fireEvent.keyDown(element, init);
};

beforeEach(() => {
  mockFlowProps = null;
  mockSettingsProps = null;
  mockSetCenter.mockReset();
  mockSetCenter.mockResolvedValue(true);
  mockSetViewport.mockReset();
  mockGetViewport.mockReset();
  mockGetViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  mockGetZoom.mockReset();
  mockGetZoom.mockReturnValue(1);
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("Workflow builder: adding a step leaves its settings closed", () => {
  test("choosing a component closes the picker and adds the step, selected, without opening its settings", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);

    expect(screen.queryByTestId("picker-Component")).not.toBeInTheDocument();
    expect(harness.onPickerUpdate).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
    expect(mockSettingsProps).toBeNull();
    expect(getRenderedNodes()).toHaveLength(2);
    expect(findRenderedNode("write-log-1").selected).toBe(true);
    expect(findRenderedNode("manual-trigger-1").selected).toBe(false);
  });

  test("clicking the new step opens its settings", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);

    fireEvent.click(getNodeElement("write-log-1"));

    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "write-log-1",
    );
    expect(getSettingsProps().workflowId).toEqual(harness.props.workflowId);
    expect(findRenderedNode("write-log-1").data.onClick).toBeUndefined();
  });

  test("choosing a trigger from the placeholder does not open its settings either", () => {
    const placeholder: Node = getPlaceholderTriggerNode();
    const harness: BuilderHarness = renderBuilder({
      initialNodes: [placeholder],
    });
    fireEvent.click(screen.getByTestId(`workflow-node-${placeholder.id}`));
    fireEvent.click(
      screen.getByRole("button", { name: `Choose ${TRIGGER_METADATA.title}` }),
    );

    expect(screen.queryByTestId("picker-Trigger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
    expect(getStoredNodes(harness)).toHaveLength(1);
    expect(findRenderedNode("manual-trigger-1").selected).toBe(true);

    fireEvent.click(getNodeElement("manual-trigger-1"));
    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "manual-trigger-1",
    );
  });

  test("several steps can be added in a row without a dialog in between", () => {
    const harness: BuilderHarness = renderBuilder();

    for (let index: number = 1; index <= 3; index++) {
      addAction(harness);
      expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
      expect(screen.queryByTestId("picker-Component")).not.toBeInTheDocument();
    }

    expect(getRenderedNodes()).toHaveLength(4);
    expect(
      getRenderedNodes()
        .filter((node: Node<WorkflowNodeRenderData>) => {
          return node.selected;
        })
        .map((node: Node<WorkflowNodeRenderData>) => {
          return node.data.id;
        }),
    ).toEqual(["write-log-3"]);
  });

  test("adding a step while the canvas is otherwise idle never opens a settings dialog later", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);

    // Anything that re-renders the builder must not bring the dialog back.
    harness.view.rerender(
      <Workflow {...harness.props} showComponentsPickerModal={false} />,
    );
    act(() => {
      mockFlowProps?.onNodesChange?.([
        {
          id: findRenderedNode("write-log-1").id,
          type: "dimensions",
          dimensions: { width: 256, height: 170 },
        },
      ]);
    });

    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
  });

  test("a step that still needs its required settings is drawn with that, and it is never saved", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);

    expect(findRenderedNode("write-log-1").data.issueSummary).toEqual({
      missingSettingMessages: ['"Message" is required but empty.'],
      errorMessages: [],
      warningMessages: [
        "Nothing connects to this step from the trigger, so it will never run.",
      ],
    });

    for (const node of getStoredNodes(harness)) {
      expect(node.data.issueSummary).toBeUndefined();
      expect(node.data.error).toBe("");
    }
  });

  test("filling in the required setting takes the setup prompt away", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);
    fireEvent.click(getNodeElement("write-log-1"));
    fireEvent.change(screen.getByRole("textbox", { name: "Step message" }), {
      target: { value: "Deployment finished" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(
      findRenderedNode("write-log-1").data.issueSummary?.missingSettingMessages,
    ).toEqual([]);
  });

  test("closing the picker without choosing anything opens nothing", () => {
    const harness: BuilderHarness = renderBuilder();
    openPicker(harness);
    fireEvent.click(screen.getByRole("button", { name: "Close picker" }));

    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
    expect(getRenderedNodes()).toHaveLength(1);
  });
});

describe("Workflow builder: the keyboard reaches a new step", () => {
  test("the new step takes the keyboard focus once it is on the canvas", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);

    expect(document.activeElement).toBe(getNodeElement("write-log-1"));
  });

  test("Enter on the focused step opens its settings", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);

    const notCancelled: boolean = pressKey(getNodeElement("write-log-1"), {
      key: "Enter",
    });

    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "write-log-1",
    );
    // Cancelled, so the Enter does not go on to type into the opened settings.
    expect(notCancelled).toBe(false);
  });

  test("Enter opens any step's settings, not only a new one", () => {
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    renderBuilder({ initialNodes: [trigger, action] });

    pressKey(screen.getByTestId(`workflow-node-${action.id}`), {
      key: "Enter",
    });

    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "write-log-1",
    );
  });

  test("Enter on the trigger placeholder opens the trigger picker", () => {
    const placeholder: Node = getPlaceholderTriggerNode();
    renderBuilder({ initialNodes: [placeholder] });

    pressKey(screen.getByTestId(`workflow-node-${placeholder.id}`), {
      key: "Enter",
    });

    expect(screen.getByTestId("picker-Trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
  });

  test.each([
    ["Space", { key: " " }],
    ["a letter", { key: "a" }],
    ["Escape", { key: "Escape" }],
    ["Ctrl+Enter", { key: "Enter", ctrlKey: true }],
    ["Cmd+Enter", { key: "Enter", metaKey: true }],
    ["Alt+Enter", { key: "Enter", altKey: true }],
    ["Shift+Enter", { key: "Enter", shiftKey: true }],
  ])(
    "%s on a step opens nothing and is left alone",
    (_label: string, init: { key: string } & Partial<KeyboardEventInit>) => {
      const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
      renderBuilder({ initialNodes: [action] });

      const notCancelled: boolean = pressKey(
        screen.getByTestId(`workflow-node-${action.id}`),
        init,
      );

      expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
      expect(notCancelled).toBe(true);
    },
  );

  test("Enter on the canvas itself, rather than on a step, opens nothing", () => {
    renderBuilder();

    const notCancelled: boolean = pressKey(
      screen.getByTestId("workflow-canvas"),
      { key: "Enter" },
    );

    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
    expect(notCancelled).toBe(true);
  });

  test("an Enter something else already handled opens nothing", () => {
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    renderBuilder({ initialNodes: [action] });

    const element: HTMLElement = screen.getByTestId(
      `workflow-node-${action.id}`,
    );
    element.addEventListener("keydown", (event: KeyboardEvent) => {
      event.preventDefault();
    });
    pressKey(element, { key: "Enter" });

    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
  });

  test("Enter on a step that is no longer on the canvas opens nothing", () => {
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    renderBuilder({ initialNodes: [action] });

    const stray: HTMLDivElement = document.createElement("div");
    stray.className = "react-flow__node";
    stray.setAttribute("data-id", "deleted-node");
    screen.getByTestId("workflow-canvas").appendChild(stray);

    pressKey(stray, { key: "Enter" });

    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
  });

  test("focus that has gone somewhere else is not taken back", () => {
    const harness: BuilderHarness = renderBuilder();
    const elsewhere: HTMLInputElement = document.createElement("input");
    elsewhere.setAttribute("aria-label", "Somewhere else");
    document.body.appendChild(elsewhere);

    openPicker(harness);
    elsewhere.focus();
    chooseAction();

    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  test("the focused step's Enter is the only way in besides a click: adding never focuses the settings", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);

    expect(
      screen.getByTestId("workflow-canvas").contains(document.activeElement),
    ).toBe(true);
    expect(screen.queryByRole("textbox", { name: "Step message" })).toBeNull();
  });
});

describe("Workflow builder: bringing a new step into view", () => {
  test("a step that lands off screen is scrolled to, at the zoom the builder chose", () => {
    mockGetViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.75 });
    const harness: BuilderHarness = renderBuilder();
    setCanvasSize(1200, 500);
    addAction(harness);

    // It lands at y 520, so at zoom 0.75 its bottom is drawn at 540.
    const added: Node<WorkflowNodeRenderData> = findRenderedNode("write-log-1");
    expect(added.position.y).toBe(520);
    expect(mockSetViewport).toHaveBeenCalledTimes(1);
    const [viewport, options] = mockSetViewport.mock.calls[0] as [
      { x: number; y: number; zoom: number },
      { duration: number },
    ];
    expect(viewport.zoom).toBe(0.75);
    // Only as far as it takes: the step's bottom ends up at the margin.
    expect((added.position.y + 200) * 0.75 + viewport.y).toBe(500 - 24);
    expect(viewport.x).toBe(0);
    expect(options).toEqual({ duration: 200 });
    // The old behaviour centred on the step and reset the zoom to 1.
    expect(mockSetCenter).not.toHaveBeenCalled();
  });

  test("a step that lands in view does not move the canvas", () => {
    const harness: BuilderHarness = renderBuilder();
    setCanvasSize(1200, 900);
    addAction(harness);

    // The trigger sits at y 240, so the step lands at 240 + 200 + 80 = 520.
    expect(findRenderedNode("write-log-1").position.y).toBe(520);
    expect(mockSetViewport).not.toHaveBeenCalled();
    expect(mockSetCenter).not.toHaveBeenCalled();
  });

  test("a step under the minimap is scrolled clear of it", () => {
    const harness: BuilderHarness = renderBuilder();
    setCanvasSize(1200, 900);

    const minimap: HTMLDivElement = document.createElement("div");
    minimap.className = "react-flow__minimap";
    minimap.getBoundingClientRect = (): DOMRect => {
      return {
        left: 100,
        top: 600,
        right: 400,
        bottom: 880,
        width: 300,
        height: 280,
        x: 100,
        y: 600,
        toJSON: () => {
          return {};
        },
      } as DOMRect;
    };
    screen.getByTestId("workflow-canvas").appendChild(minimap);

    addAction(harness);

    expect(mockSetViewport).toHaveBeenCalledTimes(1);
    const [viewport] = mockSetViewport.mock.calls[0] as [
      { x: number; y: number; zoom: number },
    ];
    // The step's bottom (520 + 200) has to clear the minimap's top, 600 - 24.
    expect(720 + viewport.y).toBe(576);
  });

  test("with reduced motion the canvas jumps rather than glides", () => {
    window.matchMedia = ((query: string) => {
      return {
        matches: query === "(prefers-reduced-motion: reduce)",
      };
    }) as unknown as typeof window.matchMedia;
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);

    const [, options] = mockSetViewport.mock.calls[0] as [
      unknown,
      { duration: number },
    ];
    expect(options).toEqual({ duration: 0 });
  });

  test("nothing moves until the canvas has finished starting up", () => {
    renderBuilder();
    expect(mockSetViewport).not.toHaveBeenCalled();
    expect(mockSetCenter).not.toHaveBeenCalled();
  });
});

describe("Workflow builder: configuring steps", () => {
  test("saving arguments updates the graph and reopening shows the saved values", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);
    fireEvent.click(getNodeElement("write-log-1"));

    fireEvent.change(screen.getByRole("textbox", { name: "Step message" }), {
      target: { value: "Deployment finished" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
    const stored: Node<WorkflowNodeRenderData> | undefined = getStoredNodes(
      harness,
    ).find((node: Node<WorkflowNodeRenderData>) => {
      return node.data.id === "write-log-1";
    });
    expect(stored?.data.arguments).toEqual({ message: "Deployment finished" });

    fireEvent.click(getNodeElement("write-log-1"));
    expect(screen.getByRole("textbox", { name: "Step message" })).toHaveValue(
      "Deployment finished",
    );
  });

  test("the settings get the step as it is drawn, and save it without what the canvas added", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);
    fireEvent.click(getNodeElement("write-log-1"));

    const drawn: WorkflowNodeRenderData = getSettingsProps()
      .component as WorkflowNodeRenderData;
    expect(drawn.issueSummary?.missingSettingMessages).toEqual([
      '"Message" is required but empty.',
    ]);

    act(() => {
      getSettingsProps().onSave({
        ...drawn,
        arguments: { message: "Hello" },
      });
    });

    const stored: Node<WorkflowNodeRenderData> | undefined = getStoredNodes(
      harness,
    ).find((node: Node<WorkflowNodeRenderData>) => {
      return node.data.id === "write-log-1";
    });
    expect(stored?.data).not.toHaveProperty("issueSummary");
    expect(stored?.data.error).toBe("");
    expect(stored?.data.arguments).toEqual({ message: "Hello" });
  });

  test("adding the same component twice keeps every identity unique and only the newest selected", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);
    addAction(harness);

    const nodes: Array<Node<WorkflowNodeRenderData>> = getRenderedNodes();
    expect(nodes).toHaveLength(3);
    expect(
      new Set(
        nodes.map((node: Node) => {
          return node.id;
        }),
      ).size,
    ).toBe(3);
    expect(
      new Set(
        nodes.map((node: Node<WorkflowNodeRenderData>) => {
          return node.data.internalId;
        }),
      ).size,
    ).toBe(3);
    expect(findRenderedNode("write-log-1").selected).toBe(false);
    expect(findRenderedNode("manual-trigger-1").selected).toBe(false);
    expect(findRenderedNode("write-log-2").selected).toBe(true);
    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(getNodeElement("write-log-2"));
  });

  test("allocates the next free component id without overwriting an existing step", () => {
    const existing: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    existing.data.arguments = { message: "Keep this message" };
    const harness: BuilderHarness = renderBuilder({
      initialNodes: [makeNode(TRIGGER_METADATA), existing],
    });
    addAction(harness);

    expect(findRenderedNode("write-log-1").data.arguments).toEqual({
      message: "Keep this message",
    });
    expect(findRenderedNode("write-log-2").data.internalId).not.toBe(
      existing.data.internalId,
    );
  });

  test("places successive additions below existing steps instead of stacking them", () => {
    const existing: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    existing.position = { x: 400, y: 900 };
    existing.height = 180;
    const harness: BuilderHarness = renderBuilder({
      initialNodes: [makeNode(TRIGGER_METADATA), existing],
    });
    addAction(harness);
    const first: Node<WorkflowNodeRenderData> = findRenderedNode("write-log-2");
    expect(first.position.y).toBeGreaterThan(1080);

    addAction(harness);
    expect(findRenderedNode("write-log-3").position.y).toBeGreaterThan(
      first.position.y,
    );
  });

  test("adding a step preserves existing connections and does not invent a new one", () => {
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);
    const existing: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    const edge: Edge = {
      id: "existing-connection",
      source: trigger.id,
      target: existing.id,
    };
    const harness: BuilderHarness = renderBuilder({
      initialNodes: [trigger, existing],
      initialEdges: [edge],
    });
    addAction(harness);

    expect(mockFlowProps?.edges).toHaveLength(1);
    expect(mockFlowProps?.edges?.[0]).toEqual(expect.objectContaining(edge));
    expect(harness.onUpdated).toHaveBeenLastCalledWith(expect.any(Array), [
      expect.objectContaining(edge),
    ]);
  });

  test("closing configuration leaves the newly added step available for later editing", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);
    fireEvent.click(getNodeElement("write-log-1"));
    fireEvent.change(screen.getByRole("textbox", { name: "Step message" }), {
      target: { value: "Unsaved draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    const added: Node<WorkflowNodeRenderData> = findRenderedNode("write-log-1");
    expect(added.data.arguments?.["message"]).toBeUndefined();
    fireEvent.click(getNodeElement("write-log-1"));
    expect(screen.getByRole("textbox", { name: "Step message" })).toHaveValue(
      "",
    );
  });
});

describe("Workflow builder: trigger setup and deletion", () => {
  test("the placeholder opens the trigger picker, and the chosen trigger replaces it", () => {
    const placeholder: Node = getPlaceholderTriggerNode();
    const harness: BuilderHarness = renderBuilder({
      initialNodes: [placeholder],
    });
    fireEvent.click(screen.getByTestId(`workflow-node-${placeholder.id}`));

    expect(screen.getByTestId("picker-Trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
    expect(
      screen.queryByText(`Choose ${ACTION_METADATA.title}`),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: `Choose ${TRIGGER_METADATA.title}` }),
    );

    expect(screen.queryByTestId("picker-Trigger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
    expect(getStoredNodes(harness)).toHaveLength(1);
    expect(getRenderedNodes()[0]?.data.nodeType).toBe(NodeType.Node);
    expect(getRenderedNodes()[0]?.data.id).toBe("manual-trigger-1");
  });

  test("replacing a placeholder preserves existing components and selects only the new trigger", () => {
    const placeholder: Node = getPlaceholderTriggerNode();
    const existing: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    existing.selected = true;
    existing.data.arguments = { message: "Existing work" };
    renderBuilder({ initialNodes: [placeholder, existing] });

    fireEvent.click(screen.getByTestId(`workflow-node-${placeholder.id}`));
    fireEvent.click(
      screen.getByRole("button", { name: `Choose ${TRIGGER_METADATA.title}` }),
    );

    expect(getRenderedNodes()).toHaveLength(2);
    expect(findRenderedNode("write-log-1").data.arguments).toEqual({
      message: "Existing work",
    });
    expect(findRenderedNode("write-log-1").selected).toBe(false);
    expect(findRenderedNode("manual-trigger-1").selected).toBe(true);
    expect(
      getRenderedNodes().some((node: Node<WorkflowNodeRenderData>) => {
        return node.data.nodeType === NodeType.PlaceholderNode;
      }),
    ).toBe(false);
    expect(mockFlowProps?.edges).toEqual([]);
    expect(document.activeElement).toBe(getNodeElement("manual-trigger-1"));
  });

  test("deleting a trigger restores a clickable placeholder and removes only its connections", () => {
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);
    const first: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    const second: Node<NodeDataProp> = makeNode(ACTION_METADATA, 2);
    const retained: Edge = {
      id: "between-components",
      source: first.id,
      target: second.id,
    };
    renderBuilder({
      initialNodes: [trigger, first, second],
      initialEdges: [
        { id: "from-trigger", source: trigger.id, target: first.id },
        retained,
      ],
    });

    fireEvent.click(screen.getByTestId(`workflow-node-${trigger.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Delete step" }));

    const placeholder: Node<WorkflowNodeRenderData> | undefined =
      getRenderedNodes().find((node: Node<WorkflowNodeRenderData>) => {
        return node.data.nodeType === NodeType.PlaceholderNode;
      });
    expect(placeholder?.data.onClick).toBeUndefined();
    expect(getRenderedNodes()).toHaveLength(3);
    expect(mockFlowProps?.edges).toEqual([expect.objectContaining(retained)]);
    fireEvent.click(screen.getByTestId(`workflow-node-${placeholder?.id}`));
    expect(screen.getByTestId("picker-Trigger")).toBeInTheDocument();
  });

  test("deleting an ordinary component keeps its trigger and other nodes interactive", () => {
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    renderBuilder({ initialNodes: [trigger, action] });

    fireEvent.click(screen.getByTestId(`workflow-node-${action.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Delete step" }));

    expect(getRenderedNodes()).toHaveLength(1);
    expect(getRenderedNodes()[0]?.data.nodeType).toBe(NodeType.Node);
    fireEvent.click(screen.getByTestId(`workflow-node-${trigger.id}`));
    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "manual-trigger-1",
    );
  });

  test("deleting a component before a trigger is configured keeps exactly one usable placeholder", () => {
    const placeholder: Node = getPlaceholderTriggerNode();
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    const other: Node<NodeDataProp> = makeNode(ACTION_METADATA, 2);
    renderBuilder({ initialNodes: [placeholder, action, other] });
    fireEvent.click(screen.getByTestId(`workflow-node-${action.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Delete step" }));

    const placeholders: Array<Node<WorkflowNodeRenderData>> =
      getRenderedNodes().filter((node: Node<WorkflowNodeRenderData>) => {
        return node.data.nodeType === NodeType.PlaceholderNode;
      });
    expect(placeholders).toHaveLength(1);
    expect(getRenderedNodes()).toHaveLength(2);
    expect(placeholders[0]?.id).toBe(placeholder.id);
    fireEvent.click(screen.getByTestId(`workflow-node-${placeholder.id}`));
    expect(screen.getByTestId("picker-Trigger")).toBeInTheDocument();
  });
});

describe("Workflow builder: rendering and persistence boundaries", () => {
  test("existing nodes open settings without mutating the initial graph to attach callbacks", () => {
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    const originalData: NodeDataProp = action.data;
    const original: string = JSON.stringify(action);
    renderBuilder({ initialNodes: [action] });

    expect(action.data).toBe(originalData);
    expect(action.data.onClick).toBeUndefined();
    expect(JSON.stringify(action)).toBe(original);
    expect(findRenderedNode("write-log-1").data.onClick).toBeUndefined();
    fireEvent.click(screen.getByTestId(`workflow-node-${action.id}`));
    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "write-log-1",
    );
  });

  test("lint messages remain render-only and click callbacks are never sent for persistence", () => {
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    const harness: BuilderHarness = renderBuilder({
      initialNodes: [trigger, action],
      initialEdges: [
        { id: "connected", source: trigger.id, target: action.id },
      ],
    });

    expect(findRenderedNode("write-log-1").data.error).toContain("Message");
    expect(
      findRenderedNode("write-log-1").data.issueSummary?.missingSettingMessages,
    ).toEqual(['"Message" is required but empty.']);
    for (const node of getStoredNodes(harness)) {
      expect(node.data.error).toBe("");
      expect(node.data.onClick).toBeUndefined();
      expect(node.data.issueSummary).toBeUndefined();
    }
    expect(harness.onLint).toHaveBeenLastCalledWith(
      expect.objectContaining({ errorCount: 1 }),
    );

    fireEvent.click(screen.getByTestId(`workflow-node-${action.id}`));
    fireEvent.change(screen.getByRole("textbox", { name: "Step message" }), {
      target: { value: "Configured" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(findRenderedNode("write-log-1").data.error).toBe("");
    expect(findRenderedNode("write-log-1").data.issueSummary).toBeUndefined();
    expect(harness.onLint).toHaveBeenLastCalledWith(
      expect.objectContaining({ errorCount: 0 }),
    );
    for (const node of getStoredNodes(harness)) {
      expect(node.data.error).toBe("");
      expect(node.data.onClick).toBeUndefined();
      expect(node.data).not.toHaveProperty("issueSummary");
    }
  });

  test("a step the checks have nothing to say about is handed to the canvas untouched", () => {
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    action.data.arguments = { message: "Configured" };
    renderBuilder({
      initialNodes: [trigger, action],
      initialEdges: [
        { id: "connected", source: trigger.id, target: action.id },
      ],
    });

    // Same object, so react-flow can skip redrawing it.
    expect(findRenderedNode("write-log-1").data).toBe(action.data);
    expect(findRenderedNode("manual-trigger-1").data).toBe(trigger.data);
  });

  test("editing an existing step does not modify the node objects supplied by its caller", () => {
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    action.data.arguments = { message: "Original" };
    renderBuilder({ initialNodes: [action] });
    fireEvent.click(screen.getByTestId(`workflow-node-${action.id}`));
    fireEvent.change(screen.getByRole("textbox", { name: "Step message" }), {
      target: { value: "Changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(action.data.arguments).toEqual({ message: "Original" });
    expect(findRenderedNode("write-log-1").data.arguments).toEqual({
      message: "Changed",
    });
  });

  test("renaming a step updates its existing node by internal identity and keeps it clickable", () => {
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    const harness: BuilderHarness = renderBuilder({ initialNodes: [action] });
    fireEvent.click(screen.getByTestId(`workflow-node-${action.id}`));
    act(() => {
      const settings: SettingsProps = getSettingsProps();
      settings.onSave({ ...settings.component, id: "deployment-log" });
    });

    expect(getStoredNodes(harness)).toHaveLength(1);
    const renamed: Node<WorkflowNodeRenderData> =
      findRenderedNode("deployment-log");
    expect(renamed.id).toBe(action.id);
    expect(renamed.data.internalId).toBe(action.data.internalId);
    fireEvent.click(screen.getByTestId(`workflow-node-${renamed.id}`));
    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "deployment-log",
    );
  });

  test("the webhook secret key, whether it may be seen, and its reset reach a step's settings", () => {
    /*
     * The Webhook trigger's settings show, copy and reset the URL built from
     * the key. The canvas only carries what the builder page loaded and how
     * it saves a new key; it decides nothing about either.
     */
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);
    const onResetWebhookSecretKey: MockFunction = getJestMockFunction();

    renderBuilder({
      initialNodes: [trigger],
      webhookSecretKey: "secret-1",
      canSeeWebhookSecretKey: true,
      onResetWebhookSecretKey: onResetWebhookSecretKey,
    });
    fireEvent.click(screen.getByTestId(`workflow-node-${trigger.id}`));

    expect(getSettingsProps().webhookSecretKey).toBe("secret-1");
    expect(getSettingsProps().canSeeWebhookSecretKey).toBe(true);
    expect(getSettingsProps().onResetWebhookSecretKey).toBe(
      onResetWebhookSecretKey,
    );
  });

  test("a key reset while a step's settings are open reaches them without reopening", () => {
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);
    const harness: BuilderHarness = renderBuilder({
      initialNodes: [trigger],
      webhookSecretKey: "secret-1",
      canSeeWebhookSecretKey: true,
    });

    fireEvent.click(screen.getByTestId(`workflow-node-${trigger.id}`));

    harness.view.rerender(
      <Workflow {...harness.props} webhookSecretKey="secret-2" />,
    );

    expect(screen.getByTestId("step-settings")).toBeInTheDocument();
    expect(getSettingsProps().webhookSecretKey).toBe("secret-2");
  });

  test("a builder that could not read the key says so to the settings", () => {
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);

    renderBuilder({
      initialNodes: [trigger],
      webhookSecretKey: "",
      canSeeWebhookSecretKey: false,
    });
    fireEvent.click(screen.getByTestId(`workflow-node-${trigger.id}`));

    expect(getSettingsProps().canSeeWebhookSecretKey).toBe(false);
    expect(getSettingsProps().webhookSecretKey).toBe("");
  });

  test("the settings value picker receives only real graph steps", () => {
    const placeholder: Node = getPlaceholderTriggerNode();
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    renderBuilder({ initialNodes: [placeholder, action] });
    fireEvent.click(screen.getByTestId(`workflow-node-${action.id}`));

    expect(getSettingsProps().graphComponents).toHaveLength(1);
    expect(getSettingsProps().graphComponents[0]?.id).toBe("write-log-1");
  });

  test("an issue-panel request opens the matching step and acknowledges missing steps", () => {
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    const onStepOpened: MockFunction = getJestMockFunction();
    const harness: BuilderHarness = renderBuilder({
      initialNodes: [action],
      openStepForNodeId: action.id,
      onStepOpened: onStepOpened,
    });

    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "write-log-1",
    );
    expect(onStepOpened).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    harness.view.rerender(
      <Workflow {...harness.props} openStepForNodeId="removed-node" />,
    );

    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
    expect(onStepOpened).toHaveBeenCalledTimes(2);
  });

  test("dragging a step through ReactFlow updates its saved position and preserves edit access", () => {
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    const harness: BuilderHarness = renderBuilder({ initialNodes: [action] });
    act(() => {
      mockFlowProps?.onNodesChange?.([
        {
          id: action.id,
          type: "position",
          position: { x: 720, y: 480 },
          dragging: false,
        },
      ]);
    });

    expect(getStoredNodes(harness)[0]?.position).toEqual({ x: 720, y: 480 });
    fireEvent.click(screen.getByTestId(`workflow-node-${action.id}`));
    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "write-log-1",
    );
  });
});

describe("Workflow builder: running and modal state", () => {
  test.each(["component picker", "trigger picker", "settings", "run"])(
    "%s suspends canvas keyboard shortcuts until it closes",
    (modal: string) => {
      const placeholder: Node = getPlaceholderTriggerNode();
      const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
      const harness: BuilderHarness = renderBuilder({
        initialNodes: [placeholder, action],
      });

      expect(mockFlowProps).toEqual(
        expect.objectContaining({
          panActivationKeyCode: "Space",
          deleteKeyCode: "Backspace",
          selectionKeyCode: "Shift",
        }),
      );

      let closeButton: string = "Close picker";

      if (modal === "component picker") {
        openPicker(harness);
      } else if (modal === "trigger picker") {
        fireEvent.click(screen.getByTestId(`workflow-node-${placeholder.id}`));
      } else if (modal === "settings") {
        closeButton = "Close settings";
        fireEvent.click(screen.getByTestId(`workflow-node-${action.id}`));
      } else {
        closeButton = "Close run";
        harness.view.rerender(
          <Workflow {...harness.props} showRunModal={true} />,
        );
      }

      expect(mockFlowProps).toEqual(
        expect.objectContaining({
          panActivationKeyCode: null,
          deleteKeyCode: null,
          selectionKeyCode: null,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: closeButton }));
      expect(mockFlowProps).toEqual(
        expect.objectContaining({
          panActivationKeyCode: "Space",
          deleteKeyCode: "Backspace",
          selectionKeyCode: "Shift",
        }),
      );
      expect(getStoredNodes(harness)).toHaveLength(2);
    },
  );

  test("right after a step is added the canvas shortcuts are live, since no dialog is open", () => {
    const harness: BuilderHarness = renderBuilder();
    addAction(harness);

    expect(mockFlowProps).toEqual(
      expect.objectContaining({
        panActivationKeyCode: "Space",
        deleteKeyCode: "Backspace",
        selectionKeyCode: "Shift",
      }),
    );
  });

  test("turning the external run flag off closes the run modal without closing the component picker", () => {
    const harness: BuilderHarness = renderBuilder({
      showRunModal: true,
      showComponentsPickerModal: true,
    });
    expect(screen.getByTestId("run-workflow-modal")).toBeInTheDocument();
    expect(screen.getByTestId("picker-Component")).toBeInTheDocument();
    harness.view.rerender(<Workflow {...harness.props} showRunModal={false} />);

    expect(screen.queryByTestId("run-workflow-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("picker-Component")).toBeInTheDocument();
    expect(harness.onRunUpdate).toHaveBeenLastCalledWith(false);
  });

  test("an initially closed run modal does not suppress an explicitly opened component picker", () => {
    renderBuilder({ showRunModal: false, showComponentsPickerModal: true });
    expect(screen.getByTestId("picker-Component")).toBeInTheDocument();
    expect(screen.queryByTestId("run-workflow-modal")).not.toBeInTheDocument();
  });

  test("the run modal receives the actual trigger and forwards the run request", () => {
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);
    const harness: BuilderHarness = renderBuilder({
      initialNodes: [makeNode(ACTION_METADATA), trigger],
      showRunModal: true,
    });

    expect(screen.getByTestId("run-trigger-id")).toHaveTextContent(
      "manual-trigger-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm run" }));
    expect(harness.onRun).toHaveBeenCalledWith(
      expect.objectContaining({ internalId: trigger.data.internalId }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close run" }));
    expect(screen.queryByTestId("run-workflow-modal")).not.toBeInTheDocument();
    expect(harness.onRunUpdate).toHaveBeenLastCalledWith(false);
  });

  test("only action settings offer running a single step", () => {
    const trigger: Node<NodeDataProp> = makeNode(TRIGGER_METADATA);
    const action: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    const onRunStep: MockFunction = getJestMockFunction();
    renderBuilder({ initialNodes: [trigger, action], onRunStep: onRunStep });
    fireEvent.click(screen.getByTestId(`workflow-node-${trigger.id}`));
    expect(
      screen.queryByRole("button", { name: "Run this step" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    fireEvent.click(screen.getByTestId(`workflow-node-${action.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Run this step" }));

    expect(onRunStep).toHaveBeenCalledWith(
      expect.objectContaining({ internalId: action.data.internalId }),
    );
  });

  test("closing the picker reports its state without changing the graph", () => {
    const harness: BuilderHarness = renderBuilder();
    const initialNodes: Array<Node<WorkflowNodeRenderData>> =
      getStoredNodes(harness);
    openPicker(harness);
    fireEvent.click(screen.getByRole("button", { name: "Close picker" }));

    expect(harness.onPickerUpdate).toHaveBeenLastCalledWith(false);
    expect(getStoredNodes(harness)).toEqual(initialNodes);
    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
  });
});
