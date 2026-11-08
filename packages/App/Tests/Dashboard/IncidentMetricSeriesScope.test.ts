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
import InBetween from "Common/Types/BaseDatabase/InBetween";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";

/*
 * A metric monitor grouped by an attribute (host.name, pod, device) opens
 * ONE incident per breaching group, yet all of those incidents are stamped
 * with the SAME monitor-wide query configs. These surfaces replay those
 * configs, and all of them used to chart every group:
 *
 *   - the incident's and the alert's Root Cause pages' metrics card
 *     (issues #6249 and #6304), which charts the event's stored snapshot
 *     as the Overview does, or, for an event that kept none, reads the
 *     query configs off the monitor step (EventRootCauseMetrics);
 *   - the incident overview's "Metrics" card, and
 *   - the alert overview's "Metrics" card, both of which read them off the
 *     stored telemetryQuery.
 *
 * The fix routes all of them through MetricSeriesScope using the affected
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

// The Root Cause card both pages show, and how each reads its event.
const ROOT_CAUSE_CHART: string = readSource(
  "Components",
  "Telemetry",
  "EventRootCauseMetricChart.tsx",
);

const INCIDENT_ROOT_CAUSE_READER: string = readSource(
  "Components",
  "Incident",
  "IncidentRootCauseMetricChart.tsx",
);

const ALERT_ROOT_CAUSE_READER: string = readSource(
  "Components",
  "Alert",
  "AlertRootCauseMetricChart.tsx",
);

// What the Root Cause card charts, worked out apart from it.
const ROOT_CAUSE_METRICS: string = readSource(
  "Utils",
  "EventRootCauseMetrics.ts",
);

const INCIDENT_VIEW: string = readSource(
  "Pages",
  "Incidents",
  "View",
  "Index.tsx",
);

const ALERT_VIEW: string = readSource("Pages", "Alerts", "View", "Index.tsx");

/*
 * The card of a metric snapshot (issue #5954): the pages hand it the
 * narrowing they worked out, and it says it.
 */
const METRIC_INVESTIGATION_PANEL: string = readSource(
  "Components",
  "Telemetry",
  "EventMetricInvestigationPanel.tsx",
);

/*
 * The words that card says what it shows in, for each kind of page: an
 * incident's, an alert's and an episode's (issue #6320).
 */
const METRIC_INVESTIGATION_WORDS: string = readSource(
  "Utils",
  "EventMetricInvestigation.ts",
);

// The card says the narrowing it was handed, in its subject's words.
const PANEL_SAYS_THE_NARROWING: string =
  "const description: string = props.seriesSummary ? translator.translateTemplate(words.scopedDescription, { seriesSummary: props.seriesSummary, })";

const SCOPED_DESCRIPTIONS: Array<string> = [
  'scopedDescription: translationKey( "Metrics related to this incident, scoped to the affected series ({{seriesSummary}}).", ),',
  'scopedDescription: translationKey( "Metrics for this alert, scoped to the affected series ({{seriesSummary}}).", ),',
  `scopedDescription: translationKey( "Metrics related to this episode's first incident, scoped to the affected series ({{seriesSummary}}).", ),`,
  `scopedDescription: translationKey( "Metrics for this episode's first alert, scoped to the affected series ({{seriesSummary}}).", ),`,
];

function expectThePanelSaysTheNarrowing(): void {
  expect(METRIC_INVESTIGATION_PANEL).toContain(PANEL_SAYS_THE_NARROWING);

  for (const scoped of SCOPED_DESCRIPTIONS) {
    expect({
      scoped,
      worded: METRIC_INVESTIGATION_WORDS.includes(scoped),
    }).toEqual({ scoped, worded: true });
  }
}

/*
 * A monitor's own metrics card (issue #5759), and what it charts: the
 * monitor's queries as it reads them.
 */
const MONITOR_METRICS_CARD: string = readSource(
  "Components",
  "Monitor",
  "MetricMonitor",
  "MonitorMetricsCard.tsx",
);

