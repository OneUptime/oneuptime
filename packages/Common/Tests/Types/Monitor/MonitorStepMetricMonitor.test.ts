import { JSONObject } from "../../../Types/JSON";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import RollingTime from "../../../Types/RollingTime/RollingTime";

/*
 * Regression coverage for the blank-screen crash on the monitor view page.
 *
 * MetricMonitorPreview read `monitorStepMetricMonitor?.metricViewConfig.queryConfigs`.
 * The optional chain stops at `monitorStepMetricMonitor`, so a step that HAS a
 * metricMonitor but no metricViewConfig threw
 *
 *     TypeError: Cannot read properties of undefined (reading 'queryConfigs')
 *
 * during render. Nothing above it caught the throw, so React unmounted the whole
 * tree and the dashboard went blank white — nav, sidebar and all.
 *
 * That shape is reachable because monitor steps are persisted as free-form JSON
 * and rehydrated with a cast: nothing at runtime enforces that metricViewConfig
 * is present. These tests lock in that resolving the config NEVER throws and
 * always yields array-shaped queryConfigs / formulaConfigs, whatever garbage the
 * database hands back.
 */

function queryConfig(metricVariable: string): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable,
      title: metricVariable,
      description: metricVariable,
      legend: metricVariable,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {},
    },
  } as unknown as MetricQueryConfigData;
}

function formulaConfig(metricVariable: string): MetricFormulaConfigData {
  return {
    metricAliasData: {
      metricVariable,
      title: metricVariable,
      description: metricVariable,
      legend: metricVariable,
      legendUnit: undefined,
    },
    metricFormulaData: {
      formula: "a + b",
    },
  } as unknown as MetricFormulaConfigData;
}

