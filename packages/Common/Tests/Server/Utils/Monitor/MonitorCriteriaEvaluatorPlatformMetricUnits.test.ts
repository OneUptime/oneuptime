/*
 * The evaluator's import chain pulls the native isolated-vm addon
 * (MonitorCriteriaEvaluator → VMAPI → VMRunner). Nothing under test here
 * touches the sandbox, so stub the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { IoTResourceScope } from "../../../../Types/Monitor/MonitorStepIoTMonitor";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import { getDockerAlertTemplateById } from "../../../../Types/Monitor/DockerAlertTemplates";
import { getPodmanAlertTemplateById } from "../../../../Types/Monitor/PodmanAlertTemplates";
import { getIoTAlertTemplateById } from "../../../../Types/Monitor/IotAlertTemplates";
import { describe, expect, test } from "@jest/globals";

/*
 * UNIT-CARRYING ROOT CAUSE FOR HOST, DOCKER, PODMAN AND IOT MONITORS.
 *
 * These four monitor types build their root cause in
 * MonitorCriteriaEvaluator.buildRootCauseContext, and it used to say very
 * little:
 *
 *   - Host / Docker / Podman followed their host lines with a "Metric
 *     Summary" that only counted data points — one line per query AND per
 *     formula, so the Host CPU template printed "- 3 metric data point(s)
 *     returned" three times and never the value that breached.
 *   - Their "- Metric:" line named `queryConfigs[0]` even when the
 *     criteria targeted a formula, so Host CPU reported
 *     `system.cpu.utilization` (one operand) for a threshold on
 *     "CPU Busy (%)".
 *   - IoT had no branch at all, so its emails carried only the
 *     "Filter Conditions Met" sentence.
 *
 * Every test below builds the monitor step from a REAL alert template,
 * feeds worker-shaped results through MonitorCriteriaEvaluator
 * .processMonitorStep — the same entry point the worker calls — and reads
 * the root cause that lands on the alert / incident.
 */

const T0: number = Date.UTC(2026, 8, 17, 12, 0, 0, 0);

function timestampIso(minute: number): string {
  return new Date(T0 + minute * 60_000).toISOString();
}

function templateArgs(): {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} {
  return {
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Platform monitor",
  };
}

interface SeriesFixture {
  labels: JSONObject;
  // One array of per-minute values per query config, in config order.
  queryValues: Array<Array<number>>;
}

/*
 * A query result the way the worker's raw scan returns it: one row per
 * (series, minute), with the datapoint attributes NESTED under
 * `attributes` — including ones the monitor does not group by.
 */
function queryResult(
  values: Array<number>,
  labels: JSONObject,
): AggregatedResult {
  return {
    data: values.map((value: number, index: number): AggregateModel => {
      return {
        timestamp: new Date(T0 + index * 60_000),
        value: value,
        attributes: { ...labels, "resource.host.arch": "amd64" },
      } as unknown as AggregateModel;
    }),
  };
}

// Query results followed by formula results, like the worker appends them.
function withFormulaResults(input: {
  metricViewConfig: MetricsViewConfig;
  queryResults: Array<AggregatedResult>;
}): Array<AggregatedResult> {
  const formulaResults: Array<AggregatedResult> = (
    input.metricViewConfig.formulaConfigs || []
  ).map((formula: MetricFormulaConfigData): AggregatedResult => {
    return MetricFormulaEvaluator.evaluateFormula({
      formula: formula.metricFormulaData.metricFormula,
      queryConfigs: input.metricViewConfig.queryConfigs,
      formulaConfigs: [],
      results: input.queryResults,
    });
  });

  return [...input.queryResults, ...formulaResults];
}

