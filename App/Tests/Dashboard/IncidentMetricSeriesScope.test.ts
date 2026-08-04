import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";

/*
 * A metric monitor grouped by an attribute (host.name, pod, device) opens
 * ONE incident per breaching group, yet all of those incidents are stamped
 * with the SAME monitor-wide query configs. Three surfaces replay those
 * configs, and all three used to chart every group:
 *
 *   - the incident Root Cause page's "Metric at Incident Time" chart,
 *     which reads the query configs off the monitor step;
 *   - the incident overview's "Metrics" card, and
 *   - the alert overview's "Metrics" card, both of which read them off the
 *     stored telemetryQuery.
 *
 * The fix routes all three through MetricSeriesScope using the affected
 * series recorded on the incident/alert. None of that is reachable from a
 * unit test — the App suite runs in plain Node with no renderer — so the
 * wiring is pinned by reading the sources, the way
 * RecommendationPageWiring.test.ts pins the recommendation pages. Sources
 * are whitespace-squashed first so a prettier re-wrap cannot turn a real
 * regression check into a red herring.
 *
 * The second half of the file exercises the actual data pipeline (stored
 * JSON -> deserialize -> narrow -> serialize for the aggregate request),
 * which needs no renderer and would catch the narrowing silently falling
 * off somewhere in the round trip.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

const ROOT_CAUSE_CHART: string = readSource(
  "Components",
  "Incident",
  "IncidentRootCauseMetricChart.tsx",
);

const INCIDENT_VIEW: string = readSource(
  "Pages",
  "Incidents",
  "View",
  "Index.tsx",
);

const ALERT_VIEW: string = readSource("Pages", "Alerts", "View", "Index.tsx");

const MONITOR_METRIC_PREVIEW: string = readSource(
  "Components",
  "Monitor",
  "MetricMonitor",
  "MetricMonitorPreview.tsx",
);

/*
 * Narrow a squashed source down to one getItem's `select` object so the
 * assertions below pin THAT a column is requested without pinning where
 * in the literal it sits — key order in a select is meaningless, and an
 * unrelated field landing between two of them must not fail the build.
 */
function selectBlockAfter(source: string, marker: string): string {
  const afterMarker: string | undefined = source.split(marker)[1];
  return (afterMarker || "").split("});")[0] || "";
}

describe("incident Root Cause metric chart is scoped to the incident's series", () => {
  test("imports MetricSeriesScope", () => {
    expect(ROOT_CAUSE_CHART).toContain(
      'import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";',
    );
  });

  test("asks the API for the incident's series labels", () => {
    /*
     * ModelAPI only returns selected columns, so a dropped select here
     * makes seriesLabels undefined and silently un-scopes the chart —
     * exactly the bug, with no error anywhere.
     */
    expect(
      selectBlockAfter(ROOT_CAUSE_CHART, "modelType: Incident, id:"),
    ).toContain("seriesLabels: true,");
  });

  test("narrows the monitor step's query configs before charting them", () => {
    /*
     * The assignment is the load-bearing part: calling the util and
     * dropping its result restores the bug in full while still
     * mentioning the util.
     */
    expect(ROOT_CAUSE_CHART).toContain(
      "queryConfigs = MetricSeriesScope.scopeQueryConfigsToSeries({",
    );
  });

  test("describes only the narrowing it actually applied", () => {
    /*
     * getAppliedSeriesLabelSummary — not a summary of the raw labels,
     * which would have the card vouch for an unscoped chart whenever the
     * labels don't intersect the queries' group-bys.
     */
    expect(ROOT_CAUSE_CHART).toContain(
      "MetricSeriesScope.getAppliedSeriesLabelSummary({",
    );
    expect(ROOT_CAUSE_CHART).toContain("scoped to the affected series");
  });
});

