/*
 * The builder canvas with a Switch / Case step, through the builder's own
 * wiring: React Flow's real state hooks and graph helpers, with only its
 * browser renderer and the settings dialog stood in for (as in
 * Workflow.test.tsx).
 *
 * What the canvas does for a step whose outputs come from its settings:
 *   - a new Switch / Case starts with two cases, so it has outputs to
 *     connect before it is opened;
 *   - its settings are told what each output leads to;
 *   - saving its settings drops the connections of the cases taken out -
 *     and only those - so no connection is left leading from an output that
 *     is gone; a case renamed or moved keeps its connection;
 *   - and the canvas's checks see its cases and their connections.
 */

let mockFlowProps: ReactFlowProps | null = null;
let mockSettingsProps: SettingsProps | null = null;
let mockPickerProps: PickerProps | null = null;

jest.mock("reactflow", () => {
  const actual: typeof import("reactflow") = jest.requireActual(
    "reactflow",
  ) as typeof import("reactflow");

  return {
    ...actual,
    __esModule: true,
    default: (props: ReactFlowProps): ReactElement => {
      mockFlowProps = props;

      return (
        <div data-testid="workflow-canvas">
          {(props.nodes || []).map((node: Node): ReactElement => {
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
                {(node.data as NodeDataProp).id || "Add trigger"}
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

jest.mock("../../../../../UI/Components/Workflow/Component", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("../../../../../UI/Components/Workflow/Utils", () => {
  const RealComponents: Array<ComponentMetadata> = jest.requireActual(
    "../../../../../Types/Workflow/Components",
  ).default;

  return {
    loadComponentsAndCategories: () => {
      return {
        components: RealComponents,
        categories: [],
      };
    },
  };
});

jest.mock("../../../../../UI/Components/Workflow/ComponentsModal", () => {
  return {
    __esModule: true,
    default: (props: PickerProps): ReactElement => {
      mockPickerProps = props;

      return <div data-testid={`picker-${props.componentsType}`} />;
    },
  };
});

/*
 * The settings dialog, reduced to what these tests do with a step: change
 * its cases one way or another and save, or save it unchanged.
 */
jest.mock(
  "../../../../../UI/Components/Workflow/ComponentSettingsModal",
  () => {
    return {
      __esModule: true,
      default: (props: SettingsProps): ReactElement => {
        mockSettingsProps = props;

        type SaveWithCasesFunction = (
          change: (cases: Array<JSONObject>) => Array<JSONObject>,
        ) => void;

        const saveWithCases: SaveWithCasesFunction = (
          change: (cases: Array<JSONObject>) => Array<JSONObject>,
        ): void => {
          const cases: Array<JSONObject> = (props.component.arguments?.[
            "cases"
          ] || []) as Array<JSONObject>;

          props.onSave({
            ...props.component,
            arguments: {
              ...props.component.arguments,
              cases: change(
                cases.map((one: JSONObject) => {
                  return { ...one };
                }),
              ),
            },
          });
        };

        return (
          <div data-testid="step-settings">
            <button
              type="button"
              onClick={() => {
                saveWithCases((cases: Array<JSONObject>) => {
                  return cases.filter((one: JSONObject): boolean => {
                    return one["id"] !== "case-2";
                  });
                });
              }}
            >
              Remove case 2 and save
            </button>
            <button
              type="button"
              onClick={() => {
                saveWithCases((cases: Array<JSONObject>) => {
                  return cases.map((one: JSONObject): JSONObject => {
                    return one["id"] === "case-1"
                      ? { ...one, value: "Renamed" }
                      : one;
                  });
                });
              }}
            >
              Rename case 1 and save
            </button>
            <button
              type="button"
              onClick={() => {
                saveWithCases((cases: Array<JSONObject>) => {
                  return [...cases].reverse();
                });
              }}
            >
              Reverse the cases and save
            </button>
            <button
              type="button"
              onClick={() => {
                saveWithCases(() => {
                  return [];
                });
              }}
            >
              Remove every case and save
            </button>
            <button
              type="button"
              onClick={() => {
                props.onSave(props.component);
              }}
            >
              Save unchanged
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock("../../../../../UI/Components/Workflow/RunModal", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import Workflow, {
  ComponentProps as WorkflowProps,
} from "../../../../../UI/Components/Workflow/Workflow";
import { ComponentProps as PickerProps } from "../../../../../UI/Components/Workflow/ComponentsModal";
import { ComponentProps as SettingsProps } from "../../../../../UI/Components/Workflow/ComponentSettingsModal";
import {
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
} from "../../../../../UI/Components/Workflow/GraphLint";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import {
  getStarterSwitchCases,
  readSwitchCases,
  toStoredSwitchCases,
} from "../../../../../Types/Workflow/Components/SwitchCases";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement } from "react";
import { Edge, Node, ReactFlowProps } from "reactflow";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

type MetadataFunction = (id: ComponentID) => ComponentMetadata;

const metadataOf: MetadataFunction = (id: ComponentID): ComponentMetadata => {
  return Components.find((component: ComponentMetadata) => {
    return component.id === id;
  }) as ComponentMetadata;
};

type StepFunction = (
  id: ComponentID,
  componentId: string,
  args?: JSONObject,
) => Node<NodeDataProp>;

const step: StepFunction = (
  id: ComponentID,
  componentId: string,
  args: JSONObject = {},
): Node<NodeDataProp> => {
  const metadata: ComponentMetadata = metadataOf(id);

  return {
    id: `canvas-${componentId}`,
    type: "node",
    position: { x: 100, y: 100 },
    data: {
      id: componentId,
      internalId: `runner-${componentId}`,
      nodeType: NodeType.Node,
      componentType: metadata.componentType,
      metadataId: metadata.id,
      metadata: metadata,
      error: "",
      arguments: args,
      returnValues: {},
    },
  };
};

type EdgeFunction = (from: string, handle: string, to: string) => Edge;

const edge: EdgeFunction = (from: string, handle: string, to: string): Edge => {
  return {
    id: `${from}-${handle}-${to}`,
    source: `canvas-${from}`,
    sourceHandle: handle,
    target: `canvas-${to}`,
    targetHandle: "in",
  };
};

const SWITCH_ARGS: JSONObject = {
  value: "{{local.components.manual-1.returnValues.value}}",
  cases: [
    { id: "case-1", comparison: "==", value: "a", compareAs: "text" },
    { id: "case-2", comparison: "==", value: "b", compareAs: "text" },
  ],
};

const NODES: Array<Node<NodeDataProp>> = [
  step(ComponentID.Manual, "manual-1"),
  step(ComponentID.Switch, "switch-1", SWITCH_ARGS),
  step(ComponentID.Log, "log-a", { value: "a" }),
  step(ComponentID.Log, "log-b", { value: "b" }),
  step(ComponentID.Log, "log-other", { value: "other" }),
  step(ComponentID.Log, "log-after", { value: "after" }),
];

const EDGES: Array<Edge> = [
  edge("manual-1", "success", "switch-1"),
  edge("switch-1", "case-1", "log-a"),
  edge("switch-1", "case-2", "log-b"),
  edge("switch-1", "default", "log-other"),
  edge("log-b", "out", "log-after"),
];

interface Harness {
  onUpdated: MockFunction;
  onLint: MockFunction;
}

type RenderFunction = (overrides?: Partial<WorkflowProps>) => Harness;

const renderBuilder: RenderFunction = (
  overrides: Partial<WorkflowProps> = {},
): Harness => {
  const onUpdated: MockFunction = getJestMockFunction();
  const onLint: MockFunction = getJestMockFunction();

  render(
    <Workflow
      initialNodes={NODES.map((node: Node<NodeDataProp>) => {
        return { ...node, data: { ...node.data } };
      })}
      initialEdges={EDGES.map((one: Edge) => {
        return { ...one };
      })}
      workflowId={new ObjectID("11111111-1111-4111-8111-111111111111")}
      showComponentsPickerModal={false}
      showRunModal={false}
      onWorkflowUpdated={onUpdated}
      onComponentPickerModalUpdate={() => {}}
      onRunModalUpdate={() => {}}
      onRun={() => {}}
      onLintResultChange={onLint}
      {...overrides}
    />,
  );

  return { onUpdated: onUpdated, onLint: onLint };
};

type LastFunction<T> = (harness: Harness) => T;

const lastEdges: LastFunction<Array<Edge>> = (
  harness: Harness,
): Array<Edge> => {
  const calls: Array<Array<unknown>> = harness.onUpdated.mock.calls;
  return calls[calls.length - 1]?.[1] as Array<Edge>;
};

const lastNodes: LastFunction<Array<Node<NodeDataProp>>> = (
  harness: Harness,
): Array<Node<NodeDataProp>> => {
  const calls: Array<Array<unknown>> = harness.onUpdated.mock.calls;
  return calls[calls.length - 1]?.[0] as Array<Node<NodeDataProp>>;
};

const lastLint: LastFunction<WorkflowLintResult> = (
  harness: Harness,
): WorkflowLintResult => {
  const calls: Array<Array<unknown>> = harness.onLint.mock.calls;
  return calls[calls.length - 1]?.[0] as WorkflowLintResult;
};

type EdgeNamesFunction = (edges: Array<Edge>) => Array<string>;

const edgeNames: EdgeNamesFunction = (edges: Array<Edge>): Array<string> => {
  return edges.map((one: Edge): string => {
    return one.id;
  });
};

type OpenStepFunction = (componentId: string) => void;

const openStep: OpenStepFunction = (componentId: string): void => {
  fireEvent.click(screen.getByTestId(`workflow-node-canvas-${componentId}`));
};

beforeEach(() => {
  mockFlowProps = null;
  mockSettingsProps = null;
  mockPickerProps = null;
});

afterEach(() => {
  cleanup();
});

describe("saving a Switch / Case's settings", () => {
  test("drops the connection of a case taken out, and only that one", () => {
    const harness: Harness = renderBuilder();

    openStep("switch-1");
    fireEvent.click(screen.getByText("Remove case 2 and save"));

    expect(edgeNames(lastEdges(harness))).toEqual([
      "manual-1-success-switch-1",
      "switch-1-case-1-log-a",
      "switch-1-default-log-other",
      // Another step's connection, beyond the dropped one, is kept.
      "log-b-out-log-after",
    ]);
    expect(
      readSwitchCases(
        lastNodes(harness).find((node: Node<NodeDataProp>) => {
          return node.data.id === "switch-1";
        })?.data.arguments["cases"],
      ).map((one: { id: string }): string => {
        return one.id;
      }),
    ).toEqual(["case-1"]);
  });

  test("keeps a renamed case's connection: its output is the same", () => {
    const harness: Harness = renderBuilder();

    openStep("switch-1");
    fireEvent.click(screen.getByText("Rename case 1 and save"));

    expect(edgeNames(lastEdges(harness))).toEqual(edgeNames(EDGES));
  });

  test("keeps every connection when the cases are only moved", () => {
    const harness: Harness = renderBuilder();

    openStep("switch-1");
    fireEvent.click(screen.getByText("Reverse the cases and save"));

    expect(edgeNames(lastEdges(harness))).toEqual(edgeNames(EDGES));
  });

  test("with every case taken out, keeps Default's connection alone", () => {
    const harness: Harness = renderBuilder();

    openStep("switch-1");
    fireEvent.click(screen.getByText("Remove every case and save"));

    expect(edgeNames(lastEdges(harness))).toEqual([
      "manual-1-success-switch-1",
      "switch-1-default-log-other",
      "log-b-out-log-after",
    ]);
  });

  test("saved unchanged, nothing is dropped", () => {
    const harness: Harness = renderBuilder();

    openStep("switch-1");
    fireEvent.click(screen.getByText("Save unchanged"));

    expect(edgeNames(lastEdges(harness))).toEqual(edgeNames(EDGES));
  });

  test("another step's settings never drop a connection, even one from an output it lacks", () => {
    const harness: Harness = renderBuilder({
      initialEdges: [
        ...EDGES,
        // A connection from an output a Log does not have.
        edge("log-a", "nowhere", "log-other"),
      ],
    });

    openStep("log-a");
    fireEvent.click(screen.getByText("Save unchanged"));

    expect(edgeNames(lastEdges(harness))).toContain("log-a-nowhere-log-other");
  });
});

describe("what a Switch / Case's settings are told", () => {
  test("where each of its outputs leads, as the canvas is now", () => {
    renderBuilder();

    openStep("switch-1");

    expect(mockSettingsProps?.outputConnections).toEqual({
      "case-1": [{ componentId: "log-a", title: "Log" }],
      "case-2": [{ componentId: "log-b", title: "Log" }],
      default: [{ componentId: "log-other", title: "Log" }],
    });
  });

  test("another step is told where its own outputs lead", () => {
    renderBuilder();

    openStep("log-b");

    expect(mockSettingsProps?.outputConnections).toEqual({
      out: [{ componentId: "log-after", title: "Log" }],
    });
  });
});

describe("a new Switch / Case", () => {
  test("starts with two cases, so its outputs are there to connect", () => {
    const harness: Harness = renderBuilder({
      initialNodes: [step(ComponentID.Manual, "manual-1")],
      initialEdges: [],
      showComponentsPickerModal: true,
    });

    expect(mockPickerProps).not.toBeNull();

    act(() => {
      mockPickerProps?.onComponentClick(metadataOf(ComponentID.Switch));
    });

    const added: Node<NodeDataProp> | undefined = lastNodes(harness).find(
      (node: Node<NodeDataProp>) => {
        return node.data.metadataId === ComponentID.Switch;
      },
    );

    expect(added?.data.id).toBe("switch-1");
    expect(readSwitchCases(added?.data.arguments["cases"])).toEqual(
      getStarterSwitchCases(),
    );
    expect(added?.data.arguments["cases"]).toEqual(
      toStoredSwitchCases(getStarterSwitchCases()),
    );
  });

  test("any other new step starts with no settings, as before", () => {
    const harness: Harness = renderBuilder({
      initialNodes: [step(ComponentID.Manual, "manual-1")],
      initialEdges: [],
      showComponentsPickerModal: true,
    });

    act(() => {
      mockPickerProps?.onComponentClick(metadataOf(ComponentID.Log));
    });

    const added: Node<NodeDataProp> | undefined = lastNodes(harness).find(
      (node: Node<NodeDataProp>) => {
        return node.data.metadataId === ComponentID.Log;
      },
    );

    expect(added?.data.arguments).toBeUndefined();
  });
});

describe("the canvas's checks", () => {
  test("see a Switch / Case's cases and which of them are connected", () => {
    const harness: Harness = renderBuilder({
      initialEdges: EDGES.filter((one: Edge): boolean => {
        return one.sourceHandle !== "case-2";
      }),
    });

    const rules: Array<WorkflowLintRule> = lastLint(harness)
      .issues.filter((issue: WorkflowLintIssue): boolean => {
        return issue.componentId === "switch-1";
      })
      .map((issue: WorkflowLintIssue): WorkflowLintRule => {
        return issue.rule;
      });

    expect(rules).toEqual([WorkflowLintRule.SwitchCaseNotConnected]);
  });

  test("have nothing to say about a Switch / Case set up and connected", () => {
    const harness: Harness = renderBuilder();

    expect(
      lastLint(harness).issues.filter((issue: WorkflowLintIssue): boolean => {
        return issue.componentId === "switch-1";
      }),
    ).toEqual([]);
    expect(mockFlowProps).not.toBeNull();
  });
});
