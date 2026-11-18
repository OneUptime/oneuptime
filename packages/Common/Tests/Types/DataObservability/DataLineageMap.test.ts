import { describe, expect, test } from "@jest/globals";
import { DataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../Types/DataObservability/DataAssetLineageSource";
import { DataAssetAccessKind } from "../../../Types/DataObservability/DataAssetUsage";
import {
  DataBiSource,
  DataDashboardUpstream,
} from "../../../Types/DataObservability/DataBiLineage";
import {
  DataLineageMap,
  DataLineageMapBiChoice,
  DataLineageMapChoice,
  DataLineageMapDashboardRow,
  DataLineageMapEdge,
  DataLineageMapEdgeKind,
  DataLineageMapEvidence,
  DataLineageMapLineageRow,
  DataLineageMapNode,
  DataLineageMapNodeKind,
  DataLineageMapTableRow,
  DataLineageMapTrace,
  DataLineageMapUsageRow,
  DataLineageMapRequest,
  MAX_DATA_LINEAGE_MAP_DASHBOARDS,
  MAX_DATA_LINEAGE_MAP_DATASETS_PER_DASHBOARD,
  MAX_DATA_LINEAGE_MAP_NODES,
  MAX_DATA_LINEAGE_MAP_OPERATIONS,
  MAX_DATA_LINEAGE_MAP_SEARCH_LENGTH,
  MAX_DATA_LINEAGE_MAP_SOURCES_PER_DATASET,
  assembleDataLineageMap,
  chooseDataLineageMapBiDashboards,
  chooseDataLineageMapFlows,
  getLineageMapDatasetNodeId,
  getLineageMapServiceNodeId,
  getLineageMapSourceNodeId,
  getLineageMapUpstreamCards,
  hasFailedLineageMapPipeline,
  isFocusedDataLineageMapRequest,
  isLineageMapNodeInTrouble,
  readDataLineageMapRequest,
  traceDataLineageMap,
} from "../../../Types/DataObservability/DataLineageMap";

/*
 * THE LINEAGE MAP, WORKED OUT FROM THE ROWS OneUptime KEEPS (#9114).
 *
 * Every arrow is a row: a table built from another (Feeds), a pipeline
 * loading a table from outside or a service's spans writing it (Writes), a
 * service's spans or a BI dashboard reading it (Reads). Nothing is drawn
 * that no row says, the newest flows are kept when there are more than a
 * map holds, and a row naming a table or pipeline that is gone draws
 * nothing.
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function table(
  id: string,
  fields: Partial<DataLineageMapTableRow> = {},
): DataLineageMapTableRow {
  return {
    dataAssetId: id,
    assetKey: `public.${id}`,
    name: id,
    database: "orders-db",
    assetKind: DataAssetKind.Table,
    lastChangedAt: hoursAgo(1),
    updateIntervalInSeconds: 24 * 60 * 60,
    isDropped: false,
    ...fields,
  };
}

function feeds(
  upstream: string,
  downstream: string,
  fields: Partial<DataLineageMapLineageRow> = {},
): DataLineageMapLineageRow {
  return {
    upstreamDataAssetId: upstream,
    downstreamDataAssetId: downstream,
    dataPipelineId: null,
    source: DataAssetLineageSource.QueryHistory,
    lastSeenAt: hoursAgo(1),
    ...fields,
  };
}

function usage(
  service: string,
  dataAssetId: string,
  accessKind: DataAssetAccessKind,
  fields: Partial<DataLineageMapUsageRow> = {},
): DataLineageMapUsageRow {
  return {
    dataAssetId,
    serviceId: `svc-${service}`,
    serviceName: service,
    accessKind,
    operations: [
      accessKind === DataAssetAccessKind.Write ? "INSERT" : "SELECT",
    ],
    lastSeenAt: hoursAgo(1),
    ...fields,
  };
}

function nodeIds(map: DataLineageMap): Array<string> {
  return map.nodes.map((node: DataLineageMapNode): string => {
    return node.id;
  });
}

function edgeOf(map: DataLineageMap, id: string): DataLineageMapEdge {
  const edge: DataLineageMapEdge | undefined = map.edges.find(
    (candidate: DataLineageMapEdge): boolean => {
      return candidate.id === id;
    },
  );

  if (!edge) {
    throw new Error(
      `no edge ${id} in ${map.edges
        .map((e: DataLineageMapEdge): string => {
          return e.id;
        })
        .join()}`,
    );
  }

  return edge;
}

function assemble(data: {
  lineage?: Array<DataLineageMapLineageRow>;
  usages?: Array<DataLineageMapUsageRow>;
  tables: Array<DataLineageMapTableRow>;
  pipelines?: Parameters<typeof assembleDataLineageMap>[0]["pipelines"];
  dashboards?: Parameters<typeof assembleDataLineageMap>[0]["dashboards"];
  openAlertCounts?: Map<string, number>;
  maxNodes?: number;
}): DataLineageMap {
  const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
    lineage: data.lineage || [],
    usages: data.usages || [],
    maxNodes: data.maxNodes,
  });

  return assembleDataLineageMap({
    choice,
    tables: data.tables,
    pipelines: data.pipelines || [],
    dashboards: data.dashboards || [],
    openAlertCounts: data.openAlertCounts || new Map(),
    now: NOW,
  });
}

describe("chooseDataLineageMapFlows", () => {
  test("keeps every flow and names every table and pipeline on it", () => {
    const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
      lineage: [
        feeds("raw", "orders"),
        feeds("orders", "orders", { source: DataAssetLineageSource.Pipeline }),
        {
          upstreamDataAssetId: null,
          downstreamDataAssetId: "raw",
          dataPipelineId: "p1",
          source: null,
          lastSeenAt: hoursAgo(2),
        },
        // Neither a table nor a pipeline upstream: nothing to draw.
        {
          upstreamDataAssetId: null,
          downstreamDataAssetId: "lonely",
          dataPipelineId: null,
          source: null,
          lastSeenAt: hoursAgo(2),
        },
      ],
      usages: [usage("api", "orders", DataAssetAccessKind.Read)],
    });

    // A table built from itself draws no arrow.
    expect(choice.lineage).toHaveLength(2);
    expect(choice.usages).toHaveLength(1);
    expect(choice.dataAssetIds).toEqual(["orders", "raw"]);
    expect(choice.dataPipelineIds).toEqual(["p1"]);
    expect(choice.isTruncated).toBe(false);
    expect(choice.dashboardRoom).toBe(MAX_DATA_LINEAGE_MAP_DASHBOARDS);
  });

  test("past the most cards a map draws, the newest flows are kept and the map says there were more", () => {
    const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
      lineage: [
        feeds("a", "b", { lastSeenAt: hoursAgo(10) }),
        feeds("c", "d", { lastSeenAt: hoursAgo(1) }),
        // Its cards are drawn already: it always fits.
        feeds("d", "c", { lastSeenAt: hoursAgo(20) }),
      ],
      usages: [
        usage("api", "e", DataAssetAccessKind.Write, {
          lastSeenAt: hoursAgo(2),
        }),
      ],
      maxNodes: 4,
    });

    expect(choice.lineage).toEqual([
      feeds("c", "d", { lastSeenAt: hoursAgo(1) }),
      feeds("d", "c", { lastSeenAt: hoursAgo(20) }),
    ]);
    expect(choice.usages).toHaveLength(1);
    expect(choice.dataAssetIds).toEqual(["c", "d", "e"]);
    expect(choice.isTruncated).toBe(true);
    expect(choice.dashboardRoom).toBe(0);
  });

  test("more rows than were read make the map truncated", () => {
    expect(
      chooseDataLineageMapFlows({
        lineage: [feeds("a", "b")],
        usages: [],
        hadMoreRows: true,
      }).isTruncated,
    ).toBe(true);
  });

  test("the room left for dashboards is what the flows leave, at most the dashboards' own most", () => {
    expect(
      chooseDataLineageMapFlows({
        lineage: [feeds("a", "b")],
        usages: [],
        maxNodes: 5,
      }).dashboardRoom,
    ).toBe(3);
    expect(MAX_DATA_LINEAGE_MAP_DASHBOARDS).toBeLessThan(
      MAX_DATA_LINEAGE_MAP_NODES,
    );
  });

  test("a service with neither a name nor an id draws nothing", () => {
    expect(
      chooseDataLineageMapFlows({
        lineage: [],
        usages: [
          usage("", "a", DataAssetAccessKind.Read, {
            serviceId: null,
            serviceName: "  ",
          }),
        ],
      }).usages,
    ).toEqual([]);
  });
});

/*
 * HOW MANY TABLES A MAP LEAVES OUT (#6547): a map past its most cards says
 * so, and how many of the tables its flows need it does not draw - each
 * counted once however many flows need it, a drawn table never - so a
 * person knows how much more a database or a search would show. When there
 * were more rows than were read, there are at least that many.
 */
describe("the tables a map leaves out", () => {
  test("each table the flows need and the map does not draw is counted once", () => {
    const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
      lineage: [
        feeds("a", "b", { lastSeenAt: hoursAgo(1) }),
        // Both need c; d once; b is drawn already.
        feeds("b", "c", { lastSeenAt: hoursAgo(5) }),
        feeds("c", "d", { lastSeenAt: hoursAgo(6) }),
        feeds("d", "c", { lastSeenAt: hoursAgo(7) }),
      ],
      usages: [
        usage("api", "e", DataAssetAccessKind.Read, {
          lastSeenAt: hoursAgo(8),
        }),
      ],
      maxNodes: 2,
    });

    expect(choice.dataAssetIds).toEqual(["a", "b"]);
    expect(choice.hiddenTableCount).toBe(3);
    expect(choice.isHiddenTableCountAtLeast).toBe(false);
    expect(choice.isTruncated).toBe(true);
  });

  test("a service or pipeline left out is not a table: only tables are counted", () => {
    const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
      lineage: [
        feeds("a", "b", { lastSeenAt: hoursAgo(1) }),
        {
          upstreamDataAssetId: null,
          downstreamDataAssetId: "a",
          dataPipelineId: "p1",
          source: null,
          lastSeenAt: hoursAgo(2),
        },
      ],
      usages: [
        usage("api", "b", DataAssetAccessKind.Write, {
          lastSeenAt: hoursAgo(3),
        }),
      ],
      maxNodes: 2,
    });

    expect(choice.isTruncated).toBe(true);
    expect(choice.hiddenTableCount).toBe(0);
  });

  test("more rows than were read: at least that many", () => {
    const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
      lineage: [
        feeds("a", "b", { lastSeenAt: hoursAgo(1) }),
        feeds("c", "d", { lastSeenAt: hoursAgo(2) }),
      ],
      usages: [],
      maxNodes: 2,
      hadMoreRows: true,
    });

    expect(choice.hiddenTableCount).toBe(2);
    expect(choice.isHiddenTableCountAtLeast).toBe(true);
  });

  test("a map that draws every flow leaves none out", () => {
    const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
      lineage: [feeds("a", "b"), feeds("b", "c")],
      usages: [usage("api", "c", DataAssetAccessKind.Read)],
    });

    expect(choice.hiddenTableCount).toBe(0);
    expect(choice.isTruncated).toBe(false);
  });

  test("the map says what its choice counted", () => {
    const map: DataLineageMap = assemble({
      lineage: [
        feeds("a", "b", { lastSeenAt: hoursAgo(1) }),
        feeds("c", "d", { lastSeenAt: hoursAgo(2) }),
      ],
      tables: [table("a"), table("b"), table("c"), table("d")],
      maxNodes: 2,
    });

    expect(map.hiddenTableCount).toBe(2);
    expect(map.isHiddenTableCountAtLeast).toBe(false);
    expect(map.isTruncated).toBe(true);
  });
});

