import {
  buildAbsentHostSeries,
  getHostAbsenceGroupByKey,
  monitorStepOptsIntoNoDataDetection,
  queriesScopeHostSubset,
} from "../../../../Server/Utils/Monitor/HostAbsenceSeries";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../Types/Metrics/MetricQueryData";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";

const HOST_KEY: string = "resource.host.name";

function presentSeries(
  hostKey: string,
  hostNames: Array<string>,
): Array<MetricSeriesResult> {
  return hostNames.map((name: string) => {
    return {
      fingerprint: MetricSeriesFingerprint.computeFingerprint({
        [hostKey]: name,
      }),
      labels: { [hostKey]: name },
      // present series carry samples; buildAbsentHostSeries only reads labels.
      aggregatedResults: [],
    };
  });
}

function metricFilter(
  policy: NoDataPolicy | undefined,
  checkOn: CheckOn = CheckOn.MetricValue,
): CriteriaFilter {
  const filter: CriteriaFilter = {
    checkOn,
    filterType: FilterType.EqualTo,
    value: "0",
  };
  if (policy) {
    filter.metricMonitorOptions = {
      metricAlias: "h0",
      onNoDataPolicy: policy,
    };
  }
  return filter;
}

function stepWithFilters(filters: Array<CriteriaFilter>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: "step-1",
    monitorCriteria: {
      data: {
        monitorCriteriaInstanceArray: [{ data: { filters } }],
      },
    },
  } as unknown as MonitorStep["data"];
  return step;
}

function queryWithAttributes(
  attributes: Record<string, string> | undefined,
): MetricQueryConfigData {
  return {
    metricQueryData: {
      filterData: {
        metricName: "oneuptime.host.heartbeat",
        ...(attributes ? { attributes } : {}),
      },
    } as unknown as MetricQueryData,
  } as MetricQueryConfigData;
}

describe("HostAbsenceSeries.getHostAbsenceGroupByKey", () => {
  test("returns the host key for a single resource.host.name group-by", () => {
    expect(getHostAbsenceGroupByKey(["resource.host.name"])).toBe(
      "resource.host.name",
    );
  });

  test("accepts the bare host.name key", () => {
    expect(getHostAbsenceGroupByKey(["host.name"])).toBe("host.name");
  });

  test("returns null for a multi-dimensional group-by", () => {
    expect(
      getHostAbsenceGroupByKey(["resource.host.name", "device"]),
    ).toBeNull();
  });

  test("returns null for an empty group-by", () => {
    expect(getHostAbsenceGroupByKey([])).toBeNull();
  });

  test("returns null for a non-host group-by", () => {
    expect(getHostAbsenceGroupByKey(["resource.k8s.pod.name"])).toBeNull();
  });
});

describe("HostAbsenceSeries.monitorStepOptsIntoNoDataDetection", () => {
  test("true when a metric-value filter uses NoDataPolicy.Trigger", () => {
    const step: MonitorStep = stepWithFilters([
      metricFilter(NoDataPolicy.Trigger),
    ]);
    expect(monitorStepOptsIntoNoDataDetection(step)).toBe(true);
  });

  test("true when a metric-value filter uses NoDataPolicy.TreatAsZero", () => {
    const step: MonitorStep = stepWithFilters([
      metricFilter(NoDataPolicy.TreatAsZero),
    ]);
    expect(monitorStepOptsIntoNoDataDetection(step)).toBe(true);
  });

  test("false for NoDataPolicy.Ignore", () => {
    const step: MonitorStep = stepWithFilters([
      metricFilter(NoDataPolicy.Ignore),
    ]);
    expect(monitorStepOptsIntoNoDataDetection(step)).toBe(false);
  });

  test("false when no no-data policy is configured", () => {
    const step: MonitorStep = stepWithFilters([metricFilter(undefined)]);
    expect(monitorStepOptsIntoNoDataDetection(step)).toBe(false);
  });

  test("false when the Trigger filter is not a metric-value check", () => {
    const step: MonitorStep = stepWithFilters([
      metricFilter(NoDataPolicy.Trigger, CheckOn.ResponseTime),
    ]);
    expect(monitorStepOptsIntoNoDataDetection(step)).toBe(false);
  });

  test("false for a step with no criteria", () => {
    const step: MonitorStep = new MonitorStep();
    expect(monitorStepOptsIntoNoDataDetection(step)).toBe(false);
  });
});

