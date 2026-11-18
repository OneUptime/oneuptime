import { describe, expect, test } from "@jest/globals";
import { DataAssetFreshness } from "Common/Types/DataObservability/DataAssetFreshness";
import {
  DataLineageMap,
  DataLineageMapEdge,
  DataLineageMapEdgeKind,
  DataLineageMapEvidence,
  DataLineageMapNode,
  DataLineageMapNodeKind,
} from "Common/Types/DataObservability/DataLineageMap";
import { LineageTone } from "../../FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";
import {
  EMPTY_LINEAGE_MAP_FILTER,
  LINEAGE_MAP_CANVAS_MAX_HEIGHT,
  LINEAGE_MAP_CANVAS_MIN_HEIGHT,
  LINEAGE_MAP_CANVAS_PADDING,
  LINEAGE_MAP_CARD_HEIGHT,
  LINEAGE_MAP_CARD_WIDTH,
  LINEAGE_MAP_COLUMN_GAP,
  LINEAGE_MAP_READABLE_ZOOM,
  LineageMapLayout,
  LineageMapPoint,
  LineageMapView,
  getLineageMapView,
  countLineageMapKinds,
  doesLineageMapNodeMatch,
  filterLineageMap,
  getLineageMapNodeTone,
  isLineageMapEmpty,
  isLineageMapKindHidden,
  layoutLineageMap,
} from "../../FeatureSet/Dashboard/src/Components/DataObservability/LineageMapModel";

/*
 * THE LINEAGE MAP, LAID OUT AND NARROWED (#9114).
 *
 * Cards sit left to right as data flows; no two cards overlap; groups of
 * cards no arrow joins are packed apart; a layout is the same each time.
 * A search keeps what it matches and everything upstream and downstream of
 * it; the switches leave kinds off with their arrows; a focused card keeps
 * only its own lineage.
 */

function node(
  id: string,
  kind: DataLineageMapNodeKind = DataLineageMapNodeKind.Table,
  fields: Partial<DataLineageMapNode> = {},
): DataLineageMapNode {
  return { id, kind, name: id.replace(/^[a-z-]+:/, ""), ...fields };
}

function edge(
  source: string,
  target: string,
  kind: DataLineageMapEdgeKind = DataLineageMapEdgeKind.Feeds,
  fields: Partial<DataLineageMapEdge> = {},
): DataLineageMapEdge {
  return {
    id: `${kind}:${source}>${target}`,
    source,
    target,
    kind,
    seenIn: [DataLineageMapEvidence.Pipeline],
    pipelines: [],
    operations: [],
    lastSeenAt: null,
    ...fields,
  };
}

const MAP: DataLineageMap = {
  nodes: [
    node("service:checkout", DataLineageMapNodeKind.Service),
    node("table:raw_orders", DataLineageMapNodeKind.Table, {
      database: "orders-db",
    }),
    node("table:orders"),
    node("table:revenue"),
    node("dashboard:finance", DataLineageMapNodeKind.Dashboard, {
      tool: "Metabase",
    }),
    node("pipeline:hubspot_sync", DataLineageMapNodeKind.Pipeline),
    node("table:contacts"),
    node("service:reports", DataLineageMapNodeKind.Service),
  ],
  edges: [
    edge(
      "service:checkout",
      "table:raw_orders",
      DataLineageMapEdgeKind.Writes,
      {
        seenIn: [DataLineageMapEvidence.Traces],
      },
    ),
    edge("table:raw_orders", "table:orders", DataLineageMapEdgeKind.Feeds, {
      pipelines: [
        { dataPipelineId: "p1", name: "orders_etl", lastRunState: "FAIL" },
      ],
    }),
    edge("table:orders", "table:revenue"),
    edge("table:revenue", "dashboard:finance", DataLineageMapEdgeKind.Reads, {
      seenIn: [DataLineageMapEvidence.BiTool],
    }),
    edge(
      "pipeline:hubspot_sync",
      "table:contacts",
      DataLineageMapEdgeKind.Writes,
    ),
    edge("table:contacts", "service:reports", DataLineageMapEdgeKind.Reads, {
      seenIn: [DataLineageMapEvidence.Traces],
    }),
  ],
  isTruncated: false,
};