const MONITOR_METRIC_INVESTIGATION: string = readSource(
  "Utils",
  "MonitorMetricInvestigation.ts",
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
    expect(ROOT_CAUSE_METRICS).toContain(
      'import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";',
    );
  });

  test("hands what the incident keeps to what it charts: its snapshot, series and monitors", () => {
    // The incident's row, read into the event the card charts...
    expect(INCIDENT_ROOT_CAUSE_READER).toContain(
      "return incident ? getIncidentRootCauseEvent(incident) : null;",
    );
    const handed: string = selectBlockAfter(
      ROOT_CAUSE_METRICS,
      "return readEvent({ startedAt: incident.declaredAt,",
    );

    expect(handed).toContain("telemetryQuery: incident.telemetryQuery,");
    expect(handed).toContain("seriesLabels: incident.seriesLabels,");
    expect(handed).toContain("createdCriteriaId: incident.createdCriteriaId,");
    // ...keeping its labels and snapshot, and charted whole.
    expect(ROOT_CAUSE_METRICS).toContain(
      "seriesLabels: isJSONObject(row.seriesLabels) ? row.seriesLabels : null,",
    );
    expect(ROOT_CAUSE_METRICS).toContain(
      "telemetryQuery: readSnapshot(row.telemetryQuery),",
    );
    expect(ROOT_CAUSE_CHART).toContain("? getRootCauseMetrics(event)");
    expect(
      selectBlockAfter(INCIDENT_ROOT_CAUSE_READER, "modelType: Incident, id:"),
    ).toContain("telemetryQuery: true,");
  });

  test("asks the API for the incident's series labels", () => {
    /*
     * ModelAPI only returns selected columns, so a dropped select here
     * makes seriesLabels undefined and silently un-scopes the chart —
     * exactly the bug, with no error anywhere.
     */
    expect(
      selectBlockAfter(INCIDENT_ROOT_CAUSE_READER, "modelType: Incident, id:"),
    ).toContain("seriesLabels: true,");
  });

  test("reads the monitor's step as the monitor reads it: for the services it is limited to (issue #6266)", () => {
    // The monitor's metric steps, each read as its monitor reads it.
    expect(ROOT_CAUSE_METRICS).toContain("getMonitorMetricSteps({");
    expect(MONITOR_METRIC_INVESTIGATION).toContain(
      "MonitorStepMetricQueries.getReads({",
    );
    expect(ROOT_CAUSE_METRICS).toContain(
      "const queryConfigs: Array<MetricQueryConfigData> = chosen.metricStep.reads.queryConfigs;",
    );
  });

  test("narrows what it charts before charting it: the snapshot, or the monitor step's query configs", () => {
    /*
     * The assignment is the load-bearing part: calling the util and
     * dropping its result restores the bug in full while still
     * mentioning the util.
     */
    expect(ROOT_CAUSE_METRICS).toContain(
      "metricViewData: MetricSeriesScope.scopeMetricViewDataToSeries({ metricViewData: snapshotView, seriesLabels: input.seriesLabels, }) || snapshotView,",
    );
    expect(ROOT_CAUSE_METRICS).toContain(
      "queryConfigs: MetricSeriesScope.scopeQueryConfigsToSeries({ queryConfigs: queryConfigs, seriesLabels: input.seriesLabels, }),",
    );
  });

  test("describes only the narrowing it actually applied", () => {
    /*
     * getAppliedSeriesLabelSummary — not a summary of the raw labels,
     * which would have the card vouch for an unscoped chart whenever the
     * labels don't intersect the queries' group-bys.
     */
    expect(
      ROOT_CAUSE_METRICS.split(
        "seriesSummary: MetricSeriesScope.getAppliedSeriesLabelSummary({",
      ).length - 1,
    ).toBe(2);
    // The card says it, as the Overview's does.
    expect(ROOT_CAUSE_CHART).toContain(
      "seriesSummary={card.metrics.seriesSummary}",
    );
    expectThePanelSaysTheNarrowing();
  });
});

/*
 * An alert's Root Cause page shows the same card (issue #6304), reading the
 * alert: a grouped metric monitor's alerts are each about one series too.
 */
