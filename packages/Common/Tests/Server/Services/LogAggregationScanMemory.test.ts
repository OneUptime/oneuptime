import LogAggregationService, {
  AnalyticsRequest,
  FacetRequest,
  HistogramRequest,
} from "../../../Server/Services/LogAggregationService";
import LogDatabaseService from "../../../Server/Services/LogService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  AGGREGATION_SCAN_MAX_BLOCK_SIZE,
  AGGREGATION_SCAN_MAX_THREADS,
  AGGREGATION_SCAN_PREFERRED_BLOCK_SIZE_IN_BYTES,
  DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY_IN_BYTES,
  DEFAULT_MAX_MEMORY_USAGE_IN_BYTES,
  getQuerySettings,
} from "../../../Server/Utils/AnalyticsDatabase/QuerySettingsHelper";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Scan-side memory bounds for the Logs aggregations.
 *
 * Reported from production alongside the `_id` sort regression, but a
 * genuinely separate defect: six Logs queries aborted with Code 241 (3 GiB
 * max_memory_usage exceeded). These are the facet counts and the severity
 * histogram, which never enter toFindStatement at all — they are hand-built
 * statements in LogAggregationService executed through executeQuery, so the
 * sort fix does not touch them.
 *
 * The field report labelled these "aggregation memory". Measured, that label
 * is wrong for the common case and the distinction decides the fix. The group
 * keys are small (severityText has ~10 distinct values; the histogram's inner
 * key is (minute, severityText) — ~14k groups over 24h), so the hash table is
 * not the problem. The memory is SCAN-side: a GROUP BY over a log window must
 * visit every matching row, and a filter on `attributes` (a fat
 * Map(String, String)) or `body` forces those wide columns to be read for the
 * whole window. Peak memory is roughly threads x block rows x bytes per row,
 * and the default 65536-row block is what pushes it over.
 *
 * Measured on ClickHouse 26.7, 3M rows shaped like LogItemV3, one facet query
 * filtered on an attribute value:
 *
 *   default                                  695 MiB peak
 *   max_block_size alone                      88 MiB peak (and faster)
 *   + preferred_block_size_bytes, max_threads  40 MiB peak
 *
 * Same shape on the histogram once a non-projection filter drops it off the
 * proj_severity_histogram projection: 591 MiB -> 39 MiB.
 *
 * These are execution-strategy settings, so they cannot change the result set
 * — verified against a real server, and pinned below by asserting the bound
 * settings are ADDITIVE to each statement rather than replacing anything.
 *
 * What this does NOT fix, deliberately: a facet on a genuinely
 * high-cardinality attribute builds a large GROUP BY hash table no matter how
 * the scan is bounded. That case is already covered by
 * max_bytes_before_external_group_by spilling to disk, which every read here
 * carries.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const START_TIME: Date = new Date("2026-03-01T00:00:00.000Z");
const END_TIME: Date = new Date("2026-03-12T00:00:00.000Z");

const BOUND_SETTINGS: Array<string> = [
  `max_block_size = ${AGGREGATION_SCAN_MAX_BLOCK_SIZE}`,
  `preferred_block_size_bytes = ${AGGREGATION_SCAN_PREFERRED_BLOCK_SIZE_IN_BYTES}`,
  `max_threads = ${AGGREGATION_SCAN_MAX_THREADS}`,
];

const facetRequest: FacetRequest = {
  projectId: PROJECT_ID,
  startTime: START_TIME,
  endTime: END_TIME,
  facetKey: "severityText",
  limit: 15,
};

const histogramRequest: HistogramRequest = {
  projectId: PROJECT_ID,
  startTime: START_TIME,
  endTime: END_TIME,
  bucketSizeInMinutes: 15,
} as HistogramRequest;

const analyticsRequest: AnalyticsRequest = {
  projectId: PROJECT_ID,
  startTime: START_TIME,
  endTime: END_TIME,
} as AnalyticsRequest;

/* The top-list and table builders read request.groupBy[0]. */
const analyticsGroupedRequest: AnalyticsRequest = {
  ...analyticsRequest,
  groupBy: ["severityText"],
} as AnalyticsRequest;

/*
 * The builders are private; the suite exercises them the same way the
 * existing LogAggregationService suite does.
 */
function build(builder: string, request: unknown): Statement {
  return (
    LogAggregationService as unknown as Record<
      string,
      (arg: unknown) => Statement
    >
  )[builder]!(request);
}

/* Every statement that must carry the bound, and the request it takes. */
const BOUNDED_BUILDERS: Array<[string, unknown]> = [
  ["buildFacetStatement", facetRequest],
  ["buildHistogramStatement", histogramRequest],
  ["buildAnalyticsTimeseriesStatement", analyticsRequest],
  ["buildAnalyticsTopListStatement", analyticsGroupedRequest],
  ["buildAnalyticsTableStatement", analyticsGroupedRequest],
];

