import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep, {
  MonitorStepType,
} from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorStepRollingTime from "../../../Types/Monitor/MonitorStepRollingTime";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil from "../../../Types/Monitor/TelemetryAlertRule";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import MetricQueryCloudAggregation from "../../../Utils/Metrics/MetricQueryCloudAggregation";
import MonitorStepMetricQueries, {
  MonitorStepMetricReads,
} from "../../../Utils/Monitor/MonitorStepMetricQueries";
import TelemetryMonitorWindow from "../../../Utils/Monitor/TelemetryMonitorWindow";
import {
  MCP_WRITTEN_ROLLING_TIME,
  mcpWrittenMetricMonitorSteps,
} from "../../Helpers/McpWrittenMetricMonitor";
import { describe, expect, test } from "@jest/globals";

/*
 * A STEP'S ROLLING TIME WRITTEN ANOTHER WAY IS READ AS THE ONE IT MEANS,
 * BY EVERY READER; ONE THAT MEANS NONE IS REFUSED.
 *
 * A Metrics monitor created through the MCP server stored its rolling time
 * as "15 minutes". The worker read a window from now to now on every
 * check, found no data and opened its no-data alert; the overview charted
 * that window and showed nothing, while the edit form charted the metric.
 * Every metric-backed monitor type keeps a rolling time in its own step
 * settings, and none of them was read when written another way.
 */

const MINUTE: number = 60 * 1000;
const END: Date = new Date("2026-11-10T16:19:23.977Z");

const CRITERIA_JSON: JSONObject = {
  _type: "MonitorCriteria",
  value: {
    monitorCriteriaInstanceArray: [
      {
        _type: "MonitorCriteriaInstance",
        value: {
          id: "6c8cf9ad-16cf-4ae5-8443-8afc4d462277",
          name: "Too many errors",
          filterCondition: "Any",
          filters: [
            {
              checkOn: "Metric Value",
              filterType: "Greater Than",
              value: 0,
              metricMonitorOptions: { metricAlias: "a" },
            },
          ],
          incidents: [],
          alerts: [],
        },
      },
    ],
  },
};

const QUERY_CONFIGS: Array<JSONObject> = [
  {
    metricAliasData: { metricVariable: "a" },
    metricQueryData: { filterData: { metricName: "cpu_usage" } },
  },
];

// What each type's settings need, beside the rolling time, to be valid.
const IDENTIFIERS: Record<string, JSONObject> = {
  metricMonitor: {},
  kubernetesMonitor: { clusterIdentifier: "prod-cluster" },
  dockerMonitor: { hostIdentifier: "docker-host-1" },
  hostMonitor: { hostIdentifier: "web-1" },
  podmanMonitor: { hostIdentifier: "podman-host-1" },
  dockerSwarmMonitor: { clusterIdentifier: "swarm-1" },
  proxmoxMonitor: { clusterIdentifier: "pve-1" },
  openstackMonitor: { cloudIdentifier: "openstack-1" },
  vmwareMonitor: { vcenterIdentifier: "vcenter-1" },
  cephMonitor: { clusterIdentifier: "ceph-1" },
  storageArrayMonitor: { arrayIdentifier: "array-1" },
  iotMonitor: { fleetIdentifier: "fleet-1" },
};

const stepJSON: (data: {
  stepKey: string;
  rollingTime?: unknown;
}) => JSONObject = (data: {
  stepKey: string;
  rollingTime?: unknown;
}): JSONObject => {
  const settings: JSONObject = {
    ...(IDENTIFIERS[data.stepKey] || {}),
    metricViewConfig: { queryConfigs: QUERY_CONFIGS, formulaConfigs: [] },
  };

  if (data.rollingTime !== undefined) {
    settings["rollingTime"] = data.rollingTime as string;
  }

  return {
    _type: "MonitorStep",
    value: {
      id: "0b9b1f47-1e8e-4a8b-9f43-3d2b8f4c1a11",
      monitorCriteria: CRITERIA_JSON,
      [data.stepKey]: settings,
    },
  };
};