async function rootCauseFor(input: {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  series: Array<SeriesFixture>;
  nativeUnitsByMetricName?: { [key: string]: string } | undefined;
}): Promise<string> {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = input.monitorType;
  monitor.name = "Platform monitor";

  const metricViewConfig: MetricsViewConfig = MonitorStep.getMetricsViewConfig(
    input.monitorStep,
  )!;

  const grouped: boolean =
    MonitorStep.getGroupByAttributeKeys(input.monitorStep).length > 0;

  const seriesBreakdown: Array<MetricSeriesResult> = input.series.map(
    (series: SeriesFixture): MetricSeriesResult => {
      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(series.labels),
        labels: series.labels,
        aggregatedResults: withFormulaResults({
          metricViewConfig,
          queryResults: series.queryValues.map((values: Array<number>) => {
            return queryResult(values, series.labels);
          }),
        }),
      };
    },
  );

  const dataToProcess: MetricMonitorResponse = {
    monitorId: monitor.id!,
    projectId: monitor.projectId!,
    metricViewConfig,
    metricResult: seriesBreakdown[0]!.aggregatedResults,
    ...(grouped ? { seriesBreakdown } : {}),
    ...(input.nativeUnitsByMetricName
      ? { nativeUnitsByMetricName: input.nativeUnitsByMetricName }
      : {}),
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess,
      monitorStep: input.monitorStep,
      monitor,
      probeApiIngestResponse: {
        monitorId: monitor.id!,
        rootCause: null,
      },
      evaluationSummary: {
        criteriaResults: [],
        events: [],
      } as unknown as MonitorEvaluationSummary,
    });

  expect(response.rootCause).toBeTruthy();
  return response.rootCause as string;
}

function lines(rootCause: string): Array<string> {
  return rootCause.split("\n");
}

const LIST_ITEM_LINE: RegExp = /^\d+\. /;

// The value of the numbered Breaching Samples item taken at `minute`.
function sampleValueAt(rootCause: string, minute: number): string {
  const line: string | undefined = lines(rootCause).find((l: string) => {
    return LIST_ITEM_LINE.test(l) && l.includes(`\`${timestampIso(minute)}\``);
  });

  expect(line).toBeDefined();

  const match: RegExpMatchArray | null = (line as string).match(
    / — \*\*(.*)\*\*$/,
  );

  expect(match).not.toBeNull();
  return (match as RegExpMatchArray)[1] as string;
}

function filterConditionsMet(rootCause: string): string {
  const line: string | undefined = lines(rootCause).find((l: string) => {
    return l.startsWith("**Filter Conditions Met**:");
  });

  expect(line).toBeDefined();
  return line as string;
}

function metricExplorerLink(rootCause: string): URL {
  const match: RegExpMatchArray | null = rootCause.match(
    /\[Open metric in dashboard\]\(([^)]+)\)/,
  );

  expect(match).not.toBeNull();
  return new URL((match as RegExpMatchArray)[1] as string);
}

function expectNoLegacySummary(rootCause: string): void {
  expect(rootCause).not.toContain("Metric Summary");
  expect(rootCause).not.toContain("metric data point(s) returned");
  expect(rootCause).not.toContain("[object Object]");
}

