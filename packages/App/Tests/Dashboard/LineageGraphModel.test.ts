import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DataAssetFreshness } from "Common/Types/DataObservability/DataAssetFreshness";
import DataAssetLineageSource from "Common/Types/DataObservability/DataAssetLineageSource";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  DataTableLineagePipeline,
  getLineageDashboardNodeId,
  getLineageEdgeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "Common/Types/DataObservability/DataTableLineage";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  LINEAGE_CARD_HEIGHT,
  LINEAGE_CARD_WIDTH,
  LINEAGE_COLUMN_GAP,
  LINEAGE_HIGHLIGHT_COLOR,
  LINEAGE_HIGHLIGHT_WIDTH,
  LINEAGE_NEUTRAL_COLOR,
  LINEAGE_PROBLEM_COLOR,
  LINEAGE_FIT_PADDING,
  LINEAGE_QUERY_HISTORY_DASH,
  LINEAGE_READABLE_ZOOM,
  LINEAGE_READS_COLOR,
  LINEAGE_ROW_GAP,
  LINEAGE_VIEW_DEFINITION_DASH,
  LineageArrowLook,
  LineageCardRole,
  LineageHighlightSets,
  LineageLayout,
  LineagePoint,
  LineageTone,
  LineageViewport,
  countPipelineTables,
  fitHeights,
  getLineageArrowLook,
  getLineageCardRole,
  getLineageCardsInView,
  getLineageColumns,
  getLineageEdgeLabel,
  getLineageEdgeStyle,
  getLineageHighlightSets,
  getLineageNodeTone,
  getLineageViewport,
  isLineageCardDimmed,
  isLineageEmpty,
  layoutLineage,
  summarizeLineage,
} from "../../FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";

/*
 * Where each card of a table's lineage diagram sits (LineageGraphModel):
 * columns by the longest way to the table, so every arrow points right;
 * pipelines before what they write and dashboards after what they read;
 * cards lined up with their neighbours, never overlapping; and how each
 * card and arrow looks. These pin the drawing without a browser, and that
 * a table's Lineage tab draws it.
 */

const ROW: number = LINEAGE_CARD_HEIGHT + LINEAGE_ROW_GAP;
const COLUMN: number = LINEAGE_CARD_WIDTH + LINEAGE_COLUMN_GAP;

const FOCUS: string = getLineageTableNodeId("focus");

function tableNode(
  name: string,
  side: DataLineageSide,
  depth: number,
  fields: Partial<DataTableLineageNode> = {},
): DataTableLineageNode {
  return {
    id: getLineageTableNodeId(name),
    kind: DataLineageNodeKind.Table,
    side,
    depth,
    name,
    dataAssetId: name,
    freshness: DataAssetFreshness.Fresh,
    lateBySeconds: 0,
    isDropped: false,
    openAlertCount: 0,
    hiddenUpstreamCount: 0,
    hiddenDownstreamCount: 0,
    ...fields,
  };
}

function up(name: string, depth: number = -1): DataTableLineageNode {
  return tableNode(name, DataLineageSide.Upstream, depth);
}

function down(name: string, depth: number = 1): DataTableLineageNode {
  return tableNode(name, DataLineageSide.Downstream, depth);
}

function pipelineNode(
  name: string,
  fields: Partial<DataTableLineageNode> = {},
): DataTableLineageNode {
  return {
    id: getLineagePipelineNodeId(name),
    kind: DataLineageNodeKind.Pipeline,
    side: DataLineageSide.Upstream,
    depth: -1,
    name,
    dataPipelineId: name,
    lastRunState: "COMPLETE",
    ...fields,
  };
}

function dashboardNode(name: string): DataTableLineageNode {
  return {
    id: getLineageDashboardNodeId(name),
    kind: DataLineageNodeKind.Dashboard,
    side: DataLineageSide.Downstream,
    depth: 1,
    name,
    dataDashboardId: name,
    tool: "Metabase",
    url: null,
  };
}

function edge(
  kind: DataLineageEdgeKind,
  source: string,
  target: string,
  fields: Partial<DataTableLineageEdge> = {},
): DataTableLineageEdge {
  return {
    id: getLineageEdgeId({ kind, source, target }),
    source,
    target,
    kind,
    seenIn:
      kind === DataLineageEdgeKind.Reads
        ? []
        : [DataAssetLineageSource.Pipeline],
    pipelines: [],
    lastSeenAt: null,
    ...fields,
  };
}

// An edge from one table to another, by name ("focus" is the table).
function feeds(
  upstream: string,
  downstream: string,
  fields: Partial<DataTableLineageEdge> = {},
): DataTableLineageEdge {
  return edge(
    DataLineageEdgeKind.Feeds,
    getLineageTableNodeId(upstream),
    getLineageTableNodeId(downstream),
    fields,
  );
}

function lineageOf(
  nodes: Array<DataTableLineageNode>,
  edges: Array<DataTableLineageEdge>,
): DataTableLineage {
  return {
    focusNodeId: FOCUS,
    depth: 3,
    nodes: [tableNode("focus", DataLineageSide.Focus, 0), ...nodes],
    edges,
    hiddenDashboardCount: 0,
    isTruncated: false,
  };
}

function columnOf(columns: Map<string, number>, name: string): number {
  return columns.get(getLineageTableNodeId(name))!;
}