const settingsOf: (step: MonitorStep, stepKey: string) => JSONObject = (
  step: MonitorStep,
  stepKey: string,
): JSONObject => {
  return (step.data as unknown as Record<string, JSONObject>)[stepKey]!;
};

const STEP_KEYS: Array<string> = MonitorStepRollingTime.getStepKeys();

const TYPES_AND_KEYS: Array<[MonitorType, string]> =
  MonitorStepRollingTime.getMonitorTypes().map(
    (monitorType: MonitorType): [MonitorType, string] => {
      return [monitorType, MonitorStepRollingTime.getStepKey(monitorType)!];
    },
  );

describe("MonitorStepRollingTime's step keys", () => {
  test("are the twelve metric-backed types' settings", () => {
    expect(STEP_KEYS).toHaveLength(12);
    expect(new Set(STEP_KEYS).size).toBe(12);
  });

  /*
   * The keys the worker and the charts read each type's settings by
   * (MonitorStepMetricQueries): a type added there without its rolling
   * time here would be read neither way again.
   */
  test("are the keys MonitorStepMetricQueries reads every monitor type by", () => {
    for (const monitorType of Object.values(MonitorType)) {
      expect({
        monitorType,
        stepKey: MonitorStepRollingTime.getStepKey(monitorType),
      }).toEqual({
        monitorType,
        stepKey: MonitorStepMetricQueries.getStepKey(monitorType),
      });
    }

    expect([...MonitorStepRollingTime.getMonitorTypes()].sort()).toEqual(
      [...MonitorStepMetricQueries.getMonitorTypes()].sort(),
    );
  });

  test("name settings that keep a rolling time", () => {
    for (const stepKey of STEP_KEYS) {
      const step: MonitorStep = MonitorStep.fromJSON(
        stepJSON({ stepKey, rollingTime: RollingTime.Past5Minutes }),
      );

      expect({
        stepKey,
        rollingTime: settingsOf(step, stepKey)["rollingTime"],
      }).toEqual({ stepKey, rollingTime: RollingTime.Past5Minutes });
    }
  });
});

describe("MonitorStepRollingTime.readSettings", () => {
  test("reads a rolling time written another way as the one it means, keeping the rest", () => {
    const written: JSONObject = {
      clusterIdentifier: "prod-cluster",
      rollingTime: "15 minutes",
    };

    expect(MonitorStepRollingTime.readSettings(written)).toEqual({
      clusterIdentifier: "prod-cluster",
      rollingTime: RollingTime.Past15Minutes,
    });

    // The settings as written are not changed.
    expect(written["rollingTime"]).toBe("15 minutes");
  });

  test("hands back the same settings when there is nothing to read", () => {
    const canonical: JSONObject = { rollingTime: RollingTime.Past1Hour };
    const none: JSONObject = { clusterIdentifier: "prod-cluster" };
    const meaningNone: JSONObject = { rollingTime: "fortnight" };
    const nullRollingTime: JSONObject = { rollingTime: null };

    expect(MonitorStepRollingTime.readSettings(canonical)).toBe(canonical);
    expect(MonitorStepRollingTime.readSettings(none)).toBe(none);
    expect(MonitorStepRollingTime.readSettings(meaningNone)).toBe(meaningNone);
    expect(MonitorStepRollingTime.readSettings(nullRollingTime)).toBe(
      nullRollingTime,
    );
  });
});

