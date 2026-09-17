import { getNewWorkflowNodePosition } from "../../../../UI/Components/Workflow/NodePlacement";
import { ComponentType, NodeType } from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";
import { Node } from "reactflow";

type MakeNodeFunction = (
  id: string,
  x: number,
  y: number,
  height?: number,
) => Node;

const makeNode: MakeNodeFunction = (
  id: string,
  x: number,
  y: number,
  height?: number,
): Node => {
  return {
    id,
    position: { x, y },
    ...(height === undefined ? {} : { height }),
    data: {
      nodeType: NodeType.Node,
      componentType: ComponentType.Component,
    },
  };
};

describe("Workflow node placement", () => {
  test.each([ComponentType.Trigger, ComponentType.Component])(
    "places a first %s on an empty canvas",
    (componentType: ComponentType) => {
      expect(getNewWorkflowNodePosition([], componentType)).toEqual({
        x: 100,
        y: 100,
      });
    },
  );

  test("places a component below the measured height of the existing card", () => {
    expect(
      getNewWorkflowNodePosition(
        [makeNode("first", 320, 100, 360)],
        ComponentType.Component,
      ),
    ).toEqual({ x: 320, y: 540 });
  });

  test.each([undefined, 0])(
    "reserves room when a card's height is %s during its first render",
    (height: number | undefined) => {
      expect(
        getNewWorkflowNodePosition(
          [makeNode("first", 200, 200, height)],
          ComponentType.Component,
        ),
      ).toEqual({ x: 200, y: 480 });
    },
  );

  test("uses the lowest bottom edge, not insertion order or the lowest top edge", () => {
    const nodes: Array<Node> = [
      makeNode("short-low", 400, 400, 100),
      makeNode("tall-high", 100, 200, 500),
      makeNode("last", 800, 100, 100),
    ];

    expect(getNewWorkflowNodePosition(nodes, ComponentType.Component)).toEqual({
      x: 100,
      y: 780,
    });
  });

  test("keeps spacing when the canvas contains negative coordinates", () => {
    expect(
      getNewWorkflowNodePosition(
        [makeNode("first", -800, -600, 100)],
        ComponentType.Component,
      ),
    ).toEqual({ x: -800, y: -420 });
  });

  test("successive additions do not stack even before React Flow measures them", () => {
    const nodes: Array<Node> = [makeNode("existing", 100, 100)];

    for (let index: number = 0; index < 5; index++) {
      const position: { x: number; y: number } = getNewWorkflowNodePosition(
        nodes,
        ComponentType.Component,
      );

      for (const node of nodes) {
        expect(position.y).toBeGreaterThanOrEqual(node.position.y + 280);
      }

      nodes.push(makeNode(`new-${index}`, position.x, position.y));
    }
  });

  test.each([NodeType.PlaceholderNode, NodeType.Node])(
    "replaces a %s trigger in place without moving the other steps",
    (nodeType: NodeType) => {
      const trigger: Node = makeNode("trigger", 432, -180);
      trigger.data.nodeType = nodeType;
      if (nodeType === NodeType.Node) {
        trigger.data.componentType = ComponentType.Trigger;
      }
      const nodes: Array<Node> = [makeNode("action", 100, 500), trigger];

      const position: { x: number; y: number } = getNewWorkflowNodePosition(
        nodes,
        ComponentType.Trigger,
      );

      expect(position).toEqual({ x: 432, y: -180 });
      expect(position).not.toBe(trigger.position);
      expect(nodes[0]?.position).toEqual({ x: 100, y: 500 });
    },
  );

  test("places a missing trigger above the first existing component", () => {
    expect(
      getNewWorkflowNodePosition(
        [makeNode("last", 800, 1000), makeNode("first", 432, -180)],
        ComponentType.Trigger,
      ),
    ).toEqual({ x: 432, y: -460 });
  });

  test("does not mutate the caller's nodes or their order", () => {
    const nodes: Array<Node> = [
      makeNode("last", 400, 1000),
      makeNode("first", 100, 100),
    ];
    const before: string = JSON.stringify(nodes);
    Object.freeze(nodes);
    nodes.forEach((node: Node) => {
      Object.freeze(node);
      Object.freeze(node.position);
    });

    getNewWorkflowNodePosition(nodes, ComponentType.Trigger);
    getNewWorkflowNodePosition(nodes, ComponentType.Component);

    expect(JSON.stringify(nodes)).toBe(before);
  });
});