describe("each card's column", () => {
  test("a chain sits at its steps each way, the table in the middle", () => {
    const columns: Map<string, number> = getLineageColumns(
      lineageOf(
        [up("b", -1), up("a", -2), down("c", 1), down("d", 2)],
        [
          feeds("a", "b"),
          feeds("b", "focus"),
          feeds("focus", "c"),
          feeds("c", "d"),
        ],
      ),
    );

    expect(columnOf(columns, "focus")).toBe(0);
    expect(columnOf(columns, "a")).toBe(-2);
    expect(columnOf(columns, "b")).toBe(-1);
    expect(columnOf(columns, "c")).toBe(1);
    expect(columnOf(columns, "d")).toBe(2);
  });

  test("upstream, a table sits at its longest way to the table, so every arrow points right", () => {
    // a feeds the table directly (one step) and through b (two steps).
    const columns: Map<string, number> = getLineageColumns(
      lineageOf(
        [up("a", -1), up("b", -1)],
        [feeds("a", "focus"), feeds("b", "focus"), feeds("a", "b")],
      ),
    );

    expect(columnOf(columns, "a")).toBe(-2);
    expect(columnOf(columns, "b")).toBe(-1);
  });

  test("downstream, a table sits at its longest way from the table", () => {
    const columns: Map<string, number> = getLineageColumns(
      lineageOf(
        [down("c", 1), down("d", 1)],
        [feeds("focus", "c"), feeds("focus", "d"), feeds("c", "d")],
      ),
    );

    expect(columnOf(columns, "c")).toBe(1);
    expect(columnOf(columns, "d")).toBe(2);
  });

  test("a pipeline sits a column before the first table it writes", () => {
    const sync: DataTableLineageNode = pipelineNode("sync");
    const columns: Map<string, number> = getLineageColumns(
      lineageOf(
        [up("b", -1), up("a", -2), sync],
        [
          feeds("a", "b"),
          feeds("b", "focus"),
          edge(DataLineageEdgeKind.Writes, sync.id, getLineageTableNodeId("a")),
          edge(DataLineageEdgeKind.Writes, sync.id, getLineageTableNodeId("b")),
          edge(DataLineageEdgeKind.Writes, sync.id, FOCUS),
        ],
      ),
    );

    expect(columns.get(sync.id)).toBe(-3);
  });

  test("a pipeline writing only the table sits just before it", () => {
    const sync: DataTableLineageNode = pipelineNode("sync");
    const columns: Map<string, number> = getLineageColumns(
      lineageOf([sync], [edge(DataLineageEdgeKind.Writes, sync.id, FOCUS)]),
    );

    expect(columns.get(sync.id)).toBe(-1);
  });

  test("a dashboard sits a column after the last table it reads", () => {
    const revenue: DataTableLineageNode = dashboardNode("revenue");
    const columns: Map<string, number> = getLineageColumns(
      lineageOf(
        [down("c", 1), down("d", 2), revenue],
        [
          feeds("focus", "c"),
          feeds("c", "d"),
          edge(DataLineageEdgeKind.Reads, FOCUS, revenue.id),
          edge(
            DataLineageEdgeKind.Reads,
            getLineageTableNodeId("d"),
            revenue.id,
          ),
        ],
      ),
    );

    expect(columns.get(revenue.id)).toBe(3);
  });

  test("a cycle upstream is cut where the walk meets it", () => {
    const columns: Map<string, number> = getLineageColumns(
      lineageOf(
        [up("a", -2), up("b", -1)],
        [feeds("a", "b"), feeds("b", "a"), feeds("b", "focus")],
      ),
    );

    expect(columnOf(columns, "b")).toBe(-1);
    expect(columnOf(columns, "a")).toBe(-2);
  });

  test("a cycle through the table keeps each side's card on its side", () => {
    const columns: Map<string, number> = getLineageColumns(
      lineageOf([up("x", -1)], [feeds("x", "focus"), feeds("focus", "x")]),
    );

    expect(columnOf(columns, "x")).toBe(-1);
    expect(columnOf(columns, "focus")).toBe(0);
  });

  test("a card no arrow leads to keeps the steps the lineage gave it", () => {
    const columns: Map<string, number> = getLineageColumns(
      lineageOf([up("lonely", -3), down("far", 2)], []),
    );

    expect(columnOf(columns, "lonely")).toBe(-3);
    expect(columnOf(columns, "far")).toBe(2);
  });
});

describe("fitting a column's cards", () => {
  test("cards that want the same height share it, a row apart", () => {
    expect(fitHeights([0, 0, 0], 10)).toEqual([-10, 0, 10]);
  });

  test("cards with room keep the heights they want", () => {
    expect(fitHeights([0, 100, 250], 10)).toEqual([0, 100, 250]);
  });

  test("a card that wants to be above the one before it meets it halfway", () => {
    expect(fitHeights([50, 0], 10)).toEqual([20, 30]);
  });

  test("never closer than a row, and never out of order", () => {
    const random: SeededRandom = seededRandom(31337);

    for (let round: number = 0; round < 200; round++) {
      const wanted: Array<number> = Array.from(
        { length: 1 + random(12) },
        (): number => {
          return random(1000) - 500;
        },
      );
      const fitted: Array<number> = fitHeights(wanted, 40);

      expect(fitted).toHaveLength(wanted.length);

      for (let index: number = 1; index < fitted.length; index++) {
        expect(fitted[index]! - fitted[index - 1]!).toBeGreaterThanOrEqual(
          40 - 1e-9,
        );
      }

      // Least squares keeps the cards' mean where they wanted it.
      const mean: (values: Array<number>) => number = (
        values: Array<number>,
      ): number => {
        return (
          values.reduce((sum: number, value: number): number => {
            return sum + value;
          }, 0) / values.length
        );
      };

      expect(mean(fitted)).toBeCloseTo(mean(wanted), 6);
    }
  });
});

describe("laying the cards out", () => {
  test("a chain draws a straight line through the table", () => {
    const layout: LineageLayout = layoutLineage(
      lineageOf(
        [up("b", -1), up("a", -2), down("c", 1)],
        [feeds("a", "b"), feeds("b", "focus"), feeds("focus", "c")],
      ),
    );
    const heights: Set<number> = new Set(
      Array.from(layout.positions.values()).map(
        (point: LineagePoint): number => {
          return point.y;
        },
      ),
    );

    expect(heights.size).toBe(1);
    expect(layout.positions.get(getLineageTableNodeId("a"))!.x).toBe(0);
    expect(layout.positions.get(FOCUS)!.x).toBe(2 * COLUMN);
    expect(layout.positions.get(getLineageTableNodeId("c"))!.x).toBe(
      3 * COLUMN,
    );
    expect(layout.width).toBe(3 * COLUMN + LINEAGE_CARD_WIDTH);
    expect(layout.height).toBe(LINEAGE_CARD_HEIGHT);
  });

  test("the table sits in the middle of the tables it is built from", () => {
    const layout: LineageLayout = layoutLineage(
      lineageOf(
        [up("a"), up("b"), up("c")],
        [feeds("a", "focus"), feeds("b", "focus"), feeds("c", "focus")],
      ),
    );
    const ys: Array<number> = ["a", "b", "c"].map((name: string): number => {
      return layout.positions.get(getLineageTableNodeId(name))!.y;
    });

    expect(ys).toEqual([0, ROW, 2 * ROW]);
    expect(layout.positions.get(FOCUS)!.y).toBe(ROW);
    expect(layout.height).toBe(2 * ROW + LINEAGE_CARD_HEIGHT);
  });

  test("cards line up with the cards they are joined to, crossing as little as can be", () => {
    /*
     * Upstream of a and b, listed crosswise: a2 feeds b, b2 feeds a. Each
     * goes to the row of the table it feeds, so no two arrows cross.
     */
    const layout: LineageLayout = layoutLineage(
      lineageOf(
        [up("a", -1), up("b", -1), up("a2", -2), up("b2", -2)],
        [
          feeds("a", "focus"),
          feeds("b", "focus"),
          feeds("b2", "a"),
          feeds("a2", "b"),
        ],
      ),
    );
    const y: (name: string) => number = (name: string): number => {
      return layout.positions.get(getLineageTableNodeId(name))!.y;
    };

    expect(y("b2")).toBe(y("a"));
    expect(y("a2")).toBe(y("b"));
  });

  test("the same lineage always lays out the same way", () => {
    const lineage: DataTableLineage = lineageOf(
      [up("a"), up("b"), down("c"), down("d"), up("e", -2)],
      [
        feeds("a", "focus"),
        feeds("b", "focus"),
        feeds("e", "a"),
        feeds("e", "b"),
        feeds("focus", "c"),
        feeds("focus", "d"),
      ],
    );

    expect(layoutLineage(lineage)).toEqual(layoutLineage(lineage));
  });

  test("any lineage: every card placed, none overlapping, every arrow on its side pointing right", () => {
    const random: SeededRandom = seededRandom(2024);

    for (let round: number = 0; round < 80; round++) {
      const nodes: Array<DataTableLineageNode> = [];
      const edges: Array<DataTableLineageEdge> = [];
      const upstream: Array<Array<string>> = [["focus"]];
      const downstream: Array<Array<string>> = [["focus"]];
      const depth: number = 1 + random(4);

      // Each step's tables, each joined to one or two tables a step in.
      for (let step: number = 1; step <= depth; step++) {
        upstream.push([]);
        downstream.push([]);

        const upstreamCount: number = random(6);
        const downstreamCount: number = random(6);

        for (let index: number = 0; index < upstreamCount; index++) {
          const name: string = `u${step}_${index}`;
          nodes.push(up(name, -step));
          upstream[step]!.push(name);

          for (let link: number = 0; link < 1 + random(2); link++) {
            const inner: Array<string> = upstream[step - 1]!;
            const target: string = inner[random(inner.length)]!;

            if (
              !edges.some((existing: DataTableLineageEdge): boolean => {
                return existing.id === feeds(name, target).id;
              })
            ) {
              edges.push(feeds(name, target));
            }
          }
        }

        for (let index: number = 0; index < downstreamCount; index++) {
          const name: string = `d${step}_${index}`;
          nodes.push(down(name, step));
          downstream[step]!.push(name);

          const inner: Array<string> = downstream[step - 1]!;
          edges.push(feeds(inner[random(inner.length)]!, name));
        }

        if (upstream[step]!.length === 0 || downstream[step]!.length === 0) {
          break;
        }
      }

      if (random() < 0.5 && upstream.length > 1 && upstream[1]!.length > 0) {
        const sync: DataTableLineageNode = pipelineNode(`sync${round}`);
        nodes.push(sync);
        edges.push(
          edge(
            DataLineageEdgeKind.Writes,
            sync.id,
            getLineageTableNodeId(upstream[1]![0]!),
          ),
        );
      }

      if (random() < 0.5) {
        const board: DataTableLineageNode = dashboardNode(`board${round}`);
        nodes.push(board);
        edges.push(edge(DataLineageEdgeKind.Reads, FOCUS, board.id));
      }

      const lineage: DataTableLineage = lineageOf(nodes, edges);
      const layout: LineageLayout = layoutLineage(lineage);

      expect(layout.positions.size).toBe(lineage.nodes.length);
      expect(layout.columns.get(FOCUS)).toBe(0);

      // No two cards of a column overlap.
      const byColumn: Map<number, Array<number>> = new Map();

      for (const node of lineage.nodes) {
        const column: number = layout.columns.get(node.id)!;
        const point: LineagePoint = layout.positions.get(node.id)!;

        expect(point.x).toBe(
          (column - Math.min(0, ...Array.from(layout.columns.values()))) *
            COLUMN,
        );
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y + LINEAGE_CARD_HEIGHT).toBeLessThanOrEqual(
          layout.height + 1e-9,
        );
        byColumn.set(column, [...(byColumn.get(column) || []), point.y]);

        if (node.side === DataLineageSide.Upstream) {
          expect(column).toBeLessThan(0);
        }

        if (node.side === DataLineageSide.Downstream) {
          expect(column).toBeGreaterThan(0);
        }
      }

      for (const ys of byColumn.values()) {
        const sorted: Array<number> = [...ys].sort((a: number, b: number) => {
          return a - b;
        });

        for (let index: number = 1; index < sorted.length; index++) {
          expect(sorted[index]! - sorted[index - 1]!).toBeGreaterThanOrEqual(
            ROW - 1e-9,
          );
        }
      }

      // Every arrow points right: data flows left to right.
      for (const arrow of lineage.edges) {
        expect(layout.columns.get(arrow.target)!).toBeGreaterThan(
          layout.columns.get(arrow.source)!,
        );
      }
    }
  });
});

