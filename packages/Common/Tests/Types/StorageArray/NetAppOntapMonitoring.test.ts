/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the native
 * isolated-vm addon. Nothing here uses the sandbox, and the prebuilt binary cannot
 * always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { describe, expect, jest, test } from "@jest/globals";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import CriteriaInEffect from "../../../Server/Utils/Monitor/CriteriaInEffect";
import MonitorCriteriaEvaluator from "../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "../../../Server/Utils/Monitor/MonitorResource";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../Types/JSON";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  StorageArrayAlertTemplate,
  getStorageArrayAlertTemplateById,
  getStorageArrayAlertTemplatesForSystem,
} from "../../../Types/Monitor/StorageArrayAlertTemplates";
import {
  StorageArrayMetricDefinition,
  getStorageArrayMetricsForSystem,
} from "../../../Types/Monitor/StorageArrayMetricCatalog";
import ObjectID from "../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import StorageArrayMetricUnitUtil from "../../../Types/StorageArray/StorageArrayMetricUnitUtil";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import { CapturedSeries } from "../../Helpers/StorageArray/OpenMetricsCapture";
import {
  NetAppRecording,
  getRecordedSeriesLabels,
  readNetAppRecording,
  whatTheAgentSends,
} from "../../Helpers/StorageArray/NetAppHarvestRecordings";

/*
 * AN ONTAP CLUSTER'S MONITORS, ON WHAT NETAPP HARVEST REALLY SERVED (#11001).
 *
 * The templates' own invariants are StorageArrayAlertTemplates.test.ts's;
 * this drives the real MonitorCriteriaEvaluator, on what the telemetry
 * worker hands it, with the series and labels of the recordings
 * (Tests/Fixtures/NetAppHarvest/26.11.0). It holds the decisions that
 * depend on how Harvest exports state:
 *
 *   - an EMS event is exported for the one poll that collected it, and a
 *     cleared bookend event once more as 0: its alert opens on the event,
 *     stays open while the event is in the window, and closes once the
 *     window holds none while the cluster still reports;
 *   - an open problem (a broken disk, a stopped SVM, an unhealthy
 *     SnapMirror relationship) is a series while it lasts: it resolves when
 *     the series goes, but never on the silence of an agent that stopped;
 *   - a 0/1 state recovers at exactly 1;
 *   - SnapMirror Behind Schedule reads the lag over the schedule, one
 *     relationship at a time, and a relationship with no schedule never;
 *   - a volume is one incident per SVM and volume.
 *
 * And the catalog: every metric is a series Harvest serves, in the unit
 * its name says.
 */

const END_MS: number = Date.UTC(2026, 10, 26, 5, 0, 0);
const ONTAP: StorageSystem = StorageSystem.NetAppOntap;

const WINDOW_MINUTES: Record<string, number> = {
  [RollingTime.Past5Minutes]: 5,
  [RollingTime.Past10Minutes]: 10,
  [RollingTime.Past15Minutes]: 15,
  [RollingTime.Past1Hour]: 60,
};

function stepOf(id: string): MonitorStep {
  const template: StorageArrayAlertTemplate =
    getStorageArrayAlertTemplateById(id)!;
  expect(template.storageSystems).toEqual([ONTAP]);
  return template.getMonitorStep({
    arrayIdentifier: "ontap-prod-01",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "ontap-prod-01",
  });
}

/*
 * One series as the worker reads it: its labels, and each alias's readings
 * over the window, oldest first, one a minute (a value per scrape).
 */
interface Series {
  labels: JSONObject;
  readings: Record<string, Array<number>>;
}

function rowsOf(
  readings: Array<number> | undefined,
  labels: JSONObject,
): Array<AggregateModel> {
  return (readings || []).map(
    (value: number, index: number): AggregateModel => {
      return {
        timestamp: new Date(END_MS - (readings!.length - index) * 60000),
        value: value,
        attributes: labels,
      } as unknown as AggregateModel;
    },
  );
}

