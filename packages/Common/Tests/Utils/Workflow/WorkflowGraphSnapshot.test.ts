import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  SavedWorkflowGraph,
  getCardsOnlyMoved,
  getEmptyWorkflowGraph,
  getWorkflowGraphKey,
  isSameWorkflowGraph,
  toSavedWorkflowGraph,
} from "../../../Utils/Workflow/WorkflowGraphSnapshot";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import {
  EMAIL,
  IF_ELSE,
  LOG,
  MANUAL,
  PLACEHOLDER,
  graphOf,
} from "./WorkflowGraphFixtures";

/*
 * A workflow's graph as the builder saves it, keeps it for Undo and gets it
 * back as a version (issue #6188): nothing of what only the canvas keeps, and
 * a key that tells two graphs apart exactly when the workflow, or where its
 * cards sit, differs.
 */

const onCanvas: () => {
  nodes: Array<JSONObject>;
  edges: Array<JSONObject>;
} = (): { nodes: Array<JSONObject>; edges: Array<JSONObject> } => {
  return graphOf(
    [
      { ...MANUAL, withCanvasState: true, selected: true },
      { ...LOG, withCanvasState: true },
    ],
    [{ from: MANUAL.key, to: LOG.key, styled: true }],
  );
};

describe("toSavedWorkflowGraph", () => {
  test("keeps every card's id, type, position and step, and every connection's ends", () => {
    const saved: SavedWorkflowGraph = toSavedWorkflowGraph(onCanvas());

    expect(saved.nodes).toEqual([
      {
        id: MANUAL.key,
        type: "node",
        position: { x: 96, y: 32 },
        data: {
          id: "manual-1",
          nodeType: "Node",
          componentType: "Trigger",
          metadataId: MANUAL.componentId,
          internalId: `internal-${MANUAL.key}`,
          arguments: {},
        },
      },
      {
        id: LOG.key,
        type: "node",
        position: { x: 96, y: 224 },
        data: {
          id: "log-1",
          nodeType: "Node",
          componentType: "Component",
          metadataId: LOG.componentId,
          internalId: `internal-${LOG.key}`,
          arguments: LOG.args as JSONObject,
        },
      },
    ]);
    expect(saved.edges).toEqual([
      {
        id: `edge-${MANUAL.key}-${LOG.key}-out`,
        source: MANUAL.key,
        sourceHandle: "out",
        target: LOG.key,
        targetHandle: "in",
      },
    ]);
  });

  test("leaves out what only the canvas keeps: selection, drag, size, the catalog entry, the checks' words, the drawing", () => {
    const text: string = JSON.stringify(toSavedWorkflowGraph(onCanvas()));

    for (const key of [
      "selected",
      "dragging",
      "positionAbsolute",
      "width",
      "height",
      "metadata",
      "error",
      "style",
      "markerEnd",
      "animated",
      'type":"smoothstep',
    ]) {
      expect({ key, kept: text.includes(`"${key}"`) }).toEqual({
        key,
        kept: false,
      });
    }
  });

  test("leaves out a card's handlers and the summary the canvas draws its badges from", () => {
    const graph: JSONObject = onCanvas() as unknown as JSONObject;
    const data: JSONObject = (
      (graph["nodes"] as Array<JSONObject>)[1] as JSONObject
    )["data"] as JSONObject;
    (data as Record<string, unknown>)["onClick"] = (): void => {};
    data["issueSummary"] = { errors: 1 };

    const saved: SavedWorkflowGraph = toSavedWorkflowGraph(graph);
    const savedData: JSONObject = (saved.nodes[1] as JSONObject)[
      "data"
    ] as JSONObject;

    expect(savedData["onClick"]).toBeUndefined();
    expect(savedData["issueSummary"]).toBeUndefined();
  });

  test("is a copy: changing what it was made from changes nothing kept", () => {
    const graph: { nodes: Array<JSONObject>; edges: Array<JSONObject> } =
      onCanvas();
    const saved: SavedWorkflowGraph = toSavedWorkflowGraph(graph);

    ((graph.nodes[1] as JSONObject)["data"] as JSONObject)["arguments"] = {
      value: "changed",
    };
    ((graph.nodes[1] as JSONObject)["position"] as JSONObject)["x"] = 999;

    expect(
      ((saved.nodes[1] as JSONObject)["data"] as JSONObject)["arguments"],
    ).toEqual(LOG.args);
    expect((saved.nodes[1] as JSONObject)["position"]).toEqual({
      x: 96,
      y: 224,
    });
  });

  test("keeps the dashed card a workflow without a trigger starts from, as the builder always saved it", () => {
    const saved: SavedWorkflowGraph = toSavedWorkflowGraph(
      graphOf([PLACEHOLDER, LOG]),
    );

    expect(saved.nodes).toHaveLength(2);
  });

  test("reads a graph saved as JSON text like the graph", () => {
    expect(toSavedWorkflowGraph(JSON.stringify(onCanvas()))).toEqual(
      toSavedWorkflowGraph(onCanvas()),
    );
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a number", 42],
    ["a list", [1, 2]],
    ["text that is not JSON", "{not json"],
    ["an object without cards", { something: true }],
  ])("reads %s as an empty graph", (_name: string, value: unknown) => {
    expect(toSavedWorkflowGraph(value)).toEqual(getEmptyWorkflowGraph());
  });

  test("drops what is not a card or a connection", () => {
    expect(
      toSavedWorkflowGraph({ nodes: [null, 3, "x"], edges: [false, []] }),
    ).toEqual(getEmptyWorkflowGraph());
  });
});