describe("where the drawing is looked at from", () => {
  const wide: DataTableLineage = lineageOf(
    [
      up("b", -1),
      up("a", -2),
      up("z", -3),
      down("c", 1),
      down("d", 2),
      down("e", 3),
    ],
    [
      feeds("z", "a"),
      feeds("a", "b"),
      feeds("b", "focus"),
      feeds("focus", "c"),
      feeds("c", "d"),
      feeds("d", "e"),
    ],
  );

  test("a canvas with no size to go by is left to React Flow", () => {
    const layout: LineageLayout = layoutLineage(wide);

    for (const [width, height] of [
      [0, 400],
      [1000, 0],
      [NaN, 400],
      [-5, 400],
    ]) {
      expect(
        getLineageViewport({
          layout,
          focusNodeId: FOCUS,
          width: width!,
          height: height!,
        }),
      ).toBeNull();
    }
  });

  test("a drawing that fits readably is fitted and centred, never past life size", () => {
    const layout: LineageLayout = layoutLineage(
      lineageOf([up("a")], [feeds("a", "focus")]),
    );
    const viewport: LineageViewport | null = getLineageViewport({
      layout,
      focusNodeId: FOCUS,
      width: 3000,
      height: 900,
    });

    expect(viewport).toEqual({
      x: (3000 - layout.width) / 2,
      y: (900 - layout.height) / 2,
      zoom: 1,
    });
  });

  test("a drawing that fits a little smaller is fitted at the zoom that holds it", () => {
    const layout: LineageLayout = layoutLineage(wide);
    const width: number = layout.width * (1 + LINEAGE_FIT_PADDING) * 0.9;
    const viewport: LineageViewport | null = getLineageViewport({
      layout,
      focusNodeId: FOCUS,
      width,
      height: 2000,
    });

    expect(viewport!.zoom).toBeCloseTo(0.9, 9);
    expect(viewport!.zoom).toBeGreaterThanOrEqual(LINEAGE_READABLE_ZOOM);
  });

  test("a drawing too wide to read whole opens on the table itself, at the readable zoom", () => {
    const layout: LineageLayout = layoutLineage(wide);
    const viewport: LineageViewport | null = getLineageViewport({
      layout,
      focusNodeId: FOCUS,
      width: 900,
      height: 360,
    });
    const focus: LineagePoint = layout.positions.get(FOCUS)!;

    expect(viewport!.zoom).toBe(LINEAGE_READABLE_ZOOM);
    // The table's middle lands on the canvas's middle.
    expect(
      viewport!.x + (focus.x + LINEAGE_CARD_WIDTH / 2) * viewport!.zoom,
    ).toBeCloseTo(450, 9);
    expect(
      viewport!.y + (focus.y + LINEAGE_CARD_HEIGHT / 2) * viewport!.zoom,
    ).toBeCloseTo(180, 9);
  });

  test("without the table's card, the drawing's middle is shown", () => {
    const layout: LineageLayout = layoutLineage(wide);
    const viewport: LineageViewport | null = getLineageViewport({
      layout,
      focusNodeId: "table:missing",
      width: 900,
      height: 360,
    });

    expect(viewport!.x + (layout.width / 2) * viewport!.zoom).toBeCloseTo(
      450,
      9,
    );
  });
});