function ids(map: DataLineageMap): Array<string> {
  return map.nodes
    .map((n: DataLineageMapNode): string => {
      return n.id;
    })
    .sort();
}

function overlaps(a: LineageMapPoint, b: LineageMapPoint): boolean {
  return (
    Math.abs(a.x - b.x) < LINEAGE_MAP_CARD_WIDTH &&
    Math.abs(a.y - b.y) < LINEAGE_MAP_CARD_HEIGHT
  );
}

describe("layoutLineageMap", () => {
  const layout: LineageMapLayout = layoutLineageMap(MAP);
  const at: (id: string) => LineageMapPoint = (id: string): LineageMapPoint => {
    return layout.positions.get(id)!;
  };

  test("every card has a place, and data flows left to right", () => {
    expect(layout.positions.size).toBe(MAP.nodes.length);

    for (const arrow of MAP.edges) {
      expect(at(arrow.source).x).toBeLessThan(at(arrow.target).x);
    }
  });

  test("no two cards overlap, across groups too", () => {
    const points: Array<[string, LineageMapPoint]> = Array.from(
      layout.positions.entries(),
    );

    for (let i: number = 0; i < points.length; i++) {
      for (let j: number = i + 1; j < points.length; j++) {
        expect({
          pair: `${points[i]![0]} & ${points[j]![0]}`,
          overlaps: overlaps(points[i]![1], points[j]![1]),
        }).toEqual({
          pair: `${points[i]![0]} & ${points[j]![0]}`,
          overlaps: false,
        });
      }
    }
  });

  test("the drawing's size holds every card", () => {
    for (const point of layout.positions.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x + LINEAGE_MAP_CARD_WIDTH).toBeLessThanOrEqual(
        layout.width,
      );
      expect(point.y + LINEAGE_MAP_CARD_HEIGHT).toBeLessThanOrEqual(
        layout.height,
      );
    }
  });

  test("the same map is laid out the same way, whatever order its cards come in", () => {
    const shuffled: DataLineageMap = {
      ...MAP,
      nodes: [...MAP.nodes].reverse(),
      edges: [...MAP.edges].reverse(),
    };

    expect(
      Array.from(layoutLineageMap(shuffled).positions.entries()).sort(),
    ).toEqual(Array.from(layout.positions.entries()).sort());
  });

  test("a cycle - which query history can show - still lays every card out", () => {
    const cyclic: LineageMapLayout = layoutLineageMap({
      nodes: [node("table:a"), node("table:b"), node("table:c")],
      edges: [
        edge("table:a", "table:b"),
        edge("table:b", "table:c"),
        edge("table:c", "table:a"),
      ],
    });

    expect(cyclic.positions.size).toBe(3);
    expect(cyclic.positions.get("table:a")!.x).toBeLessThan(
      cyclic.positions.get("table:b")!.x,
    );
    expect(cyclic.positions.get("table:b")!.x).toBeLessThan(
      cyclic.positions.get("table:c")!.x,
    );
  });

  test("many small groups are packed in rows rather than one long column", () => {
    const nodes: Array<DataLineageMapNode> = [];
    const edges: Array<DataLineageMapEdge> = [];

    for (let i: number = 0; i < 30; i++) {
      nodes.push(node(`service:s${i}`, DataLineageMapNodeKind.Service));
      nodes.push(node(`table:t${i}`));
      edges.push(
        edge(`service:s${i}`, `table:t${i}`, DataLineageMapEdgeKind.Writes),
      );
    }

    const packed: LineageMapLayout = layoutLineageMap({ nodes, edges });

    expect(packed.positions.size).toBe(60);
    // Wider than one group, and nowhere near thirty groups tall.
    expect(packed.width).toBeGreaterThan(2 * LINEAGE_MAP_CARD_WIDTH * 2);
    expect(packed.height).toBeLessThan(30 * LINEAGE_MAP_CARD_HEIGHT);
  });

  test("a card that feeds others sits right before the nearest card it feeds, not in the first column", () => {
    const pulled: LineageMapLayout = layoutLineageMap({
      nodes: [
        node("service:writer", DataLineageMapNodeKind.Service),
        node("table:a"),
        node("table:b"),
        node("table:c"),
        node("table:late_source"),
        node("dashboard:d", DataLineageMapNodeKind.Dashboard),
      ],
      edges: [
        edge("service:writer", "table:a", DataLineageMapEdgeKind.Writes),
        edge("table:a", "table:b"),
        edge("table:b", "table:c"),
        edge("table:late_source", "table:c"),
        edge("table:a", "dashboard:d", DataLineageMapEdgeKind.Reads),
      ],
    });
    const column: (id: string) => number = (id: string): number => {
      return Math.round(
        pulled.positions.get(id)!.x /
          (LINEAGE_MAP_CARD_WIDTH + LINEAGE_MAP_COLUMN_GAP),
      );
    };

    expect(column("service:writer")).toBe(0);
    expect(column("table:a")).toBe(1);
    expect(column("table:c")).toBe(3);
    // Beside the table it feeds, an arrow's length away.
    expect(column("table:late_source")).toBe(2);
    // What only reads stays right after what it reads.
    expect(column("dashboard:d")).toBe(2);
  });

  test("an empty map has no size", () => {
    expect(layoutLineageMap({ nodes: [], edges: [] })).toEqual({
      positions: new Map(),
      width: 0,
      height: 0,
    });
  });
});