describe("incident overview Metrics card is scoped to the incident's series", () => {
  test("imports MetricSeriesScope", () => {
    expect(INCIDENT_VIEW).toContain(
      'import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";',
    );
  });

  test("asks the API for the incident's series labels", () => {
    expect(
      selectBlockAfter(INCIDENT_VIEW, "modelType: Incident, select: {"),
    ).toContain("seriesLabels: true,");
  });

  test("narrows the stored telemetryQuery before handing it to MetricView", () => {
    expect(INCIDENT_VIEW).toContain(
      "telemetryQuery = { ...telemetryQuery, metricViewData: MetricSeriesScope.scopeMetricViewDataToSeries({",
    );
  });

  test("describes only the narrowing it actually applied", () => {
    expect(INCIDENT_VIEW).toContain(
      "MetricSeriesScope.getAppliedSeriesLabelSummary({",
    );
    expect(INCIDENT_VIEW).toContain("scoped to the affected series");
  });
});

describe("alert overview Metrics card is scoped to the alert's series", () => {
  test("imports MetricSeriesScope", () => {
    expect(ALERT_VIEW).toContain(
      'import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";',
    );
  });

  test("asks the API for the alert's series labels", () => {
    expect(
      selectBlockAfter(ALERT_VIEW, "modelType: Alert, select: {"),
    ).toContain("seriesLabels: true,");
  });

  test("narrows the stored telemetryQuery before handing it to MetricView", () => {
    expect(ALERT_VIEW).toContain(
      "telemetryQuery = { ...telemetryQuery, metricViewData: MetricSeriesScope.scopeMetricViewDataToSeries({",
    );
  });

  test("describes only the narrowing it actually applied", () => {
    expect(ALERT_VIEW).toContain(
      "MetricSeriesScope.getAppliedSeriesLabelSummary({",
    );
    expect(ALERT_VIEW).toContain("scoped to the affected series");
  });
});

describe("the monitor-level metrics preview stays unscoped", () => {
  test("does not narrow to any single series", () => {
    /*
     * This one previews the monitor's own criteria, not one incident —
     * showing every group is the entire point of it. Scoping it would
     * hide the very series a user is checking their criteria against.
     */
    expect(MONITOR_METRIC_PREVIEW).not.toContain("MetricSeriesScope");
    expect(MONITOR_METRIC_PREVIEW).not.toContain("seriesLabels");
  });
});

/*
 * The pipeline the incident/alert overview pages actually run: the
 * telemetryQuery is stored as JSON on the row, deserialized on load,
 * narrowed, and then the query's attributes are serialized again into the
 * aggregate request. Operator instances (IsNull, used for an unset label)
 * are the fragile part of that round trip.
 */
