import {
  ClickhouseAppInstance,
  ClickhouseClient,
} from "../../../../Server/Infrastructure/ClickhouseDatabase";
import {
  attachProjectNames,
  buildProjectIngestionQuery,
  buildSignalIngestionQuery,
  buildTelemetryStorageSizeQuery,
  getTelemetryIngestionByProject,
  getTelemetryIngestionBySignal,
  MAX_PROJECTS_PER_SIGNAL,
  mergeProjectIngestionRows,
  sumCountsOrNull,
  TELEMETRY_INGESTION_SIGNALS,
  TelemetryIngestionSignal,
  TelemetryIngestionSignalSpec,
  TelemetryProjectIngestion,
  TelemetryProjectIngestionResult,
  TelemetryProjectSignalIngestion,
  TelemetrySignalIngestion,
  TelemetrySignalIngestionResult,
  TelemetrySignalProjectRows,
  toCountOrNull,
} from "../../../../Server/Utils/InstanceHealth/TelemetryIngestion";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../../Types/JSON";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "../../TestingUtils/Init";

/*
 * The telemetry ingestion probes behind the master-admin Telemetry page.
 *
 * Three things are worth a test here and nothing else really is:
 *
 *  1. The SQL. These queries run against multi-billion-row tables, and the only
 *     reason they are affordable is that they filter on the column each table is
 *     PARTITIONED and primary-key ordered by, and group by projectId — the
 *     leading primary-key column. Swap `time` for `createdAt`, or group by any
 *     other column, and the page still renders correct numbers in development
 *     while melting a production cluster. The assertions below pin the shape
 *     that keeps them cheap.
 *
 *  2. null vs 0. A count we could not read must never render as a confident
 *     zero: an operator reads "0 traces" as "this tenant stopped sending
 *     traces", which is a very different incident from "we could not measure".
 *     Every merge and sum path is checked for that distinction.
 *
 *  3. Independent degradation. One missing table, one failed query or an absent
 *     ClickHouse must not blank the signals that DID answer.
 */

function makeClient(
  query: (options: { query: string }) => Promise<{ data: Array<JSONObject> }>,
): ClickhouseClient {
  return {
    query: async (options: { query: string }): Promise<unknown> => {
      const result: { data: Array<JSONObject> } = await query(options);

      return {
        json: (): Promise<{ data: Array<JSONObject> }> => {
          return Promise.resolve(result);
        },
      };
    },
  } as unknown as ClickhouseClient;
}

function specFor(
  telemetryType: TelemetryIngestionSignal,
): TelemetryIngestionSignalSpec {
  const spec: TelemetryIngestionSignalSpec | undefined =
    TELEMETRY_INGESTION_SIGNALS.find(
      (candidate: TelemetryIngestionSignalSpec): boolean => {
        return candidate.telemetryType === telemetryType;
      },
    );

  if (!spec) {
    throw new Error(`No telemetry signal registered for ${telemetryType}`);
  }

  return spec;
}

function projectRows(data: {
  telemetryType: string;
  available?: boolean | undefined;
  truncated?: boolean | undefined;
  rows: Array<{
    projectId: string;
    lastMinute: number | null;
    lastHour: number | null;
    lastDay: number | null;
  }>;
}): TelemetrySignalProjectRows {
  return {
    telemetryType: data.telemetryType,
    available: data.available ?? true,
    truncated: data.truncated ?? false,
    rows: data.rows,
  };
}

function signalOf(
  project: TelemetryProjectIngestion,
  telemetryType: string,
): TelemetryProjectSignalIngestion {
  const signal: TelemetryProjectSignalIngestion | undefined =
    project.signals.find(
      (candidate: TelemetryProjectSignalIngestion): boolean => {
        return candidate.telemetryType === telemetryType;
      },
    );

  if (!signal) {
    throw new Error(`Project ${project.projectId} has no ${telemetryType} row`);
  }

  return signal;
}