describe("getLineageMapView", () => {
  test("a map that can be read whole opens whole and centred, never past its own size", () => {
    const view: LineageMapView = getLineageMapView(
      { width: 600, height: 200 },
      1200,
    );

    expect(view.zoom).toBe(1);
    expect(view.x).toBe(300);
    expect(view.height).toBe(LINEAGE_MAP_CANVAS_MIN_HEIGHT);
    expect(view.y).toBe((LINEAGE_MAP_CANVAS_MIN_HEIGHT - 200) / 2);
  });

  test("a wide map shrinks to fit, but not below a zoom its names can be read at", () => {
    const fitted: LineageMapView = getLineageMapView(
      { width: 1400, height: 300 },
      1200,
    );

    expect(fitted.zoom).toBeCloseTo(
      (1200 - 2 * LINEAGE_MAP_CANVAS_PADDING) / 1400,
    );
    expect(fitted.zoom).toBeGreaterThanOrEqual(LINEAGE_MAP_READABLE_ZOOM);

    const wide: LineageMapView = getLineageMapView(
      { width: 5000, height: 3000 },
      1200,
    );

    // Opened at the readable zoom from its first column and its top, the canvas as tall as it may be.
    expect(wide.zoom).toBe(LINEAGE_MAP_READABLE_ZOOM);
    expect(wide.x).toBe(LINEAGE_MAP_CANVAS_PADDING);
    expect(wide.y).toBe(LINEAGE_MAP_CANVAS_PADDING);
    expect(wide.height).toBe(LINEAGE_MAP_CANVAS_MAX_HEIGHT);
  });

  test("on a phone's width the map still opens at a readable zoom", () => {
    expect(getLineageMapView({ width: 2000, height: 400 }, 358).zoom).toBe(
      LINEAGE_MAP_READABLE_ZOOM,
    );
  });
});