describe("MonitorStep.fromJSON reads each type's rolling time", () => {
  test.each(STEP_KEYS)(
    "%s: written another way, as the one it means, and stores it so",
    (stepKey: string) => {
      const step: MonitorStep = MonitorStep.fromJSON(
        stepJSON({ stepKey, rollingTime: "15 minutes" }),
      );

      expect(settingsOf(step, stepKey)["rollingTime"]).toBe(
        RollingTime.Past15Minutes,
      );
      // Everything else in the settings is kept.
      for (const [key, value] of Object.entries(IDENTIFIERS[stepKey]!)) {
        expect(settingsOf(step, stepKey)[key]).toEqual(value);
      }

      const stored: JSONObject = (step.toJSON()["value"] as JSONObject)[
        stepKey
      ] as JSONObject;

      expect(stored["rollingTime"]).toBe(RollingTime.Past15Minutes);
    },
  );

  test.each(STEP_KEYS)(
    "%s: each rolling time, in other spellings, as itself",
    (stepKey: string) => {
      for (const rollingTime of Object.values(RollingTime)) {
        for (const spelling of [
          rollingTime,
          rollingTime.toLowerCase(),
          rollingTime.replace(/ /g, "_").toUpperCase(),
        ]) {
          const step: MonitorStep = MonitorStep.fromJSON(
            stepJSON({ stepKey, rollingTime: spelling }),
          );

          expect({
            spelling,
            read: settingsOf(step, stepKey)["rollingTime"],
          }).toEqual({ spelling, read: rollingTime });
        }
      }
    },
  );

  test.each(STEP_KEYS)(
    "%s: one that means none is kept as written, for a write to refuse",
    (stepKey: string) => {
      const step: MonitorStep = MonitorStep.fromJSON(
        stepJSON({ stepKey, rollingTime: "fortnight" }),
      );

      expect(settingsOf(step, stepKey)["rollingTime"]).toBe("fortnight");
    },
  );

  test("a Metrics step with no rolling time reads the default, as it always has", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      stepJSON({ stepKey: "metricMonitor" }),
    );

    expect(step.data!.metricMonitor!.rollingTime).toBe(RollingTime.Past1Minute);
  });
});

describe("MonitorStepRollingTime.getUnreadableError", () => {
  test.each(TYPES_AND_KEYS)(
    "%s: names the field, the value and the rolling times it can take",
    (monitorType: MonitorType, stepKey: string) => {
      const step: MonitorStep = MonitorStep.fromJSON(
        stepJSON({ stepKey, rollingTime: "fortnight" }),
      );

      expect(
        MonitorStepRollingTime.getUnreadableError({
          monitorType,
          stepData: step.data,
        }),
      ).toBe(
        `${stepKey}.rollingTime "fortnight" is not a rolling time. Use one of ${RollingTimeUtil.getValuesText()} - or a length exactly as long as one of them, such as "15 minutes", "1h" or "PT15M".`,
      );
    },
  );

  test.each(TYPES_AND_KEYS)(
    "%s: says nothing of a rolling time written any way, or none",
    (monitorType: MonitorType, stepKey: string) => {
      for (const rollingTime of [
        RollingTime.Past3Hours,
        "15 minutes",
        "PT1H",
        undefined,
        null,
        "",
      ]) {
        expect(
          MonitorStepRollingTime.getUnreadableError({
            monitorType,
            stepData: {
              [stepKey]: { ...IDENTIFIERS[stepKey], rollingTime },
            },
          }),
        ).toBeNull();
      }
    },
  );

  test("reads only the settings of the step's own monitor type", () => {
    const stepData: JSONObject = {
      metricMonitor: { rollingTime: RollingTime.Past5Minutes },
      kubernetesMonitor: { rollingTime: "fortnight" },
    };

    expect(
      MonitorStepRollingTime.getUnreadableError({
        monitorType: MonitorType.Metrics,
        stepData,
      }),
    ).toBeNull();
    expect(
      MonitorStepRollingTime.getUnreadableError({
        monitorType: MonitorType.Kubernetes,
        stepData,
      }),
    ).toContain('kubernetesMonitor.rollingTime "fortnight"');

    // A type that keeps no rolling time reads none.
    for (const monitorType of [
      MonitorType.API,
      MonitorType.Logs,
      MonitorType.Manual,
      undefined,
      null,
    ]) {
      expect(
        MonitorStepRollingTime.getUnreadableError({
          monitorType,
          stepData: { metricMonitor: { rollingTime: "fortnight" } },
        }),
      ).toBeNull();
    }
  });

  test("quotes a long value only in part, and a value that is not text by its kind", () => {
    const long: string | null = MonitorStepRollingTime.getUnreadableError({
      monitorType: MonitorType.Metrics,
      stepData: { metricMonitor: { rollingTime: "x".repeat(10_000) } },
    });

    expect(long).toContain(`metricMonitor.rollingTime "${"x".repeat(64)}…"`);
    expect(long!.length).toBeLessThan(1000);

    expect(
      MonitorStepRollingTime.getUnreadableError({
        monitorType: MonitorType.Metrics,
        stepData: { metricMonitor: { rollingTime: 15 } },
      }),
    ).toContain("metricMonitor.rollingTime 15 is not a rolling time");
    expect(
      MonitorStepRollingTime.getUnreadableError({
        monitorType: MonitorType.Metrics,
        stepData: { metricMonitor: { rollingTime: { minutes: 15 } } },
      }),
    ).toContain(
      "metricMonitor.rollingTime a value of type object is not a rolling time",
    );
  });

  test("says nothing of a step with no settings, or settings that are not an object", () => {
    for (const stepData of [
      undefined,
      null,
      {},
      { metricMonitor: "Past 15 Minutes" },
      { metricMonitor: [] },
    ]) {
      expect(
        MonitorStepRollingTime.getUnreadableError({
          monitorType: MonitorType.Metrics,
          stepData,
        }),
      ).toBeNull();
    }
  });
});