describe("telemetry signal registry", () => {
  test("covers exactly the three signals OneUptime ingests", () => {
    expect(
      TELEMETRY_INGESTION_SIGNALS.map(
        (spec: TelemetryIngestionSignalSpec): string => {
          return spec.telemetryType;
        },
      ),
    ).toEqual(["Logs", "Metrics", "Traces"]);
  });

  test("points each signal at its own analytics table", () => {
    expect(specFor(TelemetryIngestionSignal.Logs).table).toBe(
      AnalyticsTableName.Log,
    );
    expect(specFor(TelemetryIngestionSignal.Metrics).table).toBe(
      AnalyticsTableName.Metric,
    );
    expect(specFor(TelemetryIngestionSignal.Traces).table).toBe(
      AnalyticsTableName.Span,
    );
  });

  /*
   * Spans are ordered on startTime, not `time` — a copy-paste of the log spec
   * would filter on a column the table does not have and drop traces entirely.
   */
  test("counts each signal on the event-time column its table is ordered by", () => {
    expect(specFor(TelemetryIngestionSignal.Logs).timeColumn).toBe("time");
    expect(specFor(TelemetryIngestionSignal.Metrics).timeColumn).toBe("time");
    expect(specFor(TelemetryIngestionSignal.Traces).timeColumn).toBe(
      "startTime",
    );
  });

  /*
   * `createdAt` is the true write time but is unindexed and unpartitioned on
   * these tables, so filtering on it forces a full-table scan. No spec may name
   * it, no matter how tempting "when did we actually write this" sounds.
   */
  test("never counts on the unindexed write-time column", () => {
    for (const spec of TELEMETRY_INGESTION_SIGNALS) {
      expect(spec.timeColumn).not.toBe("createdAt");
    }
  });
});

describe("buildSignalIngestionQuery", () => {
  const query: string = buildSignalIngestionQuery({
    spec: specFor(TelemetryIngestionSignal.Logs),
    databaseName: "oneuptime",
  });

  test("bounds the scan to the last day so only the last day's partitions are read", () => {
    expect(query).toContain("WHERE `time` >= now() - INTERVAL 1 DAY");
  });

  // A future-dated event would otherwise inflate every window it lands in.
  test("bounds the scan at the present too", () => {
    expect(query).toContain("`time` <= now()");
  });

  /*
   * The smaller windows are countIf projections of the SAME scan. Issuing them
   * as separate queries would triple the read for identical numbers.
   */
  test("derives the minute and hour windows from the one day-bounded scan", () => {
    expect(query).toContain(
      "countIf(`time` >= now() - INTERVAL 1 MINUTE) AS last_minute",
    );
    expect(query).toContain(
      "countIf(`time` >= now() - INTERVAL 1 HOUR) AS last_hour",
    );
    expect(query).toContain("count() AS last_day");
    expect(query.match(/FROM/g)).toHaveLength(1);
  });

  test("reads the app-facing distributed table, which spans every shard", () => {
    expect(query).toContain("FROM `oneuptime`.`LogItemV3`");
    expect(query).not.toContain("LogItemV3Local");
  });

  test("uses the span's own start-time column for traces", () => {
    const traceQuery: string = buildSignalIngestionQuery({
      spec: specFor(TelemetryIngestionSignal.Traces),
      databaseName: "oneuptime",
    });

    expect(traceQuery).toContain(
      "countIf(`startTime` >= now() - INTERVAL 1 MINUTE)",
    );
    expect(traceQuery).toContain("FROM `oneuptime`.`SpanItemV3`");
  });

  test("counts rows only — no telemetry row data is selected", () => {
    expect(query).not.toContain("SELECT *");
    expect(query).not.toContain("body");
    expect(query).not.toContain("attributes");
  });
});

