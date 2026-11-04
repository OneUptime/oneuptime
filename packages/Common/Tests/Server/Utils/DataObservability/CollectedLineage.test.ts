import { describe, expect, test } from "@jest/globals";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../../Types/DataObservability/DataAssetLineageSource";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../../Types/ObjectID";
import {
  getCollectedEdgeKey,
  KeptLineageEdge,
  planCollectedLineage,
  CollectedLineagePlan,
  ResolvedLineageEdge,
} from "../../../../Server/Utils/DataObservability/CollectedLineage";
import { buildProbeCollectWork } from "../../../../Server/Utils/DataObservability/DataObservabilityProbeClaim";
import {
  buildProbeCollectOptions,
  DataObservabilityProbeStoreWork,
  readProbeCollectWork,
  readTableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/DataObservabilityProbeCollect";
import {
  assembleSnapshot,
  buildBigQueryLineageQuery,
  CollectedLineageEdge,
  getQueryHistoryLookbackInSeconds,
  MAX_QUERY_HISTORY_LOOKBACK_IN_SECONDS,
  MAX_SEEN_BY_LENGTH,
  QUERY_HISTORY_MARGIN_IN_SECONDS,
  readLineageRow,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";

/*
 * LINEAGE THE DATABASES SAY.
 *
 * Views over their tables and queries in the database's own history become
 * lineage with no pipeline to report it: read once an hour, back to the
 * last read; carried from a probe like the rest of its snapshot, strictly;
 * and kept once per pair and source, written only when it changes, a view
 * edge deleted once its view no longer says it.
 */

const NOW: Date = new Date("2026-11-03T12:07:00.000Z");

describe("how far back a collection reads the query history", () => {
  test("a week at the store's first collection", () => {
    expect(getQueryHistoryLookbackInSeconds(null, NOW)).toBe(
      MAX_QUERY_HISTORY_LOOKBACK_IN_SECONDS,
    );
    expect(getQueryHistoryLookbackInSeconds(undefined, NOW)).toBe(
      7 * 24 * 60 * 60,
    );
  });

  test("none again in the hour it was last collected", () => {
    expect(
      getQueryHistoryLookbackInSeconds(
        new Date("2026-11-03T12:02:00.000Z"),
        NOW,
      ),
    ).toBe(0);
  });

  test("at the first collection of an hour, back to the start of the last one's hour, with a margin", () => {
    // Last collected at 11:57: read from 11:00, less the margin.
    expect(
      getQueryHistoryLookbackInSeconds(
        new Date("2026-11-03T11:57:00.000Z"),
        NOW,
      ),
    ).toBe(67 * 60 + QUERY_HISTORY_MARGIN_IN_SECONDS);
    // A date read back as text counts the same.
    expect(
      getQueryHistoryLookbackInSeconds(
        "2026-11-03T11:57:00.000Z" as unknown as Date,
        NOW,
      ),
    ).toBe(67 * 60 + QUERY_HISTORY_MARGIN_IN_SECONDS);
  });

  test("never more than a week, however long the store was not collected", () => {
    expect(
      getQueryHistoryLookbackInSeconds(
        new Date("2026-09-01T00:00:00.000Z"),
        NOW,
      ),
    ).toBe(MAX_QUERY_HISTORY_LOOKBACK_IN_SECONDS);
  });
});

describe("a lineage row", () => {
  test("a view's: its tables, no time and no login", () => {
    expect(
      readLineageRow(
        {
          upstream_schema: "public",
          upstream_table: "orders",
          downstream_schema: "reporting",
          downstream_table: "daily_orders",
          seconds_since_seen: "12",
          seen_by: "someone",
        },
        DataAssetLineageSource.ViewDefinition,
      ),
    ).toEqual({
      source: DataAssetLineageSource.ViewDefinition,
      upstreamDatabase: null,
      upstreamSchema: "public",
      upstreamTable: "orders",
      downstreamSchema: "reporting",
      downstreamTable: "daily_orders",
      secondsSinceSeen: null,
      seenBy: null,
    });
  });

  test("a query's: how long ago it ended and whose it was, the login bounded", () => {
    const edge: CollectedLineageEdge | null = readLineageRow(
      {
        upstream_database: "raw-project",
        upstream_schema: "raw",
        upstream_table: "events",
        downstream_schema: "analytics",
        downstream_table: "sessions",
        seconds_since_seen: "540",
        seen_by: `${"x".repeat(200)}@example.com`,
      },
      DataAssetLineageSource.QueryHistory,
    );

    expect(edge?.upstreamDatabase).toBe("raw-project");
    expect(edge?.secondsSinceSeen).toBe(540);
    expect(edge?.seenBy?.length).toBe(MAX_SEEN_BY_LENGTH);
  });

  test("a table feeding itself, or a row with no table, is no edge", () => {
    expect(
      readLineageRow(
        {
          upstream_schema: "public",
          upstream_table: "orders",
          downstream_schema: "public",
          downstream_table: "orders",
        },
        DataAssetLineageSource.QueryHistory,
      ),
    ).toBe(null);
    expect(
      readLineageRow(
        { upstream_schema: "public", downstream_table: "orders" },
        DataAssetLineageSource.ViewDefinition,
      ),
    ).toBe(null);
  });
});

describe("a snapshot's lineage", () => {
  const edge: (upstream: string, downstream: string) => CollectedLineageEdge = (
    upstream: string,
    downstream: string,
  ): CollectedLineageEdge => {
    return {
      source: DataAssetLineageSource.ViewDefinition,
      upstreamDatabase: null,
      upstreamSchema: "public",
      upstreamTable: upstream,
      downstreamSchema: "public",
      downstreamTable: downstream,
      secondsSinceSeen: null,
      seenBy: null,
    };
  };

  test("leaves out an edge with an excluded table at either end", () => {
    const snapshot: TableHealthSnapshot = assembleSnapshot({
      engine: "postgresql",
      read: {
        tables: [],
        columns: [],
        warnings: [],
        secondsSinceStatsReset: null,
      },
      options: {
        maxTables: 100,
        maxColumns: 100,
        exclusions: ["public.audit"],
      },
      collectedAt: NOW,
      lineage: {
        edges: [
          edge("orders", "daily_orders"),
          edge("audit", "daily_orders"),
          edge("orders", "audit"),
        ],
        isViewLineageComplete: true,
        warnings: [],
      },
    });

    expect(snapshot.lineage).toEqual([edge("orders", "daily_orders")]);
    expect(snapshot.isViewLineageComplete).toBe(true);
  });

  test("a collection that read no lineage says nothing of it", () => {
    const snapshot: TableHealthSnapshot = assembleSnapshot({
      engine: "postgresql",
      read: {
        tables: [],
        columns: [],
        warnings: [],
        secondsSinceStatsReset: null,
      },
      options: { maxTables: 100, maxColumns: 100, exclusions: [] },
      collectedAt: NOW,
    });

    expect(snapshot.lineage).toBeUndefined();
    expect(snapshot.isViewLineageComplete).toBeUndefined();
  });
});

describe("BigQuery's lineage query", () => {
  const dataset: {
    projectId: string;
    dataset: string;
    location: string | null;
  } = { projectId: "my-project", dataset: "analytics", location: "EU" };

  test("reads the jobs view of the dataset's project and region, for the window", () => {
    const query: { statement: string; params: Array<string> } | null =
      buildBigQueryLineageQuery(dataset, 4500);

    expect(query).not.toBe(null);
    expect(query!.statement).toContain(
      "FROM `my-project`.`region-eu`.INFORMATION_SCHEMA.JOBS AS j",
    );
    expect(query!.statement).toContain("INTERVAL 4500 SECOND");
    // A job runs six hours at most: one ending in the window began within them.
    expect(query!.statement).toContain(`INTERVAL ${4500 + 6 * 3600} SECOND`);
    expect(query!.params).toEqual(["my-project", "analytics"]);
  });

  test("none when no lineage is read this time, or the location cannot name a region", () => {
    expect(buildBigQueryLineageQuery(dataset, 0)).toBe(null);
    expect(
      buildBigQueryLineageQuery({ ...dataset, location: "eu`; DROP" }, 4500),
    ).toBe(null);
    // A dataset with no location given is read in the US.
    expect(
      buildBigQueryLineageQuery({ ...dataset, location: null }, 4500)
        ?.statement,
    ).toContain("`region-us`");
  });
});

describe("lineage over the probe conversation", () => {
  test("the server's work says how far back to read; the probe's options carry it", () => {
    const work: DataObservabilityProbeStoreWork | null = readProbeCollectWork({
      dataStoreId: "11111111-1111-4111-8111-111111111111",
      engine: "redshift",
      probeConnectionVariable: "WAREHOUSE_URL",
      queryHistoryLookbackInSeconds: 4500,
    });

    expect(work?.queryHistoryLookbackInSeconds).toBe(4500);
    expect(buildProbeCollectOptions(work!).queryHistoryLookbackInSeconds).toBe(
      4500,
    );
    // Never more than a week, whatever a server says.
    expect(
      readProbeCollectWork({
        dataStoreId: "11111111-1111-4111-8111-111111111111",
        engine: "redshift",
        probeConnectionVariable: "WAREHOUSE_URL",
        queryHistoryLookbackInSeconds: 10 ** 9,
      })?.queryHistoryLookbackInSeconds,
    ).toBe(MAX_QUERY_HISTORY_LOOKBACK_IN_SECONDS);
  });

  test("a claimed store's work reads back to its last collection", () => {
    const store: DataStore = new DataStore();
    store.id = new ObjectID("11111111-1111-4111-8111-111111111111");
    store.kind = DataStoreKind.AwsRedshiftCluster;
    store.probeConnectionVariable = "WAREHOUSE_URL";
    store.tableHealthCollectedAt = new Date("2026-11-03T11:57:00.000Z");

    expect(
      buildProbeCollectWork(store, [], NOW)?.queryHistoryLookbackInSeconds,
    ).toBe(67 * 60 + QUERY_HISTORY_MARGIN_IN_SECONDS);

    store.tableHealthCollectedAt = new Date("2026-11-03T12:02:00.000Z");
    expect(
      buildProbeCollectWork(store, [], NOW)?.queryHistoryLookbackInSeconds,
    ).toBe(0);
  });

  test("a probe's edges are read strictly: known sources, bounded names and logins", () => {
    const snapshot: TableHealthSnapshot | null = readTableHealthSnapshot(
      {
        engine: "redshift",
        collectedAt: "2026-11-03T12:06:00.000Z",
        isComplete: true,
        warnings: [],
        tables: [],
        isViewLineageComplete: true,
        lineage: [
          {
            source: DataAssetLineageSource.QueryHistory,
            upstreamDatabase: null,
            upstreamSchema: "staging",
            upstreamTable: "orders",
            downstreamSchema: "marts",
            downstreamTable: "fct_orders",
            secondsSinceSeen: 60,
            seenBy: "y".repeat(500),
          },
          {
            source: DataAssetLineageSource.ViewDefinition,
            upstreamSchema: "marts",
            upstreamTable: "fct_orders",
            downstreamSchema: "reporting",
            downstreamTable: "orders_by_day",
            secondsSinceSeen: 60,
            seenBy: "ignored for a view",
          },
          {
            source: DataAssetLineageSource.Pipeline,
            upstreamSchema: "a",
            upstreamTable: "b",
            downstreamSchema: "c",
            downstreamTable: "d",
          },
          { source: DataAssetLineageSource.QueryHistory, upstreamTable: "b" },
          "not an edge",
        ],
      },
      NOW,
    );

    expect(snapshot?.isViewLineageComplete).toBe(true);
    expect(snapshot?.lineage).toEqual([
      {
        source: DataAssetLineageSource.QueryHistory,
        upstreamDatabase: null,
        upstreamSchema: "staging",
        upstreamTable: "orders",
        downstreamSchema: "marts",
        downstreamTable: "fct_orders",
        secondsSinceSeen: 60,
        seenBy: "y".repeat(MAX_SEEN_BY_LENGTH),
      },
      {
        source: DataAssetLineageSource.ViewDefinition,
        upstreamDatabase: null,
        upstreamSchema: "marts",
        upstreamTable: "fct_orders",
        downstreamSchema: "reporting",
        downstreamTable: "orders_by_day",
        secondsSinceSeen: null,
        seenBy: null,
      },
    ]);
  });

  test("an older probe's snapshot, with no lineage, has none", () => {
    const snapshot: TableHealthSnapshot | null = readTableHealthSnapshot(
      {
        engine: "postgresql",
        collectedAt: "2026-11-03T12:06:00.000Z",
        isComplete: true,
        warnings: [],
        tables: [
          {
            schema: "public",
            name: "orders",
            kind: DataAssetKind.Table,
            columns: [],
          },
        ],
      },
      NOW,
    );

    expect(snapshot?.lineage).toBeUndefined();
  });
});

describe("keeping the edges", () => {
  const ORDERS: string = "11111111-1111-4111-8111-111111111111";
  const FCT_ORDERS: string = "22222222-2222-4222-8222-222222222222";
  const BY_DAY: string = "33333333-3333-4333-8333-333333333333";

  function queryEdge(lastSeenAt: Date, seenBy: string): ResolvedLineageEdge {
    return {
      source: DataAssetLineageSource.QueryHistory,
      upstreamDataAssetId: ORDERS,
      downstreamDataAssetId: FCT_ORDERS,
      lastSeenAt,
      seenBy,
    };
  }

  function viewEdge(lastSeenAt: Date): ResolvedLineageEdge {
    return {
      source: DataAssetLineageSource.ViewDefinition,
      upstreamDataAssetId: FCT_ORDERS,
      downstreamDataAssetId: BY_DAY,
      lastSeenAt,
      seenBy: null,
    };
  }

  function kept(edge: ResolvedLineageEdge, id: string): KeptLineageEdge {
    return {
      id,
      edgeKey: getCollectedEdgeKey(edge),
      source: edge.source,
      lastSeenAt: edge.lastSeenAt,
      seenBy: edge.seenBy,
    };
  }

  test("an edge seen for the first time is created, keyed apart from a pipeline's", () => {
    const plan: CollectedLineagePlan = planCollectedLineage({
      edges: [queryEdge(NOW, "dbt_runner"), viewEdge(NOW)],
      kept: [],
      isViewLineageComplete: true,
    });

    expect(
      plan.creates.map((create: { edgeKey: string }) => {
        return create.edgeKey;
      }),
    ).toEqual([
      `${ORDERS}:${FCT_ORDERS}:query`,
      `${FCT_ORDERS}:${BY_DAY}:view`,
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  test("the same lineage seen again writes nothing until its last sighting moves enough", () => {
    const earlier: Date = new Date(NOW.getTime() - 30 * 60 * 1000);

    expect(
      planCollectedLineage({
        edges: [queryEdge(NOW, "dbt_runner"), viewEdge(NOW)],
        kept: [
          kept(queryEdge(earlier, "dbt_runner"), "q"),
          kept(viewEdge(earlier), "v"),
        ],
        isViewLineageComplete: true,
      }),
    ).toEqual({ creates: [], updates: [], deletes: [] });
  });

  test("a query edge moves hourly, with its latest login; a view edge daily", () => {
    const twoHoursAgo: Date = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const plan: CollectedLineagePlan = planCollectedLineage({
      edges: [queryEdge(NOW, "airflow"), viewEdge(NOW)],
      kept: [
        kept(queryEdge(twoHoursAgo, "dbt_runner"), "q"),
        kept(viewEdge(twoHoursAgo), "v"),
      ],
      isViewLineageComplete: true,
    });

    expect(plan.updates).toEqual([
      { id: "q", lastSeenAt: NOW, seenBy: "airflow" },
    ]);

    const twoDaysAgo: Date = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);

    expect(
      planCollectedLineage({
        edges: [viewEdge(NOW)],
        kept: [kept(viewEdge(twoDaysAgo), "v")],
        isViewLineageComplete: true,
      }).updates,
    ).toEqual([{ id: "v", lastSeenAt: NOW, seenBy: null }]);
  });

  test("a view edge no longer reported goes once every view was read; a query edge stays", () => {
    const earlier: Date = new Date(NOW.getTime() - 60 * 1000);
    const keptEdges: Array<KeptLineageEdge> = [
      kept(queryEdge(earlier, "dbt_runner"), "q"),
      kept(viewEdge(earlier), "v"),
    ];

    expect(
      planCollectedLineage({
        edges: [],
        kept: keptEdges,
        isViewLineageComplete: true,
      }).deletes,
    ).toEqual(["v"]);
    // A read that failed or was cut proves nothing gone.
    expect(
      planCollectedLineage({
        edges: [],
        kept: keptEdges,
        isViewLineageComplete: false,
      }).deletes,
    ).toEqual([]);
  });

  test("two rows of one pair keep the later sighting", () => {
    const earlier: Date = new Date(NOW.getTime() - 60 * 60 * 1000);
    const plan: CollectedLineagePlan = planCollectedLineage({
      edges: [queryEdge(earlier, "first"), queryEdge(NOW, "second")],
      kept: [],
      isViewLineageComplete: false,
    });

    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]!.lastSeenAt).toEqual(NOW);
    expect(plan.creates[0]!.seenBy).toBe("second");
  });
});