describe("HostAbsenceSeries.queriesScopeHostSubset", () => {
  test("false when queries have no attribute filters", () => {
    expect(queriesScopeHostSubset([queryWithAttributes(undefined)])).toBe(
      false,
    );
  });

  test("false when attributes is an empty object", () => {
    expect(queriesScopeHostSubset([queryWithAttributes({})])).toBe(false);
  });

  test("true when any query scopes by an attribute", () => {
    expect(
      queriesScopeHostSubset([
        queryWithAttributes(undefined),
        queryWithAttributes({ "resource.deployment.environment": "prod" }),
      ]),
    ).toBe(true);
  });
});

describe("HostAbsenceSeries.buildAbsentHostSeries", () => {
  test("chsdc08 down while peers report → one correctly-labeled no-data series", () => {
    const present: Array<MetricSeriesResult> = presentSeries(HOST_KEY, [
      "pmtrs2app01",
      "pmtrs2rds03",
    ]);

    const absent: Array<MetricSeriesResult> = buildAbsentHostSeries({
      presentSeries: present,
      expectedHostIdentifiers: ["pmtrs2app01", "pmtrs2rds03", "chsdc08"],
      hostKey: HOST_KEY,
      slotCount: 1,
    });

    expect(absent).toHaveLength(1);
    expect(absent[0]!.labels).toEqual({ [HOST_KEY]: "chsdc08" });
    expect(absent[0]!.aggregatedResults).toHaveLength(1);
    expect(absent[0]!.aggregatedResults[0]!.data).toEqual([]);
  });

  test("absent-series fingerprint matches the host's present-series fingerprint (dedupe/resolution align)", () => {
    const absent: Array<MetricSeriesResult> = buildAbsentHostSeries({
      presentSeries: [],
      expectedHostIdentifiers: ["chsdc08"],
      hostKey: HOST_KEY,
      slotCount: 1,
    });

    const presentFingerprint: string =
      MetricSeriesFingerprint.computeFingerprint({ [HOST_KEY]: "chsdc08" });

    expect(absent[0]!.fingerprint).toBe(presentFingerprint);
  });

  test("host identity is matched case-insensitively (no false down alert)", () => {
    const absent: Array<MetricSeriesResult> = buildAbsentHostSeries({
      presentSeries: presentSeries(HOST_KEY, ["CHSDC08"]),
      expectedHostIdentifiers: ["chsdc08"],
      hostKey: HOST_KEY,
      slotCount: 1,
    });

    expect(absent).toHaveLength(0);
  });

  test("duplicate expected identifiers yield a single series", () => {
    const absent: Array<MetricSeriesResult> = buildAbsentHostSeries({
      presentSeries: [],
      expectedHostIdentifiers: ["chsdc08", "chsdc08", "CHSDC08"],
      hostKey: HOST_KEY,
      slotCount: 1,
    });

    expect(absent).toHaveLength(1);
  });

  test("one empty slot per query + formula", () => {
    const absent: Array<MetricSeriesResult> = buildAbsentHostSeries({
      presentSeries: [],
      expectedHostIdentifiers: ["chsdc08"],
      hostKey: HOST_KEY,
      slotCount: 3,
    });

    expect(absent[0]!.aggregatedResults).toHaveLength(3);
    for (const slot of absent[0]!.aggregatedResults) {
      expect(slot.data).toEqual([]);
    }
  });

  test("no absent series when every expected host is present", () => {
    const absent: Array<MetricSeriesResult> = buildAbsentHostSeries({
      presentSeries: presentSeries(HOST_KEY, ["a", "b"]),
      expectedHostIdentifiers: ["a", "b"],
      hostKey: HOST_KEY,
      slotCount: 1,
    });

    expect(absent).toHaveLength(0);
  });

  test("blank expected identifiers are ignored", () => {
    const absent: Array<MetricSeriesResult> = buildAbsentHostSeries({
      presentSeries: [],
      expectedHostIdentifiers: ["", "   ", "chsdc08"],
      hostKey: HOST_KEY,
      slotCount: 1,
    });

    expect(absent).toHaveLength(1);
    expect(absent[0]!.labels).toEqual({ [HOST_KEY]: "chsdc08" });
  });
});