describe("MonitorStepMetricMonitorUtil.getMetricViewConfig", () => {
  test("returns the config untouched when the step is well formed", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [queryConfig("a")];
    const formulaConfigs: Array<MetricFormulaConfigData> = [formulaConfig("b")];

    const config: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getMetricViewConfig({
        metricViewConfig: {
          queryConfigs,
          formulaConfigs,
        },
        rollingTime: RollingTime.Past1Hour,
      });

    expect(config.queryConfigs).toEqual(queryConfigs);
    expect(config.formulaConfigs).toEqual(formulaConfigs);
  });

  test("returns empty arrays when the whole monitor is undefined", () => {
    const config: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getMetricViewConfig(undefined);

    expect(config).toEqual({ queryConfigs: [], formulaConfigs: [] });
  });

  test("returns empty arrays when the whole monitor is null", () => {
    const config: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getMetricViewConfig(null);

    expect(config).toEqual({ queryConfigs: [], formulaConfigs: [] });
  });

  test("THE CRASH: monitor present but metricViewConfig missing entirely", () => {
    /*
     * The exact shape from the bug report: a persisted metricMonitor that only
     * carries rollingTime. Reading .metricViewConfig.queryConfigs off this is
     * what threw and blanked the page.
     */
    const malformed: MonitorStepMetricMonitor = {
      rollingTime: RollingTime.Past1Minute,
    } as unknown as MonitorStepMetricMonitor;

    expect(() => {
      return MonitorStepMetricMonitorUtil.getMetricViewConfig(malformed);
    }).not.toThrow();

    expect(MonitorStepMetricMonitorUtil.getMetricViewConfig(malformed)).toEqual(
      {
        queryConfigs: [],
        formulaConfigs: [],
      },
    );
  });

  test("returns empty arrays when metricViewConfig is explicitly null", () => {
    const malformed: MonitorStepMetricMonitor = {
      metricViewConfig: null,
      rollingTime: RollingTime.Past1Minute,
    } as unknown as MonitorStepMetricMonitor;

    expect(MonitorStepMetricMonitorUtil.getMetricViewConfig(malformed)).toEqual(
      { queryConfigs: [], formulaConfigs: [] },
    );
  });

  test("fills in queryConfigs when only formulaConfigs was persisted", () => {
    const formulaConfigs: Array<MetricFormulaConfigData> = [formulaConfig("b")];

    const config: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getMetricViewConfig({
        metricViewConfig: { formulaConfigs },
        rollingTime: RollingTime.Past1Minute,
      } as unknown as MonitorStepMetricMonitor);

    expect(config.queryConfigs).toEqual([]);
    expect(config.formulaConfigs).toEqual(formulaConfigs);
  });

  test("fills in formulaConfigs when only queryConfigs was persisted", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [queryConfig("a")];

    const config: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getMetricViewConfig({
        metricViewConfig: { queryConfigs },
        rollingTime: RollingTime.Past1Minute,
      } as unknown as MonitorStepMetricMonitor);

    expect(config.queryConfigs).toEqual(queryConfigs);
    expect(config.formulaConfigs).toEqual([]);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "not-an-array"],
    ["a number", 42],
    ["an object", { length: 2 }],
    ["a boolean", true],
  ])(
    "coerces non-array queryConfigs (%s) to an empty array",
    (_label: string, value: unknown) => {
      const config: MetricsViewConfig =
        MonitorStepMetricMonitorUtil.getMetricViewConfig({
          metricViewConfig: {
            queryConfigs: value,
            formulaConfigs: value,
          },
          rollingTime: RollingTime.Past1Minute,
        } as unknown as MonitorStepMetricMonitor);

      expect(config.queryConfigs).toEqual([]);
      expect(config.formulaConfigs).toEqual([]);
      // Callers immediately call .length / .map / .some on these.
      expect(Array.isArray(config.queryConfigs)).toBe(true);
      expect(Array.isArray(config.formulaConfigs)).toBe(true);
    },
  );

  test("the result is always safe for the array reads MetricView performs", () => {
    const malformed: MonitorStepMetricMonitor =
      {} as unknown as MonitorStepMetricMonitor;

    const config: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getMetricViewConfig(malformed);

    // These are the exact operations MetricView runs on the data it is given.
    expect(() => {
      return [
        config.queryConfigs.length,
        config.queryConfigs.map((q: MetricQueryConfigData) => {
          return q;
        }),
        config.queryConfigs.some(() => {
          return true;
        }),
        config.formulaConfigs.length,
        config.formulaConfigs.map((f: MetricFormulaConfigData) => {
          return f;
        }),
      ];
    }).not.toThrow();
  });

  test("does not mutate the monitor it was given", () => {
    const malformed: MonitorStepMetricMonitor = {
      rollingTime: RollingTime.Past1Minute,
    } as unknown as MonitorStepMetricMonitor;

    MonitorStepMetricMonitorUtil.getMetricViewConfig(malformed);

    expect(
      (malformed as unknown as JSONObject)["metricViewConfig"],
    ).toBeUndefined();
  });

  test("hands back the same array references when they are already valid", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [queryConfig("a")];
    const formulaConfigs: Array<MetricFormulaConfigData> = [formulaConfig("b")];

    const config: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getMetricViewConfig({
        metricViewConfig: { queryConfigs, formulaConfigs },
        rollingTime: RollingTime.Past1Minute,
      });

    // No defensive copy: the preview passes these straight into MetricView.
    expect(config.queryConfigs).toBe(queryConfigs);
    expect(config.formulaConfigs).toBe(formulaConfigs);
  });
});

describe("MonitorStepMetricMonitorUtil.getDefault", () => {
  test("produces a config that resolves to itself", () => {
    const defaultMonitor: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.getDefault();

    expect(
      MonitorStepMetricMonitorUtil.getMetricViewConfig(defaultMonitor),
    ).toEqual({
      queryConfigs: [],
      formulaConfigs: [],
    });
    expect(defaultMonitor.rollingTime).toBe(RollingTime.Past1Minute);
  });
});