describe("Host monitor root cause", () => {
  function hostStep(templateId: string): MonitorStep {
    return getHostAlertTemplateById(templateId)!.getMonitorStep({
      ...templateArgs(),
      hostIdentifier: "web-01",
    });
  }

  async function highCpuRootCause(
    monitorStep: MonitorStep = hostStep("host-high-cpu"),
  ): Promise<string> {
    return rootCauseFor({
      monitorType: MonitorType.Host,
      monitorStep,
      series: [
        {
          labels: {},
          queryValues: [
            [0.6, 0.61, 0.62],
            [0.325, 0.3, 0.31],
          ],
        },
      ],
      nativeUnitsByMetricName: { "system.cpu.utilization": "1" },
    });
  }

  test("High CPU: the breaching busy-CPU values are listed as percentages", async () => {
    const rootCause: string = await highCpuRootCause();

    expect(sampleValueAt(rootCause, 0)).toBe("92.50%");
    expect(sampleValueAt(rootCause, 1)).toBe("91.00%");
    expect(sampleValueAt(rootCause, 2)).toBe("93.00%");
    expect(rootCause).toContain("- Unit: Percent");
    expect(rootCause).toContain("3 of 3 samples breached the threshold.");
  });

  /*
   * The Host CPU template has two queries and one formula, so the old
   * summary printed "- 3 metric data point(s) returned" three times.
   */
  test("High CPU: the data-point-count summary is gone", async () => {
    expectNoLegacySummary(await highCpuRootCause());
  });

  test("High CPU: the Metric line names the formula the criteria compared, not its first operand", async () => {
    const rootCause: string = await highCpuRootCause();

    expect(rootCause).toContain(
      "**Host Details**\n- Host: web-01\n- Metric: CPU Busy (%)",
    );
    expect(lines(rootCause)).not.toContain(
      "- Metric: `system.cpu.utilization`",
    );
  });

  test("High CPU: the formula and the metric behind each variable are spelled out", async () => {
    const rootCause: string = await highCpuRootCause();

    expect(rootCause).toContain("**Metric Details**");
    expect(rootCause).toContain(
      "- Formula: `(host_cpu_user + host_cpu_system) * 100`",
    );
    expect(rootCause).toContain(
      "  - `host_cpu_user` = `system.cpu.utilization`",
    );
    expect(rootCause).toContain(
      "  - `host_cpu_system` = `system.cpu.utilization`",
    );
  });

  test("High CPU: the sentence and the Breaching Samples list agree on the value", async () => {
    const rootCause: string = await highCpuRootCause();

    expect(filterConditionsMet(rootCause)).toContain("93.00%");
    expect(filterConditionsMet(rootCause)).toContain("80.00% threshold");
    expect(sampleValueAt(rootCause, 2)).toBe("93.00%");
  });

  /*
   * A formula's context metricName is its EXPRESSION. Linking that as a
   * metric name opened an empty chart; the link now opens the step's own
   * queries and formula.
   */
  test("High CPU: the explorer link opens the step's queries and formula", async () => {
    const link: URL = metricExplorerLink(await highCpuRootCause());

    const queries: Array<JSONObject> = JSON.parse(
      link.searchParams.get("metricQueries") || "[]",
    );
    const formulas: Array<JSONObject> = JSON.parse(
      link.searchParams.get("metricFormulas") || "[]",
    );

    expect(
      queries.map((q: JSONObject) => {
        return q["metricName"];
      }),
    ).toEqual(["system.cpu.utilization", "system.cpu.utilization"]);
    expect(
      formulas.map((f: JSONObject) => {
        return f["formula"];
      }),
    ).toEqual(["(host_cpu_user + host_cpu_system) * 100"]);
  });

  test("a formula with no legend is named by its alias", async () => {
    const monitorStep: MonitorStep = hostStep("host-high-cpu");
    const formula: MetricFormulaConfigData =
      monitorStep.data!.hostMonitor!.metricViewConfig.formulaConfigs[0]!;
    formula.metricAliasData!.legend = undefined;
    formula.metricAliasData!.title = undefined;

    const rootCause: string = await highCpuRootCause(monitorStep);

    expect(rootCause).toContain("- Metric: `host_cpu` (formula)");
    expect(lines(rootCause)).not.toContain(
      "- Metric: `system.cpu.utilization`",
    );
  });

  test("High Filesystem: the breaching mount is listed with its value in percent", async () => {
    const rootCause: string = await rootCauseFor({
      monitorType: MonitorType.Host,
      monitorStep: hostStep("host-high-filesystem"),
      series: [
        {
          labels: { mountpoint: "/var", device: "/dev/sda2" },
          queryValues: [[0.95, 0.96]],
        },
        {
          labels: { mountpoint: "/", device: "/dev/sda1" },
          queryValues: [[0.4, 0.41]],
        },
      ],
      nativeUnitsByMetricName: { "system.filesystem.utilization": "1" },
    });

    expectNoLegacySummary(rootCause);
    expect(rootCause).toContain("- Metric: Filesystem Used (%)");
    expect(sampleValueAt(rootCause, 0)).toBe("95.00%");
    expect(sampleValueAt(rootCause, 1)).toBe("96.00%");
    // A formula row has no attributes; the sample names its series.
    expect(rootCause).toContain("   - `mountpoint`: `/var`");
    expect(rootCause).toContain("   - `device`: `/dev/sda2`");
    expect(rootCause).not.toContain("`/dev/sda1`");
    // Only the grouped labels are lifted off the raw row.
    expect(rootCause).not.toContain("resource.host.arch");
  });

  test("High Load Average: a plain query is named by its metric", async () => {
    const rootCause: string = await rootCauseFor({
      monitorType: MonitorType.Host,
      monitorStep: hostStep("host-high-load-average"),
      series: [{ labels: {}, queryValues: [[6.5, 7.25]] }],
      nativeUnitsByMetricName: { "system.cpu.load_average.1m": "{thread}" },
    });

    expectNoLegacySummary(rootCause);
    expect(rootCause).toContain(
      "**Host Details**\n- Host: web-01\n- Metric: `system.cpu.load_average.1m`",
    );
    // A run-queue length has no dimension: the annotation is not a unit.
    expect(sampleValueAt(rootCause, 0)).toBe("6.5");
    expect(sampleValueAt(rootCause, 1)).toBe("7.25");
    expect(rootCause).not.toContain("{thread}");
    expect(rootCause).not.toContain("- Formula:");
  });
});