describe("getQuerySettings scan memory bound", () => {
  test("emits nothing extra when the bound is not requested", () => {
    const settings: string = getQuerySettings({});

    for (const setting of BOUND_SETTINGS) {
      expect(settings).not.toContain(setting.split(" =")[0]!);
    }
  });

  test("boundScanMemory: false is treated as not requested", () => {
    expect(getQuerySettings({ boundScanMemory: false })).toBe(
      getQuerySettings({}),
    );
  });

  test("emits all three bound settings when requested", () => {
    const settings: string = getQuerySettings({ boundScanMemory: true });

    for (const setting of BOUND_SETTINGS) {
      expect(settings).toContain(setting);
    }
  });

  /*
   * The bound must be ADDITIVE. If it ever replaced the memory ceiling or the
   * spill thresholds, a bounded query would lose its abort guard entirely.
   */
  test("the bound does not displace the memory ceiling or spill thresholds", () => {
    const settings: string = getQuerySettings({ boundScanMemory: true });

    expect(settings).toContain(
      `max_memory_usage = ${DEFAULT_MAX_MEMORY_USAGE_IN_BYTES}`,
    );
    expect(settings).toContain(
      `max_bytes_before_external_group_by = ${DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY_IN_BYTES}`,
    );
  });

  test("the bound is purely additive to the unbounded setting list", () => {
    const unbounded: Array<string> = getQuerySettings({})
      .replace(" SETTINGS ", "")
      .split(", ");
    const bounded: Array<string> = getQuerySettings({ boundScanMemory: true })
      .replace(" SETTINGS ", "")
      .split(", ");

    expect(bounded).toStrictEqual([...unbounded, ...BOUND_SETTINGS]);
  });

  test("composes with execution-time settings without reordering them", () => {
    const settings: string = getQuerySettings({
      maxExecutionTimeInSeconds: 45,
      timeoutOverflowMode: "break",
      boundScanMemory: true,
    });

    expect(settings.indexOf("max_execution_time")).toBeLessThan(
      settings.indexOf("max_memory_usage"),
    );
    expect(settings.indexOf("max_memory_usage")).toBeLessThan(
      settings.indexOf("max_block_size"),
    );
  });

  /*
   * The histogram passes optimize_use_projections through additionalSettings.
   * Emitting the bound first means an explicit additional setting still wins
   * on a duplicate key, since ClickHouse takes the last occurrence.
   */
  test("additional settings are emitted after the bound so they can override it", () => {
    const settings: string = getQuerySettings({
      boundScanMemory: true,
      additionalSettings: { max_threads: 16 },
    });

    expect(
      settings.indexOf(`max_threads = ${AGGREGATION_SCAN_MAX_THREADS}`),
    ).toBeLessThan(settings.lastIndexOf("max_threads = 16"));
  });

  test("keeps the projection hint alongside the bound", () => {
    const settings: string = getQuerySettings({
      boundScanMemory: true,
      additionalSettings: { optimize_use_projections: 1 },
    });

    expect(settings).toContain("optimize_use_projections = 1");
    expect(settings).toContain(
      `max_block_size = ${AGGREGATION_SCAN_MAX_BLOCK_SIZE}`,
    );
  });

  /*
   * A block size at or above the ClickHouse default would make the setting a
   * no-op and silently un-fix the bug.
   */
  test("the block size is meaningfully below the ClickHouse default of 65536", () => {
    expect(AGGREGATION_SCAN_MAX_BLOCK_SIZE).toBeLessThan(65536);
    expect(AGGREGATION_SCAN_MAX_BLOCK_SIZE).toBeGreaterThan(0);
  });

  test("the thread cap is positive and bounded", () => {
    expect(AGGREGATION_SCAN_MAX_THREADS).toBeGreaterThan(0);
    expect(AGGREGATION_SCAN_MAX_THREADS).toBeLessThanOrEqual(8);
  });
});