describe("the narrowing survives the stored-JSON round trip", () => {
  function buildStoredTelemetryQuery(input: {
    groupByAttributeKeys: Array<string>;
  }): JSONObject {
    const metricViewData: JSONObject = {
      startAndEndDate: {
        _type: "InBetween",
        value: {
          startValue: "2024-05-01T10:00:00.000Z",
          endValue: "2024-05-01T11:00:00.000Z",
        },
      },
      queryConfigs: [
        {
          id: "query-1",
          metricAliasData: {
            metricVariable: "a",
            title: "",
            description: "",
            legend: "",
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: "system.cpu.utilization",
              aggegationType: "Avg",
            },
            groupByAttributeKeys: input.groupByAttributeKeys,
          },
        },
      ],
      formulaConfigs: [],
    };

    return {
      telemetryType: "Metric",
      telemetryQuery: null,
      metricViewData: metricViewData,
    };
  }

  function getAttributes(
    queryConfig: MetricQueryConfigData | undefined,
  ): Dictionary<unknown> {
    return (
      queryConfig?.metricQueryData?.filterData as
        | Dictionary<unknown>
        | undefined
    )?.["attributes"] as Dictionary<unknown> | undefined as Dictionary<unknown>;
  }

  test("a deserialized telemetryQuery narrows to the incident's host", () => {
    const stored: JSONObject = buildStoredTelemetryQuery({
      groupByAttributeKeys: ["resource.host.name"],
    });

    const deserialized: JSONObject = JSONFunctions.deserialize(stored);

    const metricViewData: MetricViewData = deserialized[
      "metricViewData"
    ] as unknown as MetricViewData;

    // Five hosts breached, five incidents, one shared query config.
    expect(metricViewData.queryConfigs).toHaveLength(1);
    expect(getAttributes(metricViewData.queryConfigs[0])).toBeUndefined();

    const scoped: MetricViewData | null | undefined =
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData: metricViewData,
        seriesLabels: { "resource.host.name": "prod-01" },
      });

    expect(getAttributes(scoped?.queryConfigs[0])).toEqual({
      "resource.host.name": "prod-01",
    });
    // The window the monitor evaluated over must come through untouched.
    expect(scoped?.startAndEndDate).toBe(metricViewData.startAndEndDate);
  });

  test("an unset label round-trips through serialize/deserialize as IsNull", () => {
    /*
     * The aggregate request re-serializes the query, and the API
     * rehydrates it. A plain "" would be dropped by the chart's filter
     * sanitizer on the way out and quietly un-scope the chart, so the
     * operator instance has to survive intact.
     */
    const stored: JSONObject = buildStoredTelemetryQuery({
      groupByAttributeKeys: ["disk.device"],
    });

    const metricViewData: MetricViewData = JSONFunctions.deserialize(stored)[
      "metricViewData"
    ] as unknown as MetricViewData;

    const scoped: MetricViewData | null | undefined =
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData: metricViewData,
        seriesLabels: { "disk.device": "" },
      });

    const attributes: Dictionary<unknown> = getAttributes(
      scoped?.queryConfigs[0],
    );

    expect(attributes["disk.device"]).toBeInstanceOf(IsNull);

    const serialized: JSONObject = JSONFunctions.serialize(
      attributes as JSONObject,
    );
    expect(serialized).toEqual({
      "disk.device": { _type: "IsNull", value: null },
    });

    const rehydrated: JSONObject = JSONFunctions.deserialize(serialized);
    expect(rehydrated["disk.device"]).toBeInstanceOf(IsNull);
  });

  test("a whole-monitor incident (no series labels) charts everything, unchanged", () => {
    const stored: JSONObject = buildStoredTelemetryQuery({
      groupByAttributeKeys: [],
    });

    const metricViewData: MetricViewData = JSONFunctions.deserialize(stored)[
      "metricViewData"
    ] as unknown as MetricViewData;

    expect(
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData: metricViewData,
        seriesLabels: undefined,
      }),
    ).toBe(metricViewData);

    // ...and the card says nothing about being scoped.
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: metricViewData.queryConfigs,
        seriesLabels: undefined,
      }),
    ).toBe("");
  });

  test("an incoming-request incident's labels never scope a metric query", () => {
    /*
     * Incoming-request monitors also write seriesLabels, keyed by a JSON
     * payload field ("alertname", "instance"). Those are not metric
     * attributes, and their names can collide with real ones — the
     * per-query group-by intersection is what stops them from inventing a
     * filter and charting an empty panel.
     */
    const stored: JSONObject = buildStoredTelemetryQuery({
      groupByAttributeKeys: ["resource.host.name"],
    });

    const metricViewData: MetricViewData = JSONFunctions.deserialize(stored)[
      "metricViewData"
    ] as unknown as MetricViewData;

    expect(
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData: metricViewData,
        seriesLabels: { alertname: "HighCPU" },
      }),
    ).toBe(metricViewData);

    /*
     * And — the half that matters for trust — the card must not announce
     * "scoped to the affected series (alertname = HighCPU)" over a chart
     * that still shows every host.
     */
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: metricViewData.queryConfigs,
        seriesLabels: { alertname: "HighCPU" },
      }),
    ).toBe("");
  });

  test("a label with no filterable form narrows nothing and claims nothing", () => {
    /*
     * SeriesResourceLabels reads array-valued labels off the same object,
     * so a multi-valued group-by attribute is reachable here. An array has
     * no faithful attribute-equality form, so the chart stays unscoped —
     * and the subtitle has to stay silent about it.
     */
    const stored: JSONObject = buildStoredTelemetryQuery({
      groupByAttributeKeys: ["tags"],
    });

    const metricViewData: MetricViewData = JSONFunctions.deserialize(stored)[
      "metricViewData"
    ] as unknown as MetricViewData;

    const seriesLabels: JSONObject = {
      tags: ["a", "b"],
    } as unknown as JSONObject;

    expect(
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData: metricViewData,
        seriesLabels: seriesLabels,
      }),
    ).toBe(metricViewData);

    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: metricViewData.queryConfigs,
        seriesLabels: seriesLabels,
      }),
    ).toBe("");
  });
});
