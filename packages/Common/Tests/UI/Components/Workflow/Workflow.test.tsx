import Workflow, {
  ComponentProps as WorkflowProps,
  getPlaceholderTriggerNode,
} from "../../../../UI/Components/Workflow/Workflow";
import { ComponentProps as PickerProps } from "../../../../UI/Components/Workflow/ComponentsModal";
import { ComponentProps as SettingsProps } from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import { ComponentProps as RunProps } from "../../../../UI/Components/Workflow/RunModal";
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
 */
let mockFlowProps: ReactFlowProps | null = null;
let mockSettingsProps: SettingsProps | null = null;
const mockSetCenter: MockFunction = getJestMockFunction();
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
          getZoom: mockGetZoom,
        } as unknown as ReactFlowInstance);
      }, []);

      return (
        <div data-testid="workflow-canvas">
          {(props.nodes || []).map((node: Node): ReactElement => {
            const data: NodeDataProp = node.data as NodeDataProp;

            return (
              <button
                type="button"
                key={node.id}
                data-testid={`workflow-node-${node.id}`}
                onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                  props.onNodeClick?.(event, node);
                }}
              >
                {data.id || "Add trigger"}
              </button>
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

type GetRenderedNodesFunction = () => Array<Node<NodeDataProp>>;

const getRenderedNodes: GetRenderedNodesFunction = (): Array<
  Node<NodeDataProp>
> => {
  return (mockFlowProps?.nodes || []) as Array<Node<NodeDataProp>>;
};

type GetStoredNodesFunction = (
  harness: BuilderHarness,
) => Array<Node<NodeDataProp>>;

const getStoredNodes: GetStoredNodesFunction = (
  harness: BuilderHarness,
): Array<Node<NodeDataProp>> => {
  const calls: Array<Array<unknown>> = harness.onUpdated.mock.calls;
  return calls[calls.length - 1]?.[0] as Array<Node<NodeDataProp>>;
};

type FindRenderedNodeFunction = (componentId: string) => Node<NodeDataProp>;

const findRenderedNode: FindRenderedNodeFunction = (
  componentId: string,
): Node<NodeDataProp> => {
  const node: Node<NodeDataProp> | undefined = getRenderedNodes().find(
    (candidate: Node<NodeDataProp>) => {
      return candidate.data.id === componentId;
    },
  );

  if (!node) {
    throw new Error(`Expected ${componentId} on the workflow canvas.`);
  }

  return node;
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

beforeEach(() => {
  mockFlowProps = null;
  mockSettingsProps = null;
  mockSetCenter.mockReset();
  mockSetCenter.mockResolvedValue(true);
  mockGetZoom.mockReset();
  mockGetZoom.mockReturnValue(1);
});

afterEach(() => {
  cleanup();
});

describe("Workflow builder: adding and configuring steps", () => {
  test("opens settings immediately after choosing a component and closes the picker", () => {
    const harness: BuilderHarness = renderBuilder();
    openPicker(harness);
    chooseAction();

    expect(screen.queryByTestId("picker-Component")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "write-log-1",
    );
    expect(harness.onPickerUpdate).toHaveBeenLastCalledWith(false);
    expect(getRenderedNodes()).toHaveLength(2);
    expect(findRenderedNode("write-log-1").selected).toBe(true);
    expect(getSettingsProps().workflowId).toEqual(harness.props.workflowId);
  });

  test("a newly added component can be reopened after its settings are closed", () => {
    const harness: BuilderHarness = renderBuilder();
    openPicker(harness);
    chooseAction();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    const added: Node<NodeDataProp> = findRenderedNode("write-log-1");
    expect(added.data.onClick).toBeUndefined();
    fireEvent.click(screen.getByTestId(`workflow-node-${added.id}`));

    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "write-log-1",
    );
  });

  test("brings an added step into view after the canvas has initialized", () => {
    const harness: BuilderHarness = renderBuilder();
    expect(mockSetCenter).not.toHaveBeenCalled();
    openPicker(harness);
    chooseAction();

    const added: Node<NodeDataProp> = findRenderedNode("write-log-1");
    expect(mockSetCenter).toHaveBeenCalledTimes(1);
    const call: Array<unknown> = mockSetCenter.mock.calls[0] as Array<unknown>;
    expect(call[0]).toBeGreaterThan(added.position.x);
    expect(call[1]).toBeGreaterThan(added.position.y);
    expect(call[2]).toEqual(expect.objectContaining({ zoom: 1 }));
  });

  test("saving arguments updates the graph and reopening shows the saved values", () => {
    const harness: BuilderHarness = renderBuilder();
    openPicker(harness);
    chooseAction();

    fireEvent.change(screen.getByRole("textbox", { name: "Step message" }), {
      target: { value: "Deployment finished" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
    const stored: Node<NodeDataProp> | undefined = getStoredNodes(harness).find(
      (node: Node<NodeDataProp>) => {
        return node.data.id === "write-log-1";
      },
    );
    expect(stored?.data.arguments).toEqual({ message: "Deployment finished" });

    const added: Node<NodeDataProp> = findRenderedNode("write-log-1");
    fireEvent.click(screen.getByTestId(`workflow-node-${added.id}`));
    expect(screen.getByRole("textbox", { name: "Step message" })).toHaveValue(
      "Deployment finished",
    );
  });

  test("adding the same component twice keeps every identity unique and only the newest selected", () => {
    const harness: BuilderHarness = renderBuilder();
    openPicker(harness);
    chooseAction();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    openPicker(harness);
    chooseAction();

    const nodes: Array<Node<NodeDataProp>> = getRenderedNodes();
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
        nodes.map((node: Node<NodeDataProp>) => {
          return node.data.internalId;
        }),
      ).size,
    ).toBe(3);
    expect(findRenderedNode("write-log-1").selected).toBe(false);
    expect(findRenderedNode("manual-trigger-1").selected).toBe(false);
    expect(findRenderedNode("write-log-2").selected).toBe(true);
    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "write-log-2",
    );
  });

  test("allocates the next free component id without overwriting an existing step", () => {
    const existing: Node<NodeDataProp> = makeNode(ACTION_METADATA);
    existing.data.arguments = { message: "Keep this message" };
    const harness: BuilderHarness = renderBuilder({
      initialNodes: [makeNode(TRIGGER_METADATA), existing],
    });
    openPicker(harness);
    chooseAction();

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
    openPicker(harness);
    chooseAction();
    const first: Node<NodeDataProp> = findRenderedNode("write-log-2");
    expect(first.position.y).toBeGreaterThan(1080);

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    openPicker(harness);
    chooseAction();
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
    openPicker(harness);
    chooseAction();

    expect(mockFlowProps?.edges).toHaveLength(1);
    expect(mockFlowProps?.edges?.[0]).toEqual(expect.objectContaining(edge));
    expect(harness.onUpdated).toHaveBeenLastCalledWith(expect.any(Array), [
      expect.objectContaining(edge),
    ]);
  });

  test("closing configuration leaves the newly added step available for later editing", () => {
    const harness: BuilderHarness = renderBuilder();
    openPicker(harness);
    chooseAction();
    fireEvent.change(screen.getByRole("textbox", { name: "Step message" }), {
      target: { value: "Unsaved draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    const added: Node<NodeDataProp> = findRenderedNode("write-log-1");
    expect(added.data.arguments?.["message"]).toBeUndefined();
    fireEvent.click(screen.getByTestId(`workflow-node-${added.id}`));
    expect(screen.getByRole("textbox", { name: "Step message" })).toHaveValue(
      "",
    );
  });
});

describe("Workflow builder: trigger setup and deletion", () => {
  test("the placeholder opens the trigger picker, and the chosen trigger opens settings", () => {
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
    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "manual-trigger-1",
    );
    expect(getStoredNodes(harness)).toHaveLength(1);
    expect(getRenderedNodes()[0]?.data.nodeType).toBe(NodeType.Node);
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
      getRenderedNodes().some((node: Node<NodeDataProp>) => {
        return node.data.nodeType === NodeType.PlaceholderNode;
      }),
    ).toBe(false);
    expect(mockFlowProps?.edges).toEqual([]);
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

    const placeholder: Node<NodeDataProp> | undefined = getRenderedNodes().find(
      (node: Node<NodeDataProp>) => {
        return node.data.nodeType === NodeType.PlaceholderNode;
      },
    );
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

    const placeholders: Array<Node<NodeDataProp>> = getRenderedNodes().filter(
      (node: Node<NodeDataProp>) => {
        return node.data.nodeType === NodeType.PlaceholderNode;
      },
    );
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
    for (const node of getStoredNodes(harness)) {
      expect(node.data.error).toBe("");
      expect(node.data.onClick).toBeUndefined();
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
    expect(harness.onLint).toHaveBeenLastCalledWith(
      expect.objectContaining({ errorCount: 0 }),
    );
    for (const node of getStoredNodes(harness)) {
      expect(node.data.error).toBe("");
      expect(node.data.onClick).toBeUndefined();
    }
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
    const renamed: Node<NodeDataProp> = findRenderedNode("deployment-log");
    expect(renamed.id).toBe(action.id);
    expect(renamed.data.internalId).toBe(action.data.internalId);
    fireEvent.click(screen.getByTestId(`workflow-node-${renamed.id}`));
    expect(screen.getByTestId("settings-step-id")).toHaveTextContent(
      "deployment-log",
    );
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
    const initialNodes: Array<Node<NodeDataProp>> = getStoredNodes(harness);
    openPicker(harness);
    fireEvent.click(screen.getByRole("button", { name: "Close picker" }));

    expect(harness.onPickerUpdate).toHaveBeenLastCalledWith(false);
    expect(getStoredNodes(harness)).toEqual(initialNodes);
    expect(screen.queryByTestId("step-settings")).not.toBeInTheDocument();
  });
});
