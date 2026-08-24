import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import { JSONObject } from "Common/Types/JSON";
import {
  DerivedTelemetrySnapshot,
  EMPTY_TELEMETRY_SNAPSHOT,
  deriveTelemetrySnapshot,
} from "../../FeatureSet/Dashboard/src/Utils/TelemetrySnapshot";

/*
 * The stored blob shape: what an Incident/Alert row's telemetryQuery
 * column actually holds after the JSON round trip — InBetween bounds as
 * ISO STRINGS, not Dates. The derivation must rebuild real Dates and
 * narrow grouped metric queries to the event's own series.
 */
function buildStoredMetricBlob(): JSONObject {
  return {
    telemetryType: TelemetryType.Metric,
    metricViewData: {
      queryConfigs: [
        {
          metricAliasData: { metricVariable: "a" },
          metricQueryData: {
            filterData: {
              metricName: "cpu.usage",
              attributes: {},
              aggegationType: MetricsAggregationType.Avg,
            },
            groupByAttributeKeys: ["host.name"],
          },
        },
      ],
      formulaConfigs: [],
      startAndEndDate: {
        _type: "InBetween",
        startValue: "2026-08-20T10:00:00.000Z",
        endValue: "2026-08-20T11:00:00.000Z",
      },
    },
  } as unknown as JSONObject;
}

function getScopedAttributes(
  snapshot: DerivedTelemetrySnapshot,
): Record<string, unknown> {
  return ((
    snapshot.telemetryQuery?.metricViewData?.queryConfigs[0]?.metricQueryData
      .filterData as Record<string, unknown>
  )?.["attributes"] || {}) as Record<string, unknown>;
}

describe("deriveTelemetrySnapshot", () => {
  test("no stored blob yields the empty snapshot", () => {
    expect(
      deriveTelemetrySnapshot({
        storedTelemetryQuery: undefined,
        seriesLabels: undefined,
      }),
    ).toBe(EMPTY_TELEMETRY_SNAPSHOT);
    expect(
      deriveTelemetrySnapshot({
        storedTelemetryQuery: null,
        seriesLabels: { "host.name": "x" },
      }),
    ).toBe(EMPTY_TELEMETRY_SNAPSHOT);
  });

  test("rehydrates the stored ISO window into real Dates", () => {
    const snapshot: DerivedTelemetrySnapshot = deriveTelemetrySnapshot({
      storedTelemetryQuery: buildStoredMetricBlob(),
      seriesLabels: undefined,
    });

    expect(snapshot.snapshotWindow?.startValue).toBeInstanceOf(Date);
    expect(snapshot.snapshotWindow?.startValue.toISOString()).toBe(
      "2026-08-20T10:00:00.000Z",
    );
    expect(snapshot.snapshotWindow?.endValue.toISOString()).toBe(
      "2026-08-20T11:00:00.000Z",
    );
  });

  test("narrows grouped metric queries to the event's own series", () => {
    const snapshot: DerivedTelemetrySnapshot = deriveTelemetrySnapshot({
      storedTelemetryQuery: buildStoredMetricBlob(),
      seriesLabels: { "host.name": "prod-01" },
    });

    expect(snapshot.seriesSummary).toBe("host.name = prod-01");
    expect(getScopedAttributes(snapshot)["host.name"]).toBe("prod-01");
  });

  test('an empty series label narrows with the is-empty operator and says "(unset)"', () => {
    const snapshot: DerivedTelemetrySnapshot = deriveTelemetrySnapshot({
      storedTelemetryQuery: buildStoredMetricBlob(),
      seriesLabels: { "host.name": "" },
    });

    expect(getScopedAttributes(snapshot)["host.name"]).toBeInstanceOf(IsNull);
    expect(snapshot.seriesSummary).toContain("(unset)");
  });

  test("labels the queries never grouped by narrow nothing and claim nothing", () => {
    const snapshot: DerivedTelemetrySnapshot = deriveTelemetrySnapshot({
      storedTelemetryQuery: buildStoredMetricBlob(),
      seriesLabels: { "pod.name": "api-1" },
    });

    expect(snapshot.seriesSummary).toBe("");
    expect(getScopedAttributes(snapshot)["pod.name"]).toBeUndefined();
  });

  test("non-metric blobs pass through with their own window semantics", () => {
    const snapshot: DerivedTelemetrySnapshot = deriveTelemetrySnapshot({
      storedTelemetryQuery: {
        telemetryType: TelemetryType.Log,
        telemetryQuery: {
          time: {
            _type: "InBetween",
            startValue: "2026-08-20T10:00:00.000Z",
            endValue: "2026-08-20T10:15:00.000Z",
          },
          severityText: "Error",
        },
      } as unknown as JSONObject,
      seriesLabels: undefined,
    });

    expect(snapshot.telemetryQuery?.telemetryType).toBe(TelemetryType.Log);
    expect(snapshot.seriesSummary).toBe("");
    expect(snapshot.snapshotWindow?.endValue.toISOString()).toBe(
      "2026-08-20T10:15:00.000Z",
    );
  });
});

describe("episode telemetry wiring", () => {
  function readSquashed(relative: string): string {
    return fs
      .readFileSync(
        path.join(__dirname, "../../FeatureSet/Dashboard/src", relative),
        "utf8",
      )
      .replace(/\s+/g, " ");
  }

  test("both episode pages fetch their first member's snapshot and mount the panel", () => {
    const incident: string = readSquashed(
      "Pages/Incidents/EpisodeView/Index.tsx",
    );
    expect(incident).toContain("incidentEpisodeId: modelId");
    expect(incident).toContain("telemetryQuery: true");
    expect(incident).toContain("seriesLabels: true");
    expect(incident).toContain("deriveTelemetrySnapshot");
    expect(incident).toContain("<TelemetrySnapshotPanel");
    expect(incident).toContain('eventNoun="incident"');
    // First member = earliest declared.
    expect(incident).toContain("declaredAt: SortOrder.Ascending");

    const alert: string = readSquashed("Pages/Alerts/EpisodeView/Index.tsx");
    expect(alert).toContain("alertEpisodeId: modelId");
    expect(alert).toContain("deriveTelemetrySnapshot");
    expect(alert).toContain("<TelemetrySnapshotPanel");
    expect(alert).toContain('eventNoun="alert"');
    // Alerts have no declaredAt — earliest created.
    expect(alert).toContain("createdAt: SortOrder.Ascending");
  });

  test("the shared panel renders all four primary-signal branches", () => {
    const panel: string = readSquashed(
      "Components/Telemetry/TelemetrySnapshotPanel.tsx",
    );
    expect(panel).toContain("TelemetryCompanionSignalTabs");
    expect(panel).toContain("TelemetryType.Log");
    expect(panel).toContain("TelemetryType.Trace");
    expect(panel).toContain("TelemetryType.Metric");
    expect(panel).toContain("TelemetryType.Exception");
    expect(panel).toContain("disableUrlState={true}");
  });
});