describe("MonitorStepMetricMonitorUtil.fromJSON", () => {
  test("normalizes JSON that is missing metricViewConfig", () => {
    const monitor: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.fromJSON({
        rollingTime: RollingTime.Past1Hour,
      });

    expect(monitor.metricViewConfig).toEqual({
      queryConfigs: [],
      formulaConfigs: [],
    });
    expect(monitor.rollingTime).toBe(RollingTime.Past1Hour);
  });

  test("normalizes JSON that is missing everything", () => {
    const monitor: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.fromJSON({});

    expect(monitor.metricViewConfig).toEqual({
      queryConfigs: [],
      formulaConfigs: [],
    });
    // rollingTime backs off to the same default a fresh step gets.
    expect(monitor.rollingTime).toBe(RollingTime.Past1Minute);
  });

  test("preserves a well formed config", () => {
    const json: JSONObject = {
      metricViewConfig: {
        queryConfigs: [queryConfig("a")],
        formulaConfigs: [formulaConfig("b")],
      },
      rollingTime: RollingTime.Past7Days,
    } as unknown as JSONObject;

    const monitor: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.fromJSON(json);

    expect(monitor.metricViewConfig.queryConfigs).toHaveLength(1);
    expect(monitor.metricViewConfig.formulaConfigs).toHaveLength(1);
    expect(monitor.rollingTime).toBe(RollingTime.Past7Days);
  });

  test("keeps unknown keys so forward-compatible fields are not dropped", () => {
    const monitor: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.fromJSON({
        rollingTime: RollingTime.Past1Minute,
        someFutureField: "keep-me",
      } as unknown as JSONObject);

    expect((monitor as unknown as JSONObject)["someFutureField"]).toBe(
      "keep-me",
    );
  });

  test("round trips through toJSON without losing the normalization", () => {
    const monitor: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.fromJSON({
        rollingTime: RollingTime.Past1Minute,
      });

    const roundTripped: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.fromJSON(
        MonitorStepMetricMonitorUtil.toJSON(monitor),
      );

    expect(roundTripped.metricViewConfig).toEqual({
      queryConfigs: [],
      formulaConfigs: [],
    });
  });
});

describe("MonitorStep.fromJSON normalizes persisted metric monitors", () => {
  function monitorStepJSON(metricMonitor: JSONObject | undefined): JSONObject {
    return {
      _type: "MonitorStep",
      value: {
        id: "step-1",
        monitorCriteria: {
          _type: "MonitorCriteria",
          value: {
            monitorCriteriaInstanceArray: [],
          },
        },
        metricMonitor: metricMonitor,
      },
    } as unknown as JSONObject;
  }

  test("a step whose metricMonitor has no metricViewConfig loads with one", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      monitorStepJSON({
        rollingTime: RollingTime.Past1Minute,
      } as unknown as JSONObject),
    );

    expect(step.data?.metricMonitor?.metricViewConfig).toEqual({
      queryConfigs: [],
      formulaConfigs: [],
    });
  });

  test("the loaded step is safe to hand to the metric preview", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      monitorStepJSON({} as unknown as JSONObject),
    );

    expect(() => {
      const config: MetricsViewConfig =
        MonitorStepMetricMonitorUtil.getMetricViewConfig(
          step.data?.metricMonitor,
        );

      return [config.queryConfigs.length, config.formulaConfigs.length];
    }).not.toThrow();
  });

  test("a step with no metricMonitor at all stays undefined", () => {
    const step: MonitorStep = MonitorStep.fromJSON(monitorStepJSON(undefined));

    expect(step.data?.metricMonitor).toBeUndefined();
  });

  test("a well formed metricMonitor survives the load unchanged", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      monitorStepJSON({
        metricViewConfig: {
          queryConfigs: [queryConfig("a")],
          formulaConfigs: [],
        },
        rollingTime: RollingTime.Past1Hour,
      } as unknown as JSONObject),
    );

    expect(
      step.data?.metricMonitor?.metricViewConfig.queryConfigs,
    ).toHaveLength(1);
    expect(step.data?.metricMonitor?.rollingTime).toBe(RollingTime.Past1Hour);
  });
});