describe("buildProjectIngestionQuery", () => {
  const query: string = buildProjectIngestionQuery({
    spec: specFor(TelemetryIngestionSignal.Logs),
    databaseName: "oneuptime",
    limit: 500,
  });

  /*
   * projectId is the LEADING primary-key column of all three telemetry tables.
   * It is the one dimension these tables can be grouped on without a full scan
   * of the day's partitions — grouping by service, host or attribute would not
   * be affordable here.
   */
  test("groups on the leading primary-key column", () => {
    expect(query).toContain("GROUP BY projectId");
    expect(query).toContain("projectId AS project_id");
  });

  test("keeps the same day-bounded single scan as the by-signal query", () => {
    expect(query).toContain("WHERE `time` >= now() - INTERVAL 1 DAY");
    expect(query).toContain("`time` <= now()");
    expect(query).toContain(
      "countIf(`time` >= now() - INTERVAL 1 MINUTE) AS last_minute",
    );
    expect(query.match(/FROM/g)).toHaveLength(1);
  });

  /*
   * If the cap ever bites it must drop the SMALLEST tenants, not an arbitrary
   * slice — and projectId as the tie-break keeps the list from reshuffling
   * between two polls that return identical numbers.
   */
  test("orders by the widest window so a cap drops the smallest tenants", () => {
    expect(query).toContain("ORDER BY last_day DESC, project_id ASC");
  });

  test("caps the number of tenants returned", () => {
    expect(query).toContain("LIMIT 500");
  });

  test("never emits a fractional or zero limit", () => {
    expect(
      buildProjectIngestionQuery({
        spec: specFor(TelemetryIngestionSignal.Logs),
        databaseName: "oneuptime",
        limit: 10.7,
      }),
    ).toContain("LIMIT 10");

    expect(
      buildProjectIngestionQuery({
        spec: specFor(TelemetryIngestionSignal.Logs),
        databaseName: "oneuptime",
        limit: 0,
      }),
    ).toContain("LIMIT 1");
  });

  test("selects no telemetry row data, only the tenant id and counts", () => {
    expect(query).not.toContain("SELECT *");
    expect(query).not.toContain("body");
  });
});

describe("buildTelemetryStorageSizeQuery", () => {
  const query: string = buildTelemetryStorageSizeQuery({
    clusterName: "oneuptime",
    databaseName: "oneuptime",
    storageTableNames: ["LogItemV3Local", "MetricItemV3Local"],
  });

  /*
   * The app-facing names are Distributed wrappers that hold no parts of their
   * own. Sizing them would match nothing and leave every "Actual size" blank.
   */
  test("sizes the local storage tables, not the distributed wrappers", () => {
    expect(query).toContain("'LogItemV3Local', 'MetricItemV3Local'");
  });

  /*
   * cluster() hits ONE replica per shard. clusterAllReplicas would sum the same
   * shard once per replica and overreport the footprint by the replication
   * factor.
   */
  test("reads one replica per shard so replicas are not double-counted", () => {
    expect(query).toContain("cluster('oneuptime', system.parts)");
    expect(query).not.toContain("clusterAllReplicas");
  });

  test("counts only active parts, so replaced parts are not added twice", () => {
    expect(query).toContain("WHERE active");
  });

  /*
   * data_uncompressed_bytes is the actual data volume the page claims to show;
   * bytes_on_disk is the compressed footprint and is a different number.
   */
  test("reports the uncompressed volume the page labels 'actual size'", () => {
    expect(query).toContain(
      "sum(data_uncompressed_bytes) AS uncompressed_bytes",
    );
    expect(query).not.toContain("bytes_on_disk");
  });

  test("escapes quotes in the cluster and database names", () => {
    expect(
      buildTelemetryStorageSizeQuery({
        clusterName: "it's",
        databaseName: "db's",
        storageTableNames: ["a'b"],
      }),
    ).toContain("cluster('it''s', system.parts)");
    expect(
      buildTelemetryStorageSizeQuery({
        clusterName: "it's",
        databaseName: "db's",
        storageTableNames: ["a'b"],
      }),
    ).toContain("database = 'db''s'");
    expect(
      buildTelemetryStorageSizeQuery({
        clusterName: "it's",
        databaseName: "db's",
        storageTableNames: ["a'b"],
      }),
    ).toContain("'a''b'");
  });
});

describe("toCountOrNull", () => {
  test("reads ClickHouse's stringified UInt64 counts as numbers", () => {
    expect(toCountOrNull("4210")).toBe(4210);
    expect(toCountOrNull(0)).toBe(0);
  });

  // Absent is not zero: the page prints "—" for one and "0" for the other.
  test("keeps an unreadable count unknown rather than calling it zero", () => {
    expect(toCountOrNull(null)).toBeNull();
    expect(toCountOrNull(undefined)).toBeNull();
    expect(toCountOrNull("")).toBeNull();
    expect(toCountOrNull("not-a-number")).toBeNull();
    expect(toCountOrNull(Infinity)).toBeNull();
  });
});

