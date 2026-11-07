import { describe, expect, test } from "@jest/globals";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType, { MonitorTypeHelper } from "Common/Types/Monitor/MonitorType";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  MonitorMetricThreshold,
  MonitorMetricThresholdOutcome,
  MonitorMetricThresholdSide,
} from "Common/Utils/Monitor/MonitorStepMetricThresholds";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import {
  MONITOR_METRIC_INVESTIGATION_URL_PREFIX,
  MONITOR_THRESHOLD_COLORS,
  MonitorMetricStep,
  MonitorStatusChange,
  getMonitorMetricDefaultRange,
  getMonitorMetricEmptyHint,
  getMonitorMetricSteps,
  getMonitorMetricUrlParamPrefix,
  getMonitorResourceName,
  getMonitorStatusChanges,
  hasMonitorMetrics,
  readMonitorMetricStepPosition,
  toMetricInvestigationThresholds,
} from "../../FeatureSet/Dashboard/src/Utils/MonitorMetricInvestigation";

/*
 * What a metric monitor's own page charts (issue #5759): which steps, over
 * which range by default, its thresholds as lines, its status changes as
 * marks, and what to check when nothing came back.
 */

const stepOf: (
  stepKey: string,
  settings: JSONObject,
  metricName?: string,
) => MonitorStep = (
  stepKey: string,
  settings: JSONObject,
  metricName?: string,
): MonitorStep => {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: `step-${metricName || "none"}`,
    [stepKey]: {
      ...settings,
      metricViewConfig: {
        queryConfigs: [
          {
            metricAliasData: { metricVariable: "a" },
            metricQueryData: {
              filterData: metricName === undefined ? {} : { metricName },
            },
          },
        ],
        formulaConfigs: [],
      },
    },
  } as unknown as MonitorStep["data"];
  return step;
};

const stepsOf: (...steps: Array<MonitorStep>) => MonitorSteps = (
  ...steps: Array<MonitorStep>
): MonitorSteps => {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = { monitorStepsInstanceArray: steps };
  return monitorSteps;
};

describe("which monitors chart their metrics", () => {
  test("every metric-backed type, nothing else", () => {
    for (const monitorType of Object.values(MonitorType)) {
      expect({ monitorType, charts: hasMonitorMetrics(monitorType) }).toEqual({
        monitorType,
        charts: MonitorTypeHelper.isMetricBackedMonitor(monitorType),
      });
    }
    expect(hasMonitorMetrics(undefined)).toBe(false);
  });
});

describe("the steps there are to chart", () => {
  test("the steps with a metric picked, where they sit among the monitor's", () => {
    const steps: Array<MonitorMetricStep> = getMonitorMetricSteps({
      monitorType: MonitorType.Host,
      monitorSteps: stepsOf(
        stepOf("hostMonitor", { hostIdentifier: "web-01" }, "cpu"),
        stepOf("hostMonitor", {}, undefined),
        stepOf("hostMonitor", {}, "memory"),
      ),
    });

    expect(
      steps.map((step: MonitorMetricStep) => {
        return [
          step.index,
          String(
            step.reads.queryConfigs[0]!.metricQueryData.filterData.metricName,
          ),
        ];
      }),
    ).toEqual([
      [0, "cpu"],
      [2, "memory"],
    ]);

    // Read as the monitor reads them: narrowed to its host.
    expect(
      steps[0]!.reads.queryConfigs[0]!.metricQueryData.filterData.attributes,
    ).toEqual({ "resource.host.name": "web-01" });
  });

  test("none for a monitor that is not metric-backed, or has no steps", () => {
    expect(
      getMonitorMetricSteps({
        monitorType: MonitorType.Logs,
        monitorSteps: stepsOf(stepOf("logMonitor", {}, "x")),
      }),
    ).toEqual([]);
    expect(
      getMonitorMetricSteps({
        monitorType: MonitorType.Metrics,
        monitorSteps: undefined,
      }),
    ).toEqual([]);
    // Settings under another type's key are not this monitor's.
    expect(
      getMonitorMetricSteps({
        monitorType: MonitorType.Docker,
        monitorSteps: stepsOf(stepOf("hostMonitor", {}, "cpu")),
      }),
    ).toEqual([]);
  });
});