describe("getWorkflowGraphKey", () => {
  const base: { nodes: Array<JSONObject>; edges: Array<JSONObject> } = graphOf(
    [MANUAL, IF_ELSE, LOG, EMAIL],
    [
      { from: MANUAL.key, to: IF_ELSE.key },
      { from: IF_ELSE.key, to: LOG.key, fromPort: "yes" },
      { from: IF_ELSE.key, to: EMAIL.key, fromPort: "no" },
    ],
  );

  test("is the same for the graph on the canvas and the graph as saved", () => {
    expect(getWorkflowGraphKey(onCanvas())).toEqual(
      getWorkflowGraphKey(toSavedWorkflowGraph(onCanvas())),
    );
  });

  test("is the same whatever order the cards, connections and keys come in", () => {
    const random: SeededRandom = seededRandom(6188);

    for (let attempt: number = 0; attempt < 50; attempt++) {
      const reordered: JSONObject = {
        edges: shuffled(base.edges, random),
        nodes: shuffled(base.nodes, random).map((node: JSONObject) => {
          return Object.fromEntries(
            shuffled(Object.entries(node), random),
          ) as JSONObject;
        }),
      };

      expect(getWorkflowGraphKey(reordered)).toEqual(getWorkflowGraphKey(base));
    }
  });

  test("ignores the connections' ids, which a restyle gives anew", () => {
    const renamed: { nodes: Array<JSONObject>; edges: Array<JSONObject> } = {
      nodes: base.nodes,
      edges: base.edges.map((edge: JSONObject, index: number) => {
        return { ...edge, id: `another-${index}` };
      }),
    };

    expect(isSameWorkflowGraph(base, renamed)).toBe(true);
  });

  test("ignores the dashed card, which comes back under a new id every time the builder opens", () => {
    expect(
      isSameWorkflowGraph(
        graphOf([{ ...PLACEHOLDER, key: "slot-1" }, LOG]),
        graphOf([{ ...PLACEHOLDER, key: "slot-2", x: 400 }, LOG]),
      ),
    ).toBe(true);
  });

  test("tells apart a card moved, a setting changed, a step added and a connection made", () => {
    const keys: Array<string> = [
      base,
      graphOf(
        [MANUAL, IF_ELSE, { ...LOG, x: 512 }, EMAIL],
        base.edges.map((edge: JSONObject) => {
          return {
            from: edge["source"] as string,
            to: edge["target"] as string,
            fromPort: edge["sourceHandle"] as string,
          };
        }),
      ),
      graphOf(
        [MANUAL, IF_ELSE, { ...LOG, args: { value: "other" } }, EMAIL],
        [
          { from: MANUAL.key, to: IF_ELSE.key },
          { from: IF_ELSE.key, to: LOG.key, fromPort: "yes" },
          { from: IF_ELSE.key, to: EMAIL.key, fromPort: "no" },
        ],
      ),
      graphOf(
        [
          MANUAL,
          IF_ELSE,
          LOG,
          EMAIL,
          { ...LOG, key: "card-log-2", stepId: "log-2" },
        ],
        [
          { from: MANUAL.key, to: IF_ELSE.key },
          { from: IF_ELSE.key, to: LOG.key, fromPort: "yes" },
          { from: IF_ELSE.key, to: EMAIL.key, fromPort: "no" },
        ],
      ),
      graphOf(
        [MANUAL, IF_ELSE, LOG, EMAIL],
        [
          { from: MANUAL.key, to: IF_ELSE.key },
          { from: IF_ELSE.key, to: LOG.key, fromPort: "yes" },
          { from: IF_ELSE.key, to: EMAIL.key, fromPort: "no" },
          { from: LOG.key, to: EMAIL.key },
        ],
      ),
    ].map((graph: unknown): string => {
      return getWorkflowGraphKey(graph);
    });

    expect(new Set<string>(keys).size).toBe(keys.length);
  });

  test("ignoring positions, a moved card reads the same", () => {
    const moved: { nodes: Array<JSONObject>; edges: Array<JSONObject> } =
      graphOf([MANUAL, { ...LOG, x: 640, y: 640 }]);

    expect(
      getWorkflowGraphKey(graphOf([MANUAL, LOG]), { ignorePositions: true }),
    ).toEqual(getWorkflowGraphKey(moved, { ignorePositions: true }));
    expect(getWorkflowGraphKey(graphOf([MANUAL, LOG]))).not.toEqual(
      getWorkflowGraphKey(moved),
    );
  });

  test("reads nothing it cannot read as an empty graph", () => {
    expect(getWorkflowGraphKey("{oops")).toEqual(
      getWorkflowGraphKey(getEmptyWorkflowGraph()),
    );
  });
});