describe("an alert's drawing: the cards it opens on", () => {
  const A: string = getLineageTableNodeId("a");
  const B: string = getLineageTableNodeId("b");
  const C: string = getLineageTableNodeId("c");
  const D: string = getLineageTableNodeId("d");
  const Z: string = getLineageTableNodeId("z");

  // z -> a -> b -> focus -> c -> d -> e, one card a column.
  function chain(
    highlight?: Partial<DataTableLineage["highlight"]> | undefined,
  ): DataTableLineage {
    return {
      ...lineageOf(
        [
          up("b", -1),
          up("a", -2),
          up("z", -3),
          down("c", 1),
          down("d", 2),
          down("e", 3),
        ],
        [
          feeds("z", "a"),
          feeds("a", "b"),
          feeds("b", "focus"),
          feeds("focus", "c"),
          feeds("c", "d"),
          feeds("d", "e"),
        ],
      ),
      ...(highlight
        ? {
            highlight: {
              nodeIds: [],
              edgeIds: [],
              causeNodeIds: [],
              consequenceNodeIds: [],
              dataPipelineIds: [],
              ...highlight,
            },
          }
        : {}),
    };
  }

  // The cause on a, two steps up; the alert it caused on d, two steps down.
  const ways: DataTableLineage = chain({
    nodeIds: [FOCUS, B, A, C, D],
    causeNodeIds: [A],
    consequenceNodeIds: [D],
  });

  function cardsInView(lineage: DataTableLineage): Array<string> {
    return getLineageCardsInView(
      lineage,
      layoutLineage(lineage),
      getLineageHighlightSets(lineage),
    );
  }

  // Cards placed by hand, so where the view lands can be worked out exactly.
  function cardsAt(points: Record<string, [number, number]>): LineageLayout {
    const positions: Map<string, LineagePoint> = new Map();
    let width: number = 0;
    let height: number = 0;

    for (const [id, [x, y]] of Object.entries(points)) {
      positions.set(id, { x, y });
      width = Math.max(width, x + LINEAGE_CARD_WIDTH);
      height = Math.max(height, y + LINEAGE_CARD_HEIGHT);
    }

    return { positions, columns: new Map(), width, height };
  }

  // A canvas whose room at the readable zoom, kept clear of its edges, is `room` across (and as high).
  function canvasFor(room: number): number {
    return room * LINEAGE_READABLE_ZOOM * (1 + LINEAGE_FIT_PADDING);
  }

  // Where on the drawing the canvas's middle is.
  function middleOf(
    viewport: LineageViewport,
    size: { width: number; height: number },
  ): LineagePoint {
    return {
      x: (size.width / 2 - viewport.x) / viewport.zoom,
      y: (size.height / 2 - viewport.y) / viewport.zoom,
    };
  }

  // Where a point of the drawing lands on the canvas, across.
  function onCanvas(viewport: LineageViewport, x: number): number {
    return viewport.x + x * viewport.zoom;
  }

  describe("which cards, the most wanted first", () => {
    test("a drawing with no ways keeps only its own card in view", () => {
      expect(cardsInView(chain())).toEqual([FOCUS]);
      expect(
        getLineageCardsInView(chain(), layoutLineage(chain()), null),
      ).toEqual([FOCUS]);
    });

    test("the cause first, then the alert's own card, then the alerts it caused, then the rest of the ways", () => {
      expect(cardsInView(ways)).toEqual([A, FOCUS, D, B, C]);
    });

    test("an alert that caused others but has no cause: its own card first", () => {
      expect(
        cardsInView(chain({ nodeIds: [FOCUS, C, D], consequenceNodeIds: [D] })),
      ).toEqual([FOCUS, D, C]);
    });

    test("several causes, and several alerts caused: the nearest first", () => {
      // b is a step up and a two: nearest first is not the order of their ids.
      expect(
        cardsInView(
          chain({
            nodeIds: [FOCUS, Z, A, B, C, D],
            causeNodeIds: [A, B],
            consequenceNodeIds: [D, C],
          }),
        ),
      ).toEqual([B, A, FOCUS, C, D, Z]);
    });

    test("as near as each other: in the order of their ids, the same every time", () => {
      const lineage: DataTableLineage = {
        ...lineageOf(
          [up("y", -1), up("x", -1)],
          [feeds("y", "focus"), feeds("x", "focus")],
        ),
        highlight: {
          nodeIds: [
            FOCUS,
            getLineageTableNodeId("y"),
            getLineageTableNodeId("x"),
          ],
          edgeIds: [],
          causeNodeIds: [
            getLineageTableNodeId("y"),
            getLineageTableNodeId("x"),
          ],
          consequenceNodeIds: [],
          dataPipelineIds: [],
        },
      };

      expect(cardsInView(lineage)).toEqual([
        getLineageTableNodeId("x"),
        getLineageTableNodeId("y"),
        FOCUS,
      ]);
    });

    test("a card named twice is kept once, as a cause; the alert's own card once; a card not drawn never", () => {
      const ghost: string = getLineageTableNodeId("ghost");

      expect(
        cardsInView(
          chain({
            nodeIds: [FOCUS, A, D, ghost],
            causeNodeIds: [A, ghost],
            consequenceNodeIds: [A, FOCUS, D, ghost],
          }),
        ),
      ).toEqual([A, FOCUS, D]);
    });
  });

  describe("where the view lands", () => {
    // Columns as the layout spaces them, all in one row.
    const COLUMN_X: (column: number) => number = (column: number): number => {
      return column * COLUMN;
    };
    const row: LineageLayout = cardsAt({
      [Z]: [COLUMN_X(0), 0],
      [A]: [COLUMN_X(1), 0],
      [B]: [COLUMN_X(2), 0],
      [FOCUS]: [COLUMN_X(3), 0],
      [C]: [COLUMN_X(4), 0],
      [D]: [COLUMN_X(5), 0],
    });
    const HEIGHT: number = 400;

    function viewOf(
      layout: LineageLayout,
      width: number,
      inView?: ReadonlyArray<string> | undefined,
      height: number = HEIGHT,
    ): LineageViewport {
      const viewport: LineageViewport | null = getLineageViewport({
        layout,
        focusNodeId: FOCUS,
        width,
        height,
        ...(inView ? { inView } : {}),
      });

      expect(viewport).not.toBeNull();
      // Never past what keeps a card's name readable.
      expect(viewport!.zoom).toBe(LINEAGE_READABLE_ZOOM);

      return viewport!;
    }

    test("only the drawing's own card named, or none: the same view as a table's drawing", () => {
      const width: number = canvasFor(600);
      const plain: LineageViewport = viewOf(row, width);

      expect(viewOf(row, width, [FOCUS])).toEqual(plain);
      expect(viewOf(row, width, [])).toEqual(plain);
      // The table's middle on the canvas's middle.
      expect(middleOf(plain, { width, height: HEIGHT }).x).toBeCloseTo(
        COLUMN_X(3) + LINEAGE_CARD_WIDTH / 2,
        9,
      );
    });

    test("the cause and the alert's own card both fit: both in view, leaning toward the next card wanted", () => {
      // Room for a to focus (2 columns and a card) and 40 more, not for d.
      const span: number = COLUMN_X(3) + LINEAGE_CARD_WIDTH - COLUMN_X(1);
      const width: number = canvasFor(span + 40);
      const viewport: LineageViewport = viewOf(row, width, [A, FOCUS, D, B]);

      expect(onCanvas(viewport, COLUMN_X(1))).toBeGreaterThan(0);
      expect(onCanvas(viewport, COLUMN_X(3) + LINEAGE_CARD_WIDTH)).toBeLessThan(
        width,
      );
      // Toward d by all the room there is: half of the 40.
      expect(middleOf(viewport, { width, height: HEIGHT }).x).toBeCloseTo(
        COLUMN_X(1) + span / 2 + 20,
        9,
      );
      // One row: across only.
      expect(middleOf(viewport, { width, height: HEIGHT }).y).toBeCloseTo(
        LINEAGE_CARD_HEIGHT / 2,
        9,
      );
    });

    test("everything wanted fits: the cards' own middle, leaning nowhere", () => {
      const span: number = COLUMN_X(5) + LINEAGE_CARD_WIDTH - COLUMN_X(1);
      const width: number = canvasFor(span + 40);
      const viewport: LineageViewport = viewOf(row, width, [A, FOCUS, D]);

      expect(middleOf(viewport, { width, height: HEIGHT }).x).toBeCloseTo(
        COLUMN_X(1) + span / 2,
        9,
      );
    });

    test("too narrow for both: the cause alone, at the side the alert is on, so the way to it starts on screen", () => {
      const width: number = canvasFor(LINEAGE_CARD_WIDTH + 100);
      const viewport: LineageViewport = viewOf(row, width, [A, FOCUS, D]);
      // The room's edge on the canvas: what a fitted drawing keeps clear.
      const edge: number = (width - width / (1 + LINEAGE_FIT_PADDING)) / 2;

      expect(onCanvas(viewport, COLUMN_X(1))).toBeCloseTo(edge, 9);
      expect(onCanvas(viewport, COLUMN_X(1) + LINEAGE_CARD_WIDTH)).toBeLessThan(
        width - edge + 1e-9,
      );
      // The alert's own card is a drag away, to the right.
      expect(onCanvas(viewport, COLUMN_X(3))).toBeGreaterThan(width);
    });

    test("narrower than a card: still the cause, its middle on the canvas's middle", () => {
      const width: number = 120;
      const viewport: LineageViewport = viewOf(row, width, [A, FOCUS]);

      expect(middleOf(viewport, { width, height: HEIGHT }).x).toBeCloseTo(
        COLUMN_X(1) + LINEAGE_CARD_WIDTH / 2,
        9,
      );
    });

    test("a card that does not fit is passed over for later ones that do, and the view leans toward the first passed over", () => {
      // Room for b and focus, not for d; b comes after d, on the other side.
      const span: number = COLUMN_X(3) + LINEAGE_CARD_WIDTH - COLUMN_X(2);
      const width: number = canvasFor(span + 72);
      const viewport: LineageViewport = viewOf(row, width, [FOCUS, D, B]);

      expect(onCanvas(viewport, COLUMN_X(2))).toBeGreaterThan(0);
      expect(onCanvas(viewport, COLUMN_X(3) + LINEAGE_CARD_WIDTH)).toBeLessThan(
        width,
      );
      expect(middleOf(viewport, { width, height: HEIGHT }).x).toBeCloseTo(
        COLUMN_X(2) + span / 2 + 36,
        9,
      );
    });

    test("a card between two kept is in view without asking", () => {
      // Room for focus to d, not for z: c sits between them.
      const span: number = COLUMN_X(5) + LINEAGE_CARD_WIDTH - COLUMN_X(3);
      const width: number = canvasFor(span + 10);
      const viewport: LineageViewport = viewOf(row, width, [FOCUS, Z, D]);

      for (const x of [COLUMN_X(3), COLUMN_X(4), COLUMN_X(5)]) {
        expect(onCanvas(viewport, x)).toBeGreaterThan(0);
        expect(onCanvas(viewport, x + LINEAGE_CARD_WIDTH)).toBeLessThan(width);
      }
    });

    test("leaning left as readily as right", () => {
      // Room for b and focus, not for z.
      const span: number = COLUMN_X(3) + LINEAGE_CARD_WIDTH - COLUMN_X(2);
      const width: number = canvasFor(span + 72);
      const viewport: LineageViewport = viewOf(row, width, [FOCUS, B, Z]);

      expect(middleOf(viewport, { width, height: HEIGHT }).x).toBeCloseTo(
        COLUMN_X(2) + span / 2 - 36,
        9,
      );
    });

    test("leaning down toward a card further down, but never so far the cards wanted leave the room", () => {
      const tall: LineageLayout = cardsAt({
        [A]: [0, 0],
        [FOCUS]: [COLUMN_X(1), 0],
        [D]: [COLUMN_X(6), 1000],
      });
      const room: number = COLUMN_X(1) + LINEAGE_CARD_WIDTH + 100;
      const width: number = canvasFor(room);
      const height: number = canvasFor(room);
      const viewport: LineageViewport = viewOf(
        tall,
        width,
        [A, FOCUS, D],
        height,
      );
      const middle: LineagePoint = middleOf(viewport, { width, height });

      // As far down as the room allows: the cards' top on the room's top.
      expect(middle.y).toBeCloseTo(room / 2, 9);
      expect(middle.x).toBeCloseTo(
        (COLUMN_X(1) + LINEAGE_CARD_WIDTH) / 2 + 50,
        9,
      );
    });

    test("cards named that are not drawn are skipped; none drawn at all shows the drawing's middle", () => {
      const width: number = canvasFor(600);

      expect(viewOf(row, width, ["table:ghost", FOCUS])).toEqual(
        viewOf(row, width, [FOCUS]),
      );
      expect(
        middleOf(viewOf(row, width, ["table:ghost"]), {
          width,
          height: HEIGHT,
        }).x,
      ).toBeCloseTo(row.width / 2, 9);
    });

    test("a drawing that fits whole is fitted whole, whatever is named", () => {
      const width: number = 3000;
      const small: LineageLayout = cardsAt({
        [A]: [0, 0],
        [FOCUS]: [COLUMN_X(1), 0],
      });

      expect(
        getLineageViewport({
          layout: small,
          focusNodeId: FOCUS,
          width,
          height: 900,
          inView: [A, FOCUS],
        }),
      ).toEqual(
        getLineageViewport({
          layout: small,
          focusNodeId: FOCUS,
          width,
          height: 900,
        }),
      );
    });

    test("an alert's drawing laid out as it is drawn: the cause in view", () => {
      const layout: LineageLayout = layoutLineage(ways);
      const cause: LineagePoint = layout.positions.get(A)!;
      const focus: LineagePoint = layout.positions.get(FOCUS)!;
      const width: number = canvasFor(
        focus.x + LINEAGE_CARD_WIDTH - cause.x + 40,
      );
      const viewport: LineageViewport | null = getLineageViewport({
        layout,
        focusNodeId: FOCUS,
        width,
        height: HEIGHT,
        inView: cardsInView(ways),
      });

      expect(viewport!.zoom).toBe(LINEAGE_READABLE_ZOOM);
      expect(onCanvas(viewport!, cause.x)).toBeGreaterThan(0);
      expect(onCanvas(viewport!, focus.x + LINEAGE_CARD_WIDTH)).toBeLessThan(
        width,
      );

      // Opened on the alert's own card, as a table's drawing is, the cause would be off the canvas.
      const plain: LineageViewport | null = getLineageViewport({
        layout,
        focusNodeId: FOCUS,
        width,
        height: HEIGHT,
      });

      expect(onCanvas(plain!, cause.x)).toBeLessThan(0);
    });
  });
});