// What the worker's buildSeriesBreakdown hands the evaluator.
function workerResponse(
  step: MonitorStep,
  series: Array<Series>,
  resourceStillReporting: boolean,
): MetricMonitorResponse {
  const config: NonNullable<MonitorStep["data"]>["storageArrayMonitor"] =
    step.data!.storageArrayMonitor!;
  const minutes: number = WINDOW_MINUTES[config.rollingTime] || 10;
  const queries: Array<MetricQueryConfigData> =
    config.metricViewConfig.queryConfigs;
  const formulas: Array<MetricFormulaConfigData> =
    config.metricViewConfig.formulaConfigs || [];

  const seriesBreakdown: Array<MetricSeriesResult> = series.map(
    (entry: Series): MetricSeriesResult => {
      const results: Array<AggregatedResult> = queries.map(
        (query: MetricQueryConfigData): AggregatedResult => {
          return {
            data: rowsOf(
              entry.readings[query.metricAliasData?.metricVariable || ""],
              entry.labels,
            ),
          };
        },
      );
      formulas.forEach((formula: MetricFormulaConfigData, index: number) => {
        results.push(
          MetricFormulaEvaluator.evaluateFormula({
            formula: formula.metricFormulaData.metricFormula,
            queryConfigs: queries,
            formulaConfigs: formulas.slice(0, index),
            results: results,
          }),
        );
      });
      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(entry.labels),
        labels: entry.labels,
        aggregatedResults: results,
      };
    },
  );

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig: config.metricViewConfig,
    startAndEndDate: {
      startValue: new Date(END_MS - minutes * 60000),
      endValue: new Date(END_MS),
    } as NonNullable<MetricMonitorResponse["startAndEndDate"]>,
    metricResult: [...queries, ...formulas].map(
      (_config: unknown, index: number): AggregatedResult => {
        return {
          data: seriesBreakdown.flatMap((entry: MetricSeriesResult) => {
            return entry.aggregatedResults[index]?.data || [];
          }),
        };
      },
    ),
    seriesBreakdown: seriesBreakdown,
    resourceStillReporting: resourceStillReporting,
  } as MetricMonitorResponse;
}

interface Tick {
  // The series the firing criteria opened an incident for.
  breaching: Array<JSONObject>;
  // Whether the monitor's status went to the recovery criteria's.
  recovered: boolean;
  isSilent: boolean;
}

async function evaluate(
  step: MonitorStep,
  series: Array<Series>,
  options?: { resourceStillReporting?: boolean },
): Promise<Tick> {
  const data: MetricMonitorResponse = workerResponse(
    step,
    series,
    options?.resourceStillReporting ?? true,
  );
  const monitor: Monitor = new Monitor();
  monitor.id = data.monitorId;
  monitor.projectId = data.projectId;
  monitor.monitorType = MonitorType.StorageArray;

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: data,
      monitorStep: step,
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: data.monitorId,
        rootCause: null,
      },
      evaluationSummary: {
        evaluatedAt: new Date(),
        criteriaResults: [],
        events: [],
      } as MonitorEvaluationSummary,
      criteriaInEffect: {
        isInEffect: (): Promise<boolean> => {
          return Promise.resolve(false);
        },
      } as unknown as CriteriaInEffect,
    });

  const [firing, recovery] = step.data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray as [
    MonitorCriteriaInstance,
    MonitorCriteriaInstance,
  ];

  return {
    breaching: (response.matchedCriteria || [])
      .filter((matched: MatchedCriteriaResult): boolean => {
        return matched.criteriaId === firing.data!.id?.toString();
      })
      .flatMap(
        (matched: MatchedCriteriaResult): Array<PerSeriesCriteriaMatch> => {
          return matched.perSeriesMatches;
        },
      )
      .map((match: PerSeriesCriteriaMatch): JSONObject => {
        return match.labels;
      }),
    recovered:
      response.criteriaMetId?.toString() === recovery.data!.id?.toString(),
    isSilent: MonitorResourceUtil.isSilentInfrastructureWindow({
      monitor: monitor,
      dataToProcess: data,
    }),
  };
}

// The series of a recording, by name, as the agent sends them.
function seriesOf(
  file: NetAppRecording,
  metricName: string,
  filter?: (series: CapturedSeries) => boolean,
): Array<CapturedSeries> {
  return whatTheAgentSends(readNetAppRecording(file)).filter(
    (series: CapturedSeries): boolean => {
      return series.name === metricName && (!filter || filter(series));
    },
  );
}