describe("MonitorStep.getValidationError", () => {
  test.each(TYPES_AND_KEYS)(
    "%s: refuses a rolling time that means none",
    (monitorType: MonitorType, stepKey: string) => {
      const step: MonitorStep = MonitorStep.fromJSON(
        stepJSON({ stepKey, rollingTime: "fortnight" }),
      );

      expect(MonitorStep.getValidationError(step, monitorType)).toContain(
        `${stepKey}.rollingTime "fortnight" is not a rolling time`,
      );
    },
  );

  test.each(TYPES_AND_KEYS)(
    "%s: takes one written another way, read on the way in",
    (monitorType: MonitorType, stepKey: string) => {
      const step: MonitorStep = MonitorStep.fromJSON(
        stepJSON({ stepKey, rollingTime: "15 minutes" }),
      );

      expect(MonitorStep.getValidationError(step, monitorType)).toBeNull();
    },
  );
});

/*
 * The MCP-written monitor itself, read by every reader of its window: the
 * worker's window and the queries it reads, the interval it reads them in,
 * the rule the When to alert editor shows, and the charts.
 */
describe("the Metrics monitor written through the MCP server", () => {
  const readStep: () => MonitorStep = (): MonitorStep => {
    return MonitorSteps.fromJSON(mcpWrittenMetricMonitorSteps()).data!
      .monitorStepsInstanceArray[0]!;
  };

  test("stored its rolling time as no rolling time is spelled", () => {
    expect(MCP_WRITTEN_ROLLING_TIME).toBe("15 minutes");
    expect(RollingTimeUtil.isRollingTime(MCP_WRITTEN_ROLLING_TIME)).toBe(false);
  });

  test("is read with the rolling time it means", () => {
    const step: MonitorStep = readStep();

    expect(step.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past15Minutes,
    );
    expect(MonitorStep.getValidationError(step, MonitorType.Metrics)).toBe(
      null,
    );
  });

  test("every reader of its window reads 15 minutes, never none", () => {
    assertReadsFifteenMinutes(readStep());
  });

  /*
   * A step built in code with the rolling time written another way - never
   * read through fromJSON - is read the same by every reader.
   */
  test("a step built with the rolling time as written is read the same", () => {
    const step: MonitorStep = readStep();
    step.setMetricMonitor({
      ...step.data!.metricMonitor!,
      rollingTime: MCP_WRITTEN_ROLLING_TIME as RollingTime,
    });

    expect(step.data!.metricMonitor!.rollingTime as string).toBe("15 minutes");
    assertReadsFifteenMinutes(step);
  });

  test("a rolling time that means none is read as the default by every reader, never as no window", () => {
    const step: MonitorStep = readStep();
    step.setMetricMonitor({
      ...step.data!.metricMonitor!,
      rollingTime: "fortnight" as RollingTime,
    });

    const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      step.data!.metricMonitor!.rollingTime,
      END,
    );

    expect(window.endValue.getTime() - window.startValue.getTime()).toBe(
      MINUTE,
    );
    expect(
      TelemetryMonitorWindow.getWindowInMs({
        monitorType: MonitorType.Metrics,
        monitorStep: step,
      }),
    ).toBe(MINUTE);
    expect(TelemetryAlertRuleUtil.getRollingTime(step)).toBe(
      RollingTime.Past1Minute,
    );
    expect(
      MonitorStepMetricQueries.getReads({
        monitorType: MonitorType.Metrics,
        monitorStep: step,
      })!.rollingTime,
    ).toBe(RollingTime.Past1Minute);
  });
});