describe("how a card looks", () => {
  test.each([
    ["dropped", { isDropped: true, openAlertCount: 2 }, LineageTone.Dropped],
    ["with an open alert", { openAlertCount: 1 }, LineageTone.Problem],
    ["late", { freshness: DataAssetFreshness.Late }, LineageTone.Problem],
    ["fresh", { freshness: DataAssetFreshness.Fresh }, LineageTone.Healthy],
    [
      "learning",
      { freshness: DataAssetFreshness.Unknown },
      LineageTone.Neutral,
    ],
    [
      "a view",
      { freshness: DataAssetFreshness.NotApplicable },
      LineageTone.Neutral,
    ],
  ])(
    "a table %s",
    (
      _name: string,
      fields: Partial<DataTableLineageNode>,
      tone: LineageTone,
    ) => {
      expect(
        getLineageNodeTone(
          tableNode("t", DataLineageSide.Upstream, -1, fields),
        ),
      ).toBe(tone);
    },
  );

  test.each([
    ["FAIL", LineageTone.Problem],
    ["ABORT", LineageTone.Problem],
    ["START", LineageTone.Running],
    ["RUNNING", LineageTone.Running],
    ["COMPLETE", LineageTone.Healthy],
    ["RESCHEDULED", LineageTone.Neutral],
    [null, LineageTone.Neutral],
  ])(
    "a pipeline whose latest run is %p",
    (state: string | null, tone: LineageTone) => {
      expect(
        getLineageNodeTone(pipelineNode("p", { lastRunState: state })),
      ).toBe(tone);
    },
  );

  test("a dashboard says nothing of its health", () => {
    expect(getLineageNodeTone(dashboardNode("board"))).toBe(
      LineageTone.Neutral,
    );
  });
});