describe("sumCountsOrNull", () => {
  test("adds the counts it knows", () => {
    expect(sumCountsOrNull([1, 2, 3])).toBe(6);
  });

  /*
   * A partial total is still the most useful number available — dropping the
   * whole row because one signal is unreadable hides the two that answered.
   */
  test("totals what is known when only some inputs are missing", () => {
    expect(sumCountsOrNull([5, null, 7])).toBe(12);
  });

  test("stays unknown when nothing is known", () => {
    expect(sumCountsOrNull([null, null])).toBeNull();
    expect(sumCountsOrNull([])).toBeNull();
  });

  // Zero is a real total and must not be mistaken for "nothing was known".
  test("reports a genuine zero as zero", () => {
    expect(sumCountsOrNull([0, 0])).toBe(0);
  });
});

describe("mergeProjectIngestionRows", () => {
  test("folds the three signals into one row per project", () => {
    const projects: Array<TelemetryProjectIngestion> =
      mergeProjectIngestionRows([
        projectRows({
          telemetryType: "Logs",
          rows: [
            { projectId: "p1", lastMinute: 1, lastHour: 10, lastDay: 100 },
          ],
        }),
        projectRows({
          telemetryType: "Metrics",
          rows: [
            { projectId: "p1", lastMinute: 2, lastHour: 20, lastDay: 200 },
          ],
        }),
        projectRows({
          telemetryType: "Traces",
          rows: [
            { projectId: "p1", lastMinute: 3, lastHour: 30, lastDay: 300 },
          ],
        }),
      ]);

    expect(projects).toHaveLength(1);
    expect(projects[0]!.projectId).toBe("p1");
    expect(projects[0]!.lastMinute).toBe(6);
    expect(projects[0]!.lastHour).toBe(60);
    expect(projects[0]!.lastDay).toBe(600);
  });

  /*
   * A tenant sending only logs really did send zero metrics. That is a fact, not
   * a gap, and the row has to say 0 — otherwise every logs-only instance shows a
   * page full of dashes.
   */
  test("a project missing from a successful signal ingested none of it", () => {
    const projects: Array<TelemetryProjectIngestion> =
      mergeProjectIngestionRows([
        projectRows({
          telemetryType: "Logs",
          rows: [{ projectId: "p1", lastMinute: 1, lastHour: 1, lastDay: 1 }],
        }),
        projectRows({ telemetryType: "Metrics", rows: [] }),
        projectRows({ telemetryType: "Traces", rows: [] }),
      ]);

    expect(signalOf(projects[0]!, "Metrics").lastDay).toBe(0);
    expect(signalOf(projects[0]!, "Traces").lastDay).toBe(0);
    expect(projects[0]!.lastDay).toBe(1);
  });

  /*
   * The opposite case, and the one that matters most: when the QUERY failed we
   * know nothing about that signal for anybody. Reporting 0 there would read as
   * "every tenant stopped sending traces" — an incident that never happened.
   */
  test("a signal whose query failed stays unknown for every project", () => {
    const projects: Array<TelemetryProjectIngestion> =
      mergeProjectIngestionRows([
        projectRows({
          telemetryType: "Logs",
          rows: [{ projectId: "p1", lastMinute: 1, lastHour: 1, lastDay: 1 }],
        }),
        projectRows({
          telemetryType: "Traces",
          available: false,
          rows: [],
        }),
      ]);

    expect(signalOf(projects[0]!, "Traces").lastDay).toBeNull();
    expect(signalOf(projects[0]!, "Traces").lastHour).toBeNull();
    expect(signalOf(projects[0]!, "Traces").lastMinute).toBeNull();
    // The total still reports the signals that did answer.
    expect(projects[0]!.lastDay).toBe(1);
  });

  /*
   * Rows returned by a signal that reported unavailable are not trustworthy
   * (a partial read before a timeout), so they must not create project rows.
   */
  test("ignores rows carried by a signal that reported itself unavailable", () => {
    const projects: Array<TelemetryProjectIngestion> =
      mergeProjectIngestionRows([
        projectRows({
          telemetryType: "Logs",
          available: false,
          rows: [{ projectId: "p1", lastMinute: 1, lastHour: 1, lastDay: 1 }],
        }),
      ]);

    expect(projects).toEqual([]);
  });

  test("orders the biggest tenant first", () => {
    const projects: Array<TelemetryProjectIngestion> =
      mergeProjectIngestionRows([
        projectRows({
          telemetryType: "Logs",
          rows: [
            { projectId: "small", lastMinute: 0, lastHour: 1, lastDay: 5 },
            { projectId: "big", lastMinute: 0, lastHour: 9, lastDay: 900 },
            { projectId: "medium", lastMinute: 0, lastHour: 4, lastDay: 40 },
          ],
        }),
      ]);

    expect(
      projects.map((project: TelemetryProjectIngestion): string => {
        return project.projectId;
      }),
    ).toEqual(["big", "medium", "small"]);
  });

  /*
   * Two tenants with identical volumes must not swap places between polls —
   * a table that reshuffles under a cursor is unusable.
   */
  test("breaks ties on project id so the order is stable between refreshes", () => {
    const projects: Array<TelemetryProjectIngestion> =
      mergeProjectIngestionRows([
        projectRows({
          telemetryType: "Logs",
          rows: [
            { projectId: "b", lastMinute: 0, lastHour: 0, lastDay: 10 },
            { projectId: "a", lastMinute: 0, lastHour: 0, lastDay: 10 },
          ],
        }),
      ]);

    expect(
      projects.map((project: TelemetryProjectIngestion): string => {
        return project.projectId;
      }),
    ).toEqual(["a", "b"]);
  });

  test("every project carries one entry per signal, in registry order", () => {
    const projects: Array<TelemetryProjectIngestion> =
      mergeProjectIngestionRows([
        projectRows({
          telemetryType: "Logs",
          rows: [{ projectId: "p1", lastMinute: 0, lastHour: 0, lastDay: 1 }],
        }),
        projectRows({ telemetryType: "Metrics", rows: [] }),
        projectRows({ telemetryType: "Traces", rows: [] }),
      ]);

    expect(
      projects[0]!.signals.map(
        (signal: TelemetryProjectSignalIngestion): string => {
          return signal.telemetryType;
        },
      ),
    ).toEqual(["Logs", "Metrics", "Traces"]);
  });
});