function assertReadsFifteenMinutes(step: MonitorStep): void {
  const metricMonitor: MonitorStepMetricMonitor = step.data!.metricMonitor!;

  // The worker's window (MonitorTelemetryMonitor.monitorMetric).
  const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    metricMonitor.rollingTime || RollingTime.Past1Minute,
    END,
  );

  expect(window.endValue).toBe(END);
  expect(window.endValue.getTime() - window.startValue.getTime()).toBe(
    15 * MINUTE,
  );

  // What the worker asks OneUptime's own downtime about (issue #2825).
  expect(
    TelemetryMonitorWindow.getWindowInMs({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
    }),
  ).toBe(15 * MINUTE);

  // The queries the overview charts, as the worker reads them.
  const reads: MonitorStepMetricReads = MonitorStepMetricQueries.getReads({
    monitorType: MonitorType.Metrics,
    monitorStep: step,
  })!;

  expect(reads.rollingTime).toBe(RollingTime.Past15Minutes);
  expect(MonitorStepMetricQueries.getEvaluationInterval(reads)).toBe(
    AggregationInterval.Minute,
  );

  // The interval its queries are read in.
  expect(
    MetricQueryCloudAggregation.getMetricMonitorReadInterval(metricMonitor),
  ).toBe(AggregationInterval.Minute);

  // The rule the When to alert editor shows.
  expect(TelemetryAlertRuleUtil.getRollingTime(step)).toBe(
    RollingTime.Past15Minutes,
  );

  // The settings, as every reader of a stored step gets them.
  expect(
    MonitorStepMetricMonitorUtil.fromJSON(
      metricMonitor as unknown as JSONObject,
    ).rollingTime,
  ).toBe(RollingTime.Past15Minutes);
}

// The MonitorStepType keys this file names are real ones.
const KNOWN_KEYS: Array<keyof MonitorStepType> = [
  "metricMonitor",
  "kubernetesMonitor",
  "dockerMonitor",
  "hostMonitor",
  "podmanMonitor",
  "dockerSwarmMonitor",
  "proxmoxMonitor",
  "openstackMonitor",
  "vmwareMonitor",
  "cephMonitor",
  "storageArrayMonitor",
  "iotMonitor",
];

test("the settings this file writes are the twelve step keys", () => {
  expect([...Object.keys(IDENTIFIERS)].sort()).toEqual([...KNOWN_KEYS].sort());
  expect([...STEP_KEYS].sort()).toEqual([...KNOWN_KEYS].sort());
});