describe("how an arrow looks", () => {
  const failed: DataTableLineagePipeline = {
    dataPipelineId: "p1",
    name: "orders_etl",
    lastRunState: "FAIL",
  };
  const complete: DataTableLineagePipeline = {
    dataPipelineId: "p2",
    name: "audit_etl",
    lastRunState: "COMPLETE",
  };

  test("a pipeline's run is solid, query history dashed, a view dotted", () => {
    expect(getLineageEdgeStyle(feeds("a", "b")).dash).toBeNull();
    expect(
      getLineageEdgeStyle(
        feeds("a", "b", { seenIn: [DataAssetLineageSource.QueryHistory] }),
      ).dash,
    ).toBe(LINEAGE_QUERY_HISTORY_DASH);
    expect(
      getLineageEdgeStyle(
        feeds("a", "b", { seenIn: [DataAssetLineageSource.ViewDefinition] }),
      ).dash,
    ).toBe(LINEAGE_VIEW_DEFINITION_DASH);
    // Seen by a pipeline as well as in query history: a pipeline moves it.
    expect(
      getLineageEdgeStyle(
        feeds("a", "b", {
          seenIn: [
            DataAssetLineageSource.Pipeline,
            DataAssetLineageSource.QueryHistory,
          ],
        }),
      ).dash,
    ).toBeNull();
  });

  test("an arrow whose pipeline's latest run failed is red and names it", () => {
    const style: ReturnType<typeof getLineageEdgeStyle> = getLineageEdgeStyle(
      feeds("a", "b", { pipelines: [failed, complete] }),
    );

    expect(style.color).toBe(LINEAGE_PROBLEM_COLOR);
    expect(style.failedPipeline).toEqual(failed);
    expect(style.width).toBeGreaterThan(
      getLineageEdgeStyle(feeds("a", "b", { pipelines: [complete] })).width,
    );
    expect(
      getLineageEdgeStyle(feeds("a", "b", { pipelines: [complete] })),
    ).toEqual({
      color: LINEAGE_NEUTRAL_COLOR,
      width: 1.5,
      dash: null,
      failedPipeline: null,
    });
  });

  test("a failed pipeline writing a table from outside is red too", () => {
    expect(
      getLineageEdgeStyle(
        edge(DataLineageEdgeKind.Writes, "pipeline:p1", FOCUS, {
          pipelines: [failed],
        }),
      ).color,
    ).toBe(LINEAGE_PROBLEM_COLOR);
  });

  test("a dashboard's read is a light solid line", () => {
    expect(
      getLineageEdgeStyle(
        edge(DataLineageEdgeKind.Reads, FOCUS, "dashboard:d"),
      ),
    ).toEqual({
      color: LINEAGE_READS_COLOR,
      width: 1.25,
      dash: null,
      failedPipeline: null,
    });
  });
});

describe("what the diagram sums up", () => {
  test("tables each way, dashboards, and problems each way, the table itself not counted", () => {
    const lineage: DataTableLineage = lineageOf(
      [
        tableNode("a", DataLineageSide.Upstream, -1, {
          freshness: DataAssetFreshness.Late,
        }),
        up("b"),
        pipelineNode("sync", { lastRunState: "FAIL" }),
        tableNode("c", DataLineageSide.Downstream, 1, { openAlertCount: 3 }),
        down("d"),
        down("e"),
        dashboardNode("board"),
      ],
      [],
    );

    // The table's own open alert is not a problem upstream or downstream.
    lineage.nodes[0] = tableNode("focus", DataLineageSide.Focus, 0, {
      openAlertCount: 1,
    });

    expect(summarizeLineage(lineage)).toEqual({
      upstreamTables: 2,
      downstreamTables: 3,
      dashboards: 1,
      // A late table and a failed pipeline.
      upstreamProblems: 2,
      downstreamProblems: 1,
    });
  });

  test("a table with no lineage is empty; one with any card is not", () => {
    expect(isLineageEmpty(lineageOf([], []))).toBe(true);
    expect(isLineageEmpty(lineageOf([up("a")], [feeds("a", "focus")]))).toBe(
      false,
    );
    expect(isLineageEmpty(lineageOf([dashboardNode("board")], []))).toBe(false);
  });
});

describe("a table's Lineage tab", () => {
  const DASHBOARD_SRC: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
  );

  test("draws the diagram first, then the dashboards and the one-step lists", () => {
    const page: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Pages",
        "DataObservability",
        "TableView",
        "Lineage.tsx",
      ),
      "utf8",
    );
    const squashed: string = page.replace(/\s+/g, " ");
    // With the table's columns in its own order: one of them can be followed on the diagram.
    const diagram: number = squashed.indexOf(
      "<TableLineageDiagram dataAssetId={dataAssetId} columnOrder={columnOrder} />",
    );

    expect(diagram).toBeGreaterThan(-1);
    expect(diagram).toBeLessThan(squashed.indexOf("<TableDashboards"));
    expect(diagram).toBeLessThan(
      squashed.indexOf('id="data-observability-table-upstream"'),
    );
    expect(squashed).toContain(
      "readDataAssetColumns(dataAsset?.columns).map(",
    );
  });

  test("asks the table-lineage route, and the route that draws more, through the Dashboard's own client", () => {
    const api: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "DataObservability",
        "DataObservabilityApi.ts",
      ),
      "utf8",
    );

    expect(api).toContain("DATA_OBSERVABILITY_API_ROUTES.tableLineage");
    expect(api).toContain("DATA_OBSERVABILITY_API_ROUTES.lineageExpand");
  });
});

/*
 * A pipeline's drawing: the pipeline in the middle ("etl"), the tables it
 * reads a column before it, the tables it writes a column after, and the
 * walk going on from those.
 */
const ETL: string = getLineagePipelineNodeId("etl");

function pipelineLineageOf(
  nodes: Array<DataTableLineageNode>,
  edges: Array<DataTableLineageEdge>,
  focus: Partial<DataTableLineageNode> = {},
): DataTableLineage {
  return {
    focusNodeId: ETL,
    depth: 1,
    nodes: [
      pipelineNode("etl", {
        side: DataLineageSide.Focus,
        depth: 0,
        hiddenUpstreamCount: 0,
        hiddenDownstreamCount: 0,
        ...focus,
      }),
      ...nodes,
    ],
    edges,
    hiddenDashboardCount: 0,
    isTruncated: false,
  };
}