describe("filterLineageMap", () => {
  test("no filter keeps the whole map", () => {
    expect(filterLineageMap(MAP, EMPTY_LINEAGE_MAP_FILTER)).toEqual(MAP);
  });

  test("a search keeps what it matches and everything upstream and downstream of it", () => {
    const found: DataLineageMap = filterLineageMap(MAP, {
      ...EMPTY_LINEAGE_MAP_FILTER,
      search: "  ORDERS ",
    });

    // "orders" and "raw_orders" match: their whole lineage stays, the HubSpot flow goes.
    expect(ids(found)).toEqual([
      "dashboard:finance",
      "service:checkout",
      "table:orders",
      "table:raw_orders",
      "table:revenue",
    ]);
    expect(found.edges).toHaveLength(4);
  });

  test("a search finds a table by its database, a dashboard by its tool, and a flow by its pipeline", () => {
    expect(
      ids(
        filterLineageMap(MAP, {
          ...EMPTY_LINEAGE_MAP_FILTER,
          search: "metabase",
        }),
      ),
    ).toContain("dashboard:finance");
    expect(
      ids(
        filterLineageMap(MAP, {
          ...EMPTY_LINEAGE_MAP_FILTER,
          search: "orders_etl",
        }),
      ),
    ).toContain("table:orders");
    expect(doesLineageMapNodeMatch(MAP.nodes[1]!, "orders-db")).toBe(true);
  });

  test("a search that matches nothing leaves nothing", () => {
    const found: DataLineageMap = filterLineageMap(MAP, {
      ...EMPTY_LINEAGE_MAP_FILTER,
      search: "nothing-like-this",
    });

    expect(found.nodes).toEqual([]);
    expect(found.edges).toEqual([]);
  });

  test("a kind left off goes with its arrows", () => {
    const found: DataLineageMap = filterLineageMap(MAP, {
      ...EMPTY_LINEAGE_MAP_FILTER,
      hiddenKinds: new Set([DataLineageMapNodeKind.Service]),
    });

    expect(ids(found)).not.toContain("service:checkout");
    expect(ids(found)).not.toContain("service:reports");
    expect(
      found.edges.some((arrow: DataLineageMapEdge): boolean => {
        return (
          arrow.source.startsWith("service:") ||
          arrow.target.startsWith("service:")
        );
      }),
    ).toBe(false);
  });

  test("a focused card keeps only its own lineage", () => {
    const found: DataLineageMap = filterLineageMap(MAP, {
      ...EMPTY_LINEAGE_MAP_FILTER,
      focusNodeId: "table:contacts",
    });

    expect(ids(found)).toEqual([
      "pipeline:hubspot_sync",
      "service:reports",
      "table:contacts",
    ]);
  });

  test("a focused card that a switch took off leaves the map as the switch left it", () => {
    const found: DataLineageMap = filterLineageMap(MAP, {
      ...EMPTY_LINEAGE_MAP_FILTER,
      hiddenKinds: new Set([DataLineageMapNodeKind.Service]),
      focusNodeId: "service:checkout",
    });

    expect(found.nodes).toHaveLength(6);
  });
});

describe("the map's counts and tones", () => {
  test("counts each kind of card", () => {
    expect(countLineageMapKinds(MAP)).toEqual({
      [DataLineageMapNodeKind.Service]: 2,
      [DataLineageMapNodeKind.Table]: 4,
      [DataLineageMapNodeKind.Pipeline]: 1,
      [DataLineageMapNodeKind.Dashboard]: 1,
      [DataLineageMapNodeKind.Dataset]: 0,
      [DataLineageMapNodeKind.Source]: 0,
    });
    expect(isLineageMapEmpty(MAP)).toBe(false);
    expect(
      isLineageMapEmpty({ nodes: [], edges: [], isTruncated: false }),
    ).toBe(true);
  });

  test("a card says how it is as a table's lineage diagram does", () => {
    expect(
      getLineageMapNodeTone(
        node("table:a", DataLineageMapNodeKind.Table, {
          freshness: DataAssetFreshness.Late,
        }),
      ),
    ).toBe(LineageTone.Problem);
    expect(
      getLineageMapNodeTone(
        node("table:a", DataLineageMapNodeKind.Table, { openAlertCount: 1 }),
      ),
    ).toBe(LineageTone.Problem);
    expect(
      getLineageMapNodeTone(
        node("table:a", DataLineageMapNodeKind.Table, {
          freshness: DataAssetFreshness.Fresh,
        }),
      ),
    ).toBe(LineageTone.Healthy);
    expect(
      getLineageMapNodeTone(
        node("table:a", DataLineageMapNodeKind.Table, {
          isDropped: true,
          openAlertCount: 3,
        }),
      ),
    ).toBe(LineageTone.Dropped);
    expect(
      getLineageMapNodeTone(
        node("pipeline:p", DataLineageMapNodeKind.Pipeline, {
          lastRunState: "ABORT",
        }),
      ),
    ).toBe(LineageTone.Problem);
    expect(
      getLineageMapNodeTone(
        node("pipeline:p", DataLineageMapNodeKind.Pipeline, {
          lastRunState: "RUNNING",
        }),
      ),
    ).toBe(LineageTone.Running);
    expect(
      getLineageMapNodeTone(node("service:s", DataLineageMapNodeKind.Service)),
    ).toBe(LineageTone.Neutral);
  });
});