describe("the step a link picked", () => {
  test.each([
    ["2", 3, 1],
    ["1", 3, 0],
    ["3", 3, 2],
    [" 2 ", 3, 1],
    ["4", 3, 0],
    ["0", 3, 0],
    ["-1", 3, 0],
    ["1.5", 3, 0],
    ["two", 3, 0],
    ["", 3, 0],
    [null, 3, 0],
    [undefined, 3, 0],
    ["1", 0, 0],
  ])(
    "%p of %p steps is position %p",
    (value: string | null | undefined, count: number, position: number) => {
      expect(readMonitorMetricStepPosition(value, count)).toBe(position);
    },
  );

  test("each step keeps what the reader changed under names of its own", () => {
    expect(getMonitorMetricUrlParamPrefix(0)).toBe(
      MONITOR_METRIC_INVESTIGATION_URL_PREFIX,
    );
    expect(getMonitorMetricUrlParamPrefix(1)).toBe("metricsStep2");
    expect(getMonitorMetricUrlParamPrefix(4)).toBe("metricsStep5");
    expect(getMonitorMetricUrlParamPrefix(-1)).toBe("metrics");
  });
});

describe("the range the charts start from", () => {
  test.each([
    [RollingTime.Past1Minute, TimeRange.PAST_THREE_HOURS],
    [RollingTime.Past5Minutes, TimeRange.PAST_THREE_HOURS],
    [RollingTime.Past3Hours, TimeRange.PAST_THREE_HOURS],
    // No range of the picker draws five-minute points.
    [RollingTime.Past6Hours, TimeRange.PAST_ONE_DAY],
    [RollingTime.Past1Hours, TimeRange.PAST_ONE_DAY],
    [RollingTime.Past2Days, TimeRange.PAST_TWO_DAYS],
    [RollingTime.Past7Days, TimeRange.PAST_ONE_WEEK],
    [RollingTime.Past30Days, TimeRange.PAST_ONE_MONTH],
    [RollingTime.Past90Days, TimeRange.PAST_THREE_MONTHS],
  ])(
    "a check over %s starts on %s",
    (rollingTime: RollingTime, range: TimeRange) => {
      expect(getMonitorMetricDefaultRange({ rollingTime })).toBe(range);
    },
  );
});