describe("where a map starts (readDataLineageMapRequest)", () => {
  const STORE: string = "6e4f3c9a-1b2d-4c3e-8f5a-0123456789ab";

  test.each([
    [undefined, {}],
    [null, {}],
    [{}, {}],
    [{ dataStoreId: STORE }, { dataStoreId: STORE }],
    [{ dataStoreId: STORE.toUpperCase() }, { dataStoreId: STORE }],
    [{ dataStoreId: "" }, {}],
    [{ dataStoreId: null }, {}],
    [{ search: "  orders  " }, { search: "orders" }],
    [{ search: "   " }, {}],
    [{ search: null }, {}],
    [
      { dataStoreId: STORE, search: "orders" },
      { dataStoreId: STORE, search: "orders" },
    ],
    // Anything else it is sent is no part of where it starts.
    [{ depth: 3 }, {}],
  ])("%p starts it at %p", (body: unknown, request: DataLineageMapRequest) => {
    expect(readDataLineageMapRequest(body)).toEqual(request);
  });

  test.each([["orders"], [42], [["a"]]])(
    "a body that is no object (%p) is refused",
    (body: unknown) => {
      expect(readDataLineageMapRequest(body)).toBe(
        "Send the map's request as an object.",
      );
    },
  );

  test.each([
    [{ dataStoreId: "orders-db" }],
    [{ dataStoreId: 42 }],
    [{ dataStoreId: `${STORE}' OR '1'='1` }],
  ])("a database not named by its ID is refused: %p", (body: unknown) => {
    expect(readDataLineageMapRequest(body)).toBe(
      "Name the database by its ID.",
    );
  });

  test("a search that is no words, or longer than the most, is refused", () => {
    expect(typeof readDataLineageMapRequest({ search: 7 })).toBe("string");
    expect(
      readDataLineageMapRequest({
        search: "x".repeat(MAX_DATA_LINEAGE_MAP_SEARCH_LENGTH),
      }),
    ).toEqual({ search: "x".repeat(MAX_DATA_LINEAGE_MAP_SEARCH_LENGTH) });
    expect(
      readDataLineageMapRequest({
        search: "x".repeat(MAX_DATA_LINEAGE_MAP_SEARCH_LENGTH + 1),
      }),
    ).toBe(
      `Search for at most ${MAX_DATA_LINEAGE_MAP_SEARCH_LENGTH} characters.`,
    );
  });

  test("starts somewhere only with a database or a search", () => {
    expect(isFocusedDataLineageMapRequest({})).toBe(false);
    expect(isFocusedDataLineageMapRequest({ dataStoreId: STORE })).toBe(true);
    expect(isFocusedDataLineageMapRequest({ search: "orders" })).toBe(true);
  });
});