// A series' labels, the way the step groups by them.
function groupLabels(step: MonitorStep, series: CapturedSeries): JSONObject {
  const labels: JSONObject = {};
  for (const key of MonitorStep.getGroupByAttributeKeys(step)) {
    labels[key] = series.labels[key] || "";
  }
  return labels;
}

// Whether a recorded series passes a query's label filters.
function passesFilters(step: MonitorStep, series: CapturedSeries): boolean {
  const attributes: Record<string, string> = (step.data!.storageArrayMonitor!
    .metricViewConfig.queryConfigs[0]!.metricQueryData.filterData.attributes ||
    {}) as Record<string, string>;
  return Object.entries(attributes).every(
    ([key, value]: [string, string]): boolean => {
      return series.labels[key] === value;
    },
  );
}

function aliasOf(step: MonitorStep, index: number = 0): string {
  return step.data!.storageArrayMonitor!.metricViewConfig.queryConfigs[index]!
    .metricAliasData!.metricVariable!;
}

describe("an EMS event's alert, as Harvest exports the event", () => {
  const step: MonitorStep = stepOf("netapp-alert-ems-event");
  const raised: CapturedSeries = seriesOf(
    "ontap.prom",
    "netapp_ems_events",
    (series: CapturedSeries): boolean => {
      return series.labels["message"] === "monitor.fan.failed";
    },
  )[0]!;
  const cleared: CapturedSeries = seriesOf(
    "ontap-ems-cleared.prom",
    "netapp_ems_events",
  )[0]!;

  test("the recordings hold the raise, then the bookend's 0 with the same labels, then nothing", () => {
    expect(raised.value).toBe(1);
    expect(raised.labels["severity"]).toBe("alert");
    expect(cleared.value).toBe(0);
    expect(cleared.labels).toEqual(raised.labels);
    expect(seriesOf("ontap-ems-after.prom", "netapp_ems_events")).toEqual([]);
    expect(passesFilters(step, raised)).toBe(true);
  });

  test("the poll that raised it opens one incident, naming the event", async () => {
    const tick: Tick = await evaluate(step, [
      {
        labels: groupLabels(step, raised),
        // Harvest exports it for one poll: three scrapes.
        readings: { [aliasOf(step)]: [1, 1, 1] },
      },
    ]);
    expect(tick.breaching).toEqual([{ message: "monitor.fan.failed" }]);
    expect(tick.recovered).toBe(false);
  });

  test("the poll that cleared it leaves it open while the event is in the window", async () => {
    const tick: Tick = await evaluate(step, [
      {
        labels: groupLabels(step, cleared),
        readings: { [aliasOf(step)]: [1, 1, 1, cleared.value] },
      },
    ]);
    expect(tick.breaching).toEqual([{ message: "monitor.fan.failed" }]);
    expect(tick.recovered).toBe(false);
  });

  test("a window whose every reading is the bookend's 0 does not fire", async () => {
    const tick: Tick = await evaluate(step, [
      {
        labels: groupLabels(step, cleared),
        readings: { [aliasOf(step)]: [0] },
      },
    ]);
    expect(tick.breaching).toEqual([]);
  });

  test("once the window holds no event while the cluster still reports, it closes", async () => {
    const tick: Tick = await evaluate(step, []);
    expect(tick.recovered).toBe(true);
  });

  test("but an agent that stopped is silence, not recovery", async () => {
    const tick: Tick = await evaluate(step, [], {
      resourceStillReporting: false,
    });
    expect(tick.recovered).toBe(false);
    expect(tick.isSilent).toBe(true);
  });

  test("an event of another severity is another template's", async () => {
    const disk: CapturedSeries = seriesOf(
      "ontap.prom",
      "netapp_ems_events",
      (series: CapturedSeries): boolean => {
        return series.labels["message"] === "disk.outOfService";
      },
    )[0]!;
    expect(passesFilters(step, disk)).toBe(false);
    const outOfService: MonitorStep = stepOf("netapp-disk-out-of-service");
    expect(passesFilters(outOfService, disk)).toBe(true);
    const tick: Tick = await evaluate(outOfService, [
      {
        labels: groupLabels(outOfService, disk),
        readings: { [aliasOf(outOfService)]: [1, 1, 1] },
      },
    ]);
    expect(tick.breaching).toEqual([{ disk: "1.0.7" }]);
  });
});

