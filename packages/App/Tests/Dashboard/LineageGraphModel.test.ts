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
import {
  SeededRandom,
  seededRandom,
} from "Common/Tests/Helpers/SeededRandom";
import {
  LINEAGE_CARD_HEIGHT,
  LINEAGE_CARD_WIDTH,
  LINEAGE_COLUMN_GAP,
  LINEAGE_NEUTRAL_COLOR,
  LINEAGE_PROBLEM_COLOR,
  LINEAGE_FIT_PADDING,
  LINEAGE_QUERY_HISTORY_DASH,
  LINEAGE_READABLE_ZOOM,
  LINEAGE_READS_COLOR,
  LINEAGE_ROW_GAP,
  LINEAGE_VIEW_DEFINITION_DASH,
  LineageLayout,
  LineagePoint,
  LineageTone,
  LineageViewport,
  fitHeights,
  getLineageColumns,
  getLineageEdgeStyle,
  getLineageNodeTone,
  getLineageViewport,
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
    seenIn: kind === DataLineageEdgeKind.Reads ? [] : [DataAssetLineageSource.Pipeline],
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
        [feeds("a", "b"), feeds("b", "focus"), feeds("focus", "c"), feeds("c", "d")],
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
          edge(DataLineageEdgeKind.Reads, getLineageTableNodeId("d"), revenue.id),
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
      Array.from(layout.positions.values()).map((point: LineagePoint): number => {
        return point.y;
      }),
    );

    expect(heights.size).toBe(1);
    expect(layout.positions.get(getLineageTableNodeId("a"))!.x).toBe(0);
    expect(layout.positions.get(FOCUS)!.x).toBe(2 * COLUMN);
    expect(layout.positions.get(getLineageTableNodeId("c"))!.x).toBe(3 * COLUMN);
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

            if (!edges.some((existing) => {
              return existing.id === feeds(name, target).id;
            })) {
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
        getLineageViewport({ layout, focusNodeId: FOCUS, width: width!, height: height! }),
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

describe("how a card looks", () => {
  test.each([
    ["dropped", { isDropped: true, openAlertCount: 2 }, LineageTone.Dropped],
    ["with an open alert", { openAlertCount: 1 }, LineageTone.Problem],
    ["late", { freshness: DataAssetFreshness.Late }, LineageTone.Problem],
    ["fresh", { freshness: DataAssetFreshness.Fresh }, LineageTone.Healthy],
    ["learning", { freshness: DataAssetFreshness.Unknown }, LineageTone.Neutral],
    ["a view", { freshness: DataAssetFreshness.NotApplicable }, LineageTone.Neutral],
  ])(
    "a table %s",
    (_name: string, fields: Partial<DataTableLineageNode>, tone: LineageTone) => {
      expect(
        getLineageNodeTone(tableNode("t", DataLineageSide.Upstream, -1, fields)),
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
  ])("a pipeline whose latest run is %p", (state: string | null, tone: LineageTone) => {
    expect(getLineageNodeTone(pipelineNode("p", { lastRunState: state }))).toBe(
      tone,
    );
  });

  test("a dashboard says nothing of its health", () => {
    expect(getLineageNodeTone(dashboardNode("board"))).toBe(LineageTone.Neutral);
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
      getLineageEdgeStyle(edge(DataLineageEdgeKind.Reads, FOCUS, "dashboard:d")),
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
    const diagram: number = page.indexOf(
      "<TableLineageDiagram dataAssetId={dataAssetId} />",
    );

    expect(diagram).toBeGreaterThan(-1);
    expect(diagram).toBeLessThan(page.indexOf("<TableDashboards"));
    expect(diagram).toBeLessThan(page.indexOf('id="data-observability-table-upstream"'));
  });

  test("asks the table-lineage route through the Dashboard's own client", () => {
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
  });
});
