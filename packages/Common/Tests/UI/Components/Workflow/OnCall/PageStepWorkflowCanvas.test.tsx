/*
 * Adding a Page step on the builder canvas, through the builder's own
 * wiring: React Flow's real state hooks and graph helpers, with only its
 * browser renderer and the dialogs stood in for (as in Workflow.test.tsx).
 *
 * A Page step added to a workflow that starts on an incident or an alert
 * starts as a page about that record - Page About chosen, and the record's
 * ID filled in from the trigger - so "when an incident is created, page
 * whoever is on call" asks only who to page. Added to any other workflow
 * it starts empty, which is a page about a new alert.
 *
 * Only as the step is added: a step already on the canvas keeps what it
 * holds, and so does every other step.
 */

let mockPickerProps: PickerProps | null = null;
let mockSettingsProps: SettingsProps | null = null;

jest.mock("reactflow", () => {
  const actual: typeof import("reactflow") = jest.requireActual(
    "reactflow",
  ) as typeof import("reactflow");

  return {
    ...actual,
    __esModule: true,
    default: (props: ReactFlowProps): ReactElement => {
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
                data-testid={`workflow-node-${(node.data as NodeDataProp).id}`}
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

jest.mock(
  "../../../../../UI/Components/Workflow/ComponentSettingsModal",
  () => {
    return {
      __esModule: true,
      default: (props: SettingsProps): ReactElement => {
        mockSettingsProps = props;

        return <div data-testid="step-settings" />;
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

import Alert from "../../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
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
import { summarizePageStep } from "../../../../../UI/Components/Workflow/OnCall/PageStepSummary";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import { PAGE_ARGUMENT_IDS } from "../../../../../Types/Workflow/Components/OnCallPageSettings";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement } from "react";
import { Node, ReactFlowProps } from "reactflow";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const JANE: string = "10000000-0000-4000-8000-000000000001";

const PAGE_STEP_IDS: Array<ComponentID> = [
  ComponentID.PageUsers,
  ComponentID.PageTeam,
  ComponentID.PageOnCall,
  ComponentID.PageOnCallPolicy,
];

function metadataOf(id: string): ComponentMetadata {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  })!;
}

// One of a model's own steps, by how its id ends: "on-create", "on-delete".
function modelStep(model: BaseModel, suffix: string): ComponentMetadata {
  return BaseModelComponents.getComponents(model).find(
    (component: ComponentMetadata): boolean => {
      return component.id.endsWith(`-${suffix}`);
    },
  )!;
}

function step(
  metadata: ComponentMetadata,
  componentId: string,
  args: JSONObject = {},
): Node<NodeDataProp> {
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
}

interface Harness {
  onUpdated: MockFunction;
  onLint: MockFunction;
}

function renderBuilder(
  nodes: Array<Node<NodeDataProp>>,
  overrides: Partial<WorkflowProps> = {},
): Harness {
  const onUpdated: MockFunction = getJestMockFunction();
  const onLint: MockFunction = getJestMockFunction();

  render(
    <Workflow
      initialNodes={nodes}
      initialEdges={[]}
      workflowId={new ObjectID("11111111-1111-4111-8111-111111111111")}
      showComponentsPickerModal={true}
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
}

function lastNodes(harness: Harness): Array<Node<NodeDataProp>> {
  const calls: Array<Array<unknown>> = harness.onUpdated.mock.calls;

  return calls[calls.length - 1]?.[0] as Array<Node<NodeDataProp>>;
}

function lastLint(harness: Harness): WorkflowLintResult {
  const calls: Array<Array<unknown>> = harness.onLint.mock.calls;

  return calls[calls.length - 1]?.[0] as WorkflowLintResult;
}

// Picks a step in the Add Component panel, and returns it as the canvas holds it.
function add(harness: Harness, id: string): NodeDataProp {
  expect(mockPickerProps).not.toBeNull();

  act(() => {
    mockPickerProps?.onComponentClick(metadataOf(id));
  });

  const added: Array<Node<NodeDataProp>> = lastNodes(harness).filter(
    (node: Node<NodeDataProp>): boolean => {
      return node.data.metadataId === id;
    },
  );

  return added[added.length - 1]!.data;
}

beforeEach(() => {
  mockPickerProps = null;
  mockSettingsProps = null;
});

afterEach(() => {
  cleanup();
});

describe("a Page step added to a workflow that starts on an incident", () => {
  test.each(PAGE_STEP_IDS.map(String))(
    "%s starts as a page about that incident",
    (id: string) => {
      const harness: Harness = renderBuilder([
        step(modelStep(new Incident(), "on-create"), "incident-on-create-1"),
      ]);

      const added: NodeDataProp = add(harness, id);

      expect(added.id).toBe(`${id}-1`);
      expect(added.arguments).toEqual({
        about: "incident",
        "incident-id":
          "{{local.components.incident-on-create-1.returnValues.model._id}}",
      });
    },
  );

  test("all it still asks is who to page: the one setting the checks call empty", () => {
    const harness: Harness = renderBuilder([
      step(modelStep(new Incident(), "on-create"), "incident-on-create-1"),
    ]);

    add(harness, ComponentID.PageOnCall);

    const missing: Array<WorkflowLintIssue> = lastLint(harness).issues.filter(
      (issue: WorkflowLintIssue): boolean => {
        return (
          issue.componentId === "page-on-call-1" &&
          issue.rule === WorkflowLintRule.MissingRequiredArgument
        );
      },
    );

    expect(
      missing.map((issue: WorkflowLintIssue): string | null => {
        return issue.argumentId;
      }),
    ).toEqual([PAGE_ARGUMENT_IDS.onCallSchedules]);

    /*
     * And nothing it was started with is called wrong: the only other thing
     * said of the step is that nothing is connected to it yet, as of any
     * step that was just added.
     */
    expect(
      lastLint(harness)
        .issues.filter((issue: WorkflowLintIssue): boolean => {
          return issue.componentId === "page-on-call-1";
        })
        .map((issue: WorkflowLintIssue): WorkflowLintRule => {
          return issue.rule;
        })
        .sort(),
    ).toEqual(
      [
        WorkflowLintRule.MissingRequiredArgument,
        WorkflowLintRule.UnreachableComponent,
      ].sort(),
    );
  });

  test("the trigger's own id in this workflow is the one pointed at", () => {
    const harness: Harness = renderBuilder([
      step(modelStep(new Incident(), "on-update"), "incident-on-update-4"),
    ]);

    expect(
      add(harness, ComponentID.PageUsers).arguments[
        PAGE_ARGUMENT_IDS.incidentId
      ],
    ).toBe("{{local.components.incident-on-update-4.returnValues.model._id}}");
  });

  test("a second Page step added to the same workflow starts the same way, with an id of its own", () => {
    const first: JSONObject = {
      [PAGE_ARGUMENT_IDS.users]: [JANE],
      [PAGE_ARGUMENT_IDS.about]: "incident",
      [PAGE_ARGUMENT_IDS.incidentId]:
        "{{local.components.incident-on-create-1.returnValues.model._id}}",
    };

    const harness: Harness = renderBuilder([
      step(modelStep(new Incident(), "on-create"), "incident-on-create-1"),
      step(metadataOf(ComponentID.PageUsers), "page-users-1", first),
    ]);

    const second: NodeDataProp = add(harness, ComponentID.PageUsers);

    expect(second.id).toBe("page-users-2");
    expect(second.arguments).toEqual({
      about: "incident",
      "incident-id":
        "{{local.components.incident-on-create-1.returnValues.model._id}}",
    });

    // The first still pages who it paged.
    expect(
      lastNodes(harness).find((node: Node<NodeDataProp>): boolean => {
        return node.data.id === "page-users-1";
      })!.data.arguments,
    ).toEqual(first);
  });
});

describe("a Page step added to a workflow that starts on an alert", () => {
  test.each(PAGE_STEP_IDS.map(String))(
    "%s starts as a page about that alert",
    (id: string) => {
      const harness: Harness = renderBuilder([
        step(modelStep(new Alert(), "on-create"), "alert-on-create-1"),
      ]);

      expect(add(harness, id).arguments).toEqual({
        about: "alert",
        "alert-id":
          "{{local.components.alert-on-create-1.returnValues.model._id}}",
      });
    },
  );
});

describe("a Page step added to any other workflow", () => {
  test.each<[string, () => Node<NodeDataProp>]>([
    [
      "Manual",
      () => {
        return step(metadataOf(ComponentID.Manual), "manual-1");
      },
    ],
    [
      "Webhook",
      () => {
        return step(metadataOf(ComponentID.Webhook), "webhook-1");
      },
    ],
    [
      "an incident deleted",
      () => {
        return step(
          modelStep(new Incident(), "on-delete"),
          "incident-on-delete-1",
        );
      },
    ],
  ])(
    "started by %s: it starts empty, a page about a new alert",
    (_name: string, trigger: () => Node<NodeDataProp>) => {
      const harness: Harness = renderBuilder([trigger()]);

      const added: NodeDataProp = add(harness, ComponentID.PageUsers);

      // Nothing filled in, as any new step: its settings are all empty.
      expect(added.arguments || {}).toEqual({});

      // The checks ask for who to page and a title: the settings of a new alert.
      expect(
        lastLint(harness)
          .issues.filter((issue: WorkflowLintIssue): boolean => {
            return (
              issue.componentId === "page-users-1" &&
              issue.rule === WorkflowLintRule.MissingRequiredArgument
            );
          })
          .map((issue: WorkflowLintIssue): string | null => {
            return issue.argumentId;
          }),
      ).toEqual([PAGE_ARGUMENT_IDS.users, PAGE_ARGUMENT_IDS.title]);
    },
  );
});

describe("only as the step is added", () => {
  test("a Page step already in the workflow keeps what it holds", () => {
    const existing: JSONObject = {
      [PAGE_ARGUMENT_IDS.users]: [JANE],
      [PAGE_ARGUMENT_IDS.title]: "Database CPU is above 90%",
    };

    const harness: Harness = renderBuilder([
      step(modelStep(new Incident(), "on-create"), "incident-on-create-1"),
      step(metadataOf(ComponentID.PageUsers), "page-users-1", existing),
    ]);

    add(harness, ComponentID.Log);

    const kept: NodeDataProp = lastNodes(harness).find(
      (node: Node<NodeDataProp>): boolean => {
        return node.data.id === "page-users-1";
      },
    )!.data;

    expect(kept.arguments).toEqual(existing);
    expect(summarizePageStep(kept.metadataId, kept.arguments)).toBe(
      "1 user · New alert",
    );
  });

  test("opening a Page step's settings hands them what the step holds, unchanged", () => {
    const existing: JSONObject = {
      [PAGE_ARGUMENT_IDS.users]: [JANE],
      [PAGE_ARGUMENT_IDS.title]: "Database CPU is above 90%",
    };

    renderBuilder(
      [
        step(modelStep(new Incident(), "on-create"), "incident-on-create-1"),
        step(metadataOf(ComponentID.PageUsers), "page-users-1", existing),
      ],
      { showComponentsPickerModal: false },
    );

    fireEvent.click(screen.getByTestId("workflow-node-page-users-1"));

    expect(mockSettingsProps?.component.arguments).toEqual(existing);
  });

  test.each([
    ComponentID.Log,
    ComponentID.IfElse,
    ComponentID.SlackSendMessageToChannel,
    ComponentID.Switch,
  ])("%s is not started with a page's settings", (id: ComponentID) => {
    const harness: Harness = renderBuilder([
      step(modelStep(new Incident(), "on-create"), "incident-on-create-1"),
    ]);

    const started: JSONObject = add(harness, id).arguments || {};

    expect(started[PAGE_ARGUMENT_IDS.about]).toBeUndefined();
    expect(started[PAGE_ARGUMENT_IDS.incidentId]).toBeUndefined();
    expect(started[PAGE_ARGUMENT_IDS.alertId]).toBeUndefined();
  });

  test("a Switch / Case still starts with its two cases, beside a trigger a page would read", () => {
    const harness: Harness = renderBuilder([
      step(modelStep(new Incident(), "on-create"), "incident-on-create-1"),
    ]);

    expect(
      Object.keys(add(harness, ComponentID.Switch).arguments || {}),
    ).toEqual(["cases"]);
  });
});