describe("an open problem's alert, while ONTAP reports it", () => {
  test("a broken disk opens one incident naming it, and resolves once it is replaced", async () => {
    const step: MonitorStep = stepOf("netapp-disk-failed");
    const broken: Array<CapturedSeries> = seriesOf(
      "ontap.prom",
      "netapp_health_disk_alerts",
    ).filter((series: CapturedSeries): boolean => {
      return passesFilters(step, series);
    });
    expect(broken).toHaveLength(1);

    const open: Tick = await evaluate(
      step,
      broken.map((series: CapturedSeries): Series => {
        return {
          labels: groupLabels(step, series),
          readings: { [aliasOf(step)]: [1, 1, 1, 1, 1] },
        };
      }),
    );
    expect(open.breaching).toEqual([{ disk: "1.0.7" }]);

    // Replaced: Harvest's Health plugin exports nothing for it.
    const replaced: Tick = await evaluate(step, []);
    expect(replaced.recovered).toBe(true);
  });

  test("a stopped data SVM opens one incident, and the SVMs ONTAP keeps for itself never do", async () => {
    const step: MonitorStep = stepOf("netapp-svm-stopped");
    const labels: Array<CapturedSeries> = seriesOf(
      "ontap.prom",
      "netapp_svm_labels",
    );
    // Seven SVMs, the admin and node ones among them.
    expect(labels).toHaveLength(7);
    const stopped: Array<CapturedSeries> = labels.filter(
      (series: CapturedSeries): boolean => {
        return passesFilters(step, series);
      },
    );
    const tick: Tick = await evaluate(
      step,
      stopped.map((series: CapturedSeries): Series => {
        return {
          labels: groupLabels(step, series),
          readings: { [aliasOf(step)]: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
        };
      }),
    );
    expect(tick.breaching).toEqual([{ svm: "svm_test" }]);
    // netapp_svm_new_status is 0 for them: it would have fired four times.
    expect(
      seriesOf("ontap.prom", "netapp_svm_new_status")
        .filter((series: CapturedSeries): boolean => {
          return series.value === 0;
        })
        .map((series: CapturedSeries): string => {
          return series.labels["svm"] || "";
        })
        .sort(),
    ).toEqual([
      "ontap-prod-01",
      "ontap-prod-01-01",
      "ontap-prod-01-02",
      "svm_test",
    ]);
  });

  test("an unhealthy SnapMirror relationship opens one incident by its destination", async () => {
    const step: MonitorStep = stepOf("netapp-snapmirror-unhealthy");
    const unhealthy: Array<CapturedSeries> = seriesOf(
      "ontap.prom",
      "netapp_snapmirror_labels",
    ).filter((series: CapturedSeries): boolean => {
      return passesFilters(step, series);
    });
    const tick: Tick = await evaluate(
      step,
      unhealthy.map((series: CapturedSeries): Series => {
        return {
          labels: groupLabels(step, series),
          readings: { [aliasOf(step)]: [1, 1, 1, 1, 1] },
        };
      }),
    );
    expect(tick.breaching).toEqual([
      { destination_location: "svm_dr:vol_erp_dr" },
    ]);
  });
});

describe("a state, as Harvest's 0 or 1", () => {
  test("an offline volume fires, and recovers on exactly 1", async () => {
    const step: MonitorStep = stepOf("netapp-volume-offline");
    const statuses: Array<CapturedSeries> = seriesOf(
      "ontap.prom",
      "netapp_volume_new_status",
    );
    const fired: Tick = await evaluate(
      step,
      statuses.map((series: CapturedSeries): Series => {
        return {
          labels: groupLabels(step, series),
          readings: { [aliasOf(step)]: Array(10).fill(series.value) },
        };
      }),
    );
    expect(fired.breaching).toEqual([{ volume: "vol_logs", svm: "svm_nas" }]);

    const back: Tick = await evaluate(
      step,
      statuses.map((series: CapturedSeries): Series => {
        return {
          labels: groupLabels(step, series),
          readings: { [aliasOf(step)]: Array(10).fill(1) },
        };
      }),
    );
    expect(back.breaching).toEqual([]);
    expect(back.recovered).toBe(true);
  });

  test("a failed shelf power supply fires for its shelf", async () => {
    const step: MonitorStep = stepOf("netapp-shelf-power-supply-failed");
    const tick: Tick = await evaluate(step, [
      {
        labels: { shelf: "1.0" },
        readings: {
          [aliasOf(step)]: Array(10).fill(
            Math.min(
              ...seriesOf("ontap.prom", "netapp_shelf_psu_status").map(
                (series: CapturedSeries): number => {
                  return series.value;
                },
              ),
            ),
          ),
        },
      },
    ]);
    expect(tick.breaching).toEqual([{ shelf: "1.0" }]);
  });
});

describe("SnapMirror Behind Schedule, the lag over the schedule", () => {
  const step: MonitorStep = stepOf("netapp-snapmirror-behind-schedule");

  test("only the hourly relationship three hours behind is behind its schedule", async () => {
    const lags: Array<CapturedSeries> = seriesOf(
      "ontap.prom",
      "netapp_snapmirror_lag_time",
    );
    const schedules: Map<string, number> = new Map(
      seriesOf("ontap.prom", "netapp_snapmirror_schedule_seconds").map(
        (series: CapturedSeries): [string, number] => {
          return [series.labels["destination_location"] || "", series.value];
        },
      ),
    );
    expect(lags).toHaveLength(4);

    const tick: Tick = await evaluate(
      step,
      lags.map((series: CapturedSeries): Series => {
        const destination: string = series.labels["destination_location"]!;
        const schedule: number | undefined = schedules.get(destination);
        return {
          labels: groupLabels(step, series),
          readings: {
            [aliasOf(step, 0)]: Array(15).fill(series.value),
            // The synchronous one has no schedule series at all.
            ...(schedule === undefined
              ? {}
              : { [aliasOf(step, 1)]: Array(15).fill(schedule) }),
          },
        };
      }),
    );
    expect(tick.breaching).toEqual([
      { destination_location: "svm_dr:vol_erp_dr" },
    ]);
  });

  test("a relationship back within one and a half intervals recovers", async () => {
    const tick: Tick = await evaluate(step, [
      {
        labels: { destination_location: "svm_dr:vol_erp_dr" },
        readings: {
          [aliasOf(step, 0)]: Array(15).fill(1200),
          [aliasOf(step, 1)]: Array(15).fill(3600),
        },
      },
    ]);
    expect(tick.breaching).toEqual([]);
    expect(tick.recovered).toBe(true);
  });
});

describe("a volume is one incident per SVM and volume", () => {
  test("two SVMs' vol1, both full, are two incidents", async () => {
    const step: MonitorStep = stepOf("netapp-volume-full");
    expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([
      "volume",
      "svm",
    ]);
    const tick: Tick = await evaluate(step, [
      {
        labels: { volume: "vol1", svm: "svm_a" },
        readings: { [aliasOf(step)]: [99, 99, 99, 99, 99] },
      },
      {
        labels: { volume: "vol1", svm: "svm_b" },
        readings: { [aliasOf(step)]: [99.5, 99.5, 99.5, 99.5, 99.5] },
      },
      {
        labels: { volume: "vol2", svm: "svm_a" },
        readings: { [aliasOf(step)]: [40, 40, 40, 40, 40] },
      },
    ]);
    expect(tick.breaching).toEqual([
      { volume: "vol1", svm: "svm_a" },
      { volume: "vol1", svm: "svm_b" },
    ]);
  });

  test("the recorded vol_projects (96%) is past Volume Above 90% and not 98%", async () => {
    const used: CapturedSeries = seriesOf(
      "ontap.prom",
      "netapp_volume_size_used_percent",
      (series: CapturedSeries): boolean => {
        return series.labels["volume"] === "vol_projects";
      },
    )[0]!;
    for (const [id, fires] of [
      ["netapp-volume-nearly-full", true],
      ["netapp-volume-full", false],
    ] as Array<[string, boolean]>) {
      const step: MonitorStep = stepOf(id);
      const tick: Tick = await evaluate(step, [
        {
          labels: groupLabels(step, used),
          readings: { [aliasOf(step)]: Array(15).fill(used.value) },
        },
      ]);
      expect({ id, fires: tick.breaching.length > 0 }).toEqual({ id, fires });
    }
  });
});

describe("the ONTAP catalog, against what Harvest serves", () => {
  const metrics: Array<StorageArrayMetricDefinition> =
    getStorageArrayMetricsForSystem(ONTAP);
  const recorded: Record<string, unknown> = getRecordedSeriesLabels();
  // Health plugin alerts a healthy stand-in never raised (Harvest's code declares them).
  const neverRaised: Array<string> = [
    "netapp_health_ha_alerts",
    "netapp_health_node_alerts",
  ];

  test("every metric is a series the agent sends", () => {
    for (const metric of metrics) {
      expect({
        metric: metric.metricName,
        sent:
          recorded[metric.metricName] !== undefined ||
          neverRaised.includes(metric.metricName),
      }).toEqual({ metric: metric.metricName, sent: true });
    }
  });

  test("its unit is the one Harvest's name says", () => {
    // Harvest's name endings and the unit each says, the first that fits.
    const units: Array<[RegExp, string]> = [
      [/_(latency|read_latency|write_latency)$/, "µs"],
      [/_ops$/, "ops/s"],
      [/_(data|rx_bytes|tx_bytes)$/, "bytes/s"],
      [/(_percent|_processor_busy)$/, "%"],
      [/_(lag_time|schedule_seconds|uptime|transfer_duration)$/, "s"],
      [/_reading$/, "°C"],
      [
        /_(size|size_used|size_total|size_available|space_total|space_used|space_available|transfer_size|wo_snapshots_flexclones)$/,
        "bytes",
      ],
      [/(_new_status|_status|_labels)$/, ""],
    ];
    const unitOf: (name: string) => string = (name: string): string => {
      for (const [ending, unit] of units) {
        if (ending.test(name)) {
          return unit;
        }
      }
      return "count";
    };
    for (const metric of metrics) {
      expect({ id: metric.id, unit: metric.unit }).toEqual({
        id: metric.id,
        unit: unitOf(metric.metricName),
      });
    }
  });

  test("a state reads by its worst reading, a latency by its highest, a rate by its average", () => {
    const state: RegExp = /_new_status$/;
    const shelfState: RegExp = /_(psu|fan|temperature)_status$/;
    const latency: RegExp = /_latency$/;
    const rate: RegExp = /_(ops|data)$/;
    for (const metric of metrics) {
      const name: string = metric.metricName;
      if (state.test(name) || shelfState.test(name)) {
        expect({
          id: metric.id,
          aggregation: metric.defaultAggregation,
        }).toEqual({
          id: metric.id,
          aggregation: MetricsAggregationType.Min,
        });
      }
      if (latency.test(name)) {
        expect({
          id: metric.id,
          aggregation: metric.defaultAggregation,
        }).toEqual({
          id: metric.id,
          aggregation: MetricsAggregationType.Max,
        });
      }
      if (rate.test(name)) {
        expect({
          id: metric.id,
          aggregation: metric.defaultAggregation,
        }).toEqual({
          id: metric.id,
          aggregation: MetricsAggregationType.Avg,
        });
      }
      expect(metric.defaultAggregation).not.toBe(MetricsAggregationType.Sum);
    }
  });

  test("the units Harvest does not declare are the ones ingest records", () => {
    for (const metric of metrics) {
      if (metric.unit) {
        expect({
          metric: metric.metricName,
          stored: StorageArrayMetricUnitUtil.getStoredUnit({
            metricName: metric.metricName,
            declaredUnit: undefined,
          }),
        }).toEqual({ metric: metric.metricName, stored: metric.unit });
      }
    }
  });

  test("every template watches one of these, and an ONTAP cluster is offered them all, its heartbeat first", () => {
    const templates: Array<StorageArrayAlertTemplate> =
      getStorageArrayAlertTemplatesForSystem(ONTAP);
    expect(templates[0]!.id).toBe("netapp-cluster-stopped-reporting");
    const names: Set<string> = new Set(
      metrics.map((metric: StorageArrayMetricDefinition): string => {
        return metric.metricName;
      }),
    );
    for (const template of templates) {
      const step: MonitorStep = template.getMonitorStep({
        arrayIdentifier: "ontap-prod-01",
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "ontap-prod-01",
      });
      for (const query of step.data!.storageArrayMonitor!.metricViewConfig
        .queryConfigs) {
        expect(names.has(query.metricQueryData.filterData.metricName!)).toBe(
          true,
        );
      }
    }
  });
});