describe("attachProjectNames", () => {
  const projects: Array<TelemetryProjectIngestion> = mergeProjectIngestionRows([
    projectRows({
      telemetryType: "Logs",
      rows: [
        { projectId: "known", lastMinute: 0, lastHour: 0, lastDay: 20 },
        { projectId: "deleted", lastMinute: 0, lastHour: 0, lastDay: 10 },
      ],
    }),
  ]);

  test("labels a project with its name", () => {
    const named: Array<TelemetryProjectIngestion> = attachProjectNames(
      projects,
      new Map<string, string>([["known", "Acme"]]),
    );

    expect(named[0]!.projectName).toBe("Acme");
  });

  /*
   * Telemetry outlives its project: retention keeps the rows for days after the
   * project row is gone. That volume is real and still has to be attributable,
   * so an unresolved project keeps a null name rather than being dropped.
   */
  test("keeps a project whose name no longer resolves", () => {
    const named: Array<TelemetryProjectIngestion> = attachProjectNames(
      projects,
      new Map<string, string>([["known", "Acme"]]),
    );

    expect(named).toHaveLength(2);
    expect(named[1]!.projectId).toBe("deleted");
    expect(named[1]!.projectName).toBeNull();
    expect(named[1]!.lastDay).toBe(10);
  });

  test("leaves the counts untouched", () => {
    const named: Array<TelemetryProjectIngestion> = attachProjectNames(
      projects,
      new Map<string, string>(),
    );

    expect(named[0]!.lastDay).toBe(20);
    expect(named[0]!.signals).toEqual(projects[0]!.signals);
  });
});