describe("LogAggregationService scan memory bound", () => {
  test.each(BOUNDED_BUILDERS)(
    "%s bounds its scan",
    (builder: string, request: unknown) => {
      const query: string = build(builder, request).query;

      for (const setting of BOUND_SETTINGS) {
        expect(query).toContain(setting);
      }
    },
  );

  test.each(BOUNDED_BUILDERS)(
    "%s keeps its 3 GiB abort guard and spill thresholds",
    (builder: string, request: unknown) => {
      const query: string = build(builder, request).query;

      expect(query).toContain(
        `max_memory_usage = ${DEFAULT_MAX_MEMORY_USAGE_IN_BYTES}`,
      );
      expect(query).toContain(
        `max_bytes_before_external_group_by = ${DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY_IN_BYTES}`,
      );
    },
  );

  test.each(BOUNDED_BUILDERS)(
    "%s keeps its execution-time cap in break mode",
    (builder: string, request: unknown) => {
      const query: string = build(builder, request).query;

      expect(query).toContain("max_execution_time = 45");
      expect(query).toContain("timeout_overflow_mode = 'break'");
    },
  );

  /*
   * The bound is a SETTINGS-clause change only. If it ever leaked into the
   * query body it could change results, which is the one thing it must not do.
   */
  test.each(BOUNDED_BUILDERS)(
    "%s confines the bound to the SETTINGS clause",
    (builder: string, request: unknown) => {
      const query: string = build(builder, request).query;
      const body: string = query.split(" SETTINGS ")[0]!;

      expect(body).not.toContain("max_block_size");
      expect(body).not.toContain("preferred_block_size_bytes");
      expect(body).not.toContain("max_threads");
    },
  );

  test.each(BOUNDED_BUILDERS)(
    "%s emits exactly one SETTINGS clause",
    (builder: string, request: unknown) => {
      const query: string = build(builder, request).query;

      expect(query.split(" SETTINGS ").length - 1).toBe(1);
    },
  );

  /*
   * The bound must not disturb parameter binding — it emits trusted literals
   * only, never a bound parameter.
   */
  test.each(BOUNDED_BUILDERS)(
    "%s binds no parameter for the bound settings",
    (builder: string, request: unknown) => {
      const statement: Statement = build(builder, request);
      const values: Array<unknown> = Object.values(statement.query_params);

      expect(values).not.toContain(AGGREGATION_SCAN_MAX_BLOCK_SIZE);
      expect(values).not.toContain(
        AGGREGATION_SCAN_PREFERRED_BLOCK_SIZE_IN_BYTES,
      );
      expect(statement.query.split(" SETTINGS ")[1]!.includes("{p")).toBe(
        false,
      );
    },
  );

  /*
   * The histogram is written to hit the proj_severity_histogram aggregate
   * projection, and the bound must not cost it that plan.
   */
  test("the histogram keeps its projection hint", () => {
    const query: string = build(
      "buildHistogramStatement",
      histogramRequest,
    ).query;

    expect(query).toContain("optimize_use_projections = 1");
  });

  /*
   * The expensive filters are the reason this bug exists: an attribute or
   * body predicate forces the fat columns to be read across the whole window.
   * Those are exactly the statements that must carry the bound.
   */
  test("a facet filtered on an attribute is bounded", () => {
    const query: string = build("buildFacetStatement", {
      ...facetRequest,
      attributes: { "k8s.namespace": "production" },
    }).query;

    expect(query).toContain("arrayExists");
    expect(query).toContain(
      `max_block_size = ${AGGREGATION_SCAN_MAX_BLOCK_SIZE}`,
    );
  });

  test("a facet filtered on body text is bounded", () => {
    const query: string = build("buildFacetStatement", {
      ...facetRequest,
      bodySearchText: "timeout",
    }).query;

    expect(query).toContain("body ILIKE");
    expect(query).toContain(
      `max_block_size = ${AGGREGATION_SCAN_MAX_BLOCK_SIZE}`,
    );
  });

  /*
   * A histogram carrying a non-projection filter falls back to a base-table
   * scan of the window. That fallback is the histogram's blowup case, so it
   * must be bounded.
   */
  test("a histogram that falls off its projection is bounded", () => {
    const query: string = build("buildHistogramStatement", {
      ...histogramRequest,
      attributes: { "k8s.namespace": "production" },
    }).query;

    expect(query).toContain("arrayExists");
    expect(query).toContain(
      `max_block_size = ${AGGREGATION_SCAN_MAX_BLOCK_SIZE}`,
    );
  });

  test("an attribute-value facet is bounded", () => {
    const query: string = build("buildFacetStatement", {
      ...facetRequest,
      facetKey: "k8s.pod.name",
    }).query;

    expect(query).toContain("attributes[");
    expect(query).toContain(
      `max_block_size = ${AGGREGATION_SCAN_MAX_BLOCK_SIZE}`,
    );
  });

  /*
   * getExportLogs is deliberately NOT bounded: it reads rows rather than
   * aggregating, and its `ORDER BY time DESC LIMIT n` is a sorting-key prefix
   * that lets ClickHouse early-exit, so its scan is already bounded by the
   * LIMIT. Capping its threads would only slow a user-facing download. This
   * pins that decision so it is revisited deliberately rather than by
   * accident.
   */
  test("the row export is left unbounded", async () => {
    let captured: Statement | null = null;
    const original: unknown = LogDatabaseService.executeQuery;

    (
      LogDatabaseService as unknown as {
        executeQuery: (statement: Statement) => Promise<unknown>;
      }
    ).executeQuery = (statement: Statement): Promise<unknown> => {
      captured = statement;
      return Promise.resolve({
        json: () => {
          return Promise.resolve({ data: [] });
        },
      });
    };

    try {
      await LogAggregationService.getExportLogs({
        projectId: PROJECT_ID,
        startTime: START_TIME,
        endTime: END_TIME,
        limit: 100,
      });
    } finally {
      LogDatabaseService.executeQuery = original as never;
    }

    expect(captured).not.toBeNull();
    expect(captured!.query).not.toContain("max_block_size");
    /* It still carries the shared abort guard. */
    expect(captured!.query).toContain(
      `max_memory_usage = ${DEFAULT_MAX_MEMORY_USAGE_IN_BYTES}`,
    );
  });
});