/*
 * Power BI's own lineage on the map (#9507): a report on no watched table
 * is drawn with the datasets it charts and the data sources they load
 * from. Those cards go with the dashboards when the Dashboards switch is
 * off, and say what they are.
 */
describe("a dashboard's datasets and data sources", () => {
  const BI_MAP: DataLineageMap = {
    nodes: [
      node(
        "source:sql server|sql01|facilities|",
        DataLineageMapNodeKind.Source,
        {
          name: "sql01 / Facilities",
          sourceType: "SQL Server",
          isDatabaseSource: true,
        },
      ),
      node(
        "source:excel file|||c:\\targets.xlsx",
        DataLineageMapNodeKind.Source,
        {
          name: "C:\\targets.xlsx",
          sourceType: "Excel file",
          isDatabaseSource: false,
        },
      ),
      node(
        "source:sharepoint|||https://acme.sharepoint.com",
        DataLineageMapNodeKind.Source,
        {
          name: "https://acme.sharepoint.com",
          sourceType: "SharePoint",
          isDatabaseSource: false,
        },
      ),
      node("dataset:ds1", DataLineageMapNodeKind.Dataset, {
        name: "Facilities Model",
        tool: "Power BI",
        workspace: "New Unit Readiness",
      }),
      node("dashboard:checklist", DataLineageMapNodeKind.Dashboard, {
        tool: "Power BI",
      }),
      node("table:orders"),
    ],
    edges: [
      edge(
        "source:sql server|sql01|facilities|",
        "dataset:ds1",
        DataLineageMapEdgeKind.Feeds,
        {
          seenIn: [DataLineageMapEvidence.BiTool],
        },
      ),
      edge("dataset:ds1", "dashboard:checklist", DataLineageMapEdgeKind.Reads, {
        seenIn: [DataLineageMapEvidence.BiTool],
      }),
    ],
    isTruncated: false,
  };

  test("the Dashboards switch leaves them off with the dashboards; tables stay", () => {
    const found: DataLineageMap = filterLineageMap(BI_MAP, {
      ...EMPTY_LINEAGE_MAP_FILTER,
      hiddenKinds: new Set([DataLineageMapNodeKind.Dashboard]),
    });

    expect(ids(found)).toEqual(["table:orders"]);
    expect(found.edges).toEqual([]);
    expect(
      isLineageMapKindHidden(
        DataLineageMapNodeKind.Source,
        new Set([DataLineageMapNodeKind.Dashboard]),
      ),
    ).toBe(true);
    expect(
      isLineageMapKindHidden(
        DataLineageMapNodeKind.Source,
        new Set([DataLineageMapNodeKind.Service]),
      ),
    ).toBe(false);
  });

  test("a search for a report keeps where its data comes from", () => {
    expect(
      ids(
        filterLineageMap(BI_MAP, {
          ...EMPTY_LINEAGE_MAP_FILTER,
          search: "checklist",
        }),
      ),
    ).toEqual([
      "dashboard:checklist",
      "dataset:ds1",
      "source:sql server|sql01|facilities|",
    ]);
  });

  test("they are counted, and are neither in trouble nor healthy", () => {
    expect(countLineageMapKinds(BI_MAP)).toMatchObject({
      [DataLineageMapNodeKind.Dataset]: 1,
      [DataLineageMapNodeKind.Source]: 3,
    });
    expect(getLineageMapNodeTone(BI_MAP.nodes[3]!)).toBe(LineageTone.Neutral);
    expect(getLineageMapNodeTone(BI_MAP.nodes[0]!)).toBe(LineageTone.Neutral);
  });
});