describe("alert Root Cause metric chart is scoped to the alert's series", () => {
  test("asks the API for what the alert keeps: its snapshot, series and criteria, and its monitor's steps", () => {
    const select: string = selectBlockAfter(
      ALERT_ROOT_CAUSE_READER,
      "modelType: Alert, id:",
    );

    for (const column of [
      "telemetryQuery: true,",
      "seriesLabels: true,",
      "createdCriteriaId: true,",
      "monitor: { _id: true, monitorType: true, monitorSteps: true, },",
    ]) {
      expect({ column, selected: select.includes(column) }).toEqual({
        column,
        selected: true,
      });
    }
  });

  test("hands what the alert keeps to what it charts, its one monitor as a list of one", () => {
    expect(ALERT_ROOT_CAUSE_READER).toContain(
      "return alert ? getAlertRootCauseEvent(alert) : null;",
    );
    const handed: string = selectBlockAfter(
      ROOT_CAUSE_METRICS,
      "return readEvent({ startedAt: alert.createdAt,",
    );

    expect(handed).toContain("telemetryQuery: alert.telemetryQuery,");
    expect(handed).toContain("seriesLabels: alert.seriesLabels,");
    expect(handed).toContain("createdCriteriaId: alert.createdCriteriaId,");
    expect(handed).toContain("monitors: alert.monitor ? [alert.monitor] : [],");
  });

  test("is the incident's card, so it narrows and says it as that one does", () => {
    for (const reader of [
      INCIDENT_ROOT_CAUSE_READER,
      ALERT_ROOT_CAUSE_READER,
    ]) {
      expect(reader).toContain("<EventRootCauseMetricChart");
      // No chart and no narrowing of its own: the card's.
      expect(reader).not.toContain("MetricSeriesScope");
      expect(reader).not.toContain("<EventMetricInvestigationPanel");
    }
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
    /*
     * The metric investigation's card says it, from the summary the page
     * worked out: never from the raw labels.
     */
    expect(INCIDENT_VIEW).toContain("seriesSummary={seriesSummary}");
    expectThePanelSaysTheNarrowing();
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
    /*
     * The metric investigation's card says it, from the summary the page
     * worked out: never from the raw labels.
     */
    expect(ALERT_VIEW).toContain("seriesSummary={seriesSummary}");
    expectThePanelSaysTheNarrowing();
  });
});

describe("the monitor's own metrics stay unscoped", () => {
  test("does not narrow to any single series", () => {
    /*
     * This one charts the monitor's own criteria, not one incident —
     * showing every group is the entire point of it. Scoping it would
     * hide the very series a user is checking their criteria against.
     */
    for (const source of [MONITOR_METRICS_CARD, MONITOR_METRIC_INVESTIGATION]) {
      expect(source).not.toContain("MetricSeriesScope");
      expect(source).not.toContain("seriesLabels");
    }
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
  const WINDOW_START: Date = new Date("2024-05-01T10:00:00.000Z");
  const WINDOW_END: Date = new Date("2024-05-01T11:00:00.000Z");

  function buildStoredTelemetryQuery(input: {
    groupByAttributeKeys: Array<string>;
  }): JSONObject {
    const metricViewData: JSONObject = {
      /*
       * Built from a real InBetween and pushed through the worker's own
       * serializer rather than hand-written. A previous hand-written fixture
       * nested the bounds under `value:`, but InBetween.toJSON emits them
       * FLAT — so it deserialized to `new InBetween(undefined, undefined)` and
       * every assertion about the window below passed against an empty object.
       */
      startAndEndDate: JSONFunctions.anyObjectToJSONObject(
        new InBetween<Date>(WINDOW_START, WINDOW_END),
      ),
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

    /*
     * The window the monitor evaluated over must come through untouched --
     * asserted by VALUE, not just by reference. A reference check alone passes
     * even when both sides are an empty InBetween, which is how this stopped
     * checking anything.
     */
    expect(scoped?.startAndEndDate).toBe(metricViewData.startAndEndDate);
    expect(scoped?.startAndEndDate?.startValue).toBeDefined();
    expect(new Date(scoped!.startAndEndDate!.startValue).getTime()).toBe(
      WINDOW_START.getTime(),
    );
    expect(new Date(scoped!.startAndEndDate!.endValue).getTime()).toBe(
      WINDOW_END.getTime(),
    );
  });

  test("the restored window has string bounds until it is hydrated", () => {
    /*
     * Pins the trap that made the incident metric card silently lose bucket
     * alignment and exemplar dots: the stored window comes back as a real
     * InBetween whose bounds are ISO strings, so every downstream
     * `instanceof Date` guard quietly did nothing. The pages now run
     * TelemetryQueryTimeRange.hydrate to undo it.
     */
    const deserialized: JSONObject = JSONFunctions.deserialize(
      buildStoredTelemetryQuery({ groupByAttributeKeys: [] }),
    );

    const restored: MetricViewData = deserialized[
      "metricViewData"
    ] as unknown as MetricViewData;

    expect(restored.startAndEndDate).toBeInstanceOf(InBetween);
    expect(restored.startAndEndDate!.startValue).not.toBeInstanceOf(Date);

    const hydrated: TelemetryQuery | null = TelemetryQueryTimeRange.hydrate({
      telemetryType: TelemetryType.Metric,
      telemetryQuery: null,
      metricViewData: restored,
    });

    expect(
      hydrated!.metricViewData!.startAndEndDate!.startValue,
    ).toBeInstanceOf(Date);
    expect(
      hydrated!.metricViewData!.startAndEndDate!.startValue.getTime(),
    ).toBe(WINDOW_START.getTime());
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