describe("Docker monitor root cause", () => {
  function dockerStep(templateId: string): MonitorStep {
    return getDockerAlertTemplateById(templateId)!.getMonitorStep({
      ...templateArgs(),
      hostIdentifier: "docker-01",
    });
  }

  async function throttlingRootCause(): Promise<string> {
    const monitorStep: MonitorStep = dockerStep("docker-cpu-throttling");
    monitorStep.data!.dockerMonitor!.containerFilters = {
      containerName: "checkout",
      containerImage: "shop/checkout:1.4",
    };

    return rootCauseFor({
      monitorType: MonitorType.Docker,
      monitorStep,
      series: [
        {
          labels: { "resource.container.name": "checkout" },
          // Max and Min of the nanosecond counter within each minute.
          queryValues: [
            [5_000_000_000, 5_900_000_000],
            [4_000_000_000, 5_000_000_000],
          ],
        },
      ],
      nativeUnitsByMetricName: {
        "container.cpu.throttling_data.throttled_time": "ns",
      },
    });
  }

  test("CPU Throttling: host and container filter lines are kept", async () => {
    const rootCause: string = await throttlingRootCause();

    expect(rootCause).toContain(
      "**Docker Host Details**\n- Host: docker-01\n- Container Name Filter: checkout\n- Container Image Filter: shop/checkout:1.4\n- Metric: CPU Throttled Time",
    );
  });

  test("CPU Throttling: the Metric line names the delta formula, not the raw counter", async () => {
    const rootCause: string = await throttlingRootCause();

    expect(lines(rootCause)).not.toContain(
      "- Metric: `container.cpu.throttling_data.throttled_time`",
    );
    expect(rootCause).toContain(
      "- Formula: `(cpu_throttled_max - cpu_throttled_min) / 1000000`",
    );
  });

  test("CPU Throttling: the throttled time is reported in time units", async () => {
    const rootCause: string = await throttlingRootCause();

    expectNoLegacySummary(rootCause);
    expect(rootCause).toContain("- Unit: Milliseconds");
    // 1000 ms + 900 ms of growth, summed over the window.
    expect(filterConditionsMet(rootCause)).toContain("1.9 sec");
    expect(filterConditionsMet(rootCause)).toContain("1 sec threshold");
  });

  test("Container Down: the container's uptime is listed in seconds with the container named", async () => {
    const rootCause: string = await rootCauseFor({
      monitorType: MonitorType.Docker,
      monitorStep: dockerStep("docker-container-down"),
      series: [
        {
          labels: { "resource.container.name": "checkout" },
          queryValues: [[0]],
        },
      ],
      nativeUnitsByMetricName: { "container.uptime": "s" },
    });

    expectNoLegacySummary(rootCause);
    expect(rootCause).toContain("- Metric: `container.uptime`");
    expect(rootCause).toContain("- Unit: Seconds");
    expect(sampleValueAt(rootCause, 0)).toBe("0 sec");
    expect(rootCause).toContain("   - `resource.container.name`: `checkout`");
    // Only the grouped label is lifted off the raw row, not every attribute.
    expect(rootCause).not.toContain("resource.host.arch");
  });
});

