import { describe, expect, test } from "@jest/globals";
import {
  WorkflowCanvasGraph,
  isAnyCardBeingDragged,
  toWorkflowCanvasGraph,
} from "../../../../UI/Components/Workflow/WorkflowCanvasGraph";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ComponentMetadata, {
  ComponentType,
  NodeType,
} from "../../../../Types/Workflow/Component";
import {
  getWorkflowGraphKey,
  toSavedWorkflowGraph,
} from "../../../../Utils/Workflow/WorkflowGraphSnapshot";
import { Node } from "reactflow";
import {
  COMPONENTS_BY_ID,
  EMAIL,
  LOG,
  MANUAL,
  PLACEHOLDER,
  graphOf,
} from "../../../Utils/Workflow/WorkflowGraphFixtures";

/*
 * A saved graph as the canvas draws it (issue #6188): the workflow as it
 * opened, a step of Undo or Redo, a version restored or previewed.
 */

const COMPONENTS: Array<ComponentMetadata> = Array.from(
  COMPONENTS_BY_ID.values(),
);

const draw: (graph: unknown) => WorkflowCanvasGraph = (
  graph: unknown,
): WorkflowCanvasGraph => {
  return toWorkflowCanvasGraph({ graph, components: COMPONENTS });
};

describe("toWorkflowCanvasGraph", () => {
  test("puts back each step's catalog entry and clears what its checks said when saved", () => {
    const saved: JSONObject = graphOf([MANUAL, LOG]) as unknown as JSONObject;
    (
      ((saved["nodes"] as Array<JSONObject>)[1] as JSONObject)[
        "data"
      ] as JSONObject
    )["error"] = "Value is required";

    const drawn: WorkflowCanvasGraph = draw(saved);

    expect(drawn.nodes).toHaveLength(2);
    expect(drawn.nodes[1]?.data.metadata.id).toBe(LOG.componentId);
    expect(drawn.nodes[1]?.data.metadata.title).toBe(
      COMPONENTS_BY_ID.get(LOG.componentId)?.title,
    );
    expect(drawn.nodes[1]?.data.error).toBe("");
    expect(drawn.nodes[1]?.position).toEqual({ x: 96, y: 224 });
  });

  test("draws each connection in the canvas's style", () => {
    const drawn: WorkflowCanvasGraph = draw(
      graphOf([MANUAL, LOG], [{ from: MANUAL.key, to: LOG.key }]),
    );

    expect(drawn.edges).toHaveLength(1);
    expect(drawn.edges[0]).toMatchObject({
      source: MANUAL.key,
      target: LOG.key,
      type: "smoothstep",
      animated: false,
    });
    expect(drawn.edges[0]?.markerEnd).toBeDefined();
  });

  test("a workflow with no trigger starts from the dashed card", () => {
    const drawn: WorkflowCanvasGraph = draw(graphOf([LOG]));

    expect(
      drawn.nodes.filter((node: Node): boolean => {
        return node.data.nodeType === NodeType.PlaceholderNode;
      }),
    ).toHaveLength(1);
  });

  test.each([
    ["no graph", null],
    ["a graph with no cards", { nodes: [], edges: [] }],
    ["a graph without a nodes list", { edges: [] }],
  ])("%s is the dashed card alone", (_name: string, graph: unknown) => {
    const drawn: WorkflowCanvasGraph = draw(graph);

    expect(drawn.nodes).toHaveLength(1);
    expect(drawn.nodes[0]?.data.nodeType).toBe(NodeType.PlaceholderNode);
    expect(drawn.nodes[0]?.data.metadata.componentType).toBe(
      ComponentType.Trigger,
    );
    expect(drawn.edges).toEqual([]);
  });

  test("a saved dashed card is drawn as the dashed card, not twice", () => {
    const drawn: WorkflowCanvasGraph = draw(graphOf([PLACEHOLDER, LOG]));

    expect(
      drawn.nodes.filter((node: Node): boolean => {
        return node.data.nodeType === NodeType.PlaceholderNode;
      }),
    ).toHaveLength(1);
    expect(
      drawn.nodes.find((node: Node) => {
        return node.data.nodeType === NodeType.PlaceholderNode;
      })?.data.metadata.title,
    ).toBe("Trigger");
  });

  test("a step whose component OneUptime no longer has cannot be drawn, and says which", () => {
    expect(() => {
      draw(graphOf([MANUAL, { ...LOG, componentId: "a-step-that-is-gone" }]));
    }).toThrow(BadDataException);
    expect(() => {
      draw(graphOf([MANUAL, { ...LOG, componentId: "a-step-that-is-gone" }]));
    }).toThrow("a-step-that-is-gone");
  });

  test("leaves what is not a card or a connection out", () => {
    const drawn: WorkflowCanvasGraph = draw({
      nodes: [null, card(), 3],
      edges: [null, "x"],
    });

    expect(drawn.nodes).toHaveLength(1);
    expect(drawn.edges).toEqual([]);

    function card(): JSONObject {
      return graphOf([MANUAL]).nodes[0] as JSONObject;
    }
  });

  test("is a copy: the canvas changing what it drew changes no graph kept", () => {
    const saved: { nodes: Array<JSONObject>; edges: Array<JSONObject> } =
      graphOf([MANUAL, LOG]);
    const drawn: WorkflowCanvasGraph = draw(saved);

    (drawn.nodes[1] as Node).position.x = 9999;
    (drawn.nodes[1] as Node).data.arguments.value = "changed";

    expect((saved.nodes[1] as JSONObject)["position"]).toEqual({
      x: 96,
      y: 224,
    });
    expect(
      (
        ((saved.nodes[1] as JSONObject)["data"] as JSONObject)[
          "arguments"
        ] as JSONObject
      )["value"],
    ).toBe(LOG.args?.["value"]);
  });

  test("round trip: a graph drawn and saved again is the same graph", () => {
    const saved: { nodes: Array<JSONObject>; edges: Array<JSONObject> } =
      graphOf(
        [MANUAL, LOG, EMAIL],
        [
          { from: MANUAL.key, to: LOG.key },
          { from: LOG.key, to: EMAIL.key },
        ],
      );

    expect(getWorkflowGraphKey(toSavedWorkflowGraph(draw(saved)))).toBe(
      getWorkflowGraphKey(saved),
    );
  });
});

describe("isAnyCardBeingDragged", () => {
  test("while a card is being dragged, and not otherwise", () => {
    const nodes: Array<Node> = draw(graphOf([MANUAL, LOG])).nodes;

    expect(isAnyCardBeingDragged(nodes)).toBe(false);
    expect(
      isAnyCardBeingDragged([
        nodes[0] as Node,
        { ...(nodes[1] as Node), dragging: true },
      ]),
    ).toBe(true);
    expect(
      isAnyCardBeingDragged([{ ...(nodes[0] as Node), dragging: false }]),
    ).toBe(false);
    expect(isAnyCardBeingDragged([])).toBe(false);
  });
});