describe("getCardsOnlyMoved", () => {
  test("names the cards that moved when moving them is all that changed", () => {
    expect(
      getCardsOnlyMoved(
        graphOf([MANUAL, LOG, EMAIL]),
        graphOf([MANUAL, { ...LOG, x: 300 }, { ...EMAIL, y: 900 }]),
      )?.sort(),
    ).toEqual([EMAIL.key, LOG.key].sort());
  });

  test("is an empty list when nothing changed", () => {
    expect(
      getCardsOnlyMoved(graphOf([MANUAL, LOG]), graphOf([MANUAL, LOG])),
    ).toEqual([]);
  });

  test("is null when anything besides a move changed", () => {
    expect(
      getCardsOnlyMoved(
        graphOf([MANUAL, LOG]),
        graphOf([MANUAL, { ...LOG, x: 300, args: { value: "x" } }]),
      ),
    ).toBeNull();
    expect(
      getCardsOnlyMoved(graphOf([MANUAL, LOG]), graphOf([MANUAL])),
    ).toBeNull();
  });

  test("a card selected, measured or dragged is not a move", () => {
    expect(
      getCardsOnlyMoved(
        graphOf([MANUAL, LOG]),
        graphOf([MANUAL, { ...LOG, withCanvasState: true, selected: true }]),
      ),
    ).toEqual([]);
  });
});