// The pipeline's read of a table, and its write of one.
function readsInto(name: string): DataTableLineageEdge {
  return edge(DataLineageEdgeKind.Reads, getLineageTableNodeId(name), ETL, {
    seenIn: [DataAssetLineageSource.Pipeline],
  });
}

function writesOut(
  name: string,
  fields: Partial<DataTableLineageEdge> = {},
): DataTableLineageEdge {
  return edge(DataLineageEdgeKind.Writes, ETL, getLineageTableNodeId(name), {
    pipelines: [
      { dataPipelineId: "etl", name: "etl", lastRunState: "COMPLETE" },
    ],
    ...fields,
  });
}

describe("a pipeline's drawing", () => {
  test("what it reads sits a column before it, what it writes a column after, and the walk goes on from them", () => {
    const columns: Map<string, number> = getLineageColumns(
      pipelineLineageOf(
        [up("a", -1), up("b", -1), up("x", -2), down("c", 1), down("d", 2)],
        [
          readsInto("a"),
          readsInto("b"),
          feeds("x", "a"),
          writesOut("c"),
          feeds("c", "d"),
        ],
      ),
    );

    expect(columns.get(ETL)).toBe(0);
    expect(columnOf(columns, "a")).toBe(-1);
    expect(columnOf(columns, "b")).toBe(-1);
    expect(columnOf(columns, "x")).toBe(-2);
    expect(columnOf(columns, "c")).toBe(1);
    expect(columnOf(columns, "d")).toBe(2);
  });

  test("a table it reads that feeds another it reads sits further left, so every arrow points right", () => {
    const columns: Map<string, number> = getLineageColumns(
      pipelineLineageOf(
        [up("a", -1), up("b", -1), down("c", 1)],
        [readsInto("a"), readsInto("b"), feeds("a", "b"), writesOut("c")],
      ),
    );

    expect(columnOf(columns, "b")).toBe(-1);
    expect(columnOf(columns, "a")).toBe(-2);
  });

  test("a pipeline loading a table it reads sits a column before that table; the pipeline it is about stays in the middle", () => {
    const columns: Map<string, number> = getLineageColumns(
      pipelineLineageOf(
        [up("a", -1), pipelineNode("sync", { depth: -2 }), down("c", 1)],
        [
          readsInto("a"),
          edge(
            DataLineageEdgeKind.Writes,
            getLineagePipelineNodeId("sync"),
            getLineageTableNodeId("a"),
          ),
          writesOut("c"),
        ],
      ),
    );

    expect(columns.get(getLineagePipelineNodeId("sync"))).toBe(-2);
    expect(columns.get(ETL)).toBe(0);
  });

  test("laid out, every arrow points right, the pipeline between what it reads and what it writes", () => {
    const layout: LineageLayout = layoutLineage(
      pipelineLineageOf(
        [up("a", -1), up("b", -1), up("x", -2), down("c", 1), down("d", 2)],
        [
          readsInto("a"),
          readsInto("b"),
          feeds("x", "a"),
          writesOut("c"),
          writesOut("d"),
          feeds("c", "d"),
        ],
      ),
    );
    const x: (id: string) => number = (id: string): number => {
      return layout.positions.get(id)!.x;
    };

    for (const [source, target] of [
      [getLineageTableNodeId("a"), ETL],
      [getLineageTableNodeId("x"), getLineageTableNodeId("a")],
      [ETL, getLineageTableNodeId("c")],
      [ETL, getLineageTableNodeId("d")],
      [getLineageTableNodeId("c"), getLineageTableNodeId("d")],
    ] as Array<[string, string]>) {
      expect(x(source)).toBeLessThan(x(target));
    }
  });

  test("its read of a table is drawn as any arrow into it; a dashboard's read stays light", () => {
    expect(getLineageEdgeStyle(readsInto("a"))).toEqual({
      color: LINEAGE_NEUTRAL_COLOR,
      width: 1.5,
      dash: null,
      failedPipeline: null,
    });
    expect(
      getLineageEdgeStyle(edge(DataLineageEdgeKind.Reads, FOCUS, "dashboard:d"))
        .color,
    ).toBe(LINEAGE_READS_COLOR);
  });

  test("how many tables it reads and writes: the arrows into and out of it, and the counts on its card", () => {
    expect(
      countPipelineTables(
        pipelineLineageOf(
          [up("a", -1), up("b", -1), down("c", 1), down("d", 2)],
          [
            readsInto("a"),
            readsInto("b"),
            writesOut("c"),
            // Further down: not one it writes.
            feeds("c", "d"),
          ],
          { hiddenUpstreamCount: 4, hiddenDownstreamCount: 1 },
        ),
      ),
    ).toEqual({ reads: 6, writes: 2 });
    expect(countPipelineTables(pipelineLineageOf([], []))).toEqual({
      reads: 0,
      writes: 0,
    });
  });

  test("a pipeline alone is a drawing with nothing in it", () => {
    expect(isLineageEmpty(pipelineLineageOf([], []))).toBe(true);
    expect(
      isLineageEmpty(pipelineLineageOf([up("a", -1)], [readsInto("a")])),
    ).toBe(false);
  });
});