describe("assembleDataLineageMap", () => {
  test("one table built from another is one Feeds arrow, every place it was seen together", () => {
    const map: DataLineageMap = assemble({
      lineage: [
        feeds("raw", "orders", { lastSeenAt: hoursAgo(5) }),
        feeds("raw", "orders", {
          source: DataAssetLineageSource.ViewDefinition,
          lastSeenAt: hoursAgo(1),
        }),
        feeds("raw", "orders", {
          source: null,
          dataPipelineId: "p1",
          lastSeenAt: hoursAgo(3),
        }),
        feeds("raw", "orders", {
          source: DataAssetLineageSource.Pipeline,
          dataPipelineId: "p2",
          lastSeenAt: hoursAgo(3),
        }),
      ],
      tables: [table("raw"), table("orders")],
      pipelines: [
        {
          dataPipelineId: "p1",
          jobName: "zeta_load",
          jobNamespace: "airflow",
          lastRunState: "COMPLETE",
        },
        {
          dataPipelineId: "p2",
          jobName: "orders_etl",
          jobNamespace: "airflow",
          lastRunState: "FAIL",
        },
      ],
    });

    expect(nodeIds(map)).toEqual(["table:orders", "table:raw"]);
    expect(map.edges).toHaveLength(1);

    const edge: DataLineageMapEdge = edgeOf(
      map,
      "Feeds:table:raw>table:orders",
    );

    expect(edge.kind).toBe(DataLineageMapEdgeKind.Feeds);
    // In one order, whichever was seen last.
    expect(edge.seenIn).toEqual([
      DataLineageMapEvidence.Pipeline,
      DataLineageMapEvidence.QueryHistory,
      DataLineageMapEvidence.ViewDefinition,
    ]);
    // A failed run first: the pipeline that broke the flow.
    expect(
      edge.pipelines.map((p: { name: string }): string => {
        return p.name;
      }),
    ).toEqual(["orders_etl", "zeta_load"]);
    expect(hasFailedLineageMapPipeline(edge)).toBe(true);
    expect(edge.lastSeenAt).toBe(hoursAgo(1).toISOString());
    // A pipeline that moves data between two watched tables is told on the arrow, not drawn as a card.
    expect(nodeIds(map)).not.toContain("pipeline:p1");
  });

  test("a pipeline loading a table from outside is a card writing it", () => {
    const map: DataLineageMap = assemble({
      lineage: [
        {
          upstreamDataAssetId: null,
          downstreamDataAssetId: "raw",
          dataPipelineId: "p1",
          source: null,
          lastSeenAt: hoursAgo(2),
        },
      ],
      tables: [table("raw")],
      pipelines: [
        {
          dataPipelineId: "p1",
          jobName: "fivetran.salesforce",
          jobNamespace: "fivetran",
          lastRunState: "FAIL",
        },
      ],
    });

    expect(nodeIds(map)).toEqual(["pipeline:p1", "table:raw"]);

    const pipeline: DataLineageMapNode = map.nodes[0]!;

    expect(pipeline).toEqual({
      id: "pipeline:p1",
      kind: DataLineageMapNodeKind.Pipeline,
      name: "fivetran.salesforce",
      dataPipelineId: "p1",
      jobNamespace: "fivetran",
      lastRunState: "FAIL",
    });
    expect(isLineageMapNodeInTrouble(pipeline)).toBe(true);
    expect(edgeOf(map, "Writes:pipeline:p1>table:raw").seenIn).toEqual([
      DataLineageMapEvidence.Pipeline,
    ]);
  });

  test("a service's spans write a table into it and read a table out of it", () => {
    const map: DataLineageMap = assemble({
      usages: [
        usage("checkout", "orders", DataAssetAccessKind.Write, {
          operations: ["INSERT", "UPDATE"],
        }),
        usage("checkout", "orders", DataAssetAccessKind.Write, {
          operations: ["UPDATE", "DELETE"],
          lastSeenAt: hoursAgo(5),
        }),
        usage("reports", "orders", DataAssetAccessKind.Read),
      ],
      tables: [table("orders")],
    });

    expect(nodeIds(map)).toEqual([
      "service:svc-checkout",
      "service:svc-reports",
      "table:orders",
    ]);

    const write: DataLineageMapEdge = edgeOf(
      map,
      "Writes:service:svc-checkout>table:orders",
    );

    expect(write.seenIn).toEqual([DataLineageMapEvidence.Traces]);
    expect(write.operations).toEqual(["INSERT", "UPDATE", "DELETE"]);
    expect(write.lastSeenAt).toBe(hoursAgo(1).toISOString());

    const read: DataLineageMapEdge = edgeOf(
      map,
      "Reads:table:orders>service:svc-reports",
    );

    expect(read.kind).toBe(DataLineageMapEdgeKind.Reads);
    expect(read.operations).toEqual(["SELECT"]);
  });

  test("an arrow names at most a few operations", () => {
    const operations: Array<string> = [
      "INSERT",
      "UPDATE",
      "DELETE",
      "MERGE",
      "COPY",
      "UPSERT",
      "LOAD",
      "TRUNCATE",
    ];
    const map: DataLineageMap = assemble({
      usages: [
        usage("loader", "orders", DataAssetAccessKind.Write, { operations }),
      ],
      tables: [table("orders")],
    });

    expect(map.edges[0]!.operations).toEqual(
      operations.slice(0, MAX_DATA_LINEAGE_MAP_OPERATIONS),
    );
  });

  test("a service known only by its name is one card, whatever its case", () => {
    expect(
      getLineageMapServiceNodeId({ serviceId: null, serviceName: " Billing " }),
    ).toBe(
      getLineageMapServiceNodeId({ serviceId: null, serviceName: "billing" }),
    );

    const map: DataLineageMap = assemble({
      usages: [
        usage("Billing", "orders", DataAssetAccessKind.Read, {
          serviceId: null,
        }),
      ],
      tables: [table("orders")],
    });

    expect(map.nodes[0]).toEqual({
      id: "service-name:billing",
      kind: DataLineageMapNodeKind.Service,
      name: "Billing",
      serviceId: null,
    });
  });

  test("a table says how it is now: late, an open alert, dropped", () => {
    const map: DataLineageMap = assemble({
      lineage: [feeds("late", "alerting"), feeds("alerting", "dropped")],
      tables: [
        table("late", {
          lastChangedAt: hoursAgo(72),
          updateIntervalInSeconds: 60 * 60,
        }),
        table("alerting"),
        table("dropped", { isDropped: true }),
      ],
      openAlertCounts: new Map([["alerting", 2]]),
    });

    const byId: Map<string, DataLineageMapNode> = new Map(
      map.nodes.map(
        (node: DataLineageMapNode): [string, DataLineageMapNode] => {
          return [node.id, node];
        },
      ),
    );

    expect(byId.get("table:late")!.freshness).toBe(DataAssetFreshness.Late);
    expect(byId.get("table:late")!.lateBySeconds).toBeGreaterThan(0);
    expect(isLineageMapNodeInTrouble(byId.get("table:late")!)).toBe(true);
    expect(byId.get("table:alerting")!.openAlertCount).toBe(2);
    expect(isLineageMapNodeInTrouble(byId.get("table:alerting")!)).toBe(true);
    expect(byId.get("table:dropped")!.isDropped).toBe(true);
    expect(isLineageMapNodeInTrouble(byId.get("table:dropped")!)).toBe(false);
    expect(byId.get("table:alerting")!.name).toBe("public.alerting");
    expect(byId.get("table:alerting")!.database).toBe("orders-db");
  });

  test("a row naming a table or pipeline that is gone draws nothing", () => {
    const map: DataLineageMap = assemble({
      lineage: [
        feeds("gone", "orders"),
        {
          upstreamDataAssetId: null,
          downstreamDataAssetId: "orders",
          dataPipelineId: "gone-pipeline",
          source: null,
          lastSeenAt: hoursAgo(1),
        },
      ],
      usages: [usage("api", "gone", DataAssetAccessKind.Read)],
      tables: [table("orders")],
    });

    expect(map.edges).toEqual([]);
    expect(nodeIds(map)).toEqual(["table:orders"]);
  });

  test("a dashboard is drawn reading the tables on the map that it is built on", () => {
    const map: DataLineageMap = assemble({
      lineage: [feeds("raw", "orders")],
      tables: [table("raw"), table("orders")],
      dashboards: [
        {
          dataDashboardId: "d1",
          name: "Revenue",
          tool: "Metabase",
          url: "https://metabase.example.com/dashboard/1",
          dataAssetIds: ["orders", "not-on-map"],
        },
        {
          dataDashboardId: "d2",
          name: "Elsewhere",
          tool: "Looker",
          url: null,
          dataAssetIds: ["not-on-map"],
        },
      ],
    });

    expect(nodeIds(map)).toEqual(["dashboard:d1", "table:orders", "table:raw"]);
    expect(edgeOf(map, "Reads:table:orders>dashboard:d1").seenIn).toEqual([
      DataLineageMapEvidence.BiTool,
    ]);
    expect(map.isTruncated).toBe(false);
  });

  test("more dashboards than there is room for: the first by name are drawn and the map says there were more", () => {
    const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
      lineage: [feeds("raw", "orders")],
      usages: [],
      maxNodes: 3,
    });
    const map: DataLineageMap = assembleDataLineageMap({
      choice,
      tables: [table("raw"), table("orders")],
      pipelines: [],
      dashboards: ["B", "A"].map((name: string) => {
        return {
          dataDashboardId: name,
          name,
          tool: null,
          url: null,
          dataAssetIds: ["orders"],
        };
      }),
      openAlertCounts: new Map(),
      now: NOW,
    });

    expect(nodeIds(map)).toContain("dashboard:A");
    expect(nodeIds(map)).not.toContain("dashboard:B");
    expect(map.isTruncated).toBe(true);
    // The choice it was given is left as it was.
    expect(choice.isTruncated).toBe(false);
  });
});