describe("a monitor's thresholds as the charts draw them", () => {
  const threshold: (
    outcome: MonitorMetricThresholdOutcome,
    side: MonitorMetricThresholdSide | null,
  ) => MonitorMetricThreshold = (
    outcome: MonitorMetricThresholdOutcome,
    side: MonitorMetricThresholdSide | null,
  ): MonitorMetricThreshold => {
    return {
      criteriaId: "c",
      criteriaName: "High CPU",
      metricVariable: "a",
      value: 90,
      unit: "%",
      filterType: FilterType.GreaterThan,
      breachSide: side,
      isForecast: false,
      outcome,
      onlyAtInterval: AggregationInterval.Minute,
    };
  };

  test("named as the criteria, coloured by what crossing it does, shading where it matches", () => {
    expect(
      toMetricInvestigationThresholds([
        threshold(
          MonitorMetricThresholdOutcome.Incident,
          MonitorMetricThresholdSide.Above,
        ),
        threshold(MonitorMetricThresholdOutcome.Alert, null),
        threshold(
          MonitorMetricThresholdOutcome.StatusChange,
          MonitorMetricThresholdSide.Below,
        ),
      ]),
    ).toEqual([
      {
        metricVariable: "a",
        value: 90,
        unit: "%",
        name: "High CPU",
        filterType: FilterType.GreaterThan,
        isForecast: false,
        color: "#ef4444",
        shade: "above",
        onlyAtInterval: AggregationInterval.Minute,
      },
      expect.objectContaining({ color: "#f59e0b", shade: undefined }),
      expect.objectContaining({ color: "#f97316", shade: "below" }),
    ]);
  });

  test("every outcome has a colour", () => {
    for (const outcome of Object.values(MonitorMetricThresholdOutcome)) {
      expect(MONITOR_THRESHOLD_COLORS[outcome]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("the monitor's status changes on its charts", () => {
  const WINDOW: InBetween<Date> = new InBetween<Date>(
    new Date("2026-11-07T09:00:00.000Z"),
    new Date("2026-11-07T12:00:00.000Z"),
  );

  test("the ones inside the window, oldest first, with their status's name and colour", () => {
    const changes: Array<MonitorStatusChange> = getMonitorStatusChanges({
      rows: [
        {
          startsAt: new Date("2026-11-07T11:00:00.000Z"),
          monitorStatus: { name: " Operational ", color: "#16a34a" },
        },
        {
          startsAt: "2026-11-07T10:00:00.000Z" as unknown as Date,
          monitorStatus: {
            name: "Offline",
            color: {
              toString: () => {
                return "#dc2626";
              },
            },
          },
        },
        // Before the window: the status it was in when the charts begin.
        {
          startsAt: new Date("2026-11-07T08:00:00.000Z"),
          monitorStatus: { name: "Degraded", color: "#f59e0b" },
        },
        // A row with no time, or a status since deleted.
        { startsAt: undefined, monitorStatus: { name: "Lost" } },
        { startsAt: new Date("2026-11-07T11:30:00.000Z") },
      ],
      window: WINDOW,
    });

    expect(changes).toEqual([
      {
        date: new Date("2026-11-07T10:00:00.000Z"),
        statusName: "Offline",
        color: "#dc2626",
      },
      {
        date: new Date("2026-11-07T11:00:00.000Z"),
        statusName: "Operational",
        color: "#16a34a",
      },
      {
        date: new Date("2026-11-07T11:30:00.000Z"),
        statusName: "",
        color: "",
      },
    ]);
  });

  test("the window's own edges count; no window, no marks", () => {
    expect(
      getMonitorStatusChanges({
        rows: [
          { startsAt: WINDOW.startValue, monitorStatus: { name: "A" } },
          { startsAt: WINDOW.endValue, monitorStatus: { name: "B" } },
        ],
        window: WINDOW,
      }).map((change: MonitorStatusChange) => {
        return change.statusName;
      }),
    ).toEqual(["A", "B"]);
    expect(
      getMonitorStatusChanges({
        rows: [{ startsAt: WINDOW.startValue, monitorStatus: { name: "A" } }],
        window: null,
      }),
    ).toEqual([]);
  });
});

describe("what the empty charts say to check", () => {
  test("an infrastructure monitor names the resource it watches", () => {
    expect(
      getMonitorResourceName({
        clusterIdentifier: " pve ",
      } as never),
    ).toBe("pve");
    expect(
      getMonitorResourceName({ hostIdentifier: "web-01" } as never),
    ).toBe("web-01");
    expect(
      getMonitorResourceName({ fleetIdentifier: "warehouse" } as never),
    ).toBe("warehouse");
    expect(getMonitorResourceName({} as never)).toBe("");
    expect(getMonitorResourceName(null)).toBe("");

    expect(getMonitorMetricEmptyHint(MonitorType.Proxmox)).toEqual({
      arrival:
        "Check that the agent reporting on {{resource}} is running and sending metrics.",
      arrivalWithoutResource:
        "Check that the agent this monitor reads is running and sending metrics.",
      filters:
        "Check that this monitor's metrics and filters match what the agent sends.",
    });
  });

  test("a Metrics monitor asks whether the metrics are still sent", () => {
    expect(getMonitorMetricEmptyHint(MonitorType.Metrics).arrival).toBe(
      "Check that these metrics are still being sent to OneUptime.",
    );
  });

  test("every metric-backed type has something to say", () => {
    for (const monitorType of MonitorTypeHelper.getMetricBackedMonitorTypes()) {
      const hint: ReturnType<typeof getMonitorMetricEmptyHint> =
        getMonitorMetricEmptyHint(monitorType);
      expect(hint.arrival.length).toBeGreaterThan(0);
      expect(hint.filters.length).toBeGreaterThan(0);
    }
  });

  test("any name a step holds reads as itself, trimmed (seeded)", () => {
    for (const name of generatedTexts(500, 5759, ["a", " ", "-", "Z", "é"])) {
      expect(
        getMonitorResourceName({ clusterIdentifier: name } as never),
      ).toBe(name.trim());
    }
  });
});