describe("an alert's drawing: the ways it picks out", () => {
  const failed: DataTableLineagePipeline = {
    dataPipelineId: "p1",
    name: "orders_etl",
    lastRunState: "FAIL",
  };
  const onTheWay: DataTableLineagePipeline = {
    dataPipelineId: "p2",
    name: "orders_mart",
    lastRunState: "COMPLETE",
  };

  // focus <- a <- cause, focus -> b (a consequence), and c off the ways.
  function withWays(
    edges: Array<DataTableLineageEdge> = [
      feeds("cause", "a"),
      feeds("a", "focus"),
      feeds("focus", "b", { pipelines: [onTheWay] }),
      feeds("c", "focus"),
    ],
  ): DataTableLineage {
    return {
      ...lineageOf(
        [up("a", -1), up("cause", -2), up("c", -1), down("b", 1)],
        edges,
      ),
      highlight: {
        nodeIds: [
          FOCUS,
          getLineageTableNodeId("a"),
          getLineageTableNodeId("cause"),
          getLineageTableNodeId("b"),
        ],
        edgeIds: [
          feeds("cause", "a").id,
          feeds("a", "focus").id,
          feeds("focus", "b").id,
        ],
        causeNodeIds: [getLineageTableNodeId("cause")],
        consequenceNodeIds: [getLineageTableNodeId("b")],
        dataPipelineIds: ["p2"],
      },
    };
  }

  test("no ways: nothing to look up, nothing faint, no card named", () => {
    expect(getLineageHighlightSets(lineageOf([], []))).toBeNull();
    expect(
      getLineageHighlightSets({
        ...lineageOf([], []),
        highlight: {
          nodeIds: [],
          edgeIds: [],
          causeNodeIds: [],
          consequenceNodeIds: [],
          dataPipelineIds: [],
        },
      }),
    ).toBeNull();
    expect(isLineageCardDimmed(null, FOCUS)).toBe(false);
    expect(getLineageCardRole(null, FOCUS)).toBeNull();
  });

  test("the cause's card and each consequence's are named; the rest of a way's cards are not", () => {
    const sets: LineageHighlightSets = getLineageHighlightSets(withWays())!;

    expect(getLineageCardRole(sets, getLineageTableNodeId("cause"))).toBe(
      LineageCardRole.Cause,
    );
    expect(getLineageCardRole(sets, getLineageTableNodeId("b"))).toBe(
      LineageCardRole.Consequence,
    );
    expect(getLineageCardRole(sets, getLineageTableNodeId("a"))).toBeNull();
    expect(getLineageCardRole(sets, FOCUS)).toBeNull();
  });

  test("a card is faint only off every way", () => {
    const sets: LineageHighlightSets = getLineageHighlightSets(withWays())!;

    for (const name of ["focus", "a", "cause", "b"]) {
      expect(isLineageCardDimmed(sets, getLineageTableNodeId(name))).toBe(
        false,
      );
    }

    expect(isLineageCardDimmed(sets, getLineageTableNodeId("c"))).toBe(true);
  });

  test("an arrow on a way is indigo and wide, the line it was seen as kept; one off the ways faint", () => {
    const lineage: DataTableLineage = withWays([
      feeds("cause", "a", { seenIn: [DataAssetLineageSource.QueryHistory] }),
      feeds("a", "focus"),
      feeds("focus", "b", { pipelines: [onTheWay] }),
      feeds("c", "focus"),
    ]);
    const sets: LineageHighlightSets = getLineageHighlightSets(lineage)!;
    const way: LineageArrowLook = getLineageArrowLook(
      lineage.edges[0]!,
      FOCUS,
      sets,
    );
    const off: LineageArrowLook = getLineageArrowLook(
      lineage.edges[3]!,
      FOCUS,
      sets,
    );

    expect(way).toEqual({
      color: LINEAGE_HIGHLIGHT_COLOR,
      width: LINEAGE_HIGHLIGHT_WIDTH,
      dash: LINEAGE_QUERY_HISTORY_DASH,
      label: null,
      isHighlighted: true,
      isDimmed: false,
    });
    expect(off).toEqual({
      color: LINEAGE_NEUTRAL_COLOR,
      width: 1.5,
      dash: null,
      label: null,
      isHighlighted: false,
      isDimmed: true,
    });
  });

  test("an arrow whose run failed stays red on a way", () => {
    const lineage: DataTableLineage = withWays([
      feeds("cause", "a"),
      feeds("a", "focus", { pipelines: [failed] }),
      feeds("focus", "b"),
      feeds("c", "focus"),
    ]);
    const look: LineageArrowLook = getLineageArrowLook(
      lineage.edges[1]!,
      FOCUS,
      getLineageHighlightSets(lineage),
    );

    expect(look.color).toBe(LINEAGE_PROBLEM_COLOR);
    expect(look.width).toBeGreaterThanOrEqual(LINEAGE_HIGHLIGHT_WIDTH);
    expect(look.label).toEqual({ pipeline: failed, isFailed: true });
    expect(look.isHighlighted).toBe(true);
  });

  test("without ways, an arrow looks as a table's drawing draws it", () => {
    const arrow: DataTableLineageEdge = feeds("a", "focus", {
      pipelines: [failed],
    });
    const style: ReturnType<typeof getLineageEdgeStyle> =
      getLineageEdgeStyle(arrow);

    expect(getLineageArrowLook(arrow, FOCUS, null)).toEqual({
      color: style.color,
      width: style.width,
      dash: style.dash,
      label: { pipeline: failed, isFailed: true },
      isHighlighted: false,
      isDimmed: false,
    });
  });

  test("a pipeline on a way is named on its arrow, not failed; off the ways it is not named", () => {
    const lineage: DataTableLineage = withWays();
    const sets: LineageHighlightSets = getLineageHighlightSets(lineage)!;

    expect(getLineageEdgeLabel(lineage.edges[2]!, FOCUS, sets)).toEqual({
      pipeline: onTheWay,
      isFailed: false,
    });
    // The same pipeline on an arrow off the ways: nothing.
    expect(
      getLineageEdgeLabel(
        feeds("c", "focus", { pipelines: [onTheWay] }),
        FOCUS,
        sets,
      ),
    ).toBeNull();
    // A pipeline not picked out, on a way: nothing.
    expect(
      getLineageEdgeLabel(
        feeds("a", "focus", {
          pipelines: [{ ...onTheWay, dataPipelineId: "p9" }],
        }),
        FOCUS,
        sets,
      ),
    ).toBeNull();
  });

  test("a failed run is named before a pipeline on the way", () => {
    const lineage: DataTableLineage = withWays([
      feeds("cause", "a"),
      feeds("a", "focus"),
      feeds("focus", "b", { pipelines: [onTheWay, failed] }),
      feeds("c", "focus"),
    ]);

    expect(
      getLineageEdgeLabel(
        lineage.edges[2]!,
        FOCUS,
        getLineageHighlightSets(lineage),
      ),
    ).toEqual({ pipeline: failed, isFailed: true });
  });

  test("never a pipeline whose card starts the arrow, nor the pipeline the drawing is about", () => {
    const sets: LineageHighlightSets = getLineageHighlightSets(withWays())!;
    const fromItsCard: DataTableLineageEdge = edge(
      DataLineageEdgeKind.Writes,
      getLineagePipelineNodeId("p1"),
      getLineageTableNodeId("a"),
      { pipelines: [failed] },
    );

    expect(getLineageEdgeLabel(fromItsCard, FOCUS, sets)).toBeNull();
    expect(
      getLineageEdgeLabel(
        writesOut("c", {
          pipelines: [
            { dataPipelineId: "etl", name: "etl", lastRunState: "FAIL" },
          ],
        }),
        ETL,
        null,
      ),
    ).toBeNull();
  });
});

describe("a pipeline's page and a data alert's page", () => {
  const DASHBOARD_SRC: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
  );

  function source(...parts: Array<string>): string {
    return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
  }

  test("a pipeline's page draws its lineage after its stats and before its runs", () => {
    const page: string = source(
      "Pages",
      "DataPipeline",
      "View",
      "Overview.tsx",
    );
    const diagram: number = page.indexOf(
      "<PipelineLineageDiagram dataPipelineId={dataPipelineId} />",
    );

    expect(diagram).toBeGreaterThan(-1);
    expect(diagram).toBeGreaterThan(page.indexOf("</EventStatBar>"));
    expect(diagram).toBeLessThan(page.indexOf("<ModelTable<DataPipelineRun>"));
  });

  test("a data alert's page draws its lineage after its Data card, only for an alert about a table or pipeline", () => {
    const card: string = source(
      "Components",
      "DataObservability",
      "DataAlertLineage.tsx",
    );
    const diagram: number = card.indexOf(
      "<AlertLineageDiagram alertId={props.alertId} />",
    );

    expect(diagram).toBeGreaterThan(card.indexOf('title="Data"'));
    expect(diagram).toBeLessThan(card.indexOf("<DataAlertExplanationCard"));
    expect(card.slice(diagram - 120, diagram)).toContain(
      "own?.dataAssetId || own?.dataPipelineId ?",
    );
  });

  test("both ask their routes through the Dashboard's own client", () => {
    const api: string = source(
      "Components",
      "DataObservability",
      "DataObservabilityApi.ts",
    );

    expect(api).toContain("DATA_OBSERVABILITY_API_ROUTES.pipelineLineage");
    expect(api).toContain(
      "DATA_OBSERVABILITY_API_ROUTES.alertLineage(alertId.toString())",
    );
  });
});
