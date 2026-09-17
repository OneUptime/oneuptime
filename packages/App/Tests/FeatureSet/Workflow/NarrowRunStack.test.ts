/*
 * Narrowing a run to a single step. The property that matters is containment:
 * a request to run one step must run exactly that step and nothing else, and
 * must never quietly widen into a full run.
 */

import IconProp from "Common/Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "Common/Types/Workflow/Component";
import RunWorkflow, {
  RunStack,
} from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import { describe, expect, test } from "@jest/globals";

type MakeNodeFunction = (componentId: string) => NodeDataProp;

const makeNode: MakeNodeFunction = (componentId: string): NodeDataProp => {
  const metadata: ComponentMetadata = {
    id: "test-component",
    title: componentId,
    category: "Test",
    description: "For tests",
    iconProp: IconProp.Bolt,
    componentType: ComponentType.Component,
    arguments: [],
    returnValues: [],
    inPorts: [],
    outPorts: [],
  };

  return {
    error: "",
    id: componentId,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${componentId}-internal`,
    arguments: { some: "argument" },
    returnValues: {},
    componentType: ComponentType.Component,
  };
};

type MakeStackFunction = () => RunStack;

const makeStack: MakeStackFunction = (): RunStack => {
  return {
    startWithComponentId: "trigger-1",
    stack: {
      "trigger-1": {
        node: makeNode("trigger-1"),
        outPorts: { out: ["step-a"] },
      },
      "step-a": {
        node: makeNode("step-a"),
        outPorts: { success: ["step-b"], error: ["step-c"] },
      },
      "step-b": { node: makeNode("step-b"), outPorts: {} },
      "step-c": { node: makeNode("step-c"), outPorts: {} },
    },
  };
};

describe("narrowRunStackToSingleComponent", () => {
  test("starts at the requested component", () => {
    const narrowed: RunStack =
      new RunWorkflow().narrowRunStackToSingleComponent(makeStack(), "step-a");

    expect(narrowed.startWithComponentId).toBe("step-a");
  });

  test("keeps only that component in the stack", () => {
    const narrowed: RunStack =
      new RunWorkflow().narrowRunStackToSingleComponent(makeStack(), "step-a");

    expect(Object.keys(narrowed.stack)).toEqual(["step-a"]);
  });

  /*
   * The containment property: with no out ports, the run loop has nothing to
   * queue after this step, so nothing downstream can follow.
   */
  test("drops the component's out ports so nothing downstream follows", () => {
    const narrowed: RunStack =
      new RunWorkflow().narrowRunStackToSingleComponent(makeStack(), "step-a");

    expect(narrowed.stack["step-a"]?.outPorts).toEqual({});
  });

  test("keeps the component's own node, arguments and metadata", () => {
    const narrowed: RunStack =
      new RunWorkflow().narrowRunStackToSingleComponent(makeStack(), "step-a");

    const node: NodeDataProp = narrowed.stack["step-a"]?.node as NodeDataProp;

    expect(node.id).toBe("step-a");
    expect(node.arguments).toEqual({ some: "argument" });
    expect(node.metadata).toBeDefined();
  });

  test("can narrow to the trigger itself", () => {
    const narrowed: RunStack =
      new RunWorkflow().narrowRunStackToSingleComponent(
        makeStack(),
        "trigger-1",
      );

    expect(Object.keys(narrowed.stack)).toEqual(["trigger-1"]);
    expect(narrowed.stack["trigger-1"]?.outPorts).toEqual({});
  });

  /*
   * Refusing is the safe outcome. Falling back to the original stack would
   * turn "run this one step" into "run the whole workflow".
   */
  test("refuses an id that is not in the graph rather than running everything", () => {
    expect(() => {
      return new RunWorkflow().narrowRunStackToSingleComponent(
        makeStack(),
        "does-not-exist",
      );
    }).toThrow(/no step with that id/);
  });

  test("refuses an empty id", () => {
    expect(() => {
      return new RunWorkflow().narrowRunStackToSingleComponent(makeStack(), "");
    }).toThrow();
  });

  test("does not mutate the stack it was given", () => {
    const original: RunStack = makeStack();

    new RunWorkflow().narrowRunStackToSingleComponent(original, "step-a");

    expect(Object.keys(original.stack).sort()).toEqual([
      "step-a",
      "step-b",
      "step-c",
      "trigger-1",
    ]);
    expect(original.stack["step-a"]?.outPorts).toEqual({
      success: ["step-b"],
      error: ["step-c"],
    });
    expect(original.startWithComponentId).toBe("trigger-1");
  });
});