describe("traceDataLineageMap", () => {
  const map: DataLineageMap = assemble({
    lineage: [
      feeds("raw", "staging"),
      feeds("staging", "orders"),
      feeds("orders", "staging", { lastSeenAt: hoursAgo(2) }),
      feeds("other", "unrelated"),
    ],
    usages: [
      usage("checkout", "raw", DataAssetAccessKind.Write),
      usage("reports", "orders", DataAssetAccessKind.Read),
    ],
    tables: [
      table("raw"),
      table("staging"),
      table("orders"),
      table("other"),
      table("unrelated"),
    ],
  });

  test("everything the data comes from and everything it reaches, however many steps away", () => {
    const trace: DataLineageMapTrace = traceDataLineageMap(map, "table:raw");

    expect(Array.from(trace.upstream).sort()).toEqual(["service:svc-checkout"]);
    expect(Array.from(trace.downstream).sort()).toEqual([
      "service:svc-reports",
      "table:orders",
      "table:staging",
    ]);
    expect(trace.edgeIds.has("Feeds:table:other>table:unrelated")).toBe(false);
    expect(trace.edgeIds.has("Feeds:table:raw>table:staging")).toBe(true);
  });

  test("a cycle ends the walk, and the card itself is on neither side", () => {
    const trace: DataLineageMapTrace = traceDataLineageMap(
      map,
      "table:staging",
    );

    expect(trace.upstream.has("table:staging")).toBe(false);
    expect(trace.downstream.has("table:staging")).toBe(false);
    expect(trace.upstream.has("table:orders")).toBe(true);
    expect(trace.downstream.has("table:orders")).toBe(true);
  });

  test("a card no arrow touches has nothing either way", () => {
    const trace: DataLineageMapTrace = traceDataLineageMap(map, "table:nope");

    expect(trace.upstream.size).toBe(0);
    expect(trace.downstream.size).toBe(0);
    expect(trace.edgeIds.size).toBe(0);
  });
});