describe("getTelemetryIngestionBySignal", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reports not connected when ClickHouse is absent, without throwing", async () => {
    jest
      .spyOn(ClickhouseAppInstance, "getDataSource")
      .mockReturnValue(null as unknown as ClickhouseClient);

    const result: TelemetrySignalIngestionResult =
      await getTelemetryIngestionBySignal();

    expect(result.connected).toBe(false);
    expect(result.tables).toEqual([]);
  });

  test("reads each signal's counts and footprint", async () => {
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(
      makeClient(
        async (options: {
          query: string;
        }): Promise<{ data: Array<JSONObject> }> => {
          if (options.query.includes("system.parts")) {
            return {
              data: [{ table: "LogItemV3Local", uncompressed_bytes: "2048" }],
            };
          }

          return {
            data: [{ last_minute: "1", last_hour: "60", last_day: "1440" }],
          };
        },
      ),
    );

    const result: TelemetrySignalIngestionResult =
      await getTelemetryIngestionBySignal();

    expect(result.connected).toBe(true);
    expect(result.tables).toHaveLength(3);

    const logs: TelemetrySignalIngestion = result.tables[0]!;
    expect(logs.telemetryType).toBe("Logs");
    expect(logs.lastMinute).toBe(1);
    expect(logs.lastHour).toBe(60);
    expect(logs.lastDay).toBe(1440);
    expect(logs.uncompressedBytes).toBe(2048);
    expect(logs.available).toBe(true);
  });

  /*
   * An instance that only ingests logs has no metric or span table. That must
   * cost the missing signal its row's numbers and nothing else.
   */
  test("a failing table leaves the signals that answered intact", async () => {
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(
      makeClient(
        async (options: {
          query: string;
        }): Promise<{ data: Array<JSONObject> }> => {
          if (options.query.includes("SpanItemV3")) {
            throw new Error("UNKNOWN_TABLE");
          }

          if (options.query.includes("system.parts")) {
            return { data: [] };
          }

          return {
            data: [{ last_minute: "1", last_hour: "2", last_day: "3" }],
          };
        },
      ),
    );

    const result: TelemetrySignalIngestionResult =
      await getTelemetryIngestionBySignal();

    const traces: TelemetrySignalIngestion = result.tables[2]!;
    expect(traces.telemetryType).toBe("Traces");
    expect(traces.available).toBe(false);
    expect(traces.lastDay).toBeNull();
    expect(result.tables[0]!.lastDay).toBe(3);
  });

  // The counts are the point; a blank size column is a far smaller loss.
  test("a failing size query still reports the ingestion counts", async () => {
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(
      makeClient(
        async (options: {
          query: string;
        }): Promise<{ data: Array<JSONObject> }> => {
          if (options.query.includes("system.parts")) {
            throw new Error("ACCESS_DENIED");
          }

          return {
            data: [{ last_minute: "1", last_hour: "2", last_day: "3" }],
          };
        },
      ),
    );

    const result: TelemetrySignalIngestionResult =
      await getTelemetryIngestionBySignal();

    expect(result.tables[0]!.uncompressedBytes).toBeNull();
    expect(result.tables[0]!.lastDay).toBe(3);
  });
});