describe("Podman monitor root cause", () => {
  async function containerDownRootCause(): Promise<string> {
    const monitorStep: MonitorStep = getPodmanAlertTemplateById(
      "podman-container-down",
    )!.getMonitorStep({
      ...templateArgs(),
      hostIdentifier: "podman-01",
    });
    monitorStep.data!.podmanMonitor!.containerFilters = {
      containerName: "api",
    };

    return rootCauseFor({
      monitorType: MonitorType.Podman,
      monitorStep,
      series: [
        { labels: { "resource.container.name": "api" }, queryValues: [[45]] },
        {
          labels: { "resource.container.name": "worker" },
          queryValues: [[86400]],
        },
      ],
      nativeUnitsByMetricName: { "container.uptime": "s" },
    });
  }

  test("Container Restarted: host and container filter lines are kept", async () => {
    expect(await containerDownRootCause()).toContain(
      "**Podman Host Details**\n- Host: podman-01\n- Container Name Filter: api\n- Metric: `container.uptime`",
    );
  });

  test("Container Restarted: the low uptime is listed in seconds with the container named", async () => {
    const rootCause: string = await containerDownRootCause();

    expectNoLegacySummary(rootCause);
    expect(rootCause).toContain("- Unit: Seconds");
    expect(sampleValueAt(rootCause, 0)).toBe("45 sec");
    expect(rootCause).toContain("   - `resource.container.name`: `api`");
    expect(rootCause).not.toContain("`worker`");
    expect(filterConditionsMet(rootCause)).toContain("45 sec");
    expect(filterConditionsMet(rootCause)).toContain("2 min threshold");
  });
});

describe("IoT device monitor root cause", () => {
  function iotStep(templateId: string): MonitorStep {
    return getIoTAlertTemplateById(templateId)!.getMonitorStep({
      ...templateArgs(),
      fleetIdentifier: "warehouse",
    });
  }

  async function lowBatteryRootCause(
    monitorStep: MonitorStep = iotStep("iot-low-battery"),
  ): Promise<string> {
    return rootCauseFor({
      monitorType: MonitorType.IoTDevice,
      monitorStep,
      series: [
        { labels: { "device.id": "sensor-42" }, queryValues: [[12.5, 11]] },
        { labels: { "device.id": "sensor-7" }, queryValues: [[88, 87.5]] },
      ],
    });
  }

  /*
   * IoT had no branch in buildRootCauseContext at all, so the email
   * stopped at the "Filter Conditions Met" sentence.
   */
  test("the root cause is no longer just the Filter Conditions Met sentence", async () => {
    const rootCause: string = await lowBatteryRootCause();

    expect(rootCause).toContain("**IoT Device Details**");
    expect(rootCause).toContain("**Metric Details**");
    expect(rootCause).toContain("**Breaching Samples**");
  });

  test("names the fleet, the breaching device and the metric", async () => {
    const rootCause: string = await lowBatteryRootCause();

    expect(rootCause).toContain(
      "**IoT Device Details**\n- Fleet: warehouse\n- Device: `sensor-42`\n- Metric: `iot_battery_percent`",
    );
    expect(rootCause).not.toContain("sensor-7");
  });

  test("lists the step's device filters", async () => {
    const monitorStep: MonitorStep = iotStep("iot-low-battery");
    monitorStep.data!.iotMonitor!.resourceFilters = {
      deviceType: "gateway",
      scope: IoTResourceScope.Device,
    };

    const rootCause: string = await lowBatteryRootCause(monitorStep);

    expect(rootCause).toContain("- Device Type Filter: gateway");
    expect(rootCause).toContain("- Scope Filter: device");
  });

  test("Low Battery: each sample is a percentage and names its device", async () => {
    const rootCause: string = await lowBatteryRootCause();

    expect(rootCause).toContain("- Unit: Percent");
    expect(sampleValueAt(rootCause, 0)).toBe("12.50%");
    expect(sampleValueAt(rootCause, 1)).toBe("11.00%");
    expect(rootCause).toContain("   - `device.id`: `sensor-42`");
    expect(rootCause).not.toContain("[object Object]");
  });

  test("the explorer link for a plain query still opens that metric", async () => {
    const link: URL = metricExplorerLink(await lowBatteryRootCause());

    const queries: Array<JSONObject> = JSON.parse(
      link.searchParams.get("metricQueries") || "[]",
    );

    expect(
      queries.map((q: JSONObject) => {
        return q["metricName"];
      }),
    ).toEqual(["iot_battery_percent"]);
    expect(link.searchParams.get("metricFormulas")).toBeNull();
  });

  const unitCases: Array<{
    templateId: string;
    values: Array<number>;
    unitLine: string;
    expected: Array<string>;
  }> = [
    {
      templateId: "iot-weak-signal",
      values: [-103.2, -104.5],
      unitLine: "- Unit: dBm",
      expected: ["-103.2 dBm", "-104.5 dBm"],
    },
    {
      templateId: "iot-high-temperature",
      values: [72.5, 75],
      unitLine: "- Unit: °C",
      expected: ["72.5 °C", "75 °C"],
    },
  ];

  for (const unitCase of unitCases) {
    test(`${unitCase.templateId}: the sample values carry the catalog unit`, async () => {
      const rootCause: string = await rootCauseFor({
        monitorType: MonitorType.IoTDevice,
        monitorStep: iotStep(unitCase.templateId),
        series: [
          {
            labels: { "device.id": "sensor-42" },
            queryValues: [unitCase.values],
          },
        ],
      });

      expect(rootCause).toContain(unitCase.unitLine);
      expect(sampleValueAt(rootCause, 0)).toBe(unitCase.expected[0]);
      expect(sampleValueAt(rootCause, 1)).toBe(unitCase.expected[1]);
      expect(filterConditionsMet(rootCause)).toContain(unitCase.expected[0]!);
    });
  }
});