/*
 * A BI tool's dashboards need no other flow to be on the map (#9507): one
 * built on watched tables nothing else touches is drawn with them, and one
 * on no watched table with the datasets and data sources its tool says it
 * is built on, in the room the flows leave.
 */
describe("BI dashboards in the room the flows leave", () => {
  const SALES_DB: DataBiSource = {
    type: "SQL Server",
    engine: "sqlserver",
    server: "sql01",
    database: "Facilities",
    location: null,
  };
  const CHECKLIST: DataBiSource = {
    type: "SharePoint",
    engine: null,
    server: null,
    database: null,
    location: "https://acme.sharepoint.com/sites/facilities",
  };

  function biRow(
    id: string,
    fields: Partial<DataLineageMapDashboardRow> = {},
  ): DataLineageMapDashboardRow {
    return {
      dataDashboardId: id,
      name: id,
      tool: "Power BI",
      url: `https://app.powerbi.com/groups/w1/reports/${id}`,
      dataAssetIds: [],
      ...fields,
    };
  }

  function upstream(
    datasets: Array<{ id: string; sources: Array<DataBiSource> }>,
  ): DataDashboardUpstream {
    return {
      datasets: datasets.map(
        (dataset: { id: string; sources: Array<DataBiSource> }) => {
          return {
            id: dataset.id,
            name: `Model ${dataset.id}`,
            workspace: "Facilities",
            sources: dataset.sources,
          };
        },
      ),
      sources: datasets.flatMap((dataset: { sources: Array<DataBiSource> }) => {
        return dataset.sources;
      }),
    };
  }

  function draw(data: {
    rows: Array<DataLineageMapDashboardRow>;
    tables?: Array<DataLineageMapTableRow>;
    lineage?: Array<DataLineageMapLineageRow>;
    maxNodes?: number;
  }): { map: DataLineageMap; bi: DataLineageMapBiChoice } {
    const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
      lineage: data.lineage || [],
      usages: [],
      maxNodes: data.maxNodes,
    });
    const bi: DataLineageMapBiChoice = chooseDataLineageMapBiDashboards({
      rows: data.rows,
      drawnDataAssetIds: new Set(choice.dataAssetIds),
      drawnDashboardIds: new Set(),
      nodeRoom:
        (data.maxNodes ?? MAX_DATA_LINEAGE_MAP_NODES) - choice.nodeCount,
      dashboardRoom: choice.dashboardRoom,
    });

    return {
      bi,
      map: assembleDataLineageMap({
        choice,
        tables: data.tables || [],
        pipelines: [],
        dashboards: [],
        bi,
        openAlertCounts: new Map(),
        now: NOW,
      }),
    };
  }

  test("a dashboard on a watched table no flow touches is drawn with its table (it was never drawn)", () => {
    const { map, bi } = draw({
      rows: [biRow("revenue", { dataAssetIds: ["orders", "orders"] })],
      tables: [table("orders")],
    });

    expect(bi.dataAssetIds).toEqual(["orders"]);
    expect(nodeIds(map)).toEqual(["dashboard:revenue", "table:orders"]);
    expect(edgeOf(map, "Reads:table:orders>dashboard:revenue")).toMatchObject({
      kind: DataLineageMapEdgeKind.Reads,
      seenIn: [DataLineageMapEvidence.BiTool],
    });
    expect(map.isTruncated).toBe(false);
  });

  test("a dashboard on no watched table: its datasets, and the data sources they are loaded from", () => {
    const { map } = draw({
      rows: [
        biRow("checklist", {
          upstream: upstream([{ id: "DS1", sources: [SALES_DB, CHECKLIST] }]),
        }),
        // A second report on the same dataset: one dataset card, read twice.
        biRow("gantt", {
          upstream: upstream([{ id: "ds1", sources: [SALES_DB] }]),
        }),
      ],
    });
    const salesNode: string = getLineageMapSourceNodeId(SALES_DB);

    expect(nodeIds(map)).toEqual(
      [
        "dashboard:checklist",
        "dashboard:gantt",
        "dataset:ds1",
        salesNode,
        getLineageMapSourceNodeId(CHECKLIST),
      ].sort(),
    );
    expect(
      map.nodes.find((node: DataLineageMapNode): boolean => {
        return node.id === "dataset:ds1";
      }),
    ).toMatchObject({
      kind: DataLineageMapNodeKind.Dataset,
      name: "Model DS1",
      tool: "Power BI",
      workspace: "Facilities",
    });
    expect(
      map.nodes.find((node: DataLineageMapNode): boolean => {
        return node.id === salesNode;
      }),
    ).toMatchObject({
      kind: DataLineageMapNodeKind.Source,
      name: "sql01 / Facilities",
      sourceType: "SQL Server",
      isDatabaseSource: true,
    });
    expect(edgeOf(map, `Feeds:${salesNode}>dataset:ds1`).seenIn).toEqual([
      DataLineageMapEvidence.BiTool,
    ]);
    expect(edgeOf(map, "Reads:dataset:ds1>dashboard:checklist").kind).toBe(
      DataLineageMapEdgeKind.Reads,
    );
    expect(edgeOf(map, "Reads:dataset:ds1>dashboard:gantt").kind).toBe(
      DataLineageMapEdgeKind.Reads,
    );
    // Following a report up its lineage reaches where its data comes from.
    expect(traceDataLineageMap(map, "dashboard:gantt").upstream).toEqual(
      new Set(["dataset:ds1", salesNode, getLineageMapSourceNodeId(CHECKLIST)]),
    );
  });

  test("a tool naming sources with no dataset between: each reads straight into the dashboard", () => {
    expect(
      getLineageMapUpstreamCards({ datasets: [], sources: [CHECKLIST] }),
    ).toEqual({
      datasets: [],
      sources: [
        { nodeId: getLineageMapSourceNodeId(CHECKLIST), source: CHECKLIST },
      ],
    });

    const { map } = draw({
      rows: [
        biRow("sheet", { upstream: { datasets: [], sources: [CHECKLIST] } }),
      ],
    });

    expect(
      edgeOf(
        map,
        `Reads:${getLineageMapSourceNodeId(CHECKLIST)}>dashboard:sheet`,
      ).kind,
    ).toBe(DataLineageMapEdgeKind.Reads);
  });

  test("a dataset's cards are capped: so many datasets, so many sources each", () => {
    const cards: ReturnType<typeof getLineageMapUpstreamCards> =
      getLineageMapUpstreamCards(
        upstream(
          Array.from({ length: 8 }, (_value: unknown, index: number) => {
            return {
              id: `ds${index}`,
              sources: Array.from({ length: 9 }, (_v: unknown, s: number) => {
                return {
                  ...CHECKLIST,
                  location: `https://acme.sharepoint.com/${s}`,
                };
              }),
            };
          }),
        ),
      );

    expect(cards.datasets.length).toBe(
      MAX_DATA_LINEAGE_MAP_DATASETS_PER_DASHBOARD,
    );
    expect(cards.datasets[0]!.sources.length).toBe(
      MAX_DATA_LINEAGE_MAP_SOURCES_PER_DATASET,
    );
    expect(
      getLineageMapDatasetNodeId({ id: null, name: "Sales", workspace: "Ops" }),
    ).toBe("dataset-name:ops|sales");
  });

  test("dashboards on watched tables first, then those on none; nothing with neither", () => {
    const { bi } = draw({
      rows: [
        biRow("upstream-only", {
          upstream: upstream([{ id: "ds1", sources: [CHECKLIST] }]),
        }),
        biRow("nothing"),
        biRow("on-tables", { dataAssetIds: ["orders"] }),
      ],
      tables: [table("orders")],
    });

    expect(
      bi.tableDashboards.map((row: DataLineageMapDashboardRow): string => {
        return row.dataDashboardId;
      }),
    ).toEqual(["on-tables"]);
    expect(
      bi.upstreamDashboards.map((row: DataLineageMapDashboardRow): string => {
        return row.dataDashboardId;
      }),
    ).toEqual(["upstream-only"]);
  });

  test("the room left is kept to: a dashboard too big for it is passed over, and the map says there were more", () => {
    const bi: DataLineageMapBiChoice = chooseDataLineageMapBiDashboards({
      rows: [
        biRow("big", { dataAssetIds: ["a", "b", "c", "d"] }),
        biRow("small", { dataAssetIds: ["e"] }),
        biRow("on-drawn", { dataAssetIds: ["drawn"] }),
        biRow("again", { dataAssetIds: ["e"] }),
      ],
      drawnDataAssetIds: new Set(["drawn"]),
      drawnDashboardIds: new Set(["again"]),
      nodeRoom: 3,
      dashboardRoom: 10,
    });

    // "small" takes e and itself, "on-drawn" only itself; "big" needs five, and "again" is drawn already.
    expect(
      bi.tableDashboards.map((row: DataLineageMapDashboardRow): string => {
        return row.dataDashboardId;
      }),
    ).toEqual(["small", "on-drawn"]);
    expect(bi.dataAssetIds).toEqual(["e"]);
    expect(bi.isTruncated).toBe(true);

    expect(
      chooseDataLineageMapBiDashboards({
        rows: [
          biRow("one", { dataAssetIds: ["a"] }),
          biRow("two", { dataAssetIds: ["b"] }),
        ],
        drawnDataAssetIds: new Set(),
        drawnDashboardIds: new Set(),
        nodeRoom: 100,
        dashboardRoom: 1,
      }),
    ).toMatchObject({ dataAssetIds: ["a"], isTruncated: true });
  });

  test("more dashboards than were read make the map truncated", () => {
    expect(
      chooseDataLineageMapBiDashboards({
        rows: [],
        drawnDataAssetIds: new Set(),
        drawnDashboardIds: new Set(),
        nodeRoom: 100,
        dashboardRoom: 100,
        hadMoreRows: true,
      }).isTruncated,
    ).toBe(true);
  });

  test("with flows on the map, the BI dashboards share the room they leave", () => {
    const { map } = draw({
      lineage: [feeds("raw", "orders")],
      rows: [biRow("refunds-board", { dataAssetIds: ["refunds"] })],
      tables: [table("raw"), table("orders"), table("refunds")],
    });

    expect(nodeIds(map)).toEqual([
      "dashboard:refunds-board",
      "table:orders",
      "table:raw",
      "table:refunds",
    ]);
  });
});