describe("getTelemetryIngestionByProject", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reports not connected when ClickHouse is absent, without throwing", async () => {
    jest
      .spyOn(ClickhouseAppInstance, "getDataSource")
      .mockReturnValue(null as unknown as ClickhouseClient);

    const result: TelemetryProjectIngestionResult =
      await getTelemetryIngestionByProject();

    expect(result.connected).toBe(false);
    expect(result.projects).toEqual([]);
  });

  test("merges the per-signal groupings into per-project rows", async () => {
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(
      makeClient(
        async (options: {
          query: string;
        }): Promise<{ data: Array<JSONObject> }> => {
          if (options.query.includes("LogItemV3")) {
            return {
              data: [
                {
                  project_id: "p1",
                  last_minute: "1",
                  last_hour: "5",
                  last_day: "50",
                },
              ],
            };
          }

          if (options.query.includes("MetricItemV3")) {
            return {
              data: [
                {
                  project_id: "p1",
                  last_minute: "2",
                  last_hour: "6",
                  last_day: "60",
                },
                {
                  project_id: "p2",
                  last_minute: "0",
                  last_hour: "0",
                  last_day: "5",
                },
              ],
            };
          }

          return { data: [] };
        },
      ),
    );

    const result: TelemetryProjectIngestionResult =
      await getTelemetryIngestionByProject();

    expect(result.connected).toBe(true);
    expect(
      result.projects.map((project: TelemetryProjectIngestion): string => {
        return project.projectId;
      }),
    ).toEqual(["p1", "p2"]);
    expect(result.projects[0]!.lastDay).toBe(110);
    // p2 sent metrics only, so its logs really are zero.
    expect(signalOf(result.projects[1]!, "Logs").lastDay).toBe(0);
  });

  test("names are left for the caller to resolve", async () => {
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(
      makeClient(async (): Promise<{ data: Array<JSONObject> }> => {
        return {
          data: [
            {
              project_id: "p1",
              last_minute: "0",
              last_hour: "0",
              last_day: "1",
            },
          ],
        };
      }),
    );

    const result: TelemetryProjectIngestionResult =
      await getTelemetryIngestionByProject();

    expect(result.projects[0]!.projectName).toBeNull();
  });

  test("a failing signal is reported as unavailable, not as zero", async () => {
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(
      makeClient(
        async (options: {
          query: string;
        }): Promise<{ data: Array<JSONObject> }> => {
          if (options.query.includes("SpanItemV3")) {
            throw new Error("UNKNOWN_TABLE");
          }

          return {
            data: [
              {
                project_id: "p1",
                last_minute: "0",
                last_hour: "0",
                last_day: "1",
              },
            ],
          };
        },
      ),
    );

    const result: TelemetryProjectIngestionResult =
      await getTelemetryIngestionByProject();

    expect(result.signals).toEqual([
      { telemetryType: "Logs", available: true, truncated: false },
      { telemetryType: "Metrics", available: true, truncated: false },
      { telemetryType: "Traces", available: false, truncated: false },
    ]);
    expect(signalOf(result.projects[0]!, "Traces").lastDay).toBeNull();
  });

  /*
   * Silently dropping tenants off the bottom of a list an operator reads as
   * "everyone who is ingesting" is the failure this flag exists to prevent.
   */
  test("flags truncation when a signal fills the cap", async () => {
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(
      makeClient(
        async (options: {
          query: string;
        }): Promise<{ data: Array<JSONObject> }> => {
          if (!options.query.includes("LogItemV3")) {
            return { data: [] };
          }

          return {
            data: Array.from(
              { length: MAX_PROJECTS_PER_SIGNAL },
              (_unused: unknown, index: number): JSONObject => {
                return {
                  project_id: `p${index}`,
                  last_minute: "0",
                  last_hour: "0",
                  last_day: "1",
                };
              },
            ),
          };
        },
      ),
    );

    const result: TelemetryProjectIngestionResult =
      await getTelemetryIngestionByProject();

    expect(result.truncated).toBe(true);
    expect(result.projects).toHaveLength(MAX_PROJECTS_PER_SIGNAL);
  });

  test("does not flag truncation when every signal came back under the cap", async () => {
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(
      makeClient(async (): Promise<{ data: Array<JSONObject> }> => {
        return {
          data: [
            {
              project_id: "p1",
              last_minute: "0",
              last_hour: "0",
              last_day: "1",
            },
          ],
        };
      }),
    );

    const result: TelemetryProjectIngestionResult =
      await getTelemetryIngestionByProject();

    expect(result.truncated).toBe(false);
  });

  test("survives ClickHouse failing entirely", async () => {
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(
      makeClient(async (): Promise<{ data: Array<JSONObject> }> => {
        throw new Error("connection refused");
      }),
    );

    const result: TelemetryProjectIngestionResult =
      await getTelemetryIngestionByProject();

    expect(result.connected).toBe(true);
    expect(result.projects).toEqual([]);
    expect(
      result.signals.every((signal: { available: boolean }): boolean => {
        return !signal.available;
      }),
    ).toBe(true);
  });
});

describe("query timeouts", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * These are dashboard polls against the largest tables in the system. Without
   * a server-side cap, one refresh on a struggling cluster can hold a query slot
   * for as long as the HTTP client will wait.
   */
  test("every probe query is capped with max_execution_time", async () => {
    const settings: Array<unknown> = [];

    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue({
      query: (options: {
        clickhouse_settings?: { max_execution_time?: number };
      }): Promise<unknown> => {
        settings.push(options.clickhouse_settings?.max_execution_time);

        return Promise.resolve({
          json: (): Promise<{ data: Array<JSONObject> }> => {
            return Promise.resolve({ data: [] });
          },
        });
      },
    } as unknown as ClickhouseClient);

    await getTelemetryIngestionBySignal();
    await getTelemetryIngestionByProject();

    expect(settings.length).toBeGreaterThan(0);
    expect(
      settings.every((value: unknown): boolean => {
        return typeof value === "number" && value > 0;
      }),
    ).toBe(true);
  });
});