/*
 * With no metric-value filter there is no metric context to read the
 * criteria's target from, so the details block falls back to naming the
 * step's first query — what it always did.
 */
describe("platform root cause without a metric context", () => {
  type EvaluatorPrivate = {
    buildRootCauseContext: (input: {
      dataToProcess: MetricMonitorResponse;
      monitorStep: MonitorStep;
      monitor: Monitor;
      criteriaInstance?: MonitorCriteriaInstance;
    }) => Promise<string | null>;
  };

  test("names the step's first query and adds no Metric Details", async () => {
    const monitorStep: MonitorStep = getHostAlertTemplateById(
      "host-high-load-average",
    )!.getMonitorStep({ ...templateArgs(), hostIdentifier: "web-01" });

    const criteriaInstance: MonitorCriteriaInstance =
      new MonitorCriteriaInstance();
    criteriaInstance.data = {
      id: ObjectID.generate().toString(),
      name: "No metric filter",
      description: "",
      monitorStatusId: undefined,
      filterCondition: FilterCondition.All,
      filters: [{ checkOn: CheckOn.IsOnline } as CriteriaFilter],
      incidents: [],
      alerts: [],
    } as unknown as MonitorCriteriaInstance["data"];

    const monitor: Monitor = new Monitor();
    monitor.projectId = ObjectID.generate();
    monitor.monitorType = MonitorType.Host;

    const context: string | null = await (
      MonitorCriteriaEvaluator as unknown as EvaluatorPrivate
    ).buildRootCauseContext({
      dataToProcess: {
        monitorId: ObjectID.generate(),
        projectId: monitor.projectId,
        metricViewConfig: MonitorStep.getMetricsViewConfig(monitorStep)!,
        metricResult: [],
      },
      monitorStep,
      monitor,
      criteriaInstance,
    });

    expect(context).toBe(
      "**Host Details**\n- Host: web-01\n- Metric: `system.cpu.load_average.1m`",
    );
  });
});
